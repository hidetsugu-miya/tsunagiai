//! Markdown written back as ADF (J-2, #873): what the ticket's tab saves when the description is edited, and when a comment is added.
//!
//! The description was read as Markdown (`adf::adf_to_markdown`), which cannot say everything ADF can: a mention, a status, a date, a file, a panel, an expand, a merged cell, an underline or a color is written as the text it shows, or as a note, or not at all. So the Markdown is not turned into a whole new document. `merged` puts it back into the document that Jira holds now:
//! every block of that document is read as Markdown again, by the same function and the same parser as the new text, and the two lists are matched (the longest common run). A block that the owner did not change is kept as Jira has it, whatever Markdown could not say about it. A block that was changed is made again from the Markdown, and the mentions, emoji, dates, statuses and cards that were in the old line come back where their text still stands. Inside a list or a quote the match goes on item by item, so editing one item leaves the others as they are. A block that renders as nothing (a macro, an empty paragraph) is not in the editor and is always kept.
//! A block that was changed loses what Markdown cannot say, besides the elements above: the underline, the color, the size, the alignment, a panel's kind, the merged cells and the colors of a table, and the rows of a task list that are not tasks. Those are written in `requirements/jira.md`.
//!
//! The functions are pure and never fail. What the new text holds is the owner's own, and still only `http` and `https` links are kept, as when ADF is read. A node is made to fit the place it stands in (the schema of `@atlaskit/adf-schema`, read on 2026-11-25: a list item and a quote hold no heading, a list item no quote, and a quote no task list), by writing a heading as a bold paragraph and a quote as its content.

use std::collections::{HashMap, HashSet};

use pulldown_cmark::{CodeBlockKind, Event, Options, Parser, Tag, TagEnd};
use serde_json::{json, Value};

use super::adf::{self, attr_str, card_url, content, date_text, kind, web_url};

/// How deep lists and quotes are followed; what lies deeper is dropped. The same as the reading of ADF.
const MAX_DEPTH: usize = 40;
/// The largest product of two lengths that the match of blocks works out in full; above it a changed region is taken as replaced whole.
const MATCH_LIMIT: usize = 1_000_000;
/// The marks of a task item in the Markdown that the reading writes (`adf`).
const TODO: char = '☐';
const DONE: char = '☑';

/// Where a block stands: the document, a list item or a quote. What each may hold is the schema's.
#[derive(Clone, Copy, PartialEq)]
enum Ctx {
    Doc,
    Item,
    Quote,
}

/// The ADF blocks of a Markdown text.
pub(super) fn markdown_to_blocks(markdown: &str) -> Vec<Value> {
    let options =
        Options::ENABLE_TABLES | Options::ENABLE_STRIKETHROUGH | Options::ENABLE_TASKLISTS;
    let mut builder = Builder {
        events: Parser::new_ext(markdown, options).collect(),
        pos: 0,
    };
    builder.blocks(Ctx::Doc, 0)
}

/// The blocks of the new description: `markdown` put into `old`, the blocks of the document that Jira holds (see the top of this file). The ids that a task needs are not here; `with_ids` gives them.
pub(super) fn merged(old: &[Value], markdown: &str) -> Vec<Value> {
    merge(old, markdown_to_blocks(markdown), &norm_block, 0)
}

/// Gives each task list and task item that has no `localId` one (the schema requires it), different from every id the nodes hold.
pub(super) fn with_ids(nodes: &mut [Value]) {
    fn collect(node: &Value, used: &mut HashSet<String>) {
        if let Some(id) = node
            .get("attrs")
            .and_then(|a| a.get("localId"))
            .and_then(Value::as_str)
        {
            used.insert(id.to_owned());
        }
        content(node).iter().for_each(|c| collect(c, used));
    }
    fn assign(node: &mut Value, used: &mut HashSet<String>, next: &mut u64) {
        let task = matches!(kind(node), "taskList" | "taskItem");
        if task && node.pointer("/attrs/localId").is_none() {
            let id = loop {
                *next += 1;
                let id = format!("00000000-0000-4000-8000-{:012x}", *next);
                if used.insert(id.clone()) {
                    break id;
                }
            };
            if let Some(map) = node.as_object_mut() {
                map.entry("attrs")
                    .or_insert_with(|| json!({}))
                    .as_object_mut()
                    .map(|a| a.insert("localId".into(), Value::String(id)));
            }
        }
        if let Some(children) = node.get_mut("content").and_then(Value::as_array_mut) {
            children.iter_mut().for_each(|c| assign(c, used, next));
        }
    }
    let mut used = HashSet::new();
    nodes.iter().for_each(|n| collect(n, &mut used));
    let mut next = 0;
    nodes
        .iter_mut()
        .for_each(|n| assign(n, &mut used, &mut next));
}

struct Builder<'a> {
    events: Vec<Event<'a>>,
    pos: usize,
}

/// A mark that is open while the inline events are read.
#[derive(Clone, PartialEq)]
enum Mark {
    Strong,
    Em,
    Strike,
    Code,
    /// The address, `None` for one that is not a web address (the text is kept, the link is not).
    Link(Option<String>),
}

fn paragraph(line: Vec<Value>) -> Value {
    json!({"type": "paragraph", "content": line})
}

/// The marks of a text node. Code takes no other style in ADF (only a link), so the styles of a code span are left out.
fn marks_of(open: &[Mark]) -> Vec<Value> {
    let link = open.iter().rev().find_map(|m| match m {
        Mark::Link(Some(href)) => Some(json!({"type": "link", "attrs": {"href": href}})),
        _ => None,
    });
    let mut marks = Vec::new();
    if open.contains(&Mark::Code) {
        marks.push(json!({"type": "code"}));
    } else {
        for (mark, name) in [
            (Mark::Strong, "strong"),
            (Mark::Em, "em"),
            (Mark::Strike, "strike"),
        ] {
            if open.contains(&mark) {
                marks.push(json!({"type": name}));
            }
        }
    }
    marks.extend(link);
    marks
}

fn push_text(out: &mut Vec<Value>, text: &str, open: &[Mark]) {
    if text.is_empty() {
        return;
    }
    let marks = marks_of(open);
    let mut node = json!({"type": "text", "text": text});
    if !marks.is_empty() {
        node["marks"] = Value::Array(marks);
    }
    out.push(node);
}

fn is_br(html: &str) -> bool {
    let html = html.trim().to_ascii_lowercase();
    matches!(html.as_str(), "<br>" | "<br/>" | "<br />")
}

/// Adjacent text nodes with the same marks become one, and a line break at either end of a line is dropped.
fn finish_line(nodes: Vec<Value>) -> Vec<Value> {
    let mut out: Vec<Value> = Vec::new();
    for node in nodes {
        if let Some(last) = out.last_mut() {
            if kind(last) == "text"
                && kind(&node) == "text"
                && last.get("marks") == node.get("marks")
            {
                let joined = format!(
                    "{}{}",
                    last["text"].as_str().unwrap_or(""),
                    node["text"].as_str().unwrap_or("")
                );
                last["text"] = Value::String(joined);
                continue;
            }
        }
        if kind(&node) == "hardBreak" && out.is_empty() {
            continue;
        }
        out.push(node);
    }
    while out.last().is_some_and(|n| kind(n) == "hardBreak") {
        out.pop();
    }
    out
}

fn is_inline_start(tag: &Tag) -> bool {
    matches!(
        tag,
        Tag::Emphasis | Tag::Strong | Tag::Strikethrough | Tag::Link { .. } | Tag::Image { .. }
    )
}

impl<'a> Builder<'a> {
    fn peek(&self) -> Option<&Event<'a>> {
        self.events.get(self.pos)
    }

    /// Takes the end of the block that was entered, if it is next.
    fn end(&mut self) {
        if matches!(self.peek(), Some(Event::End(_))) {
            self.pos += 1;
        }
    }

    /// Takes the rest of the block that was entered, up to and with its end.
    fn skip(&mut self) {
        let mut depth = 1;
        while let Some(event) = self.events.get(self.pos) {
            self.pos += 1;
            match event {
                Event::Start(_) => depth += 1,
                Event::End(_) => {
                    depth -= 1;
                    if depth == 0 {
                        break;
                    }
                }
                _ => {}
            }
        }
    }

    /// The blocks up to the end of the block that holds them (its end is left to the caller).
    fn blocks(&mut self, ctx: Ctx, depth: usize) -> Vec<Value> {
        let mut out = Vec::new();
        while let Some(event) = self.peek().cloned() {
            match event {
                Event::End(_) => break,
                Event::Start(tag) if !is_inline_start(&tag) => {
                    self.pos += 1;
                    if depth > MAX_DEPTH {
                        self.skip();
                        continue;
                    }
                    self.block(tag, ctx, depth, &mut out);
                }
                Event::Rule => {
                    self.pos += 1;
                    out.extend(degrade(json!({"type": "rule"}), ctx));
                }
                Event::TaskListMarker(_) => self.pos += 1,
                // Text that stands in a block with no paragraph of its own (a tight list item).
                _ => {
                    let line = self.inlines();
                    if !line.is_empty() {
                        out.push(paragraph(line));
                    }
                }
            }
        }
        out
    }

    /// One block whose start was taken.
    fn block(&mut self, tag: Tag<'a>, ctx: Ctx, depth: usize, out: &mut Vec<Value>) {
        match tag {
            Tag::Paragraph => {
                let line = self.inlines();
                self.end();
                if !line.is_empty() {
                    out.push(paragraph(line));
                }
            }
            Tag::Heading { level, .. } => {
                let line = self.inlines();
                self.end();
                if !line.is_empty() {
                    out.extend(degrade(
                        json!({"type": "heading", "attrs": {"level": level as usize}, "content": line}),
                        ctx,
                    ));
                }
            }
            Tag::BlockQuote(_) => {
                let inner = self.blocks(Ctx::Quote, depth + 1);
                self.end();
                if !inner.is_empty() {
                    out.extend(degrade(
                        json!({"type": "blockquote", "content": inner}),
                        ctx,
                    ));
                }
            }
            Tag::CodeBlock(code_kind) => {
                let mut code = String::new();
                while let Some(Event::Text(text)) = self.peek() {
                    code.push_str(text);
                    self.pos += 1;
                }
                self.end();
                out.push(code_block(&code, &code_kind));
            }
            Tag::List(first) => {
                let mut items = Vec::new();
                while matches!(self.peek(), Some(Event::Start(Tag::Item))) {
                    self.pos += 1;
                    let mut task = None;
                    if let Some(Event::TaskListMarker(done)) = self.peek() {
                        task = Some(*done);
                        self.pos += 1;
                    }
                    let blocks = self.blocks(Ctx::Item, depth + 1);
                    self.end();
                    items.push((task, blocks));
                }
                self.end();
                if !items.is_empty() {
                    out.push(list_node(first, items, ctx));
                }
            }
            Tag::Table(_) => {
                let table = self.table();
                out.extend(degrade(table, ctx));
            }
            Tag::HtmlBlock => {
                let mut html = String::new();
                while let Some(Event::Html(text)) = self.peek() {
                    html.push_str(text);
                    self.pos += 1;
                }
                self.end();
                let html = html.trim();
                if !html.is_empty() && !html.starts_with("<!--") {
                    out.push(paragraph(vec![json!({"type": "text", "text": html})]));
                }
            }
            _ => self.skip(),
        }
    }

    /// A table whose start was taken: the first row is the header.
    fn table(&mut self) -> Value {
        let mut rows: Vec<Vec<Vec<Value>>> = Vec::new();
        while let Some(event) = self.peek().cloned() {
            self.pos += 1;
            match event {
                Event::Start(Tag::TableHead | Tag::TableRow) => {
                    let mut cells = Vec::new();
                    while matches!(self.peek(), Some(Event::Start(Tag::TableCell))) {
                        self.pos += 1;
                        cells.push(self.inlines());
                        self.end();
                    }
                    self.end();
                    rows.push(cells);
                }
                Event::End(TagEnd::Table) => break,
                _ => {}
            }
        }
        let columns = rows.iter().map(Vec::len).max().unwrap_or(0);
        let rows: Vec<Value> = rows
            .into_iter()
            .enumerate()
            .map(|(i, mut cells)| {
                cells.resize(columns, Vec::new());
                let name = if i == 0 { "tableHeader" } else { "tableCell" };
                let cells: Vec<Value> = cells
                    .into_iter()
                    .map(|line| json!({"type": name, "content": [paragraph(line)]}))
                    .collect();
                json!({"type": "tableRow", "content": cells})
            })
            .collect();
        json!({"type": "table", "attrs": {"isNumberColumnEnabled": false, "layout": "default"}, "content": rows})
    }

    /// The nodes of a line, up to the first event that is not part of one.
    fn inlines(&mut self) -> Vec<Value> {
        let mut out = Vec::new();
        let mut open: Vec<Mark> = Vec::new();
        // Where each open image began in `out`, and its address: an image has no place in ADF here, so it is its alt text as a link, or its address when it has none.
        let mut images: Vec<(usize, String)> = Vec::new();
        while let Some(event) = self.peek().cloned() {
            match event {
                Event::Start(Tag::Emphasis) => open.push(Mark::Em),
                Event::Start(Tag::Strong) => open.push(Mark::Strong),
                Event::Start(Tag::Strikethrough) => open.push(Mark::Strike),
                Event::Start(Tag::Link { dest_url, .. }) => {
                    open.push(Mark::Link(web_url(&dest_url).map(str::to_owned)));
                }
                Event::Start(Tag::Image { dest_url, .. }) => {
                    images.push((out.len(), dest_url.to_string()));
                    open.push(Mark::Link(web_url(&dest_url).map(str::to_owned)));
                }
                Event::End(TagEnd::Image) => {
                    if let Some((at, dest)) = images.pop() {
                        if out.len() == at {
                            push_text(&mut out, &dest, &open);
                        }
                    }
                    open.pop();
                }
                Event::End(
                    TagEnd::Emphasis | TagEnd::Strong | TagEnd::Strikethrough | TagEnd::Link,
                ) => {
                    open.pop();
                }
                Event::Text(text) | Event::Html(text) => push_text(&mut out, &text, &open),
                Event::Code(text) => {
                    let mut with_code = open.clone();
                    with_code.push(Mark::Code);
                    push_text(&mut out, &text, &with_code);
                }
                Event::SoftBreak => push_text(&mut out, " ", &open),
                Event::HardBreak => out.push(json!({"type": "hardBreak"})),
                Event::InlineHtml(html) if is_br(&html) => out.push(json!({"type": "hardBreak"})),
                Event::InlineHtml(html) => push_text(&mut out, &html, &open),
                Event::FootnoteReference(name) => {
                    push_text(&mut out, &format!("[^{name}]"), &open);
                }
                Event::Start(_) | Event::End(_) | Event::Rule | Event::TaskListMarker(_) => break,
                _ => {}
            }
            self.pos += 1;
        }
        finish_line(out)
    }
}

fn code_block(code: &str, code_kind: &CodeBlockKind) -> Value {
    let mut node = json!({"type": "codeBlock"});
    let language = match code_kind {
        CodeBlockKind::Fenced(info) => info
            .split_whitespace()
            .next()
            .filter(|l| {
                l.chars()
                    .all(|c| c.is_ascii_alphanumeric() || "+-#._".contains(c))
            })
            .map(str::to_owned),
        CodeBlockKind::Indented => None,
    };
    if let Some(language) = language {
        node["attrs"] = json!({"language": language});
    }
    let code = code.trim_end_matches('\n');
    if !code.is_empty() {
        node["content"] = json!([{"type": "text", "text": code}]);
    }
    node
}

/// The state of a task that the text of an item starts with (`☐ ` or `☑ `), when its first block is a paragraph.
fn prefix_state(blocks: &[Value]) -> Option<bool> {
    let first = blocks.first().filter(|b| kind(b) == "paragraph")?;
    let text = content(first).first()?.get("text")?.as_str()?;
    [(TODO, false), (DONE, true)]
        .into_iter()
        .find(|(mark, _)| {
            text.strip_prefix(*mark)
                .is_some_and(|rest| rest.starts_with(' '))
        })
        .map(|(_, done)| done)
}

/// The line of a paragraph without the two characters of a task mark at its start.
fn without_prefix(line: &[Value]) -> Vec<Value> {
    let mut line = line.to_vec();
    if let Some(text) = line
        .first()
        .and_then(|n| n.get("text"))
        .and_then(Value::as_str)
    {
        let rest: String = text.chars().skip(2).collect();
        if rest.is_empty() {
            line.remove(0);
        } else {
            line[0]["text"] = Value::String(rest);
        }
    }
    line
}

/// A list from its items (each with the state of its task mark, when the Markdown had one). A list whose items are all tasks, and have one line each, is a task list where the place may hold one; any other is a bullet or an ordered list, in which a task mark that Markdown had stays as its character.
fn list_node(first: Option<u64>, items: Vec<(Option<bool>, Vec<Value>)>, ctx: Ctx) -> Value {
    let states: Vec<Option<bool>> = items
        .iter()
        .map(|(task, blocks)| task.or_else(|| prefix_state(blocks)))
        .collect();
    let tasks = ctx != Ctx::Quote
        && states.iter().all(Option::is_some)
        && items
            .iter()
            .all(|(_, b)| b.len() <= 1 && b.iter().all(|n| kind(n) == "paragraph"));
    if tasks {
        let content: Vec<Value> = items
            .iter()
            .zip(&states)
            .map(|((task, blocks), state)| {
                let line = blocks
                    .first()
                    .map_or_else(Vec::new, |b| content(b).to_vec());
                let line = if task.is_some() {
                    line
                } else {
                    without_prefix(&line)
                };
                let state = if *state == Some(true) { "DONE" } else { "TODO" };
                json!({"type": "taskItem", "attrs": {"state": state}, "content": line})
            })
            .collect();
        return json!({"type": "taskList", "content": content});
    }
    let content: Vec<Value> = items
        .into_iter()
        .map(|(task, mut blocks)| {
            if let Some(done) = task {
                let mark = format!("{} ", if done { DONE } else { TODO });
                match blocks.first_mut().filter(|b| kind(b) == "paragraph") {
                    Some(first) => {
                        if let Some(line) = first.get_mut("content").and_then(Value::as_array_mut) {
                            let plain = |n: &Value| kind(n) == "text" && n.get("marks").is_none();
                            match line.first_mut().filter(|n| plain(n)) {
                                Some(head) => {
                                    let text =
                                        format!("{mark}{}", head["text"].as_str().unwrap_or(""));
                                    head["text"] = Value::String(text);
                                }
                                None => line.insert(0, json!({"type": "text", "text": mark})),
                            }
                        }
                    }
                    None => {
                        blocks.insert(0, paragraph(vec![json!({"type": "text", "text": mark})]))
                    }
                }
            }
            if blocks.is_empty() {
                blocks.push(json!({"type": "paragraph"}));
            }
            json!({"type": "listItem", "content": blocks})
        })
        .collect();
    match first {
        Some(start) => {
            let mut list = json!({"type": "orderedList", "content": content});
            if start != 1 {
                list["attrs"] = json!({"order": start});
            }
            list
        }
        None => json!({"type": "bulletList", "content": content}),
    }
}

/// A block as the place it stands in takes it: the document takes every block, a list item and a quote take fewer. A heading there is a bold paragraph, a quote is its content, a table is the paragraphs of its cells, and a rule is dropped.
fn degrade(node: Value, ctx: Ctx) -> Vec<Value> {
    if ctx == Ctx::Doc {
        return vec![node];
    }
    match kind(&node) {
        "heading" => {
            let mut line = content(&node).to_vec();
            for text in &mut line {
                let marks = text.get("marks").and_then(Value::as_array).cloned();
                let marks = marks.unwrap_or_default();
                if kind(text) == "text" && !marks.iter().any(|m| kind(m) == "code") {
                    let mut marks = marks;
                    marks.push(json!({"type": "strong"}));
                    text["marks"] = Value::Array(marks);
                }
            }
            vec![paragraph(line)]
        }
        "blockquote" => content(&node).to_vec(),
        "rule" => Vec::new(),
        "table" => content(&node)
            .iter()
            .flat_map(content)
            .flat_map(|cell| content(cell).to_vec())
            .collect(),
        _ => vec![node],
    }
}

// ---- The new text put into the old document ----

/// What a block of the old document is once it is Markdown and Markdown again: the blocks that the new text would hold if the owner had not touched it.
fn norm_block(unit: &[Value]) -> Vec<Value> {
    markdown_to_blocks(&adf::blocks(unit, 0))
}

/// The same for an item of a list: it is written as the only item of a list, read again, and the items of the list that comes out are its norm (none when the list did not come out, which keeps the item as it is).
fn norm_item(unit: &[Value]) -> Vec<Value> {
    let wrap = if unit.first().is_some_and(|i| kind(i) == "taskItem") {
        "taskList"
    } else {
        "bulletList"
    };
    let list = json!({"type": wrap, "content": unit});
    markdown_to_blocks(&adf::blocks(&[list], 0))
        .first()
        .filter(|n| matches!(kind(n), "bulletList" | "orderedList" | "taskList"))
        .map_or_else(Vec::new, |n| content(n).to_vec())
}

enum Op {
    Keep(usize, usize),
    Del(usize),
    Ins(usize),
}

/// The operations that turn `a` into `b`: what the two share at the start and at the end, and the longest common run of the middle.
fn diff(a: &[&Value], b: &[&Value]) -> Vec<Op> {
    let head = a.iter().zip(b).take_while(|(x, y)| x == y).count();
    let tail = a[head..]
        .iter()
        .rev()
        .zip(b[head..].iter().rev())
        .take_while(|(x, y)| x == y)
        .count();
    let (mid_a, mid_b) = (&a[head..a.len() - tail], &b[head..b.len() - tail]);
    let mut ops: Vec<Op> = (0..head).map(|i| Op::Keep(i, i)).collect();
    let (n, m) = (mid_a.len(), mid_b.len());
    if n * m > MATCH_LIMIT || n == 0 || m == 0 {
        ops.extend((0..n).map(|i| Op::Del(head + i)));
        ops.extend((0..m).map(|j| Op::Ins(head + j)));
    } else {
        // lcs[i][j]: the length of the longest common run of mid_a[i..] and mid_b[j..].
        let mut lcs = vec![vec![0u32; m + 1]; n + 1];
        for i in (0..n).rev() {
            for j in (0..m).rev() {
                lcs[i][j] = if mid_a[i] == mid_b[j] {
                    lcs[i + 1][j + 1] + 1
                } else {
                    lcs[i + 1][j].max(lcs[i][j + 1])
                };
            }
        }
        let (mut i, mut j) = (0, 0);
        while i < n && j < m {
            if mid_a[i] == mid_b[j] {
                ops.push(Op::Keep(head + i, head + j));
                i += 1;
                j += 1;
            } else if lcs[i + 1][j] >= lcs[i][j + 1] {
                ops.push(Op::Del(head + i));
                i += 1;
            } else {
                ops.push(Op::Ins(head + j));
                j += 1;
            }
        }
        ops.extend((i..n).map(|i| Op::Del(head + i)));
        ops.extend((j..m).map(|j| Op::Ins(head + j)));
    }
    ops.extend((0..tail).map(|i| Op::Keep(a.len() - tail + i, b.len() - tail + i)));
    ops
}

/// The new blocks `new` put into the old ones `old` (`norm` gives what an old block is as the new text would hold it). An old block whose norm is all in the new text is kept as it is; the rest of the new blocks are used, a block that replaces one old block getting what it can from it (`replace`). An old block with no norm is kept where it stands.
fn merge(
    old: &[Value],
    new: Vec<Value>,
    norm: &dyn Fn(&[Value]) -> Vec<Value>,
    depth: usize,
) -> Vec<Value> {
    let units = units_of(old);
    let groups: Vec<Vec<Value>> = units.iter().map(|r| norm(&old[r.clone()])).collect();
    let flat: Vec<(usize, &Value)> = groups
        .iter()
        .enumerate()
        .flat_map(|(owner, g)| g.iter().map(move |n| (owner, n)))
        .collect();
    let a: Vec<&Value> = flat.iter().map(|(_, n)| *n).collect();
    let b: Vec<&Value> = new.iter().collect();
    let ops = diff(&a, &b);
    let mut kept = vec![0usize; units.len()];
    for op in &ops {
        if let Op::Keep(j, _) = op {
            kept[flat[*j].0] += 1;
        }
    }
    // A run of deleted and inserted blocks between two kept ones: the n-th one deleted is replaced by the n-th one inserted.
    let mut replaced: HashMap<usize, Value> = HashMap::new();
    let (mut dels, mut inserts) = (Vec::new(), Vec::new());
    for op in ops.iter().map(Some).chain([None]) {
        match op {
            Some(Op::Del(j)) => dels.push(*j),
            Some(Op::Ins(k)) => inserts.push(*k),
            _ => {
                for (j, k) in dels.iter().zip(&inserts) {
                    let owner = flat[*j].0;
                    if groups[owner].len() == 1 && units[owner].len() == 1 {
                        let block = &old[units[owner].start];
                        replaced.insert(*k, replace(block, new[*k].clone(), depth));
                    }
                }
                dels.clear();
                inserts.clear();
            }
        }
    }
    let mut out = Vec::new();
    let mut emitted = vec![false; units.len()];
    let mut empty_from = 0;
    // The old blocks that are nothing as Markdown, before the owner `upto`.
    let mut flush_empty = |upto: usize, out: &mut Vec<Value>| {
        while empty_from < upto {
            if groups[empty_from].is_empty() {
                out.extend_from_slice(&old[units[empty_from].clone()]);
            }
            empty_from += 1;
        }
    };
    for op in ops {
        match op {
            Op::Keep(j, k) => {
                let owner = flat[j].0;
                flush_empty(owner, &mut out);
                if kept[owner] < groups[owner].len() {
                    out.push(new[k].clone());
                } else if !emitted[owner] {
                    emitted[owner] = true;
                    out.extend_from_slice(&old[units[owner].clone()]);
                }
            }
            Op::Del(j) => flush_empty(flat[j].0, &mut out),
            Op::Ins(k) => out.push(replaced.remove(&k).unwrap_or_else(|| new[k].clone())),
        }
    }
    flush_empty(units.len(), &mut out);
    out
}

/// Which blocks the Markdown puts in one list when they stand one after another: bullet, task and decision lists (all written with `- `) are one, and ordered lists are one. The ranges of `old` that are read, kept and dropped together: such a run, or one block.
fn units_of(old: &[Value]) -> Vec<std::ops::Range<usize>> {
    let family = |node: &Value| match kind(node) {
        "bulletList" | "taskList" | "decisionList" => 1,
        "orderedList" => 2,
        _ => 0,
    };
    let mut units: Vec<std::ops::Range<usize>> = Vec::new();
    for (i, node) in old.iter().enumerate() {
        match units.last_mut() {
            Some(last) if family(node) != 0 && family(node) == family(&old[i - 1]) => {
                last.end = i + 1;
            }
            _ => units.push(i..i + 1),
        }
    }
    units
}

fn is_line(kind: &str) -> bool {
    matches!(kind, "paragraph" | "heading" | "taskItem")
}

fn is_plain_list(kind: &str) -> bool {
    matches!(kind, "bulletList" | "orderedList")
}

/// The new block `new` that replaces the old block `old`, with what the old one held that Markdown could not say: a list is matched item by item, a quote and an item block by block, and a line gets back its mentions, emoji, dates, statuses and cards.
fn replace(old: &Value, mut new: Value, depth: usize) -> Value {
    if depth >= MAX_DEPTH {
        return new;
    }
    let (old_kind, new_kind) = (kind(old), kind(&new).to_owned());
    let same_list = old_kind == new_kind && new_kind == "taskList"
        || is_plain_list(old_kind) && is_plain_list(&new_kind);
    if same_list {
        let items = merge(content(old), content(&new).to_vec(), &norm_item, depth + 1);
        new["content"] = Value::Array(items);
    } else if old_kind == new_kind && matches!(new_kind.as_str(), "listItem" | "blockquote") {
        let blocks = merge(content(old), content(&new).to_vec(), &norm_block, depth + 1);
        new["content"] = Value::Array(blocks);
    } else if is_line(old_kind) && is_line(&new_kind) {
        restore_atoms(old, &mut new);
    }
    new
}

/// The text that stands for an inline node that Markdown cannot say, as the reading writes it (`adf`) before its escapes.
fn atom_text(node: &Value) -> Option<String> {
    match kind(node) {
        "mention" => Some(attr_str(node, "text").unwrap_or("@ユーザー").to_owned()),
        "emoji" => attr_str(node, "text")
            .or_else(|| attr_str(node, "shortName"))
            .map(str::to_owned),
        "date" => date_text(node),
        "status" => attr_str(node, "text").map(|t| format!("[{t}]")),
        "inlineCard" => card_url(node).and_then(web_url).map(str::to_owned),
        _ => None,
    }
    .filter(|t| !t.is_empty())
}

/// Puts the mentions, emoji, dates, statuses and cards of the old line into the new one, each where its text stands after the one before it: a text node is split there. A card comes back only for a node that is its address as a link, as the reading wrote it. What the owner took out of the text is not put back.
fn restore_atoms(old: &Value, new: &mut Value) {
    let atoms: Vec<(String, &Value)> = content(old)
        .iter()
        .filter_map(|n| atom_text(n).map(|t| (t, n)))
        .collect();
    let Some(line) = new.get_mut("content").and_then(Value::as_array_mut) else {
        return;
    };
    let mut from = 0;
    for (text, atom) in atoms {
        let card = kind(atom) == "inlineCard";
        let found =
            (from..line.len()).find_map(|i| locate(&line[i], &text, card).map(|at| (i, at)));
        let Some((i, at)) = found else { continue };
        let node = line.remove(i);
        let mut pieces = Vec::new();
        if !card {
            let whole = node["text"].as_str().unwrap_or("").to_owned();
            let (before, after) = (&whole[..at], &whole[at + text.len()..]);
            let piece = |s: &str| {
                let mut p = node.clone();
                p["text"] = Value::String(s.to_owned());
                p
            };
            if !before.is_empty() {
                pieces.push(piece(before));
            }
            from = i + pieces.len() + 1;
            pieces.push(atom.clone());
            if !after.is_empty() {
                pieces.push(piece(after));
            }
        } else {
            from = i + 1;
            pieces.push(atom.clone());
        }
        line.splice(i..i, pieces);
    }
}

/// Where the text of an atom stands in a text node (a card: the node is the address as a link), unless the node is code.
fn locate(node: &Value, text: &str, card: bool) -> Option<usize> {
    if kind(node) != "text" {
        return None;
    }
    let marks = node.get("marks").and_then(Value::as_array);
    let has = |name: &str| marks.is_some_and(|m| m.iter().any(|x| kind(x) == name));
    let own = node["text"].as_str()?;
    if card {
        let href = marks?
            .iter()
            .find(|m| kind(m) == "link")
            .and_then(|m| m.pointer("/attrs/href"))
            .and_then(Value::as_str);
        return (own == text && href == Some(text)).then_some(0);
    }
    if has("code") {
        return None;
    }
    own.find(text)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn para(content: Value) -> Value {
        json!({"type": "paragraph", "content": content})
    }

    fn txt(text: &str) -> Value {
        json!({"type": "text", "text": text})
    }

    fn marked(text: &str, marks: Value) -> Value {
        json!({"type": "text", "text": text, "marks": marks})
    }

    fn mention(name: &str) -> Value {
        json!({"type": "mention", "attrs": {"id": "abc", "text": name}})
    }

    fn doc_md(content: &[Value]) -> String {
        adf::blocks(content, 0)
    }

    #[test]
    fn marks_headings_and_links_are_read_with_only_web_addresses() {
        let out = markdown_to_blocks(
            "# Title\n\n**b** *i* ~~s~~ `c` [l](https://x.example/a) [m](javascript:alert(1))",
        );
        assert_eq!(
            out[0],
            json!({"type": "heading", "attrs": {"level": 1}, "content": [txt("Title")]})
        );
        assert_eq!(
            out[1]["content"],
            json!([
                marked("b", json!([{"type": "strong"}])),
                txt(" "),
                marked("i", json!([{"type": "em"}])),
                txt(" "),
                marked("s", json!([{"type": "strike"}])),
                txt(" "),
                marked("c", json!([{"type": "code"}])),
                txt(" "),
                marked(
                    "l",
                    json!([{"type": "link", "attrs": {"href": "https://x.example/a"}}])
                ),
                txt(" m"),
            ])
        );
    }

    #[test]
    fn code_takes_no_style_but_a_link_and_an_image_is_a_link() {
        let out = markdown_to_blocks(
            "**`x`** ![pic](https://x.example/p.png) ![](https://x.example/q.png) ![](data:x)",
        );
        let link = |href: &str| json!([{"type": "link", "attrs": {"href": href}}]);
        assert_eq!(
            out[0]["content"],
            json!([
                marked("x", json!([{"type": "code"}])),
                txt(" "),
                marked("pic", link("https://x.example/p.png")),
                txt(" "),
                marked("https://x.example/q.png", link("https://x.example/q.png")),
                txt(" data:x"),
            ])
        );
    }

    #[test]
    fn breaks_are_hard_breaks_or_spaces_and_the_ends_of_a_line_have_none() {
        let out = markdown_to_blocks("a  \nb\nc<br>d\\\ne");
        assert_eq!(
            out[0]["content"],
            json!([
                txt("a"),
                {"type": "hardBreak"},
                txt("b c"),
                {"type": "hardBreak"},
                txt("d"),
                {"type": "hardBreak"},
                txt("e")
            ])
        );
        let out = markdown_to_blocks("a<br>");
        assert_eq!(out[0]["content"], json!([txt("a")]));
    }

    #[test]
    fn lists_keep_their_kind_start_and_nesting() {
        let out = markdown_to_blocks("- a\n  - b\n- c\n\n5. x\n6. y");
        assert_eq!(kind(&out[0]), "bulletList");
        assert_eq!(content(&out[0]).len(), 2);
        let first = &content(&out[0])[0];
        assert_eq!(kind(&content(first)[0]), "paragraph");
        assert_eq!(kind(&content(first)[1]), "bulletList");
        assert_eq!(out[1]["type"], "orderedList");
        assert_eq!(out[1]["attrs"], json!({"order": 5}));
        let plain = markdown_to_blocks("1. x");
        assert!(plain[0].get("attrs").is_none());
    }

    #[test]
    fn a_list_of_tasks_is_a_task_list_and_any_other_keeps_the_marks_as_text() {
        let out = markdown_to_blocks("- [ ] one\n- [x] two\n\nbreak\n\n- ☐ three\n- ☑ four");
        let item = |t: &str, state: &str| json!({"type": "taskItem", "attrs": {"state": state}, "content": [txt(t)]});
        assert_eq!(
            out[0],
            json!({"type": "taskList", "content": [item("one", "TODO"), item("two", "DONE")]})
        );
        assert_eq!(
            out[2],
            json!({"type": "taskList", "content": [item("three", "TODO"), item("four", "DONE")]})
        );
        let mixed = markdown_to_blocks("- [ ] one\n- plain");
        assert_eq!(kind(&mixed[0]), "bulletList");
        assert_eq!(content(&content(&content(&mixed[0])[0])[0]), [txt("☐ one")]);
        let quoted = markdown_to_blocks("> - [x] a");
        assert_eq!(kind(&content(&quoted[0])[0]), "bulletList");
    }

    #[test]
    fn code_blocks_keep_a_plain_language_and_the_text() {
        let out = markdown_to_blocks("```rust\nfn a() {}\n\n```\n\n```a!b\nx\n```\n\n    indented");
        assert_eq!(
            out[0],
            json!({"type": "codeBlock", "attrs": {"language": "rust"}, "content": [txt("fn a() {}")]})
        );
        assert_eq!(out[1], json!({"type": "codeBlock", "content": [txt("x")]}));
        assert_eq!(
            out[2],
            json!({"type": "codeBlock", "content": [txt("indented")]})
        );
    }

    #[test]
    fn a_table_has_its_first_row_as_the_header_and_short_rows_are_filled() {
        let out = markdown_to_blocks("| a | b |\n|---|---|\n| 1 |\n| 2 | 3 |");
        let rows = content(&out[0]);
        assert_eq!(rows.len(), 3);
        assert_eq!(kind(&content(&rows[0])[0]), "tableHeader");
        assert_eq!(kind(&content(&rows[1])[0]), "tableCell");
        assert_eq!(content(&rows[1]).len(), 2);
        assert_eq!(
            content(&content(&rows[2])[1])[0]["content"],
            json!([txt("3")])
        );
    }

    #[test]
    fn what_a_place_cannot_hold_is_written_in_a_form_it_can() {
        let out = markdown_to_blocks("> # head\n>\n> text\n>\n> ---\n\n- # in item\n\n  > quoted");
        let quote = &out[0];
        assert_eq!(
            content(quote)[0],
            para(json!([marked("head", json!([{"type": "strong"}]))]))
        );
        assert_eq!(content(quote).len(), 2);
        let item = &content(&out[1])[0];
        let kinds: Vec<&str> = content(item).iter().map(kind).collect();
        assert_eq!(kinds, ["paragraph", "paragraph"]);
    }

    #[test]
    fn html_is_text_and_a_comment_is_dropped() {
        let out = markdown_to_blocks("<div>x</div>\n\n<!-- note -->\n\na <b>c</b>");
        assert_eq!(out[0], para(json!([txt("<div>x</div>")])));
        assert_eq!(out.len(), 2);
        assert_eq!(out[1]["content"], json!([txt("a <b>c</b>")]));
        assert!(markdown_to_blocks("  \n").is_empty());
    }

    #[test]
    fn deep_nesting_ends_without_overflowing() {
        let quotes = "> ".repeat(500) + "x";
        let _ = markdown_to_blocks(&quotes);
        let lists = (0..300)
            .map(|i| format!("{}- x", "  ".repeat(i)))
            .collect::<Vec<_>>()
            .join("\n");
        let _ = markdown_to_blocks(&lists);
    }

    #[test]
    fn with_ids_gives_tasks_ids_that_nothing_else_holds() {
        let mut nodes = vec![
            json!({"type": "taskList", "attrs": {"localId": "00000000-0000-4000-8000-000000000001"}, "content": [
                {"type": "taskItem", "attrs": {"localId": "00000000-0000-4000-8000-000000000002", "state": "TODO"}}
            ]}),
            json!({"type": "taskList", "content": [
                {"type": "taskItem", "attrs": {"state": "DONE"}, "content": [txt("a")]},
                {"type": "taskItem", "attrs": {"state": "TODO"}}
            ]}),
        ];
        with_ids(&mut nodes);
        fn walk(n: &Value, ids: &mut Vec<String>) {
            if let Some(id) = n.pointer("/attrs/localId").and_then(Value::as_str) {
                ids.push(id.to_owned());
            }
            content(n).iter().for_each(|c| walk(c, ids));
        }
        let mut ids = Vec::new();
        nodes.iter().for_each(|n| walk(n, &mut ids));
        assert_eq!(ids.len(), 5);
        assert_eq!(ids.iter().collect::<HashSet<_>>().len(), 5);
        assert_eq!(nodes[1]["content"][0]["attrs"]["state"], "DONE");
    }

    /// A description with what Markdown cannot say: a mention and a status in a line, a panel, a file and a macro that shows nothing.
    fn rich_doc() -> Vec<Value> {
        vec![
            para(json!([
                txt("Ask "),
                mention("@Taro"),
                txt(" about "),
                json!({"type": "status", "attrs": {"text": "Done", "color": "green"}}),
                txt(".")
            ])),
            para(json!([marked(
                "underlined",
                json!([{"type": "underline"}])
            )])),
            json!({"type": "panel", "attrs": {"panelType": "info"}, "content": [para(json!([txt("in a panel")]))]}),
            json!({"type": "mediaSingle", "content": [{"type": "media", "attrs": {"type": "file", "id": "1", "collection": "c"}}]}),
            json!({"type": "extension", "attrs": {"extensionType": "x", "extensionKey": "y"}}),
            json!({"type": "bulletList", "content": [
                {"type": "listItem", "content": [para(json!([mention("@Hanako"), txt(" first")]))]},
                {"type": "listItem", "content": [para(json!([txt("second")]))]},
                {"type": "listItem", "content": [para(json!([txt("third "), mention("@Jiro")]))]},
            ]}),
            para(json!([txt("between")])),
            json!({"type": "taskList", "attrs": {"localId": "t1"}, "content": [
                {"type": "taskItem", "attrs": {"localId": "t2", "state": "DONE"}, "content": [txt("done thing")]},
            ]}),
        ]
    }

    #[test]
    fn a_text_nobody_touched_gives_the_document_back_as_it_was() {
        let old = rich_doc();
        assert_eq!(merged(&old, &doc_md(&old)), old);
    }

    #[test]
    fn the_notation_of_the_editor_does_not_make_a_block_a_changed_one() {
        let old = vec![
            para(json!([
                marked("em", json!([{"type": "em"}])),
                txt(" and "),
                marked(
                    "link",
                    json!([{"type": "link", "attrs": {"href": "https://x.example"}}])
                )
            ])),
            para(json!([mention("@Taro"), txt(" asked")])),
        ];
        assert_eq!(
            merged(&old, "_em_ and [link](<https://x.example>)\n\n@Taro asked"),
            old
        );
        assert_eq!(
            merged(&old, "*em* and [link](https://x.example)\n\n@Taro asked\n"),
            old
        );
    }

    #[test]
    fn an_edit_changes_only_its_block_and_the_others_are_kept_whole() {
        let old = rich_doc();
        let text = doc_md(&old).replace("second", "second, edited");
        let out = merged(&old, &text);
        assert_eq!(out.len(), old.len());
        for i in [0, 1, 2, 3, 4, 6, 7] {
            assert_eq!(out[i], old[i], "block {i}");
        }
        let items = content(&out[5]);
        assert_eq!(items[0], content(&old[5])[0]);
        assert_eq!(
            items[1]["content"][0]["content"],
            json!([txt("second, edited")])
        );
        assert_eq!(items[2], content(&old[5])[2]);
    }

    #[test]
    fn a_changed_line_gets_back_its_mentions_statuses_dates_and_cards() {
        let old = vec![para(json!([
            txt("See "),
            mention("@Taro"),
            txt(" "),
            json!({"type": "status", "attrs": {"text": "Done"}}),
            txt(" "),
            json!({"type": "date", "attrs": {"timestamp": "1790000000000"}}),
            txt(" "),
            json!({"type": "inlineCard", "attrs": {"url": "https://x.example/t"}}),
        ]))];
        let text = adf::blocks(&old, 0);
        assert!(text.contains("@Taro"), "{text}");
        let edited = text.replace("See", "Look at");
        let out = merged(&old, &edited);
        let line = content(&out[0]);
        let kinds: Vec<&str> = line.iter().map(kind).collect();
        assert_eq!(
            kinds,
            [
                "text",
                "mention",
                "text",
                "status",
                "text",
                "date",
                "text",
                "inlineCard"
            ]
        );
        assert_eq!(line[0]["text"], "Look at ");
        assert_eq!(line[1], old[0]["content"][1]);
        assert_eq!(line[7], old[0]["content"][7]);
        // The owner took the mention out of the text: it is not put back.
        let out = merged(&old, &edited.replace("@Taro", "someone"));
        assert!(content(&out[0]).iter().all(|n| kind(n) != "mention"));
    }

    #[test]
    fn a_mention_is_not_made_of_text_inside_code() {
        let old = vec![para(json!([mention("@Taro")]))];
        let out = merged(&old, "`@Taro`");
        assert_eq!(kind(&content(&out[0])[0]), "text");
    }

    #[test]
    fn deleting_and_adding_blocks_keeps_the_rest() {
        let old = rich_doc();
        let text = doc_md(&old);
        let without_panel = text.replace("> in a panel\n\n", "");
        assert_ne!(without_panel, text);
        let out = merged(&old, &without_panel);
        assert!(out.iter().all(|n| kind(n) != "panel"));
        assert_eq!(out.len(), old.len() - 1);
        assert_eq!(out[0], old[0]);
        // The macro that shows nothing is still there.
        assert!(out.contains(&old[4]));
        let added = format!("New first.\n\n{text}\n\nNew last.");
        let out = merged(&old, &added);
        assert_eq!(out.len(), old.len() + 2);
        assert_eq!(out[1..=old.len()], old[..]);
        assert_eq!(out[0], para(json!([txt("New first.")])));
    }

    #[test]
    fn a_block_that_shows_nothing_stays_when_the_text_is_emptied() {
        let old = rich_doc();
        assert_eq!(merged(&old, ""), vec![old[4].clone()]);
        assert!(merged(&[para(json!([txt("x")]))], "").is_empty());
    }

    #[test]
    fn a_new_description_for_an_empty_one_is_the_text_as_blocks() {
        let out = merged(&[], "one\n\n- a\n- b");
        assert_eq!(out.len(), 2);
        assert_eq!(kind(&out[1]), "bulletList");
    }

    #[test]
    fn a_task_list_edited_keeps_its_other_items() {
        let old = vec![
            json!({"type": "taskList", "attrs": {"localId": "t1"}, "content": [
                {"type": "taskItem", "attrs": {"localId": "a", "state": "TODO"}, "content": [mention("@Taro"), txt(" one")]},
                {"type": "taskItem", "attrs": {"localId": "b", "state": "TODO"}, "content": [txt("two")]},
            ]}),
        ];
        let text = adf::blocks(&old, 0).replace("two", "2");
        let out = merged(&old, &text);
        let items = content(&out[0]);
        assert_eq!(items[0], content(&old[0])[0]);
        assert_eq!(items[1]["attrs"]["state"], "TODO");
        assert_eq!(items[1]["content"], json!([txt("2")]));
    }

    #[test]
    fn a_quote_edited_keeps_its_other_blocks() {
        let old = vec![json!({"type": "blockquote", "content": [
            para(json!([mention("@Taro"), txt(" said")])),
            para(json!([txt("later")])),
        ]})];
        let text = adf::blocks(&old, 0).replace("later", "much later");
        let out = merged(&old, &text);
        assert_eq!(content(&out[0])[0], content(&old[0])[0]);
        assert_eq!(content(&out[0])[1], para(json!([txt("much later")])));
    }

    #[test]
    fn a_huge_change_still_ends_and_gives_the_new_text() {
        let old: Vec<Value> = (0..1200)
            .map(|i| para(json!([txt(&format!("old {i}"))])))
            .collect();
        let text = (0..1200)
            .map(|i| format!("new {i}"))
            .collect::<Vec<_>>()
            .join("\n\n");
        let out = merged(&old, &text);
        assert_eq!(out.len(), 1200);
        assert_eq!(out[7], para(json!([txt("new 7")])));
    }

    #[test]
    fn lists_that_stand_together_are_the_one_list_that_the_editor_shows() {
        let old = vec![
            json!({"type": "bulletList", "content": [{"type": "listItem", "content": [para(json!([mention("@Taro")]))]}]}),
            json!({"type": "taskList", "attrs": {"localId": "t"}, "content": [{"type": "taskItem", "attrs": {"localId": "i", "state": "TODO"}, "content": [txt("a")]}]}),
        ];
        let text = doc_md(&old);
        assert_eq!(merged(&old, &text), old);
        let out = merged(&old, &format!("{text}\n- c"));
        assert_eq!(out.len(), 1);
        assert_eq!(content(&out[0]).len(), 3);
    }

    #[test]
    fn the_text_of_the_reading_comes_back_as_the_same_text() {
        let text = doc_md(&rich_doc());
        assert_eq!(doc_md(&markdown_to_blocks(&text)), text);
    }
}
