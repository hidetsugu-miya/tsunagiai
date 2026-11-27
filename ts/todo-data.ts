// The Todo screen's data: the state the Todo modules share, and the functions that read it or change it in place.
import type { ParentRef } from "./bindings/ParentRef";
import type { PickedDue } from "./bindings/PickedDue";
import type { ProjectItem } from "./bindings/ProjectItem";
import type { TaskItem } from "./bindings/TaskItem";
import type { TaskHit } from "./bindings/TaskHit";
import type { Todo } from "./bindings/Todo";
import { accountList } from "./accounts.js";
import { $ } from "./dom.js";
import { isoDate } from "./format.js";
import { dropComments } from "./todo-comments.js";
import { setNavCount } from "./view.js";

// What a label created from the screen is drawn in until the reload brings Todoist's color: Todoist's default, charcoal.
const NEW_LABEL_COLOR = "#808080";

export const todoState = {
  // The last data from the backend, or null while a token is needed.
  todo: null as Todo | null,
  // Set while `todo` is the content the last run kept (drawn at startup), not a fetch of this run: the first load still takes the completed tasks.
  kept: false,
  // "today", "inbox", or a project's ID.
  view: "today",
  // The IDs of the tasks that have a tab in the right side (T-10), in the order of the tabs. Kept in memory only.
  tabs: [] as string[],
  // The ID of the selected tab (its detail is drawn under the strip), or null with no tab.
  selected: null as string | null,
  // Only the latest of overlapping loads may draw.
  seq: 0,
  // The `seq` of the load whose data `todo` holds (whether or not it was drawn); the subtasks being created are shown until a load that began after their creation is drawn.
  loaded: 0,
  // Changes in flight (todoCall's writes). While any is, a load draws nothing: it could hold the state from before the change and put it back.
  writes: 0,
  // True while a row is dragged by its grip, so the timed refresh does not redraw the list under it.
  dragging: false,
  // Set when a load updated `todo` without drawing it (a field was being typed in), so the next quiet refresh draws it even if nothing else changed.
  undrawn: false,
  // The data of the last quiet load as text, to tell a refresh that changed nothing; null after any other load, since the screen may differ from it then.
  text: null as string | null,
  // The projects by ID, rebuilt on each load.
  projectById: new Map<string, ProjectItem>(),
  // The tasks by ID, rebuilt on each load.
  taskById: new Map<string, TaskItem>(),
  // Set when the count fetch finds no usable token: it stops reading the keychain until a load on the Todo screen succeeds.
  countOff: false,
  // True until a load has fetched from Todoist since the start or a disconnect; an answer from the cache (`offline`) leaves it as it is.
  // Every load asks for the completed tasks (`withDone`) while it is set, so the detail, the counts and the cache the backend saves keep the done subtasks once Todoist answers.
  doneStale: true,
  // The descriptions being edited, by the task's ID (the text typed). They outlive a redraw and another task's detail, so a refresh keeps the mode and the text; the textarea's own caret is restored by renderDetail. A task's goes when its tab closes.
  descEdit: new Map<string, string>(),
  // The projects whose children the side list hides (all are shown at first). Kept in memory only.
  closedProjects: new Set<string>(),
  // The text in the search field (T-9). A text with no word is no search: the list shows.
  query: "",
  // What the search found for `query`, as Rust answered it.
  hits: [] as TaskHit[],
  // Only the latest of overlapping searches may draw.
  searchSeq: 0,
  // The tasks whose subtasks the list shows (all are hidden at first). Kept in memory only, so a redraw after a load keeps them.
  openTasks: new Set<string>(),
};

// The Todoist apps' colors for priorities 1 to 4 (the values are `--priority-1` to `--priority-4` in style.css).
export const PRIORITY_COLORS: Record<number, string> = { 1: "var(--priority-1)", 2: "var(--priority-2)", 3: "var(--priority-3)", 4: "var(--priority-4)" };
export const TODO_GROUPS = [["overdue", "期限切れ"], ["today", "今日"], ["upcoming", "明日以降"], ["none", "期限なし"]] as const;

// What a task change sends to Todoist: `dueString` is a text Todoist reads ("明日 15時"), or `YYYY-MM-DD` from the calendar.
export interface TaskFields {
  content?: string;
  description?: string;
  dueString?: string;
  // The task's whole list of label names.
  labels?: string[];
}

// Selects the tab of the task `id`, and opens one at the end of the strip when the task has none (T-10): the same task never has two.
export function openTab(id: string) {
  if (!todoState.tabs.includes(id)) todoState.tabs.push(id);
  todoState.selected = id;
}

// Closes the tab of the task `id`. Closing the selected tab selects its neighbour: the one that came after it, else the one before it, else none.
export function closeTab(id: string) {
  const i = todoState.tabs.indexOf(id);
  if (i < 0) return;
  todoState.tabs.splice(i, 1);
  todoState.descEdit.delete(id);
  dropComments(id);
  if (todoState.selected === id) todoState.selected = todoState.tabs[i] ?? todoState.tabs[i - 1] ?? null;
}

// Closes the tabs of the tasks that are no longer in the data (completed, deleted, moved away with a project that went): each as `closeTab` does.
export function pruneTabs() {
  for (const id of [...todoState.tabs]) if (!todoState.taskById.has(id)) closeTab(id);
}

// Whether the search field holds a word, so that the results take the place of the list (T-9).
export const searching = () => todoState.query.trim() !== "";

// Open tasks that "今日" lists: overdue or due today.
export const isDueToday = (t: TaskItem) => t.bucket === "overdue" || t.bucket === "today";

// The tasks the sidebar's Todo count is made of, kept so the count can be made again as time passes without a fetch.
let counted: TaskItem[] = [];

// Counts the open tasks whose due moment has come (to the minute, as a moment is a whole minute) on the Todo button, and passes the moments still ahead to the Dock (`upcoming`).
export function recountTodo() {
  const now = Date.now();
  let passed = 0;
  const upcoming: number[] = [];
  for (const t of counted) {
    const at = t.dueAt;
    if (at === null) continue;
    if (at <= now) passed++;
    else upcoming.push(at);
  }
  setNavCount("nav-todo", passed, "Todo", "期限到来", upcoming);
}

// The open tasks whose due moment has come: the ones the count above is made of, for the rows of the pane of the notices (A-35).
export function dueTasks() {
  const now = Date.now();
  return counted.filter((t) => t.dueAt !== null && t.dueAt <= now);
}

// Set on the page of the window of a task (T-11), which holds the detail of one task and nothing else: the count of the side menu and of the Dock is the main page's, and the rows of the detail that open another tab, a mail or a drag have nowhere to go.
let taskWindow = false;
export const isTaskWindow = () => taskWindow;
export const useTaskWindow = () => {
  taskWindow = true;
};

// What the Orca screen gives for its Todo part and its tabs of a task (A-49, `ts/orca-todo.ts`): whether it wants the tasks read while it is shown, and what it draws from them after the screen's data was drawn.
// The data is the Todo screen's own, read by its load (`loadTodo`) and changed by its writes, so no second reader runs.
let orcaTodo = { wanted: () => false, draw: () => {} };
export const useOrcaTodo = (part: typeof orcaTodo) => {
  orcaTodo = part;
};
export const orcaTodoWanted = () => orcaTodo.wanted();
export const drawOrcaTodo = () => orcaTodo.draw();

// Remembers `tasks` (the open tasks, subtasks included) as what the count is made of, and counts them. An empty list clears the count.
export function setTodoCount(tasks: TaskItem[]) {
  if (taskWindow) return;
  counted = tasks;
  recountTodo();
}

export const inboxOf = () => todoState.todo!.projects.find((p) => p.inbox);
export const projectOf = (id: string) => todoState.projectById.get(id);
export const projectName = (p: ProjectItem | undefined) => (p?.inbox ? "インボックス" : p?.name ?? "");
export const viewProjectId = (view: string) => (view === "inbox" ? inboxOf()?.id : view);

// The rows of `t`'s subtasks that are not done (a done one has no row), in Todoist's order.
export const subRows = (t: TaskItem) => t.subtasks.flatMap((s) => (s.done ? [] : todoState.taskById.get(s.id) ?? []));

export function viewTasks(view: string) {
  const { tasks } = todoState.todo!;
  if (view === "today") return tasks.filter(isDueToday);
  const id = viewProjectId(view);
  return tasks.filter((t) => t.projectId === id && !t.parent);
}

// "今日" for today (or its time), else "10月07日", with the year in another year ("2027年04月01日"), and with the time if there is one.
export function dueLabel(due: { date: string; time: string | null }) {
  const today = isoDate(new Date());
  if (due.date === today) return due.time ?? "今日";
  const [y, m, d] = due.date.split("-");
  const day = `${m}月${d}日`;
  const date = y === today.slice(0, 4) ? day : `${y}年${day}`;
  return due.time ? `${date} ${due.time}` : date;
}

// The thread a task links to, only when it is of an account tsunagiai has: a description can name any address.
export const linkedMail = (t: TaskItem, accounts: Set<string | undefined>) => (t.mail && accounts.has(t.mail.account) ? t.mail : null);
export const accountSet = () => new Set(accountList());

// Whether a text field holds what the user is typing (a field of the open task, or a name being edited in the list); a redraw would replace it with Todoist's older value.
// The subtask field and the comment field count only while they have text: the first is emptied on Enter, and the redraw must show the subtask just added; the second is emptied once its comment is sent.
export function editingField() {
  if (todoState.dragging) return true;
  const a = document.activeElement as HTMLElement;
  // The window of a task (T-11) has no list.
  if ($("todo-list")?.contains(a)) return a.matches(".row-edit");
  // The detail of the Todo screen, and the detail in a tab of a task of the Orca work pane (A-49).
  return !!a.closest("#todo-detail, .orca-todo-detail") && a.matches("textarea, input:not([type=checkbox])") && ((a.dataset.field !== "sub" && a.dataset.field !== "comment") || (a as HTMLInputElement).value !== "");
}

// Only http(s) links stay: a relative link would resolve to the app's own origin, which Rust's on_navigation allows, and replace the screen.
// An http(s) link navigates this page and on_navigation opens it in the default browser, as a plain-text mail body's links do.
// No form controls or styles: they could draw a fake field over the screen. No id or name: they could shadow the screen's own elements for $().
// No svg or math: the transparent link area of an SVG could be spread over the screen. No label, for or class: a comment from another collaborator could style `<label for="trash" class="scrim">` over the whole screen, so that any click presses a hidden button of the mail detail by its id, or `<a class="scrim">` so that any click opens an outside site. No data-*: the screen reads them as its own state (`data-field`, `data-id`). The `.md` styles are element selectors and need none of them.
const MARKDOWN_SANITIZE = {
  ALLOWED_URI_REGEXP: /^https?:/i,
  FORBID_TAGS: ["form", "input", "button", "textarea", "select", "style", "label", "svg", "math"],
  FORBID_ATTR: ["style", "id", "name", "class", "for"],
  ALLOW_DATA_ATTR: false,
};

// The HTML of a description or a comment, which Todoist keeps as Markdown. breaks: a single newline is a line break, as they are written line by line.
export const markdownHtml = (markdown: string) => DOMPurify.sanitize(marked.parse(markdown, { breaks: true }), MARKDOWN_SANITIZE);

// Puts the label `name`, just created, on the task `id`, and among the labels to pick from if it is not there.
export function addLabelLocal(id: string, name: string) {
  const t = todoState.taskById.get(id);
  if (t && !t.labels.includes(name)) t.labels = [...t.labels, name];
  const { labels } = todoState.todo!;
  if (!labels.some((l) => l.name === name)) labels.push({ name, color: NEW_LABEL_COLOR });
}

// `picked` is what Rust made of the due text (`todoist_picked_due`): the due, its bucket and its moment, put on the task as they are. null for other text, which Todoist reads, so the task stays as it is until the reload.
// shortcut: the list is not re-sorted after a due date change; the next reload fixes it.
export function patchTask(id: string, { dueString: _, ...fields }: TaskFields, picked: PickedDue | null = null) {
  const t = todoState.taskById.get(id);
  if (!t) return;
  Object.assign(t, fields);
  if (picked) Object.assign(t, picked);
}

// Whether `t` is below the task `id`, through any number of parents.
function isUnder(t: TaskItem, id: string) {
  for (let p: ParentRef | null | undefined = t.parent; p; p = todoState.taskById.get(p.id)?.parent) if (p.id === id) return true;
  return false;
}

// Whether the task `t` may be dropped on the row of the task `id`: not on itself, not on a task below it, and not on the parent it already has.
export function canMoveUnder(t: TaskItem, id: string) {
  const target = todoState.taskById.get(id);
  return !!target && id !== t.id && id !== t.parent?.id && !isUnder(target, t.id);
}

const recount = (p: TaskItem) => {
  p.subDone = p.subtasks.filter((s) => s.done).length;
  p.subTotal = p.subtasks.length;
};

// Takes `t` out of the subtask list of its parent, which counts one less, and makes `t` a top-level task.
function leaveParent(t: TaskItem) {
  const old = t.parent && todoState.taskById.get(t.parent.id);
  t.parent = null;
  if (!old) return;
  old.subtasks = old.subtasks.filter((s) => s.id !== t.id);
  recount(old);
}

// Moves a task and the rows of its subtasks, which Todoist moves with it, into a project.
// The task becomes a top-level task there, a subtask too: moving it into its own project makes it stand alone.
export function moveLocal(id: string, projectId: string) {
  const t = todoState.taskById.get(id);
  if (t) leaveParent(t);
  for (const x of todoState.todo!.tasks) if (x.id === id || isUnder(x, id)) x.projectId = projectId;
}

// Moves a task and the rows of its subtasks under the task `parentId`, as its last subtask, in that task's project. The parent is opened so the moved row shows.
export function moveUnderLocal(id: string, parentId: string) {
  const t = todoState.taskById.get(id);
  const parent = todoState.taskById.get(parentId);
  if (!t || !parent) return;
  leaveParent(t);
  t.parent = { id: parent.id, content: parent.content };
  parent.subtasks.push({ id: t.id, content: t.content, done: false, due: t.due });
  // Active subtasks first, then the completed ones.
  parent.subtasks.sort((a, b) => Number(a.done) - Number(b.done));
  recount(parent);
  for (const x of todoState.todo!.tasks) if (x.id === id || isUnder(x, id)) x.projectId = parent.projectId;
  todoState.openTasks.add(parentId);
}

// Where a drop puts a task (T-2): under the task `parentId` (null: the top level), before its sibling `beforeId` (null: last), drawn at `depth`.
export interface Place {
  parentId: string | null;
  beforeId: string | null;
  depth: number;
}

// How Rust orders the top-level tasks of a list: by due date, then time (none first), a task with no due date last (`build_todo`); tasks of the same moment keep Todoist's order.
const dueKey = (t: TaskItem) => (t.due ? `${t.due.date} ${t.due.time ?? ""}` : null);
function byDue(a: TaskItem, b: TaskItem) {
  const [x, y] = [dueKey(a), dueKey(b)];
  if (x === y) return 0;
  return x === null ? 1 : y === null ? -1 : x < y ? -1 : 1;
}

// The places the task `t` may be dropped at, in the gap before `rows[gap]` (the IDs of the rows of the open list of a project, top to bottom; `rows.length` is the gap after the last), by depth, the shallowest first (T-2).
// The rows of `t` and of its subtasks are left out, as they leave when it moves: the row above the gap and the row below it are the ones that remain, so a place under `t` itself or under one of its subtasks is never offered.
// `root` is the task of an open detail, whose subtasks are the rows (T-6): they stand in the place of the top level (depth 0 is a subtask of `root`), and the subtasks of a row are not shown, so the task goes last under a row.
// Between the row above (A) and the row below (B) the depths run from B's to one more than A's: at each the task is a sibling of A or of one of its parents, after it, or at the deepest a child of A.
// Not offered: the place `t` has now, and, at the top level, a place that the list's order by due moment would not keep.
export function placesAt(rows: string[], gap: number, t: TaskItem, root?: TaskItem): Place[] {
  const shown = (id: string) => id !== t.id && !isUnder(todoState.taskById.get(id)!, t.id);
  let above: string | undefined;
  for (const id of rows.slice(0, gap)) if (shown(id)) above = id;
  const below = rows.slice(gap).find(shown);
  const ancestry = (id: string) => {
    const chain: TaskItem[] = [];
    for (let x = todoState.taskById.get(id); x && x.id !== root?.id; x = x.parent ? todoState.taskById.get(x.parent.id) : undefined) chain.unshift(x);
    return chain;
  };
  const chain = above ? ancestry(above) : [];
  const kidsShown = (p: TaskItem | null) => (root ? p?.id === root.id : !p || todoState.openTasks.has(p.id));
  const siblings = (parent: TaskItem | null) => (parent ? subRows(parent) : viewTasks(todoState.view)).filter((s) => s.id !== t.id);
  const nextOf = (list: TaskItem[], x: TaskItem) => list[list.findIndex((s) => s.id === x.id) + 1]?.id ?? null;
  // The sibling that follows `t` where it is now.
  const now = t.parent ? todoState.taskById.get(t.parent.id) ?? null : null;
  const own = now ? subRows(now) : viewTasks(todoState.view);
  const nowBefore = own[own.findIndex((s) => s.id === t.id) + 1]?.id ?? null;
  const places: Place[] = [];
  for (let depth = below ? ancestry(below).length - 1 : 0; depth <= chain.length; depth++) {
    const parent = depth > 0 ? chain[depth - 1] : root ?? null;
    // Under the row above: before its first subtask when they are shown, else last. Elsewhere: before the sibling that follows the row above or its parent at this depth.
    const beforeId = depth < chain.length ? nextOf(siblings(parent), chain[depth]) : kidsShown(parent) ? siblings(parent)[0]?.id ?? null : null;
    if ((parent?.id ?? null) === (t.parent?.id ?? null) && beforeId === nowBefore) continue;
    if (!parent) {
      const next = beforeId === null ? undefined : todoState.taskById.get(beforeId);
      if ((chain[0] && byDue(chain[0], t) > 0) || (next && byDue(t, next) > 0)) continue;
    }
    places.push({ parentId: parent?.id ?? null, beforeId, depth });
  }
  return places;
}

// Puts a task, with its subtasks, under the task `parentId` or at the top level of the project `projectId` (null: where it is), before the sibling `beforeId` (null: last) (T-2).
// A parent is opened so the moved row shows. At the top level the task goes before `beforeId` in the list's order, which the redraw keeps for tasks of the same due moment.
export function placeLocal(id: string, parentId: string | null, projectId: string | null, beforeId: string | null) {
  const todo = todoState.todo!;
  const t = todoState.taskById.get(id);
  const parent = parentId === null ? null : todoState.taskById.get(parentId);
  if (!t || parent === undefined) return;
  leaveParent(t);
  const project = parent?.projectId ?? projectId ?? t.projectId;
  for (const x of todo.tasks) if (x.id === id || isUnder(x, id)) x.projectId = project;
  if (parent) {
    t.parent = { id: parent.id, content: parent.content };
    const at = parent.subtasks.findIndex((s) => s.id === beforeId);
    // Active subtasks first, then the completed ones: last among the active ones.
    const end = parent.subtasks.findIndex((s) => s.done);
    parent.subtasks.splice(at >= 0 ? at : end >= 0 ? end : parent.subtasks.length, 0, { id: t.id, content: t.content, done: false, due: t.due });
    recount(parent);
    todoState.openTasks.add(parent.id);
    return;
  }
  const tasks = todo.tasks;
  tasks.splice(tasks.indexOf(t), 1);
  let at = tasks.findIndex((x) => x.id === beforeId);
  if (at < 0) {
    at = 0;
    tasks.forEach((x, i) => {
      if (!x.parent && x.projectId === project) at = i + 1;
    });
  }
  tasks.splice(at, 0, t);
}

// The IDs of the project `id` and of the projects nested under it, however deep.
function projectTreeIds(id: string) {
  const ids = new Set([id]);
  // Todoist lists a project after the one it is nested in, so one pass finds them all.
  for (const p of todoState.todo!.projects) if (p.parentId && ids.has(p.parentId)) ids.add(p.id);
  return ids;
}

// The projects the project `p` may be moved under (T-8): not itself, not one nested under it, not its parent, and not the inbox, which has no sub-projects.
export function moveTargets(p: ProjectItem) {
  const tree = projectTreeIds(p.id);
  return todoState.todo!.projects.filter((x) => !x.inbox && !tree.has(x.id) && x.id !== p.parentId);
}

// The IDs of the project `id` and of the projects above it that are closed in the side list: a row under one of them is not drawn.
export function closedChain(id: string) {
  const ids: string[] = [];
  for (let p = todoState.projectById.get(id); p; p = p.parentId ? todoState.projectById.get(p.parentId) : undefined) {
    if (todoState.closedProjects.has(p.id)) ids.push(p.id);
  }
  return ids;
}

// Moves the project `id` with the projects nested under it to the end of the sub-projects of `parentId`, or to the end of the top level when it is null (T-8).
// The list is in tree order and each project has its depth, so the block moves as a whole and its depths shift. The new parent and the projects above it are opened so the moved row shows.
export function moveProjectLocal(id: string, parentId: string | null) {
  const projects = todoState.todo!.projects;
  const from = projects.findIndex((p) => p.id === id);
  if (from < 0) return;
  const root = projects[from];
  let end = from + 1;
  while (end < projects.length && projects[end].depth > root.depth) end++;
  const block = projects.splice(from, end - from);
  let at = projects.length;
  let depth = 0;
  if (parentId !== null) {
    const parentAt = projects.findIndex((p) => p.id === parentId);
    if (parentAt < 0) {
      projects.splice(from, 0, ...block);
      return;
    }
    const parent = projects[parentAt];
    at = parentAt + 1;
    while (at < projects.length && projects[at].depth > parent.depth) at++;
    depth = parent.depth + 1;
    for (const closed of closedChain(parentId)) todoState.closedProjects.delete(closed);
  }
  // Read before the loop: the first project of the block is `root`, and its depth changes first.
  const shift = depth - root.depth;
  for (const p of block) p.depth += shift;
  root.parentId = parentId;
  projects.splice(at, 0, ...block);
}

// Takes the project `id` out of the list with the projects nested under it, however deep, and their tasks: Todoist archives or deletes them together (T-8).
// The view goes back to "今日" when it was one of them, and the tabs of their tasks are closed.
export function dropProjectLocal(id: string) {
  const todo = todoState.todo!;
  const gone = projectTreeIds(id);
  for (const tab of [...todoState.tabs]) if (gone.has(todoState.taskById.get(tab)?.projectId ?? "")) closeTab(tab);
  if (gone.has(todoState.view)) todoState.view = "today";
  todo.projects = todo.projects.filter((p) => !gone.has(p.id));
  todo.tasks = todo.tasks.filter((t) => !gone.has(t.projectId));
  todoState.projectById = new Map(todo.projects.map((p) => [p.id, p]));
}

// Completes (`done` true), reopens (false) or deletes (null) a task. In the subtask list of the task holding it, it turns done, open or goes, and the counts follow.
// A completed or deleted one leaves the list with the rows of its subtasks. A reopened one has no row until the reload, which has the data for it.
export function settleLocal(id: string, done: boolean | null) {
  const todo = todoState.todo!;
  for (const p of todo.tasks) {
    const s = p.subtasks.find((s) => s.id === id);
    if (!s) continue;
    if (done === null) p.subtasks = p.subtasks.filter((x) => x !== s);
    else s.done = done;
    // Active subtasks first, then the completed ones.
    p.subtasks.sort((a, b) => Number(a.done) - Number(b.done));
    recount(p);
  }
  // shortcut: a reopened subtask keeps its place among the done ones, and has no row; the next reload fixes it.
  if (done !== false) todo.tasks = todo.tasks.filter((t) => t.id !== id && !isUnder(t, id));
}
