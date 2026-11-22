//! A-37 (#1084): the messages between the leader and its children, kept for the flow pane.
//! The leader and a child tell each other with Orca's orchestration (#1238): the Run of a formation holds what its children and its leader send each other (`orchestration send`), and `sync_orchestration` reads the Run's messages (`orchestration inbox`) and appends the ones it has not taken in to `formations/{formation}/messages.jsonl`. The screen's read of a formation of this Mac runs it, and so does the read of a PC's server.
//! A line holds who sent it (`from`), to whom (`to`), when (`atMs`) and the first line of the text (`line`, at most `LINE_CHARS` characters). The rest of the text is not kept: it comes from outside and is data.

use std::{
    collections::HashMap,
    io::{Read, Seek, SeekFrom, Write},
    path::{Path, PathBuf},
};

use serde::{Deserialize, Serialize};
#[cfg(test)]
use serde_json::json;
use serde_json::Value;
#[cfg(test)]
use ts_rs::TS;

use crate::{
    auth::config_dir,
    formation::{self, Child, OrchestrationState, LOCAL},
    formation_server::Client,
    orca,
};

/// The record of a formation's messages, in `formations/{formation}/`: one JSON object on each line, oldest first.
pub const FILE: &str = "messages.jsonl";
/// The first line of a message is cut to this many characters (not bytes), and ends with `…` when it was cut.
const LINE_CHARS: usize = 200;
/// How many of the last records a read answers.
const READ_RECORDS: usize = 500;
/// How much of the end of the file a read looks at: a record is at most a few hundred bytes, so this holds more than `READ_RECORDS` of them.
const READ_BYTES: u64 = 512 * 1024;

/// One message between the leader and a child, as the record holds it and the screen reads it.
#[derive(Serialize, Deserialize, Clone, Debug, PartialEq)]
#[cfg_attr(test, derive(TS))]
#[cfg_attr(test, ts(export, export_to = crate::BINDINGS))]
#[serde(rename_all = "camelCase")]
pub struct FormationMessage {
    /// Who sent it: the name of the formation (its leader) or of a child.
    pub from: String,
    /// Who it was sent to: the name of a child or of the formation.
    pub to: String,
    /// When it was sent (epoch milliseconds).
    #[cfg_attr(test, ts(type = "number"))]
    pub at_ms: u64,
    /// The first line of the text, data from the sender.
    pub line: String,
}

/// The first non-blank line of `text` with its control characters taken out, at most `LINE_CHARS` characters; empty when the text has none.
pub fn first_line(text: &str) -> String {
    let line: String = text
        .lines()
        .map(|line| {
            line.chars()
                .map(|c| if c.is_control() { ' ' } else { c })
                .collect::<String>()
        })
        .map(|line| line.trim().to_owned())
        .find(|line| !line.is_empty())
        .unwrap_or_default();
    if line.chars().count() <= LINE_CHARS {
        return line;
    }
    let mut cut: String = line.chars().take(LINE_CHARS).collect();
    cut.push('…');
    cut
}

/// The children of `formation` that the leader told something and that have not answered yet (#1087): the latest message between the leader (named as the formation) and the child is the leader's. A message between two children is not counted. Newest instruction first; `messages` is oldest first, as `read` gives it.
pub fn instructed(messages: &[FormationMessage], formation: &str) -> Vec<String> {
    // The latest message of each child: where it stands in the record, when it was sent, and whether the leader sent it.
    let mut last: HashMap<&str, (usize, u64, bool)> = HashMap::new();
    for (index, message) in messages.iter().enumerate() {
        let (child, from_leader) = if message.from == formation && message.to != formation {
            (message.to.as_str(), true)
        } else if message.to == formation && message.from != formation {
            (message.from.as_str(), false)
        } else {
            continue;
        };
        last.insert(child, (index, message.at_ms, from_leader));
    }
    let mut open: Vec<(u64, usize, &str)> = last
        .into_iter()
        .filter(|(_, (_, _, from_leader))| *from_leader)
        .map(|(child, (index, at_ms, _))| (at_ms, index, child))
        .collect();
    open.sort_by_key(|&(at_ms, index, _)| std::cmp::Reverse((at_ms, index)));
    open.into_iter()
        .map(|(_, _, child)| child.to_owned())
        .collect()
}

/// The record's path, or the reason it cannot be used: a link or anything but a file in its place is refused, because the leader can write in its folder, and a link there would lead the append to a file elsewhere.
fn record_path(config: &Path, formation: &str) -> Result<PathBuf, String> {
    formation::check_name(formation)?;
    let path = formation::dir(config, formation).join(FILE);
    match std::fs::symlink_metadata(&path) {
        Ok(meta) if !meta.is_file() => Err(format!("{} はファイルではありません", path.display())),
        Ok(_) => Ok(path),
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(path),
        Err(e) => Err(format!("{} を調べられません: {e}", path.display())),
    }
}

/// Adds `message` to the record of `formation`. The line is one write to a file opened for appending, so two writers at once do not mix their lines.
pub fn append(config: &Path, formation: &str, message: &FormationMessage) -> Result<(), String> {
    let path = record_path(config, formation)?;
    let mut line = serde_json::to_string(message).map_err(|e| e.to_string())?;
    line.push('\n');
    if let Some(folder) = path.parent() {
        std::fs::create_dir_all(folder)
            .map_err(|e| format!("{} を作れません: {e}", folder.display()))?;
    }
    std::fs::OpenOptions::new()
        .create(true)
        .append(true)
        .open(&path)
        .and_then(|mut file| file.write_all(line.as_bytes()))
        .map_err(|e| format!("{} に書けません: {e}", path.display()))
}

/// The last `READ_RECORDS` messages of the record of `formation`, oldest first. A missing or unusable record reads as none, and a line that is not a message is passed over.
pub fn read(config: &Path, formation: &str) -> Vec<FormationMessage> {
    let Ok(path) = record_path(config, formation) else {
        return Vec::new();
    };
    let Ok(mut file) = std::fs::File::open(path) else {
        return Vec::new();
    };
    let Ok(length) = file.metadata().map(|m| m.len()) else {
        return Vec::new();
    };
    let cut = length > READ_BYTES;
    if cut && file.seek(SeekFrom::Start(length - READ_BYTES)).is_err() {
        return Vec::new();
    }
    let mut bytes = Vec::new();
    if file.take(READ_BYTES).read_to_end(&mut bytes).is_err() {
        return Vec::new();
    }
    let text = String::from_utf8_lossy(&bytes);
    // The first line of a cut read starts in the middle of a record.
    let skip = usize::from(cut);
    let mut messages: Vec<FormationMessage> = text
        .lines()
        .skip(skip)
        .filter_map(|line| serde_json::from_str(line).ok())
        .collect();
    let extra = messages.len().saturating_sub(READ_RECORDS);
    messages.drain(..extra);
    messages
}

/// One end of an orchestration message: the leader of the formation, or one of its children.
enum Party<'a> {
    Leader,
    Child(&'a str),
}

/// Who an address of an orchestration message is: `run:{id}` of the formation's Run is its leader, `dispatch:{id}` and a terminal handle are the child whose Dispatch or terminal it is. Any other address is none.
fn party_of<'a>(
    address: &str,
    state: &'a OrchestrationState,
    children: &'a [Child],
) -> Option<Party<'a>> {
    if address.strip_prefix("run:") == Some(state.run_id.as_str()) {
        return Some(Party::Leader);
    }
    if let Some(dispatch) = address.strip_prefix("dispatch:") {
        return state
            .dispatches
            .iter()
            .find(|(_, id)| id.as_str() == dispatch)
            .map(|(name, _)| Party::Child(name));
    }
    children
        .iter()
        .find(|child| child.launch.as_ref().is_some_and(|l| l.handle == address))
        .map(|child| Party::Child(&child.name))
}

/// The message that a row of `orca orchestration inbox --full` records, or none when it is not one between the leader and a child of this formation: another Run's, a heartbeat, one between two children, one to a Dispatch that is no child's, or one with no text. The sender that is no child is the leader (the terminal of the orchestrator's Claude Code, which this record does not know). `created_at` is the time of the message; `fallback_ms` stands in when it cannot be read. The text is the first line of the subject, or of the body when there is no subject: data from the sender.
pub(crate) fn message_of_orchestration(
    formation: &str,
    state: &OrchestrationState,
    children: &[Child],
    row: &Value,
    fallback_ms: u64,
) -> Option<FormationMessage> {
    if row["run_id"]
        .as_str()
        .is_some_and(|run| run != state.run_id)
        || row["type"] == "heartbeat"
    {
        return None;
    }
    let from = party_of(row["from_handle"].as_str()?, state, children).unwrap_or(Party::Leader);
    // A child that sends with no `--to` writes to its coordinator, whose address is the Run or the leader's terminal (which this record does not know): an address that is no child's is the leader's, except a Dispatch that is none of this formation's.
    let to_handle = row["to_handle"].as_str()?;
    let to = party_of(to_handle, state, children)
        .or_else(|| (!to_handle.starts_with("dispatch:")).then_some(Party::Leader))?;
    let (from, to) = match (from, to) {
        (Party::Leader, Party::Child(child)) => (formation, child),
        (Party::Child(child), Party::Leader) => (child, formation),
        _ => return None,
    };
    let text = |key: &str| first_line(row[key].as_str().unwrap_or_default());
    let line = Some(text("subject"))
        .filter(|line| !line.is_empty())
        .unwrap_or_else(|| text("body"));
    if line.is_empty() {
        return None;
    }
    let at_ms = row["created_at"]
        .as_str()
        .and_then(|time| chrono::DateTime::parse_from_rfc3339(time).ok())
        .and_then(|time| u64::try_from(time.timestamp_millis()).ok())
        .unwrap_or(fallback_ms);
    Some(FormationMessage {
        from: from.to_owned(),
        to: to.to_owned(),
        at_ms,
        line,
    })
}

/// The lock file that keeps two syncs of one formation from taking in the same messages.
const SYNC_LOCK: &str = "messages.jsonl.lock";

/// Takes the messages of the formation's Run that `messages.jsonl` has not taken in (`read` runs `orca orchestration inbox` of this Mac), appends the ones that are between the leader and a child, oldest first, and keeps the sequence of the last one it saw, so that no message is taken twice. A formation with no Run has nothing to take. Answers how many lines it appended.
pub fn sync_orchestration(
    config: &Path,
    formation: &str,
    read: &dyn Fn(&[String]) -> Result<Value, String>,
    now_ms: u64,
) -> Result<usize, String> {
    formation::check_name(formation)?;
    if formation::orchestration_state(config, formation).is_none() {
        return Ok(0);
    }
    let _held = formation::lock_file(config, formation, SYNC_LOCK)?;
    let Some(state) = formation::orchestration_state(config, formation) else {
        return Ok(0);
    };
    let answer = read(&formation::inbox_args(&state.run_id, LOCAL))?;
    let mut rows: Vec<&Value> = answer["messages"]
        .as_array()
        .into_iter()
        .flatten()
        .filter(|row| row["sequence"].as_u64().is_some_and(|n| n > state.sequence))
        .collect();
    rows.sort_by_key(|row| row["sequence"].as_u64());
    let Some(last) = rows.last().and_then(|row| row["sequence"].as_u64()) else {
        return Ok(0);
    };
    let children = formation::read_children(config, formation);
    let mut appended = 0;
    for row in rows {
        if let Some(message) = message_of_orchestration(formation, &state, &children, row, now_ms) {
            append(config, formation, &message)?;
            appended += 1;
        }
    }
    formation::set_messages_sequence(config, formation, last)?;
    Ok(appended)
}

/// The record of `formation` after the messages of its Run were taken in (`sync_orchestration` with this PC's Orca). A failed read of the Run leaves the record as it is: what was taken in is shown.
pub fn read_synced(config: &Path, formation: &str) -> Vec<FormationMessage> {
    let _ = sync_orchestration(
        config,
        formation,
        &formation::orca_read,
        formation::now_ms(),
    );
    read(config, formation)
}

/// The messages of `formation` for the screen: read here for a formation of this Mac, and from the server of its PC for a formation of a saved environment, where its Run is. A formation whose orchestrator was never started on its PC has none.
fn messages_for_screen(
    config: &Path,
    formation: &str,
    open: &impl AsyncFn(&str) -> Result<Client, String>,
) -> Result<Vec<FormationMessage>, String> {
    formation::check_name(formation)?;
    let (environment, started) = formation::formation_home(config, formation);
    if environment == LOCAL {
        return Ok(read_synced(config, formation));
    }
    if !started {
        return Ok(Vec::new());
    }
    formation::on_pc(
        &environment,
        open,
        formation::SAVED_PS_TIMEOUT,
        async |client| client.messages_read(formation).await,
    )
}

/// The messages that the leader of the formation `name` and its children sent each other, oldest first (A-37, #1084).
#[tauri::command]
pub async fn formation_messages(
    app: tauri::AppHandle,
    name: String,
) -> Result<Vec<FormationMessage>, String> {
    let dir = config_dir(&app)?;
    let version = app.package_info().version.to_string();
    orca::blocking(move || {
        messages_for_screen(&dir, &name, &formation::pc_connect(&dir, &version, false))
    })
    .await?
}

/// The children of the formation `name` that the leader told something and that have not answered yet, newest instruction first (A-37, #1087). The compact view of the flow pane reads it.
#[tauri::command]
pub async fn formation_instructed(
    app: tauri::AppHandle,
    name: String,
) -> Result<Vec<String>, String> {
    let dir = config_dir(&app)?;
    let version = app.package_info().version.to_string();
    orca::blocking(move || {
        messages_for_screen(&dir, &name, &formation::pc_connect(&dir, &version, false))
            .map(|messages| instructed(&messages, &name))
    })
    .await?
}

#[cfg(test)]
mod tests {
    use super::*;

    fn temp_dir(name: &str) -> PathBuf {
        let dir = std::env::temp_dir().join(format!(
            "tsunagiai-message-{name}-{}-{}",
            std::process::id(),
            formation::now_ms()
        ));
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).unwrap();
        std::fs::canonicalize(dir).unwrap()
    }

    fn names(of: &[&str]) -> Vec<String> {
        of.iter().map(|n| (*n).to_owned()).collect()
    }

    fn message(from: &str, to: &str, at_ms: u64, line: &str) -> FormationMessage {
        FormationMessage {
            from: from.to_owned(),
            to: to.to_owned(),
            at_ms,
            line: line.to_owned(),
        }
    }

    #[test]
    fn the_first_line_is_the_first_one_with_text_and_has_no_control_characters() {
        assert_eq!(first_line("DONE a: x\nsecond"), "DONE a: x");
        assert_eq!(first_line("\n  \r\n  QUESTION b: y  \nz"), "QUESTION b: y");
        assert_eq!(first_line("a\tb\u{1b}[31mc"), "a b [31mc");
        assert_eq!(first_line(" \n \n"), "");
        assert_eq!(first_line(""), "");
    }

    #[test]
    fn a_long_first_line_is_cut_by_characters_and_marked() {
        let exact = "あ".repeat(LINE_CHARS);
        assert_eq!(first_line(&exact), exact);
        let cut = first_line(&"あ".repeat(LINE_CHARS + 1));
        assert_eq!(cut.chars().count(), LINE_CHARS + 1);
        assert!(cut.starts_with(&exact) && cut.ends_with('…'));
    }

    #[test]
    fn the_record_is_read_in_the_order_it_was_written_and_a_bad_line_is_passed_over() {
        let config = temp_dir("order");
        assert!(read(&config, "api-work").is_empty());
        append(&config, "api-work", &message("api-work", "req", 1, "a")).unwrap();
        append(&config, "api-work", &message("req", "api-work", 2, "b")).unwrap();
        let path = formation::dir(&config, "api-work").join(FILE);
        let mut text = std::fs::read_to_string(&path).unwrap();
        text.push_str("broken\n{\"from\":1}\n");
        std::fs::write(&path, text).unwrap();
        append(&config, "api-work", &message("api-work", "req", 3, "c")).unwrap();
        let read = read(&config, "api-work");
        assert_eq!(read.iter().map(|m| m.at_ms).collect::<Vec<_>>(), [1, 2, 3]);
        // The line has the keys the screen reads.
        let first: Value = serde_json::from_str(
            std::fs::read_to_string(&path)
                .unwrap()
                .lines()
                .next()
                .unwrap(),
        )
        .unwrap();
        assert_eq!(
            first,
            json!({"from": "api-work", "to": "req", "atMs": 1, "line": "a"})
        );
        std::fs::remove_dir_all(&config).unwrap();
    }

    #[test]
    fn a_read_answers_the_last_records_only() {
        let config = temp_dir("last");
        for at in 0..(READ_RECORDS as u64 + 5) {
            append(&config, "api-work", &message("api-work", "req", at, "x")).unwrap();
        }
        let read = read(&config, "api-work");
        assert_eq!(read.len(), READ_RECORDS);
        assert_eq!(read[0].at_ms, 5);
        assert_eq!(read[READ_RECORDS - 1].at_ms, READ_RECORDS as u64 + 4);
        std::fs::remove_dir_all(&config).unwrap();
    }

    #[test]
    fn a_read_of_a_big_file_drops_the_record_that_the_cut_went_through() {
        let config = temp_dir("big");
        let dir = formation::dir(&config, "api-work");
        std::fs::create_dir_all(&dir).unwrap();
        let record =
            serde_json::to_string(&message("api-work", "req", 9, &"x".repeat(150))).unwrap();
        let count = (READ_BYTES as usize / record.len()) + 50;
        std::fs::write(dir.join(FILE), format!("{record}\n").repeat(count)).unwrap();
        let read = read(&config, "api-work");
        // Every record that is answered is whole.
        assert_eq!(read.len(), READ_RECORDS);
        assert!(read.iter().all(|m| m.at_ms == 9 && m.line.len() == 150));
        std::fs::remove_dir_all(&config).unwrap();
    }

    #[cfg(unix)]
    #[test]
    fn a_link_in_the_place_of_the_record_is_neither_written_nor_read() {
        let config = temp_dir("link");
        let dir = formation::dir(&config, "api-work");
        std::fs::create_dir_all(&dir).unwrap();
        let elsewhere = config.join("elsewhere.txt");
        std::fs::write(&elsewhere, "keep\n").unwrap();
        std::os::unix::fs::symlink(&elsewhere, dir.join(FILE)).unwrap();
        assert!(append(&config, "api-work", &message("api-work", "req", 1, "a")).is_err());
        assert_eq!(std::fs::read_to_string(&elsewhere).unwrap(), "keep\n");
        assert!(read(&config, "api-work").is_empty());
        std::fs::remove_dir_all(&config).unwrap();
    }

    #[test]
    fn a_name_that_leads_out_of_the_folder_is_refused() {
        let config = temp_dir("name");
        assert!(append(&config, "../x", &message("a", "b", 1, "c")).is_err());
        assert!(read(&config, "../x").is_empty());
        std::fs::remove_dir_all(&config).unwrap();
    }

    #[test]
    fn a_formation_of_this_mac_is_read_from_its_own_record() {
        let config = temp_dir("screen");
        append(&config, "api-work", &message("api-work", "req", 1, "a")).unwrap();
        let open = async |_: &str| -> Result<Client, String> { Err("no connection".into()) };
        assert_eq!(
            messages_for_screen(&config, "api-work", &open).unwrap(),
            [message("api-work", "req", 1, "a")]
        );
        assert!(messages_for_screen(&config, "../x", &open).is_err());
        std::fs::remove_dir_all(&config).unwrap();
    }

    #[test]
    fn a_child_the_leader_told_last_is_instructed_and_an_answer_ends_it() {
        let record = vec![
            message("api-work", "req", 1, "ASK"),
            message("req", "api-work", 2, "DONE"),
            message("api-work", "impl", 3, "GO"),
        ];
        assert_eq!(instructed(&record, "api-work"), names(&["impl"]));
        let more = [record, vec![message("api-work", "req", 4, "AGAIN")]].concat();
        assert_eq!(instructed(&more, "api-work"), names(&["req", "impl"]));
    }

    #[test]
    fn the_instructed_children_are_newest_first_and_one_message_counts_once() {
        let record = vec![
            message("api-work", "a", 10, "1"),
            message("api-work", "b", 20, "2"),
            message("api-work", "a", 30, "3"),
            message("api-work", "c", 5, "4"),
        ];
        assert_eq!(instructed(&record, "api-work"), names(&["a", "b", "c"]));
        assert_eq!(instructed(&[], "api-work"), Vec::<String>::new());
    }

    #[test]
    fn messages_between_children_and_of_another_formation_are_not_counted() {
        let record = vec![
            message("a", "b", 1, "x"),
            message("other", "c", 2, "y"),
            message("c", "other", 3, "z"),
            message("api-work", "api-work", 4, "w"),
        ];
        assert_eq!(instructed(&record, "api-work"), Vec::<String>::new());
        let mixed = [record, vec![message("api-work", "a", 5, "go")]].concat();
        assert_eq!(instructed(&mixed, "api-work"), names(&["a"]));
    }

    // ---- the messages of Orca's orchestration (#1237) ----

    /// A formation `api-work` with the Run `run_1` and a child `a` (terminal `term_a`, Dispatch `ctx_1`).
    fn with_run(name: &str) -> PathBuf {
        let config = temp_dir(name);
        let folder = formation::dir(&config, "api-work");
        std::fs::create_dir_all(&folder).unwrap();
        std::fs::write(
            folder.join("formation.json"),
            r#"{"runId": "run_1", "dispatches": {"a": "ctx_1"}}"#,
        )
        .unwrap();
        std::fs::write(
            folder.join("children.json"),
            r#"{"children": [{"name": "a", "repo": "r", "path": "/w/a", "branch": "b", "handle": "term_a", "paneKey": "t:l", "launchedAt": 1}]}"#,
        )
        .unwrap();
        config
    }

    fn row(sequence: u64, from: &str, to: &str, subject: &str, body: &str) -> Value {
        json!({
            "id": format!("msg_{sequence}"), "run_id": "run_1", "from_handle": from, "to_handle": to,
            "subject": subject, "body": body, "type": "status", "sequence": sequence,
            "created_at": "2026-11-22T02:25:16Z",
        })
    }

    fn orchestration_of(config: &Path, row: &Value) -> Option<FormationMessage> {
        let state = formation::orchestration_state(config, "api-work").unwrap();
        let children = formation::read_children(config, "api-work");
        message_of_orchestration("api-work", &state, &children, row, 7)
    }

    #[test]
    fn a_message_of_the_run_between_the_leader_and_a_child_is_a_message_of_the_record() {
        let config = with_run("orchestration-message");
        // The leader (a terminal that is no child's) to the Dispatch, and to the terminal of the child.
        let to_child = orchestration_of(
            &config,
            &row(1, "term_leader", "dispatch:ctx_1", "do it", "long text"),
        )
        .unwrap();
        assert_eq!(
            to_child,
            FormationMessage {
                from: "api-work".into(),
                to: "a".into(),
                at_ms: 1_795_314_316_000,
                line: "do it".into()
            }
        );
        let to_terminal =
            orchestration_of(&config, &row(2, "term_leader", "term_a", "again", "")).unwrap();
        assert_eq!(
            (to_terminal.from.as_str(), to_terminal.to.as_str()),
            ("api-work", "a")
        );
        // The child to the Run.
        let to_leader = orchestration_of(
            &config,
            &row(3, "term_a", "run:run_1", "", "a question\nmore"),
        )
        .unwrap();
        assert_eq!(
            (to_leader.from.as_str(), to_leader.to.as_str()),
            ("a", "api-work")
        );
        assert_eq!(to_leader.line, "a question");
        // A child that sends with no `--to` writes to its coordinator, the leader's terminal.
        let to_coordinator =
            orchestration_of(&config, &row(4, "term_a", "term_leader", "asks", "")).unwrap();
        assert_eq!(
            (to_coordinator.from.as_str(), to_coordinator.to.as_str()),
            ("a", "api-work")
        );
        std::fs::remove_dir_all(&config).unwrap();
    }

    #[test]
    fn a_message_that_is_not_between_the_leader_and_a_child_is_not_recorded() {
        let config = with_run("orchestration-other");
        for other in [
            // Between the leader and itself, to a Dispatch that is nobody's, with no text.
            row(1, "term_leader", "run:run_1", "x", ""),
            row(2, "term_leader", "term_other", "x", ""),
            row(3, "term_leader", "dispatch:ctx_9", "x", ""),
            row(8, "term_a", "dispatch:ctx_9", "x", ""),
            row(4, "term_leader", "dispatch:ctx_1", "", " \n"),
            // A child to itself, a heartbeat, and a message of another Run.
            row(5, "term_a", "dispatch:ctx_1", "x", ""),
            json!({"run_id": "run_1", "from_handle": "term_a", "to_handle": "run:run_1", "subject": "x", "type": "heartbeat"}),
            json!({"run_id": "run_2", "from_handle": "term_a", "to_handle": "run:run_1", "subject": "x", "type": "status"}),
        ] {
            assert_eq!(orchestration_of(&config, &other), None, "{other}");
        }
        // A time that cannot be read is the time the caller gives.
        let mut late = row(6, "term_a", "run:run_1", "x", "");
        late["created_at"] = json!("yesterday");
        assert_eq!(orchestration_of(&config, &late).unwrap().at_ms, 7);
        std::fs::remove_dir_all(&config).unwrap();
    }

    #[test]
    fn the_messages_of_the_run_are_taken_in_once_and_in_order() {
        let config = with_run("orchestration-sync");
        let inbox = json!({"messages": [
            row(3, "term_a", "run:run_1", "the answer", ""),
            row(1, "term_leader", "dispatch:ctx_1", "the order", ""),
            row(2, "term_a", "term_a", "nobody's", ""),
        ]});
        let asked = std::cell::RefCell::new(Vec::new());
        let read = |args: &[String]| {
            asked.borrow_mut().push(args.to_vec());
            Ok(inbox.clone())
        };
        assert_eq!(sync_orchestration(&config, "api-work", &read, 5), Ok(2));
        assert_eq!(asked.borrow()[0], formation::inbox_args("run_1", LOCAL));
        let lines: Vec<(String, String, String)> = super::read(&config, "api-work")
            .into_iter()
            .map(|m| (m.from, m.to, m.line))
            .collect();
        assert_eq!(
            lines,
            [
                ("api-work".into(), "a".into(), "the order".into()),
                ("a".into(), "api-work".into(), "the answer".into()),
            ]
        );
        // The same inbox again adds nothing; a new message is added.
        assert_eq!(sync_orchestration(&config, "api-work", &read, 5), Ok(0));
        let more = json!({"messages": [
            row(3, "term_a", "run:run_1", "the answer", ""),
            row(4, "term_leader", "dispatch:ctx_1", "next", ""),
        ]});
        let read_more = |_: &[String]| Ok(more.clone());
        assert_eq!(
            sync_orchestration(&config, "api-work", &read_more, 5),
            Ok(1)
        );
        assert_eq!(super::read(&config, "api-work").len(), 3);
        assert_eq!(
            formation::orchestration_state(&config, "api-work")
                .unwrap()
                .sequence,
            4
        );
        std::fs::remove_dir_all(&config).unwrap();
    }

    #[test]
    fn a_formation_with_no_run_and_a_read_that_fails_take_in_nothing() {
        let config = temp_dir("orchestration-none");
        std::fs::create_dir_all(formation::dir(&config, "api-work")).unwrap();
        let never = |_: &[String]| -> Result<Value, String> { panic!("no Run, no read") };
        assert_eq!(sync_orchestration(&config, "api-work", &never, 5), Ok(0));
        std::fs::remove_dir_all(&config).unwrap();
        let config = with_run("orchestration-fails");
        let down = |_: &[String]| -> Result<Value, String> { Err("orca is down".into()) };
        assert_eq!(
            sync_orchestration(&config, "api-work", &down, 5),
            Err("orca is down".into())
        );
        assert!(super::read(&config, "api-work").is_empty());
        std::fs::remove_dir_all(&config).unwrap();
    }
}
