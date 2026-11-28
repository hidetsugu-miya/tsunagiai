//! A-41: the folder of the owner's plugins, `~/.local/share/tsunagiai/plugins/` of this PC.
//! Each folder in it is one plugin (`.claude-plugin/plugin.json`, its skills and agents). The leader of a formation and its Claude Code children are given the folder as a whole with `claude --plugin-dir {folder}`, which loads each child folder as a plugin (`claude --help`: "a folder of plugins loads each child").
//! The app writes none of its files into it but the new plugin that the Plugins tab of the settings makes (A-51, `plugin_create`: `{name}/.claude-plugin/plugin.json`) and the file that the owner saves in the editor of that tab (`plugin_file_write`): the owner makes the plugins. It makes the folder when it is missing, lists the plugins and their skills for that tab (`plugins_list`), and reads `.mcp.json` of each plugin to find the plugins that have the Figma server (`figma_permissions`).
//! The file tree and the editor of that tab (A-51) read and write the files of one plugin's folder only (`plugin_files`, `plugin_file_read`, `plugin_file_write`; `resolve` keeps every path inside the folder, a link that leads out included).

use std::path::{Path, PathBuf};

use serde::Serialize;
use serde_json::Value;
use sha2::{Digest, Sha256};
#[cfg(test)]
use ts_rs::TS;

use crate::orca_files::{
    check_written, disk_text, editor_text, OrcaFileText, OrcaSaveState, OrcaSaved, NOT_UTF8,
};

/// The folder of the plugins in the home folder, as names of folders.
const FOLDERS: [&str; 4] = [".local", "share", "tsunagiai", "plugins"];

/// A-51: the longest name of a new plugin.
const NAME_MAX: usize = 64;

/// A-51: the largest file of a plugin that the editor opens and saves.
const FILE_MAX: usize = 2 * 1024 * 1024;

/// A-51: the names that the file tree leaves out.
const TREE_HIDDEN: [&str; 2] = [".git", ".DS_Store"];

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

/// The `permissions.deny` rule that stops the agents of a formation from changing the owner's plugins (A-41): Claude Code's `Edit` rule covers every built-in tool that edits files (Edit, Write, MultiEdit, NotebookEdit), and `//` before the path makes it an absolute one (Claude Code's documentation of permissions, "How path patterns match"). The leader and the children run in the auto mode and load the folder with `--plugin-dir`, so a hook or an MCP server that one of them wrote there would run in every later start and be sent to the PCs of saved environments. A folder whose path holds a character of the pattern syntax or of the rule's own (`(`, `)`, `*`, `?`, `[`, `]`, `\\`, `!`, `#`, a control character) is refused: the rule would not name it.
pub fn edit_deny_rule(dir: &Path) -> Result<String, String> {
    let path = dir
        .to_str()
        .map(|text| text.trim_end_matches('/'))
        .filter(|text| text.starts_with('/'))
        .filter(|text| {
            !text.chars().any(|c| {
                c.is_control() || matches!(c, '(' | ')' | '*' | '?' | '[' | ']' | '\\' | '!' | '#')
            })
        })
        .ok_or_else(|| {
            format!(
                "プラグインのフォルダの場所を、権限の規則に書けません: {}",
                dir.display()
            )
        })?;
    Ok(format!("Edit(/{path}/**)"))
}

/// The `permissions` of the settings of a leader or of a Claude Code child (A-41): the Figma rules (`figma_permissions`) and the rule that denies editing the plugins' folder `dir` (`edit_deny_rule`).
pub fn agent_permissions(dir: &Path) -> Result<Value, String> {
    let mut permissions = figma_permissions(dir);
    let rule = edit_deny_rule(dir)?;
    if let Some(deny) = permissions["deny"].as_array_mut() {
        deny.push(Value::String(rule));
    }
    Ok(permissions)
}

/// One plugin of the folder (A-51): `folder` is its folder's name, `name` is the name Claude Code calls it by (`manifest_name`, else the folder's), `path` is where the folder is, for the head of the file tree (`~/.local/share/tsunagiai/plugins/{folder}`), and `skills` are the folders of `skills/` that hold a `SKILL.md`, by name.
#[derive(Serialize, Clone, Debug, PartialEq)]
#[cfg_attr(test, derive(TS))]
#[cfg_attr(test, ts(export, export_to = crate::BINDINGS))]
#[serde(rename_all = "camelCase")]
pub struct Plugin {
    pub folder: String,
    pub name: String,
    pub path: String,
    pub skills: Vec<String>,
}

/// `~/.local/share/tsunagiai/plugins/{folder}`, as the head of the file tree shows it.
fn shown_path(folder: &str) -> String {
    format!("~/{}/{folder}", FOLDERS.join("/"))
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
                path: shown_path(&folder),
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
        path: shown_path(name),
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

/// One entry of a folder of a plugin (A-51): its name, and whether it is a folder (a link to a folder is one).
#[derive(Serialize, Clone, Debug, PartialEq)]
#[cfg_attr(test, derive(TS))]
#[cfg_attr(test, ts(export, export_to = crate::BINDINGS))]
pub struct PluginEntry {
    pub name: String,
    pub folder: bool,
}

/// The real path of `relative` (from the plugin folder `root`; `allow_empty`: the empty one is `root` itself), kept inside `root`. `relative` comes from the screen, so it is checked as a path of the worktrees is (`check_written`: no empty part, `.`, `..`, `\`, control character such as NUL, and no absolute path, whose first part is empty), and the path that is found after the links are followed must still be under the real path of `root`: a link that leads out is refused, whatever it points at. `None` is a path that is not there (a link that leads nowhere too).
fn resolve(root: &Path, relative: &str, allow_empty: bool) -> Result<Option<PathBuf>, String> {
    check_written(relative, allow_empty)?;
    let root = root
        .canonicalize()
        .map_err(|e| format!("プラグインのフォルダを開けません: {e}"))?;
    let real = match root.join(relative).canonicalize() {
        Ok(real) => real,
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => return Ok(None),
        Err(e) => return Err(format!("{relative} を開けません: {e}")),
    };
    if !real.starts_with(&root) {
        return Err("プラグインのフォルダの外は開けません".to_owned());
    }
    Ok(Some(real))
}

/// The entries of the folder `relative` of the plugin folder `root` (the empty one is the plugin's own folder): the folders first and then the files, each by name (the case of a letter breaks a tie last). `.git` and `.DS_Store` are left out and the other dot names are shown (`.claude-plugin`, `.mcp.json`).
fn list_dir(root: &Path, relative: &str) -> Result<Vec<PluginEntry>, String> {
    let dir = resolve(root, relative, true)?.ok_or("フォルダが見つかりません")?;
    if !dir.is_dir() {
        return Err(format!("{relative} はフォルダではありません"));
    }
    let entries = std::fs::read_dir(&dir).map_err(|e| format!("フォルダを読めません: {e}"))?;
    let mut list: Vec<PluginEntry> = entries
        .flatten()
        .filter_map(|entry| {
            let name = entry.file_name().into_string().ok()?;
            (!TREE_HIDDEN.contains(&name.as_str())).then(|| PluginEntry {
                folder: entry.path().is_dir(),
                name,
            })
        })
        .collect();
    list.sort_by(|a, b| {
        b.folder
            .cmp(&a.folder)
            .then_with(|| a.name.to_lowercase().cmp(&b.name.to_lowercase()))
            .then_with(|| a.name.cmp(&b.name))
    });
    Ok(list)
}

/// The signature of a text: SHA-256 of it, in hex. The save compares it with the file on the disk, so a file that another process changed is never overwritten.
fn signature_of(text: &str) -> String {
    Sha256::digest(text.as_bytes())
        .iter()
        .map(|byte| format!("{byte:02x}"))
        .collect()
}

fn too_large() -> String {
    format!(
        "{} MiB を超えるファイルは開けません",
        FILE_MAX / 1024 / 1024
    )
}

/// The text of the file `relative` for the editor: the whole file as UTF-8 up to `FILE_MAX`, with LF line ends (`crlf` says it has CRLF), its language and its signature. A file that is too large, is not UTF-8 or holds a NUL (a binary file), and one whose line ends are mixed, is refused in Japanese.
///
/// A file whose signature is `known` (the editor's reread of a text it holds already, every few seconds) is answered with no content: the signature alone, an empty `content` and `language`, and `crlf` false, so that the text does not cross to the screen for nothing, which keeps what it has when the signature is the one it holds.
fn read_file(root: &Path, relative: &str, known: Option<&str>) -> Result<OrcaFileText, String> {
    let path = resolve(root, relative, false)?.ok_or("ファイルが見つかりません")?;
    let meta = std::fs::metadata(&path).map_err(|e| format!("{relative} を読めません: {e}"))?;
    if !meta.is_file() {
        return Err(format!("{relative} はファイルではありません"));
    }
    if meta.len() > FILE_MAX as u64 {
        return Err(too_large());
    }
    let bytes = std::fs::read(&path).map_err(|e| format!("{relative} を読めません: {e}"))?;
    let text = String::from_utf8(bytes).map_err(|_| NOT_UTF8.to_owned())?;
    if text.contains('\0') {
        return Err("バイナリのファイルは開けません".to_owned());
    }
    let signature = signature_of(&text);
    if known == Some(signature.as_str()) {
        return Ok(OrcaFileText {
            content: String::new(),
            crlf: false,
            signature,
            language: String::new(),
        });
    }
    editor_text(&text, relative, signature)
}

/// Saves `content` (LF line ends; `crlf` brings the file's own back) over the file `relative` when the disk still holds the text whose signature is `signature`: else nothing is written and the state says why (`changed`: another text, `missing`: no file, `not-utf8`). The text goes to a temporary file beside the file and is renamed over it, so a failed write leaves the file as it was, and the file keeps its mode.
fn write_file(
    root: &Path,
    relative: &str,
    content: &str,
    crlf: bool,
    signature: &str,
) -> Result<OrcaSaved, String> {
    if content.len() > FILE_MAX {
        return Err(too_large());
    }
    let refused = |state| {
        Ok(OrcaSaved {
            state,
            signature: signature.to_owned(),
        })
    };
    let Some(path) = resolve(root, relative, false)? else {
        return refused(OrcaSaveState::Missing);
    };
    let current = match std::fs::read(&path) {
        Ok(bytes) => bytes,
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => {
            return refused(OrcaSaveState::Missing)
        }
        Err(e) => return Err(format!("{relative} を読めません: {e}")),
    };
    let Ok(current) = String::from_utf8(current) else {
        return refused(OrcaSaveState::NotUtf8);
    };
    if signature_of(&current) != signature {
        return refused(OrcaSaveState::Changed);
    }
    let text = disk_text(content, crlf);
    replace_file(&path, text.as_bytes())
        .map_err(|e| format!("{relative} を保存できません: {e}"))?;
    Ok(OrcaSaved {
        state: OrcaSaveState::Saved,
        signature: signature_of(&text),
    })
}

/// Writes `bytes` to a temporary file beside `path`, gives it the mode of `path` and renames it over `path`; the temporary file is removed when a step fails.
fn replace_file(path: &Path, bytes: &[u8]) -> std::io::Result<()> {
    let name = path
        .file_name()
        .map(|n| n.to_string_lossy().into_owned())
        .unwrap_or_default();
    let temp = path.with_file_name(format!(".{name}.tsunagiai-{}.tmp", std::process::id()));
    let written = std::fs::write(&temp, bytes)
        .and_then(|()| std::fs::set_permissions(&temp, std::fs::metadata(path)?.permissions()))
        .and_then(|()| std::fs::rename(&temp, path));
    if written.is_err() {
        let _ = std::fs::remove_file(&temp);
    }
    written
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

/// The folder of the plugin `folder` of this PC (A-51), checked as one folder name of the plugins' folder.
fn plugin_root(folder: &str) -> Result<PathBuf, String> {
    plugin_dir(&plugins_dir()?, folder)
}

/// The entries of the folder `dir` of the plugin `folder` (A-51; `dir` is from the plugin's folder, the empty one is that folder), the folders first. A path that leaves the plugin's folder is refused.
#[tauri::command]
pub async fn plugin_files(folder: String, dir: String) -> Result<Vec<PluginEntry>, String> {
    tokio::task::spawn_blocking(move || list_dir(&plugin_root(&folder)?, &dir))
        .await
        .map_err(|e| e.to_string())?
}

/// The text of the file `path` of the plugin `folder` (A-51) for the editor, with its signature; a file that is too large or is not text is refused in Japanese. With `known`, the signature that the editor holds, a file that still has it is answered with no content (`read_file_unless`).
#[tauri::command]
pub async fn plugin_file_read(
    folder: String,
    path: String,
    known: Option<String>,
) -> Result<OrcaFileText, String> {
    tokio::task::spawn_blocking(move || read_file(&plugin_root(&folder)?, &path, known.as_deref()))
        .await
        .map_err(|e| e.to_string())?
}

/// Saves `content` over the file `path` of the plugin `folder` (A-51) when the disk still holds the text whose `signature` is given, and answers what happened. It is not tried again: a refusal is a state, and a failure carries its message.
#[tauri::command]
pub async fn plugin_file_write(
    folder: String,
    path: String,
    content: String,
    crlf: bool,
    signature: String,
) -> Result<OrcaSaved, String> {
    tokio::task::spawn_blocking(move || {
        write_file(&plugin_root(&folder)?, &path, &content, crlf, &signature)
    })
    .await
    .map_err(|e| e.to_string())?
}

#[cfg(test)]
mod tests {
    /// `read_file` with no signature held.
    fn read_text(root: &Path, relative: &str) -> Result<OrcaFileText, String> {
        read_file(root, relative, None)
    }

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
    fn the_agents_may_not_edit_the_plugins_folder_and_a_path_the_rule_cannot_name_is_refused() {
        assert_eq!(
            edit_deny_rule(Path::new("/Users/x/.local/share/tsunagiai/plugins")).unwrap(),
            "Edit(//Users/x/.local/share/tsunagiai/plugins/**)"
        );
        assert_eq!(
            edit_deny_rule(Path::new("/Users/x/My Files/plugins/")).unwrap(),
            "Edit(//Users/x/My Files/plugins/**)"
        );
        for bad in [
            "plugins",
            "",
            "/Users/x (old)/plugins",
            "/Users/x/*/plugins",
            "/Users/x/[a]/plugins",
            "/Users/x/a\\b",
            "/Users/x/!y",
            "/Users/x/#y",
            "/Users/x/a\nb",
        ] {
            assert!(edit_deny_rule(Path::new(bad)).is_err(), "{bad:?}");
        }
        // The rule joins the Figma ones: the lists of a plugin that has the server, then the Edit rule.
        let dir = temp_dir("agent-permissions");
        assert_eq!(
            agent_permissions(&dir).unwrap(),
            serde_json::json!({"allow": [], "deny": [edit_deny_rule(&dir).unwrap()]})
        );
        plugin(&dir, "client-a", Some(r#"{"mcpServers": {"figma": {}}}"#));
        let permissions = agent_permissions(&dir).unwrap();
        assert_eq!(permissions["allow"], figma_permissions(&dir)["allow"]);
        let deny = permissions["deny"].as_array().unwrap();
        assert_eq!(
            deny.len(),
            figma_permissions(&dir)["deny"].as_array().unwrap().len() + 1
        );
        assert_eq!(
            deny.last().unwrap(),
            &Value::String(edit_deny_rule(&dir).unwrap())
        );
        std::fs::remove_dir_all(dir).unwrap();
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
                path: "~/.local/share/tsunagiai/plugins/client-a".to_owned(),
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

    /// A plugin folder with the files `files` (relative path, text).
    fn plugin_with(name: &str, files: &[(&str, &str)]) -> PathBuf {
        let root = temp_dir(name);
        for (relative, text) in files {
            let path = root.join(relative);
            std::fs::create_dir_all(path.parent().unwrap()).unwrap();
            std::fs::write(path, text).unwrap();
        }
        root
    }

    fn names(entries: &[PluginEntry]) -> Vec<(&str, bool)> {
        entries
            .iter()
            .map(|e| (e.name.as_str(), e.folder))
            .collect()
    }

    #[test]
    fn a_path_of_the_screen_stays_inside_the_plugin_folder() {
        let root = plugin_with("resolve", &[("a/b.md", "x"), ("c.md", "y")]);
        let real = root.canonicalize().unwrap();
        assert_eq!(resolve(&root, "", true).unwrap(), Some(real.clone()));
        assert_eq!(resolve(&root, "a", true).unwrap(), Some(real.join("a")));
        assert_eq!(
            resolve(&root, "a/b.md", false).unwrap(),
            Some(real.join("a/b.md"))
        );
        // A path that is not there is none, and is no error.
        assert_eq!(resolve(&root, "a/none.md", false).unwrap(), None);
        // The empty path is the folder only where it is allowed.
        assert!(resolve(&root, "", false).is_err());
        for bad in [
            "..",
            "../x",
            "a/../c.md",
            ".",
            "./c.md",
            "/etc/passwd",
            "/c.md",
            "a//b.md",
            "a/",
            "a\\b.md",
            "a\0b.md",
            "a\nb.md",
        ] {
            assert!(resolve(&root, bad, true).is_err(), "{bad:?}");
        }
        std::fs::remove_dir_all(root).unwrap();
    }

    #[cfg(unix)]
    #[test]
    fn a_link_that_leads_out_of_the_plugin_folder_is_refused_and_one_that_stays_is_followed() {
        let outer = temp_dir("link");
        let root = outer.join("plugin");
        std::fs::create_dir_all(root.join("inner")).unwrap();
        std::fs::write(root.join("inner/in.md"), "in").unwrap();
        std::fs::create_dir_all(outer.join("other")).unwrap();
        std::fs::write(outer.join("secret.md"), "secret").unwrap();
        std::fs::write(outer.join("other/o.md"), "o").unwrap();
        std::os::unix::fs::symlink(outer.join("secret.md"), root.join("file-out")).unwrap();
        std::os::unix::fs::symlink(outer.join("other"), root.join("dir-out")).unwrap();
        std::os::unix::fs::symlink("inner/in.md", root.join("file-in")).unwrap();
        std::os::unix::fs::symlink(root.join("inner"), root.join("dir-in")).unwrap();
        std::os::unix::fs::symlink("nowhere", root.join("dangling")).unwrap();
        // Out: read, list and write are all refused, and the file outside is left as it was.
        assert!(read_text(&root, "file-out").unwrap_err().contains("の外"));
        assert!(read_text(&root, "dir-out/o.md")
            .unwrap_err()
            .contains("の外"));
        assert!(list_dir(&root, "dir-out").unwrap_err().contains("の外"));
        assert!(
            write_file(&root, "file-out", "x", false, &signature_of("secret"))
                .unwrap_err()
                .contains("の外")
        );
        assert_eq!(
            std::fs::read_to_string(outer.join("secret.md")).unwrap(),
            "secret"
        );
        // In: followed.
        assert_eq!(read_text(&root, "file-in").unwrap().content, "in");
        assert_eq!(read_text(&root, "dir-in/in.md").unwrap().content, "in");
        // A link that leads nowhere is no file.
        assert!(read_text(&root, "dangling")
            .unwrap_err()
            .contains("見つかりません"));
        // The list shows each link as what it leads to, and a link that leaves is still listed (it cannot be opened).
        let listed = list_dir(&root, "").unwrap();
        assert_eq!(
            names(&listed),
            [
                ("dir-in", true),
                ("dir-out", true),
                ("inner", true),
                ("dangling", false),
                ("file-in", false),
                ("file-out", false)
            ]
        );
        std::fs::remove_dir_all(outer).unwrap();
    }

    #[test]
    fn a_folder_is_listed_with_its_folders_first_by_name_and_without_git_and_ds_store() {
        let root = plugin_with(
            "list-dir",
            &[
                (".claude-plugin/plugin.json", "{}"),
                (".git/HEAD", "x"),
                (".DS_Store", "x"),
                (".mcp.json", "{}"),
                ("skills/review/SKILL.md", "x"),
                ("agents/a.md", "x"),
                ("README.md", "x"),
                ("alpha.md", "x"),
                ("Beta.md", "x"),
            ],
        );
        assert_eq!(
            names(&list_dir(&root, "").unwrap()),
            [
                (".claude-plugin", true),
                ("agents", true),
                ("skills", true),
                (".mcp.json", false),
                ("alpha.md", false),
                ("Beta.md", false),
                ("README.md", false),
            ]
        );
        assert_eq!(
            names(&list_dir(&root, "skills/review").unwrap()),
            [("SKILL.md", false)]
        );
        // A file is no folder, and a folder that is not there is refused.
        assert!(list_dir(&root, "alpha.md")
            .unwrap_err()
            .contains("フォルダではありません"));
        assert!(list_dir(&root, "none")
            .unwrap_err()
            .contains("見つかりません"));
        std::fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn a_file_is_read_as_text_with_its_language_and_a_signature_of_the_disk() {
        let root = plugin_with(
            "read",
            &[
                ("skills/x/SKILL.md", "---\nname: x\n---\n"),
                (".mcp.json", "{}\n"),
                ("crlf.md", "a\r\nb\r\n"),
                ("empty.md", ""),
            ],
        );
        let skill = read_text(&root, "skills/x/SKILL.md").unwrap();
        assert_eq!(skill.content, "---\nname: x\n---\n");
        assert_eq!(skill.language, "markdown");
        assert!(!skill.crlf);
        assert_eq!(skill.signature, signature_of("---\nname: x\n---\n"));
        assert_eq!(read_text(&root, ".mcp.json").unwrap().language, "json");
        // CRLF is given as LF, and the signature is the disk's.
        let crlf = read_text(&root, "crlf.md").unwrap();
        assert_eq!((crlf.content.as_str(), crlf.crlf), ("a\nb\n", true));
        assert_eq!(crlf.signature, signature_of("a\r\nb\r\n"));
        assert_eq!(read_text(&root, "empty.md").unwrap().content, "");
        // A reread with the signature the editor holds gets no text back, and any other signature gets the text.
        let same = read_file(&root, "crlf.md", Some(crlf.signature.as_str())).unwrap();
        assert_eq!(same.signature, crlf.signature);
        assert_eq!((same.content.as_str(), same.language.as_str()), ("", ""));
        let other = read_file(&root, "crlf.md", Some("old")).unwrap();
        assert_eq!(other.content, "a\nb\n");
        assert_eq!(other.language, crlf.language);
        // A file that cannot be read is an error with the signature too.
        assert!(read_file(&root, "none.md", Some("x")).is_err());
        // SHA-256 of "abc".
        assert_eq!(
            signature_of("abc"),
            "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad"
        );
        std::fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn a_file_that_is_not_text_or_too_large_or_not_there_is_refused_in_japanese() {
        let root = plugin_with(
            "read-refused",
            &[("dir/x.md", "x"), ("mixed.md", "a\r\nb\n")],
        );
        std::fs::write(root.join("latin.md"), [0x66, 0x6f, 0x80, 0x6f]).unwrap();
        std::fs::write(root.join("bin.dat"), b"a\0b").unwrap();
        std::fs::write(root.join("big.md"), vec![b'a'; FILE_MAX + 1]).unwrap();
        std::fs::write(root.join("limit.md"), vec![b'a'; FILE_MAX]).unwrap();
        assert!(read_text(&root, "latin.md").unwrap_err().contains("UTF-8"));
        assert!(read_text(&root, "bin.dat")
            .unwrap_err()
            .contains("バイナリ"));
        assert!(read_text(&root, "big.md").unwrap_err().contains("2 MiB"));
        assert_eq!(
            read_text(&root, "limit.md").unwrap().content.len(),
            FILE_MAX
        );
        assert!(read_text(&root, "mixed.md")
            .unwrap_err()
            .contains("改行コード"));
        assert!(read_text(&root, "dir")
            .unwrap_err()
            .contains("ファイルではありません"));
        assert!(read_text(&root, "none.md")
            .unwrap_err()
            .contains("見つかりません"));
        assert!(read_text(&root, "../x").is_err());
        std::fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn a_save_writes_the_text_when_the_disk_is_as_it_was_read() {
        let root = plugin_with("write", &[("a.md", "one\n"), ("crlf.md", "a\r\nb\r\n")]);
        let read = read_text(&root, "a.md").unwrap();
        let saved = write_file(&root, "a.md", "two\n", false, &read.signature).unwrap();
        assert_eq!(saved.state, OrcaSaveState::Saved);
        assert_eq!(std::fs::read_to_string(root.join("a.md")).unwrap(), "two\n");
        assert_eq!(saved.signature, signature_of("two\n"));
        // The signature that the save answers is the one of the next save.
        let again = write_file(&root, "a.md", "three\n", false, &saved.signature).unwrap();
        assert_eq!(again.state, OrcaSaveState::Saved);
        // The line ends of the file come back.
        let crlf = read_text(&root, "crlf.md").unwrap();
        let saved = write_file(&root, "crlf.md", "a\nb\nc\n", crlf.crlf, &crlf.signature).unwrap();
        assert_eq!(saved.state, OrcaSaveState::Saved);
        assert_eq!(
            std::fs::read_to_string(root.join("crlf.md")).unwrap(),
            "a\r\nb\r\nc\r\n"
        );
        // No temporary file is left beside it.
        let left: Vec<String> = std::fs::read_dir(&root)
            .unwrap()
            .flatten()
            .map(|e| e.file_name().into_string().unwrap())
            .filter(|n| n.ends_with(".tmp"))
            .collect();
        assert!(left.is_empty(), "{left:?}");
        std::fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn a_save_is_refused_and_writes_nothing_when_the_disk_changed_or_the_file_is_gone() {
        let root = plugin_with("write-refused", &[("a.md", "one\n"), ("x/b.md", "b")]);
        let stale = read_text(&root, "a.md").unwrap().signature;
        std::fs::write(root.join("a.md"), "changed elsewhere\n").unwrap();
        let refused = write_file(&root, "a.md", "mine\n", false, &stale).unwrap();
        assert_eq!(refused.state, OrcaSaveState::Changed);
        assert_eq!(refused.signature, stale);
        assert_eq!(
            std::fs::read_to_string(root.join("a.md")).unwrap(),
            "changed elsewhere\n"
        );
        // A file that is not there, and a file that is not UTF-8 now.
        assert_eq!(
            write_file(&root, "none.md", "x", false, &stale)
                .unwrap()
                .state,
            OrcaSaveState::Missing
        );
        std::fs::write(root.join("a.md"), [0xff, 0xfe]).unwrap();
        assert_eq!(
            write_file(&root, "a.md", "x", false, &stale).unwrap().state,
            OrcaSaveState::NotUtf8
        );
        assert_eq!(std::fs::read(root.join("a.md")).unwrap(), [0xff, 0xfe]);
        // A path out of the folder and a text over the limit are errors.
        assert!(write_file(&root, "../a.md", "x", false, &stale).is_err());
        let big = "a".repeat(FILE_MAX + 1);
        assert!(write_file(&root, "x/b.md", &big, false, &signature_of("b"))
            .unwrap_err()
            .contains("2 MiB"));
        assert_eq!(std::fs::read_to_string(root.join("x/b.md")).unwrap(), "b");
        std::fs::remove_dir_all(root).unwrap();
    }

    #[cfg(unix)]
    #[test]
    fn a_save_keeps_the_mode_of_the_file() {
        use std::os::unix::fs::PermissionsExt;
        let root = plugin_with("write-mode", &[("run.sh", "echo 1\n")]);
        std::fs::set_permissions(root.join("run.sh"), std::fs::Permissions::from_mode(0o755))
            .unwrap();
        let read = read_text(&root, "run.sh").unwrap();
        write_file(&root, "run.sh", "echo 2\n", false, &read.signature).unwrap();
        let mode = std::fs::metadata(root.join("run.sh"))
            .unwrap()
            .permissions()
            .mode();
        assert_eq!(mode & 0o777, 0o755);
        std::fs::remove_dir_all(root).unwrap();
    }
}
