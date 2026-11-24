//! A-46: a tab of the Orca screen shown in a window of its own (a macOS window `tab-{n}`, made from `popout.html`).
//!
//! The screen (`ts/orca-popout.ts`) asks for the window with `orca_popout_open`, and keeps the tab out of its pane (`away` of `orca_panes`).
//! The page of the window (`ts/popout.ts`) asks what it shows (`orca_popout_attach`) and draws it, and its two buttons are `orca_popout_pin` (the window stays on top) and `orca_popout_restore`.
//! The window has no permission of its own: what it does goes through these commands, and what the two pages tell each other goes through channels, which need no `event` permission.
//! The screen's channel (`orca_popout_main`) carries what the owner did in a window, the close (the red button, which is stopped here and left to the screen, so the tab is closed as the × of its pane closes it), the restore,
//! and the definition that the editor of a file window asked for (`orca_popout_definition`), which the screen shows as a tab of its own pane;
//! the window's channel (`orca_popout_attach`) carries what the screen knows of the tab now (its name, its status, where its terminal comes from) and, for a file, the red button.
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

/// What a window shows, by the kind of the tab. A kind that comes later (a diff, a definition, a database) is a variant of its own.
#[derive(Serialize, Deserialize, Clone, Debug, PartialEq)]
#[cfg_attr(test, derive(TS))]
#[cfg_attr(test, ts(export, export_to = crate::BINDINGS))]
#[serde(tag = "kind", rename_all = "camelCase")]
pub enum PopoutContent {
    Claude(PopoutTerminal),
    Terminal(PopoutTerminal),
    File(PopoutFile),
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

/// The question of the editor of a file window about the definition of a name (A-34), as the screen takes it for the definition tab (`DefinitionQuery` of `ts/orca-definition.ts`, whose `tab` the screen fills from the window).
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

/// What the owner did in a window, which the screen carries out: the tab is closed (the red button), it goes back to its pane, or its editor asked for the definition of a name, which the screen shows in its own pane.
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
}

/// What the page of a window is told: the tab as the screen knows it now, and the red button of a window whose page holds the tab's document (a file).
#[derive(Serialize, Clone, Debug, PartialEq)]
#[cfg_attr(test, derive(TS))]
#[cfg_attr(test, ts(export, export_to = crate::BINDINGS))]
#[serde(tag = "kind", rename_all = "camelCase")]
pub enum PopoutPage {
    Tab { tab: PopoutTab },
    Close,
}

struct Slot {
    tab: PopoutTab,
    /// The channel of the page of the window, once it asked what it shows.
    page: Option<Channel<PopoutPage>>,
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
    }
    Ok(())
}

/// The most that the text of a definition question holds: what `lsp_definition` takes.
const MAX_DEFINITION_TEXT: usize = 1024 * 1024;

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
        self.slots.insert(label.clone(), Slot { tab, page: None });
        Ok((label, true))
    }

    /// The windows' tabs, in the order the windows were made.
    fn tabs(&self) -> Vec<PopoutTab> {
        let mut slots: Vec<(&String, &Slot)> = self.slots.iter().collect();
        slots.sort_by_key(|(label, _)| label[PREFIX.len()..].parse::<u64>().unwrap_or(0));
        slots.into_iter().map(|(_, s)| s.tab.clone()).collect()
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
    state: State<'_, Popouts>,
    tab: PopoutTab,
) -> Result<String, String> {
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
    state: State<'_, Popouts>,
    tab: String,
) -> Result<(), String> {
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
    state: State<'_, Popouts>,
    tab: String,
) -> Result<(), String> {
    let label = state.table().label_of(&tab);
    if let Some(label) = label {
        destroy(&app, &label);
    }
    Ok(())
}

/// Gives the screen's channel, and answers the tabs that are in a window now (a page that was loaded again has lost what it held).
#[tauri::command]
pub fn orca_popout_main(
    state: State<'_, Popouts>,
    channel: Channel<PopoutAction>,
) -> Vec<PopoutTab> {
    let mut table = state.table();
    table.screen = Some(channel);
    table.tabs()
}

/// Gives what the screen knows of a tab in a window now (its name, its status, where its terminal comes from); the page of the window draws it. The id of the tab it was held under is `was` (a plain terminal where Claude starts has a new id and the same window).
#[tauri::command]
pub fn orca_popout_update(
    state: State<'_, Popouts>,
    was: String,
    tab: PopoutTab,
) -> Result<(), String> {
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
        let _ = page.send(PopoutPage::Tab { tab });
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
            window
                .app_handle()
                .state::<Popouts>()
                .table()
                .slots
                .remove(label);
        }
        WindowEvent::Destroyed if label == crate::MAIN_WINDOW => {
            let app = window.app_handle();
            let labels: Vec<String> = app
                .state::<Popouts>()
                .table()
                .slots
                .keys()
                .cloned()
                .collect();
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
                tab: file_tab(None)
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
}
