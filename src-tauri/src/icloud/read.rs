//! Reading the mail of an iCloud account over an IMAP session that is logged in (M-13): the inbox as a list of threads, and one thread.
//! Every read is `EXAMINE` (read-only) and `BODY.PEEK`, so that reading changes nothing on iCloud: a mail that is only opened stays unread.

use std::{collections::HashSet, fmt};

use async_imap::{error::Error, types::Flag, Session};
use futures_util::TryStreamExt;
use mail_parser::MessageParser;
use tokio::io::{AsyncRead, AsyncWrite};

use super::{
    message::{node, parse, thread_detail, thread_item, Folder, Mail, Raw},
    threading::{group, key_of, made_up_parts, thread_id, valid_key, Node},
};
use crate::gmail::{ThreadDetail, ThreadItem};

/// The newest mails of the inbox that the list is made of (Gmail's `maxResults`).
const INBOX_LIMIT: u32 = 50;
/// How many of the newest mails of the sent folder are looked at for the replies to the threads of the list.
const SENT_WINDOW: u32 = 100;
/// How many searches follow the replies of a thread: each one looks for the mails that name the mails the last one found.
const ROUNDS: usize = 3;
/// How many Message-IDs one search asks for, and how many mails one thread takes.
const IDS_PER_ROUND: usize = 20;
const MAX_THREAD_MAILS: usize = 200;

/// The whole mail with its flags and time.
const FULL: &str = "(UID FLAGS INTERNALDATE BODY.PEEK[])";
/// Only what threads need.
pub(super) const HEADERS: &str =
    "(UID INTERNALDATE BODY.PEEK[HEADER.FIELDS (MESSAGE-ID IN-REPLY-TO REFERENCES)])";

pub trait Io: AsyncRead + AsyncWrite + Unpin + Send + fmt::Debug {}
impl<T: AsyncRead + AsyncWrite + Unpin + Send + fmt::Debug> Io for T {}

pub(super) fn failed(e: Error) -> String {
    format!("iCloud のメールを読めません: {e}")
}

/// The folder opened read-only; `None` when iCloud has no such folder.
async fn examine<S: Io>(
    session: &mut Session<S>,
    folder: Folder,
) -> Result<Option<async_imap::types::Mailbox>, String> {
    match session.examine(folder.name()).await {
        Ok(mailbox) => Ok(Some(mailbox)),
        Err(Error::No(_)) => Ok(None),
        Err(e) => Err(failed(e)),
    }
}

/// What a FETCH said of one mail; `None` when it carries no UID or no bytes.
fn raw_of(folder: Folder, validity: u32, fetch: &async_imap::types::Fetch) -> Option<Raw> {
    Some(Raw {
        folder,
        uid: fetch.uid?,
        validity,
        seen: fetch.flags().any(|f| f == Flag::Seen),
        date_ms: fetch.internal_date().map_or(0, |d| d.timestamp_millis()),
        bytes: fetch.body().or_else(|| fetch.header())?.to_vec(),
    })
}

/// The mails of `set` in the folder that is open: message numbers, or UIDs when `by_uid`.
pub(super) async fn fetch<S: Io>(
    session: &mut Session<S>,
    folder: Folder,
    validity: u32,
    set: &str,
    by_uid: bool,
    query: &str,
) -> Result<Vec<Raw>, String> {
    let fetches: Vec<_> = if by_uid {
        session
            .uid_fetch(set, query)
            .await
            .map_err(failed)?
            .try_collect()
            .await
            .map_err(failed)?
    } else {
        session
            .fetch(set, query)
            .await
            .map_err(failed)?
            .try_collect()
            .await
            .map_err(failed)?
    };
    Ok(fetches
        .iter()
        .filter_map(|f| raw_of(folder, validity, f))
        .collect())
}

pub(super) fn uid_set(uids: &[u32]) -> String {
    uids.iter()
        .map(u32::to_string)
        .collect::<Vec<_>>()
        .join(",")
}

pub(super) fn nodes_of(parser: &MessageParser, raws: &[Raw]) -> Vec<Node> {
    raws.iter().map(|r| node(r, &parse(parser, r))).collect()
}

/// The threads of the newest mails of the inbox, newest first, each with the mails of the sent folder that belong to it.
pub async fn inbox_threads<S: Io>(
    session: &mut Session<S>,
    account: &str,
) -> Result<Vec<ThreadItem>, String> {
    let Some(inbox) = examine(session, Folder::Inbox).await? else {
        return Ok(Vec::new());
    };
    if inbox.exists == 0 {
        return Ok(Vec::new());
    }
    let first = inbox.exists.saturating_sub(INBOX_LIMIT - 1).max(1);
    let mut mails = fetch(
        session,
        Folder::Inbox,
        inbox.uid_validity.unwrap_or(0),
        &format!("{first}:{}", inbox.exists),
        false,
        FULL,
    )
    .await?;
    let in_inbox = mails.len();
    if let Some(sent) = examine(session, Folder::Sent)
        .await?
        .filter(|s| s.exists > 0)
    {
        let validity = sent.uid_validity.unwrap_or(0);
        let first = sent.exists.saturating_sub(SENT_WINDOW - 1).max(1);
        let headers = fetch(
            session,
            Folder::Sent,
            validity,
            &format!("{first}:{}", sent.exists),
            false,
            HEADERS,
        )
        .await?;
        let parser = MessageParser::new();
        let all: Vec<Raw> = mails.iter().cloned().chain(headers).collect();
        let nodes = nodes_of(&parser, &all);
        let replies: Vec<u32> = group(&nodes)
            .iter()
            .filter(|g| g.members.iter().any(|&i| i < in_inbox))
            .flat_map(|g| {
                g.members
                    .iter()
                    .filter(|&&i| i >= in_inbox)
                    .map(|&i| all[i].uid)
            })
            .collect();
        if !replies.is_empty() {
            mails.extend(
                fetch(
                    session,
                    Folder::Sent,
                    validity,
                    &uid_set(&replies),
                    true,
                    FULL,
                )
                .await?,
            );
        }
    }
    Ok(list_items(account, &mails, in_inbox))
}

/// The rows for the threads that hold one of the first `in_inbox` mails of `mails`, newest first.
fn list_items(account: &str, mails: &[Raw], in_inbox: usize) -> Vec<ThreadItem> {
    let parser = MessageParser::new();
    let parsed: Vec<Mail> = mails
        .iter()
        .map(|raw| Mail {
            raw,
            msg: parse(&parser, raw),
        })
        .collect();
    let nodes: Vec<Node> = parsed.iter().map(|m| node(m.raw, &m.msg)).collect();
    let mut items: Vec<ThreadItem> = group(&nodes)
        .into_iter()
        .filter(|g| g.members.iter().any(|&i| i < in_inbox))
        .map(|g| {
            let members: Vec<&Mail> = g.members.iter().map(|&i| &parsed[i]).collect();
            thread_item(account, thread_id(&g.key), &members)
        })
        .collect();
    items.sort_by_key(|i| std::cmp::Reverse(i.date_ms));
    items
}

fn quote(id: &str) -> String {
    format!("\"{}\"", id.replace('\\', "\\\\").replace('"', "\\\""))
}

/// `OR` takes two keys, so a list of n keys is n-1 `OR`s written ahead of them.
fn any_of(criteria: &[String]) -> String {
    match criteria {
        [] => "ALL".to_owned(),
        [one] => one.clone(),
        [first, rest @ ..] => format!("OR {first} {}", any_of(rest)),
    }
}

/// The search for the mails that are one of `ids` or name one of them. A header search matches a part of the value, so what it finds is checked again by `threads`.
fn search_for(ids: &[String]) -> String {
    let criteria: Vec<String> = ids
        .iter()
        .filter(|id| valid_key(id))
        .flat_map(|id| {
            ["Message-ID", "References", "In-Reply-To"].map(|h| format!("HEADER {h} {}", quote(id)))
        })
        .collect();
    any_of(&criteria)
}

/// The mails of the thread whose root key is `key`, from the inbox and the sent folder: the ones that are it or name it, then the ones that name those, a few rounds deep.
/// What comes back may hold mails of other threads that a search matched by chance; `thread` picks the thread out.
pub async fn thread_mails<S: Io>(session: &mut Session<S>, key: &str) -> Result<Vec<Raw>, String> {
    if let Some((tag, validity, uid)) = made_up_parts(key) {
        // A mail with no Message-ID is a thread by itself, found by its place; a UIDVALIDITY that changed makes the place mean another mail.
        let folder = Folder::of_tag(tag).ok_or("スレッド ID が不正です")?;
        let mailbox = examine(session, folder).await?;
        let same = mailbox.filter(|m| m.uid_validity == Some(validity));
        return match same {
            Some(_) => fetch(session, folder, validity, &uid.to_string(), true, FULL).await,
            None => Ok(Vec::new()),
        };
    }
    let parser = MessageParser::new();
    let mut mails: Vec<Raw> = Vec::new();
    let mut asked: HashSet<String> = HashSet::new();
    let mut frontier = vec![key.to_owned()];
    for _ in 0..ROUNDS {
        frontier.truncate(IDS_PER_ROUND);
        if frontier.is_empty() {
            break;
        }
        asked.extend(frontier.iter().cloned());
        let query = search_for(&frontier);
        for folder in [Folder::Inbox, Folder::Sent] {
            let Some(mailbox) = examine(session, folder).await?.filter(|m| m.exists > 0) else {
                continue;
            };
            let found = session.uid_search(&query).await.map_err(failed)?;
            let mut new: Vec<u32> = found
                .into_iter()
                .filter(|u| !mails.iter().any(|m| m.folder == folder && m.uid == *u))
                .collect();
            // Past the limit the newest stay: a thread that long is read from its end.
            new.sort_unstable_by(|a, b| b.cmp(a));
            new.truncate(MAX_THREAD_MAILS.saturating_sub(mails.len()));
            if new.is_empty() {
                continue;
            }
            let validity = mailbox.uid_validity.unwrap_or(0);
            mails.extend(fetch(session, folder, validity, &uid_set(&new), true, FULL).await?);
        }
        let mut next: Vec<String> = Vec::new();
        for n in nodes_of(&parser, &mails) {
            if valid_key(&n.own)
                && made_up_parts(&n.own).is_none()
                && !asked.contains(&n.own)
                && !next.contains(&n.own)
            {
                next.push(n.own);
            }
        }
        frontier = next;
    }
    Ok(mails)
}

/// The thread that `key` names among `mails` (from `thread_mails`), made into what the screen draws by `make`, which is given the thread's ID and its mails, oldest first.
/// `None` when none of the mails belongs to it.
pub(super) fn with_thread<T>(
    key: &str,
    mails: &[Raw],
    make: impl FnOnce(String, &[&Mail]) -> T,
) -> Option<T> {
    let parser = MessageParser::new();
    let parsed: Vec<Mail> = mails
        .iter()
        .map(|raw| Mail {
            raw,
            msg: parse(&parser, raw),
        })
        .collect();
    let nodes: Vec<Node> = parsed.iter().map(|m| node(m.raw, &m.msg)).collect();
    let found = group(&nodes)
        .into_iter()
        .find(|g| g.members.iter().any(|&i| nodes[i].belongs_to(key)))?;
    let members: Vec<&Mail> = found.members.iter().map(|&i| &parsed[i]).collect();
    Some(make(thread_id(&found.key), &members))
}

/// The thread `id` (as `inbox_threads` made it) as the screen draws it, from the mails `thread_mails` found. `None` when none of them belongs to it.
pub fn thread(id: &str, account: &str, mails: &[Raw], prefer_plain: bool) -> Option<ThreadDetail> {
    let key = key_of(id)?;
    with_thread(&key, mails, |_, members| {
        thread_detail(account, members, prefer_plain)
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::icloud::{login_session, threading::made_up_key};
    use tokio::{
        io::{AsyncBufReadExt, AsyncWriteExt, BufReader},
        net::{TcpListener, TcpStream},
        task::JoinHandle,
    };

    /// A mail of the fake server: its UID, flags, INTERNALDATE and bytes.
    struct Stored {
        uid: u32,
        flags: &'static str,
        date: &'static str,
        raw: String,
    }

    struct Box {
        name: &'static str,
        validity: u32,
        mails: Vec<Stored>,
    }

    fn mail(
        id: Option<&str>,
        refs: &[&str],
        from: &str,
        to: &str,
        subject: &str,
        body: &str,
    ) -> String {
        let mut text = String::new();
        if let Some(id) = id {
            text += &format!("Message-ID: <{id}>\r\n");
        }
        if let Some(first) = refs.first() {
            let all: Vec<String> = refs.iter().map(|r| format!("<{r}>")).collect();
            text += &format!(
                "References: {}\r\nIn-Reply-To: <{first}>\r\n",
                all.join(" ")
            );
        }
        text + &format!("From: {from}\r\nTo: {to}\r\nSubject: {subject}\r\nContent-Type: text/plain; charset=utf-8\r\n\r\n{body}\r\n")
    }

    /// The numbers of a set such as `3:5` or `7,9`.
    fn numbers(set: &str) -> Vec<u32> {
        set.split(',')
            .flat_map(|part| match part.split_once(':') {
                Some((a, b)) => (a.parse().unwrap()..=b.parse().unwrap()).collect::<Vec<u32>>(),
                None => vec![part.parse().unwrap()],
            })
            .collect()
    }

    /// The strings between double quotes of an IMAP command, unescaped.
    fn quoted(command: &str) -> Vec<String> {
        let (mut out, mut current, mut inside, mut escaped) =
            (Vec::new(), String::new(), false, false);
        for c in command.chars() {
            match (inside, escaped, c) {
                (false, _, '"') => inside = true,
                (true, false, '\\') => escaped = true,
                (true, false, '"') => {
                    inside = false;
                    out.push(std::mem::take(&mut current));
                }
                (true, _, c) => {
                    escaped = false;
                    current.push(c);
                }
                _ => {}
            }
        }
        out
    }

    /// A server of one connection with the mailboxes `boxes`, that speaks the few commands the reading uses. What it was sent is the value of the join handle.
    async fn serve(boxes: Vec<Box>) -> (TcpStream, JoinHandle<Vec<String>>) {
        let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
        let addr = listener.local_addr().unwrap();
        let server = tokio::spawn(async move {
            let (stream, _) = listener.accept().await.unwrap();
            let (read, mut write) = stream.into_split();
            write.write_all(b"* OK IMAP ready\r\n").await.unwrap();
            let mut lines = BufReader::new(read).lines();
            let (mut seen, mut open) = (Vec::new(), None::<usize>);
            while let Some(line) = lines.next_line().await.unwrap() {
                seen.push(line.clone());
                let (tag, rest) = line.split_once(' ').unwrap();
                let (command, args) = rest.split_once(' ').unwrap_or((rest, ""));
                let mut reply = String::new();
                match command {
                    "LOGIN" => reply += &format!("{tag} OK Logged in\r\n"),
                    "EXAMINE" => match boxes.iter().position(|b| quoted(args) == [b.name]) {
                        Some(n) => {
                            open = Some(n);
                            let b = &boxes[n];
                            reply += &format!(
                                "* {} EXISTS\r\n* OK [UIDVALIDITY {}] ok\r\n{tag} OK [READ-ONLY] done\r\n",
                                b.mails.len(),
                                b.validity
                            );
                        }
                        None => reply += &format!("{tag} NO no such mailbox\r\n"),
                    },
                    "FETCH" | "UID" if args.starts_with("FETCH") || command == "FETCH" => {
                        let args = args.strip_prefix("FETCH ").unwrap_or(args);
                        let (set, query) = args.split_once(' ').unwrap();
                        let b = &boxes[open.unwrap()];
                        let wanted = numbers(set);
                        for (i, m) in b.mails.iter().enumerate() {
                            let key = if command == "UID" {
                                m.uid
                            } else {
                                i as u32 + 1
                            };
                            if !wanted.contains(&key) {
                                continue;
                            }
                            let head_end = m.raw.find("\r\n\r\n").unwrap() + 4;
                            let (section, data) = if query.contains("HEADER.FIELDS") {
                                (
                                    "BODY[HEADER.FIELDS (MESSAGE-ID IN-REPLY-TO REFERENCES)]",
                                    &m.raw[..head_end],
                                )
                            } else {
                                ("BODY[]", &m.raw[..])
                            };
                            let flags = if query.contains("FLAGS") {
                                format!(" FLAGS ({})", m.flags)
                            } else {
                                String::new()
                            };
                            reply += &format!(
                                "* {} FETCH (UID {}{flags} INTERNALDATE \"{}\" {section} {{{}}}\r\n{data})\r\n",
                                i + 1,
                                m.uid,
                                m.date,
                                data.len()
                            );
                        }
                        reply += &format!("{tag} OK Fetch completed\r\n");
                    }
                    "UID" => {
                        // UID SEARCH: a mail matches when one of the quoted strings is in its header.
                        let b = &boxes[open.unwrap()];
                        let needles = quoted(args);
                        let hits: Vec<String> = b
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
            seen
        });
        (TcpStream::connect(addr).await.unwrap(), server)
    }

    const ALICE: &str = "Alice <alice@example.com>";
    const ME: &str = "me@icloud.com";

    /// A root mail in the inbox, my reply in the sent folder, Alice's answer to both, a later answer that names only hers, an unrelated mail with no Message-ID, and an unrelated sent mail.
    fn boxes() -> Vec<Box> {
        let inbox = vec![
            Stored {
                uid: 10,
                flags: "\\Seen",
                date: "27-Nov-2026 10:00:00 +0900",
                raw: mail(Some("root@x"), &[], ALICE, ME, "Plan", "first"),
            },
            Stored {
                uid: 11,
                flags: "",
                date: "27-Nov-2026 12:00:00 +0900",
                raw: mail(
                    Some("a2@x"),
                    &["root@x", "mine@icloud"],
                    ALICE,
                    ME,
                    "Re: Plan",
                    "it's <b>fine</b> & done",
                ),
            },
            Stored {
                uid: 12,
                flags: "",
                date: "27-Nov-2026 13:00:00 +0900",
                raw: mail(None, &[], "Bob <bob@example.com>", ME, "Lunch", "noon?"),
            },
            Stored {
                uid: 13,
                flags: "",
                date: "27-Nov-2026 14:00:00 +0900",
                raw: mail(
                    Some("a3@x"),
                    &["a2@x"],
                    ALICE,
                    ME,
                    "Re: Re: Plan",
                    "last word",
                ),
            },
        ];
        let sent = vec![
            Stored {
                uid: 5,
                flags: "\\Seen",
                date: "27-Nov-2026 11:00:00 +0900",
                raw: mail(
                    Some("mine@icloud"),
                    &["root@x"],
                    ME,
                    ALICE,
                    "Re: Plan",
                    "my answer",
                ),
            },
            Stored {
                uid: 6,
                flags: "\\Seen",
                date: "26-Nov-2026 09:00:00 +0900",
                raw: mail(
                    Some("other@icloud"),
                    &[],
                    ME,
                    "carol@example.com",
                    "Unrelated",
                    "hi",
                ),
            },
        ];
        vec![
            Box {
                name: "INBOX",
                validity: 1700,
                mails: inbox,
            },
            Box {
                name: "Sent Messages",
                validity: 1800,
                mails: sent,
            },
        ]
    }

    /// The commands a read must never send: nothing marks a mail, moves it, or deletes it, and a read is never a plain `BODY[`.
    fn assert_read_only(seen: &[String]) {
        for line in seen {
            for forbidden in ["SELECT", "STORE", "COPY", "EXPUNGE", "APPEND", "MOVE"] {
                assert!(!line.contains(forbidden), "{line}");
            }
            assert!(!line.contains("BODY["), "BODY[ without PEEK: {line}");
        }
    }

    #[tokio::test]
    async fn the_list_has_a_row_for_each_thread_with_the_replies_of_the_sent_folder_in_it() {
        let (stream, server) = serve(boxes()).await;
        let mut session = login_session(stream, ME, "pw").await.unwrap();
        let items = inbox_threads(&mut session, ME).await.unwrap();
        let _ = session.logout().await;
        let seen = server.await.unwrap();

        assert_eq!(items.len(), 2, "{items:?}");
        // Newest first: the thread of the plan has Alice's last answer (14:00), the lunch mail has 13:00.
        let plan = &items[0];
        assert_eq!(plan.id, thread_id("root@x"));
        assert_eq!(plan.account, ME);
        assert_eq!(plan.subject, "Plan");
        assert_eq!(plan.from_name, "Alice");
        assert_eq!(plan.from_address, "alice@example.com");
        assert_eq!(plan.snippet, "last word");
        assert!(plan.unread);
        let lunch = &items[1];
        assert_eq!(lunch.id, thread_id(&made_up_key("i", 1700, 12)));
        assert_eq!(
            (lunch.subject.as_str(), lunch.from_name.as_str()),
            ("Lunch", "Bob")
        );

        assert_read_only(&seen);
        assert!(
            seen.iter().any(|l| l.contains("EXAMINE \"INBOX\"")),
            "{seen:?}"
        );
        // The whole inbox is asked for by number, newest 50 of 4 mails: 1:4.
        assert!(
            seen.iter()
                .any(|l| l.contains("FETCH 1:4 (UID FLAGS INTERNALDATE BODY.PEEK[])")),
            "{seen:?}"
        );
        // Of the sent folder only the headers of its window, and then the reply of the thread (UID 5), never the unrelated mail (UID 6).
        assert!(
            seen.iter()
                .any(|l| l.contains("FETCH 1:2 (UID INTERNALDATE BODY.PEEK[HEADER.FIELDS")),
            "{seen:?}"
        );
        let full: Vec<&String> = seen.iter().filter(|l| l.contains("UID FETCH")).collect();
        assert_eq!(full.len(), 1, "{seen:?}");
        assert!(
            full[0].contains("UID FETCH 5 (UID FLAGS INTERNALDATE BODY.PEEK[])"),
            "{}",
            full[0]
        );
    }

    #[tokio::test]
    async fn the_snippet_of_a_row_is_escaped_as_gmails_is() {
        let mut b = boxes();
        b[0].mails.truncate(2);
        b[0].mails[1].uid = 11;
        let (stream, server) = serve(b).await;
        let mut session = login_session(stream, ME, "pw").await.unwrap();
        let items = inbox_threads(&mut session, ME).await.unwrap();
        let _ = session.logout().await;
        server.await.unwrap();
        assert_eq!(items.len(), 1);
        assert_eq!(
            items[0].snippet,
            "it&#39;s &lt;b&gt;fine&lt;/b&gt; &amp; done"
        );
    }

    #[tokio::test]
    async fn an_empty_inbox_is_an_empty_list_and_a_missing_sent_folder_is_no_error() {
        let (stream, server) = serve(vec![Box {
            name: "INBOX",
            validity: 1,
            mails: vec![],
        }])
        .await;
        let mut session = login_session(stream, ME, "pw").await.unwrap();
        assert!(inbox_threads(&mut session, ME).await.unwrap().is_empty());
        let _ = session.logout().await;
        server.await.unwrap();

        let mut b = boxes();
        b.pop();
        let (stream, server) = serve(b).await;
        let mut session = login_session(stream, ME, "pw").await.unwrap();
        assert_eq!(inbox_threads(&mut session, ME).await.unwrap().len(), 2);
        let _ = session.logout().await;
        server.await.unwrap();
    }

    #[tokio::test]
    async fn a_thread_is_found_by_its_root_and_followed_through_the_replies_of_the_replies() {
        let (stream, server) = serve(boxes()).await;
        let mut session = login_session(stream, ME, "pw").await.unwrap();
        let mails = thread_mails(&mut session, "root@x").await.unwrap();
        let _ = session.logout().await;
        let seen = server.await.unwrap();
        assert_read_only(&seen);

        let id = thread_id("root@x");
        let detail = thread(&id, ME, &mails, false).unwrap();
        assert_eq!(detail.subject, "Plan");
        assert!(detail.unread);
        // Root, my reply, Alice's answer, and the answer that names only Alice's (found in the second round): oldest first. Not the unrelated mails.
        let bodies: Vec<&str> = detail.messages.iter().map(|m| m.body.trim()).collect();
        assert_eq!(
            bodies,
            ["first", "my answer", "it's <b>fine</b> & done", "last word"]
        );
        assert!(detail.messages.iter().all(|m| !m.html && !m.authenticated));
        assert_eq!(detail.messages[0].id, "i-1700-10");
        assert_eq!(detail.messages[1].id, "s-1800-5");
        assert_eq!(detail.messages[0].to_label, "To 自分");
        assert!(detail.pending_images.is_empty());
        // A reply goes to the sender of the latest mail.
        assert_eq!(detail.reply.one.to[0].label, "Alice");
        // A thread that none of the mails belongs to is not one.
        assert!(thread(&thread_id("nothing@x"), ME, &mails, false).is_none());
        assert!(thread("not hex", ME, &mails, false).is_none());
    }

    #[tokio::test]
    async fn a_mail_with_no_message_id_is_a_thread_by_its_place_and_a_changed_validity_finds_nothing(
    ) {
        let key = made_up_key("i", 1700, 12);
        let (stream, server) = serve(boxes()).await;
        let mut session = login_session(stream, ME, "pw").await.unwrap();
        let mails = thread_mails(&mut session, &key).await.unwrap();
        let detail = thread(&thread_id(&key), ME, &mails, true).unwrap();
        assert_eq!(detail.subject, "Lunch");
        assert_eq!(detail.messages.len(), 1);

        let stale = made_up_key("i", 1699, 12);
        assert!(thread_mails(&mut session, &stale).await.unwrap().is_empty());
        let _ = session.logout().await;
        assert_read_only(&server.await.unwrap());
    }

    #[test]
    fn a_search_names_each_id_in_the_three_headers_between_quotes_with_the_escapes() {
        let query = search_for(&["a@x".to_owned()]);
        assert_eq!(
            query,
            r#"OR HEADER Message-ID "a@x" OR HEADER References "a@x" HEADER In-Reply-To "a@x""#
        );
        let two = search_for(&["a@x".to_owned(), "b@x".to_owned()]);
        assert_eq!(two.matches("OR ").count(), 5, "{two}");
        assert_eq!(quote(r#"a"b\c"#), r#""a\"b\\c""#);
        // An id that cannot be written safely is left out; with none left the search is for every mail.
        assert_eq!(search_for(&["a b".to_owned(), "é".to_owned()]), "ALL");
    }
}
