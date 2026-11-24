//! The connection to Jira Cloud (J-1, #868): the site's URL and the email address in `jira-settings.json` of the app config directory, the API token in the keychain, and a test of the connection.
//!
//! Only Atlassian Cloud is spoken to: the site is `https://{name}.atlassian.net` and nothing else (`site_url`), and a token goes to that site or to `api.atlassian.com` only, never to another host.
//! An email address makes the token a Basic credential (`email:token`, an API token of an account) sent to the site; with none it is a Bearer token (a scoped token) sent through the gateway `api.atlassian.com/ex/jira/{cloudId}`, which is the only place Atlassian takes it (`api_base` chooses).
//! The token is never returned to the screen, logged or written to a file; a save with no token keeps the stored one.
//!
//! The boards, the sprints and their tickets are read through the Agile API (`/rest/agile/1.0`, J-2, #869): the commands `jira_boards`, `jira_sprints`, `jira_sprint_issues` and `jira_backlog` read the saved connection and call it where `api_base` says. They only read; the answers are turned into the types below by pure functions.
//! A ticket is read for its tab (J-2, #871) by `jira_issue`: the ticket with its description (REST API v3, where the description is ADF, read as Markdown by `adf`), its sprint (the Agile API) and its comments.

mod adf;

use std::{path::Path, time::Duration};

use base64::{engine::general_purpose::STANDARD, Engine};
use reqwest::header::{HeaderValue, ACCEPT, AUTHORIZATION};
use serde::{de::DeserializeOwned, Deserialize, Serialize};
use serde_json::Value;
use tauri::AppHandle;
#[cfg(test)]
use ts_rs::TS;
use url::Url;

use crate::{accounts::write_atomic, auth::config_dir, gmail::log_failure, keychain};

const FILE: &str = "jira-settings.json";
/// The keychain service and user name of the API token.
const TOKEN_SERVICE: &str = "jp.mysis.tsunagiai.jira";
const TOKEN_USER: &str = "api-token";
/// The `account=` of the logs.
const LOG_ACCOUNT: &str = "jira";
const HOST_SUFFIX: &str = ".atlassian.net";
/// The call that tells who the credential belongs to, after `api_base`.
const MYSELF_PATH: &str = "/rest/api/3/myself";
/// Where a scoped token is used (Atlassian's platform API gateway): `{GATEWAY}/ex/jira/{cloudId}/rest/api/3/...`.
const GATEWAY: &str = "https://api.atlassian.com";
/// The site's own answer to who it is; it needs no credential, and holds the Cloud ID.
const TENANT_INFO_PATH: &str = "/_edge/tenant_info";
/// The longest Cloud ID taken (they are UUIDs of 36 characters).
const CLOUD_ID_LIMIT: usize = 64;
const TIMEOUT: Duration = Duration::from_secs(15);
/// How much of an error body goes into the message.
const BODY_LIMIT: usize = 200;
const TOKEN_MISSING: &str = "API トークンを入力してください";
const NOT_SAVED: &str = "Jira の接続が保存されていません";
/// The Agile API, after `api_base`.
const BOARD_PATH: &str = "/rest/agile/1.0/board";
const SPRINT_PATH: &str = "/rest/agile/1.0/sprint";
/// What each call asks for a page, and how many items one command reads in all (a command stops at the page that reaches the limit).
const PAGE_SIZE: usize = 50;
const MAX_BOARDS: usize = 200;
const MAX_SPRINTS: usize = 100;
const MAX_ISSUES: usize = 500;
/// The fields of a ticket that `JiraIssue` holds, and nothing else is asked for.
const ISSUE_FIELDS: &str = "fields=summary,status,assignee,priority";
/// One ticket (J-2, #871): its fields and its description in REST API v3 (ADF), its sprint in the Agile API, and its comments.
const ISSUE_PATH: &str = "/rest/api/3/issue";
const AGILE_ISSUE_PATH: &str = "/rest/agile/1.0/issue";
const DETAIL_FIELDS: &str = "summary,description,status,assignee,priority,labels,parent";
const MAX_COMMENTS: usize = 200;
/// The longest ticket key taken (a project key of letters, digits and underscores, a hyphen and a number).
const KEY_LIMIT: usize = 64;

/// What `jira-settings.json` holds.
#[derive(Serialize, Deserialize, Default, Debug, PartialEq)]
struct Saved {
    site: String,
    email: String,
}

/// The saved connection as the screen gets it: never the token, only whether one is kept.
#[derive(Serialize, Debug, PartialEq)]
#[cfg_attr(test, derive(TS))]
#[cfg_attr(test, ts(export, export_to = crate::BINDINGS))]
#[serde(rename_all = "camelCase")]
pub struct JiraSettings {
    pub site: String,
    pub email: String,
    pub has_token: bool,
}

/// Who the credential belongs to, as Jira answered the test.
#[derive(Serialize, Deserialize, Debug, PartialEq)]
#[cfg_attr(test, derive(TS))]
#[cfg_attr(test, ts(export, export_to = crate::BINDINGS))]
#[serde(rename_all = "camelCase")]
pub struct JiraUser {
    #[serde(default)]
    pub display_name: String,
    #[serde(default)]
    pub email_address: Option<String>,
}

/// A board of Jira Software. `type` is Jira's own word: `scrum`, `kanban` or `simple` (only a scrum board has sprints).
#[derive(Serialize, Deserialize, Debug, PartialEq)]
#[cfg_attr(test, derive(TS))]
#[cfg_attr(test, ts(export, export_to = crate::BINDINGS))]
pub struct JiraBoard {
    #[cfg_attr(test, ts(type = "number"))]
    pub id: u64,
    #[serde(default)]
    pub name: String,
    #[serde(default, rename = "type")]
    pub board_type: String,
}

/// A sprint of a board. `state` is Jira's own word: `active`, `future` or `closed`; the dates are Jira's ISO 8601 text, and a sprint that has not started has none.
#[derive(Serialize, Deserialize, Debug, PartialEq)]
#[cfg_attr(test, derive(TS))]
#[cfg_attr(test, ts(export, export_to = crate::BINDINGS))]
#[serde(rename_all = "camelCase")]
pub struct JiraSprint {
    #[cfg_attr(test, ts(type = "number"))]
    pub id: u64,
    #[serde(default)]
    pub name: String,
    #[serde(default)]
    pub state: String,
    #[serde(default)]
    pub start_date: Option<String>,
    #[serde(default)]
    pub end_date: Option<String>,
}

/// A ticket as the list draws it. `statusCategory` is the key of the status's category: `new`, `indeterminate` or `done` (`undefined` when Jira gave none). `assignee` is the display name, `null` when unassigned, and `priority` is `null` when the project has none.
#[derive(Serialize, Debug, PartialEq)]
#[cfg_attr(test, derive(TS))]
#[cfg_attr(test, ts(export, export_to = crate::BINDINGS))]
#[serde(rename_all = "camelCase")]
pub struct JiraIssue {
    pub key: String,
    pub summary: String,
    pub status: String,
    pub status_category: String,
    pub assignee: Option<String>,
    pub priority: Option<String>,
}

/// The tickets of a sprint or of a backlog. `truncated` is true when there were more than the command reads (`MAX_ISSUES`).
#[derive(Serialize, Debug, PartialEq)]
#[cfg_attr(test, derive(TS))]
#[cfg_attr(test, ts(export, export_to = crate::BINDINGS))]
#[serde(rename_all = "camelCase")]
pub struct JiraIssues {
    pub issues: Vec<JiraIssue>,
    pub truncated: bool,
}

/// A ticket as its tab draws it (J-2, #871). `description` and the `body` of a comment are Markdown (read from Jira's ADF), `sprint` is the name of the sprint the ticket is in now (`null` for none), `created` is Jira's time as `YYYY-MM-DD HH:MM` in the offset it gave, and `commentsTruncated` is true when there were more comments than the command reads (`MAX_COMMENTS`).
#[derive(Serialize, Debug, PartialEq)]
#[cfg_attr(test, derive(TS))]
#[cfg_attr(test, ts(export, export_to = crate::BINDINGS))]
#[serde(rename_all = "camelCase")]
pub struct JiraIssueDetail {
    pub key: String,
    pub summary: String,
    pub description: String,
    pub status: String,
    pub status_category: String,
    pub assignee: Option<String>,
    pub priority: Option<String>,
    pub sprint: Option<String>,
    pub labels: Vec<String>,
    pub parent: Option<JiraParent>,
    pub comments: Vec<JiraComment>,
    pub comments_truncated: bool,
}

/// The parent of a ticket: its key and its summary.
#[derive(Serialize, Debug, PartialEq)]
#[cfg_attr(test, derive(TS))]
#[cfg_attr(test, ts(export, export_to = crate::BINDINGS))]
pub struct JiraParent {
    pub key: String,
    pub summary: String,
}

#[derive(Serialize, Debug, PartialEq)]
#[cfg_attr(test, derive(TS))]
#[cfg_attr(test, ts(export, export_to = crate::BINDINGS))]
pub struct JiraComment {
    pub author: String,
    pub created: String,
    pub body: String,
}

/// The origin of a site: `https://{name}.atlassian.net` only. Another scheme, host, port, user info or an empty or dotted name is refused, and a path is dropped.
fn site_url(input: &str) -> Result<String, String> {
    let bad = || "サイトの URL は https://{名前}.atlassian.net の形で入力してください".to_owned();
    let url = Url::parse(input.trim()).map_err(|_| bad())?;
    let host = url.host_str().ok_or_else(bad)?;
    let name = host.strip_suffix(HOST_SUFFIX).ok_or_else(bad)?;
    let name_ok = !name.is_empty()
        && !name.starts_with('-')
        && name.chars().all(|c| c.is_ascii_alphanumeric() || c == '-');
    let plain = url.scheme() == "https"
        && url.username().is_empty()
        && url.password().is_none()
        && url.port().is_none();
    if name_ok && plain {
        Ok(format!("https://{host}"))
    } else {
        Err(bad())
    }
}

/// The email address, trimmed; empty is allowed (a Bearer token). It becomes the left half of `email:token`, so a colon or a space is refused.
fn email_of(input: &str) -> Result<String, String> {
    let email = input.trim();
    let ok = email.is_empty()
        || (email.contains('@')
            && !email
                .chars()
                .any(|c| c == ':' || c.is_whitespace() || c.is_control()));
    if ok {
        Ok(email.to_owned())
    } else {
        Err("メールアドレスの形が正しくありません".into())
    }
}

/// The token typed, trimmed; `None` when nothing was typed. It goes into a header, so only printable ASCII is taken.
fn token_of(input: &str) -> Result<Option<String>, String> {
    let token = input.trim();
    if token.is_empty() {
        return Ok(None);
    }
    if token.chars().all(|c| c.is_ascii_graphic()) {
        Ok(Some(token.to_owned()))
    } else {
        Err("API トークンに使えない文字があります".into())
    }
}

/// The `Authorization` header: Basic with `email:token` when an email address is given, else Bearer.
fn authorization(email: &str, token: &str) -> String {
    if email.is_empty() {
        format!("Bearer {token}")
    } else {
        format!("Basic {}", STANDARD.encode(format!("{email}:{token}")))
    }
}

/// The message for an answer that is not a success.
fn failure_of(status: u16, body: &str) -> String {
    match status {
        401 | 403 => format!("Jira が認証を拒否しました（{status}）"),
        _ => {
            let shown: String = body.chars().take(BODY_LIMIT).collect();
            format!("Jira が {status} を返しました: {shown}")
        }
    }
}

/// What Jira's answer to the call of `MYSELF_PATH` means.
fn user_of(status: u16, body: &str) -> Result<JiraUser, String> {
    match status {
        200..=299 => {
            serde_json::from_str(body).map_err(|e| format!("Jira の応答を読めません: {e}"))
        }
        _ => Err(failure_of(status, body)),
    }
}

/// One page of the Agile API: the boards and the sprints are under `values`, the tickets under `issues` (and the comments of a ticket, of REST API v3, under `comments`). Jira gives `isLast` for the first two and `total` for the last (and for some of the first).
#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct Page<T> {
    #[serde(
        default = "Vec::new",
        alias = "values",
        alias = "issues",
        alias = "comments"
    )]
    items: Vec<T>,
    total: Option<usize>,
    is_last: Option<bool>,
}

fn page_of<T: DeserializeOwned>(status: u16, body: &str) -> Result<Page<T>, String> {
    if !(200..=299).contains(&status) {
        return Err(failure_of(status, body));
    }
    serde_json::from_str(body).map_err(|e| format!("Jira の応答を読めません: {e}"))
}

/// Where the next page starts, or `None` at the end: a page with nothing, `isLast`, or the count that `total` gives having been reached. It goes on by what was received, not by what was asked, because Jira may give fewer than `maxResults`.
fn next_start(start: usize, page: &Page<impl Sized>) -> Option<usize> {
    let next = start + page.items.len();
    let done = page.items.is_empty()
        || page.is_last == Some(true)
        || page.total.is_some_and(|total| next >= total);
    (!done).then_some(next)
}

#[derive(Deserialize)]
struct RawIssue {
    key: String,
    fields: Option<RawFields>,
}

#[derive(Deserialize, Default)]
struct RawFields {
    summary: Option<String>,
    status: Option<RawStatus>,
    assignee: Option<RawUser>,
    priority: Option<RawPriority>,
    description: Option<Value>,
    labels: Option<Vec<String>>,
    parent: Option<RawParent>,
}

#[derive(Deserialize)]
struct RawParent {
    key: String,
    fields: Option<RawParentFields>,
}

#[derive(Deserialize)]
struct RawParentFields {
    summary: Option<String>,
}

#[derive(Deserialize)]
struct RawComment {
    author: Option<RawUser>,
    body: Option<Value>,
    created: Option<String>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct RawStatus {
    name: Option<String>,
    status_category: Option<RawCategory>,
}

#[derive(Deserialize)]
struct RawCategory {
    key: Option<String>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct RawUser {
    display_name: Option<String>,
}

#[derive(Deserialize)]
struct RawPriority {
    name: Option<String>,
}

fn issue_of(raw: RawIssue) -> JiraIssue {
    let fields = raw.fields.unwrap_or_default();
    let status = fields.status;
    JiraIssue {
        key: raw.key,
        summary: fields.summary.unwrap_or_default(),
        status_category: status
            .as_ref()
            .and_then(|s| s.status_category.as_ref())
            .and_then(|c| c.key.clone())
            .unwrap_or_else(|| "undefined".to_owned()),
        status: status.and_then(|s| s.name).unwrap_or_default(),
        assignee: fields.assignee.and_then(|u| u.display_name),
        priority: fields.priority.and_then(|p| p.name),
    }
}

/// A ticket key as the tab asks for it: a project key (a capital letter, then capitals, digits and underscores), a hyphen and a number. It goes into a path, so nothing else is let through.
fn key_of(input: &str) -> Result<&str, String> {
    let bad = || "チケットのキーの形が正しくありません".to_owned();
    let (project, number) = input.split_once('-').ok_or_else(bad)?;
    let mut letters = project.chars();
    let ok = input.len() <= KEY_LIMIT
        && letters.next().is_some_and(|c| c.is_ascii_uppercase())
        && letters.all(|c| c.is_ascii_uppercase() || c.is_ascii_digit() || c == '_')
        && !number.is_empty()
        && number.chars().all(|c| c.is_ascii_digit());
    if ok {
        Ok(input)
    } else {
        Err(bad())
    }
}

/// Jira's time (`2026-11-20T09:30:12.345+0900`) as `2026-11-20 09:30`, in the offset Jira gave (the one of the credential's user); a text of another form is kept as it is.
fn shown_time(time: &str) -> String {
    match (time.as_bytes().get(10), time.get(..10), time.get(11..16)) {
        (Some(b'T'), Some(date), Some(clock)) => format!("{date} {clock}"),
        _ => time.to_owned(),
    }
}

/// What Jira's answer to the read of a ticket (REST API v3) means.
fn raw_issue_of(status: u16, body: &str) -> Result<RawIssue, String> {
    match status {
        200..=299 => {
            serde_json::from_str(body).map_err(|e| format!("Jira の応答を読めません: {e}"))
        }
        _ => Err(failure_of(status, body)),
    }
}

/// The name of the sprint that the Agile API's answer for a ticket (`fields=sprint`) puts it in, `None` for a ticket in none.
fn sprint_of(status: u16, body: &str) -> Result<Option<String>, String> {
    #[derive(Deserialize)]
    struct Sprint {
        name: Option<String>,
    }
    #[derive(Deserialize)]
    struct Fields {
        sprint: Option<Sprint>,
    }
    #[derive(Deserialize)]
    struct Answer {
        fields: Option<Fields>,
    }
    if !(200..=299).contains(&status) {
        return Err(failure_of(status, body));
    }
    let answer: Answer =
        serde_json::from_str(body).map_err(|e| format!("Jira の応答を読めません: {e}"))?;
    Ok(answer
        .fields
        .and_then(|f| f.sprint)
        .and_then(|s| s.name)
        .filter(|name| !name.is_empty()))
}

/// The ticket's tab from what the three reads gave: the description and the comments are read as Markdown.
fn detail_of(
    mut raw: RawIssue,
    sprint: Option<String>,
    comments: Vec<RawComment>,
    comments_truncated: bool,
) -> JiraIssueDetail {
    let (description, labels, parent) = raw
        .fields
        .as_mut()
        .map(|f| (f.description.take(), f.labels.take(), f.parent.take()))
        .unwrap_or_default();
    let issue = issue_of(raw);
    JiraIssueDetail {
        key: issue.key,
        summary: issue.summary,
        description: adf::adf_to_markdown(&description.unwrap_or(Value::Null)),
        status: issue.status,
        status_category: issue.status_category,
        assignee: issue.assignee,
        priority: issue.priority,
        sprint,
        labels: labels.unwrap_or_default(),
        parent: parent.map(|p| JiraParent {
            summary: p.fields.and_then(|f| f.summary).unwrap_or_default(),
            key: p.key,
        }),
        comments: comments
            .into_iter()
            .map(|c| JiraComment {
                author: c.author.and_then(|u| u.display_name).unwrap_or_default(),
                created: shown_time(&c.created.unwrap_or_default()),
                body: adf::adf_to_markdown(&c.body.unwrap_or(Value::Null)),
            })
            .collect(),
        comments_truncated,
    }
}

/// The client of every call here. A redirect is not followed, so a credential never goes to another host.
fn client() -> Result<reqwest::Client, String> {
    reqwest::Client::builder()
        .redirect(reqwest::redirect::Policy::none())
        .timeout(TIMEOUT)
        .build()
        .map_err(|e| e.to_string())
}

/// The Cloud ID in the answer of `TENANT_INFO_PATH`: letters, digits and hyphens only, since it goes into a URL.
fn cloud_id_of(status: u16, body: &str) -> Result<String, String> {
    #[derive(Deserialize)]
    #[serde(rename_all = "camelCase")]
    struct TenantInfo {
        cloud_id: String,
    }
    if !(200..=299).contains(&status) {
        return Err(format!("Jira のサイトを確かめられません（{status}）"));
    }
    let id = serde_json::from_str::<TenantInfo>(body)
        .map_err(|e| format!("Jira のサイトの応答を読めません: {e}"))?
        .cloud_id;
    let ok = !id.is_empty()
        && id.len() <= CLOUD_ID_LIMIT
        && id.chars().all(|c| c.is_ascii_alphanumeric() || c == '-');
    if ok {
        Ok(id)
    } else {
        Err("Jira のサイトの Cloud ID の形が正しくありません".into())
    }
}

/// The URL that Jira's REST paths (`/rest/api/3/...`) are put after, for this credential: the one place that chooses it.
/// With an email address (an API token of an account, Basic) it is the site's own origin.
/// With none (a scoped token, Bearer) it is the gateway, `{gateway}/ex/jira/{cloudId}`, because Atlassian refuses a scoped token on the site's URL (401); the Cloud ID is asked of the site, which is sent no credential.
/// `gateway` is `GATEWAY` outside the tests.
pub(crate) async fn api_base(
    http: &reqwest::Client,
    site: &str,
    email: &str,
    gateway: &str,
) -> Result<String, String> {
    if !email.is_empty() {
        return Ok(site.to_owned());
    }
    let res = http
        .get(format!("{site}{TENANT_INFO_PATH}"))
        .header(ACCEPT, "application/json")
        .send()
        .await
        .map_err(|e| e.to_string())?;
    let status = res.status().as_u16();
    let body = res.text().await.map_err(|e| e.to_string())?;
    Ok(format!("{gateway}/ex/jira/{}", cloud_id_of(status, &body)?))
}

/// What a call needs: the client, the base that `api_base` chose and the `Authorization` value.
struct Conn {
    http: reqwest::Client,
    base: String,
    authorization: String,
}

/// `api_base` for the credential, with the client and the header made once.
async fn connect(site: &str, email: &str, token: &str, gateway: &str) -> Result<Conn, String> {
    let http = client()?;
    let base = api_base(&http, site, email, gateway).await?;
    Ok(Conn {
        http,
        base,
        authorization: authorization(email, token),
    })
}

/// A GET of `path` (with its query) after the base, with the credential: the status and the body. The one place that sends it.
async fn get(conn: &Conn, path: &str) -> Result<(u16, String), String> {
    let mut header = HeaderValue::from_str(&conn.authorization).map_err(|e| e.to_string())?;
    header.set_sensitive(true);
    let res = conn
        .http
        .get(format!("{}{path}", conn.base))
        .header(AUTHORIZATION, header)
        .header(ACCEPT, "application/json")
        .send()
        .await
        .map_err(|e| e.to_string())?;
    let status = res.status().as_u16();
    let body = res.text().await.map_err(|e| e.to_string())?;
    Ok((status, body))
}

/// Asks Jira who the credential belongs to.
async fn fetch_user(conn: &Conn) -> Result<JiraUser, String> {
    let (status, body) = get(conn, MYSELF_PATH).await?;
    user_of(status, &body)
}

/// The test of a connection: `connect`, then the call of `fetch_user`.
async fn check(site: &str, email: &str, token: &str, gateway: &str) -> Result<JiraUser, String> {
    fetch_user(&connect(site, email, token, gateway).await?).await
}

/// Reads the pages of a list one after another, until its end or until `limit` items are held; the items past `limit` are dropped and the second value says so. `query` has no `startAt` or `maxResults`.
async fn fetch_all<T: DeserializeOwned>(
    conn: &Conn,
    path: &str,
    query: &str,
    limit: usize,
) -> Result<(Vec<T>, bool), String> {
    let mut items = Vec::new();
    let mut start = 0;
    loop {
        let (status, body) = get(
            conn,
            &format!("{path}?{query}&startAt={start}&maxResults={PAGE_SIZE}"),
        )
        .await?;
        let page = page_of::<T>(status, &body)?;
        let next = next_start(start, &page);
        items.extend(page.items);
        let Some(next) = next else {
            return Ok((items, false));
        };
        if items.len() >= limit {
            items.truncate(limit);
            return Ok((items, true));
        }
        start = next;
    }
}

async fn boards(conn: &Conn) -> Result<Vec<JiraBoard>, String> {
    Ok(fetch_all(conn, BOARD_PATH, "orderBy=name", MAX_BOARDS)
        .await?
        .0)
}

/// The sprints that are active or still to come, the active one first (Jira orders them by state, then by position).
async fn sprints(conn: &Conn, board_id: u64) -> Result<Vec<JiraSprint>, String> {
    let path = format!("{BOARD_PATH}/{board_id}/sprint");
    Ok(fetch_all(conn, &path, "state=active,future", MAX_SPRINTS)
        .await?
        .0)
}

async fn issues(conn: &Conn, path: &str) -> Result<JiraIssues, String> {
    let (raw, truncated) = fetch_all::<RawIssue>(conn, path, ISSUE_FIELDS, MAX_ISSUES).await?;
    Ok(JiraIssues {
        issues: raw.into_iter().map(issue_of).collect(),
        truncated,
    })
}

async fn sprint_issues(conn: &Conn, sprint_id: u64) -> Result<JiraIssues, String> {
    issues(conn, &format!("{SPRINT_PATH}/{sprint_id}/issue")).await
}

/// The incomplete tickets of a board that no active or future sprint holds.
async fn backlog(conn: &Conn, board_id: u64) -> Result<JiraIssues, String> {
    issues(conn, &format!("{BOARD_PATH}/{board_id}/backlog")).await
}

/// A ticket for its tab: its fields and description (REST API v3), its sprint (the Agile API) and its comments, oldest first (at most `MAX_COMMENTS`).
async fn issue_detail(conn: &Conn, key: &str) -> Result<JiraIssueDetail, String> {
    let key = key_of(key)?;
    let (status, body) = get(conn, &format!("{ISSUE_PATH}/{key}?fields={DETAIL_FIELDS}")).await?;
    let raw = raw_issue_of(status, &body)?;
    let (status, body) = get(conn, &format!("{AGILE_ISSUE_PATH}/{key}?fields=sprint")).await?;
    let sprint = sprint_of(status, &body)?;
    let (comments, truncated) = fetch_all::<RawComment>(
        conn,
        &format!("{ISSUE_PATH}/{key}/comment"),
        "orderBy=created",
        MAX_COMMENTS,
    )
    .await?;
    Ok(detail_of(raw, sprint, comments, truncated))
}

fn load_file(dir: &Path) -> Result<Saved, String> {
    let path = dir.join(FILE);
    match std::fs::read_to_string(&path) {
        Ok(text) => serde_json::from_str(&text)
            .map_err(|e| format!("{} の形式が不正です: {e}", path.display())),
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(Saved::default()),
        Err(e) => Err(format!("{} を読めません: {e}", path.display())),
    }
}

fn save_file(dir: &Path, saved: &Saved) -> Result<(), String> {
    let text = serde_json::to_string_pretty(saved).map_err(|e| e.to_string())?;
    write_atomic(dir, FILE, &text)
}

/// What a form gives, checked: the site's origin, the email address, and the token typed (`None` when the field was empty).
fn checked_form(
    site: &str,
    email: &str,
    token: &str,
) -> Result<(String, String, Option<String>), String> {
    Ok((site_url(site)?, email_of(email)?, token_of(token)?))
}

async fn stored_token() -> Result<Option<String>, String> {
    tokio::task::spawn_blocking(|| keychain::read(TOKEN_SERVICE, TOKEN_USER))
        .await
        .map_err(|e| e.to_string())?
}

/// The saved site and email address with the stored token: an error when nothing is saved.
fn saved_connection(
    saved: Saved,
    token: Option<String>,
) -> Result<(String, String, String), String> {
    if saved.site.is_empty() {
        return Err(NOT_SAVED.into());
    }
    Ok((saved.site, saved.email, token.ok_or(TOKEN_MISSING)?))
}

/// The connection that the saved settings and the keychain give, for the commands that read.
async fn saved_conn(app: &AppHandle) -> Result<Conn, String> {
    let dir = config_dir(app)?;
    let saved = tokio::task::spawn_blocking(move || load_file(&dir))
        .await
        .map_err(|e| e.to_string())??;
    let (site, email, token) = saved_connection(saved, stored_token().await?)?;
    connect(&site, &email, &token, GATEWAY).await
}

/// The saved site and email address, and whether a token is kept. Asks Jira nothing.
#[tauri::command]
pub async fn jira_settings(app: AppHandle) -> Result<JiraSettings, String> {
    let command = "jira_settings";
    let dir = config_dir(&app).map_err(|e| log_failure(command, LOG_ACCOUNT, e))?;
    let saved = tokio::task::spawn_blocking(move || load_file(&dir))
        .await
        .map_err(|e| e.to_string())
        .and_then(|r| r)
        .map_err(|e| log_failure(command, LOG_ACCOUNT, e))?;
    let has_token = stored_token()
        .await
        .map_err(|e| log_failure(command, LOG_ACCOUNT, e))?
        .is_some();
    Ok(JiraSettings {
        site: saved.site,
        email: saved.email,
        has_token,
    })
}

/// Saves the site and the email address to the file and the token to the keychain. An empty `token` keeps the stored one, and is refused when none is stored.
#[tauri::command]
pub async fn jira_save(
    app: AppHandle,
    site: String,
    email: String,
    token: String,
) -> Result<JiraSettings, String> {
    let command = "jira_save";
    let (site, email, token) = checked_form(&site, &email, &token)?;
    let dir = config_dir(&app).map_err(|e| log_failure(command, LOG_ACCOUNT, e))?;
    let saved = Saved {
        site: site.clone(),
        email: email.clone(),
    };
    tokio::task::spawn_blocking(move || -> Result<(), String> {
        match token {
            Some(token) => keychain::write(TOKEN_SERVICE, TOKEN_USER, &token)?,
            None if keychain::read(TOKEN_SERVICE, TOKEN_USER)?.is_none() => {
                return Err(TOKEN_MISSING.into())
            }
            None => {}
        }
        save_file(&dir, &saved)
    })
    .await
    .map_err(|e| e.to_string())
    .and_then(|r| r)
    .map_err(|e| log_failure(command, LOG_ACCOUNT, e))?;
    Ok(JiraSettings {
        site,
        email,
        has_token: true,
    })
}

/// Tries the credential of the form against the site: an empty `token` takes the stored one. Saves nothing.
#[tauri::command]
pub async fn jira_test(site: String, email: String, token: String) -> Result<JiraUser, String> {
    let command = "jira_test";
    let (site, email, token) = checked_form(&site, &email, &token)?;
    let token = match token {
        Some(token) => token,
        None => stored_token()
            .await
            .map_err(|e| log_failure(command, LOG_ACCOUNT, e))?
            .ok_or(TOKEN_MISSING)?,
    };
    check(&site, &email, &token, GATEWAY)
        .await
        .map_err(|e| log_failure(command, LOG_ACCOUNT, e))
}

/// The boards that the credential can see, by name (at most `MAX_BOARDS`).
#[tauri::command]
pub async fn jira_boards(app: AppHandle) -> Result<Vec<JiraBoard>, String> {
    let read = async { boards(&saved_conn(&app).await?).await };
    read.await
        .map_err(|e| log_failure("jira_boards", LOG_ACCOUNT, e))
}

/// The active and future sprints of a board (at most `MAX_SPRINTS`). A board without sprints (a kanban one) is Jira's refusal, with its message.
#[tauri::command]
pub async fn jira_sprints(app: AppHandle, board_id: u64) -> Result<Vec<JiraSprint>, String> {
    let read = async { sprints(&saved_conn(&app).await?, board_id).await };
    read.await
        .map_err(|e| log_failure("jira_sprints", LOG_ACCOUNT, e))
}

/// The tickets of a sprint, in the order of the board's rank (at most `MAX_ISSUES`).
#[tauri::command]
pub async fn jira_sprint_issues(app: AppHandle, sprint_id: u64) -> Result<JiraIssues, String> {
    let read = async { sprint_issues(&saved_conn(&app).await?, sprint_id).await };
    read.await
        .map_err(|e| log_failure("jira_sprint_issues", LOG_ACCOUNT, e))
}

/// The backlog of a board, in the order of its rank (at most `MAX_ISSUES`).
#[tauri::command]
pub async fn jira_backlog(app: AppHandle, board_id: u64) -> Result<JiraIssues, String> {
    let read = async { backlog(&saved_conn(&app).await?, board_id).await };
    read.await
        .map_err(|e| log_failure("jira_backlog", LOG_ACCOUNT, e))
}

/// A ticket for its tab (J-2, #871): its description and comments read as Markdown, and the fields of its right column. `key` is checked to be a ticket key before anything is asked.
#[tauri::command]
pub async fn jira_issue(app: AppHandle, key: String) -> Result<JiraIssueDetail, String> {
    let read = async { issue_detail(&saved_conn(&app).await?, &key).await };
    read.await
        .map_err(|e| log_failure("jira_issue", LOG_ACCOUNT, e))
}

#[cfg(test)]
mod tests {
    use super::*;
    use tokio::{
        io::{AsyncReadExt, AsyncWriteExt},
        net::TcpListener,
    };

    #[test]
    fn site_url_takes_an_atlassian_cloud_site_and_keeps_its_origin_only() {
        for (input, want) in [
            (
                "https://example.atlassian.net",
                "https://example.atlassian.net",
            ),
            (
                "  https://example.atlassian.net/  ",
                "https://example.atlassian.net",
            ),
            (
                "https://Example.Atlassian.net/jira/software?x=1#y",
                "https://example.atlassian.net",
            ),
            (
                "https://my-team2.atlassian.net:443",
                "https://my-team2.atlassian.net",
            ),
        ] {
            assert_eq!(site_url(input).as_deref(), Ok(want), "{input}");
        }
    }

    #[test]
    fn site_url_refuses_every_other_destination() {
        for input in [
            "",
            "example.atlassian.net",
            "http://example.atlassian.net",
            "https://atlassian.net",
            "https://.atlassian.net",
            "https://example.com",
            "https://example.atlassian.net.evil.example",
            "https://evil.example/.atlassian.net",
            "https://example.atlassian.net@evil.example",
            "https://evil.example@example.atlassian.net",
            "https://a.b.atlassian.net",
            "https://example.atlassian.net:8443",
            "https://example.atlassian.net.",
            "https://-example.atlassian.net",
            "https://exa_mple.atlassian.net",
            "ftp://example.atlassian.net",
            "https://127.0.0.1",
        ] {
            assert!(site_url(input).is_err(), "{input}");
        }
    }

    #[test]
    fn email_of_allows_none_and_refuses_what_would_break_a_credential() {
        assert_eq!(email_of(""), Ok(String::new()));
        assert_eq!(email_of("  "), Ok(String::new()));
        assert_eq!(email_of(" me@example.com "), Ok("me@example.com".into()));
        for input in ["me", "me@exa mple.com", "a:b@example.com"] {
            assert!(email_of(input).is_err(), "{input:?}");
        }
    }

    #[test]
    fn token_of_trims_and_takes_printable_ascii_only() {
        assert_eq!(token_of(""), Ok(None));
        assert_eq!(token_of("  \n"), Ok(None));
        assert_eq!(token_of(" ATATT3x-abc=\n"), Ok(Some("ATATT3x-abc=".into())));
        assert!(token_of("ab cd").is_err());
        assert!(token_of("ab\ncd").is_err());
        assert!(token_of("トークン").is_err());
    }

    #[test]
    fn authorization_is_bearer_without_an_email_and_basic_with_one() {
        assert_eq!(authorization("", "tok"), "Bearer tok");
        // base64("me@example.com:tok")
        assert_eq!(
            authorization("me@example.com", "tok"),
            "Basic bWVAZXhhbXBsZS5jb206dG9r"
        );
    }

    #[test]
    fn user_of_reads_a_success_and_says_why_for_a_failure() {
        let ok = user_of(
            200,
            r#"{"accountId":"1","displayName":"Example User","emailAddress":"me@example.com"}"#,
        );
        assert_eq!(
            ok,
            Ok(JiraUser {
                display_name: "Example User".into(),
                email_address: Some("me@example.com".into())
            })
        );
        // A scoped token may be given no email address.
        assert_eq!(
            user_of(200, r#"{"displayName":"Example User"}"#),
            Ok(JiraUser {
                display_name: "Example User".into(),
                email_address: None
            })
        );
        assert!(user_of(200, "<html>login</html>")
            .unwrap_err()
            .starts_with("Jira の応答を読めません"));
        assert_eq!(
            user_of(401, "{}"),
            Err("Jira が認証を拒否しました（401）".into())
        );
        assert_eq!(
            user_of(403, "{}"),
            Err("Jira が認証を拒否しました（403）".into())
        );
        assert_eq!(
            user_of(500, "down"),
            Err("Jira が 500 を返しました: down".into())
        );
        let long = "x".repeat(BODY_LIMIT + 50);
        assert_eq!(
            user_of(502, &long).unwrap_err(),
            format!("Jira が 502 を返しました: {}", "x".repeat(BODY_LIMIT))
        );
    }

    #[test]
    fn checked_form_checks_each_field_and_keeps_an_empty_token_as_none() {
        assert_eq!(
            checked_form("https://example.atlassian.net/x", "", ""),
            Ok(("https://example.atlassian.net".into(), String::new(), None))
        );
        assert_eq!(
            checked_form("https://example.atlassian.net", "me@example.com", " tok "),
            Ok((
                "https://example.atlassian.net".into(),
                "me@example.com".into(),
                Some("tok".into())
            ))
        );
        assert!(checked_form("https://example.com", "", "tok").is_err());
        assert!(checked_form("https://example.atlassian.net", "me", "tok").is_err());
        assert!(checked_form("https://example.atlassian.net", "", "a b").is_err());
    }

    fn temp_dir(name: &str) -> std::path::PathBuf {
        let dir =
            std::env::temp_dir().join(format!("tsunagiai-test-{}-jira-{name}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        dir
    }

    #[test]
    fn the_file_round_trips_holds_no_token_and_is_empty_before_the_first_save() {
        let dir = temp_dir("file");
        assert_eq!(load_file(&dir), Ok(Saved::default()));
        let saved = Saved {
            site: "https://example.atlassian.net".into(),
            email: "me@example.com".into(),
        };
        save_file(&dir, &saved).unwrap();
        assert_eq!(load_file(&dir), Ok(saved));
        let text = std::fs::read_to_string(dir.join(FILE)).unwrap();
        assert!(!text.to_lowercase().contains("token"));
        std::fs::write(dir.join(FILE), "not json").unwrap();
        assert!(load_file(&dir).unwrap_err().contains("形式が不正"));
        std::fs::remove_dir_all(&dir).unwrap();
    }

    /// Serves one answer on a local port, and returns the base URL and what the request said.
    async fn serve_once(answer: String) -> (String, tokio::task::JoinHandle<String>) {
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

    const OK_BODY: &str = r#"{"displayName":"Example User","emailAddress":"a@b.cc"}"#;

    fn ok_answer() -> String {
        format!(
            "HTTP/1.1 200 OK\r\nContent-Type: application/json\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{OK_BODY}",
            OK_BODY.len()
        )
    }

    const TENANT_ANSWER_ID: &str = "11111111-2222-3333-4444-555555555555";

    fn json_answer(body: &str) -> String {
        format!(
            "HTTP/1.1 200 OK\r\nContent-Type: application/json\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{body}",
            body.len()
        )
    }

    fn tenant_answer() -> String {
        json_answer(&format!(r#"{{"cloudId":"{TENANT_ANSWER_ID}"}}"#))
    }

    const NOT_FOUND: &str =
        "HTTP/1.1 404 Not Found\r\nContent-Length: 0\r\nConnection: close\r\n\r\n";

    /// The first line and the headers of a request, lowercased.
    fn lower(request: &str) -> String {
        request.to_lowercase()
    }

    #[test]
    fn cloud_id_of_takes_a_cloud_id_and_refuses_what_cannot_go_into_a_url() {
        assert_eq!(
            cloud_id_of(200, r#"{"cloudId":"a436116f-02ce-4520-8fbb-7301462a1674"}"#),
            Ok("a436116f-02ce-4520-8fbb-7301462a1674".into())
        );
        for body in [
            r#"{"cloudId":""}"#,
            r#"{"cloudId":"a/../b"}"#,
            r#"{"cloudId":"a b"}"#,
            r#"{"cloudId":"a?x=1"}"#,
            r#"{"cloudId":"é"}"#,
            r#"{}"#,
            "<html></html>",
        ] {
            assert!(cloud_id_of(200, body).is_err(), "{body}");
        }
        let long = format!(r#"{{"cloudId":"{}"}}"#, "a".repeat(CLOUD_ID_LIMIT + 1));
        assert!(cloud_id_of(200, &long).is_err());
        assert_eq!(
            cloud_id_of(404, "<html></html>"),
            Err("Jira のサイトを確かめられません（404）".into())
        );
    }

    #[tokio::test]
    async fn api_base_is_the_site_itself_for_a_basic_credential_and_asks_nothing() {
        // The gateway is a host that does not exist, so a call to it would fail.
        let http = client().unwrap();
        let base = api_base(
            &http,
            "https://example.atlassian.net",
            "me@example.com",
            "http://gateway.invalid",
        )
        .await;
        assert_eq!(base, Ok("https://example.atlassian.net".into()));
    }

    #[tokio::test]
    async fn api_base_for_a_bearer_credential_is_the_gateway_with_the_cloud_id_of_the_site() {
        let (site, seen) = serve_once(tenant_answer()).await;
        let http = client().unwrap();
        let base = api_base(&http, &site, "", "https://api.example.invalid")
            .await
            .unwrap();
        assert_eq!(
            base,
            format!("https://api.example.invalid/ex/jira/{TENANT_ANSWER_ID}")
        );
        let request = lower(&seen.await.unwrap());
        assert!(
            request.starts_with("get /_edge/tenant_info http/1.1"),
            "{request}"
        );
        // The site is asked who it is with no credential at all.
        assert!(!request.contains("authorization"), "{request}");
    }

    #[tokio::test]
    async fn api_base_stops_when_the_site_does_not_answer_with_a_cloud_id() {
        let http = client().unwrap();
        let (site, _seen) = serve_once(NOT_FOUND.into()).await;
        assert_eq!(
            api_base(&http, &site, "", "http://gateway.invalid").await,
            Err("Jira のサイトを確かめられません（404）".into())
        );
        let (site, _seen) = serve_once(json_answer(r#"{"cloudId":"a/b"}"#)).await;
        assert!(api_base(&http, &site, "", "http://gateway.invalid")
            .await
            .is_err());
    }

    #[tokio::test]
    async fn check_sends_a_basic_credential_to_the_site_and_reads_the_user() {
        let (site, seen) = serve_once(ok_answer()).await;
        let user = check(&site, "me@example.com", "tok", "http://gateway.invalid")
            .await
            .unwrap();
        assert_eq!(user.display_name, "Example User");
        let request = lower(&seen.await.unwrap());
        assert!(
            request.starts_with("get /rest/api/3/myself http/1.1"),
            "{request}"
        );
        assert!(
            request.contains("authorization: basic bwvazxhhbxbszs5jb206dg9r"),
            "{request}"
        );
    }

    #[tokio::test]
    async fn check_sends_a_bearer_credential_to_the_gateway_and_none_to_the_site() {
        let (site, tenant_seen) = serve_once(tenant_answer()).await;
        let (gateway, gateway_seen) = serve_once(ok_answer()).await;
        let user = check(&site, "", "tok", &gateway).await.unwrap();
        assert_eq!(user.display_name, "Example User");
        let request = lower(&gateway_seen.await.unwrap());
        assert!(
            request.starts_with(&format!(
                "get /ex/jira/{TENANT_ANSWER_ID}/rest/api/3/myself http/1.1"
            )),
            "{request}"
        );
        assert!(
            request.contains("authorization: bearer tok\r\n"),
            "{request}"
        );
        let tenant = lower(&tenant_seen.await.unwrap());
        assert!(
            !tenant.contains("authorization") && !tenant.contains("tok"),
            "{tenant}"
        );
    }

    #[tokio::test]
    async fn check_reports_a_rejected_credential() {
        let (site, _seen) = serve_once(
            "HTTP/1.1 401 Unauthorized\r\nContent-Length: 0\r\nConnection: close\r\n\r\n".into(),
        )
        .await;
        let err = check(&site, "me@example.com", "bad", "http://gateway.invalid")
            .await
            .unwrap_err();
        assert_eq!(err, "Jira が認証を拒否しました（401）");
    }

    #[tokio::test]
    async fn check_does_not_follow_a_redirect_of_either_call() {
        let redirect = "HTTP/1.1 302 Found\r\nLocation: http://127.0.0.1:1/elsewhere\r\nContent-Length: 0\r\nConnection: close\r\n\r\n";
        let (site, seen) = serve_once(redirect.into()).await;
        let err = check(&site, "me@example.com", "tok", "http://gateway.invalid")
            .await
            .unwrap_err();
        assert_eq!(err, "Jira が 302 を返しました: ");
        assert!(seen.await.unwrap().starts_with("GET /rest/api/3/myself"));
        let (site, seen) = serve_once(redirect.into()).await;
        let err = check(&site, "", "tok", "http://gateway.invalid")
            .await
            .unwrap_err();
        assert_eq!(err, "Jira のサイトを確かめられません（302）");
        assert!(seen.await.unwrap().starts_with("GET /_edge/tenant_info"));
    }

    #[tokio::test]
    async fn check_reports_a_host_that_cannot_be_reached() {
        let port = std::net::TcpListener::bind("127.0.0.1:0")
            .unwrap()
            .local_addr()
            .unwrap()
            .port();
        let site = format!("http://127.0.0.1:{port}");
        assert!(
            !check(&site, "me@example.com", "tok", "http://gateway.invalid")
                .await
                .unwrap_err()
                .is_empty()
        );
        assert!(!check(&site, "", "tok", "http://gateway.invalid")
            .await
            .unwrap_err()
            .is_empty());
    }

    /// Serves one answer for each connection, in order, and returns the base URL and the requests that came.
    async fn serve_each(answers: Vec<String>) -> (String, tokio::task::JoinHandle<Vec<String>>) {
        let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
        let base = format!("http://{}", listener.local_addr().unwrap());
        let seen = tokio::spawn(async move {
            let mut requests = Vec::new();
            for answer in answers {
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
                requests.push(lower(&String::from_utf8_lossy(&request)));
            }
            requests
        });
        (base, seen)
    }

    const BASIC: &str = "authorization: basic bwvazxhhbxbszs5jb206dg9r";

    async fn basic_conn(site: &str) -> Conn {
        connect(site, "me@example.com", "tok", "http://gateway.invalid")
            .await
            .unwrap()
    }

    #[test]
    fn next_start_goes_on_by_what_was_received_and_stops_at_the_end() {
        let page = |len: usize, total, is_last| Page::<u8> {
            items: vec![0; len],
            total,
            is_last,
        };
        assert_eq!(next_start(0, &page(2, None, Some(false))), Some(2));
        assert_eq!(next_start(2, &page(2, None, None)), Some(4));
        assert_eq!(next_start(0, &page(2, Some(5), None)), Some(2));
        assert_eq!(next_start(4, &page(1, Some(5), None)), None);
        assert_eq!(next_start(0, &page(2, Some(5), Some(true))), None);
        assert_eq!(next_start(0, &page(0, Some(5), Some(false))), None);
    }

    #[test]
    fn page_of_reads_values_or_issues_and_says_why_for_a_failure() {
        let boards = page_of::<JiraBoard>(
            200,
            r#"{"isLast":true,"maxResults":50,"startAt":0,"total":2,"values":[{"id":84,"name":"scrum board","type":"scrum","self":"https://x"},{"id":92,"type":"kanban"}]}"#,
        )
        .unwrap();
        assert_eq!(
            boards.items,
            vec![
                JiraBoard {
                    id: 84,
                    name: "scrum board".into(),
                    board_type: "scrum".into()
                },
                JiraBoard {
                    id: 92,
                    name: String::new(),
                    board_type: "kanban".into()
                }
            ]
        );
        assert_eq!((boards.total, boards.is_last), (Some(2), Some(true)));
        let issues = page_of::<RawIssue>(
            200,
            r#"{"startAt":0,"maxResults":50,"total":1,"issues":[{"key":"A-1"}]}"#,
        )
        .unwrap();
        assert_eq!(issues.items.len(), 1);
        assert!(page_of::<JiraBoard>(200, "{}").unwrap().items.is_empty());
        assert!(page_of::<JiraBoard>(200, "<html></html>")
            .err()
            .unwrap()
            .starts_with("Jira の応答を読めません"));
        assert_eq!(
            page_of::<JiraBoard>(401, "{}").err(),
            Some("Jira が認証を拒否しました（401）".into())
        );
        assert_eq!(
            page_of::<JiraBoard>(404, "no board").err(),
            Some("Jira が 404 を返しました: no board".into())
        );
    }

    #[test]
    fn sprints_are_read_with_or_without_dates() {
        let page = page_of::<JiraSprint>(
            200,
            r#"{"isLast":true,"values":[{"id":37,"self":"https://x","state":"active","name":"sprint 1","startDate":"2015-04-11T15:22:00.000+10:00","endDate":"2015-04-20T01:22:00.000+10:00","originBoardId":5,"goal":"g"},{"id":72,"state":"future","name":"sprint 2"}]}"#,
        )
        .unwrap();
        assert_eq!(
            page.items,
            vec![
                JiraSprint {
                    id: 37,
                    name: "sprint 1".into(),
                    state: "active".into(),
                    start_date: Some("2015-04-11T15:22:00.000+10:00".into()),
                    end_date: Some("2015-04-20T01:22:00.000+10:00".into()),
                },
                JiraSprint {
                    id: 72,
                    name: "sprint 2".into(),
                    state: "future".into(),
                    start_date: None,
                    end_date: None,
                }
            ]
        );
    }

    #[test]
    fn issue_of_takes_the_five_fields_and_leaves_out_what_jira_did_not_give() {
        let raw = |json: &str| serde_json::from_str::<RawIssue>(json).unwrap();
        assert_eq!(
            issue_of(raw(
                r#"{"id":"10001","key":"HSP-1","self":"https://x","fields":{"summary":"Fix it","status":{"name":"In Progress","statusCategory":{"key":"indeterminate","name":"In Progress"}},"assignee":{"accountId":"1","displayName":"Mia Krystof"},"priority":{"name":"High","id":"2"},"flagged":true}}"#
            )),
            JiraIssue {
                key: "HSP-1".into(),
                summary: "Fix it".into(),
                status: "In Progress".into(),
                status_category: "indeterminate".into(),
                assignee: Some("Mia Krystof".into()),
                priority: Some("High".into()),
            }
        );
        // An unassigned ticket has a null assignee, and a project may have no priority field.
        assert_eq!(
            issue_of(raw(
                r#"{"key":"HSP-2","fields":{"summary":"s","status":{"name":"Done","statusCategory":{"key":"done"}},"assignee":null}}"#
            )),
            JiraIssue {
                key: "HSP-2".into(),
                summary: "s".into(),
                status: "Done".into(),
                status_category: "done".into(),
                assignee: None,
                priority: None,
            }
        );
        assert_eq!(
            issue_of(raw(r#"{"key":"HSP-3","fields":null}"#)),
            JiraIssue {
                key: "HSP-3".into(),
                summary: String::new(),
                status: String::new(),
                status_category: "undefined".into(),
                assignee: None,
                priority: None,
            }
        );
    }

    #[test]
    fn saved_connection_needs_a_site_and_a_token() {
        let saved = |site: &str| Saved {
            site: site.into(),
            email: "me@example.com".into(),
        };
        assert_eq!(
            saved_connection(saved("https://example.atlassian.net"), Some("tok".into())),
            Ok((
                "https://example.atlassian.net".into(),
                "me@example.com".into(),
                "tok".into()
            ))
        );
        assert_eq!(
            saved_connection(Saved::default(), Some("tok".into())),
            Err(NOT_SAVED.into())
        );
        assert_eq!(
            saved_connection(saved("https://example.atlassian.net"), None),
            Err(TOKEN_MISSING.into())
        );
    }

    #[tokio::test]
    async fn boards_are_read_by_name_page_by_page_with_the_credential() {
        let first = json_answer(
            r#"{"isLast":false,"maxResults":2,"startAt":0,"total":3,"values":[{"id":1,"name":"A","type":"scrum"},{"id":2,"name":"B","type":"kanban"}]}"#,
        );
        let second = json_answer(
            r#"{"isLast":true,"maxResults":2,"startAt":2,"total":3,"values":[{"id":3,"name":"C","type":"simple"}]}"#,
        );
        let (site, seen) = serve_each(vec![first, second]).await;
        let list = boards(&basic_conn(&site).await).await.unwrap();
        assert_eq!(list.iter().map(|b| b.id).collect::<Vec<_>>(), vec![1, 2, 3]);
        assert_eq!(list[1].board_type, "kanban");
        let requests = seen.await.unwrap();
        assert!(
            requests[0].starts_with(
                "get /rest/agile/1.0/board?orderby=name&startat=0&maxresults=50 http/1.1"
            ),
            "{}",
            requests[0]
        );
        assert!(
            requests[1].starts_with(
                "get /rest/agile/1.0/board?orderby=name&startat=2&maxresults=50 http/1.1"
            ),
            "{}",
            requests[1]
        );
        assert!(requests.iter().all(|r| r.contains(BASIC)));
    }

    #[tokio::test]
    async fn sprints_of_a_board_are_asked_through_the_gateway_for_a_bearer_credential() {
        let (site, tenant_seen) = serve_once(tenant_answer()).await;
        let (gateway, seen) = serve_each(vec![json_answer(
            r#"{"isLast":true,"values":[{"id":37,"state":"active","name":"sprint 1"}]}"#,
        )])
        .await;
        let conn = connect(&site, "", "tok", &gateway).await.unwrap();
        let list = sprints(&conn, 7).await.unwrap();
        assert_eq!(list.len(), 1);
        assert_eq!(list[0].state, "active");
        let requests = seen.await.unwrap();
        assert!(
            requests[0].starts_with(&format!(
                "get /ex/jira/{TENANT_ANSWER_ID}/rest/agile/1.0/board/7/sprint?state=active,future&startat=0&maxresults=50 http/1.1"
            )),
            "{}",
            requests[0]
        );
        assert!(requests[0].contains("authorization: bearer tok\r\n"));
        assert!(!lower(&tenant_seen.await.unwrap()).contains("authorization"));
    }

    #[tokio::test]
    async fn the_tickets_of_a_sprint_and_of_a_backlog_come_with_the_five_fields() {
        let body = r#"{"expand":"schema,names","startAt":0,"maxResults":50,"total":2,"issues":[{"key":"HSP-1","fields":{"summary":"One","status":{"name":"To Do","statusCategory":{"key":"new"}},"assignee":{"displayName":"Mia"},"priority":{"name":"Low"}}},{"key":"HSP-2","fields":{"summary":"Two","status":{"name":"Done","statusCategory":{"key":"done"}},"assignee":null,"priority":null}}]}"#;
        // One answer each: the total is reached on the first page, so no second page is asked.
        let (site, seen) = serve_each(vec![json_answer(body), json_answer(body)]).await;
        let conn = basic_conn(&site).await;
        let sprint = sprint_issues(&conn, 12).await.unwrap();
        let back = backlog(&conn, 7).await.unwrap();
        assert_eq!(sprint, back);
        assert!(!sprint.truncated);
        assert_eq!(sprint.issues[0].key, "HSP-1");
        assert_eq!(sprint.issues[0].assignee.as_deref(), Some("Mia"));
        assert_eq!(sprint.issues[1].status_category, "done");
        assert_eq!(sprint.issues[1].priority, None);
        let requests = seen.await.unwrap();
        assert!(
            requests[0].starts_with("get /rest/agile/1.0/sprint/12/issue?fields=summary,status,assignee,priority&startat=0&maxresults=50 http/1.1"),
            "{}",
            requests[0]
        );
        assert!(
            requests[1].starts_with("get /rest/agile/1.0/board/7/backlog?fields=summary,status,assignee,priority&startat=0&maxresults=50 http/1.1"),
            "{}",
            requests[1]
        );
    }

    #[tokio::test]
    async fn fetch_all_stops_at_the_limit_and_says_that_more_were_left() {
        let page = |ids: [u32; 2], total: u32| {
            json_answer(&format!(
                r#"{{"isLast":false,"total":{total},"values":[{{"id":{},"name":"a"}},{{"id":{},"name":"b"}}]}}"#,
                ids[0], ids[1]
            ))
        };
        // The second page would not be asked for after the limit; it is not served.
        let (site, seen) = serve_each(vec![page([1, 2], 9), page([3, 4], 9)]).await;
        let conn = basic_conn(&site).await;
        let (items, truncated) = fetch_all::<JiraBoard>(&conn, BOARD_PATH, "orderBy=name", 3)
            .await
            .unwrap();
        assert_eq!(
            items.iter().map(|b| b.id).collect::<Vec<_>>(),
            vec![1, 2, 3]
        );
        assert!(truncated);
        assert_eq!(seen.await.unwrap().len(), 2);
        // A list that ends exactly at the limit is not truncated.
        let (site, _seen) = serve_each(vec![json_answer(
            r#"{"isLast":true,"values":[{"id":1},{"id":2}]}"#,
        )])
        .await;
        let (items, truncated) =
            fetch_all::<JiraBoard>(&basic_conn(&site).await, BOARD_PATH, "orderBy=name", 2)
                .await
                .unwrap();
        assert_eq!(items.len(), 2);
        assert!(!truncated);
    }

    #[tokio::test]
    async fn a_refused_read_is_the_error_and_a_redirect_is_not_followed() {
        let (site, _seen) = serve_each(vec![
            "HTTP/1.1 404 Not Found\r\nContent-Length: 0\r\nConnection: close\r\n\r\n".into(),
        ])
        .await;
        assert_eq!(
            sprint_issues(&basic_conn(&site).await, 99).await,
            Err("Jira が 404 を返しました: ".into())
        );
        let redirect = "HTTP/1.1 302 Found\r\nLocation: http://127.0.0.1:1/elsewhere\r\nContent-Length: 0\r\nConnection: close\r\n\r\n";
        let (site, seen) = serve_each(vec![redirect.into()]).await;
        assert_eq!(
            backlog(&basic_conn(&site).await, 7).await,
            Err("Jira が 302 を返しました: ".into())
        );
        assert_eq!(seen.await.unwrap().len(), 1);
    }

    const ISSUE_BODY: &str = r#"{"id":"10007","key":"EX-7","fields":{"summary":"Show the ticket","description":{"version":1,"type":"doc","content":[{"type":"paragraph","content":[{"type":"text","text":"Body *x*"}]}]},"status":{"name":"In Progress","statusCategory":{"key":"indeterminate"}},"assignee":{"displayName":"Mia"},"priority":{"name":"High"},"labels":["ui","ready"],"parent":{"id":"10000","key":"EX-1","fields":{"summary":"The epic","status":{"name":"To Do"}}}}}"#;
    const SPRINT_BODY: &str = r#"{"id":"10007","key":"EX-7","fields":{"sprint":{"id":12,"name":"Sprint 12","state":"active"},"closedSprints":[{"id":11,"name":"Sprint 11"}]}}"#;
    const COMMENTS_BODY: &str = r#"{"startAt":0,"maxResults":50,"total":2,"comments":[{"id":"1","author":{"displayName":"Ann","accountId":"a"},"body":{"version":1,"type":"doc","content":[{"type":"paragraph","content":[{"type":"text","text":"Looks good"}]}]},"created":"2026-11-20T09:30:12.345+0900","updated":"2026-11-20T09:30:12.345+0900"},{"id":"2","body":null,"created":"2026-11-21T18:05:00.000+0900"}]}"#;

    #[test]
    fn key_of_takes_a_ticket_key_and_refuses_what_must_not_reach_a_path() {
        for key in ["EX-1", "ABC_D2-1234567", "A-0"] {
            assert_eq!(key_of(key), Ok(key), "{key}");
        }
        for key in [
            "",
            "EX",
            "EX-",
            "-1",
            "ex-1",
            "1X-1",
            "_X-1",
            "EX-1a",
            "EX--1",
            "EX-1-2",
            "E X-1",
            "EX-1/comment",
            "EX-1?x=1",
            "EX-1#",
            "../EX-1",
            "EX-1%2F",
            "Ｅ-1",
            "EX-１",
        ] {
            assert!(key_of(key).is_err(), "{key:?}");
        }
        assert!(key_of(&format!("A-{}", "1".repeat(KEY_LIMIT))).is_err());
        assert_eq!(
            key_of("x"),
            Err("チケットのキーの形が正しくありません".into())
        );
    }

    #[test]
    fn shown_time_keeps_the_date_and_the_minute_in_the_offset_jira_gave() {
        assert_eq!(
            shown_time("2026-11-20T09:30:12.345+0900"),
            "2026-11-20 09:30"
        );
        assert_eq!(
            shown_time("2026-11-20T23:59:59.000-0500"),
            "2026-11-20 23:59"
        );
        assert_eq!(shown_time("2026-11-20T09:30"), "2026-11-20 09:30");
        assert_eq!(shown_time(""), "");
        assert_eq!(shown_time("yesterday"), "yesterday");
        assert_eq!(shown_time("2026-11-20 09:30:12"), "2026-11-20 09:30:12");
        assert_eq!(
            shown_time("日本語のとても長い文字列です。"),
            "日本語のとても長い文字列です。"
        );
    }

    #[test]
    fn sprint_of_reads_the_sprint_of_a_ticket_and_says_why_for_a_failure() {
        assert_eq!(sprint_of(200, SPRINT_BODY), Ok(Some("Sprint 12".into())));
        assert_eq!(sprint_of(200, r#"{"fields":{"sprint":null}}"#), Ok(None));
        assert_eq!(sprint_of(200, r#"{"fields":{}}"#), Ok(None));
        assert_eq!(
            sprint_of(200, r#"{"fields":{"sprint":{"name":""}}}"#),
            Ok(None)
        );
        assert_eq!(sprint_of(200, "{}"), Ok(None));
        assert!(sprint_of(200, "<html>")
            .unwrap_err()
            .starts_with("Jira の応答を読めません"));
        assert_eq!(
            sprint_of(403, "no"),
            Err("Jira が認証を拒否しました（403）".into())
        );
        assert_eq!(
            sprint_of(404, r#"{"errorMessages":["Issue does not exist"]}"#),
            Err(r#"Jira が 404 を返しました: {"errorMessages":["Issue does not exist"]}"#.into())
        );
    }

    #[test]
    fn raw_issue_of_reads_a_ticket_and_says_why_for_a_failure() {
        assert_eq!(raw_issue_of(200, ISSUE_BODY).unwrap().key, "EX-7");
        let fail = |status, body| raw_issue_of(status, body).err().unwrap_or_default();
        assert!(fail(200, "[]").starts_with("Jira の応答を読めません"));
        assert_eq!(fail(401, ""), "Jira が認証を拒否しました（401）");
        assert_eq!(fail(500, "boom"), "Jira が 500 を返しました: boom");
    }

    #[test]
    fn detail_of_gathers_the_fields_the_description_and_the_comments() {
        let comments: Page<RawComment> = serde_json::from_str(COMMENTS_BODY).unwrap();
        let detail = detail_of(
            raw_issue_of(200, ISSUE_BODY).unwrap(),
            Some("Sprint 12".into()),
            comments.items,
            true,
        );
        assert_eq!(
            detail,
            JiraIssueDetail {
                key: "EX-7".into(),
                summary: "Show the ticket".into(),
                description: "Body \\*x\\*".into(),
                status: "In Progress".into(),
                status_category: "indeterminate".into(),
                assignee: Some("Mia".into()),
                priority: Some("High".into()),
                sprint: Some("Sprint 12".into()),
                labels: vec!["ui".into(), "ready".into()],
                parent: Some(JiraParent {
                    key: "EX-1".into(),
                    summary: "The epic".into()
                }),
                comments: vec![
                    JiraComment {
                        author: "Ann".into(),
                        created: "2026-11-20 09:30".into(),
                        body: "Looks good".into()
                    },
                    JiraComment {
                        author: String::new(),
                        created: "2026-11-21 18:05".into(),
                        body: String::new()
                    },
                ],
                comments_truncated: true,
            }
        );
    }

    #[test]
    fn detail_of_leaves_out_what_jira_did_not_give() {
        let raw: RawIssue = serde_json::from_str(r#"{"key":"EX-8","fields":{"summary":"Bare","description":null,"labels":[],"parent":{"key":"EX-2"}}}"#).unwrap();
        let detail = detail_of(raw, None, Vec::new(), false);
        assert_eq!(detail.description, "");
        assert_eq!(detail.status, "");
        assert_eq!(detail.status_category, "undefined");
        assert_eq!(
            (detail.assignee, detail.priority, detail.sprint),
            (None, None, None)
        );
        assert!(detail.labels.is_empty() && detail.comments.is_empty());
        assert_eq!(
            detail.parent,
            Some(JiraParent {
                key: "EX-2".into(),
                summary: String::new()
            })
        );
        let none: RawIssue = serde_json::from_str(r#"{"key":"EX-9"}"#).unwrap();
        let detail = detail_of(none, None, Vec::new(), false);
        assert_eq!(
            (detail.key.as_str(), detail.parent, detail.labels),
            ("EX-9", None, Vec::new())
        );
    }

    #[tokio::test]
    async fn a_ticket_is_read_with_its_sprint_and_its_comments_through_the_three_paths() {
        let (site, seen) = serve_each(vec![
            json_answer(ISSUE_BODY),
            json_answer(SPRINT_BODY),
            json_answer(COMMENTS_BODY),
        ])
        .await;
        let detail = issue_detail(&basic_conn(&site).await, "EX-7")
            .await
            .unwrap();
        assert_eq!(detail.key, "EX-7");
        assert_eq!(detail.sprint.as_deref(), Some("Sprint 12"));
        assert_eq!(detail.comments.len(), 2);
        assert!(!detail.comments_truncated);
        let requests = seen.await.unwrap();
        assert!(requests[0].starts_with("get /rest/api/3/issue/ex-7?fields=summary,description,status,assignee,priority,labels,parent http/1.1"), "{}", requests[0]);
        assert!(
            requests[1].starts_with("get /rest/agile/1.0/issue/ex-7?fields=sprint http/1.1"),
            "{}",
            requests[1]
        );
        assert!(requests[2].starts_with("get /rest/api/3/issue/ex-7/comment?orderby=created&startat=0&maxresults=50 http/1.1"), "{}", requests[2]);
        for request in &requests {
            assert!(request.contains(BASIC), "{request}");
        }
    }

    #[tokio::test]
    async fn a_ticket_with_a_bad_key_asks_nothing_and_a_refused_read_stops_the_rest() {
        let conn = basic_conn("http://127.0.0.1:1").await;
        assert_eq!(
            issue_detail(&conn, "../x").await,
            Err("チケットのキーの形が正しくありません".into())
        );
        let (site, seen) = serve_each(vec![
            "HTTP/1.1 404 Not Found\r\nContent-Length: 0\r\nConnection: close\r\n\r\n".into(),
        ])
        .await;
        assert_eq!(
            issue_detail(&basic_conn(&site).await, "EX-404").await,
            Err("Jira が 404 を返しました: ".into())
        );
        assert_eq!(seen.await.unwrap().len(), 1);
        // A refusal of the sprint, or of the comments, is the failure of the whole read.
        let (site, _seen) = serve_each(vec![
            json_answer(ISSUE_BODY),
            "HTTP/1.1 403 Forbidden\r\nContent-Length: 0\r\nConnection: close\r\n\r\n".into(),
        ])
        .await;
        assert_eq!(
            issue_detail(&basic_conn(&site).await, "EX-7").await,
            Err("Jira が認証を拒否しました（403）".into())
        );
    }
}
