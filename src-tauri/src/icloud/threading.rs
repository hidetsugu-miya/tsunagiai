//! Putting the mails of an iCloud account into threads (M-13), as pure functions on the headers.
//! IMAP has no thread of its own here (iCloud answers no `THREAD`), so the app joins the mails that name each other in `Message-ID`, `In-Reply-To` and `References`.
//! A mail with none of these stands alone. The ID of a thread is made from the Message-ID of its root mail, so that the thread can be found again by a search of the mailbox.
//! A Message-ID that a mail names joins it to that mail's thread only when the subjects agree (`base_subject`, as Gmail does), so a sender cannot put a mail into a thread of someone else's by naming its Message-ID.

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
    /// `base_subject` of the mail's subject.
    pub subject: String,
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

/// The subject without the `Re:`, `Fwd:` and `Fw:` that replies put in front of it, in lower case with one space between the words: what the mails of one thread have in common.
pub fn base_subject(subject: &str) -> String {
    let mut rest = subject.trim();
    while let Some(prefix) = ["re:", "fwd:", "fw:"]
        .into_iter()
        .find(|p| rest.to_ascii_lowercase().starts_with(p))
    {
        rest = rest[prefix.len()..].trim_start();
    }
    rest.split_whitespace()
        .collect::<Vec<_>>()
        .join(" ")
        .to_lowercase()
}

/// Disjoint sets of the Message-IDs seen. A set that holds a mail seen knows its subject; an ID that only a mail names has none, and takes the subject of the set it joins.
#[derive(Default)]
struct Sets<'a> {
    slot: HashMap<&'a str, usize>,
    parent: Vec<usize>,
    subject: Vec<Option<&'a str>>,
}

impl<'a> Sets<'a> {
    fn id(&mut self, key: &'a str) -> usize {
        let next = self.parent.len();
        let id = *self.slot.entry(key).or_insert(next);
        if id == next {
            self.parent.push(next);
            self.subject.push(None);
        }
        id
    }

    /// Records the subject of the mail whose own ID is `id`; a second copy of the mail keeps the first one's.
    fn name(&mut self, id: usize, subject: &'a str) {
        let root = self.find(id);
        self.subject[root].get_or_insert(subject);
    }

    fn find(&mut self, mut i: usize) -> usize {
        while self.parent[i] != i {
            self.parent[i] = self.parent[self.parent[i]];
            i = self.parent[i];
        }
        i
    }

    /// Joins the sets of `a` and `b` unless both hold a mail and the subjects differ; whether they are one set now.
    fn union(&mut self, a: usize, b: usize) -> bool {
        let (a, b) = (self.find(a), self.find(b));
        if a == b {
            return true;
        }
        if matches!((self.subject[a], self.subject[b]), (Some(x), Some(y)) if x != y) {
            return false;
        }
        self.subject[b] = self.subject[b].or(self.subject[a]);
        self.parent[a] = b;
        true
    }
}

/// The sets of the Message-IDs of `nodes`, the set of each node's own ID, and the nodes with only the References that the subject let join.
fn link(nodes: &[Node]) -> (Sets<'_>, Vec<usize>, Vec<Node>) {
    let mut sets = Sets::default();
    let owns: Vec<usize> = nodes
        .iter()
        .map(|n| {
            let id = sets.id(&n.own);
            sets.name(id, &n.subject);
            id
        })
        .collect();
    let mut linked = Vec::with_capacity(nodes.len());
    for (node, own) in nodes.iter().zip(&owns) {
        let mut refs = Vec::new();
        for r in &node.refs {
            let id = sets.id(r);
            if sets.union(*own, id) {
                refs.push(r.clone());
            }
        }
        linked.push(Node {
            refs,
            ..node.clone()
        });
    }
    (sets, owns, linked)
}

/// `nodes` with the References that name a mail of another subject taken out: the thread of a node is what its remaining names lead to.
pub fn linked(nodes: &[Node]) -> Vec<Node> {
    link(nodes).2
}

/// Joins the mails whose Message-IDs link up, in any chain, where the subjects agree. A mail that names no other and is named by none is a thread of its own.
/// Two nodes with the same Message-ID (a mail kept in two folders) count once: the one that comes first in `nodes` stays.
/// The groups come in the order of their first node.
pub fn group(nodes: &[Node]) -> Vec<Group> {
    let (mut sets, owns, nodes) = link(nodes);
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
            subject: "plan".into(),
        }
    }

    fn about(subject: &str, mut node: Node) -> Node {
        node.subject = base_subject(subject);
        node
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
    fn the_base_subject_drops_the_prefixes_of_replies_and_the_case_and_the_spaces() {
        for same in [
            "Plan",
            "Re: Plan",
            "RE:Plan",
            "Fwd: Re:  PLAN ",
            "fw: re: fwd: plan",
        ] {
            assert_eq!(base_subject(same), "plan", "{same:?}");
        }
        assert_eq!(base_subject("Re: 会議  の  件"), "会議 の 件");
        assert_eq!(base_subject("Replan"), "replan");
        assert_eq!(base_subject("Re:"), "");
        assert_eq!(base_subject(""), "");
    }

    #[test]
    fn a_mail_that_names_a_known_message_id_under_another_subject_is_not_in_that_thread() {
        // y names the Message-ID of a, and nothing else joins them: y has a thread of its own, and its key is not a's.
        let nodes = [
            about("Plan", node("a", &[], 10)),
            about("Re: Plan", node("b", &["a"], 20)),
            about("Hello", node("y", &["a"], 30)),
        ];
        let groups = group(&nodes);
        assert_eq!(
            groups,
            vec![
                Group {
                    key: "a".into(),
                    members: vec![0, 1]
                },
                Group {
                    key: "y".into(),
                    members: vec![2]
                }
            ]
        );
        // The same when the outsider's mail comes first.
        let nodes = [
            about("Hello", node("y", &["a"], 5)),
            about("Plan", node("a", &[], 10)),
        ];
        assert_eq!(group(&nodes).len(), 2);
        // What the References of each node come to: y's is empty, so a search that names a does not take y as belonging to it.
        let kept = linked(&nodes);
        assert!(kept[0].refs.is_empty() && !kept[0].belongs_to("a"));
    }

    #[test]
    fn two_mails_that_name_a_message_id_that_is_not_here_join_only_under_one_subject() {
        let nodes = [
            about("Plan", node("r1", &["gone"], 10)),
            about("Re: Plan", node("r2", &["gone"], 20)),
            about("Hello", node("r3", &["gone"], 30)),
        ];
        let groups = group(&nodes);
        assert_eq!(groups.len(), 2);
        assert_eq!(groups[0].key, "gone");
        assert_eq!(groups[0].members, vec![0, 1]);
        assert_eq!(groups[1].key, "r3");
    }

    #[test]
    fn a_mail_without_a_subject_joins_no_thread_that_has_one() {
        let nodes = [
            about("Plan", node("a", &[], 10)),
            about("", node("y", &["a"], 20)),
        ];
        assert_eq!(group(&nodes).len(), 2);
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
