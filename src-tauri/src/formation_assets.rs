//! A-45 and #1242: the files of `src-tauri/preview-plugin/` and `src-tauri/lsp-plugin/` that are embedded in the binary at build time (`build.rs`), and how a folder is written whole (`replace_dir`, `ensure_plugin`).
//! `PREVIEW_PLUGIN` (A-45) is the plugin of `src-tauri/preview-plugin/`, which `preview_plugin` writes with `ensure_plugin`.
//! Each list is `(path relative to its folder with "/", contents)`.

use std::{
    io::{Seek, SeekFrom, Write},
    path::{Path, PathBuf},
    sync::{
        atomic::{AtomicUsize, Ordering},
        Mutex, PoisonError,
    },
    time::Duration,
};

use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};

include!(concat!(env!("OUT_DIR"), "/formation_assets.rs"));

/// The file of a plugin's folder that holds the hash of the plugin that was written (`plugin_mark`): it is replaced with the folder, so the two cannot disagree.
const MARK_FILE: &str = ".tsunagiai-plugin-hash";

/// The hash of `files` (their paths and contents, in order): what tells that the folder holds this very plugin.
fn plugin_mark(files: &[(&str, &str)]) -> String {
    let mut hash = Sha256::new();
    for (path, text) in files {
        hash.update(path.as_bytes());
        hash.update([0]);
        hash.update(text.as_bytes());
        hash.update([0]);
    }
    hash.finalize().iter().map(|b| format!("{b:02x}")).collect()
}

/// Whether `dir` holds `files` as `replace_dir` wrote them for `mark`: a real folder (not a link), the mark file with `mark`, and every file there with the length it has, so that a file that a crash left empty or cut is told. The contents are not read again.
fn holds_plugin(dir: &Path, files: &[(&str, &str)], mark: &str) -> bool {
    std::fs::symlink_metadata(dir).is_ok_and(|m| m.is_dir())
        && std::fs::read_to_string(dir.join(MARK_FILE)).is_ok_and(|text| text == mark)
        && files.iter().all(|(path, text)| {
            std::fs::symlink_metadata(dir.join(path))
                .is_ok_and(|m| m.is_file() && m.len() == text.len() as u64)
        })
}

/// Makes `dir` hold `plugin`, as a whole, with its mark. A folder that already holds this plugin (`holds_plugin`) is left as it is: a launch does not write the files again, and the others that read the folder never see it replaced.
pub(crate) fn ensure_plugin(dir: &Path, plugin: &[(&str, &str)]) -> Result<(), String> {
    let mark = plugin_mark(plugin);
    if !holds_plugin(dir, plugin, &mark) {
        let mut files = plugin.to_vec();
        files.push((MARK_FILE, &mark));
        replace_dir(dir, &files)?;
    }
    Ok(())
}

/// The Figma tools of a plugin's server as a permission rule names them: `mcp__plugin_{plugin}_{server}__{tool}` (the server `figma` of its `.mcp.json`; Claude Code's documentation of permissions, "MCP").
fn figma_rule_prefix(plugin: &str) -> String {
    format!("mcp__plugin_{plugin}_figma__")
}

/// The tools of the Figma server that only read, and that `figma-fetcher` uses: the only ones a child's settings allow.
const FIGMA_READ_TOOLS: [&str; 3] = ["get_metadata", "get_design_context", "get_screenshot"];

/// The tools of the Figma server that write into a file, a library or the account, as Figma's page of its tools lists them ("Write tools"): a child's settings deny them, and `figma-fetcher` lists them in `disallowedTools`. A tool that page adds later is not here, and what is not allowed is left to the classifier of the auto mode.
const FIGMA_WRITE_TOOLS: [&str; 15] = [
    "add_code_connect_map",
    "create_generative_plugin",
    "create_new_file",
    "create_shader",
    "generate_diagram",
    "generate_figma_design",
    "generate_image",
    "generate_vector_illustration",
    "html_to_figma",
    "send_code_to_figma",
    "send_code_connect_mappings",
    "update_generative_plugin",
    "update_shader",
    "upload_assets",
    "use_figma",
];

fn figma_rules(plugin: &str, tools: &[&str]) -> Vec<String> {
    let prefix = figma_rule_prefix(plugin);
    tools.iter().map(|tool| format!("{prefix}{tool}")).collect()
}

/// The `permissions` of a child's `--settings` (A-41, #1162) for the plugins `plugins`, each of which has the Figma server: the read tools of the server are allowed and its write tools are denied, because the child runs in the auto mode and a write would run with no question to the owner. A deny rule wins over every other.
pub fn figma_permissions_of(plugins: &[String]) -> serde_json::Value {
    let rules = |tools: &[&str]| -> Vec<String> {
        plugins
            .iter()
            .flat_map(|plugin| figma_rules(plugin, tools))
            .collect()
    };
    serde_json::json!({
        "allow": rules(&FIGMA_READ_TOOLS),
        "deny": rules(&FIGMA_WRITE_TOOLS),
    })
}

static STAGING: AtomicUsize = AtomicUsize::new(0);

/// The folder that holds `target`.
fn parent_of(target: &Path) -> Result<&Path, String> {
    match (target.parent(), target.file_name()) {
        (Some(parent), Some(_)) => Ok(parent),
        _ => Err(format!("{} を作れません", target.display())),
    }
}

/// A name beside `target` for the folder of the kind `kind` that is written or moved aside while `target` is replaced: it starts with a dot and holds the process and a count, so that two writers do not meet in it.
fn beside(target: &Path, kind: &str) -> Result<PathBuf, String> {
    let name = target.file_name().unwrap_or_default();
    Ok(parent_of(target)?.join(format!(
        ".{}.{kind}-{}-{}",
        name.to_string_lossy(),
        std::process::id(),
        STAGING.fetch_add(1, Ordering::Relaxed)
    )))
}

/// Makes `target` a folder that holds exactly `files` and nothing else: the files are written in a folder beside it, which then takes its place, so a file that `files` no longer lists does not stay and a failure leaves the old `target` as it was, with no half-written folder.
/// The folder beside it has a name that starts with a dot and holds the process and a count, so that two writers do not meet in it; it is removed when the write fails.
/// What was at `target` is moved aside by a rename and removed only after the new folder is in its place, so a reader never waits for a removal: `target` is missing for the time between two renames and no longer. The files are not synced one by one: the folder is synced before it is renamed.
/// A link in `target`'s place is moved aside and removed, not followed. When another process has put a folder there first, its folder is kept: both wrote the same files.
pub(crate) fn replace_dir<T: AsRef<[u8]>>(
    target: &Path,
    files: &[(&str, T)],
) -> Result<(), String> {
    let parent = parent_of(target)?;
    std::fs::create_dir_all(parent)
        .map_err(|e| format!("{} を作れません: {e}", parent.display()))?;
    let (staging, old) = (beside(target, "new")?, beside(target, "old")?);
    let _ = remove_old(&staging);
    let moved = write_files(&staging, files).and_then(|()| swap(&staging, target, &old));
    let _ = remove_old(&staging);
    let _ = remove_old(&old);
    moved
}

/// Puts the folder `staging` in the place of `target`: what is at `target` goes to `old` first (and comes back when `staging` cannot be placed).
fn swap(staging: &Path, target: &Path, old: &Path) -> Result<(), String> {
    let aside = std::fs::symlink_metadata(target).is_ok()
        && std::fs::rename(target, old)
            .map_err(|e| format!("{} を外せません: {e}", target.display()))
            .map(|()| true)?;
    std::fs::rename(staging, target)
        .or_else(|e| if target.is_dir() { Ok(()) } else { Err(e) })
        .map_err(|e| {
            if aside {
                let _ = std::fs::rename(old, target);
            }
            format!("{} を置けません: {e}", target.display())
        })
}

fn write_files<T: AsRef<[u8]>>(dir: &Path, files: &[(&str, T)]) -> Result<(), String> {
    std::fs::create_dir_all(dir).map_err(|e| format!("{} を作れません: {e}", dir.display()))?;
    for (relative, text) in files {
        let path = dir.join(relative);
        if let Some(folder) = path.parent() {
            std::fs::create_dir_all(folder)
                .map_err(|e| format!("{} を作れません: {e}", folder.display()))?;
        }
        std::fs::write(&path, text).map_err(|e| format!("{} を書けません: {e}", path.display()))?;
    }
    // The entries of the folder reach the disk before the rename that publishes it; a platform that cannot open a folder is left to its own order.
    if let Ok(folder) = std::fs::File::open(dir) {
        let _ = folder.sync_all();
    }
    Ok(())
}

/// Removes what is at `path` (a folder with its contents, a file, or a link, which is not followed). Nothing there is fine.
pub(crate) fn remove_old(path: &Path) -> Result<(), String> {
    let Ok(meta) = std::fs::symlink_metadata(path) else {
        return Ok(());
    };
    let removed = if meta.is_dir() {
        std::fs::remove_dir_all(path)
    } else {
        std::fs::remove_file(path)
    };
    removed.map_err(|e| format!("{} を外せません: {e}", path.display()))
}

// ---- the owner's plugins, sent to the PC of a saved environment (#1535) ----
// The app reads the folder `~/.local/share/tsunagiai/plugins/` of this PC (`read_plugins_folder`) and sends it in three requests of the server of that PC: `plugins_begin` (the hash of the set and the files with their sizes: a PC that already holds them answers that and nothing else is sent), `plugins_write` (pieces of files, as many requests as the frame of 1 MiB needs) and `plugins_commit` (the hash of what arrived is checked, and the folder is replaced as a whole as `replace_dir` replaces one). What arrives is written in a folder beside the plugins' folder whose name holds the id of the send (made at random by the sender, so that two sends of one set at once do not meet), so the old folder stays whole until the new one is complete.

/// The file of the plugins' folder of the receiving PC that holds the hash of the set that was committed (`plugins_mark`): the next `plugins_begin` with the same hash sends nothing. It is replaced with the folder, so the two cannot disagree, and it is never read from the folder that is sent.
const PLUGINS_MARK_FILE: &str = ".tsunagiai-plugins-hash";

/// How many files and how many bytes of them one send holds, and how long the path of a file may be: a folder over them is refused with its reason, so that a folder that holds a checkout or a build is not sent by mistake. A request that lists the files (`plugins_begin`, `plugins_commit`) stays within the frame of 1 MiB with them.
pub(crate) const PLUGINS_MAX_FILES: usize = 1000;
pub(crate) const PLUGINS_MAX_BYTES: u64 = 32 * 1024 * 1024;
const PLUGINS_MAX_PATH: usize = 300;

/// A file of the set that is sent, as the requests that list the files name it.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub struct PluginEntry {
    pub path: String,
    pub size: u64,
}

/// A path of the set: relative, with `/` between its parts, and no empty part, `.`, `..`, backslash or control character, so that it names a place inside the folder and nothing else. The file that holds the hash is not a path of the set.
fn check_plugin_path(path: &str) -> Result<(), String> {
    let bad = path.is_empty()
        || path.chars().count() > PLUGINS_MAX_PATH
        || path.starts_with('/')
        || path.chars().any(|c| c == '\\' || c.is_control())
        || path
            .split('/')
            .any(|part| part.is_empty() || part == "." || part == "..")
        || path == PLUGINS_MARK_FILE;
    if bad {
        return Err(format!(
            "プラグインのファイルの場所が正しくありません: {path}"
        ));
    }
    Ok(())
}

fn check_plugins_mark(mark: &str) -> Result<(), String> {
    if mark.len() == 64
        && mark
            .bytes()
            .all(|b| b.is_ascii_digit() || (b'a'..=b'f').contains(&b))
    {
        Ok(())
    } else {
        Err("プラグインのハッシュが正しくありません".to_owned())
    }
}

/// The hash of a set of files, `files` being (path, contents) in the order of the paths: what tells that two folders hold the same plugins. The length of each file is part of it, so that no two sets share a hash by moving bytes from one file to the next.
fn plugins_mark<'a>(files: impl IntoIterator<Item = (&'a str, &'a [u8])>) -> String {
    let mut hash = Sha256::new();
    for (path, bytes) in files {
        hash.update((path.len() as u64).to_le_bytes());
        hash.update(path.as_bytes());
        hash.update((bytes.len() as u64).to_le_bytes());
        hash.update(bytes);
    }
    hash.finalize().iter().map(|b| format!("{b:02x}")).collect()
}

/// The hash of `files` (as `read_plugins_folder` gives them: sorted by path).
pub fn plugins_mark_of(files: &[(String, Vec<u8>)]) -> String {
    plugins_mark(
        files
            .iter()
            .map(|(path, bytes)| (path.as_str(), bytes.as_slice())),
    )
}

/// The files of `files` as the requests list them.
pub fn plugin_entries(files: &[(String, Vec<u8>)]) -> Vec<PluginEntry> {
    files
        .iter()
        .map(|(path, bytes)| PluginEntry {
            path: path.clone(),
            size: bytes.len() as u64,
        })
        .collect()
}

/// The paths of the files under `dir`, relative and with `/`, appended to `out`. With `skip_noise` (the folder of the owner) a link, `.git`, `.DS_Store` and the file of the hash at the top are left out: a link is never followed, and what git or Finder keeps is not a plugin's. Without it (what arrived) every entry that is not a folder is listed, so that a link or a file that was not asked for is seen.
fn walk_files(
    dir: &Path,
    relative: &str,
    skip_noise: bool,
    out: &mut Vec<String>,
) -> Result<(), String> {
    let entries =
        std::fs::read_dir(dir).map_err(|e| format!("{} を読めません: {e}", dir.display()))?;
    for entry in entries {
        let entry = entry.map_err(|e| format!("{} を読めません: {e}", dir.display()))?;
        let name = entry.file_name().into_string().map_err(|_| {
            format!(
                "{} に、名前が文字列にならないファイルがあります",
                dir.display()
            )
        })?;
        let path = if relative.is_empty() {
            name.clone()
        } else {
            format!("{relative}/{name}")
        };
        let meta = std::fs::symlink_metadata(entry.path())
            .map_err(|e| format!("{} を読めません: {e}", entry.path().display()))?;
        if skip_noise
            && (meta.is_symlink()
                || name == ".git"
                || name == ".DS_Store"
                || (relative.is_empty() && name == PLUGINS_MARK_FILE))
        {
            continue;
        }
        if meta.is_dir() {
            walk_files(&entry.path(), &path, skip_noise, out)?;
        } else if skip_noise && !meta.is_file() {
            continue;
        } else {
            out.push(path);
        }
        if out.len() > PLUGINS_MAX_FILES {
            return Err(too_large());
        }
    }
    Ok(())
}

fn too_large() -> String {
    format!(
        "プラグインのフォルダが大きすぎます（ファイルは {PLUGINS_MAX_FILES} 個、合わせて {} MiB までです）",
        PLUGINS_MAX_BYTES / 1024 / 1024
    )
}

/// The files of the plugins' folder `dir`, as (path, contents) sorted by path. A folder that is not there is a folder with no file: the PC that receives it then holds no plugin. A folder over `PLUGINS_MAX_FILES` or `PLUGINS_MAX_BYTES` is refused before a file is read.
pub fn read_plugins_folder(dir: &Path) -> Result<Vec<(String, Vec<u8>)>, String> {
    if !std::fs::metadata(dir).is_ok_and(|m| m.is_dir()) {
        return Ok(Vec::new());
    }
    let mut paths = Vec::new();
    walk_files(dir, "", true, &mut paths)?;
    paths.sort();
    let mut total = 0u64;
    for path in &paths {
        check_plugin_path(path)?;
        let meta =
            std::fs::metadata(dir.join(path)).map_err(|e| format!("{path} を読めません: {e}"))?;
        total += meta.len();
        if total > PLUGINS_MAX_BYTES {
            return Err(too_large());
        }
    }
    paths
        .into_iter()
        .map(|path| {
            std::fs::read(dir.join(&path))
                .map(|bytes| (path.clone(), bytes))
                .map_err(|e| format!("{path} を読めません: {e}"))
        })
        .collect()
}

/// The list of a request checked, and sorted by path: at most `PLUGINS_MAX_FILES` files of `PLUGINS_MAX_BYTES` together, every path right and no path twice.
fn check_entries(entries: &[PluginEntry]) -> Result<Vec<PluginEntry>, String> {
    if entries.len() > PLUGINS_MAX_FILES {
        return Err(too_large());
    }
    let mut sorted = entries.to_vec();
    sorted.sort_by(|a, b| a.path.cmp(&b.path));
    let mut total = 0u64;
    for (i, entry) in sorted.iter().enumerate() {
        check_plugin_path(&entry.path)?;
        if i > 0 && sorted[i - 1].path == entry.path {
            return Err(format!(
                "プラグインのファイルが二つあります: {}",
                entry.path
            ));
        }
        total = total.saturating_add(entry.size);
    }
    if total > PLUGINS_MAX_BYTES {
        return Err(too_large());
    }
    Ok(sorted)
}

/// How old a folder of an earlier send that did not end must be before the next `plugins_begin` removes it (a send takes at most 180 seconds).
const PLUGINS_STALE: Duration = Duration::from_secs(600);

/// The commits take turns, so that a commit that finds the set in place (another send of it won) sees the folder whole.
static COMMIT: Mutex<()> = Mutex::new(());

/// The id of a send: the 32 characters of 0 to 9 and a to f that the sender made for it at random, so that two sends of the same set to one PC at once do not share a folder.
fn check_plugins_id(id: &str) -> Result<(), String> {
    if id.len() == 32
        && id
            .bytes()
            .all(|b| b.is_ascii_digit() || (b'a'..=b'f').contains(&b))
    {
        Ok(())
    } else {
        Err("プラグインの送り込みの番号が正しくありません".to_owned())
    }
}

/// The folder beside `target` that what arrives is written in: its name holds the id of the send, so a send of any other set, or of the same one, does not meet it. It holds `LIST_FILE` (the list `plugins_begin` was given) and `files/` (what arrives).
fn plugins_staging(target: &Path, id: &str) -> Result<PathBuf, String> {
    let name = target.file_name().unwrap_or_default();
    Ok(parent_of(target)?.join(format!(".{}.incoming-{id}", name.to_string_lossy())))
}

const LIST_FILE: &str = "list.json";
const FILES_DIR: &str = "files";

/// Removes the folders of earlier sends beside `target` that were never ended and are older than `PLUGINS_STALE`: an id is used once, so no later send would meet them.
fn remove_stale_incoming(target: &Path) {
    let Ok(parent) = parent_of(target) else {
        return;
    };
    let prefix = format!(
        ".{}.incoming-",
        target.file_name().unwrap_or_default().to_string_lossy()
    );
    let Ok(read) = std::fs::read_dir(parent) else {
        return;
    };
    for entry in read.flatten() {
        let old = entry
            .metadata()
            .and_then(|m| m.modified())
            .ok()
            .and_then(|at| at.elapsed().ok())
            .is_some_and(|age| age > PLUGINS_STALE);
        if old && entry.file_name().to_string_lossy().starts_with(&prefix) {
            let _ = remove_old(&entry.path());
        }
    }
}

/// Whether `target` holds the set: a real folder (not a link), the file of the hash with `mark`, every file there with the size it has, and the hash of what they hold being `mark` (a file that was changed on that PC to another text of the same size is found too; the set is at most `PLUGINS_MAX_BYTES`).
fn plugins_held(target: &Path, mark: &str, entries: &[PluginEntry]) -> bool {
    if !(std::fs::symlink_metadata(target).is_ok_and(|m| m.is_dir())
        && std::fs::read_to_string(target.join(PLUGINS_MARK_FILE)).is_ok_and(|text| text == mark))
    {
        return false;
    }
    let mut files = Vec::with_capacity(entries.len());
    for entry in entries {
        let path = target.join(&entry.path);
        if !std::fs::symlink_metadata(&path).is_ok_and(|m| m.is_file() && m.len() == entry.size) {
            return false;
        }
        let Ok(bytes) = std::fs::read(&path) else {
            return false;
        };
        files.push((entry.path.as_str(), bytes));
    }
    plugins_mark(files.iter().map(|(path, bytes)| (*path, bytes.as_slice()))) == mark
}

/// The start of a send `id` to `target`, the plugins' folder of this PC: whether it holds the set already (then nothing is sent), and otherwise an empty folder beside it for what arrives, with the list of its files kept in it (`plugins_write` accepts nothing else). Only the folder of this send is removed, never one of another send that runs. `mark` and `entries` are what the sender computed; they are checked here, and `plugins_commit` checks the contents against `mark`.
pub(crate) fn plugins_begin(
    target: &Path,
    id: &str,
    mark: &str,
    entries: &[PluginEntry],
) -> Result<bool, String> {
    check_plugins_id(id)?;
    check_plugins_mark(mark)?;
    let entries = check_entries(entries)?;
    if plugins_held(target, mark, &entries) {
        return Ok(true);
    }
    remove_stale_incoming(target);
    let staging = plugins_staging(target, id)?;
    remove_old(&staging)?;
    let files = staging.join(FILES_DIR);
    std::fs::create_dir_all(&files)
        .map_err(|e| format!("{} を作れません: {e}", files.display()))?;
    let list = serde_json::to_vec(&entries).map_err(|e| e.to_string())?;
    std::fs::write(staging.join(LIST_FILE), list)
        .map_err(|e| format!("{} を書けません: {e}", staging.display()))?;
    Ok(false)
}

/// The list that `plugins_begin` kept in `staging`, sorted by path.
fn staged_list(staging: &Path) -> Result<Vec<PluginEntry>, String> {
    if !std::fs::symlink_metadata(staging).is_ok_and(|m| m.is_dir()) {
        return Err("プラグインの送り込みが始まっていません".to_owned());
    }
    std::fs::read(staging.join(LIST_FILE))
        .map_err(|e| e.to_string())
        .and_then(|bytes| serde_json::from_slice(&bytes).map_err(|e| e.to_string()))
        .map_err(|e| format!("プラグインの一覧を読めません: {e}"))
}

/// Writes pieces of files into the folder that `plugins_begin` made: each is (path, where in the file it goes, bytes), and it must be a file of the list that `plugins_begin` was given and end within that file's size. The file is made when it is not there (an empty piece makes an empty file), and a piece written twice leaves the same file.
pub(crate) fn plugins_write(
    target: &Path,
    id: &str,
    mark: &str,
    pieces: &[(String, u64, Vec<u8>)],
) -> Result<(), String> {
    check_plugins_id(id)?;
    check_plugins_mark(mark)?;
    let staging = plugins_staging(target, id)?;
    let list = staged_list(&staging)?;
    for (path, offset, bytes) in pieces {
        check_plugin_path(path)?;
        let entry = list
            .binary_search_by(|entry| entry.path.as_str().cmp(path))
            .map(|i| &list[i])
            .map_err(|_| format!("プラグインのファイルが一覧にありません: {path}"))?;
        if offset.saturating_add(bytes.len() as u64) > entry.size {
            return Err(format!("{path} が、一覧の大きさを超えています"));
        }
        let file = staging.join(FILES_DIR).join(path);
        if let Some(folder) = file.parent() {
            std::fs::create_dir_all(folder)
                .map_err(|e| format!("{} を作れません: {e}", folder.display()))?;
        }
        let mut out = std::fs::OpenOptions::new()
            .create(true)
            .truncate(false)
            .write(true)
            .open(&file)
            .map_err(|e| format!("{path} を書けません: {e}"))?;
        out.seek(SeekFrom::Start(*offset))
            .and_then(|_| out.write_all(bytes))
            .map_err(|e| format!("{path} を書けません: {e}"))?;
    }
    Ok(())
}

/// The end of a send: what arrived must be exactly the files of `entries` with their sizes, and hash to `mark`; then the file of the hash is added and the folder takes the place of `target` as a whole (`swap`), so what the old folder held and the set no longer lists is gone, and a failure leaves the old folder as it was. A set that does not match is refused and its folder is removed. When `target` holds the set already (another send of it, made at the same time, ended first), nothing is changed and the commit succeeds.
pub(crate) fn plugins_commit(
    target: &Path,
    id: &str,
    mark: &str,
    entries: &[PluginEntry],
) -> Result<(), String> {
    check_plugins_id(id)?;
    check_plugins_mark(mark)?;
    let entries = check_entries(entries)?;
    let staging = plugins_staging(target, id)?;
    let _one = COMMIT.lock().unwrap_or_else(PoisonError::into_inner);
    if plugins_held(target, mark, &entries) {
        let _ = remove_old(&staging);
        return Ok(());
    }
    staged_list(&staging)?;
    let files = staging.join(FILES_DIR);
    let checked = check_arrived(&files, mark, &entries);
    if let Err(e) = checked {
        let _ = remove_old(&staging);
        return Err(e);
    }
    let old = beside(target, "old")?;
    let placed = std::fs::write(files.join(PLUGINS_MARK_FILE), mark)
        .map_err(|e| {
            format!(
                "{} を書けません: {e}",
                files.join(PLUGINS_MARK_FILE).display()
            )
        })
        .and_then(|()| swap(&files, target, &old));
    let _ = remove_old(&staging);
    let _ = remove_old(&old);
    placed
}

fn check_arrived(staging: &Path, mark: &str, entries: &[PluginEntry]) -> Result<(), String> {
    let mut arrived = Vec::new();
    walk_files(staging, "", false, &mut arrived)?;
    arrived.sort();
    let listed: Vec<&str> = entries.iter().map(|e| e.path.as_str()).collect();
    if arrived != listed {
        return Err("届いたファイルが、一覧と合いません".to_owned());
    }
    let mut files = Vec::with_capacity(entries.len());
    for entry in entries {
        let path = staging.join(&entry.path);
        let ok =
            std::fs::symlink_metadata(&path).is_ok_and(|m| m.is_file() && m.len() == entry.size);
        if !ok {
            return Err(format!("{} が届ききっていません", entry.path));
        }
        let bytes =
            std::fs::read(&path).map_err(|e| format!("{} を読めません: {e}", entry.path))?;
        files.push((entry.path.as_str(), bytes));
    }
    let got = plugins_mark(files.iter().map(|(path, bytes)| (*path, bytes.as_slice())));
    if got != mark {
        return Err("届いたファイルが、ハッシュと合いません".to_owned());
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn temp_dir(name: &str) -> PathBuf {
        let dir = std::env::temp_dir().join(format!(
            "tsunagiai-formation-assets-{}-{name}",
            std::process::id()
        ));
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).unwrap();
        dir
    }

    /// The id of a send (the sender makes one at random for each).
    const ID: &str = "0123456789abcdef0123456789abcdef";
    const ID2: &str = "fedcba9876543210fedcba9876543210";

    fn entries(dir: &Path) -> Vec<String> {
        let mut names: Vec<String> = std::fs::read_dir(dir)
            .unwrap()
            .map(|e| e.unwrap().file_name().to_string_lossy().into_owned())
            .collect();
        names.sort();
        names
    }

    #[test]
    fn a_childs_settings_allow_the_figma_read_tools_and_deny_its_write_tools() {
        let permissions = figma_permissions_of(&["mine".to_owned()]);
        let list = |key: &str| -> Vec<String> {
            permissions[key]
                .as_array()
                .unwrap()
                .iter()
                .map(|rule| rule.as_str().unwrap().to_owned())
                .collect()
        };
        let (allow, deny) = (list("allow"), list("deny"));
        assert_eq!(
            allow,
            [
                "mcp__plugin_mine_figma__get_metadata",
                "mcp__plugin_mine_figma__get_design_context",
                "mcp__plugin_mine_figma__get_screenshot"
            ]
        );
        assert_eq!(deny.len(), FIGMA_WRITE_TOOLS.len());
        assert!(deny.contains(&"mcp__plugin_mine_figma__use_figma".to_owned()));
        // A rule has no parenthesis (Claude Code skips an `mcp__` rule that has one), and no tool is in both lists.
        for rule in allow.iter().chain(&deny) {
            assert!(!rule.contains('(') && !rule.contains('*'), "{rule}");
        }
        assert!(allow.iter().all(|rule| !deny.contains(rule)));
    }

    #[test]
    fn replacing_a_folder_leaves_exactly_the_listed_files() {
        let root = temp_dir("replace");
        let target = root.join("a/b");
        std::fs::create_dir_all(target.join("old")).unwrap();
        std::fs::write(target.join("old/stale.md"), "stale").unwrap();
        std::fs::write(target.join("SKILL.md"), "old").unwrap();
        replace_dir(&target, &[("SKILL.md", "new"), ("references/x/y.md", "y")]).unwrap();
        assert_eq!(entries(&target), ["SKILL.md", "references"]);
        assert_eq!(
            std::fs::read_to_string(target.join("SKILL.md")).unwrap(),
            "new"
        );
        assert_eq!(
            std::fs::read_to_string(target.join("references/x/y.md")).unwrap(),
            "y"
        );
        // Nothing of the writing stays beside the folder, and the next replacement works the same.
        assert_eq!(entries(&root.join("a")), ["b"]);
        replace_dir(&target, &[("only.md", "1")]).unwrap();
        assert_eq!(entries(&target), ["only.md"]);
        replace_dir::<&str>(&target, &[]).unwrap();
        assert!(entries(&target).is_empty());
        std::fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn a_failed_write_keeps_the_old_folder_and_leaves_no_half_written_one() {
        let root = temp_dir("replace-fails");
        let target = root.join("skill");
        replace_dir(&target, &[("SKILL.md", "old")]).unwrap();
        // `a` is a file, so `a/b` cannot be written.
        let err = replace_dir(&target, &[("a", "x"), ("a/b", "y")]).unwrap_err();
        assert!(err.contains("を作れません"), "{err}");
        assert_eq!(
            std::fs::read_to_string(target.join("SKILL.md")).unwrap(),
            "old"
        );
        assert_eq!(entries(&root), ["skill"]);
        std::fs::remove_dir_all(root).unwrap();
    }

    #[cfg(unix)]
    #[test]
    fn a_link_in_the_place_of_the_folder_is_removed_and_not_followed() {
        let root = temp_dir("replace-link");
        let elsewhere = root.join("elsewhere");
        std::fs::create_dir_all(&elsewhere).unwrap();
        std::fs::write(elsewhere.join("keep.md"), "keep").unwrap();
        let target = root.join("skill");
        std::os::unix::fs::symlink(&elsewhere, &target).unwrap();
        replace_dir(&target, &[("SKILL.md", "new")]).unwrap();
        assert!(!std::fs::symlink_metadata(&target).unwrap().is_symlink());
        assert_eq!(entries(&target), ["SKILL.md"]);
        assert_eq!(entries(&elsewhere), ["keep.md"]);
        std::fs::remove_dir_all(root).unwrap();
    }

    const SAMPLE: &[(&str, &str)] = &[
        (".claude-plugin/plugin.json", "{}"),
        ("skills/x/SKILL.md", "skill"),
    ];

    #[test]
    fn a_plugin_is_written_as_a_whole_with_its_hash() {
        let config = temp_dir("plugin");
        let dir = config.join("plugin");
        std::fs::create_dir_all(dir.join("skills/gone")).unwrap();
        std::fs::write(dir.join("skills/gone/SKILL.md"), "old").unwrap();
        ensure_plugin(&dir, SAMPLE).unwrap();
        assert!(!dir.join("skills/gone").exists());
        for (path, text) in SAMPLE {
            assert_eq!(&std::fs::read_to_string(dir.join(path)).unwrap(), text);
        }
        assert_eq!(
            std::fs::read_to_string(dir.join(MARK_FILE)).unwrap(),
            plugin_mark(SAMPLE)
        );
        assert_eq!(entries(&config), ["plugin"]);
        std::fs::remove_dir_all(config).unwrap();
    }

    #[test]
    fn a_folder_that_holds_this_plugin_is_not_written_again_and_any_other_is() {
        let config = temp_dir("plugin-again");
        let dir = config.join("plugin");
        ensure_plugin(&dir, SAMPLE).unwrap();
        // A file that the plugin does not list stays: nothing was replaced.
        std::fs::write(dir.join("marker.txt"), "still here").unwrap();
        ensure_plugin(&dir, SAMPLE).unwrap();
        assert!(dir.join("marker.txt").exists());
        let (path, text) = SAMPLE[1];
        // A file that a crash cut short, or left missing, makes the folder be written again.
        std::fs::write(dir.join(path), &text[..text.len() - 1]).unwrap();
        ensure_plugin(&dir, SAMPLE).unwrap();
        assert!(!dir.join("marker.txt").exists());
        assert_eq!(std::fs::read_to_string(dir.join(path)).unwrap(), text);
        std::fs::write(dir.join("marker.txt"), "x").unwrap();
        std::fs::remove_file(dir.join(path)).unwrap();
        ensure_plugin(&dir, SAMPLE).unwrap();
        assert!(!dir.join("marker.txt").exists());
        // So does another mark (another plugin), and a folder with none.
        std::fs::write(dir.join("marker.txt"), "x").unwrap();
        std::fs::write(dir.join(MARK_FILE), "another").unwrap();
        ensure_plugin(&dir, SAMPLE).unwrap();
        assert!(!dir.join("marker.txt").exists());
        std::fs::write(dir.join("marker.txt"), "x").unwrap();
        std::fs::remove_file(dir.join(MARK_FILE)).unwrap();
        ensure_plugin(&dir, SAMPLE).unwrap();
        assert!(!dir.join("marker.txt").exists());
        assert_eq!(entries(&config), ["plugin"]);
        std::fs::remove_dir_all(config).unwrap();
    }

    #[test]
    fn the_mark_of_a_plugin_changes_with_any_path_or_text() {
        let base = plugin_mark(&[("a.md", "1"), ("b.md", "2")]);
        assert_eq!(base, plugin_mark(&[("a.md", "1"), ("b.md", "2")]));
        assert_ne!(base, plugin_mark(&[("a.md", "1"), ("b.md", "3")]));
        assert_ne!(base, plugin_mark(&[("a.md", "1"), ("c.md", "2")]));
        assert_ne!(base, plugin_mark(&[("a.md", "12"), ("b.md", "")]));
        assert_ne!(base, plugin_mark(&[("a.md", "1")]));
    }

    #[test]
    fn a_replaced_folder_is_swapped_in_with_the_old_one_removed_only_afterwards() {
        let root = temp_dir("swap");
        let target = root.join("skill");
        std::fs::create_dir_all(&target).unwrap();
        std::fs::write(target.join("SKILL.md"), "old").unwrap();
        let (staging, old) = (root.join(".new"), root.join(".old"));
        write_files(&staging, &[("SKILL.md", "new")]).unwrap();
        swap(&staging, &target, &old).unwrap();
        assert_eq!(
            std::fs::read_to_string(target.join("SKILL.md")).unwrap(),
            "new"
        );
        // What was there is beside it until it is removed, whole.
        assert_eq!(
            std::fs::read_to_string(old.join("SKILL.md")).unwrap(),
            "old"
        );
        assert!(!staging.exists());
        // A staging folder that cannot be placed gives the old folder back.
        let missing = root.join(".missing");
        let again_old = root.join(".old2");
        std::fs::remove_dir_all(&target).unwrap();
        std::fs::create_dir_all(&target).unwrap();
        std::fs::write(target.join("SKILL.md"), "kept").unwrap();
        assert!(swap(&missing, &target, &again_old).is_err());
        assert_eq!(
            std::fs::read_to_string(target.join("SKILL.md")).unwrap(),
            "kept"
        );
        assert!(!again_old.exists());
        std::fs::remove_dir_all(root).unwrap();
    }

    fn plugin_files(files: &[(&str, &[u8])]) -> Vec<(String, Vec<u8>)> {
        files
            .iter()
            .map(|(p, b)| ((*p).to_owned(), b.to_vec()))
            .collect()
    }

    /// A whole send into `target` (what the requests of the server do, one piece for each file).
    fn receive(target: &Path, files: &[(String, Vec<u8>)]) -> Result<bool, String> {
        let mark = plugins_mark_of(files);
        let entries = plugin_entries(files);
        if plugins_begin(target, ID, &mark, &entries)? {
            return Ok(false);
        }
        let pieces: Vec<(String, u64, Vec<u8>)> = files
            .iter()
            .map(|(p, b)| (p.clone(), 0, b.clone()))
            .collect();
        plugins_write(target, ID, &mark, &pieces)?;
        plugins_commit(target, ID, &mark, &entries)?;
        Ok(true)
    }

    #[test]
    fn the_hash_of_a_set_changes_with_a_path_a_text_or_where_a_byte_sits() {
        let base = plugins_mark_of(&plugin_files(&[("a.md", b"1"), ("b.md", b"2")]));
        assert_eq!(base.len(), 64);
        assert_eq!(
            base,
            plugins_mark_of(&plugin_files(&[("a.md", b"1"), ("b.md", b"2")]))
        );
        assert_ne!(
            base,
            plugins_mark_of(&plugin_files(&[("a.md", b"1"), ("b.md", b"3")]))
        );
        assert_ne!(
            base,
            plugins_mark_of(&plugin_files(&[("a.md", b"1"), ("c.md", b"2")]))
        );
        assert_ne!(base, plugins_mark_of(&plugin_files(&[("a.md", b"1")])));
        // A byte moved from one file to the next, or a name that swallows a text, is another set.
        assert_ne!(
            plugins_mark_of(&plugin_files(&[("a", b"bc"), ("d", b"")])),
            plugins_mark_of(&plugin_files(&[("a", b"b"), ("cd", b"")]))
        );
        assert_ne!(
            plugins_mark_of(&plugin_files(&[("a", b"bc")])),
            plugins_mark_of(&plugin_files(&[("ab", b"c")]))
        );
    }

    #[cfg(unix)]
    #[test]
    fn the_plugins_folder_is_read_sorted_without_links_git_and_the_mark() {
        let root = temp_dir("plugins-read");
        let dir = root.join("plugins");
        std::fs::create_dir_all(dir.join("b/skills/x")).unwrap();
        std::fs::create_dir_all(dir.join("a/.claude-plugin")).unwrap();
        std::fs::create_dir_all(dir.join("a/.git")).unwrap();
        std::fs::write(dir.join("b/skills/x/SKILL.md"), "skill").unwrap();
        std::fs::write(dir.join("a/.claude-plugin/plugin.json"), "{}").unwrap();
        std::fs::write(dir.join("a/.git/HEAD"), "ref").unwrap();
        std::fs::write(dir.join("a/.DS_Store"), "x").unwrap();
        std::fs::write(dir.join("empty"), "").unwrap();
        std::fs::write(dir.join(PLUGINS_MARK_FILE), "mark").unwrap();
        std::os::unix::fs::symlink(root.join("elsewhere"), dir.join("link")).unwrap();
        std::fs::create_dir_all(root.join("elsewhere")).unwrap();
        std::fs::write(root.join("elsewhere/secret"), "secret").unwrap();
        std::os::unix::fs::symlink(root.join("elsewhere"), dir.join("a/dir-link")).unwrap();
        let files = read_plugins_folder(&dir).unwrap();
        let paths: Vec<&str> = files.iter().map(|(p, _)| p.as_str()).collect();
        assert_eq!(
            paths,
            [
                "a/.claude-plugin/plugin.json",
                "b/skills/x/SKILL.md",
                "empty"
            ]
        );
        assert_eq!(files[2].1, b"");
        // A folder that is not there is a folder with no file.
        assert!(read_plugins_folder(&root.join("missing"))
            .unwrap()
            .is_empty());
        std::fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn a_folder_with_too_many_files_or_bytes_or_a_wrong_name_is_refused() {
        let root = temp_dir("plugins-limits");
        let dir = root.join("plugins");
        std::fs::create_dir_all(&dir).unwrap();
        for i in 0..=PLUGINS_MAX_FILES {
            std::fs::write(dir.join(format!("f{i}")), "").unwrap();
        }
        assert!(read_plugins_folder(&dir)
            .unwrap_err()
            .contains("大きすぎます"));
        std::fs::remove_dir_all(&dir).unwrap();
        std::fs::create_dir_all(&dir).unwrap();
        // A sparse file over the limit is refused by its size, before it is read.
        let big = std::fs::File::create(dir.join("big")).unwrap();
        big.set_len(PLUGINS_MAX_BYTES + 1).unwrap();
        assert!(read_plugins_folder(&dir)
            .unwrap_err()
            .contains("大きすぎます"));
        std::fs::remove_dir_all(&dir).unwrap();
        std::fs::create_dir_all(&dir).unwrap();
        std::fs::write(dir.join("a\\b"), "x").unwrap();
        assert!(read_plugins_folder(&dir)
            .unwrap_err()
            .contains("場所が正しくありません"));
        std::fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn a_path_that_leaves_the_folder_is_refused_everywhere() {
        let root = temp_dir("plugins-paths");
        let target = root.join("plugins");
        let mark = plugins_mark_of(&[]);
        let long = "a".repeat(PLUGINS_MAX_PATH + 1);
        for bad in [
            "",
            "/etc/x",
            "../x",
            "a/../b",
            "a//b",
            "./a",
            "a/.",
            "a/",
            "a\\b",
            "a\nb",
            PLUGINS_MARK_FILE,
            long.as_str(),
        ] {
            let entry = [PluginEntry {
                path: bad.to_owned(),
                size: 0,
            }];
            assert!(
                plugins_begin(&target, ID, &mark, &entry).is_err(),
                "{bad:?}"
            );
            assert!(
                plugins_commit(&target, ID, &mark, &entry).is_err(),
                "{bad:?}"
            );
        }
        // A piece is checked too, after a good begin.
        plugins_begin(&target, ID, &mark, &[]).unwrap();
        for bad in ["../x", "/x", "a/../../x", PLUGINS_MARK_FILE] {
            let piece = [(bad.to_owned(), 0, b"x".to_vec())];
            assert!(
                plugins_write(&target, ID, &mark, &piece).is_err(),
                "{bad:?}"
            );
        }
        assert_eq!(entries(&root), [".plugins.incoming-".to_owned() + ID]);
        // The same path twice, a mark that is no hash, and too many files.
        let twice = [
            PluginEntry {
                path: "a".into(),
                size: 0,
            },
            PluginEntry {
                path: "a".into(),
                size: 0,
            },
        ];
        assert!(plugins_begin(&target, ID, &mark, &twice)
            .unwrap_err()
            .contains("二つ"));
        for bad in ["", "abc", &"G".repeat(64), &"A".repeat(64)] {
            assert!(plugins_begin(&target, ID, bad, &[]).is_err(), "{bad}");
        }
        let many: Vec<PluginEntry> = (0..=PLUGINS_MAX_FILES)
            .map(|i| PluginEntry {
                path: format!("f{i}"),
                size: 0,
            })
            .collect();
        assert!(plugins_begin(&target, ID, &mark, &many)
            .unwrap_err()
            .contains("大きすぎます"));
        std::fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn a_sent_folder_replaces_the_old_one_as_a_whole_and_is_not_sent_again() {
        let root = temp_dir("plugins-replace");
        let target = root.join("plugins");
        std::fs::create_dir_all(target.join("old")).unwrap();
        std::fs::write(target.join("old/stale.md"), "stale").unwrap();
        let files = plugin_files(&[
            ("a/.claude-plugin/plugin.json", b"{}"),
            ("a/skills/x/SKILL.md", b"skill"),
            ("empty", b""),
        ]);
        assert!(receive(&target, &files).unwrap());
        assert_eq!(
            std::fs::read_to_string(target.join("a/skills/x/SKILL.md")).unwrap(),
            "skill"
        );
        assert!(target.join("empty").is_file());
        assert!(!target.join("old").exists());
        assert_eq!(
            std::fs::read_to_string(target.join(PLUGINS_MARK_FILE)).unwrap(),
            plugins_mark_of(&files)
        );
        // Nothing of the transfer stays beside the folder.
        assert_eq!(entries(&root), ["plugins"]);
        // The same set is not sent again, and the file of the hash is no file of the set.
        assert!(!receive(&target, &files).unwrap());
        // A file that is changed, cut or taken away on that PC makes it send again; a removed file of the set is gone.
        std::fs::write(target.join("a/skills/x/SKILL.md"), "skil").unwrap();
        assert!(receive(&target, &files).unwrap());
        // So does a file changed to another text of the same size.
        assert!(!receive(&target, &files).unwrap());
        std::fs::write(target.join("a/skills/x/SKILL.md"), "SKILL").unwrap();
        assert!(receive(&target, &files).unwrap());
        assert_eq!(
            std::fs::read_to_string(target.join("a/skills/x/SKILL.md")).unwrap(),
            "skill"
        );
        std::fs::remove_file(target.join("empty")).unwrap();
        assert!(receive(&target, &files).unwrap());
        assert!(!receive(&target, &files).unwrap());
        let fewer = plugin_files(&[("a/.claude-plugin/plugin.json", b"{}")]);
        assert!(receive(&target, &fewer).unwrap());
        assert!(!target.join("a/skills").exists());
        assert_eq!(entries(&target), [PLUGINS_MARK_FILE, "a"]);
        // An empty set empties the folder (no plugin on this PC, none on that one).
        assert!(receive(&target, &[]).unwrap());
        assert_eq!(entries(&target), [PLUGINS_MARK_FILE]);
        assert!(!receive(&target, &[]).unwrap());
        std::fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn a_file_that_comes_in_pieces_is_put_together_and_a_piece_sent_twice_changes_nothing() {
        let root = temp_dir("plugins-pieces");
        let target = root.join("plugins");
        let big: Vec<u8> = (0..1000u32).map(|i| (i % 251) as u8).collect();
        let files = vec![("big.bin".to_owned(), big.clone())];
        let mark = plugins_mark_of(&files);
        let entries_ = plugin_entries(&files);
        assert!(!plugins_begin(&target, ID, &mark, &entries_).unwrap());
        let piece =
            |from: usize, to: usize| ("big.bin".to_owned(), from as u64, big[from..to].to_vec());
        // A hole in the middle of a file of the right size is caught by the hash.
        plugins_write(&target, ID, &mark, &[piece(600, 1000), piece(0, 300)]).unwrap();
        std::fs::create_dir_all(&target).unwrap();
        let err = plugins_commit(&target, ID, &mark, &entries_).unwrap_err();
        assert!(err.contains("ハッシュと合いません"), "{err}");
        // Pieces out of order, one of them twice, with the end missing.
        plugins_begin(&target, ID, &mark, &entries_).unwrap();
        plugins_write(&target, ID, &mark, &[piece(300, 600), piece(0, 300)]).unwrap();
        plugins_write(&target, ID, &mark, &[piece(0, 300)]).unwrap();
        // Short of a piece: refused, and the folder that arrived is removed with the old one kept.
        std::fs::write(target.join("keep.md"), "keep").unwrap();
        let err = plugins_commit(&target, ID, &mark, &entries_).unwrap_err();
        assert!(err.contains("届ききっていません"), "{err}");
        assert_eq!(entries(&root), ["plugins"]);
        assert_eq!(
            std::fs::read_to_string(target.join("keep.md")).unwrap(),
            "keep"
        );
        // A commit with nothing begun is refused.
        assert!(plugins_commit(&target, ID, &mark, &entries_)
            .unwrap_err()
            .contains("始まっていません"));
        assert!(plugins_write(&target, ID, &mark, &[piece(0, 10)])
            .unwrap_err()
            .contains("始まっていません"));
        // All the pieces make the file.
        plugins_begin(&target, ID, &mark, &entries_).unwrap();
        plugins_write(
            &target,
            ID,
            &mark,
            &[piece(300, 600), piece(0, 300), piece(600, 1000)],
        )
        .unwrap();
        plugins_commit(&target, ID, &mark, &entries_).unwrap();
        assert_eq!(std::fs::read(target.join("big.bin")).unwrap(), big);
        assert!(!target.join("keep.md").exists());
        std::fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn what_does_not_match_the_list_or_the_hash_is_refused_and_the_old_folder_stays() {
        let root = temp_dir("plugins-mismatch");
        let target = root.join("plugins");
        std::fs::create_dir_all(&target).unwrap();
        std::fs::write(target.join("keep.md"), "keep").unwrap();
        let files = plugin_files(&[("a.md", b"one"), ("b.md", b"two")]);
        let mark = plugins_mark_of(&files);
        let listed = plugin_entries(&files);
        let kept = |root: &Path| {
            assert_eq!(
                std::fs::read_to_string(root.join("plugins/keep.md")).unwrap(),
                "keep"
            );
            assert_eq!(entries(root), ["plugins"]);
        };
        // A file that was not listed.
        plugins_begin(&target, ID, &mark, &listed).unwrap();
        let pieces: Vec<(String, u64, Vec<u8>)> = files
            .iter()
            .map(|(p, b)| (p.clone(), 0, b.clone()))
            .collect();
        plugins_write(&target, ID, &mark, &pieces).unwrap();
        std::fs::write(
            plugins_staging(&target, ID)
                .unwrap()
                .join(FILES_DIR)
                .join("extra.md"),
            "x",
        )
        .unwrap();
        assert!(plugins_commit(&target, ID, &mark, &listed)
            .unwrap_err()
            .contains("一覧と合いません"));
        kept(&root);
        // The right sizes with other bytes: the hash does not match.
        plugins_begin(&target, ID, &mark, &listed).unwrap();
        let wrong = [
            ("a.md".to_owned(), 0, b"ONE".to_vec()),
            ("b.md".to_owned(), 0, b"two".to_vec()),
        ];
        plugins_write(&target, ID, &mark, &wrong).unwrap();
        assert!(plugins_commit(&target, ID, &mark, &listed)
            .unwrap_err()
            .contains("ハッシュと合いません"));
        kept(&root);
        // A list that says other sizes than the files that came.
        plugins_begin(&target, ID, &mark, &listed).unwrap();
        let (a, b) = (&pieces[0], &pieces[1]);
        plugins_write(&target, ID, &mark, &[a.clone(), b.clone()]).unwrap();
        let lied = [
            PluginEntry {
                path: "a.md".into(),
                size: 99,
            },
            PluginEntry {
                path: "b.md".into(),
                size: 3,
            },
        ];
        assert!(plugins_commit(&target, ID, &mark, &lied).is_err());
        kept(&root);
        std::fs::remove_dir_all(root).unwrap();
    }

    fn pieces_of(files: &[(String, Vec<u8>)]) -> Vec<(String, u64, Vec<u8>)> {
        files
            .iter()
            .map(|(p, b)| (p.clone(), 0, b.clone()))
            .collect()
    }

    #[test]
    fn two_sends_of_one_set_at_once_both_succeed_and_leave_nothing_beside() {
        let root = temp_dir("plugins-twice");
        let target = root.join("plugins");
        let files = plugin_files(&[("a/x.md", b"one"), ("b.md", b"two")]);
        let mark = plugins_mark_of(&files);
        let listed = plugin_entries(&files);
        let pieces = pieces_of(&files);
        // Both begin before either writes, as two children launched side by side do: the second begin does not remove the folder of the first.
        assert!(!plugins_begin(&target, ID, &mark, &listed).unwrap());
        plugins_write(&target, ID, &mark, &pieces[..1]).unwrap();
        assert!(!plugins_begin(&target, ID2, &mark, &listed).unwrap());
        plugins_write(&target, ID, &mark, &pieces[1..]).unwrap();
        plugins_write(&target, ID2, &mark, &pieces).unwrap();
        plugins_commit(&target, ID, &mark, &listed).unwrap();
        // The set is in place when the other ends: that commit succeeds and changes nothing.
        plugins_commit(&target, ID2, &mark, &listed).unwrap();
        assert_eq!(
            std::fs::read_to_string(target.join("a/x.md")).unwrap(),
            "one"
        );
        assert_eq!(
            std::fs::read_to_string(target.join(PLUGINS_MARK_FILE)).unwrap(),
            mark
        );
        assert_eq!(entries(&root), ["plugins"]);
        // The same commit again is no error either, and a send that begins now finds the set held.
        plugins_commit(&target, ID2, &mark, &listed).unwrap();
        assert!(plugins_begin(&target, ID2, &mark, &listed).unwrap());
        // A set that is not there is still refused when nothing was begun.
        let other = plugin_files(&[("c.md", b"3")]);
        assert!(plugins_commit(
            &target,
            ID2,
            &plugins_mark_of(&other),
            &plugin_entries(&other)
        )
        .unwrap_err()
        .contains("始まっていません"));
        std::fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn the_id_of_a_send_is_checked_and_names_its_own_folder() {
        let root = temp_dir("plugins-id");
        let target = root.join("plugins");
        let mark = plugins_mark_of(&[]);
        for bad in [
            "",
            "abc",
            "../".repeat(11).as_str(),
            &"G".repeat(32),
            &"A".repeat(32),
        ] {
            assert!(plugins_begin(&target, bad, &mark, &[]).is_err(), "{bad}");
            assert!(plugins_write(&target, bad, &mark, &[]).is_err(), "{bad}");
            assert!(plugins_commit(&target, bad, &mark, &[]).is_err(), "{bad}");
        }
        assert_eq!(entries(&root), Vec::<String>::new());
        plugins_begin(&target, ID, &mark, &[]).unwrap();
        plugins_begin(&target, ID2, &mark, &[]).unwrap();
        assert_eq!(
            entries(&root),
            [
                format!(".plugins.incoming-{ID}"),
                format!(".plugins.incoming-{ID2}")
            ]
        );
        std::fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn a_piece_of_a_file_that_the_list_does_not_hold_or_past_its_size_is_refused() {
        let root = temp_dir("plugins-list");
        let target = root.join("plugins");
        let files = plugin_files(&[("a.md", b"abc")]);
        let mark = plugins_mark_of(&files);
        plugins_begin(&target, ID, &mark, &plugin_entries(&files)).unwrap();
        let piece =
            |path: &str, offset: u64, len: usize| [(path.to_owned(), offset, vec![b'x'; len])];
        let err = plugins_write(&target, ID, &mark, &piece("b.md", 0, 1)).unwrap_err();
        assert!(err.contains("一覧にありません"), "{err}");
        for (offset, len) in [(0, 4), (2, 2), (4, 0), (u64::MAX, 1)] {
            let err = plugins_write(&target, ID, &mark, &piece("a.md", offset, len)).unwrap_err();
            assert!(err.contains("一覧の大きさ"), "{offset} {len}: {err}");
        }
        // Nothing of those was written; the ends of the file are allowed.
        let files_dir = plugins_staging(&target, ID).unwrap().join(FILES_DIR);
        assert_eq!(entries(&files_dir), Vec::<String>::new());
        plugins_write(&target, ID, &mark, &piece("a.md", 0, 3)).unwrap();
        plugins_write(&target, ID, &mark, &piece("a.md", 3, 0)).unwrap();
        assert_eq!(entries(&files_dir), ["a.md"]);
        std::fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn the_folder_of_a_send_that_never_ended_is_removed_by_a_later_begin_once_it_is_old() {
        let root = temp_dir("plugins-stale");
        let target = root.join("plugins");
        let stale = root.join(".plugins.incoming-stale");
        let fresh = root.join(".plugins.incoming-fresh");
        let other = root.join(".other.incoming-stale");
        for dir in [&stale, &fresh, &other] {
            std::fs::create_dir_all(dir).unwrap();
        }
        let long_ago = std::time::SystemTime::now() - PLUGINS_STALE * 2;
        for dir in [&stale, &other] {
            std::fs::File::open(dir)
                .unwrap()
                .set_modified(long_ago)
                .unwrap();
        }
        plugins_begin(&target, ID, &plugins_mark_of(&[]), &[]).unwrap();
        assert_eq!(
            entries(&root),
            [
                ".other.incoming-stale".to_owned(),
                format!(".plugins.incoming-{ID}"),
                ".plugins.incoming-fresh".to_owned()
            ]
        );
        std::fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn a_failed_piece_leaves_the_old_folder_as_it_was() {
        let root = temp_dir("plugins-failed-piece");
        let target = root.join("plugins");
        std::fs::create_dir_all(&target).unwrap();
        std::fs::write(target.join("keep.md"), "keep").unwrap();
        let files = plugin_files(&[("a", b"x"), ("a/b", b"y")]);
        let mark = plugins_mark_of(&files);
        plugins_begin(&target, ID, &mark, &plugin_entries(&files)).unwrap();
        // `a` is a file, so `a/b` cannot be written.
        let pieces = [
            ("a".to_owned(), 0, b"x".to_vec()),
            ("a/b".to_owned(), 0, b"y".to_vec()),
        ];
        assert!(plugins_write(&target, ID, &mark, &pieces)
            .unwrap_err()
            .contains("作れません"));
        assert_eq!(
            std::fs::read_to_string(target.join("keep.md")).unwrap(),
            "keep"
        );
        std::fs::remove_dir_all(root).unwrap();
    }
}
