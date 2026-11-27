// The Todo part of the file pane of the Orca screen (A-49), and the tab of a task in its work pane.
// The part has a select of the Todoist projects (「今日」 and 「インボックス」 first, as the Todo screen's list has them) and, under it, the open tasks of the choice as rows: the name, the first line of the description and the due moment. A press on a row opens the task as a tab of the work pane. The choice is kept in memory only.
// The data is the Todo screen's own (`todoState`, read by `loadTodo` of `todo.ts`): this module reads nothing itself. While the part is shown or a tab of a task is open, and the Orca screen is shown, the clock of the Todo screen reads the tasks as it does for its own screen, and what is drawn here follows that read (`useOrcaTodo`).
// The tab (`task:{n}`, in memory only, by target and project as a Jira ticket's tab is, J-2) draws the detail of the Todo screen (`renderDetail` of `todo-detail.ts`) in a box of its own: it writes through the same `todoist_*` commands, and the screen's tabs and these show a change after the next read. A task that the data no longer has (completed, deleted, moved away with its project) closes its tab.
import type { TaskItem } from "./bindings/TaskItem";
import { $, span, tag } from "./dom.js";
import { currentScreen } from "./nav.js";
import { dueLabel, inboxOf, projectName, todoState, useOrcaTodo, viewTasks } from "./todo-data.js";
import { dropComments, fitCommentInput } from "./todo-comments.js";
import { renderDetail } from "./todo-detail.js";
import { loadTodo } from "./todo.js";

// A tab of a task. `stamp` is the draw of the data that its detail shows.
export interface TodoTab {
  id: string;
  target: string | null;
  project: string;
  taskId: string;
  stamp: number;
  // The scroll of the tab, which a tab taken out of the page and put back keeps.
  scroll: number;
  el: HTMLElement;
  body: HTMLElement;
}

// What the screen gives: a task of the rows (or of a detail) was pressed, and the tabs changed (one closed, or a name changed).
let openTask: (id: string) => void = () => {};
let changed: () => void = () => {};

const tabs = new Map<string, TodoTab>();
let lastId = 0;
// Whether the part is shown (the file pane shown with this part chosen), and the choice of its select: `today`, `inbox` or a project's id.
let on = false;
let pick = "today";
// What the list shows now, so that it is drawn again only when it changes.
let drawnList = "";
// Counts the draws of the data, so that the detail of a tab is drawn again when the data was.
let stamp = 0;

const TODAY = "today";
const INBOX = "inbox";

// The select's options: the two lists of the Todo screen, then the projects in the order of Todoist, a sub-project indented.
function options(): [string, string][] {
  const list: [string, string][] = [[TODAY, "今日"], [INBOX, "インボックス"]];
  for (const p of todoState.todo?.projects ?? []) if (!p.inbox) list.push([p.id, "　".repeat(p.depth) + projectName(p)]);
  return list;
}

// The first line of a description that has a word.
const firstLine = (description: string) => description.split("\n").map((l) => l.trim()).find((l) => l !== "") ?? "";

function row(t: TaskItem) {
  const li = tag("div", "orca-todo-row");
  li.dataset.id = t.id;
  li.onclick = () => openTask(t.id);
  li.append(span("orca-todo-name", t.content));
  const desc = firstLine(t.description);
  if (desc !== "") li.append(span("orca-todo-desc", desc));
  if (t.due) li.append(span(`orca-todo-due${t.bucket === "overdue" ? " over" : ""}`, dueLabel(t.due)));
  return li;
}

function drawList() {
  const select = $<HTMLSelectElement>("orca-todo-project");
  const choices = options();
  if (!choices.some(([v]) => v === pick)) pick = TODAY;
  const key = JSON.stringify(choices);
  if (select.dataset.options !== key) {
    select.dataset.options = key;
    select.replaceChildren(
      ...choices.map(([v, text]) => {
        const option = tag("option", "", text);
        option.value = v;
        return option;
      }),
    );
  }
  select.value = pick;
  const tasks = todoState.todo === null || (pick === INBOX && inboxOf() === undefined) ? [] : viewTasks(pick);
  const shown = JSON.stringify([pick, tasks.map((t) => [t.id, t.content, firstLine(t.description), t.due, t.bucket])]);
  if (shown === drawnList) return;
  drawnList = shown;
  $("orca-todo-list").replaceChildren(...tasks.map(row));
}

// The title of the tab in the strip of the pane: the name of the task.
export const todoTitleOf = (t: TodoTab) => todoState.taskById.get(t.taskId)?.content ?? "Todo";

function pending() {
  const row = tag("div", "pending");
  row.append(tag("span", "spin"));
  return row;
}

function drawTab(t: TodoTab) {
  t.stamp = stamp;
  if (todoState.taskById.has(t.taskId)) renderDetail(t.body, t.taskId, { open: (id) => openTask(id), plain: true });
  else t.body.replaceChildren(pending());
}

// The tabs (their IDs and names) as the screen was last told of them: it is drawn again only when they change.
let drawnTabs = "";

// What follows the data: the part's list, the tabs of tasks that are gone closed, the details of the tabs in the page drawn in place, and the screen told to draw the tabs again when a name or the tabs changed.
function drawFollow() {
  stamp++;
  drawList();
  if (tabs.size === 0) return;
  // Not before the data is read: a task that is not there yet is not a task that is gone (the content the last run kept is not a read of this one).
  if (todoState.todo !== null && !todoState.kept) for (const t of [...tabs.values()]) if (!todoState.taskById.has(t.taskId)) closeTodoTab(t.id);
  for (const t of tabs.values()) if (t.el.isConnected) drawTab(t);
  fitCommentInput();
  const key = JSON.stringify([...tabs.values()].map((t) => [t.id, todoTitleOf(t)]));
  if (key === drawnTabs) return;
  drawnTabs = key;
  changed();
}

// Shows or hides the part, and reads the tasks when it comes to be shown: the screen's own read, with the completed tasks while none was read.
export function syncOrcaTodo(shown: boolean) {
  const came = shown && !on;
  on = shown;
  drawList();
  if (came && currentScreen() === "orca") void loadTodo(false, todoState.todo === null || todoState.kept);
}

// Opens the task in a tab of the project (made when there is none) and gives the tab.
export function openTodoTab(target: string | null, project: string, taskId: string) {
  const held = [...tabs.values()].find((t) => t.target === target && t.project === project && t.taskId === taskId);
  if (held) return held;
  const id = `task:${++lastId}`;
  const el = tag("div", "orca-todo-tab");
  el.dataset.todoTab = id;
  const body = tag("div", "orca-todo-detail");
  el.append(body);
  const tab: TodoTab = { id, target, project, taskId, stamp: -1, scroll: 0, el, body };
  el.onscroll = () => {
    tab.scroll = el.scrollTop;
  };
  tabs.set(id, tab);
  drawTab(tab);
  return tab;
}

// The task tabs of the project.
export const todoTabsOf = (target: string | null, project: string) => [...tabs.values()].filter((t) => t.target === target && t.project === project);

export function closeTodoTab(id: string) {
  const t = tabs.get(id);
  if (!t) return;
  t.el.remove();
  tabs.delete(id);
  todoState.descEdit.delete(t.taskId);
  dropComments(t.taskId);
}

// Shows each tab of `placements` in its host element and takes every other tab out of the page (it keeps what it holds and its scroll). The detail is drawn again when the data was drawn since.
export function showTodoTabs(placements: { id: string; host: HTMLElement }[]) {
  const shown = new Set(placements.map((p) => p.id));
  for (const [id, t] of tabs) if (!shown.has(id)) t.el.remove();
  for (const { id, host } of placements) {
    const t = tabs.get(id);
    if (!t) continue;
    if (t.stamp !== stamp) drawTab(t);
    if (t.el.parentElement === host) continue;
    host.replaceChildren(t.el);
    t.el.scrollTop = t.scroll;
  }
  // The field of a comment has its height once it is in the page.
  fitCommentInput();
}

export function initOrcaTodo(screen: { open: (id: string) => void; changed: () => void }) {
  openTask = screen.open;
  changed = screen.changed;
  useOrcaTodo({ wanted: () => currentScreen() === "orca" && (on || tabs.size > 0), draw: drawFollow });
  $<HTMLSelectElement>("orca-todo-project").onchange = (e) => {
    pick = (e.target as HTMLSelectElement).value;
    drawList();
  };
}
