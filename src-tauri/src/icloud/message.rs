//! One mail of an iCloud mailbox, read with `mail-parser` into what the screen draws: the row of the list (`ThreadItem`) and the thread (`ThreadDetail`), in the same shape as Gmail's (M-13).
//! Everything here is a pure function of the bytes of the mails, so the tests need no server.

use std::{
    borrow::Cow,
    collections::{HashMap, HashSet},
};

use base64::{engine::general_purpose::URL_SAFE_NO_PAD, Engine};
use mail_parser::{AddressList, Message, MessageParser, MessagePart, PartKind};

use super::threading::{made_up_key, valid_key, Node};
use crate::{
    gmail::{MessageDetail, ThreadDetail, ThreadItem},
    images::{
        cid_refs, image_mime, inline_data_uri, replace_cids, wanted_images, InlineImage,
        MAX_INLINE_IMAGES,
    },
    mail_address::{recipients_label, reply_choices, split_address, ReplyChoices},
};

/// The folders of an iCloud account that a thread is read from or moved between.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Folder {
    Inbox,
    Sent,
    /// Where an archived thread goes (it has no mark, so it is chosen by its name).
    Archive,
    /// Where a deleted thread goes (it has the `\\Trash` mark).
    Trash,
}

impl Folder {
    /// The name the folder has on iCloud (checked on a real account on 2026-11-28; the folder of the mails sent also has the `\\Sent` mark).
    pub fn name(self) -> &'static str {
        match self {
            Folder::Inbox => "INBOX",
            Folder::Sent => "Sent Messages",
            Folder::Archive => "Archive",
            Folder::Trash => "Deleted Messages",
        }
    }

    /// What the IDs made here say of the folder.
    pub fn tag(self) -> &'static str {
        match self {
            Folder::Inbox => "i",
            Folder::Sent => "s",
            Folder::Archive => "a",
            Folder::Trash => "t",
        }
    }

    pub fn of_tag(tag: &str) -> Option<Folder> {
        [Folder::Inbox, Folder::Sent, Folder::Archive, Folder::Trash]
            .into_iter()
            .find(|f| f.tag() == tag)
    }
}

/// A mail as the server gave it: where it is, and its bytes (the whole message, or only the header fields asked for).
#[derive(Clone, Debug)]
pub struct Raw {
    pub folder: Folder,
    pub uid: u32,
    pub validity: u32,
    pub seen: bool,
    /// INTERNALDATE, the time iCloud took the mail in (Gmail's `internalDate`).
    pub date_ms: i64,
    pub bytes: Vec<u8>,
}

pub fn parse<'a>(parser: &MessageParser, raw: &'a Raw) -> Message<'a> {
    parser.parse(&raw.bytes).unwrap_or_default()
}

/// A Message-ID, or a name in its list, that is used as it is: `None` for one that `valid_key` refuses.
fn clean(id: &str) -> Option<&str> {
    let id = id.trim();
    valid_key(id).then_some(id)
}

/// The place of the mail among its thread: its Message-ID (or a key for where it is), and the mails it answers.
pub fn node(raw: &Raw, msg: &Message) -> Node {
    let own = msg.message_id().and_then(clean).map_or_else(
        || made_up_key(raw.folder.tag(), raw.validity, raw.uid),
        str::to_owned,
    );
    let mut refs: Vec<String> = Vec::new();
    let listed = msg.references().into_iter().flat_map(|l| l.iter());
    let answered = msg.in_reply_to().into_iter().flat_map(|l| l.iter());
    for id in listed.chain(answered).filter_map(clean) {
        if id != own && !refs.iter().any(|r| r == id) {
            refs.push(id.to_owned());
        }
    }
    Node {
        own,
        refs,
        date_ms: raw.date_ms,
    }
}

/// `"Name" <address>`, or the address alone with no name. The name's own quotes are dropped: a header of several of these is split at the commas outside quotes.
fn mailbox(name: Option<&str>, address: &str) -> String {
    let name: String = name
        .unwrap_or_default()
        .chars()
        .filter(|c| !c.is_control())
        .map(|c| if c == '"' { '\'' } else { c })
        .collect();
    let name = name.trim();
    if name.is_empty() {
        address.to_owned()
    } else {
        format!("\"{name}\" <{address}>")
    }
}

/// An address header as the To line of Gmail's messages has it: the mailboxes joined with `, `.
fn addresses(list: Option<AddressList>) -> String {
    list.map(|l| {
        l.mailboxes()
            .filter_map(|m| Some(mailbox(m.name(), m.address()?)))
            .collect::<Vec<_>>()
            .join(", ")
    })
    .unwrap_or_default()
}

/// Gmail sends its snippets HTML-escaped, and the screen unescapes them.
fn escape_html(text: &str) -> String {
    let mut out = String::with_capacity(text.len());
    for c in text.chars() {
        match c {
            '&' => out.push_str("&amp;"),
            '<' => out.push_str("&lt;"),
            '>' => out.push_str("&gt;"),
            '"' => out.push_str("&quot;"),
            '\'' => out.push_str("&#39;"),
            c => out.push(c),
        }
    }
    out
}

/// The first line or so of the body, as one line, escaped like Gmail's snippet.
fn snippet(msg: &Message) -> String {
    let preview = msg.body_preview(300).unwrap_or_default();
    let line = preview.split_whitespace().collect::<Vec<_>>().join(" ");
    escape_html(&line.chars().take(120).collect::<String>())
}

/// A mail of a thread: its bytes read.
pub struct Mail<'a> {
    pub raw: &'a Raw,
    pub msg: Message<'a>,
}

/// The row of the list for the thread `id` of `mails` (oldest first): the subject of the first mail, the sender, the time and the snippet of the latest.
pub fn thread_item(account: &str, id: String, mails: &[&Mail]) -> ThreadItem {
    let (first, last) = (&mails[0], &mails[mails.len() - 1]);
    let from = addresses(last.msg.from());
    let sender = split_address(&from);
    ThreadItem {
        id,
        account: account.to_owned(),
        from,
        from_name: sender.name,
        from_address: sender.address,
        subject: first.msg.subject().unwrap_or_default().to_owned(),
        snippet: snippet(&last.msg),
        date_ms: last.raw.date_ms,
        unread: mails.iter().any(|m| !m.raw.seen),
    }
}

/// What the images of one thread may take, shared by its mails as in Gmail's: one count and one size limit span the thread.
#[derive(Default)]
struct Images {
    total: u64,
    taken: usize,
}

/// `html` with the `cid:` references that name an image part of the mail replaced by the image as a data: URI.
/// An iCloud mail has its images in its own parts, so no image is left to be fetched.
fn inline_images(msg: &Message, html: &str, budget: &mut Images) -> String {
    let refs = cid_refs(html);
    let named: HashSet<&str> = refs.iter().map(|r| r.2.as_str()).collect();
    let encoded: Vec<(&str, String, u64, String)> = msg
        .parts()
        .filter(|p| matches!(p.kind(), PartKind::Binary | PartKind::InlineBinary))
        .filter_map(|p| {
            let cid = p.content_id().filter(|c| named.contains(c))?;
            let kind = p.content_type()?;
            let mime = image_mime(&format!("{}/{}", kind.ctype(), kind.subtype()?))?;
            let bytes = p.decoded();
            Some((
                cid,
                mime,
                bytes.len() as u64,
                URL_SAFE_NO_PAD.encode(&bytes),
            ))
        })
        .collect();
    let images: Vec<InlineImage> = encoded
        .iter()
        .map(|(cid, mime, size, data)| InlineImage {
            cid,
            mime: mime.clone(),
            size: *size,
            attachment_id: "",
            data,
        })
        .collect();
    let chosen = wanted_images(
        &refs,
        &images,
        &mut budget.total,
        MAX_INLINE_IMAGES - budget.taken,
    );
    budget.taken += chosen.len();
    let uris: HashMap<String, String> = chosen
        .iter()
        .filter_map(|i| Some((i.cid.to_owned(), inline_data_uri(&i.mime, i.data)?)))
        .collect();
    replace_cids(html, &refs, &uris)
}

/// The non-empty texts of the parts of one kind.
fn texts<'m>(
    parts: impl Iterator<Item = MessagePart<'m>>,
    is_kind: impl Fn(&PartKind) -> bool,
) -> Vec<String> {
    parts
        .filter(|p| is_kind(&p.kind()))
        .filter_map(|p| p.text().map(Cow::into_owned))
        .filter(|t| !t.is_empty())
        .collect()
}

/// HTML wins unless `prefer_plain` is set and a plain-text part exists, as in Gmail's messages.
fn message_detail(
    mail: &Mail,
    prefer_plain: bool,
    account: &str,
    budget: &mut Images,
) -> MessageDetail {
    let msg = &mail.msg;
    // The body lists also hold a text part that stands in for a missing HTML one (and the other way round): only the real kind of each counts.
    let html: Vec<String> = texts(msg.html_body(), |k| matches!(k, PartKind::Html));
    let plain: Vec<String> = texts(msg.text_body(), |k| matches!(k, PartKind::Text));
    let is_html = !html.is_empty() && !(prefer_plain && !plain.is_empty());
    let body = if is_html {
        inline_images(msg, &html.concat(), budget)
    } else {
        plain.join("\n")
    };
    let from = addresses(msg.from());
    let sender = split_address(&from);
    let to = addresses(msg.to());
    MessageDetail {
        id: format!(
            "{}-{}-{}",
            mail.raw.folder.tag(),
            mail.raw.validity,
            mail.raw.uid
        ),
        to_label: recipients_label(&to, account),
        from,
        from_name: sender.name,
        from_address: sender.address,
        to,
        date_ms: mail.raw.date_ms,
        snippet: snippet(msg),
        html: is_html,
        body,
        // Gmail vouches for a sender by the `Authentication-Results` that `mx.google.com` adds (`image_senders::authenticated`); nothing here is that, so an external image is asked for.
        authenticated: false,
    }
}

/// Who a reply goes to: the answer to the latest mail of the thread.
fn reply_to_last(mails: &[&Mail], account: &str) -> ReplyChoices {
    let Some(last) = mails.last() else {
        return ReplyChoices::default();
    };
    let (from, to) = (addresses(last.msg.from()), addresses(last.msg.to()));
    reply_choices(
        account,
        &from,
        &addresses(last.msg.reply_to()),
        &to,
        &addresses(last.msg.cc()),
    )
}

/// The thread of `mails` (oldest first) as the screen draws it.
pub fn thread_detail(account: &str, mails: &[&Mail], prefer_plain: bool) -> ThreadDetail {
    let mut budget = Images::default();
    let messages = mails
        .iter()
        .map(|m| message_detail(m, prefer_plain, account, &mut budget))
        .collect();
    ThreadDetail {
        subject: mails
            .first()
            .and_then(|m| m.msg.subject())
            .unwrap_or_default()
            .to_owned(),
        unread: mails.iter().any(|m| !m.raw.seen),
        messages,
        reply: reply_to_last(mails, account),
        pending_images: Vec::new(),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn raw(bytes: &str, seen: bool) -> Raw {
        Raw {
            folder: Folder::Inbox,
            uid: 7,
            validity: 1700,
            seen,
            date_ms: 1_000,
            bytes: bytes.replace('\n', "\r\n").into_bytes(),
        }
    }

    fn parsed<'a>(parser: &MessageParser, raws: &'a [Raw]) -> Vec<Mail<'a>> {
        raws.iter()
            .map(|raw| Mail {
                raw,
                msg: parse(parser, raw),
            })
            .collect()
    }

    const PLAIN: &str = "Message-ID: <m1@x>\nFrom: =?UTF-8?B?44Ki44Oq44K5?= <alice@example.com>\nTo: me@icloud.com, \"Doe, Bob\" <bob@example.com>\nSubject: =?UTF-8?B?5Lya6K2w?=\nContent-Type: text/plain; charset=utf-8\n\nhello\n";

    #[test]
    fn the_headers_are_decoded_and_the_to_line_is_worked_out_for_the_account() {
        let raws = [raw(PLAIN, false)];
        let mails = parsed(&MessageParser::new(), &raws);
        let refs: Vec<&Mail> = mails.iter().collect();
        let detail = thread_detail("me@icloud.com", &refs, false);
        assert_eq!(detail.subject, "会議");
        let m = &detail.messages[0];
        assert_eq!(
            (m.from_name.as_str(), m.from_address.as_str()),
            ("アリス", "alice@example.com")
        );
        // A name with a comma stays one recipient.
        assert_eq!(m.to, "me@icloud.com, \"Doe, Bob\" <bob@example.com>");
        assert_eq!(m.to_label, "To 自分");
        let other = thread_detail("someone@icloud.com", &refs, false);
        assert_eq!(other.messages[0].to_label, "To me@icloud.com, Doe, Bob");
    }

    #[test]
    fn a_japanese_body_in_iso_2022_jp_is_decoded() {
        let text = "Message-ID: <j@x>\nFrom: a@example.com\nSubject: s\nContent-Type: text/plain; charset=iso-2022-jp\n\n\u{1b}$B$3$s$K$A$O\u{1b}(B\n";
        let raws = [raw(text, true)];
        let mails = parsed(&MessageParser::new(), &raws);
        let detail = thread_detail("me@icloud.com", &[&mails[0]], false);
        assert_eq!(detail.messages[0].body.trim(), "こんにちは");
        assert!(!detail.unread);
    }

    const ALTERNATIVE: &str = "Message-ID: <alt@x>\nFrom: a@example.com\nSubject: s\nMIME-Version: 1.0\nContent-Type: multipart/alternative; boundary=\"b\"\n\n--b\nContent-Type: text/plain; charset=utf-8\n\nplain words\n--b\nContent-Type: text/html; charset=utf-8\n\n<p>html words</p>\n--b--\n";

    #[test]
    fn html_wins_unless_plain_is_preferred_and_a_plain_only_mail_is_not_html() {
        let raws = [raw(ALTERNATIVE, false), raw(PLAIN, false)];
        let mails = parsed(&MessageParser::new(), &raws);
        let html = thread_detail("me@icloud.com", &[&mails[0]], false);
        assert!(html.messages[0].html);
        assert_eq!(html.messages[0].body.trim(), "<p>html words</p>");
        let plain = thread_detail("me@icloud.com", &[&mails[0]], true);
        assert!(!plain.messages[0].html);
        assert_eq!(plain.messages[0].body.trim(), "plain words");
        let only = thread_detail("me@icloud.com", &[&mails[1]], false);
        assert!(!only.messages[0].html);
        assert_eq!(only.messages[0].body.trim(), "hello");
    }

    /// A 1x1 PNG, base64.
    const PNG: &str = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==";

    #[test]
    fn a_cid_image_that_the_html_names_is_inlined_and_one_it_does_not_name_is_not() {
        let text = format!("Message-ID: <img@x>\nFrom: a@example.com\nSubject: s\nMIME-Version: 1.0\nContent-Type: multipart/related; boundary=\"r\"\n\n--r\nContent-Type: text/html; charset=utf-8\n\n<img src=\"cid:logo%40x\"><img src=\"cid:missing@x\">\n--r\nContent-Type: image/png\nContent-ID: <logo@x>\nContent-Transfer-Encoding: base64\n\n{PNG}\n--r\nContent-Type: image/png\nContent-ID: <unused@x>\nContent-Transfer-Encoding: base64\n\n{PNG}\n--r--\n");
        let raws = [raw(&text, false)];
        let mails = parsed(&MessageParser::new(), &raws);
        let detail = thread_detail("me@icloud.com", &[&mails[0]], false);
        let body = &detail.messages[0].body;
        assert!(
            body.contains(&format!("src=\"data:image/png;base64,{PNG}\"")),
            "{body}"
        );
        assert!(body.contains("cid:missing@x"), "{body}");
        assert!(!body.contains("unused"), "{body}");
        // Nothing is left to be fetched.
        assert!(detail.pending_images.is_empty());
    }

    #[test]
    fn the_place_of_a_mail_among_its_thread_comes_from_its_headers() {
        let parser = MessageParser::new();
        let text = "Message-ID: <c@x>\nReferences: <a@x> <b@x> <bad id@x>\nIn-Reply-To: <b@x>\nFrom: a@example.com\n\nbody\n";
        let r = raw(text, false);
        let n = node(&r, &parse(&parser, &r));
        assert_eq!(
            (n.own.as_str(), n.refs.as_slice()),
            ("c@x", &["a@x".to_owned(), "b@x".to_owned()][..])
        );
        assert_eq!(n.root_key(), "a@x");
        // With only an In-Reply-To the parent is the root; with no Message-ID the key is the mail's place.
        let r = raw("In-Reply-To: <p@x>\nFrom: a@example.com\n\nbody\n", false);
        let n = node(&r, &parse(&parser, &r));
        assert_eq!(n.own, "uid:i:1700:7");
        assert_eq!(n.refs, ["p@x"]);
        // A Message-ID that cannot be a key is no Message-ID.
        let r = raw("Message-ID: <é@x>\nFrom: a@example.com\n\nbody\n", false);
        assert_eq!(node(&r, &parse(&parser, &r)).own, "uid:i:1700:7");
    }

    #[test]
    fn a_row_takes_the_subject_of_the_first_mail_and_the_sender_time_and_snippet_of_the_last() {
        let first = raw(
            "Message-ID: <a@x>\nFrom: Alice <alice@example.com>\nSubject: Plan\n\nfirst\n",
            true,
        );
        let mut last = raw("Message-ID: <b@x>\nReferences: <a@x>\nFrom: \"Bob\" <bob@example.com>\nSubject: Re: Plan\n\nI'm <b>sure</b>\n", false);
        last.date_ms = 5_000;
        last.folder = Folder::Sent;
        let raws = [first, last];
        let mails = parsed(&MessageParser::new(), &raws);
        let refs: Vec<&Mail> = mails.iter().collect();
        let item = thread_item("me@icloud.com", "abc".into(), &refs);
        assert_eq!(item.id, "abc");
        assert_eq!(item.account, "me@icloud.com");
        assert_eq!(item.subject, "Plan");
        assert_eq!(
            (item.from_name.as_str(), item.from_address.as_str()),
            ("Bob", "bob@example.com")
        );
        assert_eq!(item.date_ms, 5_000);
        assert_eq!(item.snippet, "I&#39;m &lt;b&gt;sure&lt;/b&gt;");
        // One mail that is not read makes the thread unread; none makes it read.
        assert!(item.unread);
        let read = [raws[0].clone()];
        let m = parsed(&MessageParser::new(), &read);
        assert!(!thread_item("me@icloud.com", "abc".into(), &[&m[0]]).unread);
    }
}
