// The Jira ticket tab of the work pane of the Orca screen (J-2, #871): a ticket of the list in the right pane (orca-jira.ts), opened by a double press as a tab like the tab of a diff (A-24). The body is the ticket's key (with its parent's), its summary, its description and its comments, and the right column holds its status, assignee, sprint, priority, labels and parent; it only shows them.
// The tabs are kept in memory only, by target and project, as the tabs of the files and the diffs are (their ids are `jira:{n}`). Rust reads the ticket (`jira_issue`) and gives the description and the comments as Markdown (read from Jira's ADF), which the page draws through `markdownHtml` (it keeps only what a Todoist comment may keep). A ticket is read when its tab is opened and again by the button 「読み直す」, never by the clock; a read that ends after its tab was closed, or after a newer read began, is dropped.
import type { JiraIssueDetail } from "./bindings/JiraIssueDetail";
import { span, tag } from "./dom.js";
import { logError } from "./error-card.js";
import { RELOAD_SVG } from "./icons.js";
import { invoke } from "./ipc.js";
import { markdownHtml } from "./todo-data.js";

export interface JiraTab {
  id: string;
  target: string | null;
  project: string;
  key: string;
  phase: "loading" | "ready" | "failed";
  issue: JiraIssueDetail | null;
  error: string | null;
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

function pending() {
  const row = tag("div", "pending");
  row.append(tag("span", "spin"), tag("span", "sp", "読み込んでいます…"));
  return row;
}

// A line of the right column: its name and its value, which is `none` in gray when there is nothing.
function sideRow(name: string, value: Node | string | null, none: string) {
  const row = tag("div", "orca-jira-side-row");
  const text = tag("div", "orca-jira-side-value");
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

function sideNode(issue: JiraIssueDetail) {
  const side = tag("aside", "orca-jira-side");
  const status = span("orca-jira-pill", issue.status);
  status.dataset.category = issue.statusCategory;
  const labels = tag("div", "orca-jira-labels");
  labels.append(...issue.labels.map((l) => span("orca-jira-label", l)));
  let parent: HTMLElement | null = null;
  if (issue.parent !== null) {
    parent = tag("div", "orca-jira-parent");
    parent.append(span("orca-jira-key", issue.parent.key), span("orca-jira-parent-summary", issue.parent.summary));
  }
  side.append(sideRow("ステータス", issue.status === "" ? null : status, "なし"), sideRow("担当", issue.assignee, "未割り当て"), sideRow("スプリント", issue.sprint, "なし"), sideRow("優先度", issue.priority, "なし"), sideRow("ラベル", issue.labels.length === 0 ? null : labels, "なし"), sideRow("親", parent, "なし"));
  return side;
}

function mainNode(issue: JiraIssueDetail) {
  const main = tag("div", "orca-jira-main");
  const crumb = tag("div", "orca-jira-crumb");
  if (issue.parent !== null) {
    const parent = span("orca-jira-key orca-jira-crumb-parent", issue.parent.key);
    parent.title = issue.parent.summary;
    crumb.append(parent, span("orca-jira-crumb-sep", "/"));
  }
  crumb.append(span("orca-jira-key orca-jira-crumb-own", issue.key));
  main.append(crumb, tag("h2", "orca-jira-title", issue.summary));
  if (issue.description !== "") main.append(markdownNode(issue.description));
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
  main.append(comments);
  return main;
}

// Draws the heading, and the body: the ticket, the reason it could not be read, or a row that waits for the first read.
function draw(t: JiraTab) {
  t.head.replaceChildren(span("orca-edit-path", t.key), t.reload);
  t.reload.disabled = t.phase === "loading";
  if (t.phase === "failed" && t.error !== null) return t.body.replaceChildren(tag("p", "orca-file-note fail", t.error));
  if (t.issue === null) return t.body.replaceChildren(pending());
  t.body.replaceChildren(mainNode(t.issue), sideNode(t.issue));
  t.body.scrollTop = t.scroll;
}

// Reads the ticket of the tab. The ticket that was shown stays while the new one is read; a failure drops it and shows its reason, and writes it to the log (A-28), with no card.
async function read(t: JiraTab) {
  const seq = ++t.seq;
  t.phase = "loading";
  draw(t);
  try {
    const issue = await invoke("jira_issue", { key: t.key });
    if (seq !== t.seq) return;
    t.issue = issue;
    t.phase = "ready";
    t.error = null;
  } catch (e) {
    if (seq !== t.seq) return;
    logError("orca-jira", e);
    t.issue = null;
    t.phase = "failed";
    t.error = String(e);
  }
  draw(t);
}

function create(target: string | null, project: string, key: string): JiraTab {
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
  const t: JiraTab = { id, target, project, key, phase: "loading", issue: null, error: null, seq: 0, scroll: 0, el, head, body, reload };
  body.onscroll = () => {
    t.scroll = body.scrollTop;
  };
  reload.onclick = () => void read(t);
  tabs.set(id, t);
  return t;
}

// Opens the ticket in a tab of the project (made when there is none) and reads it, and gives the tab and whether it was made now. A ticket that is open already is read again.
export function openJiraTab(target: string | null, project: string, key: string) {
  const held = [...tabs.values()].find((t) => t.target === target && t.project === project && t.key === key);
  const t = held ?? create(target, project, key);
  void read(t);
  return { tab: t, created: held === undefined };
}

// The Jira tabs of the project.
export const jiraTabsOf = (target: string | null, project: string) => [...tabs.values()].filter((t) => t.target === target && t.project === project);

export function closeJiraTab(id: string) {
  const t = tabs.get(id);
  if (!t) return;
  t.seq++;
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
