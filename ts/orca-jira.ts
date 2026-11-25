// The Jira part of the file pane of the Orca screen (J-2, #870): the tickets of the Jira that J-1 connects, by sprint, with the backlog under them. Each ticket is a row of its key, its summary and its status; a ticket that is done (its status category) is struck through. The tickets belong to no worktree, so the part hides the heading of the pane, as the database part does (A-43).
// The part follows the project of the worktree that the pane shows (`Place`: its target and its project key, #1394): every command takes them, so the connection that is read is the project's own, and another project reads everything again from the start.
// `jira_settings` is read first (it asks Jira nothing): with no site or no token saved the part shows the form of the connection in its place (J-1, #1395: the site's URL, the email address, the API token, 「保存」 and 「接続を試す」), and a saved connection is changed or deleted with the gear of the bar, which opens the same form. Then the boards (`jira_boards`: the scrum ones and the team-managed ones, `simple`; a kanban board is left out), the sprints of the board (`jira_sprints`; a team-managed board whose sprints are off is Jira's refusal, drawn in the place of the sprints) and, for the sprints that the choice names and for the backlog, the tickets, one section after another (`jira_sprint_issues`, `jira_backlog`). The board that is chosen is saved for the project (`jira_set_board`) and shown the next time. A section reads, fails and is read again on its own.
// While the form is shown for a project with no connection (not from the gear), the connections of the other projects stand above it, one row each with 「使う」 (J-1, #1425): `jira_connections` is read when that form is shown, and `jira_copy` makes the project's connection of the row's. A failed read leaves no row and goes to the log only.
// A double press on a row opens the ticket as a tab of the work pane (orca-jira-tab.ts), and 「＋」 opens the tab of a new ticket (#874).
// Everything is read when the part comes to be shown, when 「再読み込み」 is pressed, after a save of the connection, and, while the first read failed, when the window gets the focus back; nothing is read at an interval.
import type { JiraBoard } from "./bindings/JiraBoard";
import type { JiraConnection } from "./bindings/JiraConnection";
import type { JiraIssue } from "./bindings/JiraIssue";
import type { JiraSettings } from "./bindings/JiraSettings";
import type { JiraSprint } from "./bindings/JiraSprint";
import { $, span, tag } from "./dom.js";
import { logError, showFailure } from "./error-card.js";
import { PLUS_SVG, RELOAD_SVG, SETTINGS_SVG } from "./icons.js";
import { invoke } from "./ipc.js";
import { listedProjectName, THIS_MACHINE } from "./orca.js";

// What the part shows: nothing yet, the first read, no connection, a read of the connection or of the boards that failed, or the board with its sections.
type Stage = "idle" | "loading" | "none" | "failed" | "ready";

// A section of the list: the tickets of a sprint (`s{id}`) or the backlog. `state` is where its read is.
interface Section {
  state: "loading" | "done" | "failed";
  issues: JiraIssue[];
  truncated: boolean;
  error: string | null;
}

// A row was pressed twice: the screen opens the ticket as a tab of the work pane (orca-jira-tab.ts, #871), with the board the list shows (the sprints that the tab offers are the board's).
let openIssue: (key: string, boardId: number) => void = () => {};
// 「＋」 was pressed (#874): the screen opens the tab of a new ticket, with the board the list shows and the sprint it has chosen (none for the backlog).
let newIssue: (boardId: number, sprintId: number | null) => void = () => {};

// Whose connection the part reads: the environment (null for this machine) and the key of the project, as the commands take them.
export interface JiraPlace {
  environment: string | null;
  project: string;
}

const BACKLOG = "backlog";
const ALL = "all";

let stage: Stage = "idle";
let failure = "";
// The project shown (null: the pane has no worktree, so none).
let place: JiraPlace | null = null;
// The connection of the project as last read (never the token), null until the first read.
let conn: JiraSettings | null = null;
// The form of the connection: opened by the gear (it is shown whatever this is while no connection is saved), the key of the project whose values it holds, and what the last test or read of it says.
let formOpen = false;
let filledFor: string | null = null;
let connState: { kind: "ok" | "warn"; text: string; user: string } | null = null;
// The connections of the other projects that the form offers to copy, and whether a copy is on its way.
let copies: JiraConnection[] = [];
let copying = false;
// The boards that are shown (the scrum ones and the team-managed ones), the one shown, its sprints (the active one first, as Jira gives them), Jira's refusal of the sprints of a board that has none, and the sections read so far.
let boards: JiraBoard[] = [];
let boardId: number | null = null;
let sprints: JiraSprint[] = [];
let sprintNote: string | null = null;
const sections = new Map<string, Section>();
// The choice of the sprint (the id as text, or `all`) and of the status ("" is every status). They are kept while the part is read again.
let sprintPick = "";
let statusPick = "";
// The newest read: an answer of an older one is dropped.
let seq = 0;
// Whether the part is shown (the pane shown with this part chosen).
let on = false;

const sectionKey = (sprint: JiraSprint) => `s${sprint.id}`;

// A connection is saved when it has a site and a token.
const registered = (s: JiraSettings | null) => s !== null && s.site !== "" && s.hasToken;
// The form of the connection takes the place of the bar and the list while no connection is saved, and when the gear opened it.
const formShown = () => stage === "none" || formOpen;
const keyOf = (p: JiraPlace) => JSON.stringify([p.environment, p.project]);
const input = (id: string) => $<HTMLInputElement>(id);

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
  $("orca-jira-bar").hidden = formShown();
  $("orca-jira-config").hidden = !registered(conn);
  const ready = stage === "ready";
  const withBoards = boards.length > 1 && (ready || stage === "loading");
  $("orca-jira-board").hidden = !withBoards;
  $("orca-jira-sprint").hidden = !ready || sprints.length === 0;
  $("orca-jira-status").hidden = !ready || statuses().length === 0;
  $("orca-jira-reload").hidden = stage === "idle";
  $("orca-jira-new").hidden = !ready || boardId === null;
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
  row.ondblclick = () => boardId !== null && openIssue(issue.key, boardId);
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
  if (stage === "none") return list.replaceChildren();
  if (boardId === null) return list.replaceChildren(tag("div", "orca-jira-none", "スクラムボードがありません"));
  list.replaceChildren(...(sprintNote === null ? [] : [tag("p", "orca-file-note fail orca-jira-sprint-note", sprintNote)]), ...wantedKeys().map(sectionNode));
}

// The form of the connection: shown or not, the buttons that only a saved connection has, and the state that the last read or test left.
function drawForm() {
  const open = formShown();
  const saved = registered(conn);
  $("orca-jira-conn").hidden = !open;
  $("orca-jira-list").hidden = open;
  $("orca-jira-delete").hidden = !saved;
  $("orca-jira-close").hidden = !saved;
  $("orca-jira-conn-state").hidden = connState === null;
  if (connState === null) return;
  $("orca-jira-conn-status").className = `status ${connState.kind}`;
  $("orca-jira-conn-status").textContent = connState.text;
  $("orca-jira-conn-user").textContent = connState.user;
  $("orca-jira-conn-user").hidden = connState.user === "";
}

// The rows of the connections to copy, above the form, while the project has no connection; with no row there is no separator either.
function drawCopies() {
  const box = $("orca-jira-copy");
  box.hidden = stage !== "none" || copies.length === 0;
  if (box.hidden) return box.replaceChildren();
  box.replaceChildren(...copies.map(copyRow), tag("div", "orca-jira-copy-sep", "新しく入力"));
}

function copyRow(from: JiraConnection) {
  const row = tag("div", "orca-jira-copy-row");
  const name = tag("div", "orca-jira-copy-name", listedProjectName(from.environment, from.project) ?? from.project);
  name.append(span("orca-jira-copy-chip", from.environment ?? THIS_MACHINE));
  const text = tag("div", "orca-jira-copy-text");
  text.append(name, tag("div", "orca-jira-copy-meta", [from.site.replace(/^https:\/\//, ""), from.email].filter((s) => s !== "").join(" ・ ")));
  const use = tag("button", "text-btn", "使う");
  use.type = "button";
  use.disabled = copying;
  use.onclick = () => void copyFrom(from);
  row.append(text, use);
  return row;
}

const draw = () => {
  drawBar();
  drawForm();
  drawList();
  drawCopies();
};

// Puts what is saved into the form (the token is never given, so its field is empty) and the state that goes with it.
function fillForm(here: JiraPlace, saved: JiraSettings | null) {
  filledFor = keyOf(here);
  input("orca-jira-site").value = saved?.site ?? "";
  input("orca-jira-email").value = saved?.email ?? "";
  input("orca-jira-token").value = "";
  connState = registered(saved) ? { kind: "ok", text: "保存済み", user: "" } : null;
}

// Keeps the buttons of the form off while a call of it is on its way.
function formBusy(busy: boolean) {
  for (const id of ["orca-jira-save", "orca-jira-test", "orca-jira-delete", "orca-jira-close"]) $<HTMLButtonElement>(id).disabled = busy;
}

// 「保存」: saves the connection of the project (an empty token keeps the stored one) and reads the boards with it.
async function save() {
  const here = place;
  if (here === null) return;
  const token = input("orca-jira-token");
  const values = { site: input("orca-jira-site").value, email: input("orca-jira-email").value, token: token.value };
  token.value = "";
  formBusy(true);
  let saved: JiraSettings;
  try {
    saved = await invoke("jira_save", { ...here, ...values });
  } catch (e) {
    showFailure("orca-jira", e);
    return formBusy(false);
  }
  formBusy(false);
  if (place !== here) return;
  conn = saved;
  formOpen = false;
  boardId = null;
  filledFor = null;
  connState = null;
  void load(++seq, here, saved);
}

// Reads the connections that the project may copy (the project's own is left out). The run `run` asked for it; an answer of another run is dropped.
async function readCopies(run: number, here: JiraPlace) {
  copies = [];
  try {
    const all = await invoke("jira_connections");
    if (run !== seq) return;
    copies = all.filter((c) => c.environment !== here.environment || c.project !== here.project);
  } catch (e) {
    if (run !== seq) return;
    logError("orca-jira", e);
  }
  drawCopies();
}

// 「使う」: Rust makes the connection of the project from the one of the row (the token stays in the keychain), and the part goes on as after 「保存」.
async function copyFrom(from: JiraConnection) {
  const here = place;
  if (here === null) return;
  setCopying(true);
  let saved: JiraSettings;
  try {
    saved = await invoke("jira_copy", { ...here, fromEnvironment: from.environment, fromProject: from.project });
  } catch (e) {
    showFailure("orca-jira", e);
    return setCopying(false);
  }
  setCopying(false);
  if (place !== here) return;
  conn = saved;
  formOpen = false;
  boardId = null;
  filledFor = null;
  connState = null;
  copies = [];
  void load(++seq, here, saved);
}

// Keeps the buttons of the rows and of the form off while a copy is on its way.
function setCopying(busy: boolean) {
  copying = busy;
  formBusy(busy);
  for (const button of document.querySelectorAll<HTMLButtonElement>("#orca-jira-copy .text-btn")) button.disabled = busy;
}

// 「接続を試す」: asks Jira who the credential of the form is, and saves nothing.
async function test() {
  const here = place;
  if (here === null) return;
  const token = input("orca-jira-token");
  const values = { site: input("orca-jira-site").value, email: input("orca-jira-email").value, token: token.value };
  token.value = "";
  formBusy(true);
  try {
    const user = await invoke("jira_test", { ...here, ...values });
    if (place !== here) return;
    connState = { kind: "ok", text: "接続できました", user: [user.displayName, user.emailAddress].filter((s) => s).join(" ・ ") };
  } catch (e) {
    if (place !== here) return;
    showFailure("orca-jira", e);
    connState = { kind: "warn", text: "接続できません", user: "" };
  } finally {
    formBusy(false);
  }
  drawForm();
}

// 「削除」: deletes the connection of the project with its token, and shows the empty form.
async function remove() {
  const here = place;
  if (here === null) return;
  formBusy(true);
  try {
    await invoke("jira_delete", here);
    if (place !== here) return;
    seq++;
    conn = null;
    formOpen = false;
    boardId = null;
    boards = [];
    sprints = [];
    sprintNote = null;
    sections.clear();
    fillForm(here, null);
    stage = "none";
    draw();
    void readCopies(seq, here);
  } catch (e) {
    showFailure("orca-jira", e);
  } finally {
    formBusy(false);
  }
}

// Reads the tickets of the section `key`, which the run `run` asked for; an answer of another run is dropped.
async function readSection(run: number, key: string) {
  const id = boardId;
  const here = place;
  if (id === null || here === null) return;
  sections.set(key, { state: "loading", issues: [], truncated: false, error: null });
  draw();
  try {
    const read = key === BACKLOG ? await invoke("jira_backlog", { ...here, boardId: id }) : await invoke("jira_sprint_issues", { ...here, sprintId: Number(key.slice(1)) });
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
  if (boardId === null || place === null) {
    stage = "ready";
    return draw();
  }
  stage = "loading";
  sprintNote = null;
  draw();
  try {
    const read = await invoke("jira_sprints", { ...place, boardId });
    if (run !== seq) return;
    sprints = read;
  } catch (e) {
    if (run !== seq) return;
    // A team-managed board with its sprints off is Jira's refusal: its words stand in the place of the sprints, and the backlog is still read.
    if (boards.find((b) => b.id === boardId)?.type === "simple") sprintNote = String(e);
    else {
      logError("orca-jira", e);
      failure = String(e);
      stage = "failed";
      return draw();
    }
  }
  if (sprintPick !== ALL && !sprints.some((s) => String(s.id) === sprintPick)) sprintPick = sprints.length > 0 ? String(sprints[0].id) : ALL;
  stage = "ready";
  draw();
  await readSections(run);
}

// Reads the boards of a saved connection and the board that is shown (the one saved for the project, else the first), and then its sprints and sections; with no connection saved, shows the form of it.
async function load(run: number, here: JiraPlace, settings: JiraSettings) {
  conn = settings;
  if (!registered(settings)) {
    stage = "none";
    if (filledFor !== keyOf(here)) fillForm(here, settings);
    draw();
    return void readCopies(run, here);
  }
  try {
    const all = await invoke("jira_boards", here);
    if (run !== seq) return;
    boards = all.filter((b) => b.type === "scrum" || b.type === "simple");
    if (!boards.some((b) => b.id === boardId)) boardId = boards.find((b) => b.id === settings.boardId)?.id ?? boards[0]?.id ?? null;
  } catch (e) {
    if (run !== seq) return;
    logError("orca-jira", e);
    failure = String(e);
    stage = "failed";
    return draw();
  }
  await readBoard(run);
}

// Reads the connection, the boards and the board that is shown, from the start.
async function read() {
  const run = ++seq;
  sections.clear();
  const here = place;
  if (here === null) {
    stage = "idle";
    return draw();
  }
  stage = "loading";
  draw();
  let settings: JiraSettings;
  try {
    settings = await invoke("jira_settings", here);
  } catch (e) {
    if (run !== seq) return;
    logError("orca-jira", e);
    failure = String(e);
    stage = "failed";
    return draw();
  }
  if (run !== seq) return;
  await load(run, here, settings);
}

// Told whether the part is shown and which project it is for (null: no worktree): it reads when it comes to be shown and when the project changes. Another project forgets the connection, the form, the board and the choices of the one before.
export function syncOrcaJira(shown: boolean, next: JiraPlace | null) {
  const moved = next?.environment !== place?.environment || next?.project !== place?.project;
  if (moved) {
    place = next;
    conn = null;
    formOpen = false;
    filledFor = null;
    connState = null;
    copies = [];
    for (const id of ["orca-jira-site", "orca-jira-email", "orca-jira-token"]) input(id).value = "";
    boardId = null;
    sprintNote = null;
    sprintPick = "";
    statusPick = "";
    boards = [];
    sprints = [];
    sections.clear();
    seq++;
    stage = "idle";
    draw();
  }
  if (shown && (!on || moved)) void read();
  on = shown;
}

// A ticket was changed in its tab (#872): its rows take the new values.
export function applyJiraChange(key: string, patch: Partial<JiraIssue>) {
  for (const s of sections.values()) for (const i of s.issues) if (i.key === key) Object.assign(i, patch);
  draw();
}

// A ticket changed its sprint in its tab (#872): where it stands is Jira's, so the sections that were read are read again. A part that is not shown reads everything when it is shown.
export async function reloadJiraSections() {
  if (!on || stage !== "ready") return;
  const run = seq;
  for (const key of [...sections.keys()]) if (run === seq) await readSection(run, key);
}

// The window got the focus back: a first read that failed is tried again.
export function refreshOrcaJira() {
  if (stage === "failed") void read();
}

export function initOrcaJira(on: { open: (key: string, boardId: number) => void; create: (boardId: number, sprintId: number | null) => void }) {
  openIssue = on.open;
  newIssue = on.create;
  $("orca-jira-new").innerHTML = PLUS_SVG;
  $("orca-jira-new").onclick = () => boardId !== null && newIssue(boardId, sprints.some((s) => String(s.id) === sprintPick) ? Number(sprintPick) : null);
  $("orca-jira-reload").innerHTML = RELOAD_SVG;
  $("orca-jira-reload").onclick = () => void read();
  $<HTMLSelectElement>("orca-jira-board").onchange = (e) => {
    boardId = Number((e.target as HTMLSelectElement).value);
    sprintPick = "";
    void readBoard(++seq);
    // The board is kept for the project, and the next read shows it again.
    const here = place;
    if (here === null) return;
    invoke("jira_set_board", { ...here, boardId }).then(
      (s) => {
        if (place === here) conn = s;
      },
      (err) => showFailure("orca-jira", err),
    );
  };
  $("orca-jira-config").innerHTML = SETTINGS_SVG;
  $("orca-jira-config").onclick = () => {
    if (place !== null) fillForm(place, conn);
    formOpen = true;
    draw();
  };
  $("orca-jira-close").onclick = () => {
    formOpen = false;
    draw();
  };
  $("orca-jira-conn").onsubmit = (e) => {
    e.preventDefault();
    void save();
  };
  $("orca-jira-test").onclick = () => void test();
  $("orca-jira-delete").onclick = () => void remove();
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
