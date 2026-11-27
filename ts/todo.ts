// The Todo screen: which part it shows, loading and refreshing from Todoist, and the header's back button and the menu of the open task.
import type { Offline } from "./bindings/Offline";
import type { PopoutTab } from "./bindings/PopoutTab";
import type { TaskItem } from "./bindings/TaskItem";
import type { Todo } from "./bindings/Todo";
import { $, tag } from "./dom.js";
import { pad2 } from "./format.js";
import { CLOSE_SVG, COPY_SVG, DELETE_SVG, LINK_SVG, POPOUT_SVG } from "./icons.js";
import { invoke } from "./ipc.js";
import { closeMenu, openMenu, showMenu } from "./menu.js";
import { currentScreen, setScreen } from "./nav.js";
import { HandoffPane } from "./orca-handoff.js";
import { focusPopout, hasTodoPopouts, initTodoPopout, noticeTodoPopouts, popOut, syncTodoPopouts } from "./orca-popout.js";
import { todoCard } from "./orca-handoff-cards.js";
import { drawListToggle, listToggle } from "./list-toggle.js";
import { onScreenChanged } from "./screen-bridge.js";
import { initSplit, type SplitHandle } from "./split.js";
import { renderDetail } from "./todo-detail.js";
import { discardDraft, draftOpen } from "./todo-draft.js";
import { clearCommentNotices, loadedComments } from "./todo-comments.js";
import { closeTab, drawOrcaTodo, editingField, openTab, orcaTodoWanted, projectName, projectOf, pruneTabs, recountTodo, searching, setTodoCount, settleLocal, todoState } from "./todo-data.js";
import { renderList, renderProjects } from "./todo-list.js";
import { clearSearch, initTodoSearch, searchTodo } from "./todo-search.js";
import { cancelTodoReload, scheduleTodoReload, todoCall } from "./todo-write.js";
import { logError, setNotice, showFailure } from "./error-card.js";
import { copyText } from "./view.js";

const TODO_REFRESH_MS = 10 * 1000;

// The pane that hands the open task to Orca (A-9).
let handoff: HandoffPane;

// The page that holds the detail of one task and not the screen (the window of a task, T-11) gives these three, and then the modules of the detail (`todo-detail.ts`, `todo-write.ts`, `todo-comments.ts`) call them in place of the screen's:
// draw what the data says, read the data again (true when a token is needed), and open another task (a window has no strip, so it opens none).
export interface TodoOwner {
  render: () => void;
  load: (quiet: boolean, withDone: boolean) => Promise<boolean>;
  open: (id: string) => void;
}
let owner: TodoOwner | null = null;
export function ownTodo(page: TodoOwner) {
  owner = page;
}

// The id the window of the task `id` has among the windows of the app (T-11).
const windowOf = (id: string) => `todo:${id}`;

// The right side is there while the task list is shown, and holds the tabs of the task details (T-10). The pane that hands the selected task to Orca (A-9) is in it too, under the detail.
let sideUsable = false;

// The list of projects (A-23): `listOpen` is what the owner chose, held in memory only, so the screen is open again when the app starts; `tokenForm` is whether the token form is up, which has no list.
let listOpen = true;
let tokenForm = false;

// Where the side sits (T-10): on the right of the tasks, or, when their column would be under 460px with the side at its least (35% of the screen), under them, with the divider lying down.
// It follows the screen's width and the project list only, never the side's own width, so that the two places cannot flip each other.
const TASKS_MIN = 460;
const SIDE_LEAST = 0.35;
const SIDE_MOST = 0.65;
// The divider's width (`.split-bar`), which the right side leaves out of the tasks' column.
const DIVIDER = 7;
let below = false;
let split: SplitHandle | undefined;

function setBelow(on: boolean) {
  if (on === below) return;
  below = on;
  $("todo").classList.toggle("below", on);
  split?.lie(on);
  $("todo-split").setAttribute("aria-label", on ? "詳細の高さ" : "詳細の幅");
}

function layoutSide() {
  const width = $("todo").getBoundingClientRect().width;
  // The screen is not shown: its size is not known, and it is read again when it is.
  if (width === 0) return;
  const projects = $("projects").hidden ? 0 : $("projects").getBoundingClientRect().width;
  setBelow(width * (1 - SIDE_LEAST) - projects - DIVIDER < TASKS_MIN);
}

// Shows the list, or (closed) the button in the header that opens it again. The list's own button is in the list, so it goes with it.
function layoutList() {
  $("projects").hidden = tokenForm || !listOpen;
  $("todo-list-toggle").hidden = tokenForm || listOpen;
  drawListToggle($("projects-toggle"), listOpen);
  drawListToggle($("todo-list-toggle"), listOpen);
  // The list takes its width off the tasks' column, or gives it back.
  layoutSide();
}

// Closes the list or opens it again; the tasks take the width of a closed list.
// The pressed button is hidden by it, so the focus goes on to the button that is shown now.
function toggleList() {
  const focused = document.activeElement?.classList.contains("list-toggle") ?? false;
  listOpen = !listOpen;
  layoutList();
  if (focused) $(listOpen ? "projects-toggle" : "todo-list-toggle").focus({ preventScroll: true });
}

function layoutPanes() {
  $("todo-side").hidden = !sideUsable;
  $("todo-split").hidden = !sideUsable;
  // Under the tasks the column of the tasks has the whole height while the side is hidden (the CSS).
  $("todo").classList.toggle("side-off", !sideUsable);
}

// Follows the selected tab: another task, or none, changes what the pane under the detail shows, and the card takes the task as it is now.
export function syncTodoHandoff() {
  handoff.sync();
  handoff.refreshCard();
}

// Which part the left of the Todo screen shows: the token form, the task list, or the page of a draft (S-2). The side, with the tabs, is shown with the list only.
export function todoMode(mode: "token" | "list" | "draft") {
  $("todo-token").hidden = mode !== "token";
  tokenForm = mode === "token";
  layoutList();
  $("todo-add").hidden = mode !== "list";
  $("todo-pending").hidden = mode !== "list";
  $("todo-list").hidden = mode !== "list";
  $("todo-back").hidden = mode !== "draft";
  $("todo-main").classList.toggle("drafting", mode === "draft");
  document.getElementById("todo-draft")?.toggleAttribute("hidden", mode !== "draft");
  // The search has no place in the token form or the page of a draft.
  $("todo-search").hidden = mode === "token" || mode === "draft";
  sideUsable = mode === "list";
  layoutPanes();
  if (mode !== "list") {
    // The side is away: its detail is drawn as new when it comes back (its comments are fetched again), and the comments' card goes.
    $("todo-detail").hidden = true;
    clearCommentNotices();
    handoff.sync();
  }
  // A redraw of the same task keeps its menu open; another task or another part closes it.
  if (moreMenu && (mode !== "list" || todoState.selected !== moreMenu.id)) closeMoreMenu();
}

// Shows the token form and forgets the content: a missing token, or one the settings screen just removed.
export function showTokenForm() {
  // No reload is due: the form is what the screen shows now, and a load still in flight must not draw over it.
  cancelTodoReload();
  todoState.seq++;
  todoState.todo = null;
  todoState.kept = false;
  // The disconnect cleared the backend's completed tasks too.
  todoState.doneStale = true;
  setTodoCount([]);
  todoState.tabs = [];
  todoState.selected = null;
  clearSearch();
  setNotice(NOTICE_OFFLINE, null);
  todoMode("token");
  $("todo-title").textContent = "Todo";
  // Not from the settings screen: the form is hidden there.
  if (currentScreen() === "todo") $("todo-token-input").focus();
}

// Opens the task `id` in a tab of the side and selects it, or selects the tab it has already (T-10). A row of a list, a subtask row and the parent chip of a detail do it.
// A task that is in a window has no tab: the window is brought to the front instead (T-11).
export function openTodoTab(id: string) {
  if (owner) return owner.open(id);
  if (focusPopout(windowOf(id))) return;
  openTab(id);
  renderTodo();
}

// Shows the detail of task `id` on the Todo screen, in its tab (the row of a task in the pane of the notices, A-35). Until the screen's own load has drawn, the task is the one it opens on.
export function openTodoTask(id: string) {
  if (focusPopout(windowOf(id))) return;
  openTab(id);
  setScreen("todo");
  if (todoState.todo) renderTodo();
}

// The strip of tabs of the side: a tab for each open task (its name, cut with an ellipsis, and ×), the selected one marked as the tabs of the Orca work pane are.
function drawTabs() {
  const focused = document.activeElement?.closest<HTMLElement>("#todo-tabs [data-tab]")?.dataset.tab;
  const nodes = todoState.tabs.map((id) => {
    const wrap = tag("div", "orca-tab");
    wrap.dataset.tab = id;
    wrap.setAttribute("role", "presentation");
    const select = tag("button", "orca-tab-btn");
    select.type = "button";
    select.setAttribute("role", "tab");
    select.setAttribute("aria-selected", String(id === todoState.selected));
    select.append(tag("span", "orca-tab-title", todoState.taskById.get(id)?.content ?? ""));
    select.onclick = () => {
      todoState.selected = id;
      renderTodo();
    };
    // The close button is beside the tab, not in it, so that pressing it never selects the tab.
    const close = tag("button", "icon-btn orca-tab-close");
    close.type = "button";
    close.setAttribute("aria-label", "閉じる");
    close.innerHTML = CLOSE_SVG;
    close.onclick = () => {
      closeTab(id);
      renderTodo();
    };
    wrap.append(select, close);
    wrap.oncontextmenu = (e) => {
      e.preventDefault();
      openMenu(select, [{ label: "別ウィンドウで開く", color: "var(--accent)", icon: POPOUT_SVG, current: false, pick: () => void popOutTask(id) }]);
    };
    return wrap;
  });
  $("todo-tabs").replaceChildren(...nodes);
  if (focused) $("todo-tabs").querySelector<HTMLElement>(`[data-tab="${CSS.escape(focused)}"] .orca-tab-btn`)?.focus({ preventScroll: true });
  $("todo-tabs").querySelector<HTMLElement>('[aria-selected="true"]')?.scrollIntoView({ block: "nearest", inline: "nearest" });
}

// The side (T-10): the strip of tabs, the detail of the selected one and, under it, the pane that hands that task to Orca (A-9). With no tab the pane is empty.
function renderSide() {
  const id = todoState.selected;
  drawTabs();
  $("todo-more").hidden = id === null;
  $("todo-orca-open").hidden = id === null;
  const detail = $("todo-detail");
  if (id === null) {
    detail.hidden = true;
    detail.replaceChildren();
    delete detail.dataset.task;
    clearCommentNotices();
  } else renderDetail(detail, id);
  syncTodoHandoff();
}

// The tab of the task `id` as a window of its own (T-11): the window shows the task as Todoist has it now, with the name of the tab as its title.
const popoutOf = (id: string, title: string): PopoutTab => ({ tab: windowOf(id), project: "todo", title, status: "done", label: "", environment: null, content: { kind: "todo", id } });

// Puts the tab of the task `id` in a window: it leaves the strip at once (its neighbour is selected, and what was typed in its description is dropped), and comes back when the window could not be made.
async function popOutTask(id: string) {
  const task = todoState.taskById.get(id);
  if (!task || !todoState.tabs.includes(id)) return;
  closeTab(id);
  renderTodo();
  await popOut(popoutOf(id, task.content));
}

// What the data says of the window of a task now: its name, null when the task is gone (completed, deleted, in a project that went), and undefined when the data is not read yet (the kept content is not).
function lookTask(entry: PopoutTab): PopoutTab | null | undefined {
  if (entry.content.kind !== "todo" || !todoState.todo || todoState.kept) return undefined;
  const task = todoState.taskById.get(entry.content.id);
  return task ? popoutOf(task.id, task.content) : null;
}

export function renderTodo() {
  if (owner) return owner.render();
  todoState.undrawn = false;
  // Another screen is shown (the Orca screen draws the tasks too, A-49): the screen is drawn when it is shown again, by the load that comes with it.
  if (currentScreen() !== "todo") {
    pruneTabs();
    syncTodoPopouts(lookTask);
    return drawOrcaTodo();
  }
  if (!projectOf(todoState.view) && todoState.view !== "today" && todoState.view !== "inbox") todoState.view = "today";
  // A task that is gone from the data (completed, deleted) loses its tab.
  pruneTabs();
  renderProjects();
  // An open draft stays whatever the refresh brings; only its own back button and 破棄 close it.
  if (draftOpen()) {
    todoMode("draft");
    $("todo-title").textContent = "Todo の案";
  } else {
    renderList();
    renderSide();
  }
  syncTodoPopouts(lookTask);
  drawOrcaTodo();
}

// The card that says the list is the last one fetched (A-28, `setNotice`): a warning, drawn while the Todo screen is shown.
const NOTICE_OFFLINE = "todo:offline";

// Says that the list is the last one fetched (`offline` is set by the backend), or takes the card off.
function drawTodoNotice(offline: Offline | null | undefined) {
  let text = "";
  if (offline) {
    const d = new Date(offline.fetchedAt);
    text = `Todoist に接続できません（${offline.reason}）。${d.getMonth() + 1}月${d.getDate()}日 ${pad2(d.getHours())}:${pad2(d.getMinutes())} 時点の内容を表示しています。`;
  }
  setNotice(NOTICE_OFFLINE, text ? { text, warn: true } : null);
}

// Takes off the cards that belong to the Todo screen, with their ×, when another screen is shown (`setScreen` calls it for every other screen).
export function clearTodoNotices() {
  setNotice(NOTICE_OFFLINE, null);
  clearCommentNotices();
}

// Consecutive timed refreshes that failed; the log gets one line at the third, as the inbox's sync does (M-7), so that an offline Mac does not fill it.
let quietFails = 0;

// Fetches the tasks and draws them. `quiet` is the timed refresh: it fetches nothing while a field is being typed in, and draws nothing when nothing changed.
// Without `withDone` the backend reuses the completed tasks it fetched last, unless `doneStale` says it has none. Returns true when a token is needed (the token form is shown).
export async function loadTodo(quiet = false, withDone = true) {
  if (owner) return owner.load(quiet, withDone);
  if (quiet && (editingField() || todoState.writes)) return false;
  const seq = ++todoState.seq;
  try {
    const data = await invoke("todoist_load", { withDone: withDone || todoState.doneStale });
    quietFails = 0;
    if (data && !data.offline) todoState.doneStale = false;
    // Not while a change is in flight: the reload after the last one draws. The Orca screen reads the tasks as the Todo screen does while it shows them (A-49).
    const here = currentScreen() === "todo";
    if (seq !== todoState.seq || (!here && !orcaTodoWanted()) || todoState.writes) return false;
    if (data === null) {
      showTokenForm();
      return true;
    }
    const text = quiet ? JSON.stringify(data) : null;
    const same = text !== null && text === todoState.text;
    todoState.text = text;
    todoState.todo = data;
    todoState.loaded = seq;
    todoState.kept = false;
    todoState.countOff = false;
    // Also while a field is being typed in, when nothing is drawn below.
    setTodoCount(data.tasks);
    todoState.projectById = new Map(data.projects.map((p) => [p.id, p]));
    todoState.taskById = new Map(data.tasks.map((t) => [t.id, t]));
    if (here) drawTodoNotice(data.offline);
    // A field being typed in keeps what was typed; the detail is drawn after the focus leaves, by the next save's load or the next refresh.
    if (editingField()) {
      todoState.undrawn = true;
      return false;
    }
    if (quiet && same && !todoState.undrawn) return false;
    // A search is made again on the new data, so its results follow the tasks.
    if (here && searching()) await searchTodo();
    else renderTodo();
  } catch (e) {
    if (!quiet || ++quietFails === 3) logError("todo", e);
  }
  return false;
}

// The menu of the selected tab's task, opened for task `id`: every item acts on that task, whatever is open when it is pressed.
// Todoist cannot undo a delete, so 削除 asks twice: the first press changes its label, the second deletes.
let moreMenu: { id: string; timer: number } | null = null;

function closeMoreMenu() {
  if (!moreMenu) return;
  clearTimeout(moreMenu.timer);
  moreMenu = null;
  // The anchor is expanded only while this menu is the open one.
  if ($("todo-more").hasAttribute("aria-expanded")) closeMenu();
}

function menuItem(icon: string, label: string) {
  const b = tag("button");
  b.setAttribute("role", "menuitem");
  b.insertAdjacentHTML("beforeend", icon);
  const text = tag("span", "", label);
  b.append(text);
  return { b, text };
}

function openMoreMenu() {
  const id = todoState.selected;
  if (!id) return;
  const menu = tag("div", "menu");
  menu.setAttribute("role", "menu");
  const url = todoState.taskById.get(id)?.url;
  // An empty url (an old cache, an ID the backend refuses) has nothing to copy.
  if (url) {
    const copy = menuItem(LINK_SVG, "タスクのリンクをコピー");
    copy.b.onclick = async () => {
      if (await copyText(url, "リンクをコピーしました")) closeMoreMenu();
    };
    menu.append(copy.b);
  }
  // Read when pressed: a refresh may have changed the description since the menu opened.
  if (todoState.taskById.get(id)?.description) {
    const copy = menuItem(COPY_SVG, "説明をコピー");
    copy.b.onclick = async () => {
      const text = todoState.taskById.get(id)?.description;
      if (text && (await copyText(text, "説明をコピーしました"))) closeMoreMenu();
    };
    menu.append(copy.b);
  }
  const del = menuItem(DELETE_SVG, "削除");
  del.b.classList.add("danger");
  let asked = false;
  del.b.onclick = () => {
    if (!moreMenu) return;
    if (!asked) {
      asked = true;
      del.text.textContent = "もう一度押すと削除";
      moreMenu.timer = setTimeout(() => {
        asked = false;
        del.text.textContent = "削除";
      }, 4000);
      return;
    }
    closeMoreMenu();
    // Gone from the list at once, and its tab with it; the reload after the call brings it back if Todoist refused.
    todoCall("todoist_delete", { id }, null, () => settleLocal(id, null));
  };
  menu.append(del.b);
  closeMoreMenu();
  showMenu($("todo-more"), menu);
  moreMenu = { id, timer: 0 };
  menu.querySelector("button")!.focus();
}

// Draws the content the last run kept, on the sidebar's count and, if it is open, the Todo screen, while the first fetch is on its way.
// A fetch that answered first, a missing token (no kept content) or a failed read leaves everything to the fetch. The kept content carries no offline notice.
async function showKeptTodo() {
  let kept: Todo | null = null;
  try {
    kept = await invoke("todoist_cached");
  } catch {}
  if (!kept || todoState.todo !== null || todoState.seq !== 0) return;
  todoState.todo = kept;
  todoState.kept = true;
  todoState.projectById = new Map(kept.projects.map((p) => [p.id, p]));
  todoState.taskById = new Map(kept.tasks.map((t) => [t.id, t]));
  setTodoCount(kept.tasks);
  if (currentScreen() === "todo") renderTodo();
}

// Fetches only for the Todo count on the sidebar while another screen is shown: `todo` and the Todo screen stay as they are, a missing token shows no count, and nothing shows a message.
async function loadTodoCount() {
  // A window of a task (T-11) is read for while the main window is hidden.
  if (currentScreen() === "todo" || (document.hidden && !hasTodoPopouts()) || todoState.countOff || todoState.writes) return;
  // A change that started or ended while fetching makes the answer older than the screen's count.
  const seq = todoState.seq;
  let tasks: TaskItem[] = [];
  try {
    const data = await invoke("todoist_load", { withDone: todoState.doneStale });
    if (data) {
      if (!data.offline) todoState.doneStale = false;
      tasks = data.tasks;
    } else todoState.countOff = true;
  } catch {
    // A failure keeps the last count, so the Dock badge does not drop the Todo part meanwhile.
    return;
  }
  // The Todo screen sets the count itself, and its data is newer than this fetch.
  if (currentScreen() !== "todo" && !todoState.writes && seq === todoState.seq) setTodoCount(tasks);
}

// Todo data for a screen other than Todo (the Slack thread's summary card needs the projects): what is held (the kept content or an earlier load), else one read of Todoist.
// False when Todoist needs a token. A read that fails throws. The Todo screen's own load still runs when it is opened.
export async function ensureTodoData() {
  if (todoState.todo) return true;
  const data = await invoke("todoist_load", { withDone: todoState.doneStale });
  if (!data) return false;
  if (!data.offline) todoState.doneStale = false;
  // Todo data arrived meanwhile (the Todo screen's load, the kept content): it is as new as this read, or newer.
  if (todoState.todo) return true;
  todoState.todo = data;
  todoState.projectById = new Map(data.projects.map((p) => [p.id, p]));
  todoState.taskById = new Map(data.tasks.map((t) => [t.id, t]));
  setTodoCount(data.tasks);
  return true;
}

// The timed refresh, also when the window comes back. The backend asks Todoist for the changes only, so it is cheap; the completed tasks are fetched again only while `doneStale` is set.
// One at a time: while Todoist does not answer, the next rounds are skipped instead of piling up behind the backend's lock.
let refreshingTodo = false;
async function refreshTodo() {
  if (refreshingTodo || (document.hidden && !hasTodoPopouts())) return;
  refreshingTodo = true;
  try {
    // Not while the token form is up: a load would read the keychain and draw the form again, dropping what is typed in it.
    // Another screen than Todo reads the tasks for the count only, except the Orca screen while it shows them (A-49).
    if (currentScreen() === "todo" || orcaTodoWanted()) {
      if ($("todo-token").hidden) await loadTodo(true, false);
    } else await loadTodoCount();
    // The windows of tasks read what this read kept (T-11), so they call Todoist no more than this screen does.
    noticeTodoPopouts();
  } finally {
    refreshingTodo = false;
  }
}

export function initTodo() {
  initTodoPopout({
    // The tab comes back at the end of the strip, selected; a task that Todoist no longer has comes back as nothing.
    restore: (id) => {
      if (!todoState.todo || !todoState.taskById.has(id)) return;
      openTab(id);
      renderTodo();
    },
    closed: (id) => {
      todoState.descEdit.delete(id);
    },
    failed: (e) => showFailure("todo", e),
  });
  const inList = listToggle("プロジェクト一覧", toggleList);
  inList.id = "projects-toggle";
  $("projects").prepend(inList);
  const inHeader = listToggle("プロジェクト一覧", toggleList);
  inHeader.id = "todo-list-toggle";
  inHeader.hidden = true;
  $("todo-back").before(inHeader);
  layoutList();
  handoff = new HandoffPane({
    root: $("todo-handoff"),
    current: () => {
      const id = todoState.selected;
      return $("todo").hidden || $("todo-side").hidden || id === null || !todoState.taskById.has(id)
        ? null
        : {
            key: `todo:${id}`,
            card: () => {
              const task = todoState.taskById.get(id);
              return task ? todoCard(task, projectName(projectOf(task.projectId)), loadedComments(id)) : null;
            },
          };
    },
    stays: true,
    onOpen: (open) => {
      $("todo-handoff").hidden = !open;
      $("todo-orca-open").setAttribute("aria-pressed", String(open));
    },
  });
  $("todo-orca-open").onclick = () => {
    handoff.show();
    // The pane is under the comments, in the scroll of the detail: it is brought into view.
    $("todo-handoff").scrollIntoView({ block: "start" });
  };
  initTodoSearch();
  // A task that Claude Code adds through the tools of tsunagiai-mcp (A-36): the list is read again as after any change of a task.
  onScreenChanged("todo", () => scheduleTodoReload(false));
  // 50% of the screen at first; the divider keeps it between 35% and 65% of the screen (the CSS holds the same range). Under the tasks it is the height, 35% to 65%, kept apart from the width.
  split = initSplit($("todo"), $("todo-split"), { min: SIDE_LEAST, max: SIDE_MOST, initial: 0.5, lying: { min: SIDE_LEAST, max: SIDE_MOST, initial: 0.5 } });
  split.lie(below);
  new ResizeObserver(layoutSide).observe($("todo"));
  // The document's pointerdown closes an open menu before the click, so whether this press found it open is read before that.
  let wasOpen = false;
  $("todo-more").onpointerdown = () => (wasOpen = $("todo-more").hasAttribute("aria-expanded"));
  $("todo-more").onclick = () => {
    const was = wasOpen || $("todo-more").hasAttribute("aria-expanded");
    wasOpen = false;
    if (was) closeMoreMenu();
    else openMoreMenu();
  };
  // The back button is shown on the page of a draft only.
  $("todo-back").onclick = () => {
    if (draftOpen()) discardDraft();
  };
  $("todo-token").onsubmit = async (e) => {
    e.preventDefault();
    const input = $<HTMLInputElement>("todo-token-input");
    const token = input.value;
    // The token is never shown: the field is emptied as soon as it is read.
    input.value = "";
    try {
      await invoke("todoist_save_token", { token });
    } catch (err) {
      return showFailure("todo", err);
    }
    // Only a rejected token says so; a failed load (network, 5xx) shows its own error.
    if (await loadTodo()) showFailure("todo", "トークンを確認できませんでした。もう一度入力してください");
  };
  showKeptTodo();
  loadTodoCount();
  setInterval(refreshTodo, TODO_REFRESH_MS);
  // A due moment passes with no fetch: count again from the tasks last given. Not held back while the window is hidden or a field is typed in; it draws only the count.
  setInterval(recountTodo, TODO_REFRESH_MS);
  document.addEventListener("visibilitychange", refreshTodo);
}
