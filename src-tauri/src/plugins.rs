//! A-41: the folder of the owner's plugins, `~/.local/share/tsunagiai/plugins/` of this PC.
//! Each folder in it is one plugin (`.claude-plugin/plugin.json`, its skills and agents). The leader of a formation and its Claude Code children are given the folder as a whole with `claude --plugin-dir {folder}`, which loads each child folder as a plugin (`claude --help`: "a folder of plugins loads each child").
//! The app writes none of its files into it: the owner makes the plugins. It only makes the folder when it is missing, and reads `.mcp.json` of each plugin to find the plugins that have the Figma server (`figma_permissions`).

use std::path::{Path, PathBuf};

use serde_json::Value;

/// The folder of the plugins in the home folder, as names of folders.
const FOLDERS: [&str; 4] = [".local", "share", "tsunagiai", "plugins"];

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
}
