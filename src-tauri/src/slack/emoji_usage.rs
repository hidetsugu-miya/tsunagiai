//! The emoji the user reacted with (S-25), kept to put the ones used most first in the picker.
//! `slack-emoji-usage.json` holds, for each workspace, the names of the last `USAGE_MAX` reactions added here, oldest first: names only, never a message, a channel or a person.

use std::{
    collections::{BTreeMap, HashMap},
    path::Path,
};

use serde_json::Value;
use tauri::{AppHandle, State};

use super::{blocking, token_key, valid_reaction_name, SlackState};
use crate::{accounts::write_atomic, auth::config_dir, gmail::log_failure};

const USAGE_FILE: &str = "slack-emoji-usage.json";
/// How many uses of a workspace are kept: the oldest go first.
const USAGE_MAX: usize = 200;
/// How many emoji `slack_emoji_frequent` answers (8 in a row, 3 rows).
const FREQUENT_MAX: usize = 24;
const BAD_EMOJI: &str = "絵文字の名前か貼り付け先が不正です";

/// The uses of each workspace, by `team_id`, oldest first.
type Usage = BTreeMap<String, Vec<String>>;

/// The uses in `text`. A file that is not JSON or not an object holds none; a workspace whose value is not a list, and a name that cannot be a reaction's, are left out; each list is cut to its newest `USAGE_MAX`.
fn parse(text: &str) -> Usage {
    let Ok(Value::Object(map)) = serde_json::from_str::<Value>(text) else {
        return Usage::new();
    };
    map.into_iter()
        .filter(|(team, _)| token_key(team).is_ok())
        .filter_map(|(team, list)| {
            let Value::Array(list) = list else {
                return None;
            };
            let mut names: Vec<String> = list
                .into_iter()
                .filter_map(|n| match n {
                    Value::String(n) if valid_reaction_name(&n) => Some(n),
                    _ => None,
                })
                .collect();
            names.drain(..names.len().saturating_sub(USAGE_MAX));
            Some((team, names))
        })
        .collect()
}

/// The saved uses. A file that is missing or cannot be read holds none.
fn load(dir: &Path) -> Usage {
    std::fs::read_to_string(dir.join(USAGE_FILE)).map_or_else(|_| Usage::new(), |t| parse(&t))
}

fn save(dir: &Path, usage: &Usage) -> Result<(), String> {
    let text = serde_json::to_string_pretty(usage).map_err(|e| e.to_string())?;
    write_atomic(dir, USAGE_FILE, &text)
}

/// `used` with `name` as the newest use; the oldest go when there are more than `USAGE_MAX`.
fn with_used(mut used: Vec<String>, name: &str) -> Vec<String> {
    used.push(name.to_owned());
    used.drain(..used.len().saturating_sub(USAGE_MAX));
    used
}

/// The names of `used` (oldest first) by how many times each was used, most first; the same count puts the one used last first. At most `FREQUENT_MAX`.
fn frequent(used: &[String]) -> Vec<String> {
    // Name -> (uses, index of the last use).
    let mut stats: HashMap<&str, (usize, usize)> = HashMap::new();
    for (i, name) in used.iter().enumerate() {
        let stat = stats.entry(name).or_insert((0, i));
        stat.0 += 1;
        stat.1 = i;
    }
    let mut ranked: Vec<_> = stats.into_iter().collect();
    ranked.sort_by_key(|a| std::cmp::Reverse(a.1));
    ranked
        .into_iter()
        .take(FREQUENT_MAX)
        .map(|(name, _)| name.to_owned())
        .collect()
}

/// Takes the uses of the workspace `team_id` out of the file. Nothing is written when it has none.
pub(super) fn forget_team(dir: &Path, team_id: &str) -> Result<(), String> {
    let mut usage = load(dir);
    if usage.remove(team_id).is_none() {
        return Ok(());
    }
    save(dir, &usage)
}

/// A reaction `name` was added in the workspace `team_id` (S-25): the picker's choice or a press on a reaction that was there. Taking one off is not told. Asks Slack nothing.
#[tauri::command]
pub async fn slack_emoji_used(
    app: AppHandle,
    state: State<'_, SlackState>,
    team_id: String,
    name: String,
) -> Result<(), String> {
    let command = "slack_emoji_used";
    if token_key(&team_id).is_err() || !valid_reaction_name(&name) {
        return Err(log_failure(command, &team_id, BAD_EMOJI));
    }
    let dir = config_dir(&app)?;
    let _files = state.files.lock().await;
    let team = team_id.clone();
    blocking(move || {
        let mut usage = load(&dir);
        let used = usage.remove(&team).unwrap_or_default();
        usage.insert(team, with_used(used, &name));
        save(&dir, &usage)
    })
    .await
    .map_err(|e| log_failure(command, &team_id, e))
}

/// The emoji of the workspace `team_id` the user reacted with most (S-25), most first, at most 24. None for a workspace with no use.
#[tauri::command]
pub async fn slack_emoji_frequent(app: AppHandle, team_id: String) -> Result<Vec<String>, String> {
    let command = "slack_emoji_frequent";
    if token_key(&team_id).is_err() {
        return Err(log_failure(command, &team_id, BAD_EMOJI));
    }
    let dir = config_dir(&app)?;
    let team = team_id.clone();
    blocking(move || Ok(frequent(&load(&dir).remove(&team).unwrap_or_default())))
        .await
        .map_err(|e| log_failure(command, &team_id, e))
}

#[cfg(test)]
mod tests {
    use std::path::PathBuf;

    use super::*;

    fn names(list: &[&str]) -> Vec<String> {
        list.iter().map(|s| (*s).to_owned()).collect()
    }

    fn temp_dir(name: &str) -> PathBuf {
        let dir = std::env::temp_dir().join(format!(
            "tsunagiai-slack-emoji-usage-{}-{name}",
            std::process::id()
        ));
        let _ = std::fs::remove_dir_all(&dir);
        dir
    }

    #[test]
    fn frequent_puts_the_most_used_first() {
        let used = names(&["a", "b", "b", "c", "c", "c"]);
        assert_eq!(frequent(&used), names(&["c", "b", "a"]));
    }

    #[test]
    fn frequent_puts_the_newer_first_on_the_same_count() {
        // a and b are used twice; b was used last.
        let used = names(&["a", "b", "a", "b"]);
        assert_eq!(frequent(&used), names(&["b", "a"]));
        // The last use counts, not the first: a came first, but c was used after a's last use.
        let used = names(&["a", "c", "c", "a", "d", "d"]);
        assert_eq!(frequent(&used), names(&["d", "a", "c"]));
    }

    #[test]
    fn frequent_answers_nothing_for_no_use() {
        assert!(frequent(&[]).is_empty());
    }

    #[test]
    fn frequent_stops_at_24() {
        let used: Vec<String> = (0..30).map(|i| format!("e{i}")).collect();
        let top = frequent(&used);
        assert_eq!(top.len(), FREQUENT_MAX);
        // Every count is 1, so the newest come first.
        assert_eq!(top[0], "e29");
        assert_eq!(top[23], "e6");
    }

    #[test]
    fn with_used_appends_the_newest_last() {
        assert_eq!(with_used(names(&["a"]), "b"), names(&["a", "b"]));
    }

    #[test]
    fn with_used_drops_the_oldest_past_200() {
        let used: Vec<String> = (0..USAGE_MAX).map(|i| format!("e{i}")).collect();
        let used = with_used(used, "new");
        assert_eq!(used.len(), USAGE_MAX);
        assert_eq!(used[0], "e1");
        assert_eq!(used[USAGE_MAX - 1], "new");
    }

    #[test]
    fn parse_reads_what_it_wrote() {
        let usage = Usage::from([("T1".to_owned(), names(&["a", "b::skin-tone-2"]))]);
        let text = serde_json::to_string(&usage).unwrap();
        assert_eq!(parse(&text), usage);
    }

    #[test]
    fn parse_takes_a_broken_file_as_empty() {
        for text in ["", "not json", "[]", "null", "\"T1\"", "{"] {
            assert!(parse(text).is_empty(), "{text}");
        }
    }

    #[test]
    fn parse_leaves_out_what_is_the_wrong_shape() {
        let text = r#"{"T1": ["ok", 3, "Bad Name", "", ":colon:", "fine"], "T2": "x", "T3": {"a": 1}, "bad id": ["a"]}"#;
        assert_eq!(
            parse(text),
            Usage::from([("T1".to_owned(), names(&["ok", "fine"]))])
        );
    }

    #[test]
    fn parse_keeps_the_newest_200() {
        let list: Vec<String> = (0..250).map(|i| format!("e{i}")).collect();
        let text = serde_json::to_string(&Usage::from([("T1".to_owned(), list)])).unwrap();
        let used = &parse(&text)["T1"];
        assert_eq!(used.len(), USAGE_MAX);
        assert_eq!(used[0], "e50");
        assert_eq!(used[USAGE_MAX - 1], "e249");
    }

    #[test]
    fn save_and_load_round_trip_and_a_missing_file_is_empty() {
        let dir = temp_dir("round-trip");
        assert!(load(&dir).is_empty());
        let usage = Usage::from([("T1".to_owned(), names(&["a", "b"]))]);
        save(&dir, &usage).unwrap();
        assert_eq!(load(&dir), usage);
        std::fs::write(dir.join(USAGE_FILE), "broken").unwrap();
        assert!(load(&dir).is_empty());
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn forget_team_takes_out_only_that_workspace() {
        let dir = temp_dir("forget");
        let usage = Usage::from([
            ("T1".to_owned(), names(&["a"])),
            ("T2".to_owned(), names(&["b"])),
        ]);
        save(&dir, &usage).unwrap();
        forget_team(&dir, "T1").unwrap();
        assert_eq!(load(&dir), Usage::from([("T2".to_owned(), names(&["b"]))]));
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn forget_team_writes_nothing_for_a_workspace_with_no_use() {
        let dir = temp_dir("forget-none");
        forget_team(&dir, "T1").unwrap();
        assert!(!dir.join(USAGE_FILE).exists());
        save(&dir, &Usage::from([("T2".to_owned(), names(&["b"]))])).unwrap();
        let before = std::fs::read_to_string(dir.join(USAGE_FILE)).unwrap();
        forget_team(&dir, "T1").unwrap();
        assert_eq!(
            std::fs::read_to_string(dir.join(USAGE_FILE)).unwrap(),
            before
        );
        let _ = std::fs::remove_dir_all(&dir);
    }
}
