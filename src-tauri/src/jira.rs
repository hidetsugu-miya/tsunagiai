//! The connection to Jira Cloud (J-1, #868, #1393): for each project of each environment (the key of `lsp.rs`'s settings: where the project is, `None` for this machine, and its key in Orca's list), the site's URL, the email address and the board it shows in `jira-connections.json` of the app config directory, the API token in the keychain under the same key, and a test of the connection. The one connection that J-1 kept before the projects (`jira-settings.json` and the token under the user `api-token`) is removed at each start (`remove_legacy`).
//!
//! Only Atlassian Cloud is spoken to: the site is `https://{name}.atlassian.net` and nothing else (`site_url`), and a token goes to that site or to `api.atlassian.com` only, never to another host.
//! An email address makes the token a Basic credential (`email:token`, an API token of an account) sent to the site; with none it is a Bearer token (a scoped token) sent through the gateway `api.atlassian.com/ex/jira/{cloudId}`, which is the only place Atlassian takes it (`api_base` chooses).
//! The token is never returned to the screen, logged or written to a file; a save with no token keeps the stored one. The saved site and email address are checked again (`site_url`, `email_of`) before a token is sent with them (`saved_connection`).
//!
//! The boards, the sprints and their tickets are read through the Agile API (`/rest/agile/1.0`, J-2, #869): the commands `jira_boards`, `jira_sprints`, `jira_sprint_issues` and `jira_backlog` read the saved connection and call it where `api_base` says. They only read; the answers are turned into the types below by pure functions.
//! A ticket is read for its tab (J-2, #871) by `jira_issue`: the ticket with its description (REST API v3, where the description is ADF, read as Markdown by `adf`), its sprint (the Agile API) and its comments.
//! The tab changes four fields of a ticket (J-2, #872): the status (`jira_transitions` lists what the ticket can take now and `jira_transition` takes one), the assignee (`jira_assignable`, `jira_assign`), the priority (`jira_priorities`, `jira_set_priority`) and the sprint (`jira_set_sprint`). These are the calls that write to Jira, with the two of #873 below; every id that reaches a path or a body is checked first (`key_of`, `numeric_id_of`, `account_id_of`).
//! The tab also saves the description (`jira_set_description`) and adds a comment (`jira_add_comment`, J-2, #873): the Markdown of the editor is turned back into ADF by `markdown` (a pure function), the description being put into the document that Jira holds now so that what Markdown cannot say stays.

mod adf;
mod markdown;

use std::{path::Path, sync::Mutex, time::Duration};

use base64::{engine::general_purpose::STANDARD, Engine};
use reqwest::header::{HeaderValue, ACCEPT, AUTHORIZATION, CONTENT_TYPE};
use serde::{de::DeserializeOwned, Deserialize, Serialize};
use serde_json::Value;
use tauri::AppHandle;
#[cfg(test)]
use ts_rs::TS;
use url::Url;

use crate::{accounts::write_atomic, auth::config_dir, gmail::log_failure, keychain};

const FILE: &str = "jira-connections.json";
const VERSION: u32 = 1;
/// The file and the token user of the one connection before the projects (J-1, #868), which are removed.
const LEGACY_FILE: &str = "jira-settings.json";
const LEGACY_TOKEN_USER: &str = "api-token";
/// The keychain service of the API tokens; the user is the key of the project (`token_user`).
const TOKEN_SERVICE: &str = "jp.mysis.tsunagiai.jira";
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
const COPY_SAME_PLACE: &str = "コピー元とコピー先が同じです";
const COPY_NO_TOKEN: &str = "コピー元の API トークンが保存されていません";
/// The Agile API, after `api_base`.
const BOARD_PATH: &str = "/rest/agile/1.0/board";
const SPRINT_PATH: &str = "/rest/agile/1.0/sprint";
const PROJECT_SEARCH_PATH: &str = "/rest/api/3/project/search";
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
/// The most people that the list of assignable users holds.
const MAX_ASSIGNABLE: usize = 100;
/// The longest id of a transition or of a priority (Jira's are numbers) and of an account taken.
const ID_LIMIT: usize = 18;
const ACCOUNT_ID_LIMIT: usize = 128;
/// The longest Markdown that is written back as ADF (J-2, #873), in bytes.
const MARKDOWN_LIMIT: usize = 200_000;
/// The projects and the issue types that the form of a new ticket offers, at most.
const MAX_PROJECTS: usize = 200;
const MAX_ISSUE_TYPES: usize = 100;
/// Jira's own limit of a summary.
const SUMMARY_LIMIT: usize = 255;

/// What `jira-connections.json` holds (version 1).
#[derive(Serialize, Deserialize, Debug, PartialEq)]
struct Store {
    version: u32,
    connections: Vec<Connection>,
}

/// The connection of the project `project` of `environment` (`None` for this machine, else the name of the saved environment), and the board it shows (`None`: none chosen).
#[derive(Serialize, Deserialize, Clone, Debug, PartialEq)]
#[serde(rename_all = "camelCase")]
struct Connection {
    environment: Option<String>,
    project: String,
    site: String,
    email: String,
    board_id: Option<u64>,
}

/// The saved connection of a project as the screen gets it: never the token, only whether one is kept.
#[derive(Serialize, Debug, PartialEq)]
#[cfg_attr(test, derive(TS))]
#[cfg_attr(test, ts(export, export_to = crate::BINDINGS))]
#[serde(rename_all = "camelCase")]
pub struct JiraSettings {
    pub site: String,
    pub email: String,
    pub has_token: bool,
    /// The board the project shows, none when none is chosen.
    #[cfg_attr(test, ts(type = "number | null"))]
    pub board_id: Option<u64>,
}

/// A connection that has a token, as the list of connections to copy from gets it: where it is and which site and email address it uses, never the token.
#[derive(Serialize, Debug, PartialEq)]
#[cfg_attr(test, derive(TS))]
#[cfg_attr(test, ts(export, export_to = crate::BINDINGS))]
#[serde(rename_all = "camelCase")]
pub struct JiraConnection {
    pub environment: Option<String>,
    pub project: String,
    pub site: String,
    pub email: String,
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

/// A change of status that the ticket can take now (J-2, #872). `status` is the name of the status it leads to and `statusCategory` the key of that status's category, the same as the list has them.
#[derive(Serialize, Debug, PartialEq)]
#[cfg_attr(test, derive(TS))]
#[cfg_attr(test, ts(export, export_to = crate::BINDINGS))]
#[serde(rename_all = "camelCase")]
pub struct JiraTransition {
    pub id: String,
    pub status: String,
    pub status_category: String,
}

/// A person that the ticket can be assigned to.
#[derive(Serialize, Debug, PartialEq)]
#[cfg_attr(test, derive(TS))]
#[cfg_attr(test, ts(export, export_to = crate::BINDINGS))]
#[serde(rename_all = "camelCase")]
pub struct JiraPerson {
    pub account_id: String,
    pub display_name: String,
}

/// A project that a ticket can be created in (J-2, #874): its id (a number, which is what Rust sends back), its key and its name.
#[derive(Serialize, Debug, PartialEq)]
#[cfg_attr(test, derive(TS))]
#[cfg_attr(test, ts(export, export_to = crate::BINDINGS))]
pub struct JiraProject {
    pub id: String,
    pub key: String,
    pub name: String,
}

/// An issue type that a ticket of the project can be created with (a subtask is left out: it needs a parent).
#[derive(Serialize, Debug, PartialEq)]
#[cfg_attr(test, derive(TS))]
#[cfg_attr(test, ts(export, export_to = crate::BINDINGS))]
pub struct JiraIssueType {
    pub id: String,
    pub name: String,
}

/// The ticket that was created (J-2, #874). `sprintError` is the reason when the ticket was made but could not be put in the sprint (the ticket exists all the same), and `null` otherwise.
#[derive(Serialize, Debug, PartialEq)]
#[cfg_attr(test, derive(TS))]
#[cfg_attr(test, ts(export, export_to = crate::BINDINGS))]
#[serde(rename_all = "camelCase")]
pub struct JiraCreated {
    pub key: String,
    pub sprint_error: Option<String>,
}

/// A priority that the ticket can be given.
#[derive(Serialize, Debug, PartialEq)]
#[cfg_attr(test, derive(TS))]
#[cfg_attr(test, ts(export, export_to = crate::BINDINGS))]
pub struct JiraPriority {
    pub id: String,
    pub name: String,
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

/// One page of the Agile API: the boards and the sprints are under `values`, the tickets under `issues` (and the comments of a ticket, of REST API v3, under `comments`, the issue types of the create metadata under `issueTypes`). Jira gives `isLast` for the first two and `total` for the last (and for some of the first).
#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct Page<T> {
    #[serde(
        default = "Vec::new",
        alias = "values",
        alias = "issues",
        alias = "comments",
        alias = "issueTypes"
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

/// A call of `path` (with its query) after the base, with the credential: the status and the body. The one place that sends it. `body` is the JSON of a write (J-2, #872), none for a read.
async fn send(
    conn: &Conn,
    method: reqwest::Method,
    path: &str,
    body: Option<&Value>,
) -> Result<(u16, String), String> {
    let mut header = HeaderValue::from_str(&conn.authorization).map_err(|e| e.to_string())?;
    header.set_sensitive(true);
    let mut request = conn
        .http
        .request(method, format!("{}{path}", conn.base))
        .header(AUTHORIZATION, header)
        .header(ACCEPT, "application/json");
    if let Some(body) = body {
        request = request
            .header(CONTENT_TYPE, "application/json")
            .body(body.to_string());
    }
    let res = request.send().await.map_err(|e| e.to_string())?;
    let status = res.status().as_u16();
    let text = res.text().await.map_err(|e| e.to_string())?;
    Ok((status, text))
}

/// A GET of `path`: the status and the body.
async fn get(conn: &Conn, path: &str) -> Result<(u16, String), String> {
    send(conn, reqwest::Method::GET, path, None).await
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

/// Reads the pages of a list one after another, until its end or until `limit` items are held; the items past `limit` are dropped and the second value says so. `query` has no `startAt` or `maxResults` (and may be empty).
async fn fetch_all<T: DeserializeOwned>(
    conn: &Conn,
    path: &str,
    query: &str,
    limit: usize,
) -> Result<(Vec<T>, bool), String> {
    let mut items = Vec::new();
    let mut start = 0;
    let join = if query.is_empty() { "" } else { "&" };
    loop {
        let (status, body) = get(
            conn,
            &format!("{path}?{query}{join}startAt={start}&maxResults={PAGE_SIZE}"),
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

/// A transition id or a priority id as the screen gives it back: Jira's are numbers, and one goes into a path or a body, so nothing else is let through.
fn numeric_id_of(input: &str) -> Result<&str, String> {
    if !input.is_empty() && input.len() <= ID_LIMIT && input.chars().all(|c| c.is_ascii_digit()) {
        Ok(input)
    } else {
        Err("ID の形が正しくありません".into())
    }
}

/// An account id as the screen gives it back: letters and digits, then also `:`, `-` and `_` (`5b10ac8d82e05b22cc7d4ef5`, `712020:{uuid}`). It starts with a letter or a digit, so that `-1` (Jira's "the default assignee") is never sent.
fn account_id_of(input: &str) -> Result<&str, String> {
    let mut chars = input.chars();
    let ok = input.len() <= ACCOUNT_ID_LIMIT
        && chars.next().is_some_and(|c| c.is_ascii_alphanumeric())
        && chars.all(|c| c.is_ascii_alphanumeric() || matches!(c, ':' | '-' | '_'));
    if ok {
        Ok(input)
    } else {
        Err("アカウント ID の形が正しくありません".into())
    }
}

/// The status changes that Jira's answer to the read of the transitions of a ticket gives: those it can take now (`isAvailable` is not false) and whose id is a number, each with the status it leads to (the name of the transition when Jira names no status).
fn transitions_of(status: u16, body: &str) -> Result<Vec<JiraTransition>, String> {
    #[derive(Deserialize)]
    struct Answer {
        #[serde(default)]
        transitions: Vec<Raw>,
    }
    #[derive(Deserialize)]
    #[serde(rename_all = "camelCase")]
    struct Raw {
        id: String,
        name: Option<String>,
        to: Option<RawStatus>,
        is_available: Option<bool>,
    }
    if !(200..=299).contains(&status) {
        return Err(failure_of(status, body));
    }
    let answer: Answer =
        serde_json::from_str(body).map_err(|e| format!("Jira の応答を読めません: {e}"))?;
    Ok(answer
        .transitions
        .into_iter()
        .filter(|t| t.is_available != Some(false) && numeric_id_of(&t.id).is_ok())
        .map(|t| {
            let to = t.to;
            let category = to
                .as_ref()
                .and_then(|s| s.status_category.as_ref())
                .and_then(|c| c.key.clone())
                .unwrap_or_else(|| "undefined".to_owned());
            JiraTransition {
                id: t.id,
                status: to
                    .and_then(|s| s.name)
                    .filter(|n| !n.is_empty())
                    .or(t.name)
                    .unwrap_or_default(),
                status_category: category,
            }
        })
        .collect())
}

/// The people that Jira's answer to the search of assignable users gives: the active ones, with an account id of the form taken and a name.
fn assignable_of(status: u16, body: &str) -> Result<Vec<JiraPerson>, String> {
    #[derive(Deserialize)]
    #[serde(rename_all = "camelCase")]
    struct Raw {
        account_id: Option<String>,
        display_name: Option<String>,
        active: Option<bool>,
    }
    if !(200..=299).contains(&status) {
        return Err(failure_of(status, body));
    }
    let people: Vec<Raw> =
        serde_json::from_str(body).map_err(|e| format!("Jira の応答を読めません: {e}"))?;
    Ok(people
        .into_iter()
        .filter(|p| p.active != Some(false))
        .filter_map(|p| {
            let account_id = p.account_id.filter(|id| account_id_of(id).is_ok())?;
            let display_name = p.display_name.filter(|n| !n.is_empty())?;
            Some(JiraPerson {
                account_id,
                display_name,
            })
        })
        .collect())
}

/// The priorities that Jira's answer to the edit metadata of a ticket allows (`fields.priority.allowedValues`): none when the ticket's priority cannot be edited by this credential. Only those with a numeric id are kept.
fn priorities_of(status: u16, body: &str) -> Result<Vec<JiraPriority>, String> {
    #[derive(Deserialize)]
    struct Allowed {
        id: Option<String>,
        name: Option<String>,
    }
    #[derive(Deserialize)]
    #[serde(rename_all = "camelCase")]
    struct Field {
        #[serde(default)]
        allowed_values: Vec<Allowed>,
    }
    #[derive(Deserialize)]
    struct Fields {
        priority: Option<Field>,
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
        .and_then(|f| f.priority)
        .map(|p| p.allowed_values)
        .unwrap_or_default()
        .into_iter()
        .filter_map(|v| {
            let id = v.id.filter(|id| numeric_id_of(id).is_ok())?;
            Some(JiraPriority {
                id,
                name: v.name.unwrap_or_default(),
            })
        })
        .collect())
}

/// What Jira's answer to a write means: any 2xx is done (Jira answers 204 with no body), the rest is the failure with its reason.
fn done_of(status: u16, body: &str) -> Result<(), String> {
    if (200..=299).contains(&status) {
        Ok(())
    } else {
        Err(failure_of(status, body))
    }
}

async fn transitions(conn: &Conn, key: &str) -> Result<Vec<JiraTransition>, String> {
    let key = key_of(key)?;
    let (status, body) = get(conn, &format!("{ISSUE_PATH}/{key}/transitions")).await?;
    transitions_of(status, &body)
}

async fn transition(conn: &Conn, key: &str, id: &str) -> Result<(), String> {
    let (key, id) = (key_of(key)?, numeric_id_of(id)?);
    let body = serde_json::json!({ "transition": { "id": id } });
    let (status, text) = send(
        conn,
        reqwest::Method::POST,
        &format!("{ISSUE_PATH}/{key}/transitions"),
        Some(&body),
    )
    .await?;
    done_of(status, &text)
}

async fn assignable(conn: &Conn, key: &str) -> Result<Vec<JiraPerson>, String> {
    let key = key_of(key)?;
    let path =
        format!("/rest/api/3/user/assignable/search?issueKey={key}&maxResults={MAX_ASSIGNABLE}");
    let (status, body) = get(conn, &path).await?;
    assignable_of(status, &body)
}

/// Assigns the ticket to the account, or to no one (`None`).
async fn assign(conn: &Conn, key: &str, account_id: Option<&str>) -> Result<(), String> {
    let key = key_of(key)?;
    let account_id = account_id.map(account_id_of).transpose()?;
    let body = serde_json::json!({ "accountId": account_id });
    let (status, text) = send(
        conn,
        reqwest::Method::PUT,
        &format!("{ISSUE_PATH}/{key}/assignee"),
        Some(&body),
    )
    .await?;
    done_of(status, &text)
}

async fn priorities(conn: &Conn, key: &str) -> Result<Vec<JiraPriority>, String> {
    let key = key_of(key)?;
    let (status, body) = get(conn, &format!("{ISSUE_PATH}/{key}/editmeta")).await?;
    priorities_of(status, &body)
}

async fn set_priority(conn: &Conn, key: &str, id: &str) -> Result<(), String> {
    let (key, id) = (key_of(key)?, numeric_id_of(id)?);
    let body = serde_json::json!({ "fields": { "priority": { "id": id } } });
    let (status, text) = send(
        conn,
        reqwest::Method::PUT,
        &format!("{ISSUE_PATH}/{key}"),
        Some(&body),
    )
    .await?;
    done_of(status, &text)
}

/// Puts the ticket in the sprint (an active or future one, which the Agile API takes), or back in the backlog (`None`), which takes it out of its sprints.
async fn move_to_sprint(conn: &Conn, key: &str, sprint_id: Option<u64>) -> Result<(), String> {
    let key = key_of(key)?;
    let path = match sprint_id {
        Some(id) => format!("{SPRINT_PATH}/{id}/issue"),
        None => "/rest/agile/1.0/backlog/issue".to_owned(),
    };
    let body = serde_json::json!({ "issues": [key] });
    let (status, text) = send(conn, reqwest::Method::POST, &path, Some(&body)).await?;
    done_of(status, &text)
}

/// Markdown that is written back as ADF: at most `MARKDOWN_LIMIT` bytes.
fn markdown_of(markdown: &str) -> Result<&str, String> {
    if markdown.len() <= MARKDOWN_LIMIT {
        Ok(markdown)
    } else {
        Err("文章が長すぎます".into())
    }
}

/// The description saved from the editor (J-2, #873). The description that Jira holds now is read, and it must be the one that the editor started from (`base`, the Markdown the tab was given): another change in between is refused, so that it is never overwritten. `markdown` is then put into that document (`markdown::merged`), which keeps what Markdown cannot say of every block that was not changed, and the result is put as the description (null when it is empty). Nothing is sent when it changes nothing. Gives the Markdown of what was saved.
async fn set_description(
    conn: &Conn,
    key: &str,
    base: &str,
    markdown: &str,
) -> Result<String, String> {
    let (key, markdown) = (key_of(key)?, markdown_of(markdown)?);
    let (status, body) = get(conn, &format!("{ISSUE_PATH}/{key}?fields=description")).await?;
    let current = raw_issue_of(status, &body)?
        .fields
        .and_then(|f| f.description)
        .unwrap_or(Value::Null);
    if adf::adf_to_markdown(&current) != base {
        return Err("説明が Jira で変更されています。読み直してください".into());
    }
    let old: Vec<Value> = current
        .get("content")
        .and_then(Value::as_array)
        .cloned()
        .unwrap_or_default();
    let mut blocks = markdown::merged(&old, markdown);
    if blocks == old && current.is_object() {
        return Ok(base.to_owned());
    }
    markdown::with_ids(&mut blocks);
    let description = if blocks.is_empty() {
        Value::Null
    } else {
        serde_json::json!({"version": 1, "type": "doc", "content": blocks})
    };
    let body = serde_json::json!({ "fields": { "description": description } });
    let (status, text) = send(
        conn,
        reqwest::Method::PUT,
        &format!("{ISSUE_PATH}/{key}"),
        Some(&body),
    )
    .await?;
    done_of(status, &text)?;
    Ok(adf::adf_to_markdown(&description))
}

/// The comment that Jira answers a new one with: its author, its time and its text as Markdown.
fn comment_of(status: u16, body: &str) -> Result<JiraComment, String> {
    if !(200..=299).contains(&status) {
        return Err(failure_of(status, body));
    }
    let raw: RawComment = serde_json::from_str(body).map_err(|_| {
        "コメントは追加されましたが、応答を読めません。読み直してください".to_owned()
    })?;
    Ok(JiraComment {
        author: raw.author.and_then(|u| u.display_name).unwrap_or_default(),
        created: shown_time(&raw.created.unwrap_or_default()),
        body: adf::adf_to_markdown(&raw.body.unwrap_or(Value::Null)),
    })
}

/// Adds a comment to the ticket (J-2, #873): the Markdown as ADF, which `POST /rest/api/3/issue/{key}/comment` takes as `body`.
async fn add_comment(conn: &Conn, key: &str, markdown: &str) -> Result<JiraComment, String> {
    let (key, markdown) = (key_of(key)?, markdown_of(markdown)?);
    let mut blocks = markdown::markdown_to_blocks(markdown);
    if blocks.is_empty() {
        return Err("コメントを入力してください".into());
    }
    markdown::with_ids(&mut blocks);
    let body = serde_json::json!({ "body": {"version": 1, "type": "doc", "content": blocks} });
    let (status, text) = send(
        conn,
        reqwest::Method::POST,
        &format!("{ISSUE_PATH}/{key}/comment"),
        Some(&body),
    )
    .await?;
    comment_of(status, &text)
}

/// The projects that Jira's answer gives, as the form offers them: those with a numeric id (it goes into a path and a body), by name. Archived ones are left out.
fn project_of(raw: RawProject) -> Option<JiraProject> {
    if raw.archived == Some(true) {
        return None;
    }
    let id = raw.id.filter(|id| numeric_id_of(id).is_ok())?;
    let key = raw.key.unwrap_or_default();
    Some(JiraProject {
        name: raw
            .name
            .filter(|n| !n.is_empty())
            .unwrap_or_else(|| key.clone()),
        id,
        key,
    })
}

#[derive(Deserialize)]
struct RawProject {
    id: Option<String>,
    key: Option<String>,
    name: Option<String>,
    archived: Option<bool>,
}

/// The issue types that Jira's answer to the create metadata gives, as the form offers them: those with a numeric id and a name, and not a subtask.
fn issue_type_of(raw: RawIssueType) -> Option<JiraIssueType> {
    if raw.subtask == Some(true) {
        return None;
    }
    let id = raw.id.filter(|id| numeric_id_of(id).is_ok())?;
    Some(JiraIssueType {
        id,
        name: raw.name.filter(|n| !n.is_empty())?,
    })
}

#[derive(Deserialize)]
struct RawIssueType {
    id: Option<String>,
    name: Option<String>,
    subtask: Option<bool>,
}

/// The projects the credential can create a ticket in (`action=create`: the *Create issues* permission), by name (at most `MAX_PROJECTS`).
async fn projects(conn: &Conn) -> Result<Vec<JiraProject>, String> {
    let (raw, _) = fetch_all::<RawProject>(
        conn,
        PROJECT_SEARCH_PATH,
        "action=create&orderBy=name",
        MAX_PROJECTS,
    )
    .await?;
    Ok(raw.into_iter().filter_map(project_of).collect())
}

/// The issue types of a project that a ticket can be created with (at most `MAX_ISSUE_TYPES`).
async fn issue_types(conn: &Conn, project_id: &str) -> Result<Vec<JiraIssueType>, String> {
    let project_id = numeric_id_of(project_id)?;
    let path = format!("{ISSUE_PATH}/createmeta/{project_id}/issuetypes");
    let (raw, _) = fetch_all::<RawIssueType>(conn, &path, "", MAX_ISSUE_TYPES).await?;
    Ok(raw.into_iter().filter_map(issue_type_of).collect())
}

/// A summary as the form gives it: trimmed, not empty, at most `SUMMARY_LIMIT` characters and in one line (Jira refuses a line break in it).
fn summary_of(input: &str) -> Result<&str, String> {
    let summary = input.trim();
    if summary.is_empty() {
        Err("件名を入力してください".into())
    } else if summary.chars().count() > SUMMARY_LIMIT {
        Err(format!("件名は {SUMMARY_LIMIT} 文字までです"))
    } else if summary.chars().any(char::is_control) {
        Err("件名に改行や制御文字は入れられません".into())
    } else {
        Ok(summary)
    }
}

/// The body of `POST /rest/api/3/issue`: the project and the issue type by id, the summary and, when there is one, the description as ADF.
fn create_body(
    project_id: &str,
    issue_type_id: &str,
    summary: &str,
    description: Vec<Value>,
) -> Value {
    let mut fields = serde_json::json!({
        "project": { "id": project_id },
        "issuetype": { "id": issue_type_id },
        "summary": summary,
    });
    if !description.is_empty() {
        fields["description"] =
            serde_json::json!({"version": 1, "type": "doc", "content": description});
    }
    serde_json::json!({ "fields": fields })
}

/// The key in Jira's answer to a create (`{id, key, self}`), checked as a ticket key because it goes on to a path.
fn created_of(status: u16, body: &str) -> Result<String, String> {
    #[derive(Deserialize)]
    struct Created {
        key: String,
    }
    if !(200..=299).contains(&status) {
        return Err(failure_of(status, body));
    }
    serde_json::from_str::<Created>(body)
        .ok()
        .filter(|c| key_of(&c.key).is_ok())
        .map(|c| c.key)
        .ok_or_else(|| {
            "チケットは作られましたが、応答を読めません。一覧を読み直してください".to_owned()
        })
}

/// Creates a ticket (J-2, #874) from the form: the project and the issue type by id, the summary, the description from Markdown (left out when it is empty) and, when `sprint_id` is given, the sprint, which is put with the Agile API after the create (the sprint is a custom field in REST API v3, whose id differs by site). Everything is checked before anything is sent. A ticket that was made but could not be put in the sprint is still the answer, with the reason in `sprint_error`.
async fn create_issue(
    conn: &Conn,
    project_id: &str,
    issue_type_id: &str,
    summary: &str,
    markdown: &str,
    sprint_id: Option<u64>,
) -> Result<JiraCreated, String> {
    let (project_id, issue_type_id) = (numeric_id_of(project_id)?, numeric_id_of(issue_type_id)?);
    let (summary, markdown) = (summary_of(summary)?, markdown_of(markdown)?);
    let mut blocks = markdown::markdown_to_blocks(markdown);
    markdown::with_ids(&mut blocks);
    let body = create_body(project_id, issue_type_id, summary, blocks);
    let (status, text) = send(conn, reqwest::Method::POST, ISSUE_PATH, Some(&body)).await?;
    let key = created_of(status, &text)?;
    let sprint_error = match sprint_id {
        Some(id) => move_to_sprint(conn, &key, Some(id)).await.err().map(|e| {
            format!("チケット {key} は作りましたが、スプリントに入れられませんでした: {e}")
        }),
        None => None,
    };
    Ok(JiraCreated { key, sprint_error })
}

/// The longest text of the key of a connection (the name of an environment, the key of a project), in characters, as `lsp.rs` takes it.
const PLACE_LIMIT: usize = 4096;
/// The connections are read and written in turn by the commands of the screen, which may overlap.
static LOCK: Mutex<()> = Mutex::new(());

fn empty_store() -> Store {
    Store {
        version: VERSION,
        connections: Vec::new(),
    }
}

impl Connection {
    /// What a project with nothing saved has.
    fn unset(environment: Option<&str>, project: &str) -> Self {
        Self {
            environment: environment.map(str::to_owned),
            project: project.to_owned(),
            site: String::new(),
            email: String::new(),
            board_id: None,
        }
    }

    fn is_at(&self, environment: Option<&str>, project: &str) -> bool {
        self.environment.as_deref() == environment && self.project == project
    }
}

fn load_store(dir: &Path) -> Result<Store, String> {
    let path = dir.join(FILE);
    let text = match std::fs::read_to_string(&path) {
        Ok(text) => text,
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => return Ok(empty_store()),
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

fn save_store(dir: &Path, store: &Store) -> Result<(), String> {
    let text = serde_json::to_string_pretty(store).map_err(|e| e.to_string())?;
    write_atomic(dir, FILE, &text)
}

/// The connection of the project `project` of `environment` (`None`: this machine): the saved one, else the unset one.
fn connection_at(
    dir: &Path,
    environment: Option<&str>,
    project: &str,
) -> Result<Connection, String> {
    Ok(load_store(dir)?
        .connections
        .into_iter()
        .find(|c| c.is_at(environment, project))
        .unwrap_or_else(|| Connection::unset(environment, project)))
}

/// A text of the key: not empty, not longer than `PLACE_LIMIT`, with no control character.
fn check_text(what: &str, text: &str) -> Result<(), String> {
    if text.is_empty() || text.chars().count() > PLACE_LIMIT || text.chars().any(char::is_control) {
        return Err(format!("{what}が正しくありません"));
    }
    Ok(())
}

/// The key of a connection as a command is given it: the environment (`None` for this machine) and the key of the project in Orca's list.
fn check_place(environment: Option<&str>, project: &str) -> Result<(), String> {
    if let Some(environment) = environment {
        check_text("接続先", environment)?;
    }
    check_text("プロジェクト", project)
}

/// The user name of the token of a project in the keychain: the key as a JSON array, so that no two keys share one (`[null,"p"]` is this machine, `["name","p"]` an environment).
fn token_user(environment: Option<&str>, project: &str) -> String {
    serde_json::json!([environment, project]).to_string()
}

/// The connection to save: the form's site and email address, with the board kept only while the site is the same one (a board belongs to its site).
fn merged(
    old: Option<&Connection>,
    environment: Option<&str>,
    project: &str,
    site: String,
    email: String,
) -> Connection {
    let board_id = old.filter(|o| o.site == site).and_then(|o| o.board_id);
    Connection {
        environment: environment.map(str::to_owned),
        project: project.to_owned(),
        site,
        email,
        board_id,
    }
}

/// What a form gives, checked: the site's origin, the email address, and the token typed (`None` when the field was empty).
fn checked_form(
    site: &str,
    email: &str,
    token: &str,
) -> Result<(String, String, Option<String>), String> {
    Ok((site_url(site)?, email_of(email)?, token_of(token)?))
}

async fn blocking<T: Send + 'static>(
    work: impl FnOnce() -> Result<T, String> + Send + 'static,
) -> Result<T, String> {
    tokio::task::spawn_blocking(work)
        .await
        .map_err(|e| e.to_string())?
}

async fn stored_token(environment: Option<&str>, project: &str) -> Result<Option<String>, String> {
    let user = token_user(environment, project);
    blocking(move || keychain::read(TOKEN_SERVICE, &user)).await
}

/// The screen's view of a connection: never the token, only whether one is kept.
fn shown(connection: Connection, has_token: bool) -> JiraSettings {
    JiraSettings {
        site: connection.site,
        email: connection.email,
        has_token,
        board_id: connection.board_id,
    }
}

/// The saved site and email address with the stored token, checked again before they are used: the file can be written by hand, and the token must go to an Atlassian Cloud site only (`site_url`, `email_of`). An error when nothing is saved.
fn saved_connection(
    saved: &Connection,
    token: Option<String>,
) -> Result<(String, String, String), String> {
    if saved.site.is_empty() {
        return Err(NOT_SAVED.into());
    }
    Ok((
        site_url(&saved.site)?,
        email_of(&saved.email)?,
        token.ok_or(TOKEN_MISSING)?,
    ))
}

/// The connections that keep a token (`has_token` asks the keychain for one connection), as the list to copy from shows them.
fn with_token(
    connections: Vec<Connection>,
    mut has_token: impl FnMut(&Connection) -> Result<bool, String>,
) -> Result<Vec<JiraConnection>, String> {
    let mut kept = Vec::new();
    for c in connections {
        if has_token(&c)? {
            kept.push(JiraConnection {
                environment: c.environment,
                project: c.project,
                site: c.site,
                email: c.email,
            });
        }
    }
    Ok(kept)
}

/// The two keys of a copy, checked: both are keys of a connection, and they are not the same one.
fn check_copy(
    environment: Option<&str>,
    project: &str,
    from_environment: Option<&str>,
    from_project: &str,
) -> Result<(), String> {
    check_place(environment, project)?;
    check_place(from_environment, from_project)?;
    if environment == from_environment && project == from_project {
        return Err(COPY_SAME_PLACE.into());
    }
    Ok(())
}

/// The connection that a copy of `from` makes for the project `project` of `environment`, with the token to write for it: the site and the email address are checked again (`saved_connection`), and the board is not copied (a board is chosen for each project).
fn copied(
    from: &Connection,
    token: Option<String>,
    environment: Option<&str>,
    project: &str,
) -> Result<(Connection, String), String> {
    let token = token.ok_or(COPY_NO_TOKEN)?;
    let (site, email, token) = saved_connection(from, Some(token))?;
    Ok((merged(None, environment, project, site, email), token))
}

/// Puts `connection` in the store in the place of the one with the same key, or after the others.
fn upserted(store: &mut Store, connection: Connection) {
    let at = store
        .connections
        .iter()
        .position(|c| c.is_at(connection.environment.as_deref(), &connection.project));
    match at {
        Some(i) => store.connections[i] = connection,
        None => store.connections.push(connection),
    }
}

/// The connection that the saved settings of a project and the keychain give, for the commands that read the project's Jira.
async fn project_conn(
    app: &AppHandle,
    environment: Option<&str>,
    project: &str,
) -> Result<Conn, String> {
    check_place(environment, project)?;
    let dir = config_dir(app)?;
    let (env, proj) = (environment.map(str::to_owned), project.to_owned());
    let saved = blocking(move || connection_at(&dir, env.as_deref(), &proj)).await?;
    let (site, email, token) = saved_connection(&saved, stored_token(environment, project).await?)?;
    connect(&site, &email, &token, GATEWAY).await
}

/// Removes the file of the legacy connection (the one before the projects); a file that is not there is fine.
fn remove_legacy_file(dir: &Path) -> Result<(), String> {
    match std::fs::remove_file(dir.join(LEGACY_FILE)) {
        Err(e) if e.kind() != std::io::ErrorKind::NotFound => {
            Err(format!("{LEGACY_FILE} を消せません: {e}"))
        }
        _ => Ok(()),
    }
}

/// Removes the one connection that J-1 kept before the projects (#1393): `jira-settings.json` and the token under the user `api-token`. Called at each start; both run even when the first fails.
pub fn remove_legacy(dir: &Path) -> Result<(), String> {
    let file = remove_legacy_file(dir);
    let token = keychain::delete(TOKEN_SERVICE, LEGACY_TOKEN_USER);
    file.and(token)
}

/// The saved site, email address and board of the project `project` of `environment` (`None`: this machine), and whether a token is kept. Asks Jira nothing.
#[tauri::command]
pub async fn jira_settings(
    app: AppHandle,
    environment: Option<String>,
    project: String,
) -> Result<JiraSettings, String> {
    let command = "jira_settings";
    check_place(environment.as_deref(), &project)?;
    let read = async {
        let dir = config_dir(&app)?;
        blocking(move || {
            let connection = connection_at(&dir, environment.as_deref(), &project)?;
            let user = token_user(environment.as_deref(), &project);
            let has_token = keychain::read(TOKEN_SERVICE, &user)?.is_some();
            Ok(shown(connection, has_token))
        })
        .await
    };
    read.await.map_err(|e| log_failure(command, LOG_ACCOUNT, e))
}

/// Saves the site and the email address of the project to the file and its token to the keychain. An empty `token` keeps the stored one, and is refused when none is stored. The board is kept while the site is the same.
#[tauri::command]
pub async fn jira_save(
    app: AppHandle,
    environment: Option<String>,
    project: String,
    site: String,
    email: String,
    token: String,
) -> Result<JiraSettings, String> {
    let command = "jira_save";
    check_place(environment.as_deref(), &project)?;
    let (site, email, token) = checked_form(&site, &email, &token)?;
    let write = async {
        let dir = config_dir(&app)?;
        blocking(move || {
            let user = token_user(environment.as_deref(), &project);
            let _guard = LOCK.lock().unwrap_or_else(|e| e.into_inner());
            let mut store = load_store(&dir)?;
            match token {
                Some(token) => keychain::write(TOKEN_SERVICE, &user, &token)?,
                None if keychain::read(TOKEN_SERVICE, &user)?.is_none() => {
                    return Err(TOKEN_MISSING.into())
                }
                None => {}
            }
            let at = store
                .connections
                .iter()
                .position(|c| c.is_at(environment.as_deref(), &project));
            let connection = merged(
                at.map(|i| &store.connections[i]),
                environment.as_deref(),
                &project,
                site,
                email,
            );
            match at {
                Some(i) => store.connections[i] = connection.clone(),
                None => store.connections.push(connection.clone()),
            }
            save_store(&dir, &store)?;
            Ok(shown(connection, true))
        })
        .await
    };
    write
        .await
        .map_err(|e| log_failure(command, LOG_ACCOUNT, e))
}

/// Tries the credential of the form against the site: an empty `token` takes the one stored for the project. Saves nothing.
#[tauri::command]
pub async fn jira_test(
    environment: Option<String>,
    project: String,
    site: String,
    email: String,
    token: String,
) -> Result<JiraUser, String> {
    let command = "jira_test";
    check_place(environment.as_deref(), &project)?;
    let (site, email, token) = checked_form(&site, &email, &token)?;
    let token = match token {
        Some(token) => token,
        None => stored_token(environment.as_deref(), &project)
            .await
            .map_err(|e| log_failure(command, LOG_ACCOUNT, e))?
            .ok_or(TOKEN_MISSING)?,
    };
    check(&site, &email, &token, GATEWAY)
        .await
        .map_err(|e| log_failure(command, LOG_ACCOUNT, e))
}

/// Deletes the connection of the project: its token from the keychain first (a failure leaves everything as it was), then its entry of the file. A project with nothing saved is fine.
#[tauri::command]
pub async fn jira_delete(
    app: AppHandle,
    environment: Option<String>,
    project: String,
) -> Result<(), String> {
    let command = "jira_delete";
    check_place(environment.as_deref(), &project)?;
    let delete = async {
        let dir = config_dir(&app)?;
        blocking(move || {
            let _guard = LOCK.lock().unwrap_or_else(|e| e.into_inner());
            let mut store = load_store(&dir)?;
            keychain::delete(TOKEN_SERVICE, &token_user(environment.as_deref(), &project))?;
            let before = store.connections.len();
            store
                .connections
                .retain(|c| !c.is_at(environment.as_deref(), &project));
            if store.connections.len() != before {
                save_store(&dir, &store)?;
            }
            Ok(())
        })
        .await
    };
    delete
        .await
        .map_err(|e| log_failure(command, LOG_ACCOUNT, e))
}

/// The connections that keep a token, for the user to copy one to another project: where each is, its site and its email address. The token is not returned, and Jira is asked nothing.
#[tauri::command]
pub async fn jira_connections(app: AppHandle) -> Result<Vec<JiraConnection>, String> {
    let command = "jira_connections";
    let read = async {
        let dir = config_dir(&app)?;
        blocking(move || {
            with_token(load_store(&dir)?.connections, |c| {
                let user = token_user(c.environment.as_deref(), &c.project);
                Ok(keychain::read(TOKEN_SERVICE, &user)?.is_some())
            })
        })
        .await
    };
    read.await.map_err(|e| log_failure(command, LOG_ACCOUNT, e))
}

/// Copies the connection of `from_project` of `from_environment` to the project: its site, its email address and its token, which goes from the keychain to the keychain here and is never returned. The board is left empty. Refused when the two keys are the same or the source has no token or a site that is not an Atlassian Cloud one.
#[tauri::command]
pub async fn jira_copy(
    app: AppHandle,
    environment: Option<String>,
    project: String,
    from_environment: Option<String>,
    from_project: String,
) -> Result<JiraSettings, String> {
    let command = "jira_copy";
    check_copy(
        environment.as_deref(),
        &project,
        from_environment.as_deref(),
        &from_project,
    )?;
    let write = async {
        let dir = config_dir(&app)?;
        blocking(move || {
            let _guard = LOCK.lock().unwrap_or_else(|e| e.into_inner());
            let mut store = load_store(&dir)?;
            let from = store
                .connections
                .iter()
                .find(|c| c.is_at(from_environment.as_deref(), &from_project))
                .cloned()
                .unwrap_or_else(|| Connection::unset(from_environment.as_deref(), &from_project));
            let token = keychain::read(
                TOKEN_SERVICE,
                &token_user(from_environment.as_deref(), &from_project),
            )?;
            let (connection, token) = copied(&from, token, environment.as_deref(), &project)?;
            keychain::write(
                TOKEN_SERVICE,
                &token_user(environment.as_deref(), &project),
                &token,
            )?;
            upserted(&mut store, connection.clone());
            save_store(&dir, &store)?;
            Ok(shown(connection, true))
        })
        .await
    };
    write
        .await
        .map_err(|e| log_failure(command, LOG_ACCOUNT, e))
}

/// Saves the board that the project shows (`None`: none chosen). The project must have a saved connection.
#[tauri::command]
pub async fn jira_set_board(
    app: AppHandle,
    environment: Option<String>,
    project: String,
    board_id: Option<u64>,
) -> Result<JiraSettings, String> {
    let command = "jira_set_board";
    check_place(environment.as_deref(), &project)?;
    let write = async {
        let dir = config_dir(&app)?;
        blocking(move || {
            let _guard = LOCK.lock().unwrap_or_else(|e| e.into_inner());
            let mut store = load_store(&dir)?;
            let connection = store
                .connections
                .iter_mut()
                .find(|c| c.is_at(environment.as_deref(), &project))
                .ok_or(NOT_SAVED)?;
            connection.board_id = board_id;
            let connection = connection.clone();
            save_store(&dir, &store)?;
            let user = token_user(environment.as_deref(), &project);
            let has_token = keychain::read(TOKEN_SERVICE, &user)?.is_some();
            Ok(shown(connection, has_token))
        })
        .await
    };
    write
        .await
        .map_err(|e| log_failure(command, LOG_ACCOUNT, e))
}

/// The boards that the credential can see, by name (at most `MAX_BOARDS`).
#[tauri::command]
pub async fn jira_boards(
    app: AppHandle,
    environment: Option<String>,
    project: String,
) -> Result<Vec<JiraBoard>, String> {
    let read = async { boards(&project_conn(&app, environment.as_deref(), &project).await?).await };
    read.await
        .map_err(|e| log_failure("jira_boards", LOG_ACCOUNT, e))
}

/// The active and future sprints of a board (at most `MAX_SPRINTS`). A board without sprints (a kanban one) is Jira's refusal, with its message.
#[tauri::command]
pub async fn jira_sprints(
    app: AppHandle,
    environment: Option<String>,
    project: String,
    board_id: u64,
) -> Result<Vec<JiraSprint>, String> {
    let read = async {
        sprints(
            &project_conn(&app, environment.as_deref(), &project).await?,
            board_id,
        )
        .await
    };
    read.await
        .map_err(|e| log_failure("jira_sprints", LOG_ACCOUNT, e))
}

/// The tickets of a sprint, in the order of the board's rank (at most `MAX_ISSUES`).
#[tauri::command]
pub async fn jira_sprint_issues(
    app: AppHandle,
    environment: Option<String>,
    project: String,
    sprint_id: u64,
) -> Result<JiraIssues, String> {
    let read = async {
        sprint_issues(
            &project_conn(&app, environment.as_deref(), &project).await?,
            sprint_id,
        )
        .await
    };
    read.await
        .map_err(|e| log_failure("jira_sprint_issues", LOG_ACCOUNT, e))
}

/// The backlog of a board, in the order of its rank (at most `MAX_ISSUES`).
#[tauri::command]
pub async fn jira_backlog(
    app: AppHandle,
    environment: Option<String>,
    project: String,
    board_id: u64,
) -> Result<JiraIssues, String> {
    let read = async {
        backlog(
            &project_conn(&app, environment.as_deref(), &project).await?,
            board_id,
        )
        .await
    };
    read.await
        .map_err(|e| log_failure("jira_backlog", LOG_ACCOUNT, e))
}

/// A ticket for its tab (J-2, #871): its description and comments read as Markdown, and the fields of its right column. `key` is checked to be a ticket key before anything is asked.
#[tauri::command]
pub async fn jira_issue(
    app: AppHandle,
    environment: Option<String>,
    project: String,
    key: String,
) -> Result<JiraIssueDetail, String> {
    let read = async {
        issue_detail(
            &project_conn(&app, environment.as_deref(), &project).await?,
            &key,
        )
        .await
    };
    read.await
        .map_err(|e| log_failure("jira_issue", LOG_ACCOUNT, e))
}

/// The status changes that the ticket can take now (J-2, #872), each with the status it leads to.
#[tauri::command]
pub async fn jira_transitions(
    app: AppHandle,
    environment: Option<String>,
    project: String,
    key: String,
) -> Result<Vec<JiraTransition>, String> {
    let read = async {
        transitions(
            &project_conn(&app, environment.as_deref(), &project).await?,
            &key,
        )
        .await
    };
    read.await
        .map_err(|e| log_failure("jira_transitions", LOG_ACCOUNT, e))
}

/// Takes the transition `transition_id` of the ticket (J-2, #872). Changes the status in Jira.
#[tauri::command]
pub async fn jira_transition(
    app: AppHandle,
    environment: Option<String>,
    project: String,
    key: String,
    transition_id: String,
) -> Result<(), String> {
    let write = async {
        transition(
            &project_conn(&app, environment.as_deref(), &project).await?,
            &key,
            &transition_id,
        )
        .await
    };
    write
        .await
        .map_err(|e| log_failure("jira_transition", LOG_ACCOUNT, e))
}

/// The people the ticket can be assigned to (J-2, #872), at most `MAX_ASSIGNABLE`.
#[tauri::command]
pub async fn jira_assignable(
    app: AppHandle,
    environment: Option<String>,
    project: String,
    key: String,
) -> Result<Vec<JiraPerson>, String> {
    let read = async {
        assignable(
            &project_conn(&app, environment.as_deref(), &project).await?,
            &key,
        )
        .await
    };
    read.await
        .map_err(|e| log_failure("jira_assignable", LOG_ACCOUNT, e))
}

/// Assigns the ticket to `account_id`, or to no one when it is none (J-2, #872). Changes the assignee in Jira.
#[tauri::command]
pub async fn jira_assign(
    app: AppHandle,
    environment: Option<String>,
    project: String,
    key: String,
    account_id: Option<String>,
) -> Result<(), String> {
    let write = async {
        assign(
            &project_conn(&app, environment.as_deref(), &project).await?,
            &key,
            account_id.as_deref(),
        )
        .await
    };
    write
        .await
        .map_err(|e| log_failure("jira_assign", LOG_ACCOUNT, e))
}

/// The priorities the ticket can be given (J-2, #872): none when its priority cannot be edited.
#[tauri::command]
pub async fn jira_priorities(
    app: AppHandle,
    environment: Option<String>,
    project: String,
    key: String,
) -> Result<Vec<JiraPriority>, String> {
    let read = async {
        priorities(
            &project_conn(&app, environment.as_deref(), &project).await?,
            &key,
        )
        .await
    };
    read.await
        .map_err(|e| log_failure("jira_priorities", LOG_ACCOUNT, e))
}

/// Gives the ticket the priority `priority_id` (J-2, #872). Changes the priority in Jira.
#[tauri::command]
pub async fn jira_set_priority(
    app: AppHandle,
    environment: Option<String>,
    project: String,
    key: String,
    priority_id: String,
) -> Result<(), String> {
    let write = async {
        set_priority(
            &project_conn(&app, environment.as_deref(), &project).await?,
            &key,
            &priority_id,
        )
        .await
    };
    write
        .await
        .map_err(|e| log_failure("jira_set_priority", LOG_ACCOUNT, e))
}

/// Puts the ticket in the sprint `sprint_id`, or in the backlog when it is none (J-2, #872). Changes the sprint in Jira.
#[tauri::command]
pub async fn jira_set_sprint(
    app: AppHandle,
    environment: Option<String>,
    project: String,
    key: String,
    sprint_id: Option<u64>,
) -> Result<(), String> {
    let write = async {
        move_to_sprint(
            &project_conn(&app, environment.as_deref(), &project).await?,
            &key,
            sprint_id,
        )
        .await
    };
    write
        .await
        .map_err(|e| log_failure("jira_set_sprint", LOG_ACCOUNT, e))
}

/// Saves the description of the ticket (J-2, #873) from the Markdown of the editor; `base` is the description the tab was given (the editor's start). Changes the description in Jira, and gives the Markdown of what it now is.
#[tauri::command]
pub async fn jira_set_description(
    app: AppHandle,
    environment: Option<String>,
    project: String,
    key: String,
    base: String,
    markdown: String,
) -> Result<String, String> {
    let write = async {
        set_description(
            &project_conn(&app, environment.as_deref(), &project).await?,
            &key,
            &base,
            &markdown,
        )
        .await
    };
    write
        .await
        .map_err(|e| log_failure("jira_set_description", LOG_ACCOUNT, e))
}

/// Adds a comment to the ticket (J-2, #873) from Markdown, and gives it as Jira answers it. Adds a comment in Jira.
#[tauri::command]
pub async fn jira_add_comment(
    app: AppHandle,
    environment: Option<String>,
    project: String,
    key: String,
    markdown: String,
) -> Result<JiraComment, String> {
    let write = async {
        add_comment(
            &project_conn(&app, environment.as_deref(), &project).await?,
            &key,
            &markdown,
        )
        .await
    };
    write
        .await
        .map_err(|e| log_failure("jira_add_comment", LOG_ACCOUNT, e))
}

/// The projects that the credential can create a ticket in (J-2, #874), by name (at most `MAX_PROJECTS`).
#[tauri::command]
pub async fn jira_projects(
    app: AppHandle,
    environment: Option<String>,
    project: String,
) -> Result<Vec<JiraProject>, String> {
    let read =
        async { projects(&project_conn(&app, environment.as_deref(), &project).await?).await };
    read.await
        .map_err(|e| log_failure("jira_projects", LOG_ACCOUNT, e))
}

/// The issue types of a project that a ticket can be created with (J-2, #874). `project_id` is checked to be a number before anything is asked.
#[tauri::command]
pub async fn jira_issue_types(
    app: AppHandle,
    environment: Option<String>,
    project: String,
    project_id: String,
) -> Result<Vec<JiraIssueType>, String> {
    let read = async {
        issue_types(
            &project_conn(&app, environment.as_deref(), &project).await?,
            &project_id,
        )
        .await
    };
    read.await
        .map_err(|e| log_failure("jira_issue_types", LOG_ACCOUNT, e))
}

/// Creates a ticket in Jira (J-2, #874) and gives its key. `markdown` is the description (may be empty) and `sprint_id` the sprint to put it in (none leaves it where Jira puts a new ticket, the backlog).
#[tauri::command]
#[allow(clippy::too_many_arguments)]
pub async fn jira_create_issue(
    app: AppHandle,
    environment: Option<String>,
    project: String,
    project_id: String,
    issue_type_id: String,
    summary: String,
    markdown: String,
    sprint_id: Option<u64>,
) -> Result<JiraCreated, String> {
    let write = async {
        create_issue(
            &project_conn(&app, environment.as_deref(), &project).await?,
            &project_id,
            &issue_type_id,
            &summary,
            &markdown,
            sprint_id,
        )
        .await
    };
    let mut created = write
        .await
        .map_err(|e| log_failure("jira_create_issue", LOG_ACCOUNT, e))?;
    created.sprint_error = created
        .sprint_error
        .map(|e| log_failure("jira_create_issue", LOG_ACCOUNT, e));
    Ok(created)
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

    fn connection(environment: Option<&str>, project: &str, site: &str) -> Connection {
        Connection {
            site: site.into(),
            email: "me@example.com".into(),
            board_id: Some(7),
            ..Connection::unset(environment, project)
        }
    }

    #[test]
    fn the_file_holds_a_connection_for_each_place_and_no_token_and_is_empty_before_the_first_save()
    {
        let dir = temp_dir("file");
        assert_eq!(load_store(&dir), Ok(empty_store()));
        let store = Store {
            version: VERSION,
            connections: vec![
                connection(None, "p1", "https://example.atlassian.net"),
                connection(Some("pc"), "p1", "https://other.atlassian.net"),
            ],
        };
        save_store(&dir, &store).unwrap();
        assert_eq!(load_store(&dir), Ok(store));
        let text = std::fs::read_to_string(dir.join(FILE)).unwrap();
        assert!(!text.to_lowercase().contains("token"));
        assert_eq!(
            connection_at(&dir, Some("pc"), "p1").unwrap().site,
            "https://other.atlassian.net"
        );
        assert_eq!(
            connection_at(&dir, None, "p2"),
            Ok(Connection::unset(None, "p2"))
        );
        std::fs::write(dir.join(FILE), r#"{"version":2,"connections":[]}"#).unwrap();
        assert!(load_store(&dir).unwrap_err().contains("版 2"));
        std::fs::write(dir.join(FILE), "not json").unwrap();
        assert!(load_store(&dir).unwrap_err().contains("形式が不正"));
        std::fs::remove_dir_all(&dir).unwrap();
    }

    #[test]
    fn the_key_is_an_environment_or_this_machine_and_a_project_and_each_key_has_its_own_token() {
        assert!(check_place(None, "p").is_ok());
        assert!(check_place(Some("pc"), "p").is_ok());
        assert!(check_place(Some(""), "p").is_err());
        assert!(check_place(None, "").is_err());
        assert!(check_place(None, "a\nb").is_err());
        assert!(check_place(Some("pc\u{7}"), "p").is_err());
        assert!(check_place(None, &"x".repeat(PLACE_LIMIT + 1)).is_err());
        assert_eq!(token_user(None, "p"), r#"[null,"p"]"#);
        assert_eq!(token_user(Some("pc"), "p"), r#"["pc","p"]"#);
        assert_ne!(token_user(None, "p"), token_user(Some("p"), "p"));
        assert_ne!(token_user(Some("a"), "b"), token_user(Some("a\",\"b"), ""));
        assert_ne!(token_user(None, "p"), LEGACY_TOKEN_USER);
    }

    #[test]
    fn a_save_keeps_the_board_while_the_site_is_the_same_and_drops_it_for_another_site() {
        let old = connection(None, "p", "https://example.atlassian.net");
        let same = merged(
            Some(&old),
            None,
            "p",
            "https://example.atlassian.net".into(),
            "new@example.com".into(),
        );
        assert_eq!(same.board_id, Some(7));
        assert_eq!(same.email, "new@example.com");
        let other = merged(
            Some(&old),
            None,
            "p",
            "https://other.atlassian.net".into(),
            String::new(),
        );
        assert_eq!(other.board_id, None);
        let first = merged(
            None,
            Some("pc"),
            "p",
            "https://example.atlassian.net".into(),
            String::new(),
        );
        assert_eq!(first.board_id, None);
        assert_eq!(first.environment.as_deref(), Some("pc"));
    }

    #[test]
    fn the_list_to_copy_from_keeps_the_connections_with_a_token_and_never_the_token() {
        let all = vec![
            connection(None, "a", "https://a.atlassian.net"),
            connection(Some("pc"), "b", "https://b.atlassian.net"),
            connection(None, "c", "https://c.atlassian.net"),
        ];
        let listed = with_token(all.clone(), |c| Ok(c.project != "c")).unwrap();
        assert_eq!(
            serde_json::to_value(&listed).unwrap(),
            serde_json::json!([
                {"environment": null, "project": "a", "site": "https://a.atlassian.net", "email": "me@example.com"},
                {"environment": "pc", "project": "b", "site": "https://b.atlassian.net", "email": "me@example.com"},
            ])
        );
        assert_eq!(with_token(all.clone(), |_| Ok(false)), Ok(Vec::new()));
        assert_eq!(with_token(Vec::new(), |_| Ok(true)), Ok(Vec::new()));
        // A keychain that cannot be read is an error, not an empty list.
        assert_eq!(
            with_token(all, |_| Err("キーチェーンを読めません".into())),
            Err("キーチェーンを読めません".into())
        );
    }

    #[test]
    fn a_copy_needs_two_different_keys() {
        assert!(check_copy(None, "p", Some("pc"), "q").is_ok());
        assert!(check_copy(None, "p", None, "q").is_ok());
        assert!(check_copy(Some("pc"), "p", None, "p").is_ok());
        assert_eq!(
            check_copy(None, "p", None, "p"),
            Err(COPY_SAME_PLACE.into())
        );
        assert_eq!(
            check_copy(Some("pc"), "p", Some("pc"), "p"),
            Err(COPY_SAME_PLACE.into())
        );
        assert!(check_copy(None, "", None, "q").is_err());
        assert!(check_copy(None, "p", Some(""), "q").is_err());
        assert!(check_copy(None, "p", None, "q\nr").is_err());
    }

    #[test]
    fn a_copy_takes_the_site_the_email_address_and_the_token_and_leaves_the_board_empty() {
        let from = connection(None, "a", "https://example.atlassian.net/jira?x=1");
        assert_eq!(from.board_id, Some(7));
        let (copy, token) = copied(&from, Some("tok".into()), Some("pc"), "b").unwrap();
        assert_eq!(
            copy,
            Connection {
                environment: Some("pc".into()),
                project: "b".into(),
                site: "https://example.atlassian.net".into(),
                email: "me@example.com".into(),
                board_id: None,
            }
        );
        assert_eq!(token, "tok");
    }

    #[test]
    fn a_copy_is_refused_for_a_source_with_no_token_nothing_saved_or_a_site_that_is_not_atlassian_cloud(
    ) {
        let from = connection(None, "a", "https://example.atlassian.net");
        assert_eq!(copied(&from, None, None, "b"), Err(COPY_NO_TOKEN.into()));
        assert_eq!(
            copied(&Connection::unset(None, "a"), Some("tok".into()), None, "b"),
            Err(NOT_SAVED.into())
        );
        for site in [
            "https://example.com",
            "http://example.atlassian.net",
            "https://user@example.atlassian.net",
        ] {
            let broken = connection(None, "a", site);
            assert!(
                copied(&broken, Some("tok".into()), None, "b").is_err(),
                "{site}"
            );
        }
        let mut bad_email = from;
        bad_email.email = "a:b@example.com".into();
        assert!(copied(&bad_email, Some("tok".into()), None, "b").is_err());
    }

    #[test]
    fn a_copy_replaces_the_entry_of_its_key_or_is_added_after_the_others() {
        let mut store = Store {
            version: VERSION,
            connections: vec![
                connection(None, "a", "https://a.atlassian.net"),
                connection(None, "b", "https://old.atlassian.net"),
            ],
        };
        let (copy, _) = copied(&store.connections[0].clone(), Some("t".into()), None, "b").unwrap();
        upserted(&mut store, copy);
        assert_eq!(store.connections.len(), 2);
        assert_eq!(store.connections[1].site, "https://a.atlassian.net");
        assert_eq!(store.connections[1].board_id, None);
        let (copy, _) = copied(
            &store.connections[0].clone(),
            Some("t".into()),
            Some("pc"),
            "b",
        )
        .unwrap();
        upserted(&mut store, copy);
        assert_eq!(store.connections.len(), 3);
        assert_eq!(store.connections[2].environment.as_deref(), Some("pc"));
    }

    #[test]
    fn the_legacy_file_is_removed_and_a_missing_one_is_fine() {
        let dir = temp_dir("legacy");
        std::fs::create_dir_all(&dir).unwrap();
        assert_eq!(remove_legacy_file(&dir), Ok(()));
        std::fs::write(dir.join(LEGACY_FILE), r#"{"site":"","email":""}"#).unwrap();
        std::fs::write(dir.join(FILE), r#"{"version":1,"connections":[]}"#).unwrap();
        assert_eq!(remove_legacy_file(&dir), Ok(()));
        assert!(!dir.join(LEGACY_FILE).exists());
        assert!(dir.join(FILE).exists());
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
                // The headers, and then the body that `content-length` announces (a write has one).
                let mut needed = None;
                loop {
                    if let Some(end) = request.windows(4).position(|w| w == b"\r\n\r\n") {
                        let head = lower(&String::from_utf8_lossy(&request[..end]));
                        let length = head
                            .lines()
                            .find_map(|l| l.strip_prefix("content-length: "))
                            .and_then(|n| n.trim().parse::<usize>().ok())
                            .unwrap_or(0);
                        needed = Some(end + 4 + length);
                    }
                    if needed.is_some_and(|n| request.len() >= n) {
                        break;
                    }
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
    fn saved_connection_needs_a_site_and_a_token_and_checks_the_site_again() {
        let saved = |site: &str| connection(None, "p", site);
        assert_eq!(
            saved_connection(&saved("https://example.atlassian.net"), Some("tok".into())),
            Ok((
                "https://example.atlassian.net".into(),
                "me@example.com".into(),
                "tok".into()
            ))
        );
        assert_eq!(
            saved_connection(&Connection::unset(None, "p"), Some("tok".into())),
            Err(NOT_SAVED.into())
        );
        assert_eq!(
            saved_connection(&saved("https://example.atlassian.net"), None),
            Err(TOKEN_MISSING.into())
        );
        // A file written by hand must not send the token to another host, or in another shape.
        for site in [
            "https://example.com",
            "https://evil.example/.atlassian.net",
            "http://example.atlassian.net",
            "https://user@example.atlassian.net",
        ] {
            assert!(
                saved_connection(&saved(site), Some("tok".into())).is_err(),
                "{site}"
            );
        }
        let mut bad_email = saved("https://example.atlassian.net");
        bad_email.email = "a:b@example.com".into();
        assert!(saved_connection(&bad_email, Some("tok".into())).is_err());
        // The origin is what is used, with a path dropped.
        assert_eq!(
            saved_connection(
                &saved("https://example.atlassian.net/x"),
                Some("tok".into())
            )
            .unwrap()
            .0,
            "https://example.atlassian.net"
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

    const NO_CONTENT: &str = "HTTP/1.1 204 No Content\r\nConnection: close\r\n\r\n";

    #[test]
    fn numeric_id_of_takes_numbers_only() {
        for ok in ["1", "31", "10001", "123456789012345678"] {
            assert_eq!(numeric_id_of(ok), Ok(ok), "{ok}");
        }
        for bad in [
            "",
            "-1",
            "1a",
            "../1",
            "1/2",
            "1?x=1",
            " 1",
            "１",
            "1234567890123456789",
        ] {
            assert!(numeric_id_of(bad).is_err(), "{bad}");
        }
    }

    #[test]
    fn account_id_of_takes_an_account_id_and_never_the_default_assignee() {
        for ok in [
            "5b10ac8d82e05b22cc7d4ef5",
            "712020:0aa1b2c3-d4e5-46f7-8899-aabbccddeeff",
            "a_b-c",
        ] {
            assert_eq!(account_id_of(ok), Ok(ok), "{ok}");
        }
        for bad in ["", "-1", ":a", "a b", "a/b", "a\"b", "a?b", "é"] {
            assert!(account_id_of(bad).is_err(), "{bad}");
        }
        assert!(account_id_of(&"a".repeat(ACCOUNT_ID_LIMIT + 1)).is_err());
    }

    #[test]
    fn transitions_of_keeps_what_can_be_taken_with_the_status_it_leads_to() {
        let body = r#"{"expand":"transitions","transitions":[
            {"id":"11","name":"Start","to":{"name":"In Progress","statusCategory":{"key":"indeterminate"}}},
            {"id":"21","name":"Finish","isAvailable":true,"to":{"name":"Done","statusCategory":{"key":"done"}}},
            {"id":"31","name":"Blocked","isAvailable":false,"to":{"name":"Blocked","statusCategory":{"key":"new"}}},
            {"id":"../41","name":"Bad","to":{"name":"Bad"}},
            {"id":"51","name":"Reopen"}]}"#;
        let list = transitions_of(200, body).unwrap();
        assert_eq!(
            list,
            vec![
                JiraTransition {
                    id: "11".into(),
                    status: "In Progress".into(),
                    status_category: "indeterminate".into()
                },
                JiraTransition {
                    id: "21".into(),
                    status: "Done".into(),
                    status_category: "done".into()
                },
                JiraTransition {
                    id: "51".into(),
                    status: "Reopen".into(),
                    status_category: "undefined".into()
                },
            ]
        );
        assert_eq!(transitions_of(200, "{}"), Ok(vec![]));
        assert!(transitions_of(200, "<html>").is_err());
        assert_eq!(
            transitions_of(403, ""),
            Err("Jira が認証を拒否しました（403）".into())
        );
        assert_eq!(
            transitions_of(404, "no"),
            Err("Jira が 404 を返しました: no".into())
        );
    }

    #[test]
    fn assignable_of_keeps_the_active_people_with_a_usable_account_id() {
        let body = r#"[
            {"accountId":"5b10","displayName":"Mia","active":true},
            {"accountId":"712020:abc","displayName":"Ann"},
            {"accountId":"6c20","displayName":"Gone","active":false},
            {"accountId":"-1","displayName":"Default"},
            {"accountId":"7d30","displayName":""},
            {"displayName":"No id"}]"#;
        let list = assignable_of(200, body).unwrap();
        assert_eq!(
            list.iter()
                .map(|p| (p.account_id.as_str(), p.display_name.as_str()))
                .collect::<Vec<_>>(),
            vec![("5b10", "Mia"), ("712020:abc", "Ann")]
        );
        assert!(assignable_of(200, "{}").is_err());
        assert_eq!(
            assignable_of(401, ""),
            Err("Jira が認証を拒否しました（401）".into())
        );
    }

    #[test]
    fn priorities_of_reads_the_allowed_values_of_the_edit_metadata() {
        let body = r#"{"fields":{"summary":{"required":true},"priority":{"required":false,"allowedValues":[
            {"id":"1","name":"Highest"},{"id":"3","name":"Medium"},{"id":"x","name":"Bad"},{"name":"No id"}]}}}"#;
        let list = priorities_of(200, body).unwrap();
        assert_eq!(
            list,
            vec![
                JiraPriority {
                    id: "1".into(),
                    name: "Highest".into()
                },
                JiraPriority {
                    id: "3".into(),
                    name: "Medium".into()
                },
            ]
        );
        // A ticket whose priority is not editable has no such field.
        assert_eq!(priorities_of(200, r#"{"fields":{}}"#), Ok(vec![]));
        assert_eq!(priorities_of(200, "{}"), Ok(vec![]));
        assert!(priorities_of(200, "<html>").is_err());
        assert_eq!(
            priorities_of(500, "boom"),
            Err("Jira が 500 を返しました: boom".into())
        );
    }

    #[test]
    fn done_of_is_a_success_for_any_2xx_and_the_reason_otherwise() {
        assert_eq!(done_of(204, ""), Ok(()));
        assert_eq!(done_of(200, "{}"), Ok(()));
        assert_eq!(
            done_of(400, r#"{"errors":{"resolution":"Resolution is required"}}"#),
            Err(
                r#"Jira が 400 を返しました: {"errors":{"resolution":"Resolution is required"}}"#
                    .into()
            )
        );
        assert_eq!(
            done_of(403, ""),
            Err("Jira が認証を拒否しました（403）".into())
        );
    }

    #[tokio::test]
    async fn the_transitions_of_a_ticket_are_read_with_the_credential() {
        let (site, seen) = serve_each(vec![json_answer(
            r#"{"transitions":[{"id":"11","name":"Start","to":{"name":"In Progress","statusCategory":{"key":"indeterminate"}}}]}"#,
        )])
        .await;
        let list = transitions(&basic_conn(&site).await, "EX-7").await.unwrap();
        assert_eq!(list[0].status, "In Progress");
        let requests = seen.await.unwrap();
        assert!(
            requests[0].starts_with("get /rest/api/3/issue/ex-7/transitions http/1.1"),
            "{}",
            requests[0]
        );
        assert!(requests[0].contains(BASIC));
    }

    #[tokio::test]
    async fn a_transition_is_posted_with_its_id_and_a_bad_one_asks_nothing() {
        let (site, seen) = serve_each(vec![NO_CONTENT.into()]).await;
        let conn = basic_conn(&site).await;
        transition(&conn, "EX-7", "31").await.unwrap();
        let requests = seen.await.unwrap();
        assert!(
            requests[0].starts_with("post /rest/api/3/issue/ex-7/transitions http/1.1"),
            "{}",
            requests[0]
        );
        assert!(requests[0].contains(BASIC));
        assert!(requests[0].contains("content-type: application/json"));
        assert!(
            requests[0].ends_with(r#"{"transition":{"id":"31"}}"#),
            "{}",
            requests[0]
        );
        let dead = basic_conn("http://127.0.0.1:1").await;
        assert_eq!(
            transition(&dead, "EX-7", "../1").await,
            Err("ID の形が正しくありません".into())
        );
        assert_eq!(
            transition(&dead, "ex-7", "1").await,
            Err("チケットのキーの形が正しくありません".into())
        );
    }

    #[tokio::test]
    async fn a_refused_transition_is_the_error_with_jiras_reason() {
        let (site, _seen) = serve_each(vec![
            "HTTP/1.1 400 Bad Request\r\nContent-Length: 29\r\nConnection: close\r\n\r\n{\"errors\":{\"resolution\":\"r\"}}".into(),
        ])
        .await;
        assert_eq!(
            transition(&basic_conn(&site).await, "EX-7", "31").await,
            Err(r#"Jira が 400 を返しました: {"errors":{"resolution":"r"}}"#.into())
        );
    }

    #[tokio::test]
    async fn the_assignable_people_are_asked_for_the_ticket_and_an_assignment_puts_the_account_id_or_null(
    ) {
        let (site, seen) = serve_each(vec![
            json_answer(r#"[{"accountId":"5b10","displayName":"Mia"}]"#),
            NO_CONTENT.into(),
            NO_CONTENT.into(),
        ])
        .await;
        let conn = basic_conn(&site).await;
        assert_eq!(assignable(&conn, "EX-7").await.unwrap().len(), 1);
        assign(&conn, "EX-7", Some("5b10")).await.unwrap();
        assign(&conn, "EX-7", None).await.unwrap();
        let requests = seen.await.unwrap();
        assert!(
            requests[0].starts_with(
                "get /rest/api/3/user/assignable/search?issuekey=ex-7&maxresults=100 http/1.1"
            ),
            "{}",
            requests[0]
        );
        assert!(
            requests[1].starts_with("put /rest/api/3/issue/ex-7/assignee http/1.1"),
            "{}",
            requests[1]
        );
        assert!(
            requests[1].ends_with(r#"{"accountid":"5b10"}"#),
            "{}",
            requests[1]
        );
        assert!(
            requests[2].ends_with(r#"{"accountid":null}"#),
            "{}",
            requests[2]
        );
        assert!(requests.iter().all(|r| r.contains(BASIC)));
        let dead = basic_conn("http://127.0.0.1:1").await;
        assert_eq!(
            assign(&dead, "EX-7", Some("-1")).await,
            Err("アカウント ID の形が正しくありません".into())
        );
    }

    #[tokio::test]
    async fn the_priorities_come_from_the_edit_metadata_and_a_priority_is_put_by_its_id() {
        let (site, seen) = serve_each(vec![
            json_answer(r#"{"fields":{"priority":{"allowedValues":[{"id":"2","name":"High"}]}}}"#),
            NO_CONTENT.into(),
        ])
        .await;
        let conn = basic_conn(&site).await;
        assert_eq!(priorities(&conn, "EX-7").await.unwrap()[0].name, "High");
        set_priority(&conn, "EX-7", "2").await.unwrap();
        let requests = seen.await.unwrap();
        assert!(
            requests[0].starts_with("get /rest/api/3/issue/ex-7/editmeta http/1.1"),
            "{}",
            requests[0]
        );
        assert!(
            requests[1].starts_with("put /rest/api/3/issue/ex-7 http/1.1"),
            "{}",
            requests[1]
        );
        assert!(
            requests[1].ends_with(r#"{"fields":{"priority":{"id":"2"}}}"#),
            "{}",
            requests[1]
        );
        let dead = basic_conn("http://127.0.0.1:1").await;
        assert_eq!(
            set_priority(&dead, "EX-7", "High").await,
            Err("ID の形が正しくありません".into())
        );
    }

    #[tokio::test]
    async fn a_ticket_goes_into_a_sprint_or_back_to_the_backlog() {
        let (site, seen) = serve_each(vec![NO_CONTENT.into(), NO_CONTENT.into()]).await;
        let conn = basic_conn(&site).await;
        move_to_sprint(&conn, "EX-7", Some(37)).await.unwrap();
        move_to_sprint(&conn, "EX-7", None).await.unwrap();
        let requests = seen.await.unwrap();
        assert!(
            requests[0].starts_with("post /rest/agile/1.0/sprint/37/issue http/1.1"),
            "{}",
            requests[0]
        );
        assert!(
            // The helper lowercases what it saw.
            requests[0].ends_with(r#"{"issues":["ex-7"]}"#),
            "{}",
            requests[0]
        );
        assert!(
            requests[1].starts_with("post /rest/agile/1.0/backlog/issue http/1.1"),
            "{}",
            requests[1]
        );
        assert!(requests.iter().all(|r| r.contains(BASIC)));
        assert_eq!(
            move_to_sprint(&basic_conn("http://127.0.0.1:1").await, "x", Some(1)).await,
            Err("チケットのキーの形が正しくありません".into())
        );
    }

    #[tokio::test]
    async fn a_write_through_the_gateway_sends_the_bearer_credential_and_a_redirect_is_not_followed(
    ) {
        let (site, tenant_seen) = serve_once(tenant_answer()).await;
        let (gateway, seen) = serve_each(vec![NO_CONTENT.into()]).await;
        let conn = connect(&site, "", "tok", &gateway).await.unwrap();
        transition(&conn, "EX-7", "31").await.unwrap();
        let requests = seen.await.unwrap();
        assert!(
            requests[0].starts_with(&format!(
                "post /ex/jira/{TENANT_ANSWER_ID}/rest/api/3/issue/ex-7/transitions http/1.1"
            )),
            "{}",
            requests[0]
        );
        assert!(requests[0].contains("authorization: bearer tok\r\n"));
        assert!(!lower(&tenant_seen.await.unwrap()).contains("authorization"));
        let (site, seen) = serve_each(vec![
            "HTTP/1.1 302 Found\r\nLocation: http://127.0.0.1:1/x\r\nContent-Length: 0\r\nConnection: close\r\n\r\n".into(),
        ])
        .await;
        assert_eq!(
            transition(&basic_conn(&site).await, "EX-7", "31").await,
            Err("Jira が 302 を返しました: ".into())
        );
        assert_eq!(seen.await.unwrap().len(), 1);
    }

    fn description_answer(description: &Value) -> String {
        json_answer(
            &serde_json::json!({"key": "EX-7", "fields": {"description": description}}).to_string(),
        )
    }

    fn adf_doc(content: Value) -> Value {
        serde_json::json!({"version": 1, "type": "doc", "content": content})
    }

    fn body_of(request: &str) -> Value {
        serde_json::from_str(request.split("\r\n\r\n").nth(1).unwrap()).unwrap()
    }

    fn described() -> Value {
        adf_doc(serde_json::json!([
            {"type": "paragraph", "content": [
                {"type": "text", "text": "Ask "},
                {"type": "mention", "attrs": {"id": "u1", "text": "@Taro"}}
            ]},
            {"type": "paragraph", "content": [{"type": "text", "text": "second"}]}
        ]))
    }

    #[tokio::test]
    async fn the_description_is_read_merged_with_the_markdown_and_put_back() {
        let current = described();
        let base = adf::adf_to_markdown(&current);
        assert_eq!(base, "Ask @Taro\n\nsecond");
        let (site, seen) = serve_each(vec![description_answer(&current), NO_CONTENT.into()]).await;
        let saved = set_description(
            &basic_conn(&site).await,
            "EX-7",
            &base,
            "Ask @Taro\n\nsecond, edited\n\n- [ ] new task",
        )
        .await
        .unwrap();
        assert_eq!(saved, "Ask @Taro\n\nsecond, edited\n\n- ☐ new task");
        let requests = seen.await.unwrap();
        assert!(
            requests[0].starts_with("get /rest/api/3/issue/ex-7?fields=description http/1.1"),
            "{}",
            requests[0]
        );
        assert!(
            requests[1].starts_with("put /rest/api/3/issue/ex-7 http/1.1"),
            "{}",
            requests[1]
        );
        assert!(requests[1].contains(BASIC));
        assert!(requests[1].contains("content-type: application/json"));
        let sent = body_of(&requests[1]);
        let doc = &sent["fields"]["description"];
        assert_eq!(doc["type"], "doc");
        assert_eq!(doc["version"], 1);
        // The paragraph that was not edited is the one Jira holds, with its mention.
        assert_eq!(
            doc["content"][0],
            serde_json::from_str::<Value>(&current["content"][0].to_string().to_lowercase())
                .unwrap()
        );
        assert_eq!(doc["content"][1]["content"][0]["text"], "second, edited");
        let task = &doc["content"][2];
        // The request is lowercased by `lower`.
        assert_eq!(task["type"], "tasklist");
        assert!(task["attrs"]["localid"].is_string());
        assert!(task["content"][0]["attrs"]["localid"].is_string());
        assert_eq!(task["content"][0]["attrs"]["state"], "todo");
    }

    #[tokio::test]
    async fn a_description_that_changed_in_jira_meanwhile_is_not_overwritten() {
        let (site, seen) = serve_each(vec![description_answer(&described())]).await;
        let err = set_description(&basic_conn(&site).await, "EX-7", "Ask someone else", "new")
            .await
            .unwrap_err();
        assert_eq!(err, "説明が Jira で変更されています。読み直してください");
        assert_eq!(seen.await.unwrap().len(), 1);
    }

    #[tokio::test]
    async fn a_description_that_changes_nothing_sends_nothing_and_an_empty_one_is_null() {
        let current = described();
        let base = adf::adf_to_markdown(&current);
        let (site, seen) = serve_each(vec![description_answer(&current)]).await;
        assert_eq!(
            set_description(
                &basic_conn(&site).await,
                "EX-7",
                &base,
                "Ask @Taro\n\nsecond"
            )
            .await
            .unwrap(),
            base
        );
        assert_eq!(seen.await.unwrap().len(), 1);
        let plain = adf_doc(
            serde_json::json!([{"type": "paragraph", "content": [{"type": "text", "text": "x"}]}]),
        );
        let (site, seen) = serve_each(vec![description_answer(&plain), NO_CONTENT.into()]).await;
        assert_eq!(
            set_description(&basic_conn(&site).await, "EX-7", "x", "  \n")
                .await
                .unwrap(),
            ""
        );
        let requests = seen.await.unwrap();
        assert_eq!(
            body_of(&requests[1]),
            serde_json::json!({"fields": {"description": null}})
        );
        // A ticket with no description takes the new one.
        let (site, seen) =
            serve_each(vec![description_answer(&Value::Null), NO_CONTENT.into()]).await;
        set_description(&basic_conn(&site).await, "EX-7", "", "hello")
            .await
            .unwrap();
        let requests = seen.await.unwrap();
        assert_eq!(
            body_of(&requests[1])["fields"]["description"]["content"][0]["content"][0]["text"],
            "hello"
        );
    }

    #[tokio::test]
    async fn a_bad_key_or_a_huge_text_asks_nothing_and_a_refusal_is_the_error() {
        let dead = basic_conn("http://127.0.0.1:1").await;
        assert_eq!(
            set_description(&dead, "ex-7", "", "x").await,
            Err("チケットのキーの形が正しくありません".into())
        );
        assert_eq!(
            set_description(&dead, "EX-7", "", &"x".repeat(MARKDOWN_LIMIT + 1)).await,
            Err("文章が長すぎます".into())
        );
        assert_eq!(
            add_comment(&dead, "../x", "x").await,
            Err("チケットのキーの形が正しくありません".into())
        );
        let current = described();
        let base = adf::adf_to_markdown(&current);
        let (site, _seen) = serve_each(vec![
            description_answer(&current),
            "HTTP/1.1 400 Bad Request\r\nContent-Length: 12\r\nConnection: close\r\n\r\n{\"errors\":1}".into(),
        ])
        .await;
        assert_eq!(
            set_description(&basic_conn(&site).await, "EX-7", &base, "changed").await,
            Err(r#"Jira が 400 を返しました: {"errors":1}"#.into())
        );
    }

    #[test]
    fn comment_of_reads_the_comment_that_jira_answers_with() {
        let body = serde_json::json!({
            "author": {"displayName": "Taro"},
            "created": "2026-11-25T09:30:12.345+0900",
            "body": adf_doc(serde_json::json!([{"type": "paragraph", "content": [{"type": "text", "text": "hi"}]}]))
        })
        .to_string();
        assert_eq!(
            comment_of(201, &body),
            Ok(JiraComment {
                author: "Taro".into(),
                created: "2026-11-25 09:30".into(),
                body: "hi".into()
            })
        );
        assert_eq!(
            comment_of(403, ""),
            Err("Jira が認証を拒否しました（401）".replace("401", "403"))
        );
        assert!(comment_of(201, "not json")
            .unwrap_err()
            .contains("追加されました"));
    }

    #[tokio::test]
    async fn a_comment_is_posted_as_adf_and_a_blank_one_asks_nothing() {
        let answer = serde_json::json!({
            "author": {"displayName": "Me"},
            "created": "2026-11-25T10:00:00.000+0900",
            "body": adf_doc(serde_json::json!([{"type": "paragraph", "content": [{"type": "text", "text": "ok"}]}]))
        })
        .to_string();
        let created = format!(
            "HTTP/1.1 201 Created\r\nContent-Type: application/json\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{answer}",
            answer.len()
        );
        let (site, seen) = serve_each(vec![created]).await;
        let conn = basic_conn(&site).await;
        let comment = add_comment(&conn, "EX-7", "**ok**\n\n- [x] done")
            .await
            .unwrap();
        assert_eq!(comment.author, "Me");
        assert_eq!(comment.body, "ok");
        let requests = seen.await.unwrap();
        assert!(
            requests[0].starts_with("post /rest/api/3/issue/ex-7/comment http/1.1"),
            "{}",
            requests[0]
        );
        assert!(requests[0].contains(BASIC));
        let sent = body_of(&requests[0]);
        assert_eq!(sent["body"]["type"], "doc");
        assert_eq!(
            sent["body"]["content"][0]["content"][0]["marks"][0]["type"],
            "strong"
        );
        assert_eq!(sent["body"]["content"][1]["type"], "tasklist");
        assert!(sent["body"]["content"][1]["attrs"]["localid"].is_string());
        let dead = basic_conn("http://127.0.0.1:1").await;
        assert_eq!(
            add_comment(&dead, "EX-7", " \n\n ").await,
            Err("コメントを入力してください".into())
        );
    }

    #[tokio::test]
    async fn the_two_writes_of_the_tab_go_through_the_gateway_with_the_bearer_credential() {
        let (site, tenant_seen) = serve_once(tenant_answer()).await;
        let (gateway, seen) =
            serve_each(vec![description_answer(&Value::Null), NO_CONTENT.into()]).await;
        let conn = connect(&site, "", "tok", &gateway).await.unwrap();
        set_description(&conn, "EX-7", "", "hello").await.unwrap();
        let requests = seen.await.unwrap();
        assert!(requests[1].starts_with(&format!(
            "put /ex/jira/{TENANT_ANSWER_ID}/rest/api/3/issue/ex-7 http/1.1"
        )));
        assert!(requests[1].contains("authorization: bearer tok\r\n"));
        assert!(!lower(&tenant_seen.await.unwrap()).contains("authorization"));
    }

    #[test]
    fn project_of_keeps_the_projects_that_can_go_into_a_body() {
        let list: Vec<RawProject> = serde_json::from_str(
            r#"[{"id":"10000","key":"EX","name":"Example"},
                {"id":"10001","key":"NN"},
                {"id":"10002","key":"OLD","name":"Old","archived":true},
                {"id":"../3","key":"BAD","name":"Bad"},
                {"key":"NOID","name":"No id"}]"#,
        )
        .unwrap();
        assert_eq!(
            list.into_iter().filter_map(project_of).collect::<Vec<_>>(),
            vec![
                JiraProject {
                    id: "10000".into(),
                    key: "EX".into(),
                    name: "Example".into()
                },
                JiraProject {
                    id: "10001".into(),
                    key: "NN".into(),
                    name: "NN".into()
                },
            ]
        );
    }

    #[test]
    fn issue_type_of_leaves_out_subtasks_and_what_has_no_usable_id_or_name() {
        let list: Vec<RawIssueType> = serde_json::from_str(
            r#"[{"id":"10001","name":"Task","subtask":false},
                {"id":"10002","name":"Bug"},
                {"id":"10003","name":"Sub-task","subtask":true},
                {"id":"x","name":"Bad id"},
                {"id":"10005","name":""},
                {"id":"10006"}]"#,
        )
        .unwrap();
        assert_eq!(
            list.into_iter()
                .filter_map(issue_type_of)
                .collect::<Vec<_>>(),
            vec![
                JiraIssueType {
                    id: "10001".into(),
                    name: "Task".into()
                },
                JiraIssueType {
                    id: "10002".into(),
                    name: "Bug".into()
                },
            ]
        );
    }

    #[test]
    fn summary_of_trims_and_refuses_an_empty_long_or_multi_line_summary() {
        assert_eq!(summary_of("  Fix it \n"), Ok("Fix it"));
        assert_eq!(summary_of(" \n "), Err("件名を入力してください".into()));
        assert_eq!(
            summary_of("a\nb"),
            Err("件名に改行や制御文字は入れられません".into())
        );
        assert_eq!(
            summary_of("a\u{0}b"),
            Err("件名に改行や制御文字は入れられません".into())
        );
        assert!(summary_of(&"あ".repeat(255)).is_ok());
        assert_eq!(
            summary_of(&"あ".repeat(256)),
            Err("件名は 255 文字までです".into())
        );
    }

    #[test]
    fn create_body_has_the_ids_the_summary_and_a_description_only_when_there_is_one() {
        let blocks = vec![serde_json::json!({"type": "paragraph", "content": []})];
        assert_eq!(
            create_body("10000", "10001", "Sum", blocks.clone()),
            serde_json::json!({"fields": {
                "project": {"id": "10000"},
                "issuetype": {"id": "10001"},
                "summary": "Sum",
                "description": {"version": 1, "type": "doc", "content": blocks},
            }})
        );
        assert_eq!(
            create_body("10000", "10001", "Sum", vec![]),
            serde_json::json!({"fields": {
                "project": {"id": "10000"},
                "issuetype": {"id": "10001"},
                "summary": "Sum",
            }})
        );
    }

    #[test]
    fn created_of_reads_the_key_and_says_why_for_a_failure() {
        assert_eq!(
            created_of(
                201,
                r#"{"id":"10042","key":"EX-42","self":"https://x/10042"}"#
            ),
            Ok("EX-42".into())
        );
        for body in ["not json", "{}", r#"{"key":"../x"}"#, r#"{"key":"ex-1"}"#] {
            assert!(
                created_of(201, body).unwrap_err().contains("作られました"),
                "{body}"
            );
        }
        assert_eq!(
            created_of(400, r#"{"errors":{"summary":"required"}}"#),
            Err(r#"Jira が 400 を返しました: {"errors":{"summary":"required"}}"#.into())
        );
        assert_eq!(
            created_of(403, ""),
            Err("Jira が認証を拒否しました（403）".into())
        );
    }

    #[tokio::test]
    async fn the_projects_to_create_in_are_read_page_by_page_and_the_issue_types_by_project_id() {
        let page = |values: &str, last: bool| {
            json_answer(&format!(
                r#"{{"values":{values},"isLast":{last},"startAt":0,"total":3}}"#
            ))
        };
        let (site, seen) = serve_each(vec![
            page(r#"[{"id":"10000","key":"EX","name":"Example"},{"id":"10001","key":"AB","name":"Alpha"}]"#, false),
            page(r#"[{"id":"10002","key":"CD","name":"Beta","archived":true}]"#, true),
            json_answer(
                r#"{"startAt":0,"maxResults":50,"total":2,"issueTypes":[{"id":"10001","name":"Task","subtask":false},{"id":"10003","name":"Sub-task","subtask":true}]}"#,
            ),
        ])
        .await;
        let conn = basic_conn(&site).await;
        let list = projects(&conn).await.unwrap();
        assert_eq!(
            list.iter().map(|p| p.key.as_str()).collect::<Vec<_>>(),
            ["EX", "AB"]
        );
        let types = issue_types(&conn, "10000").await.unwrap();
        assert_eq!(
            types,
            vec![JiraIssueType {
                id: "10001".into(),
                name: "Task".into()
            }]
        );
        let requests = seen.await.unwrap();
        assert!(
            requests[0].starts_with(
                "get /rest/api/3/project/search?action=create&orderby=name&startat=0&maxresults=50 http/1.1"
            ),
            "{}",
            requests[0]
        );
        assert!(
            requests[1].contains("startat=2&maxresults=50"),
            "{}",
            requests[1]
        );
        assert!(
            requests[2].starts_with(
                "get /rest/api/3/issue/createmeta/10000/issuetypes?startat=0&maxresults=50 http/1.1"
            ),
            "{}",
            requests[2]
        );
        assert!(requests.iter().all(|r| r.contains(BASIC)));
        for bad in ["", "EX", "../1", "1/2", "1?x=y"] {
            assert_eq!(
                issue_types(&basic_conn("http://127.0.0.1:1").await, bad).await,
                Err("ID の形が正しくありません".into()),
                "{bad}"
            );
        }
    }

    fn created_answer() -> String {
        let body = r#"{"id":"10042","key":"EX-42","self":"https://x/rest/api/3/issue/10042"}"#;
        format!(
            "HTTP/1.1 201 Created\r\nContent-Type: application/json\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{body}",
            body.len()
        )
    }

    #[tokio::test]
    async fn a_ticket_is_created_with_its_fields_and_then_put_in_the_sprint() {
        let (site, seen) = serve_each(vec![created_answer(), NO_CONTENT.into()]).await;
        let conn = basic_conn(&site).await;
        let created = create_issue(
            &conn,
            "10000",
            "10001",
            " New one ",
            "**why**\n\n- a",
            Some(37),
        )
        .await
        .unwrap();
        assert_eq!(
            created,
            JiraCreated {
                key: "EX-42".into(),
                sprint_error: None
            }
        );
        let requests = seen.await.unwrap();
        assert!(
            requests[0].starts_with("post /rest/api/3/issue http/1.1"),
            "{}",
            requests[0]
        );
        assert!(requests[0].contains(BASIC));
        let sent = body_of(&requests[0]);
        assert_eq!(sent["fields"]["project"]["id"], "10000");
        assert_eq!(sent["fields"]["issuetype"]["id"], "10001");
        assert_eq!(sent["fields"]["summary"], "new one");
        assert_eq!(sent["fields"]["description"]["type"], "doc");
        assert_eq!(
            sent["fields"]["description"]["content"][0]["content"][0]["marks"][0]["type"],
            "strong"
        );
        assert!(
            requests[1].starts_with("post /rest/agile/1.0/sprint/37/issue http/1.1"),
            "{}",
            requests[1]
        );
        assert!(
            requests[1].ends_with(r#"{"issues":["ex-42"]}"#),
            "{}",
            requests[1]
        );
    }

    #[tokio::test]
    async fn a_ticket_with_no_description_and_no_sprint_sends_neither() {
        let (site, seen) = serve_each(vec![created_answer()]).await;
        let created = create_issue(
            &basic_conn(&site).await,
            "10000",
            "10001",
            "Only",
            " \n ",
            None,
        )
        .await
        .unwrap();
        assert_eq!(created.key, "EX-42");
        let requests = seen.await.unwrap();
        assert_eq!(requests.len(), 1);
        let sent = body_of(&requests[0]);
        assert!(sent["fields"].get("description").is_none());
        assert!(sent["fields"].get("sprint").is_none());
    }

    #[tokio::test]
    async fn a_ticket_that_could_not_be_put_in_the_sprint_is_still_the_answer_with_the_reason() {
        let (site, seen) = serve_each(vec![
            created_answer(),
            "HTTP/1.1 400 Bad Request\r\nContent-Length: 6\r\nConnection: close\r\n\r\nclosed"
                .into(),
        ])
        .await;
        let created = create_issue(&basic_conn(&site).await, "10000", "10001", "S", "", Some(5))
            .await
            .unwrap();
        assert_eq!(created.key, "EX-42");
        assert_eq!(
            created.sprint_error,
            Some("チケット EX-42 は作りましたが、スプリントに入れられませんでした: Jira が 400 を返しました: closed".into())
        );
        assert_eq!(seen.await.unwrap().len(), 2);
    }

    #[tokio::test]
    async fn a_refused_create_is_the_error_and_puts_nothing_in_a_sprint() {
        let (site, seen) = serve_each(vec![
            "HTTP/1.1 400 Bad Request\r\nContent-Length: 12\r\nConnection: close\r\n\r\nneed a field".into(),
        ])
        .await;
        assert_eq!(
            create_issue(&basic_conn(&site).await, "10000", "10001", "S", "", Some(5)).await,
            Err("Jira が 400 を返しました: need a field".into())
        );
        assert_eq!(seen.await.unwrap().len(), 1);
    }

    #[tokio::test]
    async fn a_create_with_a_bad_value_asks_nothing() {
        let dead = basic_conn("http://127.0.0.1:1").await;
        for (project, kind, summary, markdown, error) in [
            ("x", "10001", "S", "", "ID の形が正しくありません"),
            ("10000", "1/2", "S", "", "ID の形が正しくありません"),
            ("10000", "10001", " ", "", "件名を入力してください"),
            (
                "10000",
                "10001",
                "a\nb",
                "",
                "件名に改行や制御文字は入れられません",
            ),
        ] {
            assert_eq!(
                create_issue(&dead, project, kind, summary, markdown, None).await,
                Err(error.into()),
                "{project} {kind} {summary:?}"
            );
        }
        assert_eq!(
            create_issue(
                &dead,
                "10000",
                "10001",
                "S",
                &"a".repeat(MARKDOWN_LIMIT + 1),
                None
            )
            .await,
            Err("文章が長すぎます".into())
        );
    }

    #[tokio::test]
    async fn the_create_goes_through_the_gateway_with_the_bearer_credential() {
        let (site, tenant_seen) = serve_once(tenant_answer()).await;
        let (gateway, seen) = serve_each(vec![created_answer(), NO_CONTENT.into()]).await;
        let conn = connect(&site, "", "tok", &gateway).await.unwrap();
        create_issue(&conn, "10000", "10001", "S", "", Some(7))
            .await
            .unwrap();
        let requests = seen.await.unwrap();
        assert!(requests[0].starts_with(&format!(
            "post /ex/jira/{TENANT_ANSWER_ID}/rest/api/3/issue http/1.1"
        )));
        assert!(requests[1].starts_with(&format!(
            "post /ex/jira/{TENANT_ANSWER_ID}/rest/agile/1.0/sprint/7/issue http/1.1"
        )));
        assert!(requests
            .iter()
            .all(|r| r.contains("authorization: bearer tok\r\n")));
        assert!(!lower(&tenant_seen.await.unwrap()).contains("authorization"));
    }
}
