//! Sending a mail from an iCloud account (M-13, #1577): the message that `mail_send.rs` builds for Gmail, over SMTP to `smtp.mail.me.com:587` (STARTTLS) with the App-specific password, with `lettre`.
//! A reply takes its `In-Reply-To` and `References` from the thread as `read.rs` reads it (the Message-ID of its newest mail).
//! After the mail has gone, the sent folder is searched for it by its Message-ID, and the mail is appended only when it is not there: whether iCloud keeps what SMTP sends was not known, and either way one copy is left.
//! The password is read from the keychain, passed only to the SMTP login, and never put in an error text.

use std::time::Duration;

use async_imap::{error::Error, Session};
use chrono::{DateTime, Utc};
use lettre::{
    address::Envelope,
    transport::smtp::{
        authentication::Credentials,
        client::{Tls, TlsParameters},
    },
    Address, AsyncSmtpTransport, AsyncTransport, Tokio1Executor,
};

use super::{
    blocking, close,
    message::{Folder, Mail},
    open,
    read::{failed, quote, thread_mails_in, with_thread, Io, HEADERS},
    read_timeout, threading, KEYRING_SERVICE, READ_TIMEOUT,
};
use crate::{
    gmail::{log_failure, ApiError},
    keychain,
    mail_send::{
        check, envelope_addresses, render_smtp, threading_headers, OutgoingMail, ReplyHeaders,
        SmtpHeaders,
    },
};

const SMTP_HOST: &str = "smtp.mail.me.com";
const SMTP_PORT: u16 = 587;
/// What iCloud's SMTP says it takes of one message (`SIZE` of its EHLO, checked on a real account on 2026-11-28).
pub const MESSAGE_LIMIT: u64 = 28_319_744;
/// The total of the files that fits: base64 turns 3 bytes into 4 characters, and the lines of 76 characters carry a line break (2 bytes) each.
/// The text and the headers come on top, so the size of the whole message is checked again when it is built.
pub const ATTACHMENTS_LIMIT: u64 = MESSAGE_LIMIT / 78 * 76 / 4 * 3;
/// One SMTP command (lettre's own timer), and the whole send.
const COMMAND_TIMEOUT: Duration = Duration::from_secs(60);
const SEND_TIMEOUT: Duration = Duration::from_secs(180);
/// What the search of the sent folder and the append of the copy may take.
const COPY_TIMEOUT: Duration = Duration::from_secs(30);

/// Why SMTP did not take the mail. A refusal of the login is the server's 535; anything else says nothing about the password.
#[derive(Debug, PartialEq, Eq)]
enum SmtpError {
    Rejected,
    Failed(String),
}

fn classify(e: &lettre::transport::smtp::Error) -> SmtpError {
    if e.status().map(u16::from) == Some(535) {
        SmtpError::Rejected
    } else if e.is_timeout() {
        SmtpError::Failed("iCloud への接続がタイムアウトしました".into())
    } else if e.is_permanent() {
        SmtpError::Failed(format!("iCloud が送信を断りました: {e}"))
    } else {
        SmtpError::Failed(format!("iCloud にメールを送れません: {e}"))
    }
}

/// The SMTP client of `user` to `host`; `tls` is `Required` (STARTTLS, no login before it) for iCloud, and `None` for a server of the tests.
fn transport(
    host: &str,
    port: u16,
    tls: Tls,
    user: &str,
    password: &str,
) -> AsyncSmtpTransport<Tokio1Executor> {
    AsyncSmtpTransport::<Tokio1Executor>::builder_dangerous(host)
        .port(port)
        .tls(tls)
        .credentials(Credentials::new(user.to_owned(), password.to_owned()))
        .timeout(Some(COMMAND_TIMEOUT))
        .build()
}

fn icloud_transport(
    user: &str,
    password: &str,
) -> Result<AsyncSmtpTransport<Tokio1Executor>, String> {
    let tls = TlsParameters::new(SMTP_HOST.into())
        .map_err(|e| format!("iCloud への接続を準備できません: {e}"))?;
    Ok(transport(
        SMTP_HOST,
        SMTP_PORT,
        Tls::Required(tls),
        user,
        password,
    ))
}

/// Hands `message` to the server, from `envelope.from` to every address of the envelope.
async fn deliver(
    transport: &AsyncSmtpTransport<Tokio1Executor>,
    envelope: &Envelope,
    message: &[u8],
) -> Result<(), SmtpError> {
    transport
        .send_raw(envelope, message)
        .await
        .map(|_| ())
        .map_err(|e| classify(&e))
}

fn envelope(from: &str, to: &[String]) -> Result<Envelope, String> {
    let address = |a: &str| {
        a.parse::<Address>()
            .map_err(|_| format!("宛先の形式が正しくありません: {a}"))
    };
    let to = to
        .iter()
        .map(|a| address(a))
        .collect::<Result<Vec<_>, _>>()?;
    Envelope::new(Some(address(from)?), to).map_err(|e| format!("宛先を決められません: {e}"))
}

/// The `Date` and the `Message-ID` of a mail that goes out at `now`: the ID is the 16 bytes `random` in hexadecimal, at the domain of the sender.
fn smtp_headers(account: &str, random: [u8; 16], now: DateTime<Utc>) -> SmtpHeaders {
    let domain = account.rsplit('@').next().unwrap_or("localhost");
    let id: String = random.iter().map(|b| format!("{b:02x}")).collect();
    SmtpHeaders {
        message_id: format!("<{id}@{domain}>"),
        date: now.to_rfc2822(),
    }
}

/// A message that is over what the server takes is refused here, before it is sent.
fn check_size(bytes: usize) -> Result<(), String> {
    if bytes as u64 > MESSAGE_LIMIT {
        return Err(format!(
            "メールが大きすぎます（iCloud の上限は {} MB です）",
            MESSAGE_LIMIT / 1024 / 1024
        ));
    }
    Ok(())
}

/// The headers of a reply to the newest mail of the thread (`mails`, oldest first): its Message-ID, and its References followed by it.
fn reply_headers_of(mails: &[&Mail]) -> Result<ReplyHeaders, String> {
    let last = mails.last().ok_or("返信先のメッセージがありません")?;
    let id = last.msg.message_id().map(|id| format!("<{id}>"));
    let references: Vec<String> = last
        .msg
        .references()
        .into_iter()
        .flat_map(|l| l.iter())
        .map(|r| format!("<{r}>"))
        .collect();
    threading_headers(id.as_deref(), Some(&references.join(" ")))
}

/// The headers of a reply to the thread `id` of `address`, read from the mails of the thread. `Ok(None)` means the password must be entered again.
async fn reply_headers(address: &str, id: &str) -> Result<Option<ReplyHeaders>, ApiError> {
    let key = threading::key_of(id).ok_or("スレッド ID が不正です")?;
    let Some(mut session) = open(address).await? else {
        return Ok(None);
    };
    let read = tokio::time::timeout(
        READ_TIMEOUT,
        thread_mails_in(&mut session, &key, &[Folder::Inbox, Folder::Sent], HEADERS),
    )
    .await;
    close(session).await;
    let mails = read.map_err(|_| read_timeout())??;
    let headers = with_thread(&key, &mails, |_, members| reply_headers_of(members))
        .ok_or("スレッドが見つかりません")??;
    Ok(Some(headers))
}

/// Leaves the mail in the sent folder, unless iCloud has put it there: the folder is searched for the Message-ID, and the mail is appended (read) when it is not found.
async fn keep_copy<S: Io>(
    session: &mut Session<S>,
    message_id: &str,
    message: &[u8],
) -> Result<(), String> {
    match session.examine(Folder::Sent.name()).await {
        Ok(_) => {
            let query = format!("HEADER Message-ID {}", quote(message_id));
            if !session.uid_search(&query).await.map_err(failed)?.is_empty() {
                return Ok(());
            }
        }
        // No such folder: the append says so.
        Err(Error::No(_)) => {}
        Err(e) => return Err(failed(e)),
    }
    session
        .append(Folder::Sent.name(), Some("(\\Seen)"), None, message)
        .await
        .map_err(|e| format!("iCloud の送信済みに写せません: {e}"))
}

/// The copy after a send. The mail has gone by then, so a failure here is only logged and never makes the send fail.
async fn keep_copy_of(address: &str, message_id: &str, message: &[u8]) {
    let copied = async {
        let Some(mut session) = open(address).await? else {
            return Err("App 用パスワードが無効です".to_owned());
        };
        let done = keep_copy(&mut session, message_id, message).await;
        close(session).await;
        done
    };
    let result = tokio::time::timeout(COPY_TIMEOUT, copied)
        .await
        .unwrap_or_else(|_| Err("iCloud への接続がタイムアウトしました".into()));
    if let Err(e) = result {
        log_failure("send_mail (sent copy)", address, e);
    }
}

/// Sends the mail from the iCloud account `address`. `Ok(None)` means the password must be entered again (it is not kept, or iCloud refuses it).
pub async fn send(address: &str, mail: &OutgoingMail) -> Result<Option<bool>, ApiError> {
    let checked = check(address, mail, ATTACHMENTS_LIMIT)?;
    let owned = address.to_owned();
    let Some(password) = blocking(move || keychain::read(KEYRING_SERVICE, &owned)).await? else {
        return Ok(None);
    };
    let reply = match &mail.reply_thread_id {
        Some(id) => match reply_headers(address, id).await? {
            Some(headers) => Some(headers),
            None => return Ok(None),
        },
        None => None,
    };
    let mut random = [0u8; 16];
    getrandom::fill(&mut random).map_err(|_| "乱数を作れません")?;
    let headers = smtp_headers(address, random, Utc::now());
    let message = render_smtp(&checked, reply.as_ref(), &headers).into_bytes();
    check_size(message.len())?;
    let envelope = envelope(address, &envelope_addresses(mail))?;
    let client = icloud_transport(address, &password)?;
    match tokio::time::timeout(SEND_TIMEOUT, deliver(&client, &envelope, &message)).await {
        Err(_) => return Err("iCloud への送信がタイムアウトしました".into()),
        Ok(Err(SmtpError::Rejected)) => return Ok(None),
        Ok(Err(SmtpError::Failed(message))) => return Err(message.into()),
        Ok(Ok(())) => {}
    }
    keep_copy_of(address, &headers.message_id, &message).await;
    // `true`, not `()`: `Some(())` reaches JS as null, the same as `None` (login required).
    Ok(Some(true))
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::{
        icloud::{
            login_session,
            message::{parse, Raw},
        },
        mail_send::OutgoingMail,
    };
    use base64::{engine::general_purpose::STANDARD, Engine};
    use mail_parser::MessageParser;
    use tokio::{
        io::{AsyncBufReadExt, AsyncReadExt, AsyncWriteExt, BufReader},
        net::{TcpListener, TcpStream},
        task::JoinHandle,
    };

    const ME: &str = "me@icloud.com";

    fn raw(bytes: &str) -> Raw {
        Raw {
            folder: Folder::Inbox,
            uid: 1,
            validity: 1,
            seen: true,
            date_ms: 0,
            bytes: bytes.as_bytes().to_vec(),
        }
    }

    fn reply_headers_from(mails: &[&str]) -> Result<ReplyHeaders, String> {
        let raws: Vec<Raw> = mails.iter().map(|m| raw(m)).collect();
        let parser = MessageParser::new();
        let parsed: Vec<Mail> = raws
            .iter()
            .map(|r| Mail {
                raw: r,
                msg: parse(&parser, r),
            })
            .collect();
        let refs: Vec<&Mail> = parsed.iter().collect();
        reply_headers_of(&refs)
    }

    #[test]
    fn a_reply_is_threaded_to_the_newest_mail_of_the_thread() {
        let first = "Message-ID: <a@x>\r\nSubject: s\r\n\r\nb\r\n";
        let second = "Message-ID: <b@x>\r\nIn-Reply-To: <a@x>\r\nReferences: <a@x>\r\n\r\nb\r\n";
        let h = reply_headers_from(&[first, second]).unwrap();
        assert_eq!(h.in_reply_to, "<b@x>");
        assert_eq!(h.references, ["<a@x>", "<b@x>"]);
        // The newest mail that has no References starts the chain with its own ID.
        let h = reply_headers_from(&[second, first]).unwrap();
        assert_eq!(
            (h.in_reply_to.as_str(), h.references),
            ("<a@x>", vec!["<a@x>".to_owned()])
        );
    }

    #[test]
    fn a_reply_to_a_mail_with_no_message_id_or_to_no_mail_is_refused() {
        assert_eq!(
            reply_headers_from(&["Subject: s\r\n\r\nb\r\n"]).unwrap_err(),
            "返信先のメッセージ ID を読めません"
        );
        assert_eq!(
            reply_headers_from(&[]).unwrap_err(),
            "返信先のメッセージがありません"
        );
    }

    #[test]
    fn the_message_id_is_at_the_domain_of_the_sender_and_the_date_is_rfc_2822() {
        let now = DateTime::parse_from_rfc3339("2026-11-28T07:00:00Z")
            .unwrap()
            .to_utc();
        let h = smtp_headers(ME, [0xab; 16], now);
        assert_eq!(
            h.message_id,
            "<abababababababababababababababab@icloud.com>"
        );
        assert_eq!(h.date, "Sat, 28 Nov 2026 07:00:00 +0000");
    }

    #[test]
    fn a_message_over_what_the_server_takes_is_refused() {
        assert!(check_size(MESSAGE_LIMIT as usize).is_ok());
        assert_eq!(
            check_size(MESSAGE_LIMIT as usize + 1),
            Err("メールが大きすぎます（iCloud の上限は 27 MB です）".into())
        );
    }

    /// The files at the limit, as base64 in lines of 76 characters with CRLF, are not over the size the server takes; a 3-byte group more is.
    #[test]
    fn the_limit_of_the_files_is_what_fits_the_size_of_the_server_after_base64() {
        let encoded = |n: u64| {
            let chars = n.div_ceil(3) * 4;
            chars + chars.div_ceil(76) * 2
        };
        assert!(encoded(ATTACHMENTS_LIMIT) <= MESSAGE_LIMIT);
        assert!(encoded(ATTACHMENTS_LIMIT + 3) > MESSAGE_LIMIT - 150);
        assert_eq!(ATTACHMENTS_LIMIT / 1024 / 1024, 19);
    }

    #[test]
    fn the_envelope_names_every_recipient_and_the_sender() {
        let to = vec!["a@example.com".to_owned(), "b@example.com".to_owned()];
        let e = envelope(ME, &to).unwrap();
        assert_eq!(e.from().map(ToString::to_string), Some(ME.to_owned()));
        assert_eq!(e.to().len(), 2);
        assert!(envelope(ME, &["not an address".to_owned()]).is_err());
        assert!(envelope(ME, &[]).is_err());
    }

    /// What a fake SMTP server was sent, line by line (the DATA included), and the server's answers to AUTH and to RCPT TO.
    async fn smtp_server(auth: &'static str, rcpt: &'static str) -> (u16, JoinHandle<Vec<String>>) {
        let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
        let port = listener.local_addr().unwrap().port();
        let server = tokio::spawn(async move {
            let (stream, _) = listener.accept().await.unwrap();
            let (read, mut write) = stream.into_split();
            write.write_all(b"220 fake ESMTP\r\n").await.unwrap();
            let mut lines = BufReader::new(read).lines();
            let (mut seen, mut data) = (Vec::new(), false);
            while let Ok(Some(line)) = lines.next_line().await {
                seen.push(line.clone());
                if data {
                    if line == "." {
                        data = false;
                        write.write_all(b"250 queued\r\n").await.unwrap();
                    }
                    continue;
                }
                let upper = line.to_uppercase();
                let reply = if upper.starts_with("EHLO") {
                    "250-fake\r\n250 AUTH PLAIN LOGIN\r\n".to_owned()
                } else if upper.starts_with("AUTH") {
                    format!("{auth}\r\n")
                } else if upper.starts_with("MAIL FROM") {
                    "250 ok\r\n".to_owned()
                } else if upper.starts_with("RCPT TO") {
                    format!("{rcpt}\r\n")
                } else if upper.starts_with("DATA") {
                    data = true;
                    "354 go ahead\r\n".to_owned()
                } else if upper.starts_with("QUIT") {
                    let _ = write.write_all(b"221 bye\r\n").await;
                    break;
                } else {
                    "250 ok\r\n".to_owned()
                };
                write.write_all(reply.as_bytes()).await.unwrap();
            }
            seen
        });
        (port, server)
    }

    fn plain_transport(port: u16) -> AsyncSmtpTransport<Tokio1Executor> {
        transport("127.0.0.1", port, Tls::None, ME, "app-password")
    }

    fn mail(bcc: &[&str]) -> OutgoingMail {
        OutgoingMail {
            to: vec!["a@example.com".into()],
            cc: vec!["c@example.com".into()],
            bcc: bcc.iter().map(|b| (*b).to_owned()).collect(),
            subject: "hello".into(),
            body: "text".into(),
            markdown: None,
            reply_thread_id: None,
            attachments: None,
        }
    }

    fn message_of(m: &OutgoingMail, reply: Option<&ReplyHeaders>) -> (String, Envelope) {
        let checked = check(ME, m, ATTACHMENTS_LIMIT).unwrap();
        let headers = smtp_headers(ME, [1; 16], Utc::now());
        let message = render_smtp(&checked, reply, &headers);
        (message, envelope(ME, &envelope_addresses(m)).unwrap())
    }

    #[tokio::test]
    async fn the_mail_goes_over_smtp_with_the_login_and_every_recipient_in_the_envelope_but_no_bcc_header(
    ) {
        let (port, server) = smtp_server("235 ok", "250 ok").await;
        let m = mail(&["secret@example.com"]);
        let (message, env) = message_of(&m, None);
        deliver(&plain_transport(port), &env, message.as_bytes())
            .await
            .unwrap();
        let seen = server.await.unwrap();
        let auth = seen.iter().find(|l| l.starts_with("AUTH PLAIN")).unwrap();
        let login = STANDARD
            .decode(auth.trim_start_matches("AUTH PLAIN "))
            .unwrap();
        assert_eq!(login, b"\0me@icloud.com\0app-password");
        let rcpt: Vec<&String> = seen.iter().filter(|l| l.starts_with("RCPT TO")).collect();
        assert_eq!(rcpt.len(), 3, "{seen:?}");
        assert!(rcpt.iter().any(|l| l.contains("secret@example.com")));
        assert!(seen
            .iter()
            .any(|l| l.starts_with("MAIL FROM:<me@icloud.com>")));
        let sent = seen.join("\n");
        assert!(sent.contains("Message-ID: <01010101"), "{sent}");
        assert!(sent.contains("Date: "));
        assert!(sent.contains("To: a@example.com"));
        assert!(!sent.contains("Bcc"), "{sent}");
    }

    #[tokio::test]
    async fn a_refused_login_asks_for_the_password_and_a_refused_recipient_is_a_failure_in_japanese(
    ) {
        let (port, server) = smtp_server("535 5.7.8 Authentication failed", "250 ok").await;
        let (message, env) = message_of(&mail(&[]), None);
        let refused = deliver(&plain_transport(port), &env, message.as_bytes()).await;
        assert_eq!(refused, Err(SmtpError::Rejected));
        server.abort();

        let (port, server) = smtp_server("235 ok", "550 no such user").await;
        let refused = deliver(&plain_transport(port), &env, message.as_bytes()).await;
        let Err(SmtpError::Failed(text)) = refused else {
            panic!("{refused:?}");
        };
        assert!(text.starts_with("iCloud が送信を断りました"), "{text}");
        assert!(!text.contains("app-password"));
        server.abort();
    }

    #[test]
    fn the_message_over_smtp_has_no_bcc_header_and_the_one_for_gmail_keeps_it() {
        let m = mail(&["secret@example.com"]);
        let checked = check(ME, &m, ATTACHMENTS_LIMIT).unwrap();
        let headers = smtp_headers(ME, [1; 16], Utc::now());
        let smtp = render_smtp(&checked, None, &headers);
        assert!(!smtp.contains("Bcc:"));
        assert!(smtp.contains("Cc: c@example.com"));
        assert!(smtp.starts_with("From: me@icloud.com\r\nDate: "));
    }

    /// A fake IMAP server of one connection whose sent folder holds the mails of the Message-IDs `stored` (or has no such folder).
    /// The value of the join handle is the commands it was sent and the bodies it was given to append.
    async fn imap_server(
        stored: &'static [&'static str],
        folder: bool,
    ) -> (TcpStream, JoinHandle<(Vec<String>, Vec<Vec<u8>>)>) {
        let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
        let addr = listener.local_addr().unwrap();
        let server = tokio::spawn(async move {
            let (stream, _) = listener.accept().await.unwrap();
            let (read, mut write) = stream.into_split();
            write.write_all(b"* OK IMAP ready\r\n").await.unwrap();
            let mut reader = BufReader::new(read);
            let (mut seen, mut appended) = (Vec::new(), Vec::new());
            let mut line = String::new();
            loop {
                line.clear();
                if reader.read_line(&mut line).await.unwrap() == 0 {
                    break;
                }
                let text = line.trim_end().to_owned();
                seen.push(text.clone());
                let (tag, rest) = text.split_once(' ').unwrap();
                let command = rest.split(' ').next().unwrap();
                let reply = match command {
                    "LOGIN" => format!("{tag} OK Logged in\r\n"),
                    "EXAMINE" if folder => {
                        format!("* 1 EXISTS\r\n* OK [UIDVALIDITY 1] ok\r\n{tag} OK done\r\n")
                    }
                    "EXAMINE" => format!("{tag} NO no such mailbox\r\n"),
                    "UID" => {
                        let hit = stored.iter().any(|id| rest.contains(id));
                        let hits = if hit { " 7" } else { "" };
                        format!("* SEARCH{hits}\r\n{tag} OK Search completed\r\n")
                    }
                    "APPEND" => {
                        let size: usize = text
                            .rsplit_once('{')
                            .unwrap()
                            .1
                            .trim_end_matches('}')
                            .parse()
                            .unwrap();
                        write.write_all(b"+ Ready\r\n").await.unwrap();
                        let mut body = vec![0u8; size];
                        reader.read_exact(&mut body).await.unwrap();
                        line.clear();
                        reader.read_line(&mut line).await.unwrap();
                        appended.push(body);
                        format!("{tag} OK [APPENDUID 1 9] done\r\n")
                    }
                    "LOGOUT" => {
                        let _ = write
                            .write_all(format!("* BYE\r\n{tag} OK bye\r\n").as_bytes())
                            .await;
                        break;
                    }
                    _ => format!("{tag} BAD unknown\r\n"),
                };
                write.write_all(reply.as_bytes()).await.unwrap();
            }
            (seen, appended)
        });
        let stream = TcpStream::connect(addr).await.unwrap();
        (stream, server)
    }

    async fn copy(
        stored: &'static [&'static str],
        folder: bool,
    ) -> (Result<(), String>, Vec<String>, Vec<Vec<u8>>) {
        let (stream, server) = imap_server(stored, folder).await;
        let mut session = login_session(stream, ME, "pw").await.unwrap();
        let done = keep_copy(
            &mut session,
            "<m1@icloud.com>",
            b"Subject: s\r\n\r\nbody\r\n",
        )
        .await;
        let _ = session.logout().await;
        let (seen, appended) = server.await.unwrap();
        (done, seen, appended)
    }

    #[tokio::test]
    async fn the_mail_is_appended_to_the_sent_folder_when_it_is_not_there() {
        let (done, seen, appended) = copy(&["<other@icloud.com>"], true).await;
        assert_eq!(done, Ok(()));
        let search = seen.iter().find(|l| l.contains("SEARCH")).unwrap();
        assert!(
            search.contains("HEADER Message-ID \"<m1@icloud.com>\""),
            "{search}"
        );
        assert!(seen.iter().any(|l| l.contains("EXAMINE \"Sent Messages\"")));
        assert!(seen
            .iter()
            .any(|l| l.contains("APPEND \"Sent Messages\" (\\Seen) {")));
        assert_eq!(appended, [b"Subject: s\r\n\r\nbody\r\n".to_vec()]);
    }

    #[tokio::test]
    async fn the_mail_is_not_appended_when_iclouds_own_copy_is_there() {
        let (done, seen, appended) = copy(&["<m1@icloud.com>"], true).await;
        assert_eq!(done, Ok(()));
        assert!(appended.is_empty());
        assert!(!seen.iter().any(|l| l.contains("APPEND")));
    }

    #[tokio::test]
    async fn a_missing_sent_folder_is_left_to_the_append() {
        let (done, seen, appended) = copy(&[], false).await;
        assert_eq!(done, Ok(()));
        assert!(!seen.iter().any(|l| l.contains("SEARCH")));
        assert_eq!(appended.len(), 1);
    }
}
