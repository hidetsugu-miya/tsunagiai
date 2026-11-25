//! The Sentry connection of a Slack workspace (S-29, #1447, a part of #1444): a Personal Token of Sentry for each connected workspace, kept in the OS keychain (service `TOKEN_SERVICE`, user name the workspace's `team_id`), and the list of the workspaces that have one in `sentry-connections.json` of the app config directory (team IDs only).
//! A token is never shown, logged, written to a file or returned: the screen gets the last four characters (`SentryConnection::tail`) to tell one from another.
//! It goes to `https://sentry.io/api/0` alone, as a Bearer credential, with a timeout and no redirect followed. A token is kept only once Sentry accepts it (`GET /organizations/`).
//! Removing the Slack workspace removes its Sentry token with it (`forget_workspace`, called by `slack_remove_workspace`).
//! The token is used to set the status of the issue of a Sentry notification (S-30, #1448): `sentry_set_status` sends one of a fixed list of values to `PUT /organizations/{org}/issues/{issue_id}/`, and `has_token` tells the thread whether the buttons can be pressed.
//! It also assigns the issue (S-30, #1449): `sentry_assignees` reads the teams and the members of the issue's project, and `sentry_assign` sends `user:{id}` or `team:{id}` as `assignedTo`.

use std::{path::Path, time::Duration};

use reqwest::header::{HeaderValue, AUTHORIZATION};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use tauri::{AppHandle, State};
#[cfg(test)]
use ts_rs::TS;

use crate::{
    accounts::write_atomic,
    auth::config_dir,
    gmail::log_failure,
    keychain,
    slack::{blocking, has_workspace, token_key, SlackState},
    slack_blocks::sentry_id,
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
const NO_TOKEN: &str = "このワークスペースには Sentry のトークンがありません";
const NO_WRITE: &str = "トークンの権限が足りません。event:write のスコープを足してください";
const NO_ISSUE: &str = "Sentry で issue が見つかりません";
const BAD_STATUS: &str = "Sentry への操作が正しくありません";
const NO_READ: &str =
    "トークンの権限が足りません。member:read、team:read、project:read のスコープを足してください";
const BAD_ANSWER: &str = "Sentry の答えを読めません";
const BAD_ASSIGNEE: &str = "担当者が正しくありません";
/// The values of Sentry's buttons (`webhooks/action.py`, `on_status`) that can be sent: nothing else goes to Sentry.
const STATUS_VALUES: [&str; 9] = [
    "resolved",
    "resolved:inNextRelease",
    "resolved:inCurrentRelease",
    "unresolved:ongoing",
    "ignored:archived_until_escalating",
    "ignored:archived_until_condition_met:10",
    "ignored:archived_until_condition_met:100",
    "ignored:archived_until_condition_met:1000",
    "ignored:archived_forever",
];

/// A team or a member that an issue can be assigned to: the name to show, and Sentry's own value for it (`team:{id}` or `user:{id}`).
#[derive(Serialize, Debug, PartialEq, Clone)]
#[cfg_attr(test, derive(TS))]
#[cfg_attr(test, ts(export, export_to = crate::BINDINGS))]
#[serde(rename_all = "camelCase")]
pub struct SentryAssignee {
    name: String,
    value: String,
}

/// The teams and the members of the project of an issue, as Sentry's own menu to assign has them.
#[derive(Serialize, Debug, PartialEq, Clone)]
#[cfg_attr(test, derive(TS))]
#[cfg_attr(test, ts(export, export_to = crate::BINDINGS))]
#[serde(rename_all = "camelCase")]
pub struct SentryAssignees {
    teams: Vec<SentryAssignee>,
    members: Vec<SentryAssignee>,
}

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

/// What an answer of `PUT /organizations/{org}/issues/{issue_id}/` says.
fn put_verdict(status: u16) -> Result<(), String> {
    match status {
        200..=299 => Ok(()),
        401 => Err(BAD_TOKEN.into()),
        403 => Err(NO_WRITE.into()),
        404 => Err(NO_ISSUE.into()),
        _ => Err(format!("Sentry に送れませんでした（{status}）")),
    }
}

/// The body that Sentry's own button of that value sends to update the issue (`on_status` of Sentry's Slack integration), or `None` for a value that is not in `STATUS_VALUES`.
fn status_body(value: &str) -> Option<Value> {
    if !STATUS_VALUES.contains(&value) {
        return None;
    }
    let data: Vec<&str> = value.splitn(3, ':').collect();
    let mut body = json!({ "status": data[0] });
    // The second part is the sub-status of an archived issue only.
    if data[0] == "ignored" {
        body["substatus"] = json!(data[1]);
        if data[1] == "archived_until_condition_met" {
            body["statusDetails"] = json!({ "ignoreCount": data[2].parse::<u32>().ok()? });
        }
    }
    match data[data.len() - 1] {
        "inNextRelease" => body["statusDetails"] = json!({ "inNextRelease": true }),
        "inCurrentRelease" => body["statusDetails"] = json!({ "inRelease": "latest" }),
        _ => {}
    }
    Some(body)
}

/// `team:{digits}` or `user:{digits}`: the only values of an assignee that are sent.
fn assignee_value(value: &str) -> bool {
    value.split_once(':').is_some_and(|(kind, id)| {
        matches!(kind, "team" | "user")
            && !id.is_empty()
            && id.len() <= 20
            && id.bytes().all(|b| b.is_ascii_digit())
    })
}

/// A project's slug as it goes into an address: letters, digits, hyphens and underscores.
fn project_slug(slug: &str) -> bool {
    !slug.is_empty()
        && slug.len() <= 100
        && slug
            .bytes()
            .all(|b| b.is_ascii_alphanumeric() || b == b'-' || b == b'_')
}

/// A Sentry ID as digits, from a string or a number.
fn digits_of(v: &Value) -> Option<String> {
    let id = match v {
        Value::String(s) => s.clone(),
        Value::Number(n) => n.to_string(),
        _ => return None,
    };
    (!id.is_empty() && id.len() <= 20 && id.bytes().all(|b| b.is_ascii_digit())).then_some(id)
}

/// The ID and the slug of the project that an issue (`GET /organizations/{org}/issues/{issue_id}/`) belongs to.
fn project_of(issue: &Value) -> Option<(String, String)> {
    let project = &issue["project"];
    let slug = project["slug"].as_str().filter(|s| project_slug(s))?;
    Some((digits_of(&project["id"])?, slug.to_owned()))
}

/// The first of the texts that is not blank.
fn first_text<'a>(texts: &[&'a Value]) -> Option<&'a str> {
    texts
        .iter()
        .filter_map(|v| v.as_str())
        .map(str::trim)
        .find(|s| !s.is_empty())
}

/// The teams (`GET /projects/{org}/{project_slug}/teams/`) and the members (`GET /organizations/{org}/users/?project={id}`) as the choices of the menu: a team is `#{slug}` with `team:{id}`, a member is its name (else the user's name, else the email address) with `user:{id of the user}`. An element with no usable ID is left out.
fn assignees_of(teams: &Value, users: &Value) -> SentryAssignees {
    let list = |v: &Value| v.as_array().cloned().unwrap_or_default();
    SentryAssignees {
        teams: list(teams)
            .iter()
            .filter_map(|t| {
                let slug = t["slug"].as_str().filter(|s| !s.trim().is_empty())?;
                Some(SentryAssignee {
                    name: format!("#{}", slug.trim()),
                    value: format!("team:{}", digits_of(&t["id"])?),
                })
            })
            .collect(),
        members: list(users)
            .iter()
            .filter_map(|m| {
                let user = &m["user"];
                let name = first_text(&[&m["name"], &user["name"], &m["email"], &user["email"]])?;
                Some(SentryAssignee {
                    name: name.to_owned(),
                    value: format!("user:{}", digits_of(&user["id"])?),
                })
            })
            .collect(),
    }
}

fn client() -> Result<reqwest::Client, String> {
    reqwest::Client::builder()
        .redirect(reqwest::redirect::Policy::none())
        .timeout(TIMEOUT)
        .build()
        .map_err(|e| e.to_string())
}

/// The `Authorization` header of a token, marked sensitive so that it is not written to a log.
fn bearer(token: &str) -> Result<HeaderValue, String> {
    let mut header =
        HeaderValue::from_str(&format!("Bearer {token}")).map_err(|_| BAD_TOKEN.to_owned())?;
    header.set_sensitive(true);
    Ok(header)
}

/// Asks Sentry (`base` is `API_URL`, a local port in the tests) whether it accepts the token.
async fn check_token(http: &reqwest::Client, base: &str, token: &str) -> Result<(), String> {
    let answer = http
        .get(format!("{base}/organizations/"))
        .header(AUTHORIZATION, bearer(token)?)
        .send()
        .await
        .map_err(|e| format!("Sentry に接続できません（{}）", e.without_url()))?;
    verdict(answer.status().as_u16())
}

/// Sets the status of an issue (`base` is `API_URL`, a local port in the tests). `org` and `issue_id` are IDs that go into the address as they are (`sentry_id`).
async fn put_issue(
    http: &reqwest::Client,
    base: &str,
    token: &str,
    org: &str,
    issue_id: &str,
    body: &Value,
) -> Result<(), String> {
    let answer = http
        .put(format!("{base}/organizations/{org}/issues/{issue_id}/"))
        .header(AUTHORIZATION, bearer(token)?)
        .json(body)
        .send()
        .await
        .map_err(|e| format!("Sentry に接続できません（{}）", e.without_url()))?;
    put_verdict(answer.status().as_u16())
}

/// What an answer of a `GET` that reads an issue, a project's teams or its members says.
fn get_verdict(status: u16) -> Result<(), String> {
    match status {
        200..=299 => Ok(()),
        401 => Err(BAD_TOKEN.into()),
        403 => Err(NO_READ.into()),
        404 => Err(NO_ISSUE.into()),
        _ => Err(format!("Sentry から読めませんでした（{status}）")),
    }
}

/// Reads `path` (it starts with `/`, and holds IDs that were checked) of Sentry (`base` is `API_URL`, a local port in the tests) as JSON.
async fn get_json(
    http: &reqwest::Client,
    base: &str,
    token: &str,
    path: &str,
) -> Result<Value, String> {
    let answer = http
        .get(format!("{base}{path}"))
        .header(AUTHORIZATION, bearer(token)?)
        .send()
        .await
        .map_err(|e| format!("Sentry に接続できません（{}）", e.without_url()))?;
    get_verdict(answer.status().as_u16())?;
    answer.json().await.map_err(|_| BAD_ANSWER.to_owned())
}

/// The teams and the members of the project that the issue belongs to, which Sentry says in the issue itself.
async fn read_assignees(
    http: &reqwest::Client,
    base: &str,
    token: &str,
    org: &str,
    issue_id: &str,
) -> Result<SentryAssignees, String> {
    let issue = get_json(
        http,
        base,
        token,
        &format!("/organizations/{org}/issues/{issue_id}/"),
    )
    .await?;
    let (project_id, slug) = project_of(&issue).ok_or_else(|| BAD_ANSWER.to_owned())?;
    let teams = get_json(http, base, token, &format!("/projects/{org}/{slug}/teams/")).await?;
    let users = get_json(
        http,
        base,
        token,
        &format!("/organizations/{org}/users/?project={project_id}"),
    )
    .await?;
    Ok(assignees_of(&teams, &users))
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

/// Whether the workspace has a Sentry token: it is in the list and in the keychain. Asks Sentry nothing, and a failure to read is "no" (S-30).
pub(crate) async fn has_token(dir: &Path, team_id: &str) -> bool {
    let (dir, team) = (dir.to_owned(), team_id.to_owned());
    let listed = blocking(move || load(&dir).map(|teams| teams.contains(&team))).await;
    matches!(listed, Ok(true)) && matches!(read_secret(team_id.to_owned()).await, Ok(Some(_)))
}

/// Sets the status of the issue of a Sentry notification with the workspace's token (S-30): `value` is one of Sentry's own (`STATUS_VALUES`), `org` and `issue_id` are the ones in the address of the notification's title.
#[tauri::command]
pub async fn sentry_set_status(
    team_id: String,
    org: String,
    issue_id: String,
    value: String,
) -> Result<(), String> {
    let command = "sentry_set_status";
    let team = token_key(&team_id).map_err(|e| log_failure(command, &team_id, e))?;
    let body = status_body(&value)
        .filter(|_| sentry_id(&org) && sentry_id(&issue_id))
        .ok_or_else(|| log_failure(command, &team_id, BAD_STATUS))?;
    let token = read_secret(team)
        .await
        .map_err(|e| log_failure(command, &team_id, e))?
        .ok_or_else(|| log_failure(command, &team_id, NO_TOKEN))?;
    let http = client().map_err(|e| log_failure(command, &team_id, e))?;
    put_issue(&http, API_URL, &token, &org, &issue_id, &body)
        .await
        .map_err(|e| log_failure(command, &team_id, e))
}

/// The teams and the members that the issue of a Sentry notification can be assigned to (S-30): those of the project that Sentry says the issue belongs to. `org` and `issue_id` are the ones in the address of the notification's title.
#[tauri::command]
pub async fn sentry_assignees(
    team_id: String,
    org: String,
    issue_id: String,
) -> Result<SentryAssignees, String> {
    let command = "sentry_assignees";
    let team = token_key(&team_id).map_err(|e| log_failure(command, &team_id, e))?;
    if !(sentry_id(&org) && sentry_id(&issue_id)) {
        return Err(log_failure(command, &team_id, BAD_STATUS));
    }
    let token = read_secret(team)
        .await
        .map_err(|e| log_failure(command, &team_id, e))?
        .ok_or_else(|| log_failure(command, &team_id, NO_TOKEN))?;
    let http = client().map_err(|e| log_failure(command, &team_id, e))?;
    read_assignees(&http, API_URL, &token, &org, &issue_id)
        .await
        .map_err(|e| log_failure(command, &team_id, e))
}

/// Assigns the issue of a Sentry notification (S-30): `assignee` is `user:{id}` or `team:{id}` as `sentry_assignees` gave it.
#[tauri::command]
pub async fn sentry_assign(
    team_id: String,
    org: String,
    issue_id: String,
    assignee: String,
) -> Result<(), String> {
    let command = "sentry_assign";
    let team = token_key(&team_id).map_err(|e| log_failure(command, &team_id, e))?;
    if !(sentry_id(&org) && sentry_id(&issue_id)) {
        return Err(log_failure(command, &team_id, BAD_STATUS));
    }
    if !assignee_value(&assignee) {
        return Err(log_failure(command, &team_id, BAD_ASSIGNEE));
    }
    let token = read_secret(team)
        .await
        .map_err(|e| log_failure(command, &team_id, e))?
        .ok_or_else(|| log_failure(command, &team_id, NO_TOKEN))?;
    let http = client().map_err(|e| log_failure(command, &team_id, e))?;
    put_issue(
        &http,
        API_URL,
        &token,
        &org,
        &issue_id,
        &json!({ "assignedTo": assignee }),
    )
    .await
    .map_err(|e| log_failure(command, &team_id, e))
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

    /// Serves the answers one after another on a local port, one to each connection, and returns the base URL and what each request said.
    async fn serve_each(answers: Vec<String>) -> (String, tokio::task::JoinHandle<Vec<String>>) {
        let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
        let base = format!("http://{}", listener.local_addr().unwrap());
        let seen = tokio::spawn(async move {
            let mut requests = Vec::new();
            for answer in answers {
                let (mut socket, _) = listener.accept().await.unwrap();
                let mut request = Vec::new();
                let mut buf = [0u8; 1024];
                // The head, and then the body that its `content-length` announces.
                loop {
                    let text = String::from_utf8_lossy(&request).to_ascii_lowercase();
                    if let Some((head, body)) = text.split_once("\r\n\r\n") {
                        let wanted = head
                            .lines()
                            .find_map(|l| l.strip_prefix("content-length: "))
                            .and_then(|n| n.trim().parse::<usize>().ok())
                            .unwrap_or(0);
                        if body.len() >= wanted {
                            break;
                        }
                    }
                    let n = socket.read(&mut buf).await.unwrap();
                    if n == 0 {
                        break;
                    }
                    request.extend_from_slice(&buf[..n]);
                }
                socket.write_all(answer.as_bytes()).await.unwrap();
                socket.shutdown().await.unwrap();
                requests.push(String::from_utf8_lossy(&request).into_owned());
            }
            requests
        });
        (base, seen)
    }

    /// Serves one answer on a local port, and returns the base URL and what the request said.
    async fn serve_once(answer: &'static str) -> (String, tokio::task::JoinHandle<String>) {
        let (base, seen) = serve_each(vec![answer.to_owned()]).await;
        (
            base,
            tokio::spawn(async move { seen.await.unwrap().remove(0) }),
        )
    }

    fn json_answer(body: &Value) -> String {
        let body = body.to_string();
        format!(
            "HTTP/1.1 200 OK\r\nContent-Type: application/json\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{body}",
            body.len()
        )
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

    #[test]
    fn a_value_becomes_the_body_that_sentrys_own_button_sends() {
        let body = |v: &str| status_body(v).unwrap();
        assert_eq!(body("resolved"), json!({"status": "resolved"}));
        assert_eq!(
            body("resolved:inNextRelease"),
            json!({"status": "resolved", "statusDetails": {"inNextRelease": true}})
        );
        assert_eq!(
            body("resolved:inCurrentRelease"),
            json!({"status": "resolved", "statusDetails": {"inRelease": "latest"}})
        );
        // The second part is a sub-status of an archived issue only.
        assert_eq!(body("unresolved:ongoing"), json!({"status": "unresolved"}));
        assert_eq!(
            body("ignored:archived_until_escalating"),
            json!({"status": "ignored", "substatus": "archived_until_escalating"})
        );
        assert_eq!(
            body("ignored:archived_forever"),
            json!({"status": "ignored", "substatus": "archived_forever"})
        );
        for count in [10, 100, 1000] {
            assert_eq!(
                body(&format!("ignored:archived_until_condition_met:{count}")),
                json!({"status": "ignored", "substatus": "archived_until_condition_met", "statusDetails": {"ignoreCount": count}})
            );
        }
        assert!(STATUS_VALUES.iter().all(|v| status_body(v).is_some()));
    }

    #[test]
    fn a_value_that_is_not_in_the_list_is_not_sent() {
        for bad in [
            "",
            "resolve_dialog",
            "resolved:inNextReleases",
            "ignored",
            "ignored:archived_until_condition_met",
            "ignored:archived_until_condition_met:5",
            "ignored:archived_until_condition_met:10:1",
            "ignored:other",
            "deleted",
            " resolved",
        ] {
            assert_eq!(status_body(bad), None, "{bad:?}");
        }
    }

    #[test]
    fn a_status_of_the_update_is_a_verdict() {
        assert_eq!(put_verdict(200), Ok(()));
        assert_eq!(put_verdict(204), Ok(()));
        assert_eq!(put_verdict(401), Err(BAD_TOKEN.into()));
        assert_eq!(put_verdict(403), Err(NO_WRITE.into()));
        assert_eq!(put_verdict(404), Err(NO_ISSUE.into()));
        assert_eq!(
            put_verdict(500),
            Err("Sentry に送れませんでした（500）".into())
        );
    }

    #[tokio::test]
    async fn the_status_is_put_to_the_issue_with_the_bearer_credential() {
        let (base, seen) = serve_once(OK).await;
        let http = client().unwrap();
        let body = status_body("ignored:archived_until_condition_met:100").unwrap();
        assert_eq!(
            put_issue(&http, &base, "sntryu_abc", "acme", "1234", &body).await,
            Ok(())
        );
        let request = seen.await.unwrap();
        assert!(
            request.starts_with("PUT /organizations/acme/issues/1234/ HTTP/1.1"),
            "{request}"
        );
        assert!(
            request
                .to_ascii_lowercase()
                .contains("authorization: bearer sntryu_abc"),
            "{request}"
        );
        let sent = request.split_once("\r\n\r\n").unwrap().1;
        assert_eq!(serde_json::from_str::<Value>(sent).unwrap(), body);
    }

    #[tokio::test]
    async fn an_answer_of_sentry_to_the_update_is_told_as_it_is() {
        let http = client().unwrap();
        let body = status_body("resolved").unwrap();
        for (answer, want) in [
            (UNAUTHORIZED, BAD_TOKEN),
            (FORBIDDEN, NO_WRITE),
            ("HTTP/1.1 404 Not Found\r\nContent-Length: 0\r\nConnection: close\r\n\r\n", NO_ISSUE),
            (
                "HTTP/1.1 302 Found\r\nLocation: http://127.0.0.1:9/\r\nContent-Length: 0\r\nConnection: close\r\n\r\n",
                "Sentry に送れませんでした（302）",
            ),
        ] {
            let (base, _seen) = serve_once(answer).await;
            assert_eq!(
                put_issue(&http, &base, "sntryu_abc", "acme", "1234", &body).await,
                Err(want.into())
            );
        }
    }

    #[tokio::test]
    async fn a_token_with_a_line_break_is_refused_before_anything_is_sent() {
        let http = client().unwrap();
        assert_eq!(
            check_token(&http, "http://127.0.0.1:9", "a\r\nX: y").await,
            Err(BAD_TOKEN.into())
        );
        assert_eq!(
            put_issue(
                &http,
                "http://127.0.0.1:9",
                "a\r\nX: y",
                "acme",
                "1",
                &json!({})
            )
            .await,
            Err(BAD_TOKEN.into())
        );
    }

    #[test]
    fn only_a_team_or_a_user_with_digits_is_assigned() {
        for good in ["user:1", "team:42", "user:12345678901234567890"] {
            assert!(assignee_value(good), "{good}");
        }
        for bad in [
            "",
            "user",
            "user:",
            "user:abc",
            "team:1/2",
            "me:1",
            "user:1 ",
            "user:-1",
            "user:+1",
            "user:123456789012345678901",
            "user:1\n",
            "USER:1",
            ":1",
            "user:１",
        ] {
            assert!(!assignee_value(bad), "{bad:?}");
        }
    }

    #[test]
    fn the_project_of_an_issue_has_digits_and_a_slug_that_fits_an_address() {
        let of = |project: Value| project_of(&json!({ "project": project }));
        assert_eq!(
            of(json!({"id": "22", "slug": "example_front-1"})),
            Some(("22".into(), "example_front-1".into()))
        );
        assert_eq!(
            of(json!({"id": 22, "slug": "web"})),
            Some(("22".into(), "web".into()))
        );
        for bad in [
            json!({"id": "22", "slug": "a/b"}),
            json!({"id": "22", "slug": "a?x=1"}),
            json!({"id": "22", "slug": ""}),
            json!({"id": "2x", "slug": "web"}),
            json!({"id": "22"}),
            json!({"slug": "web"}),
            json!(null),
        ] {
            assert_eq!(of(bad.clone()), None, "{bad}");
        }
        assert_eq!(project_of(&json!({})), None);
    }

    #[test]
    fn the_teams_and_the_members_become_the_choices_with_sentrys_values() {
        let teams = json!([
            {"id": "7", "slug": "backend", "name": "Backend"},
            {"id": 8, "slug": " web "},
            {"id": "x", "slug": "no-id"},
            {"id": "9", "slug": " "}
        ]);
        let users = json!([
            {"id": "100", "name": "Owner", "email": "owner@example.com", "user": {"id": "1", "name": "Other"}},
            {"id": "101", "name": "", "email": "b@example.com", "user": {"id": 2, "name": "Tanaka"}},
            {"id": "102", "email": "c@example.com", "user": {"id": "3"}},
            {"id": "103", "name": "No user", "user": null},
            {"id": "104", "name": "Bad user ID", "user": {"id": "a1"}},
            {"id": "105", "user": {"id": "4"}}
        ]);
        let a = |name: &str, value: &str| SentryAssignee {
            name: name.into(),
            value: value.into(),
        };
        assert_eq!(
            assignees_of(&teams, &users),
            SentryAssignees {
                teams: vec![a("#backend", "team:7"), a("#web", "team:8")],
                members: vec![
                    a("Owner", "user:1"),
                    a("Tanaka", "user:2"),
                    a("c@example.com", "user:3")
                ],
            }
        );
        // An answer that is not a list gives no choice.
        assert_eq!(
            assignees_of(&json!({}), &json!(null)),
            SentryAssignees {
                teams: vec![],
                members: vec![]
            }
        );
    }

    #[test]
    fn a_status_of_a_read_is_a_verdict() {
        assert_eq!(get_verdict(200), Ok(()));
        assert_eq!(get_verdict(401), Err(BAD_TOKEN.into()));
        assert_eq!(get_verdict(403), Err(NO_READ.into()));
        assert_eq!(get_verdict(404), Err(NO_ISSUE.into()));
        assert_eq!(
            get_verdict(500),
            Err("Sentry から読めませんでした（500）".into())
        );
    }

    #[tokio::test]
    async fn the_choices_are_read_from_the_project_that_sentry_says_the_issue_has() {
        let (base, seen) = serve_each(vec![
            json_answer(&json!({"project": {"id": "22", "slug": "example_front"}})),
            json_answer(&json!([{"id": "7", "slug": "backend"}])),
            json_answer(&json!([{"id": "100", "name": "Owner", "user": {"id": "1"}}])),
        ])
        .await;
        let http = client().unwrap();
        let got = read_assignees(&http, &base, "sntryu_abc", "acme", "1234").await;
        assert_eq!(
            got,
            Ok(SentryAssignees {
                teams: vec![SentryAssignee {
                    name: "#backend".into(),
                    value: "team:7".into()
                }],
                members: vec![SentryAssignee {
                    name: "Owner".into(),
                    value: "user:1".into()
                }],
            })
        );
        let requests = seen.await.unwrap();
        let heads: Vec<&str> = requests.iter().map(|r| r.lines().next().unwrap()).collect();
        assert_eq!(
            heads,
            [
                "GET /organizations/acme/issues/1234/ HTTP/1.1",
                "GET /projects/acme/example_front/teams/ HTTP/1.1",
                "GET /organizations/acme/users/?project=22 HTTP/1.1",
            ]
        );
        for r in &requests {
            assert!(
                r.to_ascii_lowercase()
                    .contains("authorization: bearer sntryu_abc"),
                "{r}"
            );
        }
    }

    #[tokio::test]
    async fn a_read_that_sentry_refuses_or_that_names_a_bad_project_gives_no_choice() {
        let http = client().unwrap();
        for (answer, want) in [
            (UNAUTHORIZED.to_owned(), BAD_TOKEN),
            (FORBIDDEN.to_owned(), NO_READ),
            (
                "HTTP/1.1 404 Not Found\r\nContent-Length: 0\r\nConnection: close\r\n\r\n"
                    .to_owned(),
                NO_ISSUE,
            ),
            (
                json_answer(&json!({"project": {"id": "22", "slug": "../x"}})),
                BAD_ANSWER,
            ),
            (OK.to_owned(), BAD_ANSWER),
        ] {
            let (base, _seen) = serve_each(vec![answer]).await;
            assert_eq!(
                read_assignees(&http, &base, "sntryu_abc", "acme", "1").await,
                Err(want.into())
            );
        }
        // An answer that is not JSON.
        let (base, _seen) = serve_each(vec![
            "HTTP/1.1 200 OK\r\nContent-Length: 3\r\nConnection: close\r\n\r\nabc".to_owned(),
        ])
        .await;
        assert_eq!(
            read_assignees(&http, &base, "sntryu_abc", "acme", "1").await,
            Err(BAD_ANSWER.into())
        );
    }
}
