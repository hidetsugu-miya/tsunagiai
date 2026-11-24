// The Jira part of the file pane of the Orca screen (J-2, #870): the tickets of the Jira that J-1 connects, by sprint, with the backlog under them. Each ticket is a row of its key, its summary and its status; a ticket that is done (its status category) is struck through. The tickets belong to no worktree, so the part hides the heading of the pane, as the database part does (A-43).
// `jira_settings` is read first (it asks Jira nothing): with no site or no token saved the part says so and leads to the card of the settings (J-1). Then the scrum boards (`jira_boards`: only a scrum board has sprints), the sprints of the board (`jira_sprints`) and, for the sprints that the choice names and for the backlog, the tickets, one section after another (`jira_sprint_issues`, `jira_backlog`). A section reads, fails and is read again on its own.
// A double press on a row opens the ticket as a tab of the work pane (orca-jira-tab.ts).
// Everything is read when the part comes to be shown, when 「再読み込み」 is pressed, and, while the connection is missing or the first read failed, when the window gets the focus back and when the screen is shown again after 「設定を開く」; nothing is read at an interval.
import type { JiraBoard } from "./bindings/JiraBoard";
import type { JiraIssue } from "./bindings/JiraIssue";
import type { JiraSprint } from "./bindings/JiraSprint";
import { $, span, tag } from "./dom.js";
import { logError } from "./error-card.js";
import { RELOAD_SVG } from "./icons.js";
import { invoke } from "./ipc.js";
import { setScreen } from "./nav.js";

// What the part shows: nothing yet, the first read, no connection, a read of the connection or of the boards that failed, or the board with its sections.
type Stage = "idle" | "loading" | "none" | "failed" | "ready";

// A section of the list: the tickets of a sprint (`s{id}`) or the backlog. `state` is where its read is.
interface Section {
  state: "loading" | "done" | "failed";
  issues: JiraIssue[];
  truncated: boolean;
  error: string | null;
}

// A row was pressed twice: the screen opens the ticket as a tab of the work pane (orca-jira-tab.ts, #871).
let openIssue: (key: string) => void = () => {};

const BACKLOG = "backlog";
const ALL = "all";

let stage: Stage = "idle";
let failure = "";
// The scrum boards, the one shown, its sprints (the active one first, as Jira gives them) and the sections read so far.
let boards: JiraBoard[] = [];
let boardId: number | null = null;
let sprints: JiraSprint[] = [];
const sections = new Map<string, Section>();
// The choice of the sprint (the id as text, or `all`) and of the status ("" is every status). They are kept while the part is read again.
let sprintPick = "";
let statusPick = "";
// The newest read: an answer of an older one is dropped.
let seq = 0;
// Whether the part is shown (the pane shown with this part chosen).
let on = false;
// 「設定を開く」 was pressed: the screen reads the connection again when it is shown next.
let toSettings = false;

const sectionKey = (sprint: JiraSprint) => `s${sprint.id}`;

// The sections that are drawn, in order: the sprints that the choice names, then the backlog.
function wantedKeys(): string[] {
  const picked = sprintPick === ALL ? sprints : sprints.filter((s) => String(s.id) === sprintPick);
  return boardId === null ? [] : [...picked.map(sectionKey), BACKLOG];
}

// The statuses of the tickets read so far, in the order they were met, and the chosen one even when no ticket has it now.
function statuses(): string[] {
  const names = new Set<string>();
  for (const s of sections.values()) for (const i of s.issues) names.add(i.status);
  if (statusPick !== "") names.add(statusPick);
  return [...names];
}

// Fills a select with `options` ([value, text]) when they are not the ones it has, and chooses `value`; a select is not rebuilt while it is open.
function fill(select: HTMLSelectElement, options: [string, string][], value: string) {
  const key = JSON.stringify(options);
  if (select.dataset.options !== key) {
    select.dataset.options = key;
    select.replaceChildren(
      ...options.map(([v, text]) => {
        const option = tag("option", "", text);
        option.value = v;
        return option;
      }),
    );
  }
  select.value = value;
}

function drawBar() {
  const ready = stage === "ready";
  const withBoards = boards.length > 1 && (ready || stage === "loading");
  $("orca-jira-board").hidden = !withBoards;
  $("orca-jira-sprint").hidden = !ready || sprints.length === 0;
  $("orca-jira-status").hidden = !ready || statuses().length === 0;
  $("orca-jira-reload").hidden = stage === "idle";
  if (withBoards) fill($<HTMLSelectElement>("orca-jira-board"), boards.map((b) => [String(b.id), b.name]), String(boardId));
  if (ready && sprints.length > 0) fill($<HTMLSelectElement>("orca-jira-sprint"), [[ALL, "すべてのスプリント"], ...sprints.map((s): [string, string] => [String(s.id), s.name])], sprintPick);
  if (ready) fill($<HTMLSelectElement>("orca-jira-status"), [["", "すべてのステータス"], ...statuses().map((s): [string, string] => [s, s])], statusPick);
}

// A row that waits for a read, or that says it failed with the button that tries again.
function pending(text: string, retry?: () => void) {
  const row = tag("div", retry ? "pending fail" : "pending");
  if (!retry) row.append(tag("span", "spin"));
  row.append(tag("span", "sp", text));
  if (retry) {
    const again = tag("button", "text-btn", "再読み込み");
    again.type = "button";
    again.onclick = retry;
    row.append(again);
  }
  return row;
}

function issueRow(issue: JiraIssue) {
  const row = tag("div", "orca-jira-issue");
  row.dataset.key = issue.key;
  row.dataset.category = issue.statusCategory;
  row.ondblclick = () => openIssue(issue.key);
  row.append(span("orca-jira-key", issue.key), span("orca-jira-summary", issue.summary), span("orca-jira-status", issue.status));
  return row;
}

function sectionNode(key: string) {
  const node = tag("section", "orca-jira-section");
  node.dataset.key = key;
  const sprint = sprints.find((s) => sectionKey(s) === key);
  const name = sprint?.name ?? "バックログ";
  node.setAttribute("aria-label", name);
  const head = tag("div", "orca-jira-head");
  head.append(span("orca-jira-name", name));
  if (sprint) head.append(span("orca-jira-state", sprint.state === "active" ? "進行中" : "予定"));
  const section = sections.get(key);
  const rows = section?.issues.filter((i) => statusPick === "" || i.status === statusPick) ?? [];
  if (section?.state === "done") head.append(span("orca-jira-count", `${rows.length} 件`));
  node.append(head);
  if (section === undefined || section.state === "loading") node.append(pending("読み込んでいます…"));
  else if (section.state === "failed") node.append(pending(section.error ?? "", () => void readSection(seq, key)));
  else {
    node.append(...rows.map(issueRow));
    if (section.truncated) node.append(tag("p", "orca-file-note", `${section.issues.length} 件で打ち切りました`));
  }
  return node;
}

function drawList() {
  const list = $("orca-jira-list");
  if (stage === "idle") return list.replaceChildren();
  if (stage === "loading") return list.replaceChildren(pending("読み込んでいます…"));
  if (stage === "failed") return list.replaceChildren(pending(failure, () => void read()));
  if (stage === "none") {
    const box = tag("div", "orca-jira-none", "Jira に接続されていません");
    const open = tag("button", "text-btn", "設定を開く");
    open.type = "button";
    open.onclick = () => {
      toSettings = true;
      setScreen("settings", "orca");
    };
    box.append(open);
    return list.replaceChildren(box);
  }
  if (boardId === null) return list.replaceChildren(tag("div", "orca-jira-none", "スクラムボードがありません"));
  list.replaceChildren(...wantedKeys().map(sectionNode));
}

const draw = () => {
  drawBar();
  drawList();
};

// Reads the tickets of the section `key`, which the run `run` asked for; an answer of another run is dropped.
async function readSection(run: number, key: string) {
  const id = boardId;
  if (id === null) return;
  sections.set(key, { state: "loading", issues: [], truncated: false, error: null });
  draw();
  try {
    const read = key === BACKLOG ? await invoke("jira_backlog", { boardId: id }) : await invoke("jira_sprint_issues", { sprintId: Number(key.slice(1)) });
    if (run !== seq) return;
    sections.set(key, { state: "done", issues: read.issues, truncated: read.truncated, error: null });
  } catch (e) {
    if (run !== seq) return;
    logError("orca-jira", e);
    sections.set(key, { state: "failed", issues: [], truncated: false, error: String(e) });
  }
  draw();
}

// Reads the sections that are wanted and not asked for yet, one after another. A second call (a new choice of the sprint) takes the sections that the first has not reached.
async function readSections(run: number) {
  for (let key = wantedKeys().find((k) => !sections.has(k)); key !== undefined && run === seq; key = wantedKeys().find((k) => !sections.has(k))) await readSection(run, key);
}

// Reads the sprints of the board `boardId` and then its sections.
async function readBoard(run: number) {
  sprints = [];
  sections.clear();
  if (boardId === null) {
    stage = "ready";
    return draw();
  }
  stage = "loading";
  draw();
  try {
    const read = await invoke("jira_sprints", { boardId });
    if (run !== seq) return;
    sprints = read;
  } catch (e) {
    if (run !== seq) return;
    logError("orca-jira", e);
    failure = String(e);
    stage = "failed";
    return draw();
  }
  if (sprintPick !== ALL && !sprints.some((s) => String(s.id) === sprintPick)) sprintPick = sprints.length > 0 ? String(sprints[0].id) : ALL;
  stage = "ready";
  draw();
  await readSections(run);
}

// Reads the connection, the boards and the board that is shown, from the start.
async function read() {
  const run = ++seq;
  toSettings = false;
  stage = "loading";
  sections.clear();
  draw();
  try {
    const settings = await invoke("jira_settings");
    if (run !== seq) return;
    if (settings.site === "" || !settings.hasToken) {
      stage = "none";
      return draw();
    }
    const all = await invoke("jira_boards");
    if (run !== seq) return;
    boards = all.filter((b) => b.type === "scrum");
    if (!boards.some((b) => b.id === boardId)) boardId = boards[0]?.id ?? null;
  } catch (e) {
    if (run !== seq) return;
    logError("orca-jira", e);
    failure = String(e);
    stage = "failed";
    return draw();
  }
  await readBoard(run);
}

// Told whether the part is shown: it reads when it comes to be shown, and when the screen is shown again after the press on 「設定を開く」.
export function syncOrcaJira(shown: boolean) {
  const back = shown && toSettings && !$("orca").hidden;
  if (shown && (!on || back)) void read();
  on = shown;
}

// The window got the focus back: a connection that was missing, or a first read that failed, is tried again.
export function refreshOrcaJira() {
  if (stage === "none" || stage === "failed") void read();
}

export function initOrcaJira(on: { open: (key: string) => void }) {
  openIssue = on.open;
  $("orca-jira-reload").innerHTML = RELOAD_SVG;
  $("orca-jira-reload").onclick = () => void read();
  $<HTMLSelectElement>("orca-jira-board").onchange = (e) => {
    boardId = Number((e.target as HTMLSelectElement).value);
    sprintPick = "";
    void readBoard(++seq);
  };
  $<HTMLSelectElement>("orca-jira-sprint").onchange = (e) => {
    sprintPick = (e.target as HTMLSelectElement).value;
    draw();
    void readSections(seq);
  };
  $<HTMLSelectElement>("orca-jira-status").onchange = (e) => {
    statusPick = (e.target as HTMLSelectElement).value;
    draw();
  };
}
