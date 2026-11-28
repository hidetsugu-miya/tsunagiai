//! The automatic sync of an iCloud account (M-13, M-7): one round asks iCloud whether the inbox changed since the position the screen holds, and reads only the difference.
//! The position is the UIDVALIDITY and the HIGHESTMODSEQ of INBOX ("{validity}:{modseq}", RFC 7162), a string that the screen keeps and gives back as it is.
//! A round is: `ENABLE QRESYNC`, `SELECT INBOX (CONDSTORE)`, and, when the HIGHESTMODSEQ moved, `UID FETCH 1:* (UID) (CHANGEDSINCE {modseq} VANISHED)`.
//! The threads of the changed mails are read with `ROW` (the header and the head of the text), as the list reads its rows, never the whole mails.
//! What a round decides from the numbers is pure (`step`, `outcome`): a UIDVALIDITY that changed, a mail that vanished (moved or deleted) or too many changes read the inbox again, and the rest reads only the threads of the changed mails.

use std::collections::BTreeMap;

use async_imap::{imap_proto::Response, types::UnsolicitedResponse, Session};
use futures_util::TryStreamExt;
use mail_parser::MessageParser;

use super::{
    message::{thread_item, Folder, Mail},
    read::{
        self, failed, fetch, nodes_of, thread_mails_in, uid_set, with_threads, Io, HEADERS, ROW,
    },
    threading::{thread_id, Node},
};
use crate::gmail::{Sync, ThreadItem};

/// More changed mails than this are not followed one thread at a time: each thread costs searches, and one read of the inbox costs fewer.
const MAX_CHANGED: usize = 10;

/// Where the sync of an account stands: the inbox as it was when the screen last heard of it.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct Position {
    pub validity: u32,
    pub modseq: u64,
}

impl Position {
    pub fn text(self) -> String {
        format!("{}:{}", self.validity, self.modseq)
    }

    /// `None` for the empty position of a load that could not read one, and for anything that `text` did not make.
    pub fn parse(text: &str) -> Option<Position> {
        let (validity, modseq) = text.split_once(':')?;
        Some(Position {
            validity: validity.parse().ok()?,
            modseq: modseq.parse().ok()?,
        })
    }
}

/// What the position of the screen and the position of the inbox now say to do.
#[derive(Debug, PartialEq, Eq)]
enum Step {
    Unchanged,
    /// Read the inbox again, with no difference to build on.
    Reload,
    /// Ask for what changed after this HIGHESTMODSEQ.
    Since(u64),
}

fn step(start: Option<Position>, now: Position) -> Step {
    match start {
        // A UIDVALIDITY that changed makes every UID mean another mail; a HIGHESTMODSEQ that went back is not a history to follow.
        Some(s) if s.validity == now.validity && s.modseq <= now.modseq => {
            if s.modseq == now.modseq {
                Step::Unchanged
            } else {
                Step::Since(s.modseq)
            }
        }
        _ => Step::Reload,
    }
}

/// What the difference of a round asks for.
#[derive(Debug, PartialEq, Eq)]
enum Outcome {
    /// Nothing that the list shows changed: only the position moves.
    Advance,
    Reload,
    /// Read the threads of the changed mails.
    Threads,
}

/// A mail that vanished leaves no header to find its thread by, and many changes are cheaper read as a whole.
fn outcome(changed: usize, vanished: bool) -> Outcome {
    if vanished || changed > MAX_CHANGED {
        Outcome::Reload
    } else if changed == 0 {
        Outcome::Advance
    } else {
        Outcome::Threads
    }
}

/// The position of INBOX now, asked before the mails are read, so that what changes while they are read is read again by the next round.
/// `None` when iCloud does not tell it: the load then gives the screen the empty position, and the first sync reads the inbox again and brings the real one.
pub async fn position<S: Io>(session: &mut Session<S>) -> Option<Position> {
    let inbox = session
        .status(Folder::Inbox.name(), "(UIDVALIDITY HIGHESTMODSEQ)")
        .await
        .ok()?;
    Some(Position {
        validity: inbox.uid_validity?,
        modseq: inbox.highest_modseq?,
    })
}

struct Changes {
    /// The UIDs of the mails that are new or whose flags changed.
    changed: Vec<u32>,
    vanished: bool,
}

async fn changes<S: Io>(session: &mut Session<S>, since: u64) -> Result<Changes, String> {
    // What the earlier commands left unsolicited is not the answer to this one.
    while session.unsolicited_responses.try_recv().is_ok() {}
    let fetches: Vec<_> = session
        .uid_fetch("1:*", format!("(UID) (CHANGEDSINCE {since} VANISHED)"))
        .await
        .map_err(failed)?
        .try_collect()
        .await
        .map_err(failed)?;
    let changed = fetches.iter().filter_map(|f| f.uid).collect();
    // The VANISHED response is not a FETCH, so the library hands it over as an unsolicited one.
    let mut vanished = false;
    while let Ok(response) = session.unsolicited_responses.try_recv() {
        vanished |= matches!(
            response,
            UnsolicitedResponse::Other(ref data) if matches!(data.parsed(), Response::Vanished { .. })
        );
    }
    Ok(Changes { changed, vanished })
}

/// The rows of the threads of the changed mails, and the IDs of the threads that are no longer in the inbox.
async fn rows<S: Io>(
    session: &mut Session<S>,
    account: &str,
    validity: u32,
    changed: &[u32],
) -> Result<(Vec<ThreadItem>, Vec<String>), String> {
    let headers = fetch(
        session,
        Folder::Inbox,
        validity,
        &uid_set(changed),
        true,
        HEADERS,
    )
    .await?;
    let mut keys: Vec<String> = Vec::new();
    for node in nodes_of(&MessageParser::new(), &headers) {
        if !keys.iter().any(|k| k == node.root_key()) {
            keys.push(node.root_key().to_owned());
        }
    }
    // By thread ID: two changed mails may name different roots of one thread.
    let mut found: BTreeMap<String, Option<ThreadItem>> = BTreeMap::new();
    for key in keys {
        let mails = thread_mails_in(session, &key, &[Folder::Inbox, Folder::Sent], ROW).await?;
        // The thread the key names, and the thread of each changed mail: a mail that names the key under another subject is a thread of its own.
        let wanted = |m: &Mail, n: &Node| {
            n.belongs_to(&key) || (m.raw.folder == Folder::Inbox && changed.contains(&m.raw.uid))
        };
        let rows = with_threads(&mails, wanted, |id, members| {
            let in_inbox = members.iter().any(|m| m.raw.folder == Folder::Inbox);
            (
                id.clone(),
                in_inbox.then(|| thread_item(account, id, members)),
            )
        });
        if rows.is_empty() {
            found.insert(thread_id(&key), None);
        }
        found.extend(rows);
    }
    let mut threads = Vec::new();
    let mut removed = Vec::new();
    for (id, item) in found {
        match item {
            Some(item) => threads.push(item),
            None => removed.push(id),
        }
    }
    Ok((threads, removed))
}

async fn reload<S: Io>(
    session: &mut Session<S>,
    account: &str,
    now: Position,
) -> Result<Sync, String> {
    Ok(Sync::Reloaded {
        threads: read::inbox_threads(session, account).await?,
        history_id: now.text(),
    })
}

/// One round of the sync of `account` from `start` (the position the screen holds) over a session that is logged in.
pub async fn sync<S: Io>(
    session: &mut Session<S>,
    account: &str,
    start: &str,
) -> Result<Sync, String> {
    session
        .run_command_and_check_ok("ENABLE QRESYNC")
        .await
        .map_err(failed)?;
    let inbox = session
        .select_condstore(Folder::Inbox.name())
        .await
        .map_err(failed)?;
    let now = Position {
        validity: inbox
            .uid_validity
            .ok_or("iCloud が UIDVALIDITY を返しません")?,
        modseq: inbox
            .highest_modseq
            .ok_or("iCloud が HIGHESTMODSEQ を返しません")?,
    };
    let since = match step(Position::parse(start), now) {
        Step::Unchanged => return Ok(Sync::Unchanged),
        Step::Reload => return reload(session, account, now).await,
        Step::Since(since) => since,
    };
    let Changes { changed, vanished } = changes(session, since).await?;
    match outcome(changed.len(), vanished) {
        Outcome::Reload => reload(session, account, now).await,
        Outcome::Advance => Ok(Sync::Changed {
            threads: Vec::new(),
            removed: Vec::new(),
            history_id: now.text(),
        }),
        Outcome::Threads => {
            let (threads, removed) = rows(session, account, now.validity, &changed).await?;
            Ok(Sync::Changed {
                threads,
                removed,
                history_id: now.text(),
            })
        }
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

    fn position_of(validity: u32, modseq: u64) -> Position {
        Position { validity, modseq }
    }

    #[test]
    fn a_position_is_read_back_from_its_text_and_nothing_else_is_one() {
        let p = position_of(1700, 130);
        assert_eq!(p.text(), "1700:130");
        assert_eq!(Position::parse("1700:130"), Some(p));
        for bad in ["", "1700", "1700:", ":130", "a:1", "1:b", "1:2:3x", "-1:2"] {
            assert_eq!(Position::parse(bad), None, "{bad:?}");
        }
    }

    #[test]
    fn the_step_follows_the_validity_and_the_modseq() {
        let now = position_of(7, 50);
        assert_eq!(step(Some(position_of(7, 50)), now), Step::Unchanged);
        assert_eq!(step(Some(position_of(7, 40)), now), Step::Since(40));
        // Another UIDVALIDITY, a modseq that went back, and a position that is none: nothing to build a difference on.
        assert_eq!(step(Some(position_of(6, 40)), now), Step::Reload);
        assert_eq!(step(Some(position_of(7, 60)), now), Step::Reload);
        assert_eq!(step(None, now), Step::Reload);
    }

    #[test]
    fn the_outcome_reads_the_inbox_again_for_a_vanished_mail_or_many_changes() {
        assert_eq!(outcome(0, false), Outcome::Advance);
        assert_eq!(outcome(1, false), Outcome::Threads);
        assert_eq!(outcome(MAX_CHANGED, false), Outcome::Threads);
        assert_eq!(outcome(MAX_CHANGED + 1, false), Outcome::Reload);
        assert_eq!(outcome(0, true), Outcome::Reload);
        assert_eq!(outcome(3, true), Outcome::Reload);
    }

    /// One reply of the fake server to a command that contains the pattern: `{tag}` is the command's tag.
    type Rules = Vec<(&'static str, String)>;

    /// A server of one connection that answers LOGIN and LOGOUT, and every other command by the first rule whose pattern the command contains. What it was sent is the value of the join handle.
    async fn serve(rules: Rules) -> (TcpStream, JoinHandle<Vec<String>>) {
        let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
        let addr = listener.local_addr().unwrap();
        let server = tokio::spawn(async move {
            let (stream, _) = listener.accept().await.unwrap();
            let (read, mut write) = stream.into_split();
            write.write_all(b"* OK IMAP ready\r\n").await.unwrap();
            let mut lines = BufReader::new(read).lines();
            let mut seen = Vec::new();
            while let Some(line) = lines.next_line().await.unwrap() {
                seen.push(line.clone());
                let (tag, rest) = line.split_once(' ').unwrap();
                let reply = if rest.starts_with("LOGIN") {
                    format!("{tag} OK Logged in\r\n")
                } else if rest.starts_with("LOGOUT") {
                    write
                        .write_all(format!("* BYE bye\r\n{tag} OK LOGOUT completed\r\n").as_bytes())
                        .await
                        .unwrap();
                    break;
                } else {
                    match rules.iter().find(|(pattern, _)| rest.contains(pattern)) {
                        Some((_, reply)) => reply.replace("{tag}", tag),
                        None => format!("{tag} BAD unknown\r\n"),
                    }
                };
                write.write_all(reply.as_bytes()).await.unwrap();
            }
            seen
        });
        (TcpStream::connect(addr).await.unwrap(), server)
    }

    /// One round of `sync` against a server with `rules`, and what the server was sent.
    async fn round(rules: Rules, start: &str) -> (Result<Sync, String>, Vec<String>) {
        let (stream, server) = serve(rules).await;
        let mut session = login_session(stream, ME, "pw").await.unwrap();
        let result = sync(&mut session, ME, start).await;
        let _ = session.logout().await;
        (result, server.await.unwrap())
    }

    fn mail(id: &str, subject: &str) -> String {
        format!("Message-ID: <{id}>\r\nFrom: Alice <alice@example.com>\r\nTo: {ME}\r\nSubject: {subject}\r\nContent-Type: text/plain; charset=utf-8\r\n\r\nhello\r\n")
    }

    /// A FETCH answer that holds one mail: `section` is the part of the mail it carries.
    fn fetched(seq: u32, uid: u32, section: &str, data: &str) -> String {
        format!(
            "* {seq} FETCH (UID {uid} FLAGS () INTERNALDATE \"27-Nov-2026 10:00:00 +0900\" {section} {{{}}}\r\n{data})\r\n",
            data.len()
        )
    }

    /// A FETCH answer to `ROW`: the header and the head of the text of one mail, as iCloud writes them.
    fn fetched_row(seq: u32, uid: u32, mail: &str) -> String {
        let (head, text) = mail.split_at(mail.find("\r\n\r\n").unwrap() + 4);
        format!(
            "* {seq} FETCH (UID {uid} FLAGS () INTERNALDATE \"27-Nov-2026 10:00:00 +0900\" BODY[HEADER] {{{}}}\r\n{head} BODY[TEXT]<0> {{{}}}\r\n{text})\r\n",
            head.len(),
            text.len()
        )
    }

    const ENABLE: &str = "* ENABLED QRESYNC\r\n{tag} OK ENABLE completed\r\n";

    fn select(validity: u32, modseq: Option<u64>) -> String {
        let modseq = modseq.map_or(String::new(), |m| {
            format!("* OK [HIGHESTMODSEQ {m}] ok\r\n")
        });
        format!("* 3 EXISTS\r\n* OK [UIDVALIDITY {validity}] ok\r\n{modseq}{{tag}} OK [READ-WRITE] done\r\n")
    }

    fn done(lines: &str) -> String {
        format!("{lines}{{tag}} OK done\r\n")
    }

    /// The rules of a round whose INBOX is at 1700:130 and whose CHANGEDSINCE answer is `changed`.
    fn rules_with(changed: &str) -> Rules {
        vec![
            ("ENABLE", ENABLE.to_owned()),
            ("SELECT", select(1700, Some(130))),
            ("CHANGEDSINCE", done(changed)),
        ]
    }

    /// The rules that let `read::inbox_threads` read an inbox of one mail, 12, and no sent folder.
    fn inbox_rules() -> Rules {
        let inbox = "* 1 EXISTS\r\n* OK [UIDVALIDITY 1700] ok\r\n{tag} OK [READ-ONLY] done\r\n";
        vec![
            ("EXAMINE \"INBOX\"", inbox.to_owned()),
            ("EXAMINE", "{tag} NO no such mailbox\r\n".to_owned()),
            (
                "FETCH 1:1",
                done(&fetched_row(1, 12, &mail("m12@x", "Plan"))),
            ),
        ]
    }

    fn assert_never_writes(seen: &[String]) {
        for line in seen {
            // The only command that selects, and it changes no flag: its parameter holds the word STORE.
            let line = line.replace("(CONDSTORE)", "");
            for forbidden in ["STORE", "COPY", "EXPUNGE", "APPEND", "MOVE"] {
                assert!(!line.contains(forbidden), "{line}");
            }
            assert!(!line.contains("BODY["), "BODY[ without PEEK: {line}");
        }
    }

    #[tokio::test]
    async fn the_position_is_asked_by_status_and_none_when_icloud_does_not_tell_it() {
        for (reply, expected) in [
            (
                done("* STATUS \"INBOX\" (UIDVALIDITY 1700 HIGHESTMODSEQ 120)\r\n"),
                Some(position_of(1700, 120)),
            ),
            (done("* STATUS \"INBOX\" (UIDVALIDITY 1700)\r\n"), None),
            ("{tag} NO no\r\n".to_owned(), None),
        ] {
            let (stream, server) = serve(vec![("STATUS", reply)]).await;
            let mut session = login_session(stream, ME, "pw").await.unwrap();
            assert_eq!(position(&mut session).await, expected);
            let _ = session.logout().await;
            let seen = server.await.unwrap();
            assert!(
                seen.iter()
                    .any(|l| l.contains("STATUS \"INBOX\" (UIDVALIDITY HIGHESTMODSEQ)")),
                "{seen:?}"
            );
        }
    }

    #[tokio::test]
    async fn an_inbox_at_the_same_modseq_is_unchanged_and_nothing_else_is_asked() {
        let (result, seen) = round(rules_with(""), "1700:130").await;
        assert_eq!(result, Ok(Sync::Unchanged));
        assert!(
            seen.iter().any(|l| l.contains("ENABLE QRESYNC")),
            "{seen:?}"
        );
        assert!(
            seen.iter()
                .any(|l| l.contains("SELECT \"INBOX\" (CONDSTORE)")),
            "{seen:?}"
        );
        assert!(!seen.iter().any(|l| l.contains("FETCH")), "{seen:?}");
    }

    #[tokio::test]
    async fn a_changed_mail_gives_its_thread_and_moves_the_position() {
        let mut rules = rules_with("* 3 FETCH (UID 12 MODSEQ (125))\r\n");
        rules.extend([
            (
                "EXAMINE \"INBOX\"",
                "* 3 EXISTS\r\n* OK [UIDVALIDITY 1700] ok\r\n{tag} OK [READ-ONLY] done\r\n"
                    .to_owned(),
            ),
            (
                "EXAMINE",
                "* 0 EXISTS\r\n* OK [UIDVALIDITY 1800] ok\r\n{tag} OK [READ-ONLY] done\r\n"
                    .to_owned(),
            ),
            (
                "HEADER.FIELDS",
                done(&fetched(
                    3,
                    12,
                    "BODY[HEADER.FIELDS (MESSAGE-ID IN-REPLY-TO REFERENCES)]",
                    "Message-ID: <m12@x>\r\n\r\n",
                )),
            ),
            ("UID SEARCH", done("* SEARCH 12\r\n")),
            (
                "UID FETCH 12 (UID FLAGS INTERNALDATE BODY.PEEK[HEADER] BODY.PEEK[TEXT]<0.8192>)",
                done(&fetched_row(3, 12, &mail("m12@x", "Plan"))),
            ),
        ]);
        let (result, seen) = round(rules, "1700:100").await;
        let Ok(Sync::Changed {
            threads,
            removed,
            history_id,
        }) = result
        else {
            panic!("{result:?}");
        };
        assert_eq!(history_id, "1700:130");
        assert!(removed.is_empty());
        assert_eq!(threads.len(), 1, "{threads:?}");
        assert_eq!(threads[0].id, thread_id("m12@x"));
        assert_eq!(threads[0].account, ME);
        assert_eq!(threads[0].subject, "Plan");
        assert!(threads[0].unread);
        assert!(
            seen.iter()
                .any(|l| l.contains("UID FETCH 1:* (UID) (CHANGEDSINCE 100 VANISHED)")),
            "{seen:?}"
        );
        assert_never_writes(&seen);
    }

    #[tokio::test]
    async fn a_changed_mail_that_names_a_thread_under_another_subject_is_a_row_of_its_own() {
        // Mail 13 names the Message-ID of 12 and has another subject: the delta gives the row of 13 as well as that of 12, and reads no whole mail.
        let outsider = "Message-ID: <y@x>\r\nReferences: <m12@x>\r\nFrom: Mallory <mallory@example.net>\r\nTo: me@icloud.com\r\nSubject: You won\r\nContent-Type: text/plain; charset=utf-8\r\n\r\nclick\r\n";
        let mut rules = rules_with("* 3 FETCH (UID 13 MODSEQ (125))\r\n");
        rules.extend([
            (
                "EXAMINE \"INBOX\"",
                "* 3 EXISTS\r\n* OK [UIDVALIDITY 1700] ok\r\n{tag} OK [READ-ONLY] done\r\n"
                    .to_owned(),
            ),
            (
                "EXAMINE",
                "* 0 EXISTS\r\n* OK [UIDVALIDITY 1800] ok\r\n{tag} OK [READ-ONLY] done\r\n"
                    .to_owned(),
            ),
            (
                "HEADER.FIELDS",
                done(&fetched(
                    3,
                    13,
                    "BODY[HEADER.FIELDS (MESSAGE-ID IN-REPLY-TO REFERENCES SUBJECT)]",
                    "Message-ID: <y@x>\r\nReferences: <m12@x>\r\nSubject: You won\r\n\r\n",
                )),
            ),
            ("UID SEARCH", done("* SEARCH 12 13\r\n")),
            (
                "UID FETCH 13,12 (UID FLAGS INTERNALDATE BODY.PEEK[HEADER] BODY.PEEK[TEXT]<0.8192>)",
                done(&(fetched_row(2, 13, outsider) + &fetched_row(3, 12, &mail("m12@x", "Plan")))),
            ),
        ]);
        let (result, seen) = round(rules, "1700:100").await;
        let Ok(Sync::Changed {
            mut threads,
            removed,
            ..
        }) = result
        else {
            panic!("{result:?}");
        };
        assert!(removed.is_empty(), "{removed:?}");
        threads.sort_by(|a, b| a.subject.cmp(&b.subject));
        let rows: Vec<(&str, &str)> = threads
            .iter()
            .map(|t| (t.id.as_str(), t.subject.as_str()))
            .collect();
        let (plan, won) = (thread_id("m12@x"), thread_id("y@x"));
        assert_eq!(rows, [(plan.as_str(), "Plan"), (won.as_str(), "You won")]);
        assert!(!seen.iter().any(|l| l.contains("BODY.PEEK[]")), "{seen:?}");
        assert_never_writes(&seen);
    }

    #[tokio::test]
    async fn a_changed_mail_whose_thread_is_no_longer_found_takes_that_thread_out() {
        let mut rules = rules_with("* 3 FETCH (UID 12 MODSEQ (125))\r\n");
        rules.extend([
            (
                "EXAMINE",
                "* 3 EXISTS\r\n* OK [UIDVALIDITY 1700] ok\r\n{tag} OK [READ-ONLY] done\r\n"
                    .to_owned(),
            ),
            (
                "HEADER.FIELDS",
                done(&fetched(
                    3,
                    12,
                    "BODY[HEADER.FIELDS (MESSAGE-ID IN-REPLY-TO REFERENCES)]",
                    "Message-ID: <m12@x>\r\n\r\n",
                )),
            ),
            ("UID SEARCH", done("* SEARCH\r\n")),
        ]);
        let (result, _) = round(rules, "1700:100").await;
        assert_eq!(
            result,
            Ok(Sync::Changed {
                threads: Vec::new(),
                removed: vec![thread_id("m12@x")],
                history_id: "1700:130".into()
            })
        );
    }

    #[tokio::test]
    async fn changes_that_show_nothing_only_move_the_position_and_read_no_thread() {
        let (result, seen) = round(rules_with(""), "1700:100").await;
        assert_eq!(
            result,
            Ok(Sync::Changed {
                threads: Vec::new(),
                removed: Vec::new(),
                history_id: "1700:130".into()
            })
        );
        assert!(!seen.iter().any(|l| l.contains("EXAMINE")), "{seen:?}");
    }

    /// The rules of a round that goes on to read the inbox again.
    fn reload_rules(changed: &str) -> Rules {
        let mut rules = rules_with(changed);
        rules.extend(inbox_rules());
        rules
    }

    fn assert_reloaded(result: Result<Sync, String>) {
        let Ok(Sync::Reloaded {
            threads,
            history_id,
        }) = result
        else {
            panic!("{result:?}");
        };
        assert_eq!(history_id, "1700:130");
        assert_eq!(threads.len(), 1);
        assert_eq!(threads[0].id, thread_id("m12@x"));
    }

    #[tokio::test]
    async fn a_vanished_mail_reads_the_inbox_again() {
        let (result, seen) = round(reload_rules("* VANISHED (EARLIER) 5:6\r\n"), "1700:100").await;
        assert_reloaded(result);
        assert!(
            !seen.iter().any(|l| l.contains("HEADER.FIELDS")),
            "{seen:?}"
        );
        assert_never_writes(&seen);
    }

    #[tokio::test]
    async fn a_new_uidvalidity_reads_the_inbox_again_without_asking_for_a_difference() {
        let (result, seen) = round(reload_rules(""), "1600:100").await;
        assert_reloaded(result);
        assert!(!seen.iter().any(|l| l.contains("CHANGEDSINCE")), "{seen:?}");
    }

    #[tokio::test]
    async fn a_position_that_is_none_reads_the_inbox_again_and_gives_the_real_one() {
        let (result, _) = round(reload_rules(""), "").await;
        assert_reloaded(result);
    }

    #[tokio::test]
    async fn more_changed_mails_than_the_limit_read_the_inbox_again() {
        let many: String = (1..=MAX_CHANGED as u32 + 1)
            .map(|uid| format!("* {uid} FETCH (UID {uid} MODSEQ (125))\r\n"))
            .collect();
        let (result, seen) = round(reload_rules(&many), "1700:100").await;
        assert_reloaded(result);
        assert!(
            !seen.iter().any(|l| l.contains("HEADER.FIELDS")),
            "{seen:?}"
        );
    }

    #[tokio::test]
    async fn an_inbox_without_a_highest_modseq_is_an_error_not_a_guess() {
        let rules = vec![
            ("ENABLE", ENABLE.to_owned()),
            ("SELECT", select(1700, None)),
        ];
        let (result, _) = round(rules, "1700:100").await;
        assert!(result.unwrap_err().contains("HIGHESTMODSEQ"));
    }
}
