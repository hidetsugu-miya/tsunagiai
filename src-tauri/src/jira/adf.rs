//! Atlassian Document Format (ADF) read as Markdown (J-2, #871): the description and the comments of a ticket are ADF in Jira Cloud's REST API v3, and the ticket's tab draws them as Markdown.
//!
//! The shapes are the ones of Atlassian's ADF schema (the JSON schema of `@atlaskit/adf-schema`, read on 2026-11-25): a node is `{type, attrs?, content?, marks?}`, a text node has `text`, and a mark is `{type, attrs?}`.
//! The conversion is a pure function and never fails: what it does not know is read for the text it holds (or dropped when it holds none), so a node that Atlassian adds later shows its text instead of an error.
//! What the text says is Jira's, not the app's, so it is escaped: a character that Markdown would read as markup is written with a backslash, and a link keeps `http` and `https` only. The result goes through the app's sanitizer before it is drawn (`markdownHtml`).

use chrono::DateTime;
use serde_json::Value;

/// How deep the nodes are followed (the parser of `serde_json` stops at 128 already); what lies deeper is dropped.
const MAX_DEPTH: usize = 40;
/// What stands for a file of Jira that the tab cannot show (a file needs the credential).
const FILE_NOTE: &str = "（添付ファイル）";

/// The Markdown of an ADF document. `null`, a number and the like give nothing; a plain string (the form older APIs gave) is taken as text.
pub(super) fn adf_to_markdown(doc: &Value) -> String {
    match doc {
        Value::String(text) => escape(text, true).trim().to_owned(),
        Value::Object(_) => blocks(content(doc), 0),
        _ => String::new(),
    }
}

pub(super) fn kind(node: &Value) -> &str {
    node.get("type").and_then(Value::as_str).unwrap_or("")
}

pub(super) fn content(node: &Value) -> &[Value] {
    node.get("content")
        .and_then(Value::as_array)
        .map_or(&[], Vec::as_slice)
}

fn attr<'a>(node: &'a Value, name: &str) -> Option<&'a Value> {
    node.get("attrs")?.get(name)
}

pub(super) fn attr_str<'a>(node: &'a Value, name: &str) -> Option<&'a str> {
    attr(node, name)?.as_str().filter(|s| !s.is_empty())
}

/// The nodes that stand inside a line of text.
fn is_inline(kind: &str) -> bool {
    matches!(
        kind,
        "text"
            | "hardBreak"
            | "mention"
            | "emoji"
            | "date"
            | "status"
            | "inlineCard"
            | "mediaInline"
            | "placeholder"
            | "inlineExtension"
    )
}

fn is_list(node: &Value) -> bool {
    matches!(
        kind(node),
        "bulletList" | "orderedList" | "taskList" | "decisionList"
    )
}

/// Blocks one after another, with a blank line between them.
pub(super) fn blocks(nodes: &[Value], depth: usize) -> String {
    join_blocks(nodes.iter().map(|n| block(n, depth)))
}

/// The non-empty parts with a blank line between them.
fn join_blocks(parts: impl IntoIterator<Item = String>) -> String {
    parts
        .into_iter()
        .filter(|s| !s.is_empty())
        .collect::<Vec<_>>()
        .join("\n\n")
}

fn block(node: &Value, depth: usize) -> String {
    if depth > MAX_DEPTH {
        return String::new();
    }
    let d = depth + 1;
    match kind(node) {
        "paragraph" => inlines(content(node), d),
        "heading" => {
            let level = attr(node, "level")
                .and_then(Value::as_u64)
                .unwrap_or(1)
                .clamp(1, 6) as usize;
            let text = inlines(content(node), d);
            if text.is_empty() {
                text
            } else {
                format!("{} {text}", "#".repeat(level))
            }
        }
        "bulletList" | "decisionList" | "taskList" => list(content(node), d, |_| "- ".to_owned()),
        "orderedList" => {
            let start = attr(node, "order").and_then(Value::as_u64).unwrap_or(1);
            list(content(node), d, |i| format!("{}. ", start + i as u64))
        }
        "codeBlock" => code_block(node),
        "blockquote" | "panel" => quote(&blocks(content(node), d)),
        "rule" => "---".to_owned(),
        "table" => table(node, d),
        "expand" | "nestedExpand" => {
            let body = blocks(content(node), d);
            match attr_str(node, "title") {
                Some(title) => join_blocks([format!("**{}**", escape(title, false)), body]),
                None => body,
            }
        }
        "mediaSingle" | "mediaGroup" => join_blocks(content(node).iter().map(|n| match kind(n) {
            "media" => media(n),
            _ => inlines(content(n), d),
        })),
        "blockCard" | "embedCard" => card(node),
        _ if is_inline(kind(node)) => inlines(std::slice::from_ref(node), d),
        _ => match content(node).first() {
            Some(first) if is_inline(kind(first)) => inlines(content(node), d),
            Some(_) => blocks(content(node), d),
            None => attr_str(node, "text").map_or_else(String::new, |t| escape(t, true)),
        },
    }
}

/// The items of a list, each after its marker (`marker(index)`) and its other lines indented under the text. A task item has its state before its text.
fn list(items: &[Value], depth: usize, marker: impl Fn(usize) -> String) -> String {
    items
        .iter()
        .enumerate()
        .map(|(i, item)| {
            let marker = marker(i);
            let body = match kind(item) {
                "taskItem" => {
                    let done = attr_str(item, "state") == Some("DONE");
                    let state = if done { "☑" } else { "☐" };
                    format!("{state} {}", inlines(content(item), depth))
                }
                "decisionItem" => inlines(content(item), depth),
                _ => item_blocks(content(item), depth),
            };
            let pad = " ".repeat(marker.chars().count());
            let mut lines = body.lines();
            let first = lines.next().unwrap_or("");
            std::iter::once(format!("{marker}{first}"))
                .chain(lines.map(|l| {
                    if l.is_empty() {
                        String::new()
                    } else {
                        format!("{pad}{l}")
                    }
                }))
                .collect::<Vec<_>>()
                .join("\n")
                .trim_end()
                .to_owned()
        })
        .collect::<Vec<_>>()
        .join("\n")
}

/// The blocks of a list item: a list that follows a block stands right under it, anything else after a blank line.
fn item_blocks(nodes: &[Value], depth: usize) -> String {
    let mut out = String::new();
    for node in nodes {
        let text = block(node, depth);
        if text.is_empty() {
            continue;
        }
        if !out.is_empty() {
            out.push_str(if is_list(node) { "\n" } else { "\n\n" });
        }
        out.push_str(&text);
    }
    out
}

fn quote(text: &str) -> String {
    text.lines()
        .map(|l| {
            if l.is_empty() {
                ">".to_owned()
            } else {
                format!("> {l}")
            }
        })
        .collect::<Vec<_>>()
        .join("\n")
}

/// A fenced block. The fence is longer than any run of backticks in the code, and the language is kept only when it is a plain word.
fn code_block(node: &Value) -> String {
    let code: String = content(node)
        .iter()
        .filter_map(|n| n.get("text").and_then(Value::as_str))
        .collect();
    let code = code.trim_end_matches('\n');
    let fence = "`".repeat(longest_run(code, '`').max(2) + 1);
    let language = attr_str(node, "language")
        .filter(|l| {
            l.chars()
                .all(|c| c.is_ascii_alphanumeric() || "+-#._".contains(c))
        })
        .unwrap_or("");
    format!("{fence}{language}\n{code}\n{fence}")
}

fn longest_run(text: &str, c: char) -> usize {
    text.split(|x| x != c).map(str::len).max().unwrap_or(0)
}

/// A table as a Markdown one: its first row is the header (Markdown has no table without one), a row with fewer cells is filled up, and the lines of a cell are joined with `<br>`. Merged cells are not kept.
fn table(node: &Value, depth: usize) -> String {
    let rows: Vec<Vec<String>> = content(node)
        .iter()
        .filter(|r| kind(r) == "tableRow")
        .map(|r| {
            content(r)
                .iter()
                .map(|cell| {
                    blocks(content(cell), depth)
                        .lines()
                        .filter(|l| !l.is_empty())
                        .collect::<Vec<_>>()
                        .join("<br>")
                })
                .collect()
        })
        .collect();
    let columns = rows.iter().map(Vec::len).max().unwrap_or(0);
    if columns == 0 {
        return String::new();
    }
    let line = |cells: &[String]| {
        let cells: Vec<&str> = (0..columns)
            .map(|i| cells.get(i).map_or("", String::as_str))
            .collect();
        format!("| {} |", cells.join(" | "))
    };
    let mut lines = vec![line(&rows[0]), line(&vec!["---".to_owned(); columns])];
    lines.extend(rows[1..].iter().map(|r| line(r)));
    lines.join("\n")
}

/// The text of a line: the nodes in it one after another. What starts a line is escaped when it would start a block.
fn inlines(nodes: &[Value], depth: usize) -> String {
    if depth > MAX_DEPTH {
        return String::new();
    }
    let mut out = String::new();
    let mut line_start = true;
    for node in nodes {
        let piece = inline(node, depth + 1, line_start);
        if piece.is_empty() {
            continue;
        }
        line_start = piece.ends_with('\n');
        out.push_str(&piece);
    }
    out.trim().to_owned()
}

fn inline(node: &Value, depth: usize, line_start: bool) -> String {
    match kind(node) {
        "text" => text(node, line_start),
        "hardBreak" => "  \n".to_owned(),
        "mention" => escape(attr_str(node, "text").unwrap_or("@ユーザー"), false),
        "emoji" => escape(
            attr_str(node, "text")
                .or_else(|| attr_str(node, "shortName"))
                .unwrap_or(""),
            false,
        ),
        "date" => date_text(node).unwrap_or_default(),
        "status" => {
            attr_str(node, "text").map_or_else(String::new, |t| escape(&format!("[{t}]"), false))
        }
        "inlineCard" => card(node),
        "mediaInline" => media(node),
        "placeholder" => escape(attr_str(node, "text").unwrap_or(""), false),
        _ => match content(node) {
            [] => attr_str(node, "text").map_or_else(String::new, |t| escape(t, false)),
            nodes => inlines(nodes, depth),
        },
    }
}

/// A text node with its marks. The marks go around the text without the spaces at its ends, because Markdown does not read `** a **` as bold.
fn text(node: &Value, line_start: bool) -> String {
    let raw = node.get("text").and_then(Value::as_str).unwrap_or("");
    let marks: Vec<&Value> = node
        .get("marks")
        .and_then(Value::as_array)
        .map_or_else(Vec::new, |m| m.iter().collect());
    let has = |name: &str| marks.iter().any(|m| kind(m) == name);
    let written = if has("code") {
        raw.to_owned()
    } else {
        escape(raw, line_start)
    };
    let trimmed = written.trim();
    if trimmed.is_empty() {
        return written;
    }
    let lead = &written[..written.len() - written.trim_start().len()];
    let trail = &written[written.trim_end().len()..];
    let mut core = trimmed.to_owned();
    if has("code") {
        core = code_span(&core);
    }
    if has("em") {
        core = format!("*{core}*");
    }
    if has("strong") {
        core = format!("**{core}**");
    }
    if has("strike") {
        core = format!("~~{core}~~");
    }
    let href = marks
        .iter()
        .find(|m| kind(m) == "link")
        .and_then(|m| attr_str(m, "href"))
        .and_then(web_url);
    if let Some(url) = href {
        core = format!("[{core}]({})", destination(url));
    }
    format!("{lead}{core}{trail}")
}

/// An inline code span: the fence is longer than any run of backticks in it, and a space keeps a backtick at its end from joining the fence.
fn code_span(code: &str) -> String {
    let fence = "`".repeat(longest_run(code, '`') + 1);
    let pad = if code.starts_with('`') || code.ends_with('`') {
        " "
    } else {
        ""
    };
    format!("{fence}{pad}{code}{pad}{fence}")
}

/// `http` and `https` addresses only: anything else is not a link.
pub(super) fn web_url(url: &str) -> Option<&str> {
    let lower = url.to_ascii_lowercase();
    (lower.starts_with("http://") || lower.starts_with("https://")).then_some(url)
}

/// The address of a link as the target of `[text](target)`: what would end or change it is written as a percent code.
fn destination(url: &str) -> String {
    url.chars()
        .filter(|c| !matches!(c, '\n' | '\r'))
        .map(|c| match c {
            ' ' => "%20".to_owned(),
            '(' => "%28".to_owned(),
            ')' => "%29".to_owned(),
            '<' => "%3C".to_owned(),
            '>' => "%3E".to_owned(),
            '\\' => "%5C".to_owned(),
            c => c.to_string(),
        })
        .collect()
}

/// The date of a date node as `YYYY-MM-DD` (in UTC), `None` when it has no usable timestamp.
pub(super) fn date_text(node: &Value) -> Option<String> {
    attr_str(node, "timestamp")
        .and_then(|t| t.parse::<i64>().ok())
        .and_then(DateTime::from_timestamp_millis)
        .map(|d| d.format("%Y-%m-%d").to_string())
}

/// The address a card holds, as the node gives it (not yet checked to be a web address).
pub(super) fn card_url(node: &Value) -> Option<&str> {
    attr_str(node, "url").or_else(|| {
        attr(node, "data")?
            .get("url")?
            .as_str()
            .filter(|s| !s.is_empty())
    })
}

/// A card is an address: the address as a link, or nothing when it is not a web address.
fn card(node: &Value) -> String {
    match card_url(node).and_then(web_url) {
        Some(url) => format!("[{}]({})", escape(url, false), destination(url)),
        None => String::new(),
    }
}

/// A file or an image of Jira stands for itself in a note (it cannot be read without the credential); one of the web is a link.
fn media(node: &Value) -> String {
    let alt = attr_str(node, "alt");
    if attr_str(node, "type") == Some("external") {
        if let Some(url) = attr_str(node, "url").and_then(web_url) {
            return format!(
                "[{}]({})",
                escape(alt.unwrap_or(url), false),
                destination(url)
            );
        }
    }
    match alt {
        Some(alt) => format!("（添付ファイル: {}）", escape(alt, false)),
        None => FILE_NOTE.to_owned(),
    }
}

/// Text written so that Markdown reads it as text. A line feed is a hard break. At the start of a line, what would make a heading, a list, a rule or a quote is escaped too.
fn escape(text: &str, line_start: bool) -> String {
    let chars: Vec<char> = text.chars().filter(|&c| c != '\r').collect();
    let mut out = String::with_capacity(text.len());
    let mut start = line_start;
    // The `.` or `)` that ends a number at the start of a line (it would make an ordered list).
    let mut number_end = None;
    for (i, &c) in chars.iter().enumerate() {
        if c == '\n' {
            out.push_str("  \n");
            start = true;
            number_end = None;
            continue;
        }
        if start && c.is_ascii_digit() && number_end.is_none() {
            let run = chars[i..].iter().take_while(|d| d.is_ascii_digit()).count();
            if matches!(chars.get(i + run), Some('.' | ')')) {
                number_end = Some(i + run);
            }
        }
        if "\\`*_[]<>&~|".contains(c) || (start && "#+-=".contains(c)) || number_end == Some(i) {
            out.push('\\');
        }
        out.push(c);
        start = start && c == ' ';
    }
    out
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::{json, Value};

    fn doc(content: Value) -> Value {
        json!({"version": 1, "type": "doc", "content": content})
    }

    fn para(content: Value) -> Value {
        json!({"type": "paragraph", "content": content})
    }

    fn txt(text: &str) -> Value {
        json!({"type": "text", "text": text})
    }

    fn marked(text: &str, marks: Value) -> Value {
        json!({"type": "text", "text": text, "marks": marks})
    }

    fn md(content: Value) -> String {
        adf_to_markdown(&doc(content))
    }

    /// One paragraph holding the inline nodes.
    fn line(nodes: Value) -> String {
        md(json!([para(nodes)]))
    }

    #[test]
    fn paragraphs_are_separated_by_a_blank_line_and_empty_ones_are_dropped() {
        let out = md(json!([
            para(json!([txt("one")])),
            para(json!([])),
            json!({"type": "paragraph"}),
            para(json!([txt("two")]))
        ]));
        assert_eq!(out, "one\n\ntwo");
    }

    #[test]
    fn marks_wrap_the_text_but_not_the_spaces_around_it() {
        assert_eq!(
            line(json!([marked("bold", json!([{"type": "strong"}]))])),
            "**bold**"
        );
        assert_eq!(line(json!([marked("it", json!([{"type": "em"}]))])), "*it*");
        assert_eq!(
            line(json!([marked("gone", json!([{"type": "strike"}]))])),
            "~~gone~~"
        );
        assert_eq!(
            line(json!([marked(
                "x",
                json!([{"type": "underline"}, {"type": "textColor", "attrs": {"color": "#ff0000"}}])
            )])),
            "x"
        );
        assert_eq!(
            line(json!([
                txt("a"),
                marked(" bold ", json!([{"type": "strong"}])),
                txt("b")
            ])),
            "a **bold** b"
        );
        assert_eq!(
            line(json!([marked(
                "both",
                json!([{"type": "strong"}, {"type": "em"}])
            )])),
            "***both***"
        );
        assert_eq!(
            line(json!([marked("   ", json!([{"type": "strong"}]))])),
            ""
        );
    }

    #[test]
    fn code_marks_keep_the_text_as_it_is_and_get_a_longer_fence_for_backticks() {
        let code = json!([{"type": "code"}]);
        assert_eq!(line(json!([marked("a*b_c", code.clone())])), "`a*b_c`");
        assert_eq!(line(json!([marked("a`b", code.clone())])), "``a`b``");
        assert_eq!(line(json!([marked("`a", code)])), "`` `a ``");
    }

    #[test]
    fn a_link_keeps_web_addresses_only_and_writes_what_would_end_it_as_a_code() {
        let link = |href: &str| json!([{"type": "link", "attrs": {"href": href}}]);
        assert_eq!(
            line(json!([marked(
                "page",
                link("https://example.com/a b(c)?q=<1>")
            )])),
            "[page](https://example.com/a%20b%28c%29?q=%3C1%3E)"
        );
        assert_eq!(
            line(json!([marked("page", link("HTTP://example.com"))])),
            "[page](HTTP://example.com)"
        );
        assert_eq!(
            line(json!([marked("page", link("javascript:alert(1)"))])),
            "page"
        );
        assert_eq!(
            line(json!([marked("mail", link("mailto:a@example.com"))])),
            "mail"
        );
        assert_eq!(line(json!([marked("rel", link("/browse/EX-1"))])), "rel");
        let both =
            json!([{"type": "strong"}, {"type": "link", "attrs": {"href": "https://example.com"}}]);
        assert_eq!(
            line(json!([marked("go", both)])),
            "[**go**](https://example.com)"
        );
    }

    #[test]
    fn text_is_escaped_so_that_markdown_reads_it_as_text() {
        assert_eq!(
            line(json!([txt("a*b_c [d] <e> & f|g ~h `i` \\j")])),
            "a\\*b\\_c \\[d\\] \\<e\\> \\& f\\|g \\~h \\`i\\` \\\\j"
        );
        assert_eq!(
            line(json!([txt("<script>alert(1)</script>")])),
            "\\<script\\>alert(1)\\</script\\>"
        );
        // What starts a line would start a block.
        assert_eq!(line(json!([txt("# not a heading")])), "\\# not a heading");
        assert_eq!(line(json!([txt("- not a list")])), "\\- not a list");
        assert_eq!(line(json!([txt("+ not a list")])), "\\+ not a list");
        assert_eq!(line(json!([txt("> not a quote")])), "\\> not a quote");
        assert_eq!(
            line(json!([txt("=== not a heading")])),
            "\\=== not a heading"
        );
        assert_eq!(line(json!([txt("1. not a list")])), "1\\. not a list");
        assert_eq!(line(json!([txt("12) not a list")])), "12\\) not a list");
        // And what is in the middle of a line does not.
        assert_eq!(
            line(json!([txt("a - b # c 1. d v1.2 + e")])),
            "a - b # c 1. d v1.2 + e"
        );
        assert_eq!(
            line(json!([txt("2026-11-25 and 3 items")])),
            "2026-11-25 and 3 items"
        );
    }

    #[test]
    fn a_line_feed_and_a_hard_break_are_hard_breaks_and_start_a_line() {
        assert_eq!(line(json!([txt("a\nb")])), "a  \nb");
        assert_eq!(
            line(json!([txt("a"), json!({"type": "hardBreak"}), txt("- b")])),
            "a  \n\\- b"
        );
        // A break at the end of a paragraph leaves nothing.
        assert_eq!(line(json!([txt("a"), json!({"type": "hardBreak"})])), "a");
        assert_eq!(line(json!([txt("a\r\nb")])), "a  \nb");
    }

    #[test]
    fn headings_have_their_level_between_1_and_6_and_empty_ones_are_dropped() {
        let heading = |level: u64, text: &str| json!({"type": "heading", "attrs": {"level": level}, "content": [txt(text)]});
        assert_eq!(
            md(json!([
                heading(1, "One"),
                heading(3, "Three"),
                heading(9, "Nine"),
                heading(0, "Zero")
            ])),
            "# One\n\n### Three\n\n###### Nine\n\n# Zero"
        );
        assert_eq!(
            md(json!([
                json!({"type": "heading", "attrs": {"level": 2}, "content": []})
            ])),
            ""
        );
    }

    #[test]
    fn lists_nest_by_the_width_of_their_markers() {
        let item = |content: Value| json!({"type": "listItem", "content": content});
        let nested = json!({"type": "orderedList", "attrs": {"order": 3}, "content": [item(json!([para(json!([txt("b")]))])), item(json!([para(json!([txt("c")]))]))]});
        let bullets = json!({"type": "bulletList", "content": [item(json!([para(json!([txt("a")])), nested])), item(json!([para(json!([txt("d")]))]))]});
        assert_eq!(md(json!([bullets])), "- a\n  3. b\n  4. c\n- d");
        // An ordered list with no number starts at 1, and its continuation lines go under the text.
        let ordered = json!({"type": "orderedList", "content": [item(json!([para(json!([txt("x")])), para(json!([txt("y")]))]))]});
        assert_eq!(md(json!([ordered])), "1. x\n\n   y");
        // A code block in an item is indented as a whole, and an empty item keeps its marker.
        let code = json!({"type": "codeBlock", "content": [txt("let a = 1;")]});
        let with_code = json!({"type": "bulletList", "content": [item(json!([para(json!([txt("a")])), code])), item(json!([]))]});
        assert_eq!(
            md(json!([with_code])),
            "- a\n\n  ```\n  let a = 1;\n  ```\n-"
        );
    }

    #[test]
    fn task_items_show_their_state_and_decisions_are_plain_items() {
        let task = |state: &str, text: &str| json!({"type": "taskItem", "attrs": {"localId": "1", "state": state}, "content": [txt(text)]});
        assert_eq!(
            md(
                json!([{"type": "taskList", "attrs": {"localId": "t"}, "content": [task("TODO", "write"), task("DONE", "test")]}])
            ),
            "- ☐ write\n- ☑ test"
        );
        let decision = json!({"type": "decisionItem", "attrs": {"localId": "1", "state": "DECIDED"}, "content": [txt("ship it")]});
        assert_eq!(
            md(json!([{"type": "decisionList", "attrs": {"localId": "d"}, "content": [decision]}])),
            "- ship it"
        );
    }

    #[test]
    fn a_code_block_keeps_its_text_and_its_word_for_the_language() {
        let block = |attrs: Value, text: &str| json!({"type": "codeBlock", "attrs": attrs, "content": [txt(text)]});
        assert_eq!(
            md(json!([block(
                json!({"language": "rust"}),
                "fn main() {}\n"
            )])),
            "```rust\nfn main() {}\n```"
        );
        assert_eq!(
            md(json!([block(json!({"language": "c++"}), "x")])),
            "```c++\nx\n```"
        );
        // A language that is not a word is not written, and a fence in the code gets a longer one around it.
        assert_eq!(
            md(json!([block(json!({"language": "a b\nc"}), "x")])),
            "```\nx\n```"
        );
        assert_eq!(
            md(json!([block(json!({}), "```\ncode\n```")])),
            "````\n```\ncode\n```\n````"
        );
        assert_eq!(md(json!([json!({"type": "codeBlock"})])), "```\n\n```");
    }

    #[test]
    fn quotes_and_panels_are_quotes_and_a_rule_is_a_line() {
        let two = json!([para(json!([txt("a")])), para(json!([txt("b")]))]);
        assert_eq!(
            md(json!([{"type": "blockquote", "content": two.clone()}])),
            "> a\n>\n> b"
        );
        assert_eq!(
            md(json!([{"type": "panel", "attrs": {"panelType": "info"}, "content": two}])),
            "> a\n>\n> b"
        );
        assert_eq!(
            md(json!([para(json!([txt("a")])), {"type": "rule"}, para(json!([txt("b")]))])),
            "a\n\n---\n\nb"
        );
    }

    #[test]
    fn a_table_has_its_first_row_as_the_header_and_fills_short_rows() {
        let cell =
            |kind: &str, content: Value| json!({"type": kind, "attrs": {}, "content": content});
        let head = json!({"type": "tableRow", "content": [cell("tableHeader", json!([para(json!([txt("Name")]))])), cell("tableHeader", json!([para(json!([txt("Note")]))]))]});
        let first = json!({"type": "tableRow", "content": [cell("tableCell", json!([para(json!([txt("a|b")])), para(json!([txt("second")]))])), cell("tableCell", json!([para(json!([txt("x")]))]))]});
        let short = json!({"type": "tableRow", "content": [cell("tableCell", json!([para(json!([txt("c")]))]))]});
        let table = json!({"type": "table", "attrs": {"layout": "default"}, "content": [head, first, short]});
        assert_eq!(
            md(json!([table])),
            "| Name | Note |\n| --- | --- |\n| a\\|b<br>second | x |\n| c |  |"
        );
        // With no header cell the first row is the header too, and a table with no row is nothing.
        let plain = json!({"type": "table", "content": [{"type": "tableRow", "content": [cell("tableCell", json!([para(json!([txt("h")]))]))]}]});
        assert_eq!(md(json!([plain])), "| h |\n| --- |");
        assert_eq!(md(json!([{"type": "table", "content": []}])), "");
    }

    #[test]
    fn mentions_emoji_dates_statuses_and_cards_are_read_for_their_text() {
        assert_eq!(
            line(
                json!([{"type": "mention", "attrs": {"id": "1", "text": "@Ann"}}, txt(" "), {"type": "mention", "attrs": {"id": "2"}}])
            ),
            "@Ann @ユーザー"
        );
        assert_eq!(
            line(
                json!([{"type": "emoji", "attrs": {"shortName": ":smile:", "text": "😄"}}, {"type": "emoji", "attrs": {"shortName": ":custom:"}}, {"type": "emoji", "attrs": {}}])
            ),
            "😄:custom:"
        );
        assert_eq!(
            line(
                json!([{"type": "date", "attrs": {"timestamp": "1700000000000"}}, txt(" "), {"type": "date", "attrs": {"timestamp": "soon"}}])
            ),
            "2023-11-14"
        );
        assert_eq!(
            line(json!([{"type": "status", "attrs": {"text": "In review", "color": "blue"}}])),
            "\\[In review\\]"
        );
        assert_eq!(
            line(json!([{"type": "inlineCard", "attrs": {"url": "https://example.com/a_b"}}])),
            "[https://example.com/a\\_b](https://example.com/a_b)"
        );
        assert_eq!(
            line(
                json!([{"type": "inlineCard", "attrs": {"data": {"url": "https://example.com/x"}}}])
            ),
            "[https://example.com/x](https://example.com/x)"
        );
        assert_eq!(
            line(
                json!([{"type": "inlineCard", "attrs": {"url": "javascript:alert(1)"}}, {"type": "inlineCard", "attrs": {"data": {"name": "no address"}}}])
            ),
            ""
        );
        assert_eq!(md(json!([{"type": "blockCard", "attrs": {"url": "https://example.com/card"}}, {"type": "embedCard", "attrs": {"url": "https://example.com/embed"}}])), "[https://example.com/card](https://example.com/card)\n\n[https://example.com/embed](https://example.com/embed)");
        assert_eq!(
            line(json!([{"type": "placeholder", "attrs": {"text": "Type here"}}])),
            "Type here"
        );
    }

    #[test]
    fn a_file_of_jira_is_a_note_and_a_picture_of_the_web_is_a_link() {
        let file = json!({"type": "media", "attrs": {"type": "file", "id": "abc", "collection": "c", "alt": "shot.png"}});
        let bare =
            json!({"type": "media", "attrs": {"type": "file", "id": "abc", "collection": "c"}});
        let external = json!({"type": "media", "attrs": {"type": "external", "url": "https://example.com/p.png", "alt": "pic"}});
        let unsafe_url =
            json!({"type": "media", "attrs": {"type": "external", "url": "javascript:alert(1)"}});
        assert_eq!(
            md(json!([{"type": "mediaSingle", "attrs": {"layout": "center"}, "content": [file]}])),
            "（添付ファイル: shot.png）"
        );
        assert_eq!(
            md(json!([{"type": "mediaGroup", "content": [bare.clone(), external, unsafe_url]}])),
            "（添付ファイル）\n\n[pic](https://example.com/p.png)\n\n（添付ファイル）"
        );
        assert_eq!(
            md(
                json!([{"type": "mediaSingle", "content": [bare.clone(), {"type": "caption", "content": [txt("a caption")]}]}])
            ),
            "（添付ファイル）\n\na caption"
        );
        assert_eq!(
            line(
                json!([txt("see "), {"type": "mediaInline", "attrs": {"id": "i", "collection": "c"}}])
            ),
            "see （添付ファイル）"
        );
    }

    #[test]
    fn an_expand_shows_its_title_and_its_content() {
        let expand = json!({"type": "expand", "attrs": {"title": "More *info*"}, "content": [para(json!([txt("inside")]))]});
        assert_eq!(md(json!([expand])), "**More \\*info\\***\n\ninside");
        let untitled =
            json!({"type": "nestedExpand", "attrs": {}, "content": [para(json!([txt("inside")]))]});
        assert_eq!(md(json!([untitled])), "inside");
    }

    #[test]
    fn a_node_that_is_not_known_shows_the_text_it_holds() {
        let column = |text: &str| json!({"type": "layoutColumn", "attrs": {"width": 50}, "content": [para(json!([txt(text)]))]});
        assert_eq!(
            md(json!([{"type": "layoutSection", "content": [column("left"), column("right")]}])),
            "left\n\nright"
        );
        assert_eq!(
            md(json!([{"type": "futureBlock", "content": [para(json!([txt("kept")]))]}])),
            "kept"
        );
        assert_eq!(
            md(
                json!([{"type": "bodiedExtension", "attrs": {"extensionKey": "k"}, "content": [para(json!([txt("body")]))]}])
            ),
            "body"
        );
        assert_eq!(
            md(json!([{"type": "extension", "attrs": {"extensionKey": "k", "text": "A macro"}}])),
            "A macro"
        );
        assert_eq!(
            md(json!([{"type": "extension", "attrs": {"extensionKey": "k"}}])),
            ""
        );
        assert_eq!(
            line(
                json!([txt("a "), {"type": "inlineExtension", "attrs": {"text": "inline macro"}}, txt(" "), {"type": "futureInline", "content": [txt("nested")]}])
            ),
            "a inline macro nested"
        );
        // A text node outside a paragraph is a paragraph of its own.
        assert_eq!(md(json!([txt("loose")])), "loose");
        assert_eq!(
            md(
                json!([{"type": "futureBlock", "content": [txt("a"), {"type": "hardBreak"}, txt("b")]}])
            ),
            "a  \nb"
        );
    }

    #[test]
    fn nodes_far_down_are_dropped_and_the_rest_is_read() {
        let nest = |depth: usize| {
            (0..depth).fold(
                para(json!([txt("deep")])),
                |inner, _| json!({"type": "blockquote", "content": [inner]}),
            )
        };
        assert_eq!(md(json!([nest(2)])), "> > deep");
        assert_eq!(md(json!([nest(200), para(json!([txt("after")]))])), "after");
    }

    #[test]
    fn what_is_not_a_document_gives_nothing_or_its_text() {
        assert_eq!(adf_to_markdown(&Value::Null), "");
        assert_eq!(adf_to_markdown(&json!(7)), "");
        assert_eq!(adf_to_markdown(&json!({"type": "doc"})), "");
        assert_eq!(adf_to_markdown(&json!([])), "");
        assert_eq!(
            adf_to_markdown(&json!("# plain\ntext")),
            "\\# plain  \ntext"
        );
    }

    #[test]
    fn a_description_of_several_parts_reads_as_one_document() {
        let item = |text: &str| json!({"type": "listItem", "content": [para(json!([txt(text)]))]});
        let out = md(json!([
            {"type": "heading", "attrs": {"level": 2}, "content": [txt("Goal")]},
            para(json!([txt("Show the "), marked("ticket", json!([{"type": "strong"}])), txt(" in a tab, see "), marked("the spec", json!([{"type": "link", "attrs": {"href": "https://example.com/spec"}}])), txt(".")])),
            {"type": "bulletList", "content": [item("one"), item("two")]},
            {"type": "codeBlock", "attrs": {"language": "ts"}, "content": [txt("open(key);")]},
            {"type": "blockquote", "content": [para(json!([txt("quoted")]))]},
        ]));
        assert_eq!(out, "## Goal\n\nShow the **ticket** in a tab, see [the spec](https://example.com/spec).\n\n- one\n- two\n\n```ts\nopen(key);\n```\n\n> quoted");
    }
}
