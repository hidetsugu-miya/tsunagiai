//! Putting the mails of an iCloud account into threads (M-13), as pure functions on the headers.
//! IMAP has no thread of its own here (iCloud answers no `THREAD`), so the app joins the mails that name each other in `Message-ID`, `In-Reply-To` and `References`.
//! A mail with none of these stands alone. The ID of a thread is made from the Message-ID of its root mail, so that the thread can be found again by a search of the mailbox.

use std::collections::HashMap;

/// The longest Message-ID that RFC 5322 allows in a line.
const MAX_KEY: usize = 998;

/// What the thread of a mail needs from its headers.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Node {
    /// The Message-ID without its angle brackets, or the key `made_up_key` gives a mail that has none.
    pub own: String,
    /// The Message-IDs the mail answers: the References in order, then the In-Reply-To when it is not among them. Never `own`.
    pub refs: Vec<String>,
    pub date_ms: i64,
}

impl Node {
    /// The Message-ID of the root of the thread as this mail names it: the first of its References, else the mail itself.
    pub fn root_key(&self) -> &str {
        self.refs.first().unwrap_or(&self.own)
    }

    /// Whether the mail is the one `key` names or names it among the mails it answers.
    pub fn belongs_to(&self, key: &str) -> bool {
        self.own == key || self.refs.iter().any(|r| r == key)
    }
}

/// The mails of one thread: `members` index the nodes, oldest first, and `key` is the root key of the oldest.
#[derive(Debug, PartialEq, Eq)]
pub struct Group {
    pub key: String,
    pub members: Vec<usize>,
}

/// Disjoint sets of the Message-IDs seen.
#[derive(Default)]
struct Sets<'a> {
    slot: HashMap<&'a str, usize>,
    parent: Vec<usize>,
}

impl<'a> Sets<'a> {
    fn id(&mut self, key: &'a str) -> usize {
        let next = self.parent.len();
        let id = *self.slot.entry(key).or_insert(next);
        if id == next {
            self.parent.push(next);
        }
        id
    }

    fn find(&mut self, mut i: usize) -> usize {
        while self.parent[i] != i {
            self.parent[i] = self.parent[self.parent[i]];
            i = self.parent[i];
        }
        i
    }

    fn union(&mut self, a: usize, b: usize) {
        let (a, b) = (self.find(a), self.find(b));
        self.parent[a] = b;
    }
}

/// Joins the mails whose Message-IDs link up, in any chain. A mail that names no other and is named by none is a thread of its own.
/// Two nodes with the same Message-ID (a mail kept in two folders) count once: the one that comes first in `nodes` stays.
/// The groups come in the order of their first node.
pub fn group(nodes: &[Node]) -> Vec<Group> {
    let mut sets = Sets::default();
    let owns: Vec<usize> = nodes.iter().map(|n| sets.id(&n.own)).collect();
    for (node, own) in nodes.iter().zip(&owns) {
        for r in &node.refs {
            let r = sets.id(r);
            sets.union(*own, r);
        }
    }
    let mut order: Vec<usize> = Vec::new();
    let mut by_set: HashMap<usize, Vec<usize>> = HashMap::new();
    for (i, own) in owns.iter().enumerate() {
        let set = sets.find(*own);
        let members = by_set.entry(set).or_default();
        if members.is_empty() {
            order.push(set);
        }
        if !members.iter().any(|&m| nodes[m].own == nodes[i].own) {
            members.push(i);
        }
    }
    order
        .into_iter()
        .map(|set| {
            let mut members = by_set.remove(&set).unwrap_or_default();
            members.sort_by_key(|&i| (nodes[i].date_ms, i));
            Group {
                key: nodes[members[0]].root_key().to_owned(),
                members,
            }
        })
        .collect()
}

/// Whether `id` can be a key: printable ASCII with no space, and no longer than a line. Anything else is not used as a Message-ID,
/// so a key can always be written in an IMAP search as it is, between quotes.
pub fn valid_key(id: &str) -> bool {
    !id.is_empty() && id.len() <= MAX_KEY && id.bytes().all(|b| b.is_ascii_graphic())
}

/// The ID the screen is given for the thread of `key`: its hexadecimal form, which has no character to be escaped anywhere.
pub fn thread_id(key: &str) -> String {
    key.bytes().map(|b| format!("{b:02x}")).collect()
}

/// The key of a thread ID the screen sent back; `None` when it is not one `thread_id` made.
pub fn key_of(id: &str) -> Option<String> {
    if !id.len().is_multiple_of(2)
        || id.len() > MAX_KEY * 2
        || !id.bytes().all(|b| matches!(b, b'0'..=b'9' | b'a'..=b'f'))
    {
        return None;
    }
    let bytes: Vec<u8> = (0..id.len())
        .step_by(2)
        .map(|i| u8::from_str_radix(&id[i..i + 2], 16))
        .collect::<Result<_, _>>()
        .ok()?;
    String::from_utf8(bytes).ok().filter(|k| valid_key(k))
}

/// The key of a mail that has no Message-ID: where it is. Its thread is that mail alone.
pub fn made_up_key(folder: &str, validity: u32, uid: u32) -> String {
    format!("uid:{folder}:{validity}:{uid}")
}

/// The folder tag, the UIDVALIDITY and the UID of a key `made_up_key` made.
pub fn made_up_parts(key: &str) -> Option<(&str, u32, u32)> {
    let mut parts = key.strip_prefix("uid:")?.split(':');
    let (folder, validity, uid) = (parts.next()?, parts.next()?, parts.next()?);
    parts.next().is_none().then_some(())?;
    Some((folder, validity.parse().ok()?, uid.parse().ok()?))
}

#[cfg(test)]
mod tests {
    use super::*;

    fn node(own: &str, refs: &[&str], date_ms: i64) -> Node {
        Node {
            own: own.into(),
            refs: refs.iter().map(|r| (*r).into()).collect(),
            date_ms,
        }
    }

    #[test]
    fn a_reply_chain_is_one_thread_with_the_root_as_its_key() {
        let nodes = [
            node("c", &["a", "b"], 30),
            node("a", &[], 10),
            node("b", &["a"], 20),
        ];
        let groups = group(&nodes);
        assert_eq!(
            groups,
            vec![Group {
                key: "a".into(),
                members: vec![1, 2, 0]
            }]
        );
    }

    #[test]
    fn mails_that_name_nothing_in_common_are_threads_of_their_own() {
        let nodes = [
            node("a", &[], 10),
            node("b", &[], 20),
            node("c", &["x"], 30),
        ];
        let groups = group(&nodes);
        assert_eq!(groups.len(), 3);
        assert_eq!(groups[0].key, "a");
        assert_eq!(groups[2].key, "x");
    }

    #[test]
    fn a_mail_with_only_an_in_reply_to_joins_the_mail_it_answers() {
        // The parent is in the list; the reply names only it.
        let nodes = [node("p", &[], 10), node("r", &["p"], 20)];
        assert_eq!(group(&nodes).len(), 1);
    }

    #[test]
    fn two_replies_to_a_mail_that_is_not_here_still_join() {
        let nodes = [node("r1", &["gone"], 10), node("r2", &["gone"], 20)];
        let groups = group(&nodes);
        assert_eq!(groups.len(), 1);
        assert_eq!(groups[0].key, "gone");
    }

    #[test]
    fn a_chain_that_one_mail_bridges_is_one_thread() {
        // d names c only, and c names a: the thread is a, c, d, though d never names a.
        let nodes = [
            node("a", &[], 10),
            node("d", &["c"], 40),
            node("c", &["a"], 30),
        ];
        let groups = group(&nodes);
        assert_eq!(groups.len(), 1);
        assert_eq!(groups[0].members, vec![0, 2, 1]);
    }

    #[test]
    fn a_mail_kept_in_two_folders_counts_once_and_the_first_copy_stays() {
        let nodes = [
            node("a", &[], 10),
            node("a", &[], 15),
            node("b", &["a"], 20),
        ];
        let groups = group(&nodes);
        assert_eq!(groups.len(), 1);
        assert_eq!(groups[0].members, vec![0, 2]);
    }

    #[test]
    fn the_key_is_that_of_the_oldest_mail_and_belongs_to_covers_the_root_and_its_replies() {
        let reply = node("b", &["a"], 20);
        assert_eq!(reply.root_key(), "a");
        assert!(reply.belongs_to("a") && reply.belongs_to("b") && !reply.belongs_to("c"));
        assert_eq!(node("a", &[], 10).root_key(), "a");
    }

    #[test]
    fn a_thread_id_is_hex_and_gives_its_key_back() {
        let key = "CAF=abc.def+1@mail.example.com";
        let id = thread_id(key);
        assert!(id.bytes().all(|b| b.is_ascii_hexdigit()));
        assert_eq!(key_of(&id).as_deref(), Some(key));
    }

    #[test]
    fn an_id_that_thread_id_did_not_make_is_refused() {
        for bad in [
            "",
            "z",
            "abc",
            "ABCD",
            "20",
            "0a0a",
            "ff",
            &"61".repeat(MAX_KEY + 1),
        ] {
            assert_eq!(key_of(bad), None, "{bad:?}");
        }
        // A quote, a backslash and a space never get through: a key goes into an IMAP search between quotes.
        assert_eq!(key_of(&thread_id("a b")), None);
        assert!(valid_key("a\"b\\c@x"));
        assert!(!valid_key("a\nb") && !valid_key("é@x") && !valid_key(""));
    }

    #[test]
    fn a_made_up_key_gives_its_place_back() {
        let key = made_up_key("i", 1700, 42);
        assert_eq!(made_up_parts(&key), Some(("i", 1700, 42)));
        for bad in ["a@b", "uid:i:1", "uid:i:x:2", "uid:i:1:2:3"] {
            assert_eq!(made_up_parts(bad), None, "{bad}");
        }
        assert!(valid_key(&key));
    }
}
