//! A-46: a tab of the Orca screen shown in a window of its own (a macOS window `tab-{n}`, made from `popout.html`).
//!
//! The screen (`ts/orca-popout.ts`) asks for the window with `orca_popout_open`, and keeps the tab out of its pane (`away` of `orca_panes`).
//! The page of the window (`ts/popout.ts`) asks what it shows (`orca_popout_attach`) and draws it, and its two buttons are `orca_popout_pin` (the window stays on top) and `orca_popout_restore`.
//! The window has no permission of its own: what it does goes through these commands, and what the two pages tell each other goes through channels, which need no `event` permission.
//! The screen's channel (`orca_popout_main`) carries what the owner did in a window, the close (the red button, which is stopped here and left to the screen, so the tab is closed as the × of its pane closes it), the restore,
//! and the definition that the editor of a file window asked for (`orca_popout_definition`), which the screen shows as a tab of its own pane;
//! the window's channel (`orca_popout_attach`) carries what the screen knows of the tab now (its name, its status, where its terminal comes from) and, for a file, the red button.
//! A diff, a definition and a database tab are held by their conditions (`PopoutDiff`, `PopoutDefinition`, `PopoutDatabase`): the page of the window reads them again, the screen keeps its own copy of the tab in memory, and the red button is left to the screen.
//! A place that the definition tab of a window asks to open (`orca_popout_place`) is shown by the screen in its own pane, and a connection that a database tab of a window found lost (`orca_popout_lost`) is told to the screen, which closes its tabs as it does for its own.
//! A file is held by the page of its window (its text, its save): the red button is left to that page, which closes the file and then tells `orca_popout_close`, which asks the screen as the red button of a terminal does.
//! A window that the screen cannot be asked about (no channel, or a send that failed) is destroyed. The window ends with `orca_popout_end`, when the screen has done what the owner asked, and with the main window.
//! The table is held in memory only (a window is not restored when the app starts).

use std::{collections::HashMap, sync::Mutex};

use serde::{Deserialize, Serialize};
use tauri::{
    ipc::Channel, AppHandle, Manager, State, Webview, WebviewUrl, WebviewWindow,
    WebviewWindowBuilder, WindowEvent,
};
#[cfg(test)]
use ts_rs::TS;

use crate::orca::OrcaStatus;

/// The label of a window made here is this and a number: `tab-1`, `tab-2`. The capabilities name them `tab-*`.
const PREFIX: &str = "tab-";
const PAGE: &str = "popout.html";
/// More windows than this are not opened.
const MAX_WINDOWS: usize = 24;
const MAX_TEXT: usize = 2048;

/// The terminal that a Claude session or a plain terminal shows: its handle in Orca, the worktree it runs in, where its screen comes from (`stream`: the stream of its place; else a mirror read through Orca's command) and whether it ended.
#[derive(Serialize, Deserialize, Clone, Debug, PartialEq)]
#[cfg_attr(test, derive(TS))]
#[cfg_attr(test, ts(export, export_to = crate::BINDINGS))]
#[serde(rename_all = "camelCase")]
pub struct PopoutTerminal {
    pub handle: String,
    pub path: String,
    pub stream: bool,
    pub ended: bool,
}

/// The file that a file tab (an editor tab, A-18, and a scratchpad, A-29) shows: the worktree, the file in it (`relative`) and, for a file outside the worktree that a definition named (A-34), the server that gave it (`relative` is then its absolute path on the server's side, and the file is read only).
#[derive(Serialize, Deserialize, Clone, Debug, PartialEq)]
#[cfg_attr(test, derive(TS))]
#[cfg_attr(test, ts(export, export_to = crate::BINDINGS))]
#[serde(rename_all = "camelCase")]
pub struct PopoutFile {
    pub path: String,
    pub relative: String,
    pub server: Option<String>,
}

/// The commit that a diff tab shows a file of (A-27): its full id and short one, its first parent (null for the first commit) and the path the file had at the parent when it was renamed.
#[derive(Serialize, Deserialize, Clone, Debug, PartialEq)]
#[cfg_attr(test, derive(TS))]
#[cfg_attr(test, ts(export, export_to = crate::BINDINGS))]
#[serde(rename_all = "camelCase")]
pub struct PopoutCommit {
    pub id: String,
    pub short_id: String,
    pub parent_id: Option<String>,
    pub old_relative: Option<String>,
}

/// The difference that a diff tab (A-24) shows: the worktree, the file in it (`relative`) and, for a file of a commit, the commit. The target is the tab's `environment`.
#[derive(Serialize, Deserialize, Clone, Debug, PartialEq)]
#[cfg_attr(test, derive(TS))]
#[cfg_attr(test, ts(export, export_to = crate::BINDINGS))]
#[serde(rename_all = "camelCase")]
pub struct PopoutDiff {
    pub path: String,
    pub relative: String,
    pub commit: Option<PopoutCommit>,
}

/// The table or the SQL that a database tab (A-43) shows, as it was when the window was made: the connection and its name, the database, the table (none for the SQL of a database), the selected tab of the table (`records`, `structure` or `sql`), the page of its records and the text of its SQL field.
#[derive(Serialize, Deserialize, Clone, Debug, PartialEq)]
#[cfg_attr(test, derive(TS))]
#[cfg_attr(test, ts(export, export_to = crate::BINDINGS))]
#[serde(rename_all = "camelCase")]
pub struct PopoutDatabase {
    pub connection: String,
    pub name: String,
    pub database: String,
    pub table: Option<String>,
    pub tab: String,
    pub page: u32,
    pub sql: String,
}

/// What a window shows, by the kind of the tab.
#[derive(Serialize, Deserialize, Clone, Debug, PartialEq)]
#[cfg_attr(test, derive(TS))]
#[cfg_attr(test, ts(export, export_to = crate::BINDINGS))]
#[serde(tag = "kind", rename_all = "camelCase")]
pub enum PopoutContent {
    Claude(PopoutTerminal),
    Terminal(PopoutTerminal),
    File(PopoutFile),
    Diff(PopoutDiff),
    Definition(PopoutDefinition),
    Database(PopoutDatabase),
}

/// A tab of the screen that is in a window: its id and project (which `orca_panes` keeps its place under), the name and the status its header shows, where it is (`environment`: null for this machine) and what it shows.
/// The texts are from the list of Orca, so the page draws them as text.
#[derive(Serialize, Deserialize, Clone, Debug, PartialEq)]
#[cfg_attr(test, derive(TS))]
#[cfg_attr(test, ts(export, export_to = crate::BINDINGS))]
#[serde(rename_all = "camelCase")]
pub struct PopoutTab {
    pub tab: String,
    pub project: String,
    pub title: String,
    pub status: OrcaStatus,
    pub label: String,
    pub environment: Option<String>,
    pub content: PopoutContent,
}

/// The question about the definition of a name (A-34), as the screen takes it for the definition tab (`DefinitionQuery` of `ts/orca-definition.ts`, whose `tab` the screen fills from the window): the question of the editor of a file window, and what a definition tab shows.
#[derive(Serialize, Deserialize, Clone, Debug, PartialEq)]
#[cfg_attr(test, derive(TS))]
#[cfg_attr(test, ts(export, export_to = crate::BINDINGS))]
#[serde(rename_all = "camelCase")]
pub struct PopoutDefinition {
    pub target: Option<String>,
    pub project: String,
    pub path: String,
    pub server: String,
    pub relative: String,
    pub text: String,
    pub line: u32,
    pub character: u32,
    pub word: String,
}

/// What the owner did in a window, which the screen carries out: the tab is closed (the red button), it goes back to its pane, its editor asked for the definition of a name, which the screen shows in its own pane,
/// the definition tab of the window asked to open a place (`query` is the tab's question), or the database tab of the window found its connection lost.
#[derive(Serialize, Clone, Debug, PartialEq)]
#[cfg_attr(test, derive(TS))]
#[cfg_attr(test, ts(export, export_to = crate::BINDINGS))]
#[serde(tag = "kind", rename_all = "camelCase")]
pub enum PopoutAction {
    Close {
        tab: String,
    },
    Restore {
        tab: String,
    },
    Definition {
        tab: String,
        query: PopoutDefinition,
    },
    Place {
        tab: String,
        query: PopoutDefinition,
        path: String,
        outside: bool,
        line: u32,
        character: u32,
    },
    Lost {
        tab: String,
        connection: String,
        error: String,
    },
}

/// What the page of a window is told: the tab as the screen knows it now, and the red button of a window whose page holds the tab's document (a file).
#[derive(Serialize, Clone, Debug, PartialEq)]
#[cfg_attr(test, derive(TS))]
#[cfg_attr(test, ts(export, export_to = crate::BINDINGS))]
#[serde(tag = "kind", rename_all = "camelCase")]
pub enum PopoutPage {
    Tab { tab: Box<PopoutTab> },
    Close,
}

struct Slot {
    tab: PopoutTab,
    /// The channel of the page of the window, once it asked what it shows.
    page: Option<Channel<PopoutPage>>,
    /// Whether the screen ended the window (`orca_popout_end`): the destroy that follows is then not told back to it.
    ended: bool,
}

#[derive(Default)]
struct Table {
    /// The number of the next window.
    next: u64,
    /// The windows, by label.
    slots: HashMap<String, Slot>,
    /// The channel of the screen, which the page of the main window gave.
    screen: Option<Channel<PopoutAction>>,
}

/// The windows made here and the channel of the screen.
#[derive(Default)]
pub struct Popouts(Mutex<Table>);

impl Popouts {
    fn table(&self) -> std::sync::MutexGuard<'_, Table> {
        self.0.lock().unwrap_or_else(|e| e.into_inner())
    }
}

/// Whether `label` is the label of the main window, the only one that gives the screen's channel and asks for, keeps and ends the windows.
fn is_main(label: &str) -> bool {
    label == crate::MAIN_WINDOW
}

/// Refuses a command of the screen that another window calls (a window made here has no business with the table of the others).
fn from_main(webview: &Webview) -> Result<(), String> {
    if is_main(webview.label()) {
        Ok(())
    } else {
        Err("本体の画面だけが使えます".into())
    }
}

/// Whether `label` is the label of a window made here.
pub fn is_popout(label: &str) -> bool {
    label
        .strip_prefix(PREFIX)
        .is_some_and(|n| !n.is_empty() && n.bytes().all(|b| b.is_ascii_digit()))
}

fn check_text(what: &str, text: &str) -> Result<(), String> {
    if text.is_empty() || text.len() > MAX_TEXT || text.chars().any(char::is_control) {
        return Err(format!("{what}が正しくありません"));
    }
    Ok(())
}

/// Checks what the screen gave: every text is one line of a size that Orca's list can hold, and a tab that has a terminal names it.
fn check(tab: &PopoutTab) -> Result<(), String> {
    check_text("タブ", &tab.tab)?;
    check_text("プロジェクト", &tab.project)?;
    // A title may hold what a session's first line held, and a status label is one of the app's own.
    if tab.title.len() > MAX_TEXT || tab.title.chars().any(char::is_control) {
        return Err("タブの名前が正しくありません".into());
    }
    if tab.label.len() > MAX_TEXT || tab.label.chars().any(char::is_control) {
        return Err("タブの状態が正しくありません".into());
    }
    if let Some(environment) = &tab.environment {
        check_text("接続先", environment)?;
    }
    match &tab.content {
        PopoutContent::Claude(t) | PopoutContent::Terminal(t) => {
            check_text("ハンドル", &t.handle)?;
            if t.path.len() > MAX_TEXT || t.path.chars().any(char::is_control) {
                return Err("パスが正しくありません".into());
            }
        }
        PopoutContent::File(f) => {
            check_text("パス", &f.path)?;
            check_text("ファイル", &f.relative)?;
            if let Some(server) = &f.server {
                check_text("サーバー", server)?;
            }
        }
        PopoutContent::Diff(d) => {
            check_text("パス", &d.path)?;
            check_text("ファイル", &d.relative)?;
            if let Some(c) = &d.commit {
                check_text("コミット", &c.id)?;
                check_text("コミット", &c.short_id)?;
                for text in [&c.parent_id, &c.old_relative].into_iter().flatten() {
                    check_text("コミット", text)?;
                }
            }
        }
        PopoutContent::Definition(q) => {
            // What a definition tab shows is the question it asked: the project and the place are the tab's, and the rest is checked as the editor's question is.
            if q.target != tab.environment || q.project != tab.project {
                return Err("定義の問い合わせがタブと合っていません".into());
            }
            check_text("パス", &q.path)?;
            check_text("サーバー", &q.server)?;
            check_text("ファイル", &q.relative)?;
            check_text("名前", &q.word)?;
            if q.text.len() > MAX_DEFINITION_TEXT {
                return Err("ファイルが大きすぎます".into());
            }
        }
        PopoutContent::Database(d) => {
            check_text("接続", &d.connection)?;
            check_text("データベース", &d.database)?;
            if d.name.len() > MAX_TEXT || d.name.chars().any(char::is_control) {
                return Err("接続の名前が正しくありません".into());
            }
            if let Some(table) = &d.table {
                check_text("テーブル", table)?;
            }
            if !matches!(d.tab.as_str(), "records" | "structure" | "sql")
                || (d.table.is_none() && d.tab != "sql")
            {
                return Err("テーブルのタブが正しくありません".into());
            }
            if d.sql.len() > MAX_SQL_TEXT {
                return Err("SQL が大きすぎます".into());
            }
        }
    }
    Ok(())
}

/// The most that the text of a definition question holds: what `lsp_definition` takes.
const MAX_DEFINITION_TEXT: usize = 1024 * 1024;
/// The most that the text of the SQL field of a database tab holds.
const MAX_SQL_TEXT: usize = 1024 * 1024;

/// Checks a question of the editor of the window that holds `tab`: the window shows a file, and the question is about that file of that worktree (and, for a file outside it, to the server that gave it), so a window asks nothing of another file.
fn check_definition(tab: &PopoutTab, query: &PopoutDefinition) -> Result<(), String> {
    let PopoutContent::File(file) = &tab.content else {
        return Err("このウィンドウはファイルを開いていません".into());
    };
    if query.target != tab.environment
        || query.project != tab.project
        || query.path != file.path
        || query.relative != file.relative
        || file.server.as_ref().is_some_and(|s| *s != query.server)
    {
        return Err("このウィンドウのファイルの問い合わせではありません".into());
    }
    check_text("サーバー", &query.server)?;
    check_text("名前", &query.word)?;
    if query.text.len() > MAX_DEFINITION_TEXT {
        return Err("ファイルが大きすぎます".into());
    }
    Ok(())
}

/// Whether the page of a window holds the document of its tab (a file: its text and its save), so the red button is left to the page.
fn has_document(content: &PopoutContent) -> bool {
    matches!(content, PopoutContent::File(_))
}

impl Table {
    /// The label of the window that shows the tab `tab`.
    fn label_of(&self, tab: &str) -> Option<String> {
        self.slots
            .iter()
            .find(|(_, s)| s.tab.tab == tab)
            .map(|(label, _)| label.clone())
    }

    /// Takes a label for the tab and holds it; the tab that has a window already keeps it (`false` says the window exists).
    fn open(&mut self, tab: PopoutTab) -> Result<(String, bool), String> {
        if let Some(label) = self.label_of(&tab.tab) {
            return Ok((label, false));
        }
        if self.slots.len() >= MAX_WINDOWS {
            return Err("別ウィンドウが多すぎます".into());
        }
        self.next += 1;
        let label = format!("{PREFIX}{}", self.next);
        self.slots.insert(
            label.clone(),
            Slot {
                tab,
                page: None,
                ended: false,
            },
        );
        Ok((label, true))
    }

    /// The screen ends the window of the tab `tab`: its label, with the slot marked so that the destroy that follows is not told back to the screen. None when the tab has no window.
    fn end(&mut self, tab: &str) -> Option<String> {
        let label = self.label_of(tab)?;
        self.slots.get_mut(&label)?.ended = true;
        Some(label)
    }

    /// The window `label` is gone, and its slot with it. A window that the screen did not end (Rust destroyed it because the screen could not be asked, or it went by itself) leaves its tab away from its pane with no window, so the screen is told to put it back.
    fn gone(&mut self, label: &str) -> Option<PopoutAction> {
        let slot = self.slots.remove(label)?;
        (!slot.ended).then_some(PopoutAction::Restore { tab: slot.tab.tab })
    }

    /// The windows' tabs, in the order the windows were made.
    fn tabs(&self) -> Vec<PopoutTab> {
        let mut slots: Vec<(&String, &Slot)> = self.slots.iter().collect();
        slots.sort_by_key(|(label, _)| label[PREFIX.len()..].parse::<u64>().unwrap_or(0));
        slots.into_iter().map(|(_, s)| s.tab.clone()).collect()
    }

    /// The place that the definition tab of the window `label` asks to open, as the screen is told: the tab's own question with the place (`path` is relative to the worktree, or the server's absolute path when `outside`). A window of another kind, or a bad path, is refused.
    fn place_of(
        &self,
        label: &str,
        path: String,
        outside: bool,
        line: u32,
        character: u32,
    ) -> Result<PopoutAction, String> {
        let slot = self
            .slots
            .get(label)
            .ok_or("このウィンドウにタブがありません")?;
        let PopoutContent::Definition(query) = &slot.tab.content else {
            return Err("このウィンドウは定義を開いていません".into());
        };
        check_text("パス", &path)?;
        Ok(PopoutAction::Place {
            tab: slot.tab.tab.clone(),
            query: query.clone(),
            path,
            outside,
            line,
            character,
        })
    }

    /// The connection that the database tab of the window `label` found lost, as the screen is told; the connection must be the tab's own, and the text is cut to what a card shows.
    fn lost_of(&self, label: &str, connection: &str, error: &str) -> Result<PopoutAction, String> {
        let slot = self
            .slots
            .get(label)
            .ok_or("このウィンドウにタブがありません")?;
        match &slot.tab.content {
            PopoutContent::Database(d) if d.connection == connection => Ok(PopoutAction::Lost {
                tab: slot.tab.tab.clone(),
                connection: connection.to_owned(),
                error: error.chars().take(MAX_TEXT).collect(),
            }),
            _ => Err("このウィンドウの接続ではありません".into()),
        }
    }

    /// What the owner did in the window `label`, as the screen is told; none for a window that holds no tab.
    fn action_of(&self, label: &str, restore: bool) -> Option<PopoutAction> {
        let tab = self.slots.get(label)?.tab.tab.clone();
        Some(if restore {
            PopoutAction::Restore { tab }
        } else {
            PopoutAction::Close { tab }
        })
    }
}

fn destroy(app: &AppHandle, label: &str) {
    if let Some(window) = app.get_webview_window(label) {
        let _ = window.destroy();
    }
}

/// Tells the screen what the owner did in the window `label`; a window that the screen cannot be told about is destroyed, because nothing else can close it.
fn ask(app: &AppHandle, label: &str, restore: bool) {
    let state = app.state::<Popouts>();
    let (action, screen) = {
        let table = state.table();
        (table.action_of(label, restore), table.screen.clone())
    };
    let told = match (action, screen) {
        (Some(action), Some(screen)) => screen.send(action).is_ok(),
        _ => false,
    };
    if !told {
        destroy(app, label);
    }
}

fn build_window(app: &AppHandle, label: &str, title: &str) -> tauri::Result<()> {
    let builder = WebviewWindowBuilder::new(app, label, WebviewUrl::App(PAGE.into()))
        .title(title)
        .inner_size(960.0, 640.0)
        .min_inner_size(360.0, 240.0);
    // The header of the page is the title bar (A-23): the traffic lights sit on it, as on the main window.
    #[cfg(target_os = "macos")]
    let builder = builder
        .title_bar_style(tauri::TitleBarStyle::Overlay)
        .hidden_title(true)
        .traffic_light_position(tauri::LogicalPosition::new(12.0, 14.0));
    // The E2E build shows no window (`e2e.md`).
    #[cfg(feature = "e2e")]
    let builder = builder.visible(false);
    builder.build().map(|_| ())
}

/// Opens the window of `tab` and answers its label. A tab that has a window already is brought to the front.
#[tauri::command]
pub async fn orca_popout_open(
    app: AppHandle,
    webview: Webview,
    state: State<'_, Popouts>,
    tab: PopoutTab,
) -> Result<String, String> {
    from_main(&webview)?;
    check(&tab)?;
    let title = tab.title.clone();
    let (label, made) = state.table().open(tab)?;
    if !made {
        focus(&app, &label);
        return Ok(label);
    }
    if let Err(e) = build_window(&app, &label, &title) {
        state.table().slots.remove(&label);
        return Err(format!("別ウィンドウを開けませんでした: {e}"));
    }
    Ok(label)
}

fn focus(app: &AppHandle, label: &str) {
    if let Some(window) = app.get_webview_window(label) {
        let _ = window.unminimize();
        let _ = window.show();
        let _ = window.set_focus();
    }
}

/// Brings the window of the tab `tab` to the front (the list pressed a tab that is in a window).
#[tauri::command]
pub fn orca_popout_focus(
    app: AppHandle,
    webview: Webview,
    state: State<'_, Popouts>,
    tab: String,
) -> Result<(), String> {
    from_main(&webview)?;
    let label = state.table().label_of(&tab);
    if let Some(label) = label {
        focus(&app, &label);
    }
    Ok(())
}

/// Ends the window of the tab `tab` (the screen did what the owner asked in it, or the tab is gone). A tab with no window changes nothing.
#[tauri::command]
pub fn orca_popout_end(
    app: AppHandle,
    webview: Webview,
    state: State<'_, Popouts>,
    tab: String,
) -> Result<(), String> {
    from_main(&webview)?;
    let label = state.table().end(&tab);
    if let Some(label) = label {
        destroy(&app, &label);
    }
    Ok(())
}

/// Gives the screen's channel, and answers the tabs that are in a window now (a page that was loaded again has lost what it held).
#[tauri::command]
pub fn orca_popout_main(
    webview: Webview,
    state: State<'_, Popouts>,
    channel: Channel<PopoutAction>,
) -> Result<Vec<PopoutTab>, String> {
    from_main(&webview)?;
    let mut table = state.table();
    table.screen = Some(channel);
    Ok(table.tabs())
}

/// Gives what the screen knows of a tab in a window now (its name, its status, where its terminal comes from); the page of the window draws it. The id of the tab it was held under is `was` (a plain terminal where Claude starts has a new id and the same window).
#[tauri::command]
pub fn orca_popout_update(
    webview: Webview,
    state: State<'_, Popouts>,
    was: String,
    tab: PopoutTab,
) -> Result<(), String> {
    from_main(&webview)?;
    check(&tab)?;
    let mut table = state.table();
    let Some(label) = table.label_of(&was) else {
        return Ok(());
    };
    let slot = table
        .slots
        .get_mut(&label)
        .ok_or("ウィンドウがありません")?;
    slot.tab = tab.clone();
    if let Some(page) = &slot.page {
        let _ = page.send(PopoutPage::Tab { tab: Box::new(tab) });
    }
    Ok(())
}

/// The page of a window asks what it shows and gives its channel, which the next `orca_popout_update` goes through.
#[tauri::command]
pub fn orca_popout_attach(
    webview: Webview,
    state: State<'_, Popouts>,
    channel: Channel<PopoutPage>,
) -> Result<PopoutTab, String> {
    let mut table = state.table();
    let slot = table
        .slots
        .get_mut(webview.label())
        .ok_or("このウィンドウにタブがありません")?;
    slot.page = Some(channel);
    Ok(slot.tab.clone())
}

/// Keeps the window that calls on top of the others, or lets it go (the pin of its header).
#[tauri::command]
pub fn orca_popout_pin(window: WebviewWindow, pinned: bool) -> Result<(), String> {
    if !is_popout(window.label()) {
        return Err("このウィンドウは固定できません".into());
    }
    window.set_always_on_top(pinned).map_err(|e| e.to_string())
}

/// The button of the header that puts the tab back in its pane: the screen is told, and ends the window when it has done so.
#[tauri::command]
pub fn orca_popout_restore(window: WebviewWindow) -> Result<(), String> {
    if !is_popout(window.label()) {
        return Err("このウィンドウは戻せません".into());
    }
    ask(window.app_handle(), window.label(), true);
    Ok(())
}

/// Sends the screen what a window's page asked of it (`orca_popout_place`, `orca_popout_lost`).
fn tell_screen(
    state: &State<'_, Popouts>,
    action: Result<PopoutAction, String>,
) -> Result<(), String> {
    let action = action?;
    let screen = state
        .table()
        .screen
        .clone()
        .ok_or("本体の画面につながっていません")?;
    screen
        .send(action)
        .map_err(|e| format!("本体の画面に送れませんでした: {e}"))
}

/// The definition tab of a window asks to open a place of its list (A-34): the screen opens it as a tab of its own pane. The place is the tab's own question's, which Rust holds.
#[tauri::command]
pub fn orca_popout_place(
    window: WebviewWindow,
    state: State<'_, Popouts>,
    path: String,
    outside: bool,
    line: u32,
    character: u32,
) -> Result<(), String> {
    if !is_popout(window.label()) {
        return Err("このウィンドウは開けません".into());
    }
    let action = state
        .table()
        .place_of(window.label(), path, outside, line, character);
    tell_screen(&state, action)
}

/// The database tab of a window found its connection lost (A-43): the screen is told, which drops the connection and closes its tabs, the window's too.
#[tauri::command]
pub fn orca_popout_lost(
    window: WebviewWindow,
    state: State<'_, Popouts>,
    connection: String,
    error: String,
) -> Result<(), String> {
    if !is_popout(window.label()) {
        return Err("このウィンドウは知らせられません".into());
    }
    let action = state.table().lost_of(window.label(), &connection, &error);
    tell_screen(&state, action)
}

/// The page of a window whose editor holds a file asks for the definition of a name (A-34): the screen shows it as a tab of its own pane, in the project of the file. The question must be about the window's own file.
#[tauri::command]
pub fn orca_popout_definition(
    window: WebviewWindow,
    state: State<'_, Popouts>,
    query: PopoutDefinition,
) -> Result<(), String> {
    if !is_popout(window.label()) {
        return Err("このウィンドウは問い合わせできません".into());
    }
    let (action, screen) = {
        let table = state.table();
        let slot = table
            .slots
            .get(window.label())
            .ok_or("このウィンドウにタブがありません")?;
        check_definition(&slot.tab, &query)?;
        (
            PopoutAction::Definition {
                tab: slot.tab.tab.clone(),
                query,
            },
            table.screen.clone(),
        )
    };
    let screen = screen.ok_or("本体の画面につながっていません")?;
    screen
        .send(action)
        .map_err(|e| format!("本体の画面に送れませんでした: {e}"))
}

/// The page of a file window closed its file (its typing saved, as the × of a pane closes a file): the screen is told to end the window.
#[tauri::command]
pub fn orca_popout_close(window: WebviewWindow) -> Result<(), String> {
    if !is_popout(window.label()) {
        return Err("このウィンドウは閉じられません".into());
    }
    ask(window.app_handle(), window.label(), false);
    Ok(())
}

/// Tells the page of the window `label` that the red button was pressed, when the page holds the document of its tab (a file) and can be told; false leaves the red button to the screen.
fn page_closes(app: &AppHandle, label: &str) -> bool {
    let state = app.state::<Popouts>();
    let page = {
        let table = state.table();
        table
            .slots
            .get(label)
            .filter(|s| has_document(&s.tab.content))
            .and_then(|s| s.page.clone())
    };
    page.is_some_and(|page| page.send(PopoutPage::Close).is_ok())
}

/// The windows of the app: the red button of a window made here does not close it, it asks the screen to close the tab, and the end of the main window ends them all.
pub fn on_window_event(window: &tauri::Window, event: &WindowEvent) {
    let label = window.label();
    match event {
        WindowEvent::CloseRequested { api, .. } if is_popout(label) => {
            api.prevent_close();
            let app = window.app_handle();
            if !page_closes(app, label) {
                ask(app, label, false);
            }
        }
        WindowEvent::Destroyed if is_popout(label) => {
            let state = window.app_handle().state::<Popouts>();
            let (action, screen) = {
                let mut table = state.table();
                (table.gone(label), table.screen.clone())
            };
            // A window that the screen did not end is put back by the screen (the send may fail, and the screen is then gone too).
            if let (Some(action), Some(screen)) = (action, screen) {
                let _ = screen.send(action);
            }
        }
        WindowEvent::Destroyed if is_main(label) => {
            let app = window.app_handle();
            // The screen is going too: the windows that end with it tell it nothing.
            let labels: Vec<String> = {
                let state = app.state::<Popouts>();
                let mut table = state.table();
                table.screen = None;
                table.slots.keys().cloned().collect()
            };
            for label in labels {
                destroy(app, &label);
            }
        }
        _ => {}
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn terminal(handle: &str) -> PopoutTerminal {
        PopoutTerminal {
            handle: handle.into(),
            path: "/work/a".into(),
            stream: true,
            ended: false,
        }
    }

    fn tab(id: &str, handle: &str) -> PopoutTab {
        PopoutTab {
            tab: id.into(),
            project: "proj_a".into(),
            title: "題名".into(),
            status: OrcaStatus::Working,
            label: "作業中".into(),
            environment: None,
            content: PopoutContent::Terminal(terminal(handle)),
        }
    }

    #[test]
    fn only_the_labels_made_here_are_popouts() {
        assert!(is_popout("tab-1"));
        assert!(is_popout("tab-24"));
        for other in ["main", "tab-", "tab-x", "tab-1a", "xtab-1", ""] {
            assert!(!is_popout(other), "{other}");
        }
    }

    #[test]
    fn a_tab_with_a_window_keeps_it_and_a_new_tab_takes_the_next_label() {
        let mut table = Table::default();
        assert_eq!(table.open(tab("orca:t1", "t1")), Ok(("tab-1".into(), true)));
        assert_eq!(table.open(tab("orca:t2", "t2")), Ok(("tab-2".into(), true)));
        // The same tab asks again: its window is the one it has, and no label is used up.
        assert_eq!(
            table.open(tab("orca:t1", "t1")),
            Ok(("tab-1".into(), false))
        );
        assert_eq!(table.open(tab("orca:t3", "t3")), Ok(("tab-3".into(), true)));
        assert_eq!(table.label_of("orca:t2").as_deref(), Some("tab-2"));
        assert_eq!(table.label_of("orca:none"), None);
    }

    #[test]
    fn a_label_is_not_used_again_after_its_window_ended() {
        let mut table = Table::default();
        table.open(tab("orca:t1", "t1")).unwrap();
        table.slots.remove("tab-1");
        assert_eq!(table.open(tab("orca:t1", "t1")), Ok(("tab-2".into(), true)));
    }

    #[test]
    fn too_many_windows_are_refused() {
        let mut table = Table::default();
        for n in 0..MAX_WINDOWS {
            table.open(tab(&format!("orca:t{n}"), "h")).unwrap();
        }
        assert!(table.open(tab("orca:more", "h")).is_err());
        // A tab that has its window is still answered.
        assert_eq!(table.open(tab("orca:t0", "h")), Ok(("tab-1".into(), false)));
    }

    #[test]
    fn the_tabs_come_in_the_order_the_windows_were_made() {
        let mut table = Table::default();
        for n in [1, 2, 10, 3] {
            table.open(tab(&format!("orca:t{n}"), "h")).unwrap();
        }
        let ids: Vec<String> = table.tabs().into_iter().map(|t| t.tab).collect();
        assert_eq!(ids, ["orca:t1", "orca:t2", "orca:t10", "orca:t3"]);
    }

    #[test]
    fn what_the_owner_did_names_the_tab_of_the_window() {
        let mut table = Table::default();
        table.open(tab("claude:p1", "h1")).unwrap();
        assert_eq!(
            table.action_of("tab-1", false),
            Some(PopoutAction::Close {
                tab: "claude:p1".into()
            })
        );
        assert_eq!(
            table.action_of("tab-1", true),
            Some(PopoutAction::Restore {
                tab: "claude:p1".into()
            })
        );
        // A window that holds no tab has nobody to tell.
        assert_eq!(table.action_of("tab-2", true), None);
    }

    #[test]
    fn a_window_that_the_screen_did_not_end_puts_its_tab_back() {
        let mut table = Table::default();
        table.open(tab("claude:p1", "h1")).unwrap();
        table.open(tab("claude:p2", "h2")).unwrap();
        // Rust destroyed the first on its own: the screen is told to restore it.
        assert_eq!(
            table.gone("tab-1"),
            Some(PopoutAction::Restore {
                tab: "claude:p1".into()
            })
        );
        assert_eq!(table.label_of("claude:p1"), None);
        // The screen ended the second itself: nothing is told back.
        assert_eq!(table.end("claude:p2"), Some("tab-2".into()));
        assert_eq!(table.gone("tab-2"), None);
        // A window that is not there, or a tab with no window, has nothing to tell.
        assert_eq!(table.gone("tab-3"), None);
        assert_eq!(table.end("claude:none"), None);
    }

    #[test]
    fn only_the_main_window_is_the_screen() {
        assert!(is_main("main"));
        for other in ["tab-1", "Main", "", "main "] {
            assert!(!is_main(other), "{other}");
        }
    }

    #[test]
    fn a_tab_is_checked_before_a_window_is_made_for_it() {
        assert!(check(&tab("orca:t1", "t1")).is_ok());
        for bad in [
            tab("", "t1"),
            tab("orca:t1", ""),
            tab("o\nca", "t1"),
            PopoutTab {
                project: String::new(),
                ..tab("orca:t1", "t1")
            },
            PopoutTab {
                title: "a\u{7}b".into(),
                ..tab("orca:t1", "t1")
            },
            PopoutTab {
                environment: Some(String::new()),
                ..tab("orca:t1", "t1")
            },
            PopoutTab {
                title: "x".repeat(MAX_TEXT + 1),
                ..tab("orca:t1", "t1")
            },
        ] {
            assert!(check(&bad).is_err(), "{bad:?}");
        }
        // A title may be empty: the session has no name yet.
        let blank = PopoutTab {
            title: String::new(),
            ..tab("orca:t1", "t1")
        };
        assert!(check(&blank).is_ok());
    }

    fn file_tab(server: Option<&str>) -> PopoutTab {
        PopoutTab {
            tab: "file:3".into(),
            project: "proj_a".into(),
            title: "main.rs".into(),
            status: OrcaStatus::Done,
            label: String::new(),
            environment: Some("Studio".into()),
            content: PopoutContent::File(PopoutFile {
                path: "/work/a".into(),
                relative: "src/main.rs".into(),
                server: server.map(str::to_owned),
            }),
        }
    }

    fn question() -> PopoutDefinition {
        PopoutDefinition {
            target: Some("Studio".into()),
            project: "proj_a".into(),
            path: "/work/a".into(),
            server: "rust".into(),
            relative: "src/main.rs".into(),
            text: "fn main() {}".into(),
            line: 0,
            character: 3,
            word: "main".into(),
        }
    }

    #[test]
    fn a_file_tab_is_checked_like_the_others_and_the_page_holds_its_document() {
        assert!(check(&file_tab(None)).is_ok());
        assert!(check(&file_tab(Some("ruby"))).is_ok());
        for bad in [
            PopoutFile {
                path: String::new(),
                relative: "a".into(),
                server: None,
            },
            PopoutFile {
                path: "/w".into(),
                relative: "a\nb".into(),
                server: None,
            },
            PopoutFile {
                path: "/w".into(),
                relative: "a".into(),
                server: Some(String::new()),
            },
        ] {
            let tab = PopoutTab {
                content: PopoutContent::File(bad),
                ..file_tab(None)
            };
            assert!(check(&tab).is_err(), "{tab:?}");
        }
        assert!(has_document(&file_tab(None).content));
        assert!(!has_document(&tab("orca:t1", "t1").content));
    }

    #[test]
    fn a_question_of_the_editor_is_about_the_file_of_its_own_window() {
        assert!(check_definition(&file_tab(None), &question()).is_ok());
        let ask = |change: fn(&mut PopoutDefinition)| {
            let mut q = question();
            change(&mut q);
            check_definition(&file_tab(None), &q)
        };
        assert!(ask(|q| q.project = "proj_b".into()).is_err());
        assert!(ask(|q| q.path = "/work/b".into()).is_err());
        assert!(ask(|q| q.relative = "src/lib.rs".into()).is_err());
        assert!(ask(|q| q.target = None).is_err());
        assert!(ask(|q| q.word = String::new()).is_err());
        assert!(ask(|q| q.server = String::new()).is_err());
        assert!(ask(|q| q.text = "x".repeat(MAX_DEFINITION_TEXT + 1)).is_err());
        assert!(ask(|q| q.text = "x".repeat(MAX_DEFINITION_TEXT)).is_ok());
        // A file outside the worktree asks only the server that gave it.
        assert!(check_definition(&file_tab(Some("ruby")), &question()).is_err());
        let mut gem = question();
        gem.server = "ruby".into();
        assert!(check_definition(&file_tab(Some("ruby")), &gem).is_ok());
        // A window of a terminal asks nothing.
        assert!(check_definition(&tab("orca:t1", "t1"), &question()).is_err());
    }

    #[test]
    fn a_file_tab_and_what_the_pages_tell_each_other_travel_as_written() {
        let text = r#"{"tab":"file:3","project":"proj_a","title":"main.rs","status":"done","label":"","environment":"Studio","content":{"kind":"file","path":"/work/a","relative":"src/main.rs","server":null}}"#;
        let read: PopoutTab = serde_json::from_str(text).unwrap();
        assert_eq!(read, file_tab(None));
        assert_eq!(serde_json::to_string(&read).unwrap(), text);
        assert_eq!(
            serde_json::to_string(&PopoutPage::Close).unwrap(),
            r#"{"kind":"close"}"#
        );
        assert_eq!(
            serde_json::to_string(&PopoutPage::Tab {
                tab: Box::new(file_tab(None))
            })
            .unwrap(),
            format!(r#"{{"kind":"tab","tab":{text}}}"#)
        );
        let action = serde_json::to_value(PopoutAction::Definition {
            tab: "file:3".into(),
            query: question(),
        })
        .unwrap();
        assert_eq!(action["kind"], "definition");
        assert_eq!(action["tab"], "file:3");
        assert_eq!(action["query"]["relative"], "src/main.rs");
        assert_eq!(action["query"]["character"], 3);
    }

    #[test]
    fn a_tab_travels_as_the_screen_writes_it() {
        let text = r#"{"tab":"claude:p1","project":"proj_a","title":"t","status":"working","label":"作業中","environment":null,"content":{"kind":"claude","handle":"h1","path":"/w","stream":false,"ended":false}}"#;
        let read: PopoutTab = serde_json::from_str(text).unwrap();
        assert_eq!(
            read.content,
            PopoutContent::Claude(PopoutTerminal {
                handle: "h1".into(),
                path: "/w".into(),
                stream: false,
                ended: false
            })
        );
        assert_eq!(serde_json::to_string(&read).unwrap(), text);
    }

    fn diff_tab(commit: Option<PopoutCommit>) -> PopoutTab {
        PopoutTab {
            tab: "diff:2".into(),
            project: "proj_a".into(),
            title: "main.rs".into(),
            status: OrcaStatus::Done,
            label: String::new(),
            environment: None,
            content: PopoutContent::Diff(PopoutDiff {
                path: "/work/a".into(),
                relative: "src/main.rs".into(),
                commit,
            }),
        }
    }

    fn commit() -> PopoutCommit {
        PopoutCommit {
            id: "abc123".into(),
            short_id: "abc".into(),
            parent_id: Some("def456".into()),
            old_relative: None,
        }
    }

    fn definition_tab() -> PopoutTab {
        PopoutTab {
            tab: "definition:1".into(),
            project: "proj_a".into(),
            title: "定義 ・ main".into(),
            status: OrcaStatus::Done,
            label: String::new(),
            environment: Some("Studio".into()),
            content: PopoutContent::Definition(question()),
        }
    }

    fn database(table: Option<&str>, tab: &str) -> PopoutTab {
        PopoutTab {
            tab: "database:3".into(),
            project: "proj_a".into(),
            title: "orders · shop".into(),
            status: OrcaStatus::Done,
            label: String::new(),
            environment: None,
            content: PopoutContent::Database(PopoutDatabase {
                connection: "p1".into(),
                name: "shop".into(),
                database: "shop".into(),
                table: table.map(str::to_owned),
                tab: tab.into(),
                page: 2,
                sql: "select 1\nfrom t".into(),
            }),
        }
    }

    #[test]
    fn a_diff_tab_is_checked_with_its_commit() {
        assert!(check(&diff_tab(None)).is_ok());
        assert!(check(&diff_tab(Some(commit()))).is_ok());
        let bad_id = PopoutCommit {
            id: String::new(),
            ..commit()
        };
        let bad_parent = PopoutCommit {
            parent_id: Some("a\nb".into()),
            ..commit()
        };
        let bad_old = PopoutCommit {
            old_relative: Some(String::new()),
            ..commit()
        };
        for bad in [bad_id, bad_parent, bad_old] {
            assert!(check(&diff_tab(Some(bad.clone()))).is_err(), "{bad:?}");
        }
        let mut no_file = diff_tab(None);
        if let PopoutContent::Diff(d) = &mut no_file.content {
            d.relative = String::new();
        }
        assert!(check(&no_file).is_err());
        assert!(!has_document(&diff_tab(None).content));
    }

    #[test]
    fn a_definition_tab_holds_its_own_question() {
        assert!(check(&definition_tab()).is_ok());
        let ask = |change: fn(&mut PopoutDefinition)| {
            let mut tab = definition_tab();
            if let PopoutContent::Definition(q) = &mut tab.content {
                change(q);
            }
            check(&tab)
        };
        assert!(ask(|q| q.target = None).is_err());
        assert!(ask(|q| q.project = "proj_b".into()).is_err());
        assert!(ask(|q| q.word = String::new()).is_err());
        assert!(ask(|q| q.server = String::new()).is_err());
        assert!(ask(|q| q.text = "x".repeat(MAX_DEFINITION_TEXT + 1)).is_err());
        assert!(!has_document(&definition_tab().content));
    }

    #[test]
    fn a_database_tab_names_a_table_tab_or_the_sql_of_its_database() {
        assert!(check(&database(Some("orders"), "records")).is_ok());
        assert!(check(&database(Some("orders"), "structure")).is_ok());
        assert!(check(&database(Some("orders"), "sql")).is_ok());
        // The SQL of a database has no table, and only its own tab.
        assert!(check(&database(None, "sql")).is_ok());
        assert!(check(&database(None, "records")).is_err());
        assert!(check(&database(Some("orders"), "other")).is_err());
        assert!(check(&database(Some(""), "records")).is_err());
        let mut long = database(None, "sql");
        if let PopoutContent::Database(d) = &mut long.content {
            d.sql = "x".repeat(MAX_SQL_TEXT + 1);
        }
        assert!(check(&long).is_err());
        let mut nameless = database(None, "sql");
        if let PopoutContent::Database(d) = &mut nameless.content {
            d.connection = String::new();
        }
        assert!(check(&nameless).is_err());
    }

    #[test]
    fn the_new_kinds_travel_as_the_screen_writes_them() {
        let text = r#"{"tab":"diff:2","project":"proj_a","title":"main.rs","status":"done","label":"","environment":null,"content":{"kind":"diff","path":"/work/a","relative":"src/main.rs","commit":{"id":"abc123","shortId":"abc","parentId":"def456","oldRelative":null}}}"#;
        let read: PopoutTab = serde_json::from_str(text).unwrap();
        assert_eq!(read, diff_tab(Some(commit())));
        assert_eq!(serde_json::to_string(&read).unwrap(), text);
        let text = r#"{"tab":"database:3","project":"proj_a","title":"orders · shop","status":"done","label":"","environment":null,"content":{"kind":"database","connection":"p1","name":"shop","database":"shop","table":"orders","tab":"records","page":2,"sql":"select 1\nfrom t"}}"#;
        let read: PopoutTab = serde_json::from_str(text).unwrap();
        assert_eq!(read, database(Some("orders"), "records"));
        assert_eq!(serde_json::to_string(&read).unwrap(), text);
        let definition = serde_json::to_value(definition_tab()).unwrap();
        assert_eq!(definition["content"]["kind"], "definition");
        assert_eq!(definition["content"]["relative"], "src/main.rs");
    }

    #[test]
    fn a_place_is_asked_only_by_the_window_of_a_definition_and_carries_its_question() {
        let mut table = Table::default();
        table.open(definition_tab()).unwrap();
        table.open(file_tab(None)).unwrap();
        let action = table
            .place_of("tab-1", "src/lib.rs".into(), false, 4, 7)
            .unwrap();
        assert_eq!(
            action,
            PopoutAction::Place {
                tab: "definition:1".into(),
                query: question(),
                path: "src/lib.rs".into(),
                outside: false,
                line: 4,
                character: 7
            }
        );
        let value = serde_json::to_value(&action).unwrap();
        assert_eq!(value["kind"], "place");
        assert_eq!(value["query"]["word"], "main");
        assert!(table.place_of("tab-1", String::new(), false, 0, 0).is_err());
        assert!(table.place_of("tab-1", "a\nb".into(), true, 0, 0).is_err());
        // A window of a file, or of no tab, asks no place.
        assert!(table
            .place_of("tab-2", "src/lib.rs".into(), false, 0, 0)
            .is_err());
        assert!(table
            .place_of("tab-9", "src/lib.rs".into(), false, 0, 0)
            .is_err());
    }

    #[test]
    fn a_lost_connection_is_told_only_for_the_connection_of_the_tab_of_the_window() {
        let mut table = Table::default();
        table.open(database(Some("orders"), "records")).unwrap();
        table.open(tab("orca:t1", "t1")).unwrap();
        let lost = table.lost_of("tab-1", "p1", "切れました").unwrap();
        assert_eq!(
            lost,
            PopoutAction::Lost {
                tab: "database:3".into(),
                connection: "p1".into(),
                error: "切れました".into()
            }
        );
        // Another connection, a window of another kind and a window with no tab are refused.
        assert!(table.lost_of("tab-1", "p2", "x").is_err());
        assert!(table.lost_of("tab-2", "p1", "x").is_err());
        assert!(table.lost_of("tab-9", "p1", "x").is_err());
        // A text longer than a card shows is cut.
        let PopoutAction::Lost { error, .. } = table
            .lost_of("tab-1", "p1", &"あ".repeat(MAX_TEXT + 10))
            .unwrap()
        else {
            panic!("not a Lost");
        };
        assert_eq!(error.chars().count(), MAX_TEXT);
    }
}
