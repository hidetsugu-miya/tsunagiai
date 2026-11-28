//! A-48 (#1603): AI usage read from a local cache written by the `statusLine` hook of Claude Code and Antigravity CLI, and the settings commands that wrap and restore each CLI's `statusLine` in its `settings.json`.
//! Nothing calls `agy -p` or any external API: each CLI pipes its status JSON to the wrapper during normal interactive use, and `tsunagiai-mcp --statusline-cache {claude|antigravity}` updates `{config}/ai-usage-cache.json` atomically.

use std::{
    fs,
    path::{Path, PathBuf},
    sync::Mutex,
};

use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use serde_json::{json, Map, Value};
#[cfg(test)]
use ts_rs::TS;

use crate::{accounts::write_atomic, claude_code::sh_quote};

const CACHE_FILE: &str = "ai-usage-cache.json";
const HOOKS_FILE: &str = "statusline-hooks.json";
const WRAP_DIR: &str = "statusline";
/// Maximum bytes read from stdin by `tsunagiai-mcp --statusline-cache`.
pub const MAX_STDIN_BYTES: usize = 1024 * 1024;

/// Serializes reads/writes of `statusline-hooks.json` and the CLI `settings.json` inside the app.
static HOOK_LOCK: Mutex<()> = Mutex::new(());

/// Which AI CLI the statusLine hook or cache entry belongs to.
#[derive(Serialize, Deserialize, Clone, Copy, Debug, PartialEq, Eq)]
#[cfg_attr(test, derive(TS))]
#[cfg_attr(test, ts(export, export_to = crate::BINDINGS))]
#[serde(rename_all = "lowercase")]
pub enum AiKind {
    Claude,
    Antigravity,
}

impl AiKind {
    pub fn as_str(self) -> &'static str {
        match self {
            Self::Claude => "claude",
            Self::Antigravity => "antigravity",
        }
    }

    pub fn parse(s: &str) -> Option<Self> {
        match s {
            "claude" => Some(Self::Claude),
            "antigravity" => Some(Self::Antigravity),
            _ => None,
        }
    }

    fn label(self) -> &'static str {
        match self {
            Self::Claude => "Claude Code",
            Self::Antigravity => "Antigravity",
        }
    }

    fn settings_path(self, home: &Path) -> PathBuf {
        match self {
            Self::Claude => home.join(".claude").join("settings.json"),
            Self::Antigravity => home
                .join(".gemini")
                .join("antigravity-cli")
                .join("settings.json"),
        }
    }

    fn wrap_script_path(self, config: &Path) -> PathBuf {
        config
            .join(WRAP_DIR)
            .join(format!("{}-wrap.sh", self.as_str()))
    }
}

/// One rate-limit window: rounded percent used (0..=100) and reset timestamp in epoch milliseconds.
#[derive(Serialize, Deserialize, Clone, Debug, PartialEq, Eq)]
#[cfg_attr(test, derive(TS))]
#[cfg_attr(test, ts(export, export_to = crate::BINDINGS))]
#[serde(rename_all = "camelCase")]
pub struct UsageWindow {
    pub used_percent: u32,
    #[cfg_attr(test, ts(type = "number | null"))]
    pub resets_at: Option<i64>,
}

/// Cached usage snapshot for one AI CLI.
#[derive(Serialize, Deserialize, Clone, Debug, PartialEq, Eq)]
#[cfg_attr(test, derive(TS))]
#[cfg_attr(test, ts(export, export_to = crate::BINDINGS))]
#[serde(rename_all = "camelCase")]
pub struct AiUsageEntry {
    #[cfg_attr(test, ts(type = "number"))]
    pub updated_at: i64,
    pub session: Option<UsageWindow>,
    pub weekly: Option<UsageWindow>,
}

/// Contents of `ai-usage-cache.json`.
#[derive(Serialize, Deserialize, Clone, Debug, Default, PartialEq, Eq)]
#[cfg_attr(test, derive(TS))]
#[cfg_attr(test, ts(export, export_to = crate::BINDINGS))]
#[serde(rename_all = "camelCase")]
pub struct AiUsageCache {
    pub claude: Option<AiUsageEntry>,
    pub antigravity: Option<AiUsageEntry>,
}

/// Registration state of the `statusLine` wrappers in each CLI's `settings.json`.
#[derive(Serialize, Deserialize, Clone, Debug, Default, PartialEq, Eq)]
#[cfg_attr(test, derive(TS))]
#[cfg_attr(test, ts(export, export_to = crate::BINDINGS))]
#[serde(rename_all = "camelCase")]
pub struct AiStatuslineState {
    pub claude: bool,
    pub antigravity: bool,
}

#[derive(Serialize, Deserialize, Clone, Debug, Default)]
struct SavedHook {
    /// Original `statusLine` value in `settings.json` before wrapping (`None` if the key did not exist).
    previous: Option<Value>,
}

#[derive(Serialize, Deserialize, Clone, Debug, Default)]
struct SavedHooks {
    #[serde(default)]
    claude: Option<SavedHook>,
    #[serde(default)]
    antigravity: Option<SavedHook>,
}

impl SavedHooks {
    fn get(&self, kind: AiKind) -> Option<&SavedHook> {
        match kind {
            AiKind::Claude => self.claude.as_ref(),
            AiKind::Antigravity => self.antigravity.as_ref(),
        }
    }

    fn set(&mut self, kind: AiKind, hook: Option<SavedHook>) {
        match kind {
            AiKind::Claude => self.claude = hook,
            AiKind::Antigravity => self.antigravity = hook,
        }
    }
}

fn clamp_percent(value: f64) -> Option<u32> {
    value
        .is_finite()
        .then(|| value.clamp(0.0, 100.0).round() as u32)
}

fn parse_reset_time(value: &Value) -> Option<i64> {
    if let Some(n) = value.as_f64().filter(|v| v.is_finite() && *v > 0.0) {
        let rounded = n.round() as i64;
        // 10-digit Unix timestamps are seconds; 13-digit timestamps are milliseconds.
        return Some(if rounded < 10_000_000_000 {
            rounded.saturating_mul(1000)
        } else {
            rounded
        });
    }
    let s = value.as_str()?.trim();
    if s.is_empty() {
        return None;
    }
    DateTime::parse_from_rfc3339(s)
        .ok()
        .map(|dt| dt.with_timezone(&Utc).timestamp_millis())
}

fn parse_claude_window(obj: &Value) -> Option<UsageWindow> {
    let used = obj
        .get("used_percentage")?
        .as_f64()
        .and_then(clamp_percent)?;
    let resets_at = obj.get("resets_at").and_then(parse_reset_time);
    Some(UsageWindow {
        used_percent: used,
        resets_at,
    })
}

/// Parses Claude Code's `statusLine` JSON payload (`rate_limits.five_hour` / `rate_limits.seven_day`).
pub fn parse_claude_stdin(raw: &str, now_ms: i64) -> Option<AiUsageEntry> {
    let data: Value = serde_json::from_str(raw).ok()?;
    let limits = data.get("rate_limits")?.as_object()?;
    let session = limits.get("five_hour").and_then(parse_claude_window);
    let weekly = limits.get("seven_day").and_then(parse_claude_window);
    if session.is_none() && weekly.is_none() {
        return None;
    }
    Some(AiUsageEntry {
        updated_at: now_ms,
        session,
        weekly,
    })
}

/// Parses Antigravity CLI's `statusLine` JSON payload (`quota` buckets with `remaining_fraction`, `reset_time`, `reset_in_seconds`).
pub fn parse_antigravity_stdin(raw: &str, now_ms: i64) -> Option<AiUsageEntry> {
    let data: Value = serde_json::from_str(raw).ok()?;
    let quota = data.get("quota")?.as_object()?;
    if quota.is_empty() {
        return None;
    }

    let model_hint = data
        .get("model")
        .and_then(Value::as_object)
        .map(|m| {
            let display = m.get("display_name").and_then(Value::as_str).unwrap_or("");
            let id = m.get("id").and_then(Value::as_str).unwrap_or("");
            format!("{display} {id}").to_lowercase()
        })
        .unwrap_or_default();

    let mut weekly_candidates: Vec<(i32, u32, Option<i64>)> = Vec::new();
    let mut session_candidates: Vec<(i32, u32, Option<i64>)> = Vec::new();

    for (key, entry) in quota {
        let Some(obj) = entry.as_object() else {
            continue;
        };
        if obj
            .get("disabled")
            .and_then(Value::as_bool)
            .unwrap_or(false)
        {
            continue;
        }
        let Some(rem_frac) = obj
            .get("remaining_fraction")
            .and_then(Value::as_f64)
            .filter(|v| v.is_finite())
        else {
            continue;
        };
        let Some(used_percent) = clamp_percent((1.0 - rem_frac) * 100.0) else {
            continue;
        };

        let reset_in = obj
            .get("reset_in_seconds")
            .and_then(Value::as_f64)
            .filter(|v| v.is_finite());
        let resets_at = obj
            .get("reset_time")
            .and_then(parse_reset_time)
            .or_else(|| reset_in.map(|secs| now_ms.saturating_add((secs * 1000.0).round() as i64)));

        let key_lower = key.to_lowercase();
        let is_weekly_key =
            key_lower.contains("week") || key_lower.contains("7d") || key_lower.contains("seven");
        let is_long_window = reset_in.is_some_and(|s| s > 86_400.0)
            || resets_at.is_some_and(|at| at.saturating_sub(now_ms) > 86_400_000);

        let mut score = 0;
        if is_weekly_key {
            score += 10;
        }
        for family in ["gemini", "claude", "gpt", "flash", "pro"] {
            if model_hint.contains(family) && key_lower.contains(family) {
                score += 5;
            }
        }

        if is_weekly_key || is_long_window {
            weekly_candidates.push((score, used_percent, resets_at));
        } else {
            session_candidates.push((score, used_percent, resets_at));
        }
    }

    weekly_candidates.sort_by_key(|a| std::cmp::Reverse((a.0, a.1)));
    session_candidates.sort_by_key(|a| std::cmp::Reverse((a.0, a.1)));

    let weekly = weekly_candidates
        .first()
        .map(|&(_, used_percent, resets_at)| UsageWindow {
            used_percent,
            resets_at,
        });
    let session = session_candidates
        .first()
        .map(|&(_, used_percent, resets_at)| UsageWindow {
            used_percent,
            resets_at,
        });

    if session.is_none() && weekly.is_none() {
        return None;
    }

    Some(AiUsageEntry {
        updated_at: now_ms,
        session,
        weekly,
    })
}

/// Reads `{config}/ai-usage-cache.json`. Missing or unreadable files return an empty cache.
pub fn read_cache(config: &Path) -> AiUsageCache {
    fs::read_to_string(config.join(CACHE_FILE))
        .ok()
        .and_then(|text| serde_json::from_str(&text).ok())
        .unwrap_or_default()
}

/// Parses `raw` from stdin for `kind` and updates `{config}/ai-usage-cache.json` atomically.
/// Returns `Ok(true)` when a usage snapshot was written, `Ok(false)` when `raw` carried no usage fields.
pub fn record_from_stdin(
    config: &Path,
    kind: AiKind,
    raw: &str,
    now_ms: i64,
) -> Result<bool, String> {
    let entry = match kind {
        AiKind::Claude => parse_claude_stdin(raw, now_ms),
        AiKind::Antigravity => parse_antigravity_stdin(raw, now_ms),
    };
    let Some(entry) = entry else {
        return Ok(false);
    };
    let mut cache = read_cache(config);
    match kind {
        AiKind::Claude => cache.claude = Some(entry),
        AiKind::Antigravity => cache.antigravity = Some(entry),
    }
    let text =
        serde_json::to_string_pretty(&cache).map_err(|e| format!("キャッシュを書けません: {e}"))?;
    write_atomic(config, CACHE_FILE, &text)?;
    Ok(true)
}

fn read_saved_hooks(config: &Path) -> SavedHooks {
    fs::read_to_string(config.join(HOOKS_FILE))
        .ok()
        .and_then(|text| serde_json::from_str(&text).ok())
        .unwrap_or_default()
}

fn write_saved_hooks(config: &Path, hooks: &SavedHooks) -> Result<(), String> {
    let text = serde_json::to_string_pretty(hooks)
        .map_err(|e| format!("ステータスライン設定の退避を書けません: {e}"))?;
    write_atomic(config, HOOKS_FILE, &text)
}

fn read_cli_settings(path: &Path) -> Result<Map<String, Value>, String> {
    match fs::read_to_string(path) {
        Ok(text) => {
            if text.trim().is_empty() {
                return Ok(Map::new());
            }
            let value: Value = serde_json::from_str(&text)
                .map_err(|_| format!("{} が JSON として読めません", path.display()))?;
            value.as_object().cloned().ok_or_else(|| {
                format!(
                    "{} のトップレベルがオブジェクトではありません",
                    path.display()
                )
            })
        }
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(Map::new()),
        Err(e) => Err(format!("{} を読めません: {e}", path.display())),
    }
}

fn write_cli_settings(path: &Path, map: &Map<String, Value>) -> Result<(), String> {
    let dir = path
        .parent()
        .ok_or_else(|| format!("{} のフォルダが分かりません", path.display()))?;
    let name = path
        .file_name()
        .and_then(|n| n.to_str())
        .ok_or_else(|| format!("{} のファイル名が分かりません", path.display()))?;
    let text = serde_json::to_string_pretty(&Value::Object(map.clone()))
        .map_err(|e| format!("設定を書けません: {e}"))?;
    write_atomic(dir, name, &format!("{text}\n"))
}

fn statusline_command(settings: &Map<String, Value>) -> Option<&str> {
    settings
        .get("statusLine")
        .and_then(Value::as_object)
        .and_then(|o| o.get("command"))
        .and_then(Value::as_str)
}

fn is_registered_in(config: &Path, home: &Path, kind: AiKind) -> bool {
    let expected = kind.wrap_script_path(config);
    let expected_str = expected.to_string_lossy();
    let Ok(settings) = read_cli_settings(&kind.settings_path(home)) else {
        return false;
    };
    statusline_command(&settings) == Some(expected_str.as_ref())
}

/// Checks whether each CLI's `settings.json` currently points `statusLine.command` at tsunagiai's wrapper.
pub fn statusline_state(config: &Path, home: &Path) -> AiStatuslineState {
    AiStatuslineState {
        claude: is_registered_in(config, home, AiKind::Claude),
        antigravity: is_registered_in(config, home, AiKind::Antigravity),
    }
}

/// Builds the POSIX wrapper script that pipes stdin to `tsunagiai-mcp --statusline-cache {kind}` (ignoring errors)
/// and forwards the exact same stdin to `previous_command` when one was configured.
pub fn wrap_script(mcp: &Path, kind: AiKind, previous_command: Option<&str>) -> String {
    let mcp_q = sh_quote(&mcp.to_string_lossy());
    let mut script = format!(
        "#!/bin/sh\n\
         # Written by tsunagiai (A-48) to cache {label} usage from statusLine.\n\
         INPUT=$(cat)\n\
         if [ -x {mcp_q} ]; then\n\
           printf '%s' \"$INPUT\" | {mcp_q} --statusline-cache {kind} >/dev/null 2>&1 || true\n\
         fi\n",
        label = kind.label(),
        kind = kind.as_str(),
    );
    if let Some(prev) = previous_command.map(str::trim).filter(|s| !s.is_empty()) {
        script.push_str(&format!(
            "printf '%s' \"$INPUT\" | /bin/sh -c {}\n",
            sh_quote(prev)
        ));
    }
    script
}

fn write_wrap_script(path: &Path, content: &str) -> Result<(), String> {
    let dir = path
        .parent()
        .ok_or_else(|| format!("{} のフォルダが分かりません", path.display()))?;
    let name = path
        .file_name()
        .and_then(|n| n.to_str())
        .ok_or_else(|| format!("{} のファイル名が分かりません", path.display()))?;
    write_atomic(dir, name, content)?;
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        fs::set_permissions(path, fs::Permissions::from_mode(0o700))
            .map_err(|e| format!("ラッパーに実行権限を付けられません: {e}"))?;
    }
    Ok(())
}

fn previous_command_of(saved: &SavedHook) -> Option<&str> {
    saved
        .previous
        .as_ref()
        .and_then(Value::as_object)
        .and_then(|o| o.get("command"))
        .and_then(Value::as_str)
}

/// Registers or restores the `statusLine` wrapper for `kind` in its CLI `settings.json`.
pub fn set_statusline(
    config: &Path,
    home: &Path,
    mcp: &Path,
    kind: AiKind,
    enabled: bool,
) -> Result<AiStatuslineState, String> {
    let _guard = HOOK_LOCK.lock().unwrap_or_else(|e| e.into_inner());
    let settings_path = kind.settings_path(home);
    let wrap_path = kind.wrap_script_path(config);
    let wrap_str = wrap_path.to_string_lossy().into_owned();

    let mut settings = read_cli_settings(&settings_path)?;
    let mut hooks = read_saved_hooks(config);
    let already = statusline_command(&settings) == Some(wrap_str.as_str());

    if enabled {
        let saved = if already {
            hooks.get(kind).cloned().unwrap_or_default()
        } else {
            let previous = settings.get("statusLine").cloned();
            let saved = SavedHook { previous };
            hooks.set(kind, Some(saved.clone()));
            write_saved_hooks(config, &hooks)?;
            saved
        };

        let script = wrap_script(mcp, kind, previous_command_of(&saved));
        write_wrap_script(&wrap_path, &script)?;

        let mut next_sl = saved
            .previous
            .as_ref()
            .and_then(Value::as_object)
            .cloned()
            .unwrap_or_default();
        next_sl.insert("type".into(), json!("command"));
        next_sl.insert("command".into(), json!(wrap_str));
        if saved.previous.is_none() && kind == AiKind::Antigravity {
            next_sl.insert("stack_with_default".into(), json!(true));
        }
        settings.insert("statusLine".into(), Value::Object(next_sl));
        write_cli_settings(&settings_path, &settings)?;
    } else {
        if already {
            match hooks.get(kind).and_then(|h| h.previous.clone()) {
                Some(prev) => {
                    settings.insert("statusLine".into(), prev);
                }
                None => {
                    settings.remove("statusLine");
                }
            }
            write_cli_settings(&settings_path, &settings)?;
        }
        hooks.set(kind, None);
        write_saved_hooks(config, &hooks)?;
        let _ = fs::remove_file(&wrap_path);
    }

    Ok(statusline_state(config, home))
}

fn home_dir() -> Result<PathBuf, String> {
    dirs::home_dir().ok_or_else(|| "ホームフォルダが見つかりません".into())
}

fn mcp_path() -> Result<PathBuf, String> {
    let exe = std::env::current_exe()
        .map_err(|e| format!("アプリの実行ファイルの場所が分かりません: {e}"))?;
    Ok(crate::claude_code::mcp_binary(&exe))
}

/// A-48: reads the cached AI usage written by the statusLine hooks.
#[tauri::command]
pub fn ai_usage_read() -> Result<AiUsageCache, String> {
    let config = crate::identity::config_dir()?;
    Ok(read_cache(&config))
}

/// A-48: returns whether each CLI's `settings.json` has tsunagiai's statusLine wrapper registered.
#[tauri::command]
pub fn ai_usage_statusline_state() -> Result<AiStatuslineState, String> {
    let config = crate::identity::config_dir()?;
    let home = home_dir()?;
    Ok(statusline_state(&config, &home))
}

/// A-48: registers or unregisters tsunagiai's statusLine wrapper for `kind`.
#[tauri::command]
pub fn ai_usage_statusline_set(kind: AiKind, enabled: bool) -> Result<AiStatuslineState, String> {
    let config = crate::identity::config_dir()?;
    let home = home_dir()?;
    let mcp = mcp_path()?;
    set_statusline(&config, &home, &mcp, kind, enabled)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn temp_dir(name: &str) -> PathBuf {
        let dir =
            std::env::temp_dir().join(format!("tsunagiai-ai-usage-{}-{name}", std::process::id()));
        let _ = fs::remove_dir_all(&dir);
        fs::create_dir_all(&dir).unwrap();
        dir
    }

    #[test]
    fn parses_antigravity_weekly_and_session_quotas() {
        let now_ms = 1_795_860_000_000_i64;
        let raw = serde_json::json!({
            "model": { "display_name": "Gemini 4 Neon (Medium)", "id": "gemini-4-neon" },
            "quota": {
                "gemini_weekly": {
                    "disabled": false,
                    "remaining_fraction": 0.9,
                    "reset_time": "2026-12-03T10:27:00Z",
                    "reset_in_seconds": 432_000
                },
                "gemini_5h": {
                    "disabled": false,
                    "remaining_fraction": 0.75,
                    "reset_in_seconds": 7200
                },
                "claude_weekly": {
                    "disabled": true,
                    "remaining_fraction": 0.1,
                    "reset_in_seconds": 432_000
                }
            }
        })
        .to_string();

        let entry = parse_antigravity_stdin(&raw, now_ms).unwrap();
        assert_eq!(entry.updated_at, now_ms);
        assert_eq!(
            entry.weekly,
            Some(UsageWindow {
                used_percent: 10,
                resets_at: Some(
                    DateTime::parse_from_rfc3339("2026-12-03T10:27:00Z")
                        .unwrap()
                        .timestamp_millis()
                ),
            })
        );
        assert_eq!(
            entry.session,
            Some(UsageWindow {
                used_percent: 25,
                resets_at: Some(now_ms + 7_200_000),
            })
        );
    }

    #[test]
    fn parses_claude_rate_limits_with_epoch_seconds() {
        let now_ms = 1_795_860_000_000_i64;
        let raw = serde_json::json!({
            "rate_limits": {
                "five_hour": { "used_percentage": 12.6, "resets_at": 1_795_870_000 },
                "seven_day": { "used_percentage": 45.2, "resets_at": 1_796_200_000 }
            }
        })
        .to_string();

        let entry = parse_claude_stdin(&raw, now_ms).unwrap();
        assert_eq!(entry.updated_at, now_ms);
        assert_eq!(
            entry.session,
            Some(UsageWindow {
                used_percent: 13,
                resets_at: Some(1_795_870_000_000),
            })
        );
        assert_eq!(
            entry.weekly,
            Some(UsageWindow {
                used_percent: 45,
                resets_at: Some(1_796_200_000_000),
            })
        );
    }

    #[test]
    fn record_from_stdin_updates_only_its_own_ai_and_ignores_empty_payloads() {
        let config = temp_dir("record");
        let now_ms = 1_795_860_000_000_i64;
        assert!(!record_from_stdin(&config, AiKind::Claude, "{}", now_ms).unwrap());
        assert_eq!(read_cache(&config), AiUsageCache::default());

        let claude_raw =
            r#"{"rate_limits":{"seven_day":{"used_percentage":30,"resets_at":1796200000}}}"#;
        assert!(record_from_stdin(&config, AiKind::Claude, claude_raw, now_ms).unwrap());

        let agy_raw =
            r#"{"quota":{"gemini_weekly":{"remaining_fraction":0.8,"reset_in_seconds":200000}}}"#;
        assert!(record_from_stdin(&config, AiKind::Antigravity, agy_raw, now_ms + 1000).unwrap());

        let cache = read_cache(&config);
        assert_eq!(cache.claude.unwrap().weekly.unwrap().used_percent, 30);
        assert_eq!(cache.antigravity.unwrap().weekly.unwrap().used_percent, 20);
        fs::remove_dir_all(&config).unwrap();
    }

    #[test]
    fn wraps_and_restores_existing_statusline_and_handles_missing_settings() {
        let dir = temp_dir("wrap");
        let config = dir.join("config");
        let home = dir.join("home");
        let mcp = PathBuf::from("/Applications/tsunagiai.app/Contents/MacOS/tsunagiai-mcp");
        fs::create_dir_all(home.join(".gemini/antigravity-cli")).unwrap();

        // Existing Antigravity statusLine is preserved and chained.
        let agy_settings = home.join(".gemini/antigravity-cli/settings.json");
        fs::write(
            &agy_settings,
            serde_json::to_string_pretty(&json!({
                "model": "Gemini",
                "statusLine": { "type": "command", "command": "~/.gemini/antigravity-cli/statusline.py" }
            }))
            .unwrap(),
        )
        .unwrap();

        let state = set_statusline(&config, &home, &mcp, AiKind::Antigravity, true).unwrap();
        assert_eq!(
            state,
            AiStatuslineState {
                claude: false,
                antigravity: true
            }
        );

        let wrap = config.join("statusline/antigravity-wrap.sh");
        let script = fs::read_to_string(&wrap).unwrap();
        assert!(script.contains("--statusline-cache antigravity"));
        assert!(script.contains("~/.gemini/antigravity-cli/statusline.py"));

        // Re-enabling is idempotent and keeps the original previous command.
        set_statusline(&config, &home, &mcp, AiKind::Antigravity, true).unwrap();
        let script2 = fs::read_to_string(&wrap).unwrap();
        assert!(script2.contains("~/.gemini/antigravity-cli/statusline.py"));

        // Disabling restores the original statusLine.
        let state = set_statusline(&config, &home, &mcp, AiKind::Antigravity, false).unwrap();
        assert!(!state.antigravity);
        let restored: Value =
            serde_json::from_str(&fs::read_to_string(&agy_settings).unwrap()).unwrap();
        assert_eq!(
            restored["statusLine"]["command"],
            "~/.gemini/antigravity-cli/statusline.py"
        );
        assert!(!wrap.exists());

        // When no settings.json existed before (Claude), enabling creates it and disabling removes statusLine.
        let state = set_statusline(&config, &home, &mcp, AiKind::Claude, true).unwrap();
        assert!(state.claude);
        let claude_settings = home.join(".claude/settings.json");
        let after_on: Value =
            serde_json::from_str(&fs::read_to_string(&claude_settings).unwrap()).unwrap();
        assert_eq!(
            after_on["statusLine"]["command"],
            config
                .join("statusline/claude-wrap.sh")
                .to_string_lossy()
                .as_ref()
        );

        let state = set_statusline(&config, &home, &mcp, AiKind::Claude, false).unwrap();
        assert!(!state.claude);
        let after_off: Value =
            serde_json::from_str(&fs::read_to_string(&claude_settings).unwrap()).unwrap();
        assert!(after_off.get("statusLine").is_none());

        fs::remove_dir_all(&dir).unwrap();
    }
}
