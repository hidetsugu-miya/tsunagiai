//! The titles the owner gave to the sessions of the Orca screen (A-8).
//!
//! The title of a session row comes from Claude Code (its name for the conversation, the first prompt) and changes by itself, and `orca terminal list` cannot say whether a title was typed by the owner or made by Claude.
//! So the app keeps the typed ones: `orca-titles.json` in the app config directory, `{"{target}": {"{paneKey}": "title"}}`, written through `write_atomic` (a temporary file and a rename) by a call that reads the file again and writes all of it.
//! The target is the string the screen names a place with: a saved environment's name, or `このマシン` (`THIS_MACHINE` of `ts/orca.ts`) for this machine.
//! A title is one line of text from the owner: its control characters are replaced by spaces, its hidden characters are taken out, and it is cut to `LINE_LIMIT` characters (`orca::plain_line`). An empty one takes the key out, and the target with it when it holds no other.
//! A file that is missing, cannot be read or is not that shape holds no title, and the next call writes it again.

use std::{
    collections::BTreeMap,
    path::Path,
    sync::{Mutex, PoisonError},
};

use tauri::AppHandle;

use crate::{accounts::write_atomic, auth::config_dir, orca::plain_line};

const FILE: &str = "orca-titles.json";
/// Characters of a target and of a pane key (a saved environment's name and an Orca pane key are far shorter).
const NAME_LIMIT: usize = 256;

/// The titles by target, and in a target by pane key.
type Titles = BTreeMap<String, BTreeMap<String, String>>;

/// `value` as it is when it can be a target or a pane key; otherwise the message of a refusal. `what` names it in the message.
fn check_name(what: &str, value: &str) -> Result<(), String> {
    if value.trim().is_empty()
        || value.chars().count() > NAME_LIMIT
        || value.chars().any(char::is_control)
    {
        return Err(format!("{what}が正しくありません"));
    }
    Ok(())
}

/// The titles of the file's text, with no empty title and no empty target. A text that is not the shape of the file gives none.
fn parse(text: &str) -> Titles {
    let Ok(mut titles) = serde_json::from_str::<Titles>(text) else {
        return Titles::new();
    };
    for keyed in titles.values_mut() {
        keyed.retain(|_, title| !title.is_empty());
    }
    titles.retain(|_, keyed| !keyed.is_empty());
    titles
}

/// `titles` with the title of `key` under `target` set to `title` as one clean line, or taken out when nothing is left of it (and the target, when it holds no other).
fn with_title(mut titles: Titles, target: &str, key: &str, title: &str) -> Titles {
    let title = plain_line(title);
    if title.is_empty() {
        if let Some(keyed) = titles.get_mut(target) {
            keyed.remove(key);
            if keyed.is_empty() {
                titles.remove(target);
            }
        }
    } else {
        titles
            .entry(target.to_owned())
            .or_default()
            .insert(key.to_owned(), title);
    }
    titles
}

/// The titles saved in `dir`: a file that is missing, cannot be read or is not the shape of the file gives none.
fn load(dir: &Path) -> Titles {
    std::fs::read_to_string(dir.join(FILE))
        .map(|text| parse(&text))
        .unwrap_or_default()
}

/// Sets (or, for an empty `title`, takes out) the title of `key` under `target`, and answers the titles saved. One write at a time reads the file again, changes it and writes all of it.
fn set(dir: &Path, target: &str, key: &str, title: &str) -> Result<Titles, String> {
    check_name("接続先", target)?;
    check_name("キー", key)?;
    static WRITING: Mutex<()> = Mutex::new(());
    let _one_at_a_time = WRITING.lock().unwrap_or_else(PoisonError::into_inner);
    let titles = with_title(load(dir), target, key, title);
    let text = serde_json::to_string_pretty(&titles).map_err(|e| e.to_string())?;
    write_atomic(dir, FILE, &text)?;
    Ok(titles)
}

/// The titles the owner gave to sessions, by target and pane key (A-8).
#[tauri::command]
pub async fn orca_titles(app: AppHandle) -> Result<Titles, String> {
    let dir = config_dir(&app)?;
    tokio::task::spawn_blocking(move || load(&dir))
        .await
        .map_err(|e| e.to_string())
}

/// Gives the session `key` (its pane key) of `target` the title `title`, or, with an empty one, takes its title out (A-8). Answers every title saved. A blank `target` or `key`, one with a control character and one over 256 characters are refused (a Japanese message), and nothing is written.
#[tauri::command]
pub async fn orca_title_set(
    app: AppHandle,
    target: String,
    key: String,
    title: String,
) -> Result<Titles, String> {
    check_name("接続先", &target)?;
    check_name("キー", &key)?;
    let dir = config_dir(&app)?;
    tokio::task::spawn_blocking(move || set(&dir, &target, &key, &title))
        .await
        .map_err(|e| e.to_string())?
}

#[cfg(test)]
mod tests {
    use std::path::PathBuf;

    use super::*;
    use crate::orca::LINE_LIMIT;

    fn temp_dir(name: &str) -> PathBuf {
        let dir =
            std::env::temp_dir().join(format!("tsunagiai-titles-{}-{name}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).unwrap();
        dir
    }

    fn one(target: &str, key: &str, title: &str) -> Titles {
        with_title(Titles::new(), target, key, title)
    }

    #[test]
    fn a_title_is_set_and_replaced_under_its_target_and_key() {
        let titles = one("このマシン", "tab:1", "調査");
        assert_eq!(titles["このマシン"]["tab:1"], "調査");
        let titles = with_title(titles, "このマシン", "tab:1", "実装");
        let titles = with_title(titles, "このマシン", "tab:2", "レビュー");
        let titles = with_title(titles, "dev", "tab:1", "別の対象");
        assert_eq!(titles["このマシン"]["tab:1"], "実装");
        assert_eq!(titles["このマシン"]["tab:2"], "レビュー");
        assert_eq!(titles["dev"]["tab:1"], "別の対象");
    }

    #[test]
    fn an_empty_title_takes_the_key_out_and_the_target_with_the_last_key() {
        let titles = with_title(one("a", "k1", "x"), "a", "k2", "y");
        let titles = with_title(titles, "a", "k1", "  \n ");
        assert_eq!(titles["a"].len(), 1);
        assert_eq!(titles["a"]["k2"], "y");
        let titles = with_title(titles, "a", "k2", "\u{200b}");
        assert!(titles.is_empty());
        // A key or a target that is not there stays not there.
        assert!(with_title(Titles::new(), "a", "k", "").is_empty());
        let titles = with_title(one("a", "k", "x"), "b", "k", "");
        assert_eq!(titles.len(), 1);
    }

    #[test]
    fn a_title_is_one_clean_line_cut_to_the_line_limit() {
        assert_eq!(one("a", "k", "  first\nsecond  ")["a"]["k"], "first");
        assert_eq!(one("a", "k", "\n\n first")["a"]["k"], "first");
        assert_eq!(one("a", "k", "a\tb\u{7}c")["a"]["k"], "a b c");
        assert_eq!(
            one("a", "k", "a\u{200b}b\u{202e}c\u{e0041}d")["a"]["k"],
            "abcd"
        );
        let long = one("a", "k", &"あ".repeat(LINE_LIMIT + 50));
        assert_eq!(long["a"]["k"].chars().count(), LINE_LIMIT);
    }

    #[test]
    fn a_target_and_a_key_that_cannot_be_used_are_refused() {
        assert!(check_name("キー", "tab:1").is_ok());
        assert!(check_name("キー", &"a".repeat(NAME_LIMIT)).is_ok());
        assert_eq!(check_name("キー", ""), Err("キーが正しくありません".into()));
        assert!(check_name("キー", "  ").is_err());
        assert!(check_name("キー", "a\nb").is_err());
        assert!(check_name("キー", &"a".repeat(NAME_LIMIT + 1)).is_err());
        // The limit counts characters, not bytes.
        assert!(check_name("キー", &"あ".repeat(NAME_LIMIT)).is_ok());
    }

    #[test]
    fn a_text_that_is_not_the_shape_of_the_file_holds_no_title() {
        assert!(parse("").is_empty());
        assert!(parse("{").is_empty());
        assert!(parse("[]").is_empty());
        assert!(parse(r#"{"a": {"k": 1}}"#).is_empty());
        assert!(parse(r#"{"a": "x"}"#).is_empty());
        let titles = parse(r#"{"a": {"k": "x", "e": ""}, "b": {"e": ""}}"#);
        assert_eq!(titles.len(), 1);
        assert_eq!(titles["a"].len(), 1);
        assert_eq!(titles["a"]["k"], "x");
    }

    #[test]
    fn the_file_is_written_and_read_back_and_a_refused_call_writes_nothing() {
        let dir = temp_dir("file");
        assert!(load(&dir).is_empty());
        let saved = set(&dir, "このマシン", "tab:1", "題名\n二行目").unwrap();
        assert_eq!(saved["このマシン"]["tab:1"], "題名");
        let saved = set(&dir, "dev", "tab:9", "other").unwrap();
        assert_eq!(saved, load(&dir));
        assert_eq!(saved.len(), 2);
        assert!(!dir.join("orca-titles.json.tmp").exists());
        assert!(set(&dir, "", "tab:1", "x").is_err());
        assert!(set(&dir, "dev", "a\nb", "x").is_err());
        assert_eq!(load(&dir), saved);
        let saved = set(&dir, "dev", "tab:9", "").unwrap();
        assert_eq!(saved.len(), 1);
        let saved = set(&dir, "このマシン", "tab:1", "").unwrap();
        assert!(saved.is_empty());
        assert!(load(&dir).is_empty());
        std::fs::remove_dir_all(&dir).unwrap();
    }

    #[test]
    fn a_file_that_cannot_be_read_holds_no_title_and_the_next_call_replaces_it() {
        let dir = temp_dir("broken");
        std::fs::write(dir.join(FILE), "{").unwrap();
        assert!(load(&dir).is_empty());
        let saved = set(&dir, "a", "k", "x").unwrap();
        assert_eq!(load(&dir), saved);
        std::fs::remove_dir_all(&dir).unwrap();
    }
}
