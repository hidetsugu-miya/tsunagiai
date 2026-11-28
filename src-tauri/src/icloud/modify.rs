//! Changing the mail of an iCloud account (M-13): marking a thread read or unread, archiving it, deleting it, and taking either back.
//! iCloud has no MOVE (its CAPABILITY lists UIDPLUS but not MOVE), so a thread is moved by `UID COPY` into the other folder, then `UID STORE +FLAGS (\\Deleted)` and `UID EXPUNGE` of the same UIDs in the folder it left.
//! The expunge names the UIDs (UIDPLUS), so it never takes away a mail that something else marked deleted, and nothing is flagged or expunged unless the copy was accepted.
//! The thread is found again by its Message-ID in the folder it is in, as a thread is opened (`read::thread_mails_in`), so an undo needs no state: it asks for the thread in the folder it went to.
//! A mail with no Message-ID is a thread by its place (folder and UID), which a move changes: it can be archived or deleted but not taken back (`スレッドが見つかりません`).

use async_imap::{error::Error, Session};
use futures_util::TryStreamExt;

use super::{
    message::Folder,
    read::{thread_mails_in, uid_set, with_thread, Io, HEADERS},
};

/// A move of the mails of a thread between two folders.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Move {
    Archive,
    Unarchive,
    Trash,
    Untrash,
}

impl Move {
    /// The folder the mails leave and the folder they go to. Only the mails that are in the first folder move: the replies in Sent Messages stay.
    pub fn route(self) -> (Folder, Folder) {
        match self {
            Move::Archive => (Folder::Inbox, Folder::Archive),
            Move::Unarchive => (Folder::Archive, Folder::Inbox),
            Move::Trash => (Folder::Inbox, Folder::Trash),
            Move::Untrash => (Folder::Trash, Folder::Inbox),
        }
    }
}

/// What can be done to a thread of an iCloud account.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Change {
    Move(Move),
    /// `true` marks the mails of the thread in INBOX read (`\\Seen` on), `false` unread.
    Read(bool),
}

fn modify_failed(e: Error) -> String {
    format!("iCloud のメールを変更できません: {e}")
}

fn not_found() -> String {
    "スレッドが見つかりません".into()
}

/// The flag change that marks mails read or unread. `.SILENT` asks the server not to send the mails back.
fn seen_query(read: bool) -> &'static str {
    if read {
        "+FLAGS.SILENT (\\Seen)"
    } else {
        "-FLAGS.SILENT (\\Seen)"
    }
}

/// The UIDs, ascending, of the mails of the thread `key` that are in `folder`.
async fn thread_uids<S: Io>(
    session: &mut Session<S>,
    key: &str,
    folder: Folder,
) -> Result<Vec<u32>, String> {
    let mails = thread_mails_in(session, key, &[folder], HEADERS).await?;
    let mut uids = with_thread(key, &mails, |_, members| {
        members
            .iter()
            .filter(|m| m.raw.folder == folder)
            .map(|m| m.raw.uid)
            .collect::<Vec<u32>>()
    })
    .unwrap_or_default();
    uids.sort_unstable();
    uids.dedup();
    Ok(uids)
}

async fn store<S: Io>(session: &mut Session<S>, set: &str, query: &str) -> Result<(), String> {
    session
        .uid_store(set, query)
        .await
        .map_err(modify_failed)?
        .try_collect::<Vec<_>>()
        .await
        .map_err(modify_failed)?;
    Ok(())
}

async fn move_thread<S: Io>(session: &mut Session<S>, key: &str, how: Move) -> Result<(), String> {
    let (from, to) = how.route();
    let uids = thread_uids(session, key, from).await?;
    if uids.is_empty() {
        return Err(not_found());
    }
    let set = uid_set(&uids);
    session.select(from.name()).await.map_err(modify_failed)?;
    session
        .uid_copy(&set, to.name())
        .await
        .map_err(|e| match e {
            Error::No(_) => format!("iCloud が「{}」へのコピーを断りました", to.name()),
            e => modify_failed(e),
        })?;
    store(session, &set, "+FLAGS.SILENT (\\Deleted)").await?;
    session
        .uid_expunge(&set)
        .await
        .map_err(modify_failed)?
        .try_collect::<Vec<_>>()
        .await
        .map_err(modify_failed)?;
    Ok(())
}

async fn set_read<S: Io>(session: &mut Session<S>, key: &str, read: bool) -> Result<(), String> {
    let uids = thread_uids(session, key, Folder::Inbox).await?;
    // A thread that has no mail in INBOX (it was archived somewhere else) has nothing to mark.
    if uids.is_empty() {
        return Ok(());
    }
    session
        .select(Folder::Inbox.name())
        .await
        .map_err(modify_failed)?;
    store(session, &uid_set(&uids), seen_query(read)).await
}

/// Does `change` to the thread whose root key is `key` over a session that is logged in.
pub async fn apply<S: Io>(
    session: &mut Session<S>,
    key: &str,
    change: Change,
) -> Result<(), String> {
    match change {
        Change::Move(how) => move_thread(session, key, how).await,
        Change::Read(read) => set_read(session, key, read).await,
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::icloud::login_session;
    use tokio::{
        io::{AsyncBufReadExt, AsyncWriteExt, BufReader},
        net::{TcpListener, TcpStream},
        task::JoinHandle,
    };

    const ME: &str = "me@icloud.com";
    const DATE: &str = "27-Nov-2026 10:00:00 +0900";

    #[derive(Clone)]
    struct Stored {
        uid: u32,
        flags: Vec<String>,
        raw: String,
    }

    struct Mailbox {
        name: &'static str,
        validity: u32,
        mails: Vec<Stored>,
    }

    fn stored(uid: u32, seen: bool, id: &str, refs: &[&str]) -> Stored {
        let mut raw = format!("Message-ID: <{id}>\r\n");
        if let Some(first) = refs.first() {
            let all: Vec<String> = refs.iter().map(|r| format!("<{r}>")).collect();
            raw += &format!(
                "References: {}\r\nIn-Reply-To: <{first}>\r\n",
                all.join(" ")
            );
        }
        raw += "From: Alice <alice@example.com>\r\nTo: me@icloud.com\r\nSubject: s\r\n\r\nbody\r\n";
        Stored {
            uid,
            flags: if seen { vec!["\\Seen".into()] } else { vec![] },
            raw,
        }
    }

    fn numbers(set: &str) -> Vec<u32> {
        set.split(',').map(|n| n.parse().unwrap()).collect()
    }

    /// The strings between double quotes of an IMAP command.
    fn quoted(command: &str) -> Vec<String> {
        command
            .split('"')
            .skip(1)
            .step_by(2)
            .map(str::to_owned)
            .collect()
    }

    /// A server of one connection with the mailboxes `boxes`, that speaks the commands the changes use and really moves, flags and expunges.
    /// SELECT opens a folder for writing and EXAMINE read-only, where STORE and EXPUNGE are refused. The value of the join handle is what it was sent and the mailboxes as they ended.
    async fn serve(
        mut boxes: Vec<Mailbox>,
    ) -> (TcpStream, JoinHandle<(Vec<String>, Vec<Mailbox>)>) {
        let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
        let addr = listener.local_addr().unwrap();
        let server = tokio::spawn(async move {
            let (stream, _) = listener.accept().await.unwrap();
            let (read, mut write) = stream.into_split();
            write.write_all(b"* OK IMAP ready\r\n").await.unwrap();
            let mut lines = BufReader::new(read).lines();
            let (mut seen, mut open, mut writable) = (Vec::new(), None::<usize>, false);
            while let Some(line) = lines.next_line().await.unwrap() {
                seen.push(line.clone());
                let (tag, rest) = line.split_once(' ').unwrap();
                let (command, args) = rest.split_once(' ').unwrap_or((rest, ""));
                let mut reply = String::new();
                match command {
                    "LOGIN" => reply += &format!("{tag} OK Logged in\r\n"),
                    "SELECT" | "EXAMINE" => {
                        match boxes.iter().position(|b| quoted(args) == [b.name]) {
                            Some(n) => {
                                open = Some(n);
                                writable = command == "SELECT";
                                reply += &format!(
                                    "* {} EXISTS\r\n* OK [UIDVALIDITY {}] ok\r\n{tag} OK done\r\n",
                                    boxes[n].mails.len(),
                                    boxes[n].validity
                                );
                            }
                            None => reply += &format!("{tag} NO no such mailbox\r\n"),
                        }
                    }
                    "UID" => {
                        let (sub, args) = args.split_once(' ').unwrap();
                        let here = open.unwrap();
                        match sub {
                            "SEARCH" => {
                                let needles = quoted(args);
                                let hits: Vec<String> = boxes[here]
                                    .mails
                                    .iter()
                                    .filter(|m| {
                                        let head = &m.raw[..m.raw.find("\r\n\r\n").unwrap()];
                                        needles.iter().any(|n| head.contains(n.as_str()))
                                    })
                                    .map(|m| m.uid.to_string())
                                    .collect();
                                reply += &format!(
                                    "* SEARCH {}\r\n{tag} OK Search completed\r\n",
                                    hits.join(" ")
                                );
                            }
                            "FETCH" => {
                                let wanted = numbers(args.split_once(' ').unwrap().0);
                                for (i, m) in boxes[here].mails.iter().enumerate() {
                                    if !wanted.contains(&m.uid) {
                                        continue;
                                    }
                                    let head = &m.raw[..m.raw.find("\r\n\r\n").unwrap() + 4];
                                    reply += &format!(
                                        "* {} FETCH (UID {} INTERNALDATE \"{DATE}\" BODY[HEADER.FIELDS (MESSAGE-ID IN-REPLY-TO REFERENCES)] {{{}}}\r\n{head})\r\n",
                                        i + 1,
                                        m.uid,
                                        head.len()
                                    );
                                }
                                reply += &format!("{tag} OK Fetch completed\r\n");
                            }
                            "COPY" => {
                                let (set, to) = args.split_once(' ').unwrap();
                                match boxes.iter().position(|b| quoted(to) == [b.name]) {
                                    None => {
                                        reply +=
                                            &format!("{tag} NO [TRYCREATE] no such mailbox\r\n")
                                    }
                                    Some(d) => {
                                        let wanted = numbers(set);
                                        let copies: Vec<Stored> = boxes[here]
                                            .mails
                                            .iter()
                                            .filter(|m| wanted.contains(&m.uid))
                                            .cloned()
                                            .collect();
                                        for mut c in copies {
                                            c.uid = boxes[d]
                                                .mails
                                                .iter()
                                                .map(|m| m.uid)
                                                .max()
                                                .unwrap_or(0)
                                                + 1;
                                            boxes[d].mails.push(c);
                                        }
                                        reply += &format!("{tag} OK Copy completed\r\n");
                                    }
                                }
                            }
                            "STORE" if !writable => {
                                reply += &format!("{tag} NO mailbox is read-only\r\n")
                            }
                            "STORE" => {
                                let (set, change) = args.split_once(' ').unwrap();
                                let wanted = numbers(set);
                                let flag = change.split('(').nth(1).unwrap().trim_end_matches(')');
                                for m in boxes[here]
                                    .mails
                                    .iter_mut()
                                    .filter(|m| wanted.contains(&m.uid))
                                {
                                    m.flags.retain(|f| f != flag);
                                    if change.starts_with('+') {
                                        m.flags.push(flag.to_owned());
                                    }
                                }
                                reply += &format!("{tag} OK Store completed\r\n");
                            }
                            "EXPUNGE" if !writable => {
                                reply += &format!("{tag} NO mailbox is read-only\r\n")
                            }
                            "EXPUNGE" => {
                                let wanted = numbers(args);
                                boxes[here].mails.retain(|m| {
                                    !(wanted.contains(&m.uid)
                                        && m.flags.iter().any(|f| f == "\\Deleted"))
                                });
                                reply += &format!("{tag} OK Expunge completed\r\n");
                            }
                            _ => reply += &format!("{tag} BAD unknown\r\n"),
                        }
                    }
                    "LOGOUT" => {
                        write
                            .write_all(
                                format!("* BYE bye\r\n{tag} OK LOGOUT completed\r\n").as_bytes(),
                            )
                            .await
                            .unwrap();
                        break;
                    }
                    _ => reply += &format!("{tag} BAD unknown\r\n"),
                }
                write.write_all(reply.as_bytes()).await.unwrap();
            }
            (seen, boxes)
        });
        (TcpStream::connect(addr).await.unwrap(), server)
    }

    /// INBOX: the thread of root@x (UIDs 10, 11 and 13; 10 is read) and an unrelated mail (12). Sent Messages: my reply to the thread (5). Archive: an old mail of another thread (3). Nothing in the trash.
    fn boxes() -> Vec<Mailbox> {
        vec![
            Mailbox {
                name: "INBOX",
                validity: 1700,
                mails: vec![
                    stored(10, true, "root@x", &[]),
                    stored(11, false, "a2@x", &["root@x"]),
                    stored(12, false, "lone@x", &[]),
                    stored(13, false, "a3@x", &["root@x", "a2@x"]),
                ],
            },
            Mailbox {
                name: "Sent Messages",
                validity: 1800,
                mails: vec![stored(5, true, "mine@x", &["root@x"])],
            },
            Mailbox {
                name: "Archive",
                validity: 1900,
                mails: vec![stored(3, true, "old@x", &[])],
            },
            Mailbox {
                name: "Deleted Messages",
                validity: 2000,
                mails: vec![],
            },
        ]
    }

    /// Runs `change` on the thread of `key` over a fake server holding `boxes`.
    async fn run(
        boxes: Vec<Mailbox>,
        key: &str,
        change: Change,
    ) -> (Result<(), String>, Vec<String>, Vec<Mailbox>) {
        let (stream, server) = serve(boxes).await;
        let mut session = login_session(stream, ME, "pw").await.unwrap();
        let done = apply(&mut session, key, change).await;
        let _ = session.logout().await;
        let (seen, boxes) = server.await.unwrap();
        (done, seen, boxes)
    }

    fn uids(boxes: &[Mailbox], name: &str) -> Vec<u32> {
        let mut uids: Vec<u32> = boxes
            .iter()
            .find(|b| b.name == name)
            .unwrap()
            .mails
            .iter()
            .map(|m| m.uid)
            .collect();
        uids.sort_unstable();
        uids
    }

    fn ids(boxes: &[Mailbox], name: &str) -> Vec<String> {
        let mut ids: Vec<String> = boxes
            .iter()
            .find(|b| b.name == name)
            .unwrap()
            .mails
            .iter()
            .map(|m| {
                let start = m.raw.find('<').unwrap() + 1;
                m.raw[start..m.raw.find('>').unwrap()].to_owned()
            })
            .collect();
        ids.sort();
        ids
    }

    fn flags_of(boxes: &[Mailbox], name: &str, uid: u32) -> Vec<String> {
        boxes
            .iter()
            .find(|b| b.name == name)
            .unwrap()
            .mails
            .iter()
            .find(|m| m.uid == uid)
            .unwrap()
            .flags
            .clone()
    }

    fn at(seen: &[String], part: &str) -> usize {
        seen.iter()
            .position(|l| l.contains(part))
            .unwrap_or_else(|| panic!("{part} not sent: {seen:?}"))
    }

    fn none_sent(seen: &[String], parts: &[&str]) {
        for line in seen {
            for part in parts {
                assert!(!line.contains(part), "{line}");
            }
        }
    }

    #[test]
    fn each_move_goes_from_the_folder_the_mails_are_in_to_the_folder_they_are_taken_to() {
        use Folder::*;
        assert_eq!(Move::Archive.route(), (Inbox, Archive));
        assert_eq!(Move::Unarchive.route(), (Archive, Inbox));
        assert_eq!(Move::Trash.route(), (Inbox, Trash));
        assert_eq!(Move::Untrash.route(), (Trash, Inbox));
        assert_eq!(
            [Archive, Trash].map(Folder::name),
            ["Archive", "Deleted Messages"]
        );
        assert_eq!(
            [Archive, Trash].map(|f| Folder::of_tag(f.tag())),
            [Some(Archive), Some(Trash)]
        );
    }

    #[tokio::test]
    async fn archiving_copies_the_inbox_mails_of_the_thread_then_flags_and_expunges_those_uids_only(
    ) {
        let (done, seen, after) = run(boxes(), "root@x", Change::Move(Move::Archive)).await;
        assert_eq!(done, Ok(()));
        // The thread left INBOX; the unrelated mail stayed, and so did my reply in Sent Messages.
        assert_eq!(uids(&after, "INBOX"), [12]);
        assert_eq!(uids(&after, "Sent Messages"), [5]);
        assert_eq!(ids(&after, "Archive"), ["a2@x", "a3@x", "old@x", "root@x"]);
        // The copy comes first, and only then is the original marked and removed, by the same UIDs and never by a plain EXPUNGE.
        let (select, copy, store, expunge) = (
            at(&seen, "SELECT \"INBOX\""),
            at(&seen, "UID COPY 10,11,13 \"Archive\""),
            at(&seen, "UID STORE 10,11,13 +FLAGS.SILENT (\\Deleted)"),
            at(&seen, "UID EXPUNGE 10,11,13"),
        );
        assert!(select < copy && copy < store && store < expunge, "{seen:?}");
        assert!(seen.iter().all(|l| !l.ends_with(" EXPUNGE")), "{seen:?}");
        // Before the SELECT the mails are only looked up (EXAMINE, SEARCH and header fetches).
        none_sent(&seen[..select], &["STORE", "COPY", "EXPUNGE"]);
    }

    #[tokio::test]
    async fn deleting_moves_the_thread_to_deleted_messages() {
        let (done, seen, after) = run(boxes(), "root@x", Change::Move(Move::Trash)).await;
        assert_eq!(done, Ok(()));
        assert_eq!(uids(&after, "INBOX"), [12]);
        assert_eq!(ids(&after, "Deleted Messages"), ["a2@x", "a3@x", "root@x"]);
        assert_eq!(uids(&after, "Archive"), [3]);
        at(&seen, "UID COPY 10,11,13 \"Deleted Messages\"");
    }

    #[tokio::test]
    async fn taking_a_move_back_returns_only_the_mails_in_the_folder_it_went_to() {
        for (how, name, other) in [
            (Move::Unarchive, "Archive", "Deleted Messages"),
            (Move::Untrash, "Deleted Messages", "Archive"),
        ] {
            let mut b = boxes();
            // The thread went to `name` earlier; a later reply of it (a3@x) arrived in INBOX, and the unrelated old mail waits in the same folder.
            let inbox = &mut b[0].mails;
            let moved: Vec<Stored> = inbox.drain(..2).collect();
            let target = b.iter_mut().find(|m| m.name == name).unwrap();
            for (i, mut m) in moved.into_iter().enumerate() {
                m.uid = 20 + i as u32;
                target.mails.push(m);
            }
            let (done, seen, after) = run(b, "root@x", Change::Move(how)).await;
            assert_eq!(done, Ok(()), "{how:?}");
            assert_eq!(
                ids(&after, "INBOX"),
                ["a2@x", "a3@x", "lone@x", "root@x"],
                "{how:?}"
            );
            assert!(!ids(&after, name).contains(&"root@x".to_owned()), "{how:?}");
            // Only what was in the folder moved: the reply that was in INBOX is not copied again.
            assert_eq!(
                after[0]
                    .mails
                    .iter()
                    .filter(|m| m.raw.contains("<a3@x>"))
                    .count(),
                1,
                "{how:?}"
            );
            at(&seen, &format!("SELECT \"{name}\""));
            at(&seen, "UID COPY 20,21 \"INBOX\"");
            assert_eq!(
                uids(&after, other).len(),
                if other == "Archive" { 1 } else { 0 },
                "{how:?}"
            );
        }
    }

    #[tokio::test]
    async fn a_refused_copy_leaves_every_mail_where_it_is_and_marks_nothing() {
        let mut b = boxes();
        b.retain(|m| m.name != "Archive");
        let (done, seen, after) = run(b, "root@x", Change::Move(Move::Archive)).await;
        assert!(done.unwrap_err().contains("Archive"));
        assert_eq!(uids(&after, "INBOX"), [10, 11, 12, 13]);
        assert!(after[0]
            .mails
            .iter()
            .all(|m| !m.flags.contains(&"\\Deleted".to_owned())));
        none_sent(&seen, &["STORE", "EXPUNGE"]);
    }

    #[tokio::test]
    async fn a_thread_that_is_not_in_the_folder_is_an_error_and_nothing_is_changed() {
        let (done, seen, after) = run(boxes(), "nothing@x", Change::Move(Move::Archive)).await;
        assert_eq!(done, Err("スレッドが見つかりません".into()));
        assert_eq!(uids(&after, "INBOX"), [10, 11, 12, 13]);
        none_sent(&seen, &["SELECT", "COPY", "STORE", "EXPUNGE"]);
        // The thread is in INBOX, so taking it out of the archive finds nothing there either.
        let (done, _, after) = run(boxes(), "root@x", Change::Move(Move::Unarchive)).await;
        assert_eq!(done, Err("スレッドが見つかりません".into()));
        assert_eq!(uids(&after, "INBOX"), [10, 11, 12, 13]);
    }

    #[tokio::test]
    async fn marking_read_sets_seen_on_the_inbox_mails_of_the_thread_only() {
        let (done, seen, after) = run(boxes(), "root@x", Change::Read(true)).await;
        assert_eq!(done, Ok(()));
        for uid in [10, 11, 13] {
            assert_eq!(flags_of(&after, "INBOX", uid), ["\\Seen"], "{uid}");
        }
        assert!(flags_of(&after, "INBOX", 12).is_empty());
        assert!(flags_of(&after, "Sent Messages", 5).contains(&"\\Seen".to_owned()));
        at(&seen, "UID STORE 10,11,13 +FLAGS.SILENT (\\Seen)");
        none_sent(&seen, &["COPY", "EXPUNGE"]);
    }

    #[tokio::test]
    async fn marking_unread_takes_seen_off_and_leaves_the_other_mails() {
        let (done, seen, after) = run(boxes(), "root@x", Change::Read(false)).await;
        assert_eq!(done, Ok(()));
        for uid in [10, 11, 13] {
            assert!(flags_of(&after, "INBOX", uid).is_empty(), "{uid}");
        }
        assert!(flags_of(&after, "Sent Messages", 5).contains(&"\\Seen".to_owned()));
        assert!(flags_of(&after, "Archive", 3).contains(&"\\Seen".to_owned()));
        at(&seen, "UID STORE 10,11,13 -FLAGS.SILENT (\\Seen)");
    }

    #[tokio::test]
    async fn a_thread_with_no_mail_in_the_inbox_has_nothing_to_mark() {
        let (done, seen, _) = run(boxes(), "old@x", Change::Read(true)).await;
        assert_eq!(done, Ok(()));
        none_sent(&seen, &["SELECT", "STORE"]);
    }
}
