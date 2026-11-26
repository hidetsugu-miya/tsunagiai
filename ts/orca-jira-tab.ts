// The Jira ticket tab of the work pane of the Orca screen (J-2, #871): a ticket of the list in the right pane (orca-jira.ts), opened by a press as a tab like the tab of a diff (A-24). The body is the ticket's key (with its parent's), its summary, its description and its comments, and the right column holds its status, assignee, sprint, priority, labels and parent; it only shows them.
// The right column changes the status, the assignee, the priority and the sprint (#872): the value is a button that opens a menu of what Jira allows (the options are asked when it is pressed), the chosen value is shown at once, and when Jira refuses the old one is put back and the reason is shown as a card (A-28). The rows of the list in the right pane take the new value (orca-jira.ts).
// The description is edited in the rich Markdown editor of A-26 (#873): a pencil beside it opens the editor with the Markdown it was read as, and 「保存」 sends that Markdown and the Markdown the editor started from to Rust (`jira_set_description`), which puts it back into the ADF that Jira holds so that what Markdown cannot say stays. A comment is added from a second editor under the comments (`jira_add_comment`). When Jira refuses, the typing stays in its editor and the reason is shown as a card (A-28).
// The tab of a new ticket (#874): the same tab, with an empty key and the form of `NewTicket` in place of the ticket. The form asks for the projects (`jira_projects`), the issue types of the chosen project (`jira_issue_types`) and the sprints of the board of the list (`jira_sprints`) when the tab is opened and by 「読み直す」, and 「作る」 sends them with the summary and the description (`jira_create_issue`). When Jira has made the ticket the tab becomes the ticket's tab (its key, read at once), the screen selects it and the list reads its sections again; when Jira refuses, a card shows the reason (A-28) and the form keeps what was typed.
// The tabs are kept in memory only, by target and project, as the tabs of the files and the diffs are (their ids are `jira:{n}`), and each reads and writes through the connection of its project (`at`: the target and the project go to every command, #1394). Rust reads the ticket (`jira_issue`) and gives the description and the comments as Markdown (read from Jira's ADF), which the page draws through `markdownHtml` (it keeps only what a Todoist comment may keep). A ticket is read when its tab is opened and again by the button 「読み直す」, never by the clock; a read that ends after its tab was closed, or after a newer read began, is dropped.
import type { JiraCreated } from "./bindings/JiraCreated";
import type { JiraIssueDetail } from "./bindings/JiraIssueDetail";
import type { JiraIssueType } from "./bindings/JiraIssueType";
import type { JiraProject } from "./bindings/JiraProject";
import type { JiraSprint } from "./bindings/JiraSprint";
import { span, tag } from "./dom.js";
import { setNotice, showFailure } from "./error-card.js";
import { EDIT_SVG, RELOAD_SVG } from "./icons.js";
import { invoke } from "./ipc.js";
import { openMenu } from "./menu.js";
import { applyJiraChange, reloadJiraSections } from "./orca-jira.js";
import { createRichEditor, type RichEditor } from "./rich-editor.js";
import { markdownHtml } from "./todo-data.js";

// The form of a new ticket. `typing` is true while the issue types of the chosen project are read.
interface NewTicket {
  projects: JiraProject[];
  types: JiraIssueType[];
  sprints: JiraSprint[];
  // Jira's refusal of the sprints of the board (a team-managed board with its sprints off), a warning card (A-28); null when they were read.
  sprintNote: string | null;
  typing: boolean;
  projectId: string;
  typeId: string;
  sprintId: number | null;
  describe: RichEditor;
  form: HTMLElement;
  project: HTMLSelectElement;
  kind: HTMLSelectElement;
  sprint: HTMLSelectElement;
  summary: HTMLInputElement;
  submit: HTMLButtonElement;
}

export interface JiraTab {
  id: string;
  target: string | null;
  project: string;
  // The ticket's key, or "" for the tab of a new ticket (`fresh`).
  key: string;
  fresh: NewTicket | null;
  // The board of the list that the ticket was opened from: the sprints it can be moved to are the board's.
  boardId: number;
  phase: "loading" | "ready" | "failed";
  issue: JiraIssueDetail | null;
  error: string | null;
  // A change is on its way to Jira: the values cannot be changed again, and the ticket is not read, until it ends.
  writing: boolean;
  // The description is being edited: its editor is shown in place of the text, and `base` is the Markdown it started from (what `jira_set_description` checks Jira's description against).
  editing: boolean;
  base: string;
  describe: RichEditor | null;
  // The field of a new comment is shown.
  commenting: boolean;
  comment: RichEditor | null;
  // The button that adds the comment, off while the field holds no text.
  commentSubmit: HTMLButtonElement | null;
  // Counts the reads, so that an answer of an older one than the last is dropped.
  seq: number;
  // The scroll of the body, which a tab taken out of the page and put back keeps.
  scroll: number;
  el: HTMLElement;
  head: HTMLElement;
  body: HTMLElement;
  reload: HTMLButtonElement;
}

const tabs = new Map<string, JiraTab>();
let lastId = 0;

// The connection of a tab is the one of the project it was opened in (J-2, #1394): every command takes its environment and project.
const at = (t: JiraTab) => ({ environment: t.target, project: t.project });

function pending() {
  const row = tag("div", "pending");
  row.append(tag("span", "spin"), tag("span", "sp", "読み込んでいます…"));
  return row;
}

// A line of the right column: its name and its value, which is `none` in gray when there is nothing. With `edit` the value is a button that calls it.
function sideRow(name: string, value: Node | string | null, none: string, edit?: { enabled: boolean; open: (anchor: HTMLButtonElement) => void }) {
  const row = tag("div", "orca-jira-side-row");
  const text = edit ? tag("button", "orca-jira-side-value orca-jira-edit") : tag("div", "orca-jira-side-value");
  if (edit && text instanceof HTMLButtonElement) {
    text.type = "button";
    text.disabled = !edit.enabled;
    text.onclick = () => edit.open(text);
  }
  if (value === null || value === "") {
    text.classList.add("none");
    text.textContent = none;
  } else text.append(value);
  row.append(tag("div", "orca-jira-side-name", name), text);
  return row;
}

function markdownNode(markdown: string) {
  const node = tag("div", "md");
  node.innerHTML = markdownHtml(markdown);
  return node;
}

// Colors of the status category in a menu of statuses, as the labels have them.
const CATEGORY_COLOR: Record<string, string> = { new: "var(--effort-low)", indeterminate: "var(--codex-fg)", done: "var(--accent-text)" };
const NONE_ITEM = { label: "選べるものがありません", color: "transparent", current: false, disabled: true, pick: () => {} };

// Changes fields of the ticket: the new values are shown at once and Jira is asked; when it refuses, the old values come back and the reason is shown as a card (A-28). `after` runs when Jira has taken it.
async function write(t: JiraTab, patch: Partial<JiraIssueDetail>, call: () => Promise<unknown>, after: () => unknown) {
  const before = t.issue;
  if (before === null || t.writing) return;
  t.issue = { ...before, ...patch };
  t.writing = true;
  draw(t);
  try {
    await call();
  } catch (e) {
    t.issue = before;
    t.writing = false;
    draw(t);
    return showFailure("orca-jira", e);
  }
  t.writing = false;
  draw(t);
  after();
}

// Asks for the options of a field when its button is pressed and opens them as a menu under it; a failure is a card and no menu.
async function menuOf<T>(anchor: HTMLButtonElement, load: () => Promise<T[]>, item: (option: T) => { label: string; color: string; current: boolean; pick: () => unknown }, first: { label: string; current: boolean; pick: () => unknown }[] = [], search?: string) {
  anchor.disabled = true;
  let options: T[];
  try {
    options = await load();
  } catch (e) {
    return showFailure("orca-jira", e);
  } finally {
    anchor.disabled = false;
  }
  if (!anchor.isConnected) return;
  const items = [...first.map((f) => ({ ...f, color: "var(--muted)" })), ...options.map(item)];
  openMenu(anchor, items.length === 0 ? [NONE_ITEM] : items, search === undefined ? {} : { search: { label: search, empty: "見つかりません" } });
}

function editStatus(t: JiraTab, issue: JiraIssueDetail, anchor: HTMLButtonElement) {
  void menuOf(
    anchor,
    async () => (await invoke("jira_transitions", { ...at(t), key: t.key })).filter((x) => x.status !== issue.status),
    (x) => ({ label: x.status, color: CATEGORY_COLOR[x.statusCategory] ?? "var(--muted)", current: false, pick: () => void write(t, { status: x.status, statusCategory: x.statusCategory }, () => invoke("jira_transition", { ...at(t), key: t.key, transitionId: x.id }), () => applyJiraChange(t.key, { status: x.status, statusCategory: x.statusCategory })) }),
  );
}

function editAssignee(t: JiraTab, issue: JiraIssueDetail, anchor: HTMLButtonElement) {
  const to = (accountId: string | null, name: string | null) => () => name === issue.assignee || void write(t, { assignee: name }, () => invoke("jira_assign", { ...at(t), key: t.key, accountId }), () => applyJiraChange(t.key, { assignee: name }));
  void menuOf(
    anchor,
    () => invoke("jira_assignable", { ...at(t), key: t.key }),
    (p) => ({ label: p.displayName, color: "var(--muted)", current: p.displayName === issue.assignee, pick: to(p.accountId, p.displayName) }),
    [{ label: "未割り当て", current: issue.assignee === null, pick: to(null, null) }],
    "担当を探す",
  );
}

function editPriority(t: JiraTab, issue: JiraIssueDetail, anchor: HTMLButtonElement) {
  void menuOf(
    anchor,
    () => invoke("jira_priorities", { ...at(t), key: t.key }),
    (p) => ({ label: p.name, color: "var(--muted)", current: p.name === issue.priority, pick: () => p.name === issue.priority || void write(t, { priority: p.name }, () => invoke("jira_set_priority", { ...at(t), key: t.key, priorityId: p.id }), () => applyJiraChange(t.key, { priority: p.name })) }),
  );
}

function editSprint(t: JiraTab, issue: JiraIssueDetail, anchor: HTMLButtonElement) {
  const to = (sprintId: number | null, name: string | null) => () => name === issue.sprint || void write(t, { sprint: name }, () => invoke("jira_set_sprint", { ...at(t), key: t.key, sprintId }), () => void reloadJiraSections());
  void menuOf(
    anchor,
    () => invoke("jira_sprints", { ...at(t), boardId: t.boardId }),
    (s) => ({ label: s.name, color: "var(--muted)", current: s.name === issue.sprint, pick: to(s.id, s.name) }),
    [{ label: "バックログ", current: issue.sprint === null, pick: to(null, null) }],
  );
}

function sideNode(t: JiraTab, issue: JiraIssueDetail) {
  const side = tag("aside", "orca-jira-side");
  const enabled = t.phase !== "loading" && !t.writing;
  const status = span("orca-jira-pill", issue.status);
  status.dataset.category = issue.statusCategory;
  const labels = tag("div", "orca-jira-labels");
  labels.append(...issue.labels.map((l) => span("orca-jira-label", l)));
  let parent: HTMLElement | null = null;
  if (issue.parent !== null) {
    parent = tag("div", "orca-jira-parent");
    parent.append(span("orca-jira-key", issue.parent.key), span("orca-jira-parent-summary", issue.parent.summary));
  }
  const edit = (open: (t: JiraTab, issue: JiraIssueDetail, anchor: HTMLButtonElement) => void) => ({ enabled, open: (anchor: HTMLButtonElement) => open(t, issue, anchor) });
  side.append(sideRow("ステータス", issue.status === "" ? null : status, "なし", edit(editStatus)), sideRow("担当", issue.assignee, "未割り当て", edit(editAssignee)), sideRow("スプリント", issue.sprint, "なし", edit(editSprint)), sideRow("優先度", issue.priority, "なし", edit(editPriority)), sideRow("ラベル", issue.labels.length === 0 ? null : labels, "なし"), sideRow("親", parent, "なし"));
  return side;
}

function textButton(label: string, className: string, onclick: () => void, disabled = false, primary = false) {
  const button = tag("button", `text-btn${primary ? " primary" : ""} ${className}`, label);
  button.type = "button";
  button.disabled = disabled;
  button.onclick = onclick;
  return button;
}

function descriptionEditor(t: JiraTab) {
  t.describe ??= createRichEditor({ prefix: "orca-jira-desc", label: "説明", arrow: false, onChange: () => {}, onSubmit: () => void saveDescription(t) });
  return t.describe;
}

function commentEditor(t: JiraTab) {
  t.comment ??= createRichEditor({
    prefix: "orca-jira-comment",
    label: "コメント",
    arrow: false,
    onChange: () => {
      if (t.commentSubmit && t.comment) t.commentSubmit.disabled = t.writing || t.comment.blank();
    },
    onSubmit: () => void addComment(t),
  });
  return t.comment;
}

// Opens the editor on the description, and fills it once Milkdown is read.
async function startEdit(t: JiraTab) {
  const issue = t.issue;
  if (issue === null || t.writing || t.editing) return;
  const editor = descriptionEditor(t);
  t.editing = true;
  t.base = issue.description;
  draw(t);
  try {
    await editor.ensure();
  } catch (e) {
    t.editing = false;
    draw(t);
    return showFailure("orca-jira", e);
  }
  if (!t.editing) return;
  editor.set(t.base);
  draw(t);
  editor.focus();
}

// A read that is on its way started before a change that Jira has taken, so its answer would put the old ticket back. Drop it, and let the tab stand on the ticket it has.
function dropRead(t: JiraTab) {
  t.seq++;
  if (t.phase === "loading") t.phase = "ready";
}

// Sends the description of the editor. The ticket keeps the description it had until Jira has taken the new one; when Jira refuses, the typing stays in the editor.
async function saveDescription(t: JiraTab) {
  const editor = t.describe;
  const issue = t.issue;
  if (editor === null || issue === null || !t.editing || t.writing || !editor.ready()) return;
  t.writing = true;
  editor.setBusy(true);
  draw(t);
  try {
    const description = await invoke("jira_set_description", { ...at(t), key: t.key, base: t.base, markdown: editor.markdown() });
    t.issue = { ...(t.issue ?? issue), description };
    t.editing = false;
    dropRead(t);
  } catch (e) {
    showFailure("orca-jira", e);
  }
  t.writing = false;
  editor.setBusy(false);
  draw(t);
}

async function startComment(t: JiraTab) {
  if (t.issue === null || t.writing || t.commenting) return;
  const editor = commentEditor(t);
  t.commenting = true;
  draw(t);
  try {
    await editor.ensure();
  } catch (e) {
    t.commenting = false;
    draw(t);
    return showFailure("orca-jira", e);
  }
  if (!t.commenting) return;
  draw(t);
  editor.focus();
}

// Adds the comment of the field under the others. When Jira refuses, the text stays in the field.
async function addComment(t: JiraTab) {
  const editor = t.comment;
  const issue = t.issue;
  if (editor === null || issue === null || !t.commenting || t.writing || !editor.ready() || editor.blank()) return;
  t.writing = true;
  editor.setBusy(true);
  draw(t);
  try {
    const added = await invoke("jira_add_comment", { ...at(t), key: t.key, markdown: editor.markdown() });
    const now = t.issue ?? issue;
    t.issue = { ...now, comments: [...now.comments, added] };
    editor.set("");
    t.commenting = false;
    dropRead(t);
  } catch (e) {
    showFailure("orca-jira", e);
  }
  t.writing = false;
  editor.setBusy(false);
  draw(t);
}

// The description: its text with the pencil that opens the editor, or the editor with its buttons.
function descriptionNode(t: JiraTab, issue: JiraIssueDetail) {
  const box = tag("div", "orca-jira-desc");
  if (t.editing && t.describe !== null) {
    box.classList.add("editing");
    const bar = tag("div", "orca-jira-edit-bar");
    bar.append(textButton("保存", "orca-jira-save", () => void saveDescription(t), t.writing || !t.describe.ready(), true), textButton("キャンセル", "orca-jira-cancel", () => cancelEdit(t), t.writing));
    box.append(t.describe.el, bar);
    return box;
  }
  if (issue.description !== "") box.append(markdownNode(issue.description));
  const edit = tag("button", "icon-btn orca-jira-desc-edit");
  edit.type = "button";
  edit.setAttribute("aria-label", "説明を編集");
  edit.innerHTML = EDIT_SVG;
  edit.disabled = t.writing;
  edit.onclick = () => void startEdit(t);
  box.append(edit);
  return box;
}

// Under the comments: the button that opens the field of a new comment, or the field with its buttons.
function commentForm(t: JiraTab) {
  const form = tag("div", "orca-jira-comment-form");
  if (t.commenting && t.comment !== null) {
    const submit = textButton("追加", "orca-jira-comment-submit", () => void addComment(t), t.writing || t.comment.blank(), true);
    t.commentSubmit = submit;
    const bar = tag("div", "orca-jira-edit-bar");
    bar.append(submit, textButton("キャンセル", "orca-jira-comment-cancel", () => cancelComment(t), t.writing));
    form.append(t.comment.el, bar);
  } else {
    t.commentSubmit = null;
    form.append(textButton("コメントを追加", "orca-jira-comment-add", () => void startComment(t), t.writing));
  }
  return form;
}

function cancelEdit(t: JiraTab) {
  t.editing = false;
  draw(t);
}

function cancelComment(t: JiraTab) {
  t.commenting = false;
  t.comment?.set("");
  draw(t);
}

function mainNode(t: JiraTab, issue: JiraIssueDetail) {
  const main = tag("div", "orca-jira-main");
  const crumb = tag("div", "orca-jira-crumb");
  if (issue.parent !== null) {
    const parent = span("orca-jira-key orca-jira-crumb-parent", issue.parent.key);
    parent.title = issue.parent.summary;
    crumb.append(parent, span("orca-jira-crumb-sep", "/"));
  }
  crumb.append(span("orca-jira-key orca-jira-crumb-own", issue.key));
  main.append(crumb, tag("h2", "orca-jira-title", issue.summary));
  main.append(descriptionNode(t, issue));
  const comments = tag("section", "orca-jira-comments");
  comments.append(tag("div", "orca-jira-comments-head", `コメント ${issue.comments.length} 件`));
  for (const c of issue.comments) {
    const row = tag("div", "orca-jira-comment");
    const meta = tag("div", "orca-jira-comment-meta");
    meta.append(span("orca-jira-comment-author", c.author), span("orca-jira-comment-time", c.created));
    row.append(meta);
    if (c.body !== "") row.append(markdownNode(c.body));
    comments.append(row);
  }
  if (issue.commentsTruncated) comments.append(tag("p", "orca-file-note", `${issue.comments.length} 件で打ち切りました`));
  comments.append(commentForm(t));
  main.append(comments);
  return main;
}

// The cards of a tab (A-28): the failure of a read, a warning for the sprints of a new ticket. Each is made while the tab holds it, and goes when the tab holds none or is closed.
const noticeKey = (t: JiraTab) => `orca-jira:tab-${t.id}`;
const drawFailure = (t: JiraTab) => setNotice(noticeKey(t), t.phase === "failed" && t.error !== null ? { text: t.error, actions: [{ label: "再読み込み", run: () => void read(t) }] } : null);

// Draws the heading, and the body: the ticket, or a row that waits for the first read; the reason it could not be read is a card.
function draw(t: JiraTab) {
  if (t.fresh !== null) return drawNew(t, t.fresh);
  setNotice(`${noticeKey(t)}:sprints`, null);
  t.head.replaceChildren(span("orca-edit-path", t.key), t.reload);
  t.reload.disabled = t.phase === "loading" || t.writing || t.editing;
  drawFailure(t);
  if (t.phase === "failed" && t.error !== null) return t.body.replaceChildren();
  if (t.issue === null) return t.body.replaceChildren(pending());
  t.body.replaceChildren(mainNode(t, t.issue), sideNode(t, t.issue));
  t.body.scrollTop = t.scroll;
}

// Reads the ticket of the tab. The ticket that was shown stays while the new one is read; a failure drops it and shows its reason as a card (A-28).
async function read(t: JiraTab) {
  // A change that is on its way holds the values of the tab; a read after it shows what Jira has by then.
  if (t.writing) return;
  if (t.fresh !== null) return readOptions(t, t.fresh);
  const seq = ++t.seq;
  t.phase = "loading";
  draw(t);
  try {
    const issue = await invoke("jira_issue", { ...at(t), key: t.key });
    if (seq !== t.seq) return;
    t.issue = issue;
    t.phase = "ready";
    t.error = null;
  } catch (e) {
    if (seq !== t.seq) return;
    t.issue = null;
    t.phase = "failed";
    t.error = String(e);
  }
  draw(t);
}

function create(target: string | null, project: string, key: string, boardId: number): JiraTab {
  const id = `jira:${++lastId}`;
  const el = tag("div", "orca-jira-tab");
  el.dataset.jiraTab = id;
  const head = tag("div", "orca-edit-head orca-jira-tab-head");
  const body = tag("div", "orca-jira-tab-body");
  const reload = tag("button", "icon-btn");
  reload.type = "button";
  reload.setAttribute("aria-label", "読み直す");
  reload.innerHTML = RELOAD_SVG;
  el.append(head, body);
  const t: JiraTab = { id, target, project, key, fresh: null, boardId, phase: "loading", issue: null, error: null, writing: false, editing: false, base: "", describe: null, commenting: false, comment: null, commentSubmit: null, seq: 0, scroll: 0, el, head, body, reload };
  body.onscroll = () => {
    t.scroll = body.scrollTop;
  };
  reload.onclick = () => void read(t);
  if (key === "") t.fresh = newTicket(t);
  tabs.set(id, t);
  return t;
}

// The title of the tab in the strip of the pane.
export const jiraTitleOf = (t: JiraTab) => (t.key === "" ? "新しいチケット" : t.key);

// Told when a new ticket was made, so that the screen selects its tab.
let created: (t: JiraTab) => void = () => {};
export function initJiraTab(on: { created: (t: JiraTab) => void }) {
  created = on.created;
}

function field(name: string, control: HTMLElement) {
  const row = tag("label", "orca-jira-new-field");
  row.append(tag("span", "orca-jira-side-name", name), control);
  return row;
}

function select(label: string, onchange: (value: string) => void) {
  const node = tag("select", "orca-jira-new-select");
  node.setAttribute("aria-label", label);
  node.onchange = () => onchange(node.value);
  return node;
}

// Fills a select with `options` ([value, text]) when they are not the ones it has, and chooses `value`.
function fillSelect(node: HTMLSelectElement, options: [string, string][], value: string) {
  const key = JSON.stringify(options);
  if (node.dataset.options !== key) {
    node.dataset.options = key;
    node.replaceChildren(
      ...options.map(([v, text]) => {
        const option = tag("option", "", text);
        option.value = v;
        return option;
      }),
    );
  }
  node.value = value;
}

// The form of a new ticket: its fields are made once and kept by the tab, so what was typed survives a redraw.
function newTicket(t: JiraTab): NewTicket {
  const summary = tag("input", "orca-jira-new-summary");
  summary.setAttribute("aria-label", "件名");
  summary.setAttribute("autocomplete", "off");
  summary.spellcheck = false;
  summary.oninput = () => syncNew(t);
  summary.onkeydown = (e) => {
    if (e.key === "Enter" && !e.isComposing) void submitNew(t);
  };
  const submit = textButton("作る", "orca-jira-new-submit", () => void submitNew(t), true, true);
  const describe = createRichEditor({ prefix: "orca-jira-new-desc", label: "説明", arrow: false, onChange: () => {}, onSubmit: () => void submitNew(t) });
  const form = tag("div", "orca-jira-new");
  const f: NewTicket = {
    projects: [],
    types: [],
    sprints: [],
    sprintNote: null,
    typing: false,
    projectId: "",
    typeId: "",
    sprintId: null,
    describe,
    form,
    project: select("プロジェクト", (v) => {
      f.projectId = v;
      f.typeId = "";
      void readTypes(t, f);
    }),
    kind: select("種類", (v) => {
      f.typeId = v;
    }),
    sprint: select("スプリント", (v) => {
      f.sprintId = v === "" ? null : Number(v);
    }),
    summary,
    submit,
  };
  const bar = tag("div", "orca-jira-edit-bar");
  bar.append(submit);
  const picks = tag("div", "orca-jira-new-picks");
  picks.append(field("プロジェクト", f.project), field("種類", f.kind), field("スプリント", f.sprint));
  form.append(picks, field("件名", summary), field("説明", describe.el), bar);
  // Milkdown is read the first time an editor is made; the button waits for it.
  describe
    .ensure()
    .then(() => draw(t))
    .catch((e) => showFailure("orca-jira", e));
  return f;
}

// The button that makes the ticket is off while a call is on its way, while the types are read, and while the summary or the type is missing.
function syncNew(t: JiraTab) {
  const f = t.fresh;
  if (f === null) return;
  f.submit.disabled = t.writing || t.phase !== "ready" || f.typing || f.typeId === "" || f.summary.value.trim() === "" || !f.describe.ready();
}

// Draws the heading and the body of the tab of a new ticket: the form, or the reason the options could not be read, or a row that waits for the first read.
function drawNew(t: JiraTab, f: NewTicket) {
  t.head.replaceChildren(span("orca-edit-path", jiraTitleOf(t)), t.reload);
  t.reload.disabled = t.phase === "loading" || t.writing;
  drawFailure(t);
  setNotice(`${noticeKey(t)}:sprints`, f.sprintNote === null ? null : { text: f.sprintNote, warn: true });
  if (t.phase === "failed" && t.error !== null) return t.body.replaceChildren();
  if (f.projects.length === 0) return t.body.replaceChildren(t.phase === "loading" ? pending() : tag("p", "orca-file-note", "作れるプロジェクトがありません"));
  fillSelect(f.project, f.projects.map((p): [string, string] => [p.id, `${p.name} (${p.key})`]), f.projectId);
  fillSelect(f.kind, f.types.map((x): [string, string] => [x.id, x.name]), f.typeId);
  fillSelect(f.sprint, [["", "バックログ"], ...f.sprints.map((s): [string, string] => [String(s.id), s.name])], f.sprintId === null ? "" : String(f.sprintId));
  f.project.disabled = t.writing || t.phase === "loading";
  f.kind.disabled = t.writing || f.typing;
  f.sprint.disabled = t.writing || f.sprintNote !== null;
  f.summary.disabled = t.writing;
  syncNew(t);
  t.body.replaceChildren(f.form);
}

// Reads the issue types of the chosen project. A newer read of the tab drops an older one.
async function readTypes(t: JiraTab, f: NewTicket) {
  const seq = ++t.seq;
  const projectId = f.projectId;
  f.types = [];
  f.typing = projectId !== "";
  draw(t);
  if (projectId === "") return;
  try {
    const types = await invoke("jira_issue_types", { ...at(t), projectId });
    if (seq !== t.seq) return;
    f.types = types;
    f.typeId = types.some((x) => x.id === f.typeId) ? f.typeId : (types[0]?.id ?? "");
  } catch (e) {
    if (seq !== t.seq) return;
    f.typeId = "";
    t.phase = "failed";
    t.error = String(e);
  }
  f.typing = false;
  draw(t);
}

// Reads the projects, the sprints of the board (Jira's refusal of them is kept as a note, and the form goes on) and then the issue types of the project that is chosen. What the form holds is kept.
async function readOptions(t: JiraTab, f: NewTicket) {
  const seq = ++t.seq;
  t.phase = "loading";
  t.error = null;
  draw(t);
  try {
    // The refusal of the sprints is not the failure of the form: a team-managed board with its sprints off has none, and a ticket is made with no sprint.
    const [projects, read] = await Promise.all([invoke("jira_projects", at(t)), invoke("jira_sprints", { ...at(t), boardId: t.boardId }).then((sprints) => ({ sprints, note: null }), (e) => ({ sprints: [] as JiraSprint[], note: String(e) }))]);
    if (seq !== t.seq) return;
    f.projects = projects;
    f.sprints = read.sprints;
    f.sprintNote = read.note;
    if (!projects.some((p) => p.id === f.projectId)) f.projectId = projects[0]?.id ?? "";
    if (f.sprintId !== null && !f.sprints.some((s) => s.id === f.sprintId)) f.sprintId = null;
    t.phase = "ready";
  } catch (e) {
    if (seq !== t.seq) return;
    f.projects = [];
    t.phase = "failed";
    t.error = String(e);
    return draw(t);
  }
  await readTypes(t, f);
}

// Makes the ticket. When Jira refuses, a card shows the reason and the form keeps what was typed; when it makes it, the tab becomes the ticket's tab.
async function submitNew(t: JiraTab) {
  const f = t.fresh;
  if (f === null || t.writing) return;
  syncNew(t);
  if (f.submit.disabled) return;
  t.writing = true;
  f.describe.setBusy(true);
  draw(t);
  let made: JiraCreated;
  try {
    made = await invoke("jira_create_issue", { ...at(t), projectId: f.projectId, issueTypeId: f.typeId, summary: f.summary.value, markdown: f.describe.markdown(), sprintId: f.sprintId });
  } catch (e) {
    t.writing = false;
    f.describe.setBusy(false);
    draw(t);
    return showFailure("orca-jira", e);
  }
  t.writing = false;
  f.describe.setBusy(false);
  t.fresh = null;
  t.key = made.key;
  t.issue = null;
  created(t);
  if (made.sprintError !== null) showFailure("orca-jira", made.sprintError);
  void reloadJiraSections();
  void read(t);
}

// Opens the ticket in a tab of the project (made when there is none) and reads it, and gives the tab and whether it was made now. A ticket that is open already is read again.
export function openJiraTab(target: string | null, project: string, key: string, boardId: number) {
  const held = [...tabs.values()].find((t) => t.target === target && t.project === project && t.key === key);
  const t = held ?? create(target, project, key, boardId);
  t.boardId = boardId;
  void read(t);
  return { tab: t, created: held === undefined };
}

// Opens the tab of a new ticket in the project (the one that is open already is read again), with the board of the list and the sprint it shows. Gives the tab.
export function openNewJiraTab(target: string | null, project: string, boardId: number, sprintId: number | null) {
  const held = [...tabs.values()].find((t) => t.target === target && t.project === project && t.fresh !== null);
  const t = held ?? create(target, project, "", boardId);
  if (t.fresh !== null && (held === undefined || t.boardId !== boardId)) t.fresh.sprintId = sprintId;
  t.boardId = boardId;
  void read(t);
  return t;
}

// The Jira tabs of the project.
export const jiraTabsOf = (target: string | null, project: string) => [...tabs.values()].filter((t) => t.target === target && t.project === project);

// Whether the tab holds a description or a comment that was typed and not saved: the description is being edited, or the comment is being written, and the editor holds some text (J-2, "Closing").
export function hasJiraDraft(id: string) {
  const t = tabs.get(id);
  return t !== undefined && ((t.editing && t.describe !== null && !t.describe.blank()) || (t.commenting && t.comment !== null && !t.comment.blank()));
}

export function closeJiraTab(id: string) {
  const t = tabs.get(id);
  if (!t) return;
  t.seq++;
  setNotice(noticeKey(t), null);
  setNotice(`${noticeKey(t)}:sprints`, null);
  t.el.remove();
  tabs.delete(id);
}

// Shows each tab of `placements` in its host element and takes every other tab out of the page (it keeps what it holds and its scroll).
export function showJiraTabs(placements: { id: string; host: HTMLElement }[]) {
  const shown = new Set(placements.map((p) => p.id));
  for (const [id, t] of tabs) if (!shown.has(id)) t.el.remove();
  for (const { id, host } of placements) {
    const t = tabs.get(id);
    if (!t || t.el.parentElement === host) continue;
    host.replaceChildren(t.el);
    t.body.scrollTop = t.scroll;
  }
}
