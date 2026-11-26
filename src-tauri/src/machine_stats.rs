//! #1455 (a part of #1454, A-48): the load of the machines and the usage of the AI, read from Orca's runtime. This Mac and each saved environment (the paired PC) are asked over `orca_link::Connection`: `diagnostics.memory` for the CPU and the memory, `accounts.list` for the rate limits of Claude and Antigravity. Only reads, and nothing is saved.
//! It is not a public interface of Orca: the fields were read in the `app.asar` of Orca 1.4.274 and the calls were tried on this Mac and on a paired PC (`requirements/constraints.md`, Orca). No token and no account (its email or id) is in a return value, an error text or a log line.

use std::{future::Future, time::Duration};

use futures_util::future::join_all;
use serde::Serialize;
use serde_json::{json, Value};
use tokio::time::timeout;
#[cfg(test)]
use ts_rs::TS;

use crate::{
    orca_attach::Rpc,
    orca_link::{environment_names, Connection},
};

/// How long one machine has to answer `diagnostics.memory` (it answered in 0.4 seconds on this Mac).
const RESOURCES_TIMEOUT: Duration = Duration::from_secs(5);
/// How long one machine has to answer `accounts.list`: with `refreshStaleUsage` Orca may fetch the rate limits again before it answers, so it is the time of a request of `orca_link` (15 seconds).
const USAGE_TIMEOUT: Duration = Duration::from_secs(15);
/// The name of this Mac in a row (it is no saved environment, so its `environment` is none).
const THIS_MAC: &str = "この Mac";
const RESOURCES_NOT_READ: &str = "Orca のマシンの負荷を読めません";
const USAGE_NOT_READ: &str = "Orca の AI の利用率を読めません";
/// The status of an AI that Orca gave no entry for, or of a machine that did not answer.
const UNAVAILABLE: &str = "unavailable";

/// The load of one machine. A value that Orca did not give, or gave in a form that is not read, is none, and `error` says why the machine gave nothing (Orca's code, never its message). `cpu_percent` is the load average of a minute divided by the cores, in percent (it can pass 100), and `memory_percent` is Orca's own figure; both are rounded.
#[derive(Serialize, Clone, Debug, PartialEq)]
#[cfg_attr(test, derive(TS))]
#[cfg_attr(test, ts(export, export_to = crate::BINDINGS))]
#[serde(rename_all = "camelCase")]
pub struct MachineResources {
    /// The saved environment's name; none for this Mac.
    pub environment: Option<String>,
    pub name: String,
    pub cpu_percent: Option<u32>,
    pub load_average: Option<f64>,
    pub cores: Option<u32>,
    pub memory_percent: Option<u32>,
    #[cfg_attr(test, ts(type = "number | null"))]
    pub used_bytes: Option<u64>,
    #[cfg_attr(test, ts(type = "number | null"))]
    pub total_bytes: Option<u64>,
    pub error: Option<String>,
}

/// One window of a rate limit: the share used (rounded, in percent) and when it resets (milliseconds since the epoch, none when Orca gave none).
#[derive(Serialize, Clone, Debug, PartialEq)]
#[cfg_attr(test, derive(TS))]
#[cfg_attr(test, ts(export, export_to = crate::BINDINGS))]
#[serde(rename_all = "camelCase")]
pub struct UsageWindow {
    pub used_percent: u32,
    #[cfg_attr(test, ts(type = "number | null"))]
    pub resets_at: Option<i64>,
}

/// The rate limit of one AI. `status` is Orca's (`ok`, `idle`, `error` and so on), or `unavailable` when Orca gave no entry or the machine did not answer. `session` is the window of 5 hours and `weekly` the window of a week.
#[derive(Serialize, Clone, Debug, PartialEq)]
#[cfg_attr(test, derive(TS))]
#[cfg_attr(test, ts(export, export_to = crate::BINDINGS))]
#[serde(rename_all = "camelCase")]
pub struct AiUsage {
    pub status: String,
    pub session: Option<UsageWindow>,
    pub weekly: Option<UsageWindow>,
}

impl AiUsage {
    fn unavailable() -> Self {
        Self {
            status: UNAVAILABLE.to_owned(),
            session: None,
            weekly: None,
        }
    }
}

/// The usage of the AI of one machine. The account that it belongs to is not returned.
#[derive(Serialize, Clone, Debug, PartialEq)]
#[cfg_attr(test, derive(TS))]
#[cfg_attr(test, ts(export, export_to = crate::BINDINGS))]
#[serde(rename_all = "camelCase")]
pub struct MachineUsage {
    pub environment: Option<String>,
    pub name: String,
    pub claude: AiUsage,
    pub antigravity: AiUsage,
}

/// A machine to ask: this Mac (no environment) or a saved environment.
#[derive(Debug, PartialEq)]
struct Target {
    environment: Option<String>,
    name: String,
}

/// This Mac first, then the saved environments in the order of `orca-environments.json`.
fn targets(saved: Vec<String>) -> Vec<Target> {
    std::iter::once(Target {
        environment: None,
        name: THIS_MAC.to_owned(),
    })
    .chain(saved.into_iter().map(|name| Target {
        environment: Some(name.clone()),
        name,
    }))
    .collect()
}

/// The machines now. A file of environments that cannot be read leaves this Mac alone.
async fn targets_now() -> Vec<Target> {
    let saved = tokio::task::spawn_blocking(environment_names)
        .await
        .ok()
        .and_then(Result::ok)
        .unwrap_or_default();
    targets(saved)
}

/// A rounded percent: none for a value that is not a number or is below 0.
fn percent(value: &Value) -> Option<u32> {
    value
        .as_f64()
        .filter(|v| v.is_finite() && *v >= 0.0)
        .map(|v| v.round() as u32)
}

fn bytes(value: &Value) -> Option<u64> {
    value
        .as_f64()
        .filter(|v| v.is_finite() && *v >= 0.0)
        .map(|v| v.round() as u64)
}

/// What `diagnostics.memory` gives of a host, read.
#[derive(Debug, Default, PartialEq)]
struct Host {
    cpu_percent: Option<u32>,
    load_average: Option<f64>,
    cores: Option<u32>,
    memory_percent: Option<u32>,
    used_bytes: Option<u64>,
    total_bytes: Option<u64>,
}

/// The answer of `diagnostics.memory`: its `host` has `cpuCoreCount`, `loadAverage1m`, `memoryUsagePercent`, `usedMemory` and `totalMemory`. Orca gives no CPU use of the whole machine, so it is the load of a minute per core. An answer with no `host` is unreadable.
fn parse_resources(answer: &Value) -> Result<Host, String> {
    let host = &answer["host"];
    if !host.is_object() {
        return Err(RESOURCES_NOT_READ.into());
    }
    let cores = host["cpuCoreCount"]
        .as_u64()
        .filter(|c| *c > 0)
        .and_then(|c| u32::try_from(c).ok());
    let load_average = host["loadAverage1m"]
        .as_f64()
        .filter(|l| l.is_finite() && *l >= 0.0);
    let cpu_percent = cores
        .zip(load_average)
        .and_then(|(cores, load)| percent(&json!(load / f64::from(cores) * 100.0)));
    Ok(Host {
        cpu_percent,
        load_average,
        cores,
        memory_percent: percent(&host["memoryUsagePercent"]),
        used_bytes: bytes(&host["usedMemory"]),
        total_bytes: bytes(&host["totalMemory"]),
    })
}

/// One window (`session` or `weekly`) of a rate limit: it needs a `usedPercent` that is a number.
fn usage_window(window: &Value) -> Option<UsageWindow> {
    Some(UsageWindow {
        used_percent: percent(&window["usedPercent"])?,
        resets_at: window["resetsAt"]
            .as_f64()
            .filter(|v| v.is_finite())
            .map(|v| v.round() as i64),
    })
}

/// The entry of one AI in `rateLimits`: its `status` and its two windows. An entry that is no object is `unavailable`.
fn ai_usage(entry: &Value) -> AiUsage {
    if !entry.is_object() {
        return AiUsage::unavailable();
    }
    AiUsage {
        status: entry["status"].as_str().unwrap_or(UNAVAILABLE).to_owned(),
        session: usage_window(&entry["session"]),
        weekly: usage_window(&entry["weekly"]),
    }
}

/// The answer of `accounts.list`: only its `rateLimits.claude` and `rateLimits.antigravity` are read, so the accounts it lists never leave. An answer with no `rateLimits` is unreadable.
fn parse_usage(answer: &Value) -> Result<(AiUsage, AiUsage), String> {
    let limits = &answer["rateLimits"];
    if !limits.is_object() {
        return Err(USAGE_NOT_READ.into());
    }
    Ok((
        ai_usage(&limits["claude"]),
        ai_usage(&limits["antigravity"]),
    ))
}

/// `diagnostics.memory` of the machine `rpc` talks to.
async fn read_resources(rpc: &mut impl Rpc) -> Result<Host, String> {
    let answer = rpc
        .call("diagnostics.memory", json!({}))
        .await
        .map_err(|e| e.shown)?;
    parse_resources(&answer)
}

/// `accounts.list` of the machine `rpc` talks to. `refreshStaleUsage` makes Orca fetch the rate limits again only when they are 5 minutes old; `refreshUsage` (every time) is not used, because the place Orca fetches Claude's from limits how often it may be asked.
async fn read_usage(rpc: &mut impl Rpc) -> Result<(AiUsage, AiUsage), String> {
    let answer = rpc
        .call("accounts.list", json!({"refreshStaleUsage": true}))
        .await
        .map_err(|e| e.shown)?;
    parse_usage(&answer)
}

/// `read` within `limit`, or the message that the machine did not answer.
async fn within<T>(
    limit: Duration,
    read: impl Future<Output = Result<T, String>>,
) -> Result<T, String> {
    timeout(limit, read)
        .await
        .unwrap_or_else(|_| Err(format!("{} 秒以内に答えがありません", limit.as_secs())))
}

fn resources_row(target: Target, read: Result<Host, String>) -> MachineResources {
    let (host, error) = match read {
        Ok(host) => (host, None),
        Err(message) => (Host::default(), Some(message)),
    };
    MachineResources {
        environment: target.environment,
        name: target.name,
        cpu_percent: host.cpu_percent,
        load_average: host.load_average,
        cores: host.cores,
        memory_percent: host.memory_percent,
        used_bytes: host.used_bytes,
        total_bytes: host.total_bytes,
        error,
    }
}

/// A machine that did not answer has no usage: both AI are `unavailable`.
fn usage_row(target: Target, read: Result<(AiUsage, AiUsage), String>) -> MachineUsage {
    let (claude, antigravity) =
        read.unwrap_or_else(|_| (AiUsage::unavailable(), AiUsage::unavailable()));
    MachineUsage {
        environment: target.environment,
        name: target.name,
        claude,
        antigravity,
    }
}

/// A-48: the CPU and the memory of this Mac and of each saved environment, asked at the same time (a machine that fails or is silent for 5 seconds has its `error` and the others are returned). Only reads.
#[tauri::command]
pub async fn machine_resources() -> Vec<MachineResources> {
    join_all(targets_now().await.into_iter().map(|target| async move {
        let read = within(RESOURCES_TIMEOUT, async {
            let mut connection = Connection::open(target.environment.clone()).await?;
            read_resources(&mut connection).await
        })
        .await;
        resources_row(target, read)
    }))
    .await
}

/// A-48: the rate limits of Claude and Antigravity on this Mac and on each saved environment, as Orca holds them (it takes them again after 5 minutes, so a number changes at most that often). Only reads.
#[tauri::command]
pub async fn machine_usage() -> Vec<MachineUsage> {
    join_all(targets_now().await.into_iter().map(|target| async move {
        let read = within(USAGE_TIMEOUT, async {
            let mut connection = Connection::open(target.environment.clone()).await?;
            read_usage(&mut connection).await
        })
        .await;
        usage_row(target, read)
    }))
    .await
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::orca_link::CallError;

    /// Orca's side of the call: the calls it was given, and its answer.
    struct Fake {
        calls: Vec<(String, Value)>,
        answer: Result<Value, CallError>,
    }

    impl Rpc for Fake {
        async fn call(&mut self, method: &str, params: Value) -> Result<Value, CallError> {
            self.calls.push((method.to_owned(), params));
            match &self.answer {
                Ok(v) => Ok(v.clone()),
                Err(e) => Err(CallError {
                    shown: e.shown.clone(),
                    detail: e.detail.clone(),
                }),
            }
        }
    }

    fn fake(answer: Result<Value, CallError>) -> Fake {
        Fake {
            calls: Vec::new(),
            answer,
        }
    }

    /// The host of this Mac as Orca 1.4.274 answered (12 cores, a load of 9.23, 10% of 64 GB).
    fn mac_memory() -> Value {
        json!({"host": {
            "totalMemory": 68_719_476_736_u64,
            "usedMemory": 6_871_947_674_u64,
            "memoryUsagePercent": 10,
            "cpuCoreCount": 12,
            "loadAverage1m": 9.23,
        }})
    }

    fn target(environment: Option<&str>, name: &str) -> Target {
        Target {
            environment: environment.map(str::to_owned),
            name: name.to_owned(),
        }
    }

    #[test]
    fn the_cpu_is_the_load_of_a_minute_per_core_in_percent() {
        let host = parse_resources(&mac_memory()).unwrap();
        assert_eq!(host.cpu_percent, Some(77));
        assert_eq!(host.load_average, Some(9.23));
        assert_eq!(host.cores, Some(12));
        assert_eq!(host.memory_percent, Some(10));
        assert_eq!(host.used_bytes, Some(6_871_947_674));
        assert_eq!(host.total_bytes, Some(68_719_476_736));
        // A paired PC: 18 cores, a load of 1.56 and 11%.
        let pc = parse_resources(&json!({"host": {
            "cpuCoreCount": 18, "loadAverage1m": 1.56, "memoryUsagePercent": 11,
        }}))
        .unwrap();
        assert_eq!((pc.cpu_percent, pc.memory_percent), (Some(9), Some(11)));
    }

    #[test]
    fn the_cpu_can_pass_a_hundred_and_the_memory_is_rounded() {
        let host = parse_resources(&json!({"host": {
            "cpuCoreCount": 4, "loadAverage1m": 6.1, "memoryUsagePercent": 49.5,
        }}))
        .unwrap();
        assert_eq!(host.cpu_percent, Some(153));
        assert_eq!(host.memory_percent, Some(50));
    }

    #[test]
    fn a_figure_that_is_not_usable_is_none_and_the_rest_is_kept() {
        // No core, so no CPU: the memory is still read.
        let host = parse_resources(&json!({"host": {
            "cpuCoreCount": 0, "loadAverage1m": 1.0, "memoryUsagePercent": 30,
        }}))
        .unwrap();
        assert_eq!(host.cpu_percent, None);
        assert_eq!(host.cores, None);
        assert_eq!(host.memory_percent, Some(30));
        // A negative or text figure is none; an answer with no load has no CPU.
        let host = parse_resources(&json!({"host": {
            "cpuCoreCount": 8, "loadAverage1m": "high", "memoryUsagePercent": -1,
            "usedMemory": null, "totalMemory": "x",
        }}))
        .unwrap();
        assert_eq!(
            host,
            Host {
                cores: Some(8),
                ..Host::default()
            }
        );
    }

    #[test]
    fn an_answer_with_no_host_is_unreadable() {
        for answer in [
            Value::Null,
            json!({}),
            json!({"host": null}),
            json!({"host": 3}),
        ] {
            assert_eq!(parse_resources(&answer), Err(RESOURCES_NOT_READ.to_owned()));
        }
    }

    /// The two machines of #1454 as Orca answered `accounts.list`, with an account on each (which never leaves).
    fn mac_accounts() -> Value {
        json!({
            "accounts": [{"id": "acc-1", "email": "someone@example.com"}],
            "rateLimits": {
                "claude": {"status": "ok",
                    "session": {"usedPercent": 31.2, "resetsAt": 1_790_000_000_000_u64, "windowMinutes": 300},
                    "weekly": {"usedPercent": 74, "resetsAt": 1_790_400_000_000_u64, "windowMinutes": 10080}},
                "antigravity": {"status": "idle", "session": null, "weekly": null},
            },
        })
    }

    #[test]
    fn the_windows_of_each_ai_are_read_with_their_status() {
        let (claude, antigravity) = parse_usage(&mac_accounts()).unwrap();
        assert_eq!(claude.status, "ok");
        assert_eq!(
            claude.session,
            Some(UsageWindow {
                used_percent: 31,
                resets_at: Some(1_790_000_000_000)
            })
        );
        assert_eq!(
            claude.weekly,
            Some(UsageWindow {
                used_percent: 74,
                resets_at: Some(1_790_400_000_000)
            })
        );
        assert_eq!(
            antigravity,
            AiUsage {
                status: "idle".into(),
                session: None,
                weekly: None
            }
        );
        // The paired PC: Claude failed, Antigravity is in use.
        let (claude, antigravity) = parse_usage(&json!({"rateLimits": {
            "claude": {"status": "error", "failureKind": "stale-token"},
            "antigravity": {"status": "ok",
                "session": {"usedPercent": 46, "resetsAt": 1_790_001_000_000_u64},
                "weekly": {"usedPercent": 93}},
        }}))
        .unwrap();
        assert_eq!(claude.status, "error");
        assert_eq!((claude.session, claude.weekly), (None, None));
        assert_eq!(antigravity.session.unwrap().used_percent, 46);
        let weekly = antigravity.weekly.unwrap();
        assert_eq!((weekly.used_percent, weekly.resets_at), (93, None));
    }

    #[test]
    fn an_ai_without_an_entry_is_unavailable_and_no_rate_limits_is_unreadable() {
        let (claude, antigravity) = parse_usage(&json!({"rateLimits": {"claude": 1}})).unwrap();
        assert_eq!(claude, AiUsage::unavailable());
        assert_eq!(antigravity, AiUsage::unavailable());
        for answer in [
            Value::Null,
            json!({"accounts": []}),
            json!({"rateLimits": []}),
        ] {
            assert_eq!(parse_usage(&answer), Err(USAGE_NOT_READ.to_owned()));
        }
        // A window with no figure is no window.
        assert_eq!(usage_window(&json!({"resetsAt": 5})), None);
        assert_eq!(usage_window(&json!({"usedPercent": "5"})), None);
    }

    #[test]
    fn the_account_of_an_answer_is_in_no_return_value() {
        let (claude, antigravity) = parse_usage(&mac_accounts()).unwrap();
        let text = serde_json::to_string(&usage_row(
            target(None, THIS_MAC),
            Ok((claude, antigravity)),
        ))
        .unwrap();
        assert!(!text.contains("someone@example.com"));
        assert!(!text.contains("acc-1"));
    }

    #[tokio::test]
    async fn the_load_is_asked_with_diagnostics_memory_and_no_parameter() {
        let mut rpc = fake(Ok(mac_memory()));
        assert!(read_resources(&mut rpc).await.is_ok());
        assert_eq!(rpc.calls, [("diagnostics.memory".to_owned(), json!({}))]);
    }

    #[tokio::test]
    async fn the_usage_is_asked_with_refresh_stale_usage_and_never_refresh_usage() {
        let mut rpc = fake(Ok(mac_accounts()));
        assert!(read_usage(&mut rpc).await.is_ok());
        assert_eq!(
            rpc.calls,
            [(
                "accounts.list".to_owned(),
                json!({"refreshStaleUsage": true})
            )]
        );
        assert!(rpc.calls[0].1.get("refreshUsage").is_none());
    }

    #[tokio::test]
    async fn a_failed_call_is_the_code_orca_gave_and_never_its_message() {
        let failed = || {
            Err(CallError {
                shown: "Orca のエラー（unauthorized）".into(),
                detail: "secret message".into(),
            })
        };
        let error = read_resources(&mut fake(failed())).await.unwrap_err();
        assert_eq!(error, "Orca のエラー（unauthorized）");
        let error = read_usage(&mut fake(failed())).await.unwrap_err();
        assert!(!error.contains("secret"));
    }

    #[test]
    fn this_mac_comes_first_and_has_no_environment() {
        assert_eq!(
            targets(vec!["studio".into(), "lab".into()]),
            [
                target(None, THIS_MAC),
                target(Some("studio"), "studio"),
                target(Some("lab"), "lab"),
            ]
        );
        assert_eq!(targets(Vec::new()), [target(None, THIS_MAC)]);
    }

    #[test]
    fn a_machine_that_fails_has_an_error_and_no_figure() {
        let ok = resources_row(
            target(Some("studio"), "studio"),
            parse_resources(&mac_memory()),
        );
        assert_eq!(ok.environment.as_deref(), Some("studio"));
        assert_eq!((ok.cpu_percent, ok.error), (Some(77), None));
        let failed = resources_row(
            target(None, THIS_MAC),
            Err("Orca が起動していません".into()),
        );
        assert_eq!(
            failed,
            MachineResources {
                environment: None,
                name: THIS_MAC.into(),
                cpu_percent: None,
                load_average: None,
                cores: None,
                memory_percent: None,
                used_bytes: None,
                total_bytes: None,
                error: Some("Orca が起動していません".into()),
            }
        );
        let row = usage_row(target(None, THIS_MAC), Err("x".into()));
        assert_eq!(row.claude, AiUsage::unavailable());
        assert_eq!(row.antigravity, AiUsage::unavailable());
    }

    #[tokio::test(start_paused = true)]
    async fn a_silent_machine_is_given_up_after_the_limit() {
        let silent = within(RESOURCES_TIMEOUT, async {
            std::future::pending::<()>().await;
            Ok::<u8, String>(1)
        })
        .await;
        assert_eq!(silent, Err("5 秒以内に答えがありません".to_owned()));
        let quick = within(RESOURCES_TIMEOUT, async { Ok::<u8, String>(1) }).await;
        assert_eq!(quick, Ok(1));
    }
}
