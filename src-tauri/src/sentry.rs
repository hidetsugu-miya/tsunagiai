//! The Sentry connection of a Slack workspace (S-29, #1447, a part of #1444): a Personal Token of Sentry for each connected workspace, kept in the OS keychain (service `TOKEN_SERVICE`, user name the workspace's `team_id`), and the list of the workspaces that have one in `sentry-connections.json` of the app config directory (team IDs only).
//! A token is never shown, logged, written to a file or returned: the screen gets the last four characters (`SentryConnection::tail`) to tell one from another.
//! It goes to `https://sentry.io/api/0` alone, as a Bearer credential, with a timeout and no redirect followed. A token is kept only once Sentry accepts it (`GET /organizations/`).
//! Removing the Slack workspace removes its Sentry token with it (`forget_workspace`, called by `slack_remove_workspace`).

use std::{path::Path, time::Duration};

use reqwest::header::{HeaderValue, AUTHORIZATION};
use serde::{Deserialize, Serialize};
use tauri::{AppHandle, State};
#[cfg(test)]
use ts_rs::TS;

use crate::{
    accounts::write_atomic,
    auth::config_dir,
    gmail::log_failure,
    keychain,
    slack::{blocking, has_workspace, token_key, SlackState},
};

const TOKEN_SERVICE: &str = "jp.mysis.tsunagiai.sentry";
const FILE: &str = "sentry-connections.json";
/// Every request goes here and nowhere else: nothing from outside is put into the URL.
const API_URL: &str = "https://sentry.io/api/0";
const TIMEOUT: Duration = Duration::from_secs(15);
const BAD_TOKEN: &str = "トークンが正しくありません";
const EMPTY_TOKEN: &str = "トークンを入力してください";
const NO_SCOPE: &str = "トークンの権限が足りません。org:read のスコープを足してください";
const NO_SUCH_WORKSPACE: &str = "このワークスペースは接続されていません";

/// A workspace that has a Sentry token, and the last four characters of the token.
#[derive(Serialize, Debug, PartialEq, Clone)]
#[cfg_attr(test, derive(TS))]
#[cfg_attr(test, ts(export, export_to = crate::BINDINGS))]
#[serde(rename_all = "camelCase")]
pub struct SentryConnection {
    team_id: String,
    tail: String,
}

/// The workspaces that have a token, in the order they were added.
#[derive(Serialize, Deserialize, Default)]
struct ConnectionsFile {
    teams: Vec<String>,
}

fn load(dir: &Path) -> Result<Vec<String>, String> {
    let path = dir.join(FILE);
    match std::fs::read_to_string(&path) {
        Ok(text) => serde_json::from_str::<ConnectionsFile>(&text)
            .map(|f| f.teams)
            .map_err(|e| format!("{} の形式が不正です: {e}", path.display())),
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(vec![]),
        Err(e) => Err(format!("{} を読めません: {e}", path.display())),
    }
}

fn save(dir: &Path, teams: Vec<String>) -> Result<(), String> {
    let text =
        serde_json::to_string_pretty(&ConnectionsFile { teams }).map_err(|e| e.to_string())?;
    write_atomic(dir, FILE, &text)
}

/// Adds `team_id` unless it is listed.
fn with_team(mut teams: Vec<String>, team_id: &str) -> Vec<String> {
    if !teams.iter().any(|t| t == team_id) {
        teams.push(team_id.to_owned());
    }
    teams
}

fn without_team(teams: Vec<String>, team_id: &str) -> Vec<String> {
    teams.into_iter().filter(|t| t != team_id).collect()
}

/// A token as it can be sent: not empty, and printable ASCII only (no space, and no line break that could end the header).
fn valid_token(token: &str) -> bool {
    !token.is_empty() && token.chars().all(|c| c.is_ascii_graphic())
}

/// The last four characters of the token (all of it when it is shorter).
fn tail_of(token: &str) -> String {
    let chars: Vec<char> = token.chars().collect();
    chars[chars.len().saturating_sub(4)..].iter().collect()
}

/// What an answer of `GET /organizations/` says about the token.
fn verdict(status: u16) -> Result<(), String> {
    match status {
        200..=299 => Ok(()),
        401 => Err(BAD_TOKEN.into()),
        403 => Err(NO_SCOPE.into()),
        _ => Err(format!("Sentry に確かめられません（{status}）")),
    }
}

fn client() -> Result<reqwest::Client, String> {
    reqwest::Client::builder()
        .redirect(reqwest::redirect::Policy::none())
        .timeout(TIMEOUT)
        .build()
        .map_err(|e| e.to_string())
}

/// Asks Sentry (`base` is `API_URL`, a local port in the tests) whether it accepts the token.
async fn check_token(http: &reqwest::Client, base: &str, token: &str) -> Result<(), String> {
    let mut header =
        HeaderValue::from_str(&format!("Bearer {token}")).map_err(|_| BAD_TOKEN.to_owned())?;
    header.set_sensitive(true);
    let answer = http
        .get(format!("{base}/organizations/"))
        .header(AUTHORIZATION, header)
        .send()
        .await
        .map_err(|e| format!("Sentry に接続できません（{}）", e.without_url()))?;
    verdict(answer.status().as_u16())
}

async fn read_secret(team_id: String) -> Result<Option<String>, String> {
    blocking(move || keychain::read(TOKEN_SERVICE, &team_id)).await
}

async fn write_secret(team_id: String, token: String) -> Result<(), String> {
    blocking(move || keychain::write(TOKEN_SERVICE, &team_id, &token)).await
}

async fn delete_secret(team_id: String) -> Result<(), String> {
    blocking(move || keychain::delete(TOKEN_SERVICE, &team_id)).await
}

/// The workspaces of the file that have a token in the keychain. A listed workspace with no token (it was deleted by hand) is left out.
/// The caller holds the lock of `SlackState::files`.
async fn connections(dir: &Path) -> Result<Vec<SentryConnection>, String> {
    let dir = dir.to_owned();
    let teams = blocking(move || load(&dir)).await?;
    let mut list = vec![];
    for team_id in teams {
        if let Some(token) = read_secret(team_id.clone()).await? {
            list.push(SentryConnection {
                tail: tail_of(&token),
                team_id,
            });
        }
    }
    Ok(list)
}

/// Deletes the workspace's token and its entry. A failure is logged, not returned: the workspace is gone already, and a token left behind is not worth failing for.
/// The caller holds the lock of `SlackState::files`.
pub(crate) async fn forget_workspace(app: &AppHandle, team_id: &str) {
    let command = "sentry_forget";
    if let Err(e) = delete_secret(team_id.to_owned()).await {
        log_failure(command, team_id, e);
    }
    let Ok(dir) = config_dir(app) else {
        return;
    };
    let gone = team_id.to_owned();
    let saved = blocking(move || load(&dir).and_then(|t| save(&dir, without_team(t, &gone)))).await;
    if let Err(e) = saved {
        log_failure(command, team_id, e);
    }
}

/// The workspaces that have a Sentry token, with the last four characters of each. Asks Sentry nothing.
#[tauri::command]
pub async fn sentry_connections(
    app: AppHandle,
    state: State<'_, SlackState>,
) -> Result<Vec<SentryConnection>, String> {
    let command = "sentry_connections";
    let dir = config_dir(&app)?;
    let _files = state.files.lock().await;
    connections(&dir)
        .await
        .map_err(|e| log_failure(command, "-", e))
}

/// Keeps the token of a connected workspace once Sentry accepts it, and replaces one kept already. The token is never logged or returned. Answers the connections.
#[tauri::command]
pub async fn sentry_save(
    app: AppHandle,
    state: State<'_, SlackState>,
    team_id: String,
    token: String,
) -> Result<Vec<SentryConnection>, String> {
    let command = "sentry_save";
    let token = token.trim().to_owned();
    if token.is_empty() {
        return Err(EMPTY_TOKEN.into());
    }
    if !valid_token(&token) {
        return Err(BAD_TOKEN.into());
    }
    let team = token_key(&team_id).map_err(|e| log_failure(command, &team_id, e))?;
    let dir = config_dir(&app)?;
    let http = client().map_err(|e| log_failure(command, &team_id, e))?;
    // The check is made before the lock, so that a slow answer does not hold up the Slack commands.
    check_token(&http, API_URL, &token)
        .await
        .map_err(|e| log_failure(command, &team_id, e))?;
    let _files = state.files.lock().await;
    if !has_workspace(&dir, &team)
        .await
        .map_err(|e| log_failure(command, &team_id, e))?
    {
        return Err(NO_SUCH_WORKSPACE.into());
    }
    write_secret(team.clone(), token)
        .await
        .map_err(|e| log_failure(command, &team_id, e))?;
    let saved = {
        let dir = dir.clone();
        blocking(move || load(&dir).and_then(|t| save(&dir, with_team(t, &team)))).await
    };
    saved.map_err(|e| log_failure(command, &team_id, e))?;
    connections(&dir)
        .await
        .map_err(|e| log_failure(command, &team_id, e))
}

/// Deletes the workspace's token and its entry. Answers the connections.
#[tauri::command]
pub async fn sentry_delete(
    app: AppHandle,
    state: State<'_, SlackState>,
    team_id: String,
) -> Result<Vec<SentryConnection>, String> {
    let command = "sentry_delete";
    let team = token_key(&team_id).map_err(|e| log_failure(command, &team_id, e))?;
    let dir = config_dir(&app)?;
    let _files = state.files.lock().await;
    delete_secret(team.clone())
        .await
        .map_err(|e| log_failure(command, &team_id, e))?;
    let saved = {
        let dir = dir.clone();
        blocking(move || load(&dir).and_then(|t| save(&dir, without_team(t, &team)))).await
    };
    saved.map_err(|e| log_failure(command, &team_id, e))?;
    connections(&dir)
        .await
        .map_err(|e| log_failure(command, &team_id, e))
}

#[cfg(test)]
mod tests {
    use super::*;
    use tokio::{
        io::{AsyncReadExt, AsyncWriteExt},
        net::TcpListener,
    };

    fn temp_dir(name: &str) -> std::path::PathBuf {
        let dir = std::env::temp_dir().join(format!(
            "tsunagiai-test-{}-sentry-{name}",
            std::process::id()
        ));
        let _ = std::fs::remove_dir_all(&dir);
        dir
    }

    fn teams(list: &[&str]) -> Vec<String> {
        list.iter().map(|t| (*t).to_owned()).collect()
    }

    #[test]
    fn a_workspace_is_listed_once_and_taken_off_alone() {
        let list = with_team(with_team(teams(&["T1"]), "T2"), "T1");
        assert_eq!(list, teams(&["T1", "T2"]));
        assert_eq!(without_team(list.clone(), "T1"), teams(&["T2"]));
        assert_eq!(without_team(list.clone(), "T9"), list);
    }

    #[test]
    fn the_list_is_saved_and_read_back_and_a_missing_file_is_empty() {
        let dir = temp_dir("file");
        assert_eq!(load(&dir), Ok(vec![]));
        save(&dir, teams(&["T1", "T2"])).unwrap();
        assert_eq!(load(&dir), Ok(teams(&["T1", "T2"])));
        std::fs::write(dir.join(FILE), "[]").unwrap();
        assert!(load(&dir).is_err());
        std::fs::remove_dir_all(&dir).unwrap();
    }

    #[test]
    fn the_file_holds_team_ids_and_no_token() {
        let dir = temp_dir("shape");
        save(&dir, teams(&["T1"])).unwrap();
        let text = std::fs::read_to_string(dir.join(FILE)).unwrap();
        assert_eq!(
            serde_json::from_str::<serde_json::Value>(&text).unwrap(),
            serde_json::json!({"teams": ["T1"]})
        );
        std::fs::remove_dir_all(&dir).unwrap();
    }

    #[test]
    fn a_token_is_printable_ascii_with_no_space() {
        assert!(valid_token("sntryu_0123abcd"));
        for bad in ["", "a b", "a\r\nX: y", "トークン", "a\tb"] {
            assert!(!valid_token(bad), "{bad:?}");
        }
    }

    #[test]
    fn the_tail_is_the_last_four_characters() {
        assert_eq!(tail_of("sntryu_0123abcd"), "abcd");
        assert_eq!(tail_of("abc"), "abc");
        assert_eq!(tail_of(""), "");
        assert_eq!(tail_of("あいうえお"), "いうえお");
    }

    #[test]
    fn a_status_is_a_verdict_on_the_token() {
        assert_eq!(verdict(200), Ok(()));
        assert_eq!(verdict(401), Err(BAD_TOKEN.into()));
        assert_eq!(verdict(403), Err(NO_SCOPE.into()));
        assert_eq!(verdict(500), Err("Sentry に確かめられません（500）".into()));
    }

    /// Serves one answer on a local port, and returns the base URL and what the request said.
    async fn serve_once(answer: &'static str) -> (String, tokio::task::JoinHandle<String>) {
        let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
        let base = format!("http://{}", listener.local_addr().unwrap());
        let seen = tokio::spawn(async move {
            let (mut socket, _) = listener.accept().await.unwrap();
            let mut request = Vec::new();
            let mut buf = [0u8; 1024];
            while !request.windows(4).any(|w| w == b"\r\n\r\n") {
                let n = socket.read(&mut buf).await.unwrap();
                if n == 0 {
                    break;
                }
                request.extend_from_slice(&buf[..n]);
            }
            socket.write_all(answer.as_bytes()).await.unwrap();
            socket.shutdown().await.unwrap();
            String::from_utf8_lossy(&request).into_owned()
        });
        (base, seen)
    }

    const OK: &str = "HTTP/1.1 200 OK\r\nContent-Type: application/json\r\nContent-Length: 2\r\nConnection: close\r\n\r\n[]";
    const UNAUTHORIZED: &str =
        "HTTP/1.1 401 Unauthorized\r\nContent-Length: 0\r\nConnection: close\r\n\r\n";
    const FORBIDDEN: &str =
        "HTTP/1.1 403 Forbidden\r\nContent-Length: 0\r\nConnection: close\r\n\r\n";

    #[tokio::test]
    async fn the_token_is_sent_as_a_bearer_credential_to_the_organizations() {
        let (base, seen) = serve_once(OK).await;
        let http = client().unwrap();
        assert_eq!(check_token(&http, &base, "sntryu_abc").await, Ok(()));
        let request = seen.await.unwrap();
        assert!(
            request.starts_with("GET /organizations/ HTTP/1.1"),
            "{request}"
        );
        assert!(
            request
                .to_ascii_lowercase()
                .contains("authorization: bearer sntryu_abc"),
            "{request}"
        );
    }

    #[tokio::test]
    async fn a_token_that_sentry_refuses_is_not_accepted() {
        let http = client().unwrap();
        let (base, _seen) = serve_once(UNAUTHORIZED).await;
        assert_eq!(
            check_token(&http, &base, "sntryu_abc").await,
            Err(BAD_TOKEN.into())
        );
        let (base, _seen) = serve_once(FORBIDDEN).await;
        assert_eq!(
            check_token(&http, &base, "sntryu_abc").await,
            Err(NO_SCOPE.into())
        );
    }

    #[tokio::test]
    async fn a_redirect_is_not_followed_and_is_not_accepted() {
        let http = client().unwrap();
        let (base, _seen) = serve_once(
            "HTTP/1.1 302 Found\r\nLocation: http://127.0.0.1:9/\r\nContent-Length: 0\r\nConnection: close\r\n\r\n",
        )
        .await;
        assert_eq!(
            check_token(&http, &base, "sntryu_abc").await,
            Err("Sentry に確かめられません（302）".into())
        );
    }

    #[tokio::test]
    async fn a_token_with_a_line_break_is_refused_before_anything_is_sent() {
        let http = client().unwrap();
        assert_eq!(
            check_token(&http, "http://127.0.0.1:9", "a\r\nX: y").await,
            Err(BAD_TOKEN.into())
        );
    }
}
