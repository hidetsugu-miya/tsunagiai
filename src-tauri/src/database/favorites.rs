//! The favorite tables of the database part of the Orca screen (A-52, #1539): the tables that a project shows above the tree of connections.
//!
//! They are in `database-favorites.json` (version 1) in the app config directory, written through `write_atomic`, under the place of the project (`None` for this machine, else the name of the saved environment) and its key in Orca's list, the key that `lsp-settings.json` (A-34) and `jira-connections.json` (J-1) use.
//! A project holds its favorites in the order they were added, each as the connection, the database and the table, all three texts that this module only checks and keeps: whether the connection or the table still exists is the screen's to decide, so a favorite of a connection that is gone stays in the file.
//! A text that is empty or too long, a control character, and a hundred and first favorite of a project are refused with a message, and nothing is written then. A file that cannot be read is an error and is never replaced, so a save does not wipe it.

use std::{path::Path, sync::Mutex};

use serde::{Deserialize, Serialize};
use tauri::AppHandle;
#[cfg(test)]
use ts_rs::TS;

use crate::{accounts::write_atomic, auth::config_dir};

const FILE: &str = "database-favorites.json";
const VERSION: u32 = 1;
/// The most favorites of one project.
const MAX_FAVORITES: usize = 100;
/// The longest connection, database or table, in characters.
const MAX_TEXT: usize = 256;
/// The longest environment or project key, in characters (the same limit as the other files keyed by project).
const MAX_PLACE: usize = 4096;
/// The file is read and written in turn by the commands of the screen, which may overlap.
static LOCK: Mutex<()> = Mutex::new(());

/// A favorite table: `connection` is the id of the saved connection (D-1), `database` the database under it and `table` the table (D-3).
#[derive(Serialize, Deserialize, Clone, Debug, PartialEq)]
#[cfg_attr(test, derive(TS))]
#[cfg_attr(test, ts(export, export_to = crate::BINDINGS))]
pub struct DatabaseFavorite {
    pub connection: String,
    pub database: String,
    pub table: String,
}

/// What `database-favorites.json` holds.
#[derive(Serialize, Deserialize, Debug, PartialEq)]
struct Store {
    version: u32,
    projects: Vec<ProjectFavorites>,
}

/// The favorites of the project `project` of `environment`; never saved empty.
#[derive(Serialize, Deserialize, Debug, PartialEq)]
struct ProjectFavorites {
    environment: Option<String>,
    project: String,
    favorites: Vec<DatabaseFavorite>,
}

impl ProjectFavorites {
    fn is_at(&self, environment: Option<&str>, project: &str) -> bool {
        self.environment.as_deref() == environment && self.project == project
    }
}

fn load(dir: &Path) -> Result<Store, String> {
    let path = dir.join(FILE);
    let text = match std::fs::read_to_string(&path) {
        Ok(text) => text,
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => {
            return Ok(Store {
                version: VERSION,
                projects: Vec::new(),
            })
        }
        Err(e) => return Err(format!("{} を読めません: {e}", path.display())),
    };
    let store: Store = serde_json::from_str(&text)
        .map_err(|e| format!("{} の形式が不正です: {e}", path.display()))?;
    if store.version != VERSION {
        return Err(format!(
            "{} の版 {} は読めません",
            path.display(),
            store.version
        ));
    }
    Ok(store)
}

fn store(dir: &Path, store: &Store) -> Result<(), String> {
    let text = serde_json::to_string_pretty(store).map_err(|e| e.to_string())?;
    write_atomic(dir, FILE, &text)
}

/// A text that is a key or a name: not empty, not longer than `limit` characters, with no control character.
fn check_text(what: &str, text: &str, limit: usize) -> Result<(), String> {
    if text.is_empty() || text.chars().count() > limit || text.chars().any(char::is_control) {
        return Err(format!("{what}が正しくありません"));
    }
    Ok(())
}

/// The key of a project as a command is given it, and the favorite.
fn check(
    environment: Option<&str>,
    project: &str,
    favorite: &DatabaseFavorite,
) -> Result<(), String> {
    if let Some(environment) = environment {
        check_text("接続先", environment, MAX_PLACE)?;
    }
    check_text("プロジェクト", project, MAX_PLACE)?;
    check_text("接続", &favorite.connection, MAX_TEXT)?;
    check_text("データベース", &favorite.database, MAX_TEXT)?;
    check_text("テーブル", &favorite.table, MAX_TEXT)
}

/// The favorites of the project `project` of `environment`, in the order they were added; none when nothing is saved for it. The key is not checked: a key that nothing was saved under has none.
fn favorites_of(
    dir: &Path,
    environment: Option<&str>,
    project: &str,
) -> Result<Vec<DatabaseFavorite>, String> {
    Ok(load(dir)?
        .projects
        .into_iter()
        .find(|p| p.is_at(environment, project))
        .map(|p| p.favorites)
        .unwrap_or_default())
}

/// Adds `favorite` after the others of the project (`on`; one that is there already stays where it is), or takes it away (not `on`; one that is not there changes nothing), and answers the favorites as saved. The read and the write are under one lock so that two changes do not lose each other, and nothing is written when the change is refused or changes nothing.
fn set_favorite(
    dir: &Path,
    environment: Option<&str>,
    project: &str,
    favorite: DatabaseFavorite,
    on: bool,
) -> Result<Vec<DatabaseFavorite>, String> {
    check(environment, project, &favorite)?;
    let _guard = LOCK.lock().unwrap_or_else(|e| e.into_inner());
    let mut saved = load(dir)?;
    let at = saved
        .projects
        .iter()
        .position(|p| p.is_at(environment, project));
    let mut favorites = at
        .map(|at| saved.projects[at].favorites.clone())
        .unwrap_or_default();
    let before = favorites.len();
    let present = favorites.contains(&favorite);
    if on && !present {
        if before >= MAX_FAVORITES {
            return Err(format!(
                "お気に入りは 1 プロジェクトに {MAX_FAVORITES} 件までです"
            ));
        }
        favorites.push(favorite);
    } else if !on && present {
        favorites.retain(|f| f != &favorite);
    } else {
        return Ok(favorites);
    }
    match (at, favorites.is_empty()) {
        (Some(at), true) => {
            saved.projects.remove(at);
        }
        (Some(at), false) => saved.projects[at].favorites = favorites.clone(),
        (None, _) => saved.projects.push(ProjectFavorites {
            environment: environment.map(str::to_owned),
            project: project.to_owned(),
            favorites: favorites.clone(),
        }),
    }
    store(dir, &saved)?;
    Ok(favorites)
}

/// The favorite tables of the project `project` of `environment` (`None`: this machine), in the order they were added.
#[tauri::command]
pub async fn database_favorites(
    app: AppHandle,
    environment: Option<String>,
    project: String,
) -> Result<Vec<DatabaseFavorite>, String> {
    let dir = config_dir(&app)?;
    tokio::task::spawn_blocking(move || {
        let _guard = LOCK.lock().unwrap_or_else(|e| e.into_inner());
        favorites_of(&dir, environment.as_deref(), &project)
    })
    .await
    .map_err(|e| e.to_string())?
}

/// Adds a table to the favorites of a project (`on`) or takes it away, and answers the favorites as saved.
#[tauri::command]
pub async fn database_favorite_set(
    app: AppHandle,
    environment: Option<String>,
    project: String,
    connection: String,
    database: String,
    table: String,
    on: bool,
) -> Result<Vec<DatabaseFavorite>, String> {
    let dir = config_dir(&app)?;
    tokio::task::spawn_blocking(move || {
        set_favorite(
            &dir,
            environment.as_deref(),
            &project,
            DatabaseFavorite {
                connection,
                database,
                table,
            },
            on,
        )
    })
    .await
    .map_err(|e| e.to_string())?
}

#[cfg(test)]
mod tests {
    use super::*;

    fn temp_dir(name: &str) -> std::path::PathBuf {
        let dir = std::env::temp_dir().join(format!(
            "tsunagiai-database-favorites-{}-{name}",
            std::process::id()
        ));
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).unwrap();
        dir
    }

    fn fav(connection: &str, database: &str, table: &str) -> DatabaseFavorite {
        DatabaseFavorite {
            connection: connection.to_owned(),
            database: database.to_owned(),
            table: table.to_owned(),
        }
    }

    #[test]
    fn nothing_saved_gives_no_favorites_and_makes_no_file() {
        let dir = temp_dir("none");
        assert_eq!(favorites_of(&dir, None, "p").unwrap(), vec![]);
        assert!(!dir.join(FILE).exists());
        std::fs::remove_dir_all(&dir).unwrap();
    }

    #[test]
    fn favorites_come_back_in_the_order_they_were_added_and_survive_a_reload() {
        let dir = temp_dir("order");
        let (b, a, c) = (
            fav("c1", "db", "b"),
            fav("c1", "db", "a"),
            fav("c2", "db", "c"),
        );
        set_favorite(&dir, None, "p", b.clone(), true).unwrap();
        set_favorite(&dir, None, "p", a.clone(), true).unwrap();
        let answer = set_favorite(&dir, None, "p", c.clone(), true).unwrap();
        assert_eq!(answer, vec![b.clone(), a.clone(), c.clone()]);
        assert_eq!(favorites_of(&dir, None, "p").unwrap(), vec![b, a, c]);
        std::fs::remove_dir_all(&dir).unwrap();
    }

    #[test]
    fn adding_one_that_is_there_changes_neither_the_order_nor_the_file() {
        let dir = temp_dir("again");
        let (a, b) = (fav("c", "db", "a"), fav("c", "db", "b"));
        set_favorite(&dir, None, "p", a.clone(), true).unwrap();
        set_favorite(&dir, None, "p", b.clone(), true).unwrap();
        let text = std::fs::read_to_string(dir.join(FILE)).unwrap();
        let answer = set_favorite(&dir, None, "p", a.clone(), true).unwrap();
        assert_eq!(answer, vec![a, b]);
        assert_eq!(std::fs::read_to_string(dir.join(FILE)).unwrap(), text);
        std::fs::remove_dir_all(&dir).unwrap();
    }

    #[test]
    fn removing_takes_only_that_one_and_keeps_the_order_of_the_rest() {
        let dir = temp_dir("remove");
        let (a, b, c) = (
            fav("c", "db", "a"),
            fav("c", "db", "b"),
            fav("c", "db", "c"),
        );
        for f in [&a, &b, &c] {
            set_favorite(&dir, None, "p", f.clone(), true).unwrap();
        }
        let answer = set_favorite(&dir, None, "p", b, false).unwrap();
        assert_eq!(answer, vec![a.clone(), c.clone()]);
        assert_eq!(favorites_of(&dir, None, "p").unwrap(), vec![a, c]);
        std::fs::remove_dir_all(&dir).unwrap();
    }

    #[test]
    fn removing_one_that_is_not_there_changes_nothing_and_writes_nothing() {
        let dir = temp_dir("remove-missing");
        let answer = set_favorite(&dir, None, "p", fav("c", "db", "a"), false).unwrap();
        assert_eq!(answer, vec![]);
        assert!(!dir.join(FILE).exists());
        std::fs::remove_dir_all(&dir).unwrap();
    }

    #[test]
    fn taking_away_the_last_one_leaves_no_entry_for_the_project() {
        let dir = temp_dir("last");
        let a = fav("c", "db", "a");
        set_favorite(&dir, None, "p", a.clone(), true).unwrap();
        set_favorite(&dir, None, "q", a.clone(), true).unwrap();
        assert_eq!(
            set_favorite(&dir, None, "p", a.clone(), false).unwrap(),
            vec![]
        );
        let saved = load(&dir).unwrap();
        assert_eq!(saved.projects.len(), 1);
        assert_eq!(saved.projects[0].project, "q");
        std::fs::remove_dir_all(&dir).unwrap();
    }

    #[test]
    fn projects_and_places_keep_their_own_favorites() {
        let dir = temp_dir("separate");
        let (a, b, c, d) = (
            fav("c", "db", "a"),
            fav("c", "db", "b"),
            fav("c", "db", "c"),
            fav("c", "db", "d"),
        );
        set_favorite(&dir, None, "p", a.clone(), true).unwrap();
        set_favorite(&dir, None, "q", b.clone(), true).unwrap();
        set_favorite(&dir, Some("pc"), "p", c.clone(), true).unwrap();
        set_favorite(&dir, Some("other"), "p", d.clone(), true).unwrap();
        assert_eq!(favorites_of(&dir, None, "p").unwrap(), vec![a.clone()]);
        assert_eq!(favorites_of(&dir, None, "q").unwrap(), vec![b]);
        assert_eq!(favorites_of(&dir, Some("pc"), "p").unwrap(), vec![c]);
        assert_eq!(favorites_of(&dir, Some("other"), "p").unwrap(), vec![d]);
        assert_eq!(favorites_of(&dir, Some("pc"), "q").unwrap(), vec![]);
        // Taking one away from a project leaves the same table of another project.
        set_favorite(&dir, Some("pc"), "p", a.clone(), true).unwrap();
        set_favorite(&dir, None, "p", a.clone(), false).unwrap();
        assert_eq!(favorites_of(&dir, None, "p").unwrap(), vec![]);
        assert_eq!(favorites_of(&dir, Some("pc"), "p").unwrap().len(), 2);
        std::fs::remove_dir_all(&dir).unwrap();
    }

    #[test]
    fn a_value_that_is_empty_long_or_has_a_control_character_is_refused_and_writes_nothing() {
        let dir = temp_dir("refuse");
        let long = "あ".repeat(MAX_TEXT + 1);
        let bad = [
            (None, "p", fav("", "db", "t")),
            (None, "p", fav("c", "", "t")),
            (None, "p", fav("c", "db", "")),
            (None, "p", fav("c", "db", "t\nu")),
            (None, "p", fav("c\u{0}", "db", "t")),
            (None, "p", fav("c", &long, "t")),
            (None, "p", fav("c", "db", &long)),
            (None, "", fav("c", "db", "t")),
            (None, "p\tq", fav("c", "db", "t")),
            (Some(""), "p", fav("c", "db", "t")),
            (Some("a\rb"), "p", fav("c", "db", "t")),
        ];
        for (environment, project, favorite) in bad {
            for on in [true, false] {
                let err =
                    set_favorite(&dir, environment, project, favorite.clone(), on).unwrap_err();
                assert!(err.ends_with("が正しくありません"), "{err}");
            }
        }
        assert!(!dir.join(FILE).exists());
        // A value at the limit is taken.
        let longest = "あ".repeat(MAX_TEXT);
        set_favorite(&dir, None, "p", fav("c", &longest, "t"), true).unwrap();
        std::fs::remove_dir_all(&dir).unwrap();
    }

    #[test]
    fn the_hundred_and_first_favorite_of_a_project_is_refused_and_the_file_stays() {
        let dir = temp_dir("limit");
        for n in 0..MAX_FAVORITES {
            set_favorite(&dir, None, "p", fav("c", "db", &format!("t{n}")), true).unwrap();
        }
        let text = std::fs::read_to_string(dir.join(FILE)).unwrap();
        let err = set_favorite(&dir, None, "p", fav("c", "db", "over"), true).unwrap_err();
        assert!(err.contains("100"), "{err}");
        assert_eq!(std::fs::read_to_string(dir.join(FILE)).unwrap(), text);
        assert_eq!(favorites_of(&dir, None, "p").unwrap().len(), MAX_FAVORITES);
        // One that is there already is not a new one, and another project has its own count.
        set_favorite(&dir, None, "p", fav("c", "db", "t0"), true).unwrap();
        set_favorite(&dir, None, "q", fav("c", "db", "over"), true).unwrap();
        // Taking one away makes room.
        set_favorite(&dir, None, "p", fav("c", "db", "t0"), false).unwrap();
        set_favorite(&dir, None, "p", fav("c", "db", "over"), true).unwrap();
        std::fs::remove_dir_all(&dir).unwrap();
    }

    #[test]
    fn a_file_that_cannot_be_read_is_an_error_and_a_change_leaves_it_as_it_is() {
        let broken = [
            "not json",
            r#"{"version":2,"projects":[]}"#,
            r#"{"version":1}"#,
            r#"{"version":1,"projects":[{"environment":null,"project":"p","favorites":[{"connection":"c"}]}]}"#,
        ];
        for (n, text) in broken.into_iter().enumerate() {
            let dir = temp_dir(&format!("broken{n}"));
            std::fs::write(dir.join(FILE), text).unwrap();
            let err = favorites_of(&dir, None, "p").unwrap_err();
            assert!(err.contains(FILE), "{err}");
            let err = set_favorite(&dir, None, "p", fav("c", "db", "t"), true).unwrap_err();
            assert!(err.contains(FILE), "{err}");
            assert_eq!(std::fs::read_to_string(dir.join(FILE)).unwrap(), text);
            assert!(!dir.join(format!("{FILE}.tmp")).exists());
            std::fs::remove_dir_all(&dir).unwrap();
        }
    }

    #[test]
    fn a_favorite_of_a_connection_that_is_gone_stays_in_the_file() {
        let dir = temp_dir("kept");
        let gone = fav("deleted-connection", "db", "t");
        set_favorite(&dir, None, "p", gone.clone(), true).unwrap();
        set_favorite(&dir, None, "p", fav("c", "db", "u"), true).unwrap();
        assert_eq!(favorites_of(&dir, None, "p").unwrap()[0], gone);
        std::fs::remove_dir_all(&dir).unwrap();
    }

    #[test]
    fn the_file_is_written_without_a_temporary_one_left() {
        let dir = temp_dir("atomic");
        set_favorite(&dir, Some("pc"), "p", fav("c", "db", "t"), true).unwrap();
        assert!(!dir.join(format!("{FILE}.tmp")).exists());
        let json: serde_json::Value =
            serde_json::from_str(&std::fs::read_to_string(dir.join(FILE)).unwrap()).unwrap();
        assert_eq!(json["version"], 1);
        assert_eq!(json["projects"][0]["environment"], "pc");
        assert_eq!(json["projects"][0]["favorites"][0]["table"], "t");
        std::fs::remove_dir_all(&dir).unwrap();
    }
}
