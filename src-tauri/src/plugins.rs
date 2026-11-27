//! A-41: the folder of the owner's plugins, `~/.local/share/tsunagiai/plugins/` of this PC.
//! Each folder in it is one plugin (`.claude-plugin/plugin.json`, its skills and agents). The leader of a formation and its Claude Code children are given the folder as a whole with `claude --plugin-dir {folder}`, which loads each child folder as a plugin (`claude --help`: "a folder of plugins loads each child").
//! The app writes none of its files into it but the new plugin that the Plugins tab of the settings makes (A-51, `plugin_create`: `{name}/.claude-plugin/plugin.json`): the owner makes the plugins. It makes the folder when it is missing, lists the plugins and their skills for that tab (`plugins_list`), and reads `.mcp.json` of each plugin to find the plugins that have the Figma server (`figma_permissions`).

use std::path::{Path, PathBuf};

use serde::Serialize;
use serde_json::Value;
#[cfg(test)]
use ts_rs::TS;

/// The folder of the plugins in the home folder, as names of folders.
const FOLDERS: [&str; 4] = [".local", "share", "tsunagiai", "plugins"];

/// A-51: the longest name of a new plugin.
const NAME_MAX: usize = 64;

/// The server of a plugin's `.mcp.json` whose tools a child's settings allow and deny (A-41, #1162).
const FIGMA_SERVER: &str = "figma";

/// `~/.local/share/tsunagiai/plugins`, with the home folder of the environment variable `HOME`.
pub fn plugins_dir() -> Result<PathBuf, String> {
    plugins_dir_in(std::env::var_os("HOME").as_deref().map(Path::new))
}

fn plugins_dir_in(home: Option<&Path>) -> Result<PathBuf, String> {
    let Some(home) = home.filter(|home| home.is_absolute()) else {
        return Err("環境変数 HOME がないので、プラグインのフォルダを決められません".to_owned());
    };
    Ok(FOLDERS
        .iter()
        .fold(home.to_path_buf(), |dir, name| dir.join(name)))
}

/// Makes `dir` when it is missing (with the folders above it), and answers it.
pub fn ensure_dir(dir: PathBuf) -> Result<PathBuf, String> {
    std::fs::create_dir_all(&dir).map_err(|e| format!("{} を作れません: {e}", dir.display()))?;
    Ok(dir)
}

/// The folder of the plugins of this PC, made when it is missing.
pub fn prepared_dir() -> Result<PathBuf, String> {
    ensure_dir(plugins_dir()?)
}

/// The names of the plugins of `dir` whose `.mcp.json` has the server `figma` under `mcpServers`, in order of folder name. The name is the `name` of the plugin's `.claude-plugin/plugin.json`, which is what Claude Code names the plugin's tools by, and the folder's name when that file is missing or holds no valid name (`manifest_name`). A folder that starts with a dot, a file, and a `.mcp.json` that is missing or is not JSON are left out.
fn figma_plugins(dir: &Path) -> Vec<String> {
    let Ok(entries) = std::fs::read_dir(dir) else {
        return Vec::new();
    };
    let mut folders: Vec<String> = entries
        .flatten()
        .filter(|entry| entry.path().is_dir())
        .filter_map(|entry| entry.file_name().into_string().ok())
        .filter(|name| !name.starts_with('.'))
        .filter(|name| has_figma(&dir.join(name).join(".mcp.json")))
        .collect();
    folders.sort();
    let mut names: Vec<String> = Vec::new();
    for folder in folders {
        let name = manifest_name(&dir.join(&folder)).unwrap_or(folder);
        if !names.contains(&name) {
            names.push(name);
        }
    }
    names
}

/// The `name` of `.claude-plugin/plugin.json` of the plugin folder `plugin`, when it is a text that a permission rule can hold: not empty, with no blank, control character, parenthesis or `*`.
fn manifest_name(plugin: &Path) -> Option<String> {
    let text = std::fs::read_to_string(plugin.join(".claude-plugin/plugin.json")).ok()?;
    let json: Value = serde_json::from_str(&text).ok()?;
    let name = json["name"].as_str()?;
    let valid = !name.is_empty()
        && !name
            .chars()
            .any(|c| c.is_whitespace() || c.is_control() || matches!(c, '(' | ')' | '*'));
    valid.then(|| name.to_owned())
}

fn has_figma(mcp_json: &Path) -> bool {
    std::fs::read_to_string(mcp_json)
        .ok()
        .and_then(|text| serde_json::from_str::<Value>(&text).ok())
        .is_some_and(|json| json["mcpServers"][FIGMA_SERVER].is_object())
}

/// The `permissions` of a child's `--settings` (A-41, #1162): for each plugin of `dir` that has the Figma server, the read tools allowed and the write tools denied, named `mcp__plugin_{name in plugin.json, else the folder's name}_figma__{tool}`. No plugin with the server gives empty lists.
pub fn figma_permissions(dir: &Path) -> Value {
    crate::formation_assets::figma_permissions_of(&figma_plugins(dir))
}

/// One plugin of the folder (A-51): `folder` is its folder's name, `name` is the name Claude Code calls it by (`manifest_name`, else the folder's), and `skills` are the folders of `skills/` that hold a `SKILL.md`, by name.
#[derive(Serialize, Clone, Debug, PartialEq)]
#[cfg_attr(test, derive(TS))]
#[cfg_attr(test, ts(export, export_to = crate::BINDINGS))]
#[serde(rename_all = "camelCase")]
pub struct Plugin {
    pub folder: String,
    pub name: String,
    pub skills: Vec<String>,
}

/// The plugins of `dir`, in order of folder name: each folder that does not start with a dot (a link to a folder counts). A folder that cannot be read has no skills.
fn list_plugins(dir: &Path) -> Vec<Plugin> {
    let Ok(entries) = std::fs::read_dir(dir) else {
        return Vec::new();
    };
    let mut plugins: Vec<Plugin> = entries
        .flatten()
        .filter(|entry| entry.path().is_dir())
        .filter_map(|entry| entry.file_name().into_string().ok())
        .filter(|folder| !folder.starts_with('.'))
        .map(|folder| {
            let path = dir.join(&folder);
            Plugin {
                name: manifest_name(&path).unwrap_or_else(|| folder.clone()),
                skills: skills_of(&path),
                folder,
            }
        })
        .collect();
    plugins.sort_by(|a, b| a.folder.cmp(&b.folder));
    plugins
}

/// The names of the folders of `skills/` of the plugin folder `plugin` that hold a `SKILL.md`, in order.
fn skills_of(plugin: &Path) -> Vec<String> {
    let Ok(entries) = std::fs::read_dir(plugin.join("skills")) else {
        return Vec::new();
    };
    let mut skills: Vec<String> = entries
        .flatten()
        .filter(|entry| entry.path().join("SKILL.md").is_file())
        .filter_map(|entry| entry.file_name().into_string().ok())
        .collect();
    skills.sort();
    skills
}

/// The name of a new plugin (A-51): 1 to 64 of a to z, 0 to 9 and `-`, starting with a letter or a digit. It is the folder's name, so nothing else gets through: no `/`, `.` or `..` can leave the folder of the plugins.
fn check_name(name: &str) -> Result<(), String> {
    let valid = (1..=NAME_MAX).contains(&name.chars().count())
        && name
            .chars()
            .all(|c| c.is_ascii_lowercase() || c.is_ascii_digit() || c == '-')
        && !name.starts_with('-');
    if valid {
        return Ok(());
    }
    Err(format!(
        "プラグインの名前は、英小文字・数字・- の {NAME_MAX} 文字までで、英小文字か数字から始めてください"
    ))
}

/// Makes the plugin `name` in `dir`: the folder and `.claude-plugin/plugin.json` with the name. A name that is taken is refused, and a half-made folder is removed.
fn create_plugin(dir: &Path, name: &str) -> Result<Plugin, String> {
    check_name(name)?;
    let path = dir.join(name);
    std::fs::create_dir(&path).map_err(|e| {
        if e.kind() == std::io::ErrorKind::AlreadyExists {
            format!("プラグイン「{name}」はもうあります")
        } else {
            format!("{} を作れません: {e}", path.display())
        }
    })?;
    let manifest = serde_json::to_string_pretty(&serde_json::json!({ "name": name }))
        .map_err(|e| e.to_string())?;
    let written = std::fs::create_dir(path.join(".claude-plugin"))
        .and_then(|()| std::fs::write(path.join(".claude-plugin/plugin.json"), manifest + "\n"));
    if let Err(e) = written {
        let _ = std::fs::remove_dir_all(&path);
        return Err(format!("プラグイン「{name}」を作れません: {e}"));
    }
    Ok(Plugin {
        folder: name.to_owned(),
        name: name.to_owned(),
        skills: Vec::new(),
    })
}

/// The folder of the plugin `folder` in `root` (A-51: where a Claude Code pane of the Plugins tab runs). `folder` comes from the screen, so it must be one name of a folder of `root`, not starting with a dot (as the list leaves them out), and no path: nothing with `/`, `\` or a NUL, which could lead out of `root`. A link to a folder is the owner's own and is followed.
pub fn plugin_dir(root: &Path, folder: &str) -> Result<PathBuf, String> {
    let one_name =
        !folder.is_empty() && !folder.starts_with('.') && !folder.contains(['/', '\\', '\0']);
    let path = root.join(folder);
    if one_name && path.is_dir() {
        return Ok(path);
    }
    Err(format!("プラグイン「{folder}」がありません"))
}

/// The plugins of this PC with their skills (A-51); the folder is made when it is missing.
#[tauri::command]
pub async fn plugins_list() -> Result<Vec<Plugin>, String> {
    tokio::task::spawn_blocking(|| Ok(list_plugins(&prepared_dir()?)))
        .await
        .map_err(|e| e.to_string())?
}

/// Makes a new plugin of that name (A-51) and answers it; a name that is not valid, or that is taken, is refused in Japanese.
#[tauri::command]
pub async fn plugin_create(name: String) -> Result<Plugin, String> {
    tokio::task::spawn_blocking(move || create_plugin(&prepared_dir()?, &name))
        .await
        .map_err(|e| e.to_string())?
}

#[cfg(test)]
mod tests {
    use super::*;

    fn temp_dir(name: &str) -> PathBuf {
        let dir =
            std::env::temp_dir().join(format!("tsunagiai-plugins-{}-{name}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).unwrap();
        dir
    }

    fn plugin(dir: &Path, name: &str, mcp_json: Option<&str>) {
        std::fs::create_dir_all(dir.join(name).join(".claude-plugin")).unwrap();
        std::fs::write(
            dir.join(name).join(".claude-plugin/plugin.json"),
            format!(r#"{{"name": "{name}"}}"#),
        )
        .unwrap();
        if let Some(text) = mcp_json {
            std::fs::write(dir.join(name).join(".mcp.json"), text).unwrap();
        }
    }

    fn rules(permissions: &Value, key: &str) -> Vec<String> {
        permissions[key]
            .as_array()
            .unwrap()
            .iter()
            .map(|rule| rule.as_str().unwrap().to_owned())
            .collect()
    }

    const WITH_FIGMA: &str =
        r#"{"mcpServers": {"figma": {"type": "http", "url": "https://mcp.figma.com/mcp"}}}"#;

    #[test]
    fn the_folder_is_local_share_tsunagiai_plugins_of_the_home_folder() {
        assert_eq!(
            plugins_dir_in(Some(Path::new("/Users/x"))).unwrap(),
            Path::new("/Users/x/.local/share/tsunagiai/plugins")
        );
        // No home folder, or one that is not absolute, is an error and never a path under the working folder.
        assert!(plugins_dir_in(None).unwrap_err().contains("HOME"));
        assert!(plugins_dir_in(Some(Path::new("home"))).is_err());
    }

    #[test]
    fn the_folder_is_made_when_it_is_missing_and_left_as_it_is_when_it_is_there() {
        let root = temp_dir("ensure");
        let dir = root.join(".local/share/tsunagiai/plugins");
        assert_eq!(ensure_dir(dir.clone()).unwrap(), dir);
        assert!(dir.is_dir());
        std::fs::create_dir_all(dir.join("mine")).unwrap();
        assert_eq!(ensure_dir(dir.clone()).unwrap(), dir);
        assert!(dir.join("mine").is_dir());
        // A file in its place is an error naming the folder.
        let blocked = root.join("file");
        std::fs::write(&blocked, "x").unwrap();
        assert!(ensure_dir(blocked.join("plugins"))
            .unwrap_err()
            .contains("を作れません"));
        std::fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn no_plugin_with_the_figma_server_gives_empty_lists() {
        let dir = temp_dir("figma-none");
        assert_eq!(
            figma_permissions(&dir),
            serde_json::json!({"allow": [], "deny": []})
        );
        plugin(&dir, "plain", None);
        plugin(
            &dir,
            "other-server",
            Some(r#"{"mcpServers": {"github": {}}}"#),
        );
        plugin(&dir, "broken", Some("{"));
        plugin(&dir, "flat", Some(r#"{"figma": {}}"#));
        std::fs::write(dir.join("file.md"), "x").unwrap();
        assert_eq!(
            figma_permissions(&dir),
            serde_json::json!({"allow": [], "deny": []})
        );
        // A folder that is not there is the same.
        assert_eq!(
            figma_permissions(&dir.join("missing")),
            serde_json::json!({"allow": [], "deny": []})
        );
        std::fs::remove_dir_all(dir).unwrap();
    }

    #[test]
    fn the_rules_name_the_plugin_by_its_manifest_and_by_its_folder_when_the_manifest_has_no_valid_name(
    ) {
        let dir = temp_dir("figma-manifest");
        // The folder's name differs from the name in plugin.json: the name in plugin.json is the one Claude Code uses.
        plugin(&dir, "folder-a", Some(WITH_FIGMA));
        std::fs::write(
            dir.join("folder-a/.claude-plugin/plugin.json"),
            r#"{"name": "client-a"}"#,
        )
        .unwrap();
        // No plugin.json, no name, an empty name, a name that is not a text, a name a rule cannot hold, and a broken file: the folder's name.
        plugin(&dir, "no-file", Some(WITH_FIGMA));
        std::fs::remove_file(dir.join("no-file/.claude-plugin/plugin.json")).unwrap();
        for (folder, manifest) in [
            ("no-name", "{}"),
            ("empty-name", r#"{"name": ""}"#),
            ("number-name", r#"{"name": 3}"#),
            ("star-name", r#"{"name": "a*"}"#),
            ("space-name", r#"{"name": "a b"}"#),
            ("broken", "{"),
        ] {
            plugin(&dir, folder, Some(WITH_FIGMA));
            std::fs::write(
                dir.join(folder).join(".claude-plugin/plugin.json"),
                manifest,
            )
            .unwrap();
        }
        let allow = rules(&figma_permissions(&dir), "allow");
        let mut named: Vec<&str> = allow
            .iter()
            .filter_map(|rule| rule.strip_suffix("__get_metadata"))
            .collect();
        named.sort_unstable();
        assert_eq!(
            named,
            [
                "mcp__plugin_broken_figma",
                "mcp__plugin_client-a_figma",
                "mcp__plugin_empty-name_figma",
                "mcp__plugin_no-file_figma",
                "mcp__plugin_no-name_figma",
                "mcp__plugin_number-name_figma",
                "mcp__plugin_space-name_figma",
                "mcp__plugin_star-name_figma",
            ]
        );
        assert!(allow.iter().all(|rule| !rule.contains("folder-a")));
        // Two folders with one manifest name give its rules once.
        plugin(&dir, "folder-b", Some(WITH_FIGMA));
        std::fs::write(
            dir.join("folder-b/.claude-plugin/plugin.json"),
            r#"{"name": "client-a"}"#,
        )
        .unwrap();
        assert_eq!(rules(&figma_permissions(&dir), "allow").len(), allow.len());
        std::fs::remove_dir_all(dir).unwrap();
    }

    #[test]
    fn each_plugin_with_the_figma_server_gets_its_own_allow_and_deny_rules() {
        let dir = temp_dir("figma-some");
        plugin(&dir, "client-a", Some(WITH_FIGMA));
        plugin(&dir, "plain", None);
        let one = figma_permissions(&dir);
        let (allow, deny) = (rules(&one, "allow"), rules(&one, "deny"));
        assert_eq!(
            allow,
            [
                "mcp__plugin_client-a_figma__get_metadata",
                "mcp__plugin_client-a_figma__get_design_context",
                "mcp__plugin_client-a_figma__get_screenshot"
            ]
        );
        assert!(deny.contains(&"mcp__plugin_client-a_figma__use_figma".to_owned()));
        assert!(deny
            .iter()
            .all(|rule| rule.starts_with("mcp__plugin_client-a_figma__")));
        plugin(&dir, "client-b", Some(WITH_FIGMA));
        plugin(&dir, ".hidden", Some(WITH_FIGMA));
        let two = figma_permissions(&dir);
        let (allow, deny) = (rules(&two, "allow"), rules(&two, "deny"));
        assert_eq!(allow.len(), 6);
        assert!(allow.contains(&"mcp__plugin_client-a_figma__get_screenshot".to_owned()));
        assert!(allow.contains(&"mcp__plugin_client-b_figma__get_screenshot".to_owned()));
        assert_eq!(deny.len(), rules(&one, "deny").len() * 2);
        assert!(allow
            .iter()
            .chain(&deny)
            .all(|rule| !rule.contains("hidden")));
        std::fs::remove_dir_all(dir).unwrap();
    }

    fn skill(dir: &Path, plugin: &str, skill: &str, file: bool) {
        let folder = dir.join(plugin).join("skills").join(skill);
        std::fs::create_dir_all(&folder).unwrap();
        if file {
            std::fs::write(folder.join("SKILL.md"), "---\nname: x\n---\n").unwrap();
        }
    }

    #[test]
    fn a_name_is_one_to_sixty_four_of_a_to_z_digits_and_hyphens_and_starts_with_a_letter_or_a_digit(
    ) {
        for good in [
            "a",
            "0",
            "client-a",
            "a-",
            "a--b",
            "9lives",
            &"a".repeat(64),
        ] {
            assert!(check_name(good).is_ok(), "{good}");
        }
        for bad in [
            "",
            "-a",
            "A",
            "Client",
            "a_b",
            "a b",
            "a.b",
            ".",
            "..",
            "a/b",
            "../x",
            "a\\b",
            "a\0b",
            "あ",
            &"a".repeat(65),
        ] {
            assert!(check_name(bad).is_err(), "{bad:?}");
        }
        assert!(check_name("A").unwrap_err().contains("英小文字"));
    }

    #[test]
    fn the_list_has_each_plugin_with_the_skills_that_have_a_skill_file() {
        let dir = temp_dir("list");
        assert_eq!(list_plugins(&dir), []);
        assert_eq!(list_plugins(&dir.join("missing")), []);
        plugin(&dir, "zeta", None);
        plugin(&dir, "alpha", None);
        skill(&dir, "alpha", "review", true);
        skill(&dir, "alpha", "design", true);
        // A folder with no SKILL.md, and a file in skills/, are no skill.
        skill(&dir, "alpha", "empty", false);
        std::fs::write(dir.join("alpha/skills/notes.md"), "x").unwrap();
        // The name of plugin.json is the plugin's name, and the folder's name is the fallback.
        plugin(&dir, "folder-b", None);
        std::fs::write(
            dir.join("folder-b/.claude-plugin/plugin.json"),
            r#"{"name": "client-b"}"#,
        )
        .unwrap();
        std::fs::create_dir_all(dir.join("no-manifest")).unwrap();
        // A hidden folder and a file are not plugins.
        plugin(&dir, ".hidden", None);
        std::fs::write(dir.join("file.md"), "x").unwrap();
        let list = list_plugins(&dir);
        let seen: Vec<(&str, &str, &[String])> = list
            .iter()
            .map(|p| (p.folder.as_str(), p.name.as_str(), p.skills.as_slice()))
            .collect();
        assert_eq!(
            seen,
            [
                (
                    "alpha",
                    "alpha",
                    &["design".to_owned(), "review".to_owned()][..]
                ),
                ("folder-b", "client-b", &[][..]),
                ("no-manifest", "no-manifest", &[][..]),
                ("zeta", "zeta", &[][..]),
            ]
        );
        std::fs::remove_dir_all(dir).unwrap();
    }

    #[test]
    fn a_new_plugin_has_its_folder_and_a_manifest_with_its_name() {
        let dir = temp_dir("create");
        let made = create_plugin(&dir, "client-a").unwrap();
        assert_eq!(
            made,
            Plugin {
                folder: "client-a".to_owned(),
                name: "client-a".to_owned(),
                skills: Vec::new()
            }
        );
        let manifest: Value = serde_json::from_str(
            &std::fs::read_to_string(dir.join("client-a/.claude-plugin/plugin.json")).unwrap(),
        )
        .unwrap();
        assert_eq!(manifest, serde_json::json!({"name": "client-a"}));
        // The list reads it back as the same plugin.
        assert_eq!(list_plugins(&dir), [made]);
        std::fs::remove_dir_all(dir).unwrap();
    }

    #[test]
    fn a_name_that_is_taken_or_not_valid_makes_nothing() {
        let dir = temp_dir("create-refused");
        std::fs::create_dir_all(dir.join("mine")).unwrap();
        std::fs::write(dir.join("mine/keep.md"), "keep").unwrap();
        let taken = create_plugin(&dir, "mine").unwrap_err();
        assert!(taken.contains("もうあります"), "{taken}");
        // The folder of the owner is left as it was: no manifest was written into it.
        assert!(!dir.join("mine/.claude-plugin").exists());
        assert_eq!(
            std::fs::read_to_string(dir.join("mine/keep.md")).unwrap(),
            "keep"
        );
        // A file of that name is taken too.
        std::fs::write(dir.join("file"), "x").unwrap();
        assert!(create_plugin(&dir, "file")
            .unwrap_err()
            .contains("もうあります"));
        for bad in ["", "A", "../outside", "a/b"] {
            assert!(create_plugin(&dir, bad).is_err(), "{bad:?}");
        }
        assert!(!dir.parent().unwrap().join("outside").exists());
        // A folder that is not there cannot be written, and nothing is left behind.
        let error = create_plugin(&dir.join("missing"), "x").unwrap_err();
        assert!(error.contains("作れません"), "{error}");
        std::fs::remove_dir_all(dir).unwrap();
    }

    #[test]
    fn a_pane_runs_only_in_one_folder_of_the_plugins() {
        let root = temp_dir("pane-dir");
        std::fs::create_dir_all(root.join("mine")).unwrap();
        std::fs::create_dir_all(root.join(".hidden")).unwrap();
        std::fs::write(root.join("file"), "x").unwrap();
        assert_eq!(plugin_dir(&root, "mine").unwrap(), root.join("mine"));
        for bad in [
            "", ".", "..", ".hidden", "file", "missing", "mine/..", "../x", "/", "mine/", "a\\b",
            "a\0b",
        ] {
            let error = plugin_dir(&root, bad).unwrap_err();
            assert!(error.contains("がありません"), "{bad:?}: {error}");
        }
        std::fs::remove_dir_all(root).unwrap();
    }
}
