// Which screen the sidebar selected, and the sidebar's buttons.
import { closePopup, renderGoogleCard } from "./accounts.js";
import type { MenuEntry } from "./bindings/MenuEntry";
import type { MenuScreen } from "./bindings/MenuScreen";
import { $, composing, isMac } from "./dom.js";
import { showCalendar } from "./calendar.js";
import { hideCalendarClaude, syncCalendarClaude } from "./calendar-claude.js";
import { closeCreate } from "./calendar-create.js";
import { closeDetail } from "./calendar-detail.js";
import { databaseChanges, discardDatabaseChanges, showDatabase } from "./database.js";
import { closeDatabaseForm } from "./database-form.js";
import { hideFormation, showFormation } from "./formation.js";
import { logError } from "./error-card.js";
import { closeHint, confirmDiscardChanges } from "./hint.js";
import { invoke } from "./ipc.js";
import { pauseLsp } from "./orca-lsp.js";
import { showOrca, watchFiles } from "./orca.js";
import { loadSettings, selectSettingsTab, type SettingsTab } from "./settings.js";
import { hideSkillClaude } from "./skill-settings.js";
import { showSlackList } from "./slack-list.js";
import { hideThreadClaude } from "./slack-thread.js";
import { clearTodoNotices, loadTodo, renderTodo } from "./todo.js";
import { fetchOpenComments } from "./todo-comments.js";
import { hideDraftClaude, syncDraftClaude } from "./todo-draft.js";
import { hidePromptClaude } from "./todo-prompt.js";
import { todoState } from "./todo-data.js";
import { show } from "./view.js";

export type Screen = "mail" | "calendar" | "todo" | "slack" | "orca" | "database" | "settings";

// Which screen the sidebar selected, or "new-mail" while the screen that writes a new mail is (the sidebar then still shows the inbox).
// Background work reads it; only the sidebar and those screens' open and close change it.
let screen: Screen | "new-mail" = "mail";
export const currentScreen = () => screen;

function markNav(name: Screen) {
  for (const [id, target] of [["nav-mail", "mail"], ["nav-calendar", "calendar"], ["nav-todo", "todo"], ["nav-slack", "slack"], ["nav-orca", "orca"], ["nav-database", "database"], ["nav-settings", "settings"]]) {
    if (target === name) $(id).setAttribute("aria-current", "page");
    else $(id).removeAttribute("aria-current");
  }
}

// The Todo prompt screen. The sidebar stays on the settings, and so does `currentScreen()`, so background work does not draw another screen under it.
export function showPromptScreen() {
  screen = "settings";
  markNav("settings");
  closePopup(); // the popup of the Claude avatar closes with the screen
  closeHint();
  show("prompt");
}

// The screen that writes a new mail (M-11), opened from the header of the list. The sidebar stays on the inbox, but `currentScreen()` is not "mail", so a list load or a sync does not draw the list over it. It is left with `setScreen("mail")`.
export function showNewMailScreen() {
  screen = "new-mail";
  markNav("mail");
  closePopup();
  closeHint();
  show("new-mail");
}

// `tab` is the settings tab to open on (Google when none is named).
export function setScreen(name: Screen, tab?: SettingsTab) {
  // The changes that the records tab gathered and did not send go when the database screen is left, so it asks first (D-10).
  const gathered = screen === "database" && name !== "database" ? databaseChanges() : 0;
  if (gathered > 0) {
    confirmDiscardChanges($(`nav-${name}`), gathered, () => {
      discardDatabaseChanges();
      setScreen(name, tab);
    });
    return;
  }
  screen = name;
  closeHint();
  closeDetail();
  closeCreate();
  closeDatabaseForm();
  // The cards that belong to the Todo screen go while another screen is shown (A-28).
  if (name !== "todo") {
    clearTodoNotices();
    // The same for the pane of the page of a Todo draft (S-18), which the Todo screen holds.
    hideDraftClaude();
  }
  // The same for the Claude pane of the calendar screen.
  if (name !== "calendar") hideCalendarClaude();
  // The same for the Claude Code pane of the Slack thread (S-7).
  hideThreadClaude();
  // The same for the Claude pane of the Todo prompt screen, which "戻る" and the sidebar leave through here.
  hidePromptClaude();
  // The same for the Claude pane of the settings' Skill tab, which another screen leaves through here (the tab shows it again).
  hideSkillClaude();
  if (name !== "orca") {
    hideFormation();
    // The language server's settings are read by the clock only while the Orca screen is shown (A-34).
    pauseLsp();
    watchFiles();
  }
  markNav(name);
  closePopup();
  if (name === "calendar") {
    showCalendar();
    syncCalendarClaude();
  } else if (name === "todo") {
    show("todo");
    syncDraftClaude();
    if (todoState.kept) renderTodo();
    fetchOpenComments();
    // The backend keeps the completed tasks of the last load; they are fetched again only while `doneStale` is set (until a load has fetched from Todoist).
    loadTodo(false, todoState.todo === null || todoState.kept);
  } else if (name === "slack") {
    showSlackList();
  } else if (name === "orca") {
    // The development screen: the list, and the work pane of Orca or the panes of the formation, whichever the list has selected (A-37).
    showOrca();
    showFormation();
  } else if (name === "database") {
    showDatabase();
  } else if (name === "settings") {
    show("settings");
    selectSettingsTab(tab ?? "google");
    renderGoogleCard();
    loadSettings();
  } else {
    show("list");
  }
}

// The button of the sidebar that belongs to each screen the menu moves (A-5).
const MENU_BUTTONS: Record<MenuScreen, string> = {
  mail: "nav-mail",
  calendar: "nav-calendar",
  todo: "nav-todo",
  slack: "nav-slack",
  orca: "nav-orca",
  database: "nav-database",
};

// The screens the sidebar shows, from top to bottom: ⌘1 is the first. The order the sidebar was written in until the saved one is read.
let shown: MenuScreen[] = ["mail", "calendar", "todo", "slack", "orca", "database"];

// Puts the screens in the saved order above the bottom group, takes off the ones that are off, and gives each shown button its number for the tooltip and the keys.
export function drawMenu(items: MenuEntry[]) {
  shown = items.filter((entry) => entry.enabled).map((entry) => entry.screen);
  for (const { screen, enabled } of items) {
    const button = $(MENU_BUTTONS[screen]);
    $("sidebar-bottom").before(button);
    button.classList.toggle("menu-off", !enabled);
    if (enabled) button.dataset.shortcut = `${isMac ? "⌘" : "Ctrl+"}${shown.indexOf(screen) + 1}`;
    else delete button.dataset.shortcut;
  }
}

// ⌘1 to ⌘6 press the button of the screen at that place among the shown ones, as a click does (a button that is disabled does nothing). It is caught before the focused part sees it, so a terminal does not take it.
function initMenuKeys() {
  document.addEventListener(
    "keydown",
    (e) => {
      if (!(isMac ? e.metaKey && !e.ctrlKey : e.ctrlKey && !e.metaKey) || e.altKey || e.shiftKey || composing(e) || !/^[1-6]$/.test(e.key)) return;
      const target = shown[Number(e.key) - 1];
      if (!target) return;
      e.preventDefault();
      e.stopPropagation();
      $(MENU_BUTTONS[target]).click();
    },
    true,
  );
}

export function initNav() {
  $("nav-mail").onclick = () => setScreen("mail");
  $("nav-calendar").onclick = () => setScreen("calendar");
  $("nav-todo").onclick = () => setScreen("todo");
  $("nav-slack").onclick = () => setScreen("slack");
  $("nav-orca").onclick = () => setScreen("orca");
  $("nav-database").onclick = () => setScreen("database");
  closePopup();
  $("nav-settings").onclick = () => setScreen("settings");
  initMenuKeys();
  invoke("side_menu_settings").then((settings) => drawMenu(settings.items), (e) => logError("side-menu", e));
}
