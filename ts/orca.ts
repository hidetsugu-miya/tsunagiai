// The Orca screen (A-6, A-8, A-12, A-16, A-17, A-18, A-27): two panes, and the file pane on the right (orca-files.ts, with the history of A-27 in orca-history.ts) when it is shown. The list pane is the projects (a repository of this machine or of a saved environment), each with the rows of its worktrees;
// the work pane has the sessions of the selected project as tabs, and each tab is a terminal (orca-terminal.ts). The work pane is split into panes (A-17), each with its tabs and its terminal; Rust holds how it is split for each project (orca-panes.ts), and the selected tab is the one shown in the pane that has the focus.
// A file opened from the file pane is a tab of the strip too, with its editor (orca-editor.ts) in the pane where a terminal would be, and so is the difference of a file from HEAD (A-24, orca-diff.ts), from the menu of the file's row, or of a file of a commit (A-27), from the history, and the definition of a name of the editor (A-34, orca-definition.ts), one tab for a project, that opens in a pane under the pane of the editor, and so are a table and the SQL of a database from the database part of the file pane (A-43, orca-database-tabs.ts).
// The plus right after the tabs of a pane's strip starts Claude or another AI CLI of the place (A-16), or opens a terminal, in a worktree of the selected project, and the new tab is selected once it is listed. Nothing about a session is kept here.
// A saved environment streams the list (`orca_stream_open`: Orca sends each change, and Rust reads the worktrees again every 10 seconds and after a switch of the branch) and nothing here reads it by the clock. This machine's Orca streams it too once the owner has paired the app with it (the card 「このマシンの Orca」 of the settings, `ts/orca-pairing-settings.ts`, which calls `pairingChanged`), also while a saved environment is the target: each place has its stream (A-33);
// without a pairing, or while its stream cannot connect, this machine's list is read every 10 seconds while the screen is shown and every 60 seconds otherwise, one read at a time, and its terminals are mirrors,
// and no more once the `orca` command was found missing (showing the screen reads again). Only the first read, the screen being shown, a change of the target and a read after a failure ask for the environments.
// The sidebar button's count is the agents that wait for the user plus the notices: the agents that stopped (done, failed, interrupted) while the app ran, until their session is shown on this screen, they run again or they leave the list (the first read of a target only sets the base).
// While an agent works, the button's icon is yellow and fades slowly; the number that work is only in the button's label.
// A search field in the row of the heading 「プロジェクト」 (A-19), opened by the magnifier at the right end of the row or by ⌘J, narrows the projects by name.
// The bell in that row (A-8) switches the list to the work: the sessions of every project, the newest change first, each with the pin and the pencil of its title; while a search text is typed the list is the projects again.
// While the screen is shown and the window is not hidden, the clock also reads again, every 10 seconds, the files and differences that the panes show, and, while the file pane is shown, what the file pane shows (`rereadFiles`; A-18, A-24, A-27), without a word; the files and the tree of a worktree whose disk is watched and ready (`orca-watch.ts`, A-18) are read when the watch tells a change, not by the clock, which asks only the marks of the tree (A-39).
// A read in the background swaps the rows in place: the selection and the scroll position stay, and `show()` is never called by it.
import type { DatabaseProfileView } from "./bindings/DatabaseProfileView";
import type { OrcaAgent } from "./bindings/OrcaAgent";
import type { OrcaLocal } from "./bindings/OrcaLocal";
import type { OrcaOverview } from "./bindings/OrcaOverview";
import type { OrcaProject } from "./bindings/OrcaProject";
import type { OrcaRow } from "./bindings/OrcaRow";
import type { OrcaStarted } from "./bindings/OrcaStarted";
import type { OrcaStatus } from "./bindings/OrcaStatus";
import type { OrcaStreamEvent } from "./bindings/OrcaStreamEvent";
import type { OrcaTerminal } from "./bindings/OrcaTerminal";
import type { OrcaWorktree } from "./bindings/OrcaWorktree";
import type { PaneNode } from "./bindings/PaneNode";
import type { PaneOp } from "./bindings/PaneOp";
import type { PopoutTab } from "./bindings/PopoutTab";
import { $, composing, isMac, partMatcher, tag } from "./dom.js";
import { periodMs } from "./e2e-timers.js";
import { currentFormation, deselectFormation, isChildFolder, isChildSession, isChildWorktree, readForChoice } from "./formation-list.js";
import { AGENT_SVG, CHEVRON_SVG, CLAUDE_SVG, CLOSE_SVG, COLUMNS_SVG, COPY_PATH_SVG, FORMATION_SVG, POPOUT_SVG, ROWS_SVG, SCRATCHPAD_SVG, TERMINAL_SVG, withClass } from "./icons.js";
import { invoke } from "./ipc.js";
import { drawListToggle, listToggle } from "./list-toggle.js";
import { closeMenu, type MenuItem, openMenu, showMenu } from "./menu.js";
import { screenOn, whileOn } from "./menu-state.js";
import { confirmCloseDraft } from "./hint.js";
import { currentScreen, setScreen } from "./nav.js";
import { closeDefinition, type DefinitionOpen, type DefinitionQuery, definitionsOf, hasDefinitionIn, initDefinition, openDefinition, showDefinitions } from "./orca-definition.js";
import { openAddProject } from "./orca-add.js";
import { closeTodoTab, initOrcaTodo, openTodoTab as openTaskTab, showTodoTabs, todoTabsOf, todoTitleOf } from "./orca-todo.js";
import { todoState } from "./todo-data.js";
import { closeJiraTab, hasJiraDraft, initJiraTab, jiraTabsOf, jiraTitleOf, openJiraTab, openNewJiraTab, showJiraTabs } from "./orca-jira-tab.js";
import { closeConnectionTabs, closeDatabaseTab, conditionOf, databaseTabsOf, initDatabaseTabs, openQuery, openTable, showDatabaseTabs } from "./orca-database-tabs.js";
import { initOrcaDatabase, lostConnection } from "./orca-database.js";
import { closeDiff, type DiffCommit, diffsOf, hasDiffIn, openDiff as openDiffTab, refreshDiffs, showDiffs } from "./orca-diff.js";
import { closeFile, dirtyIds, discardFiles, filesOf, goTo, hasFileIn, holdFiles, initOrcaEditor, nameOf, openedIn, openFile as openFileHere, refreshEditors, resolveServers, saveFile, showEditors } from "./orca-editor.js";
import { ensureServer, initLsp, mayAsk, pauseLsp, syncServers } from "./orca-lsp.js";
import { type FilesMode, filesShown, initOrcaFiles, openFilesAs, openFolders, refreshFiles, rereadChanges, rereadScratchpad, syncFiles, toggleFiles, treeWatch } from "./orca-files.js";
import { syncFileWatches, unwatched, watchReady } from "./orca-watch.js";
import { type PaneModel, drawTree, editorHostOf, initPaneTree, type TreeModel } from "./orca-pane-tree.js";
import { applyLocal, findTab, focusedTab, layoutOf, needsSync, type PaneTabs, panesOf, syncPanes } from "./orca-panes.js";
import { closePeek, drawPeek, initPeek, openPeek, peeking } from "./orca-peek.js";
import { awayFile, awayFileIn, awayIn, focusPopout, initPopout, initWorkTodoPopout, isAway, popOut, syncPopouts } from "./orca-popout.js";
import { databaseIcon, definitionIcon, diffIcon, fileIcon, lockIcon, STATUS_LABELS, statusIcon, ticketIcon, todoIcon } from "./orca-status.js";
import { openScratchpad } from "./orca-scratchpad.js";
import { hideTerminals, initOrcaTerminal, type Placement, pruneTerminals, showTerminals, type TermSource } from "./orca-terminal.js";
import { type Fields, registerDraftTarget } from "./screen-bridge.js";
import { initSplit } from "./split.js";
import { hideStay, showStay } from "./toast.js";
import { logError, setNotice, showFailure } from "./error-card.js";
import { drawNotices as drawJiraNotices } from "./orca-jira.js";
import { copyText, setNavCount, show } from "./view.js";

export const THIS_MACHINE = "このマシン";
const SHOWN_MS = 10_000;
// The clock ticks once a second, and a spec that shortens `SHOWN_MS` (`periodMs`) shortens the tick in the same proportion.
export const shownMs = () => periodMs("orcaClock", SHOWN_MS);
const HIDDEN_MS = 60_000;

// The last read, or null before the first. A failed read keeps the rows and worktrees of the one before it while the target is the same.
let view: OrcaOverview | null = null;
// This machine's lists beside a saved environment's (A-33), null while this machine is the target (its lists are `view`'s own) or before a read of it. A read that failed keeps the lists of the last good one and says its state.
let here: OrcaLocal | null = null;
// When this machine's lists were last read by the clock while the target is streamed (`loadHere`); the read of `orca_overview` sets it too, as the first read of a target does.
let hereTry = 0;
let hereLoading = false;
// The latest read of this machine's lists is the one used (as `loadSeq` is for `load`).
let hereSeq = 0;
// The lists the screen draws: the target's (`view`) and this machine's (`here`) in one (A-33). Every item says where it is (`environment`), so a row of a saved environment is the one with a name.
interface Lists {
  rows: OrcaRow[];
  worktrees: OrcaWorktree[];
  projects: OrcaProject[];
  terminals: OrcaTerminal[];
}
let mix: Lists = { rows: [], worktrees: [], projects: [], terminals: [] };
// How much a read asks for (see `orca_overview`).
type Scope = "full" | "screen" | "badge";
// The sidebar button's count: the agents that wait for the user, and the notices (see `track`). The rows held, or what a read for the count alone found.
let waitingCount = 0;
// The rows of the target that work now (group `working`, with a status that says so). A failed read cannot say that any does, so it clears them: the sidebar icon turns yellow and fades while there is one (see `track`).
let workingCount = 0;
// The rows of this machine that work now while a saved environment is the target (A-33): they mark the icon and are in its label, and are not in the count of the waiting ones or in the notices. A read of this machine that failed has none.
let hereWorking = 0;
const isWorking = (r: OrcaRow) => r.group === "working" && (r.status === "working" || r.status === "monitoring");
const workingOf = (read: OrcaLocal | null | undefined) => (read?.state === "ready" ? read.rows.filter(isWorking).length : 0);
// The notices: the panes of the stopped agents (done, failed or interrupted) that changed while the app ran and have not been shown on this screen yet.
const notified = new Set<string>();
// The panes that were stopped when last seen, each with the newest `atMs` seen while stopped (a pane that left the list stays here, so one that comes back stopped with the same time is not noticed again), and whether a read of the target was taken as the base (its rows are never noticed).
let wasStopped = new Map<string, number>();
let baselined = false;
// Reads: the latest request is the one used; one is on its way; when the last one started.
let loadSeq = 0;
let loading = false;
let lastTry = 0;
// When the clock last read the files again (`rereadFiles`), or last found the screen or the window hidden: the next read is one period after it.
let filesAt = Date.now();
// Whether the list of projects is open (A-23): held in memory only, so the screen is open again when the app starts.
let listOpen = true;
// The text of the search field (A-19): the list shows the projects whose name holds it (blank: all of them), and the row the keys are on is `cursor` (a key; one the list does not show leaves the first).
let query = "";
// Whether the projects that are not running are listed under the link that follows the running ones (A-8). The search lists them all whatever this is, and clearing it leaves this as it was; in memory only.
let stoppedOpen = false;
// Whether the bell of the heading is pressed (A-8): the list is the work and not the projects. Held in memory only, off at each start of the app.
let activeOnly = false;
// The number of the bell: the sidebar button's count, as `drawBadge` found it.
let badgeCount = 0;
// The session whose title is being typed in its row (A-8) and the text typed so far: a redraw of the list keeps the field.
let editing: { id: string; value: string } | null = null;
// The field of `editing`: a draw of the list moves this very element into the new row, so that the caret, the selection and the focus stay. `redrawing` is true while the list is being drawn: a blur then is the move and no cancel.
let titleField: HTMLInputElement | null = null;
let redrawing = false;
// Whether the search field (A-19) is open: it takes the place of the heading's row. It is closed again when its text is empty and the focus leaves it, or with Escape; while text is kept it stays open.
let searchOpen = false;
let cursor: string | null = null;
// The project selected (its key; null: none). Its tab selected is the one shown in the pane of its layout that has the focus (`selectedTab`).
let projectKey: string | null = null;
// The projects with a working session, in the order they entered that group. A read does not reorder them (the project list of the read is newest first by activity, which moves with the work); one that starts to work is put first, one that stops leaves the group.
let workingOrder: string[] = [];
// The target `workingOrder` was made for: the keys of another target are not these.
let workingTarget: string | null = null;
// The host element of each pane drawn, by pane id: the terminals are placed in them.
let paneHosts = new Map<string, HTMLElement>();
// The order tabs were first seen in, so that a read that reorders the sessions does not move the tabs. A tab with a terminal is known by its handle, so a terminal that changes kind (a plain one where Claude starts, or the other way round) keeps its place.
const seen = new Map<string, number>();
// The tabs of Orca whose close was asked for and is not answered.
const closing = new Set<string>();
// A launch or a new terminal (the plus) on its way.
let busy = false;
// The launch or the terminal that was answered: what it started, its pane key and handle (null when Orca's reply gave none), the target and when to stop waiting for its tab. The tab is selected as soon as the list holds it, and no other start is made till then.
let started: { kind: StartKind; paneKey: string | null; handle: string | null; target: string | null; until: number } | null = null;
type StartKind = "claude" | "terminal" | "agent";
const START_WAIT_MS = 30_000;
// The AI CLIs that each place can start (A-16), by place (null: this machine, else the name of a saved environment): the list, or null when it could not be read. Held only for the places of the screen's lists, and read when the screen is shown (a list read less than a minute ago is trusted), not by the clock.
const agentLists = new Map<string | null, OrcaAgent[] | null>();
// When each list of `agentLists` was read, and how long a list that was read is trusted when the screen is shown again.
const agentReadAt = new Map<string | null, number>();
const AGENTS_TRUST_MS = 60_000;
// The reads on their way, by place: the plus waits for the one of its place when that place was never read, and a read that is not in this map any more (its place left the lists, or a newer read took its turn) is dropped when it ends.
const agentReads = new Map<string | null, Promise<void>>();
// The streams of the lists, by place: the name of the saved environment that is the target, and null for this machine's Orca (once it is paired, whatever the target is). A place with none has its list read by the clock.
// `channel` is the stream's own: an event of another channel is not taken. `down`: it could not connect or lost its connection, so its list is read by the clock and its terminals are mirrors until it sends a list again (a saved environment's is never down: it says so as a failed read).
interface Stream {
  channel: { onmessage: (event: OrcaStreamEvent) => void };
  down: boolean;
}
const streams = new Map<string | null, Stream>();
// Whether this machine's Orca is paired with the app (A-12), null before it was read; `pairingSeq` is the number of the latest read (0: none was asked for).
let paired: boolean | null = null;
let pairingSeq = 0;
// What the feed and the tabs show now; they are drawn again only when this changes.
let feedKey = "";

const feed = () => $("orca-feed");
// The development screen is shown: the list is.
const listShown = () => currentScreen() === "orca";
// The work pane of Orca is shown: the screen is, and no formation is selected (a formation takes the place of the work pane, A-37).
const shown = () => listShown() && currentFormation() === null;
// The project the list marks as selected: none while a formation is.
const pickedProject = () => (currentFormation() === null ? projectKey : null);

// The selection of the list changed to or from a formation: what the screen shows is drawn again.
export const redrawOrca = () => draw();

export const worktreeLabel = (w: { repo: string; branch: string }) => `${w.repo} ・ ${w.branch}`;

// The name that the list shows for the project `key` of `environment` (null: this machine), or undefined when the list holds none (the Jira part of the file pane names the projects that hold a connection, J-1).
export const listedProjectName = (environment: string | null, key: string) => mix.projects.find((p) => p.key === key && placeOf(p) === environment)?.name;

// How long ago `ms` was: running and waiting agents show the time since their state began ("2 分"), a done one how long ago it ended ("18 分前").
export function elapsed(ms: number, now: number, done: boolean) {
  if (!ms) return "";
  const min = Math.max(0, Math.floor((now - ms) / 60_000));
  if (min < 1) return done ? "たった今" : "1 分未満";
  const text = min < 60 ? `${min} 分` : min < 1440 ? `${Math.floor(min / 60)} 時間` : `${Math.floor(min / 1440)} 日`;
  return done ? `${text}前` : text;
}

// An agent that stopped: finished, failed or interrupted (Orca says an interrupted one as `done` with `interrupted` true).
const isStopped = (r: OrcaRow) => r.group === "done" || r.status === "failed" || r.status === "interrupted";

// The panes of the sessions that are shown now: the session that is the selected tab while the screen is shown and the window is not hidden (the side pane of A-9 does not count), and every session whose tab is in a window of its own (A-46).
const viewedPanes = () => {
  const tab = selectedTab();
  const here = tab === null || tab === undefined || !shown() || document.hidden ? null : tab;
  // The tab of another AI's row is its handle's (`rowTabId`): the pane is the one of the row that has that tab.
  return mix.rows.flatMap((r) => {
    const id = rowTabId(r);
    return r.paneKey !== null && id !== null && (id === here || isAway(id)) ? [r.paneKey] : [];
  });
};

// Takes the rows of a read as the one the count follows (the rows of one read, whatever its scope). The first read of a target is only the base: a notice is made for a row that went from not stopped to stopped,
// or that first appeared in a later read already stopped, or that is stopped again with a newer `atMs` (the time it stopped: work that began and ended between two reads is stopped in both, and only its time tells; a pane seen stopped before with the same time is never new, even after it left the list and came back). A notice goes when the agent runs again, leaves the list, or its session is shown. A row with no pane cannot be opened, so it has no notice.
function track(rows: OrcaRow[]) {
  waitingCount = rows.filter((r) => r.group === "waiting").length;
  workingCount = rows.filter(isWorking).length;
  const live = new Set<string>();
  for (const r of rows) {
    if (r.paneKey === null) continue;
    live.add(r.paneKey);
    if (!isStopped(r)) {
      notified.delete(r.paneKey);
      wasStopped.delete(r.paneKey);
    } else {
      const seen = wasStopped.get(r.paneKey);
      if (baselined && (seen === undefined || r.atMs > seen)) notified.add(r.paneKey);
      wasStopped.set(r.paneKey, Math.max(seen ?? 0, r.atMs));
    }
  }
  for (const key of notified) if (!live.has(key)) notified.delete(key);
  baselined = true;
}

// Forgets the notices, the stopped panes seen and the base: the command is gone, or the target changed.
function forgetNotices() {
  waitingCount = 0;
  workingCount = 0;
  notified.clear();
  wasStopped = new Map();
  baselined = false;
}

// ---- tabs ----

// A tab of the work pane: a Claude session, or a plain terminal of Orca (both are terminals), or a file open in the editor (A-18), or the difference of a file from HEAD (A-24), or the definition of a name of the editor (A-34), or a table or the SQL of a database (A-43), or a ticket of Jira or the form of a new one (J-2), or a task of Todoist (A-49).
interface Tab {
  id: string;
  kind: "claude" | "plain" | "file" | "diff" | "definition" | "database" | "jira" | "todo";
  status: OrcaStatus;
  label: string;
  title: string;
  // The first line of the newer of a Claude session's prompt and last answer, which the modal of A-40 shows in place of the title (the tab shows the title); null for the rest, and for a session whose newer message has no text.
  latest: string | null;
  // The Orca terminal's handle (a Claude session may have none: it shows no terminal and cannot be closed).
  handle: string | null;
  // A plain terminal that ended (A-8): the list says so, or its stream ended, or Orca refused its keys as not writable. It is drawn with a mark that is not green and the label 「終了」, and takes no key.
  ended?: boolean;
  // The worktree it runs in (a file's: where the file is).
  path: string;
  // The worktree's name, "{repo} ・ {branch}", which the heading of the file pane shows.
  where: string;
  // The key a session's title is kept under (A-8): a Claude session's pane key, a plain terminal's handle. Only a Claude session and a plain terminal have one.
  titleKey?: string;
  // Whether `title` is one the owner fixed (A-8): the row draws a pin.
  fixed?: boolean;
  // Where the tab is: null for this machine, else the name of the saved environment. A terminal's comes from its row, a file's and a diff's from the project they were opened in.
  environment: string | null;
  // A file outside the worktree that a definition named (A-34): the tab has a lock, and the file is read only. `gem` marks one that is a Ruby file.
  outside?: boolean;
  gem?: boolean;
}

// A tab with no terminal, whose page is a document of the worktree: a file in the editor, the difference of a file, or the definition of a name; or the page of a database, of a Jira ticket or of a task of Todoist (they have the main worktree of their project, so the file pane keeps its worktree).
const isDocument = (t: Tab) => t.kind === "file" || t.kind === "diff" || t.kind === "definition" || t.kind === "database" || t.kind === "jira" || t.kind === "todo";

// Where an item of a list is (A-6): the saved environment's name, null for this machine (an item with no `environment` is this machine's).
const placeOf = (item: { environment?: string | null }) => item.environment ?? null;

// Where the project `key` of the list is, which the layout of its panes, its files and its diffs are kept under. A key the list does not hold (a project that left) has no place of its own: the screen's target.
function projectPlace(key: string): string | null {
  const project = mix.projects.find((p) => p.key === key);
  return project === undefined ? (view?.target ?? null) : placeOf(project);
}

// The titles the owner fixed for sessions (A-8), by target (`titleTarget`: the saved environment's name, or this machine's) and by `titleKey`: read once at the start of the screen, and held as Rust answers each save.
let titles: Record<string, Record<string, string>> = {};
const titleTarget = (environment: string | null) => environment ?? THIS_MACHINE;
const fixedTitle = (environment: string | null, key: string): string | undefined => titles[titleTarget(environment)]?.[key];

const claudeTabId = (paneKey: string) => `claude:${paneKey}`;
const plainTabId = (handle: string) => `orca:${handle}`;

// Whether a row is a Claude session (A-8): another AI's row, and one of no known type, is a terminal tab, never a Claude one.
const isClaudeRow = (r: OrcaRow) => r.agent === "claude";

// The id of the tab of a row that has a pane key: a Claude session's, else the plain terminal's of its handle (a row of another AI with no handle has no tab: null).
const rowTabId = (r: OrcaRow) => (isClaudeRow(r) ? claudeTabId(r.paneKey!) : r.handle === null ? null : plainTabId(r.handle));

// The handles of the terminals that a stream's end or a refusal of keys (`terminal_not_writable`) found ended, which the list may not say yet: a terminal of them is an ended one until it leaves the list (`forgetGone`).
const endedHandles = new Set<string>();

// Whether the terminal of a tab ended, by the list or by what a stream or a send found.
const isEnded = (t: Tab) => t.ended === true || (t.handle !== null && endedHandles.has(t.handle));

// The terminal `handle` ended, as a stream or a send found: its tab is drawn as ended at once.
function endHandle(handle: string) {
  if (endedHandles.has(handle)) return;
  endedHandles.add(handle);
  draw();
}

// What the terminal of a tab with a handle is shown from: streamed or mirrored by where it is, and whether it ended. What finds its end tells the screen (`endHandle`).
const sourceOf = (t: Tab & { handle: string }): TermSource => ({ kind: streamsEnvironment(t.environment) ? "stream" : "mirror", handle: t.handle, path: t.path, environment: t.environment, ended: isEnded(t), onGone: () => endHandle(t.handle) });

// What a tab is known by in `seen`: its handle, else its id. The id changes with the kind of the terminal; the handle does not.
const keyOfTab = (t: Tab) => t.handle ?? t.id;

// The handles of the terminals of the tabs the read holds: the terminals on the screen are known by them.
const liveHandles = () => new Set<string>([...mix.rows.flatMap((r) => (r.paneKey === null || r.handle === null ? [] : [r.handle])), ...mix.terminals.map((t) => t.handle)]);

// Whether a worktree of the list is one made for a formation's child: the choices of a worktree leave it out (A-9, A-16, A-37).
const inChildWorktree = (item: { path: string; environment?: string | null }) => isChildWorktree(item.path, placeOf(item));

// The sessions of the project `key` that the list shows: its tabs other than files and diffs. A formation's child has no tab (A-37) and no row (A-8), so `tabsOf` has none of its sessions.
const ownTabs = (key: string) => tabsOf(key).filter((t) => !isDocument(t));

// How many worktrees of the project `key` are a launched child's folder (A-8): the list draws no row for them, and the project's row counts them beside the mark of a formation.
const childFolderCount = (key: string) => mix.worktrees.filter((w) => w.projectKey === key && isChildFolder(w.path, placeOf(w))).length;

// The tabs of the project `key`: its Claude sessions and its plain terminals, in the order they were first seen.
function tabsOf(key: string): Tab[] {
  const tabs: Tab[] = [];
  for (const r of mix.rows) {
    if (r.projectKey !== key || r.paneKey === null || isChildSession(r)) continue;
    if (!isClaudeRow(r)) {
      if (r.handle === null) continue;
      const fixed = fixedTitle(placeOf(r), r.handle);
      const ended = endedHandles.has(r.handle);
      tabs.push({ id: plainTabId(r.handle), kind: "plain", status: ended ? "interrupted" : r.status, label: ended ? "終了" : STATUS_LABELS[r.status], ended, title: fixed ?? (r.line || "ターミナル"), titleKey: r.handle, fixed: fixed !== undefined, latest: null, handle: r.handle, path: r.path, where: worktreeLabel(r), environment: placeOf(r) });
      continue;
    }
    const fixed = fixedTitle(placeOf(r), r.paneKey);
    tabs.push({ id: claudeTabId(r.paneKey), kind: "claude", status: r.status, label: STATUS_LABELS[r.status], title: fixed ?? (r.line || "（題名なし）"), titleKey: r.paneKey, fixed: fixed !== undefined, latest: r.latest, handle: r.handle, path: r.path, where: worktreeLabel(r), environment: placeOf(r) });
  }
  for (const t of mix.terminals) {
    if (t.projectKey !== key || isChildSession(t)) continue;
    const repo = mix.worktrees.find((w) => w.path === t.path && placeOf(w) === placeOf(t))?.repo ?? mix.projects.find((p) => p.key === t.projectKey)?.name ?? "";
    const ended = t.ended || endedHandles.has(t.handle);
    const fixed = fixedTitle(placeOf(t), t.handle);
    tabs.push({ id: plainTabId(t.handle), kind: "plain", status: ended ? "interrupted" : "done", label: ended ? "終了" : "起動中", ended, title: fixed ?? (t.title || "ターミナル"), titleKey: t.handle, fixed: fixed !== undefined, latest: null, handle: t.handle, path: t.path, where: worktreeLabel({ repo, branch: t.branch }), environment: placeOf(t) });
  }
  const place = projectPlace(key);
  for (const f of filesOf(place, key)) {
    const where = tabs.find((t) => t.path === f.path)?.where ?? mix.worktrees.find((w) => w.path === f.path && placeOf(w) === f.target) ?? gitWorktrees.get(gitKey(f.target, f.path))?.label;
    tabs.push({ id: f.id, kind: "file", status: "done", label: "", title: nameOf(f.relative), latest: null, handle: null, path: f.path, where: where === undefined ? "" : typeof where === "string" ? where : worktreeLabel(where), environment: f.target, outside: f.outside, gem: f.outside && f.language === "ruby" });
  }
  for (const d of diffsOf(place, key)) {
    const where = tabs.find((t) => t.path === d.path)?.where ?? mix.worktrees.find((w) => w.path === d.path && placeOf(w) === d.target) ?? gitWorktrees.get(gitKey(d.target, d.path))?.label;
    tabs.push({ id: d.id, kind: "diff", status: "done", label: "", title: d.commit === null ? nameOf(d.relative) : `${nameOf(d.relative)} ${d.commit.shortId}`, latest: null, handle: null, path: d.path, where: where === undefined ? "" : typeof where === "string" ? where : worktreeLabel(where), environment: d.target });
  }
  for (const d of definitionsOf(place, key)) {
    const where = tabs.find((t) => t.path === d.query.path)?.where ?? mix.worktrees.find((w) => w.path === d.query.path && placeOf(w) === d.target) ?? gitWorktrees.get(gitKey(d.target, d.query.path))?.label;
    tabs.push({ id: d.id, kind: "definition", status: "done", label: "", title: `定義 ・ ${d.query.word}`, latest: null, handle: null, path: d.query.path, where: where === undefined ? "" : typeof where === "string" ? where : worktreeLabel(where), environment: d.target });
  }
  const main = mix.worktrees.find((w) => w.projectKey === key && w.isMain);
  for (const d of databaseTabsOf(place, key)) {
    tabs.push({ id: d.id, kind: "database", status: "done", label: "", title: d.title, latest: null, handle: null, path: main?.path ?? "", where: main === undefined ? "" : worktreeLabel(main), environment: d.target });
  }
  for (const j of jiraTabsOf(place, key)) {
    tabs.push({ id: j.id, kind: "jira", status: "done", label: "", title: jiraTitleOf(j), latest: null, handle: null, path: main?.path ?? "", where: main === undefined ? "" : worktreeLabel(main), environment: j.target });
  }
  for (const k of todoTabsOf(place, key)) {
    tabs.push({ id: k.id, kind: "todo", status: "done", label: "", title: todoTitleOf(k), latest: null, handle: null, path: main?.path ?? "", where: main === undefined ? "" : worktreeLabel(main), environment: k.target });
  }
  // A Claude row that got its handle after it was first seen keeps the place it had under its id.
  for (const t of tabs) if (!seen.has(keyOfTab(t))) seen.set(keyOfTab(t), seen.get(t.id) ?? seen.size);
  return tabs.sort((a, b) => seen.get(keyOfTab(a))! - seen.get(keyOfTab(b))!);
}

// The layout of the selected project's work pane, as Rust answered it (null: no project, or no answer yet).
const currentLayout = () => (projectKey === null ? null : layoutOf(projectPlace(projectKey), projectKey));

// The tab of the selected project that a tab id of its layout means (`findTab`). A tab in a window of its own (A-46) is in no pane, whatever the layout held before Rust's answer.
const tabOfId = (tabs: Tab[], id: string) => (isAway(id) ? undefined : findTab(projectPlace(projectKey ?? ""), projectKey ?? "", tabs, id));

// The tab selected: the one shown in the pane that has the focus (null: no project, no answer yet, or no tab).
const selectedTab = () => focusedTab(currentLayout());

// ---- drawing ----

function drawBadge() {
  for (const viewed of viewedPanes()) notified.delete(viewed);
  const waiting = waitingCount + notified.size;
  setNavCount("nav-orca", waiting, "開発", "確認待ち");
  badgeCount = waiting;
  drawBell();
  // The number that work is not drawn: the button's icon is yellow and fades, and the label says it (read aloud, and in the tooltip on hover).
  const nav = $("nav-orca");
  const working = workingCount + hereWorking;
  nav.classList.toggle("working", working > 0);
  const parts = [...(waiting > 0 ? [`確認待ち ${waiting} 件`] : []), ...(working > 0 ? [`作業中 ${working} 件`] : [])];
  nav.setAttribute("aria-label", parts.length === 0 ? "開発" : `開発（${parts.join("、")}）`);
}

const MISSING_NOTICE = "orca コマンドが見つかりません。Orca を入れると、動いているエージェントを見て、指示を送れます";

// What a read that did not work says (the side pane of A-9 shows it alike), else null.
export function noticeOf(v: OrcaOverview | null) {
  return v?.state === "missing" ? MISSING_NOTICE : v?.state === "failed" ? `読み込めませんでした: ${v.message}` : null;
}

// The cards of what a read says (A-6, A-33), one card for each key: the command that is missing (one for both places), this machine's read and the saved environment's.
const NOTICE_COMMAND = "orca:command";
const NOTICE_MACHINE = "orca:machine";
const NOTICE_ENVIRONMENT = "orca:environment";

// What each card says now. While this machine is the target, or the command is missing, it is the one text of `noticeOf` (a missing command is a warning). While a saved environment is the target, this machine and the saved environment are read apart,
// so each read that failed has a card of its own that names its place; the other place's rows stay drawn.
function noticeTexts(): Record<string, { text: string; warn: boolean } | null> {
  const texts: Record<string, { text: string; warn: boolean } | null> = { [NOTICE_COMMAND]: null, [NOTICE_MACHINE]: null, [NOTICE_ENVIRONMENT]: null };
  if (view === null) return texts;
  if (view.target === null || view.state === "missing") {
    const text = noticeOf(view);
    if (text !== null) texts[view.state === "missing" ? NOTICE_COMMAND : NOTICE_MACHINE] = { text, warn: view.state === "missing" };
    return texts;
  }
  const failed = (place: string, message: string) => ({ text: `${place} を読み込めませんでした: ${message}`, warn: false });
  if (here?.state === "failed") texts[NOTICE_MACHINE] = failed(THIS_MACHINE, here.message);
  if (view.state === "failed") texts[NOTICE_ENVIRONMENT] = failed(view.target, view.message);
  return texts;
}

// Sets the cards while the screen is shown, and takes them off when it is not (the card belongs to the screen, and the × is forgotten with it).
function drawNotice(on: boolean) {
  const texts = on ? noticeTexts() : {};
  for (const key of [NOTICE_COMMAND, NOTICE_MACHINE, NOTICE_ENVIRONMENT]) setNotice(key, texts[key] ?? null);
}

// Whether the read of `place` (null: this machine) failed, which its card says already.
function readFailed(place: string | null) {
  if (view === null) return false;
  if (view.target === place) return view.state === "failed";
  return place === null && here?.state === "failed";
}

// Whether the list is the work: the bell is pressed and no search text is typed (A-8).
const activeShown = () => activeOnly && needle() === "";

// The bell of the heading (A-8): pressed while the list is the work, with the number of the sidebar button, and the heading names the list.
function drawBell() {
  const bell = $("orca-bell");
  bell.setAttribute("aria-pressed", String(activeOnly));
  bell.setAttribute("aria-label", badgeCount === 0 ? "作業中" : `作業中（確認待ち ${badgeCount} 件）`);
  const count = $("orca-bell-count");
  count.hidden = badgeCount === 0;
  count.textContent = String(badgeCount);
  $("orca-projects-title").textContent = activeShown() ? "作業中" : "プロジェクト";
}

// The heading's row or the search field shows (A-19), and the clear button of the field shows while something is typed.
function drawSearch() {
  drawBell();
  $("orca-projects-head").hidden = searchOpen;
  $("orca-search").hidden = !searchOpen;
  $("orca-search-clear").hidden = query === "";
}

// The name of the saved environment a row of the list is in (A-33): a project of a saved environment has it, and those of this machine have none. The sessions, the tabs and the terminals show no place.
function environmentChip(environment: string) {
  const chip = tag("span", "orca-env", environment);
  chip.title = environment;
  return chip;
}

// The icon and the number of one kind of work: the mark of the formations on a project's row. The label comes from outside (the command): it is the title and the label, never markup.
function countNode(className: string, icon: string, n: number, label: string) {
  const badge = tag("span", className);
  badge.title = label;
  badge.setAttribute("role", "img");
  badge.setAttribute("aria-label", label);
  badge.innerHTML = icon;
  badge.append(String(n));
  return badge;
}

// The worktrees of the project `key` that the list draws a row for (A-8): the ones that are not archived and not a launched child's, the repository's own folder first and then in the order Orca lists them.
function worktreesOf(key: string, environment: string | null) {
  const own = mix.worktrees.filter((w) => w.projectKey === key && placeOf(w) === environment && !w.archived && !inChildWorktree(w));
  return [...own.filter((w) => w.isMain), ...own.filter((w) => !w.isMain)];
}

// The newest session of a worktree that has a tab (A-8): the rows are newest first, and a formation child's session and a row with no tab are left out.
const newestRow = (w: OrcaWorktree) => mix.rows.find((r) => r.path === w.path && placeOf(r) === placeOf(w) && r.paneKey !== null && !isChildSession(r) && rowTabId(r) !== null);

// The newest session of each worktree, found once for the drawing that is under way (null: none is: `newestRow` answers).
let newestDrawn = null as Map<OrcaWorktree, OrcaRow | undefined> | null;
const newestOf = (w: OrcaWorktree) => {
  const drawn = newestDrawn;
  return drawn?.has(w) ? drawn.get(w) : newestRow(w);
};

// The worktree the selected tab is in (null: no project is selected, or the selected tab is a file, a diff, a definition or a database, whose worktree is not marked). Found once for each drawing.
let pickedAt: { path: string; environment: string | null } | null = null;
function findPickedAt() {
  const id = selectedTab();
  const tab = id === null || projectKey === null || pickedProject() === null ? undefined : tabsOf(projectKey).find((x) => x.id === id);
  pickedAt = tab === undefined || isDocument(tab) ? null : { path: tab.path, environment: tab.environment };
}

// The icon of the AI of a session: Claude's own mark in its color, the general mark for every other AI. `agent` comes from Orca (its `agentType`), so it is only ever an attribute.
function agentIcon(agent: string | null | undefined) {
  const claude = agent === "claude";
  const icon = tag("span", claude ? "orca-worktree-agent claude" : "orca-worktree-agent");
  icon.setAttribute("role", "img");
  icon.setAttribute("aria-label", claude ? "Claude" : (agent ?? "AI"));
  icon.innerHTML = claude ? CLAUDE_SVG : AGENT_SVG;
  return icon;
}

// A worktree's row under its project (A-8): its status icon, the name of its git branch (the worktree's name when it is on none) and, at the right end, the icon of the AI of its newest session (none when it has no session). Pressing it selects the project and the tab of that session, or the project alone when there is none.
function worktreeNode(key: string, w: OrcaWorktree) {
  const row = tag("button", "orca-worktree");
  row.type = "button";
  const rowKey = `worktree:${placeOf(w) ?? ""}:${w.path}`;
  row.dataset.key = rowKey;
  row.dataset.worktree = w.path;
  row.setAttribute("aria-pressed", String(pickedAt !== null && pickedAt.path === w.path && pickedAt.environment === placeOf(w)));
  const session = newestOf(w);
  row.append(statusIcon(w.status), tag("span", "orca-worktree-branch", w.gitBranch || w.branch));
  if (session !== undefined) row.append(agentIcon(session.agent));
  row.onclick = () => (session === undefined ? selectProject(key) : selectSession(key, rowTabId(session)!));
  row.oncontextmenu = (e) => {
    e.preventDefault();
    // The newest session of the worktree (A-40), read at the press. A selected project's terminal is in the work pane, and a session with no terminal has none to show.
    const now = newestRow(w);
    const tab = now === undefined ? undefined : tabsOf(key).find((x) => x.id === rowTabId(now));
    if (key === pickedProject() || tab === undefined || tab.handle === null) return;
    openPeek(key, tab.id, rowKey);
    syncPeek();
  };
  return row;
}

// The pencil of a row (A-8): it turns the title into a field. It is in the row's button, so its press does not reach the row.
function editButton(t: Tab) {
  const edit = tag("button", "orca-active-edit", "✎");
  edit.type = "button";
  edit.dataset.key = `title-edit:${t.id}`;
  edit.setAttribute("aria-label", "題名を変える");
  edit.onclick = (e) => {
    e.stopPropagation();
    editing = { id: t.id, value: t.title };
    draw();
    const input = $("orca-list").querySelector<HTMLInputElement>(`[data-key="${CSS.escape(`title:${t.id}`)}"]`);
    input?.focus();
    input?.select();
  };
  return edit;
}

// The field that the title of a row is typed in (A-8): Enter saves it (an empty text gives the automatic title back), Escape and the focus leaving cancel it. Its keys and presses do not reach the row (the selection, the menu of the peek).
function titleInput(id: string, key: string, environment: string | null, value: string) {
  if (titleField?.dataset.key === `title:${id}`) return titleField;
  const input = tag("input", "orca-active-title-input");
  titleField = input;
  input.type = "text";
  input.value = value;
  input.dataset.key = `title:${id}`;
  input.setAttribute("aria-label", "題名");
  let done = false;
  input.oninput = () => {
    if (editing?.id === id) editing.value = input.value;
  };
  input.onkeydown = (e) => {
    e.stopPropagation();
    if (composing(e)) return;
    if (e.key === "Enter") {
      e.preventDefault();
      done = true;
      void saveTitle(environment, key, input.value);
    } else if (e.key === "Escape") {
      e.preventDefault();
      done = true;
      stopEditing();
    }
  };
  for (const type of ["keyup", "keypress", "click", "dblclick", "mousedown", "contextmenu"]) input.addEventListener(type, (e) => e.stopPropagation());
  // The move of the field by a draw of the list is not a cancel: the same element is put in the new row.
  input.onblur = () => {
    if (!done && !redrawing && input.isConnected) stopEditing();
  };
  return input;
}

function stopEditing() {
  editing = null;
  titleField = null;
  draw();
}

// Saves the title of a session (an empty one takes it out) and holds the titles Rust answers.
async function setTitle(environment: string | null, key: string, title: string) {
  titles = await invoke("orca_title_set", { target: titleTarget(environment), key, title });
}

async function saveTitle(environment: string | null, key: string, title: string) {
  try {
    await setTitle(environment, key, title);
  } catch (e) {
    showFailure("orca", e);
  }
  stopEditing();
}

// A session of the work and the tab it is (A-8).
interface Active {
  row: OrcaRow;
  tab: Tab;
}

// The sessions of the work (A-8): every session of the list that has a tab and is not a launched child's, whatever its state (working, waiting, done or failed), the newest change first and across the projects. A session whose time is unknown goes last.
function activeSessions(): Active[] {
  const tabs = new Map<string, Tab[]>();
  const found: Active[] = [];
  for (const row of mix.rows) {
    const id = row.paneKey === null || isChildSession(row) ? null : rowTabId(row);
    if (id === null) continue;
    if (!tabs.has(row.projectKey)) tabs.set(row.projectKey, ownTabs(row.projectKey));
    const tab = tabs.get(row.projectKey)!.find((t) => t.id === id);
    if (tab !== undefined) found.push({ row, tab });
  }
  return found.sort((a, b) => b.row.atMs - a.row.atMs);
}

// The name of the project of a row, and the branch of its worktree (the worktree's name when it is on none).
const projectNameOf = (r: OrcaRow) => mix.projects.find((p) => p.key === r.projectKey)?.name ?? r.repo;
const branchOf = (r: OrcaRow) => mix.worktrees.find((w) => w.path === r.path && placeOf(w) === placeOf(r))?.gitBranch || r.branch;

// The time a session's row shows: since its state began, and for a stopped one how long ago it ended.
const activeTime = (r: OrcaRow, now: number) => elapsed(r.atMs, now, isStopped(r));

// A session of the work, in three lines (A-8): its status icon, its title (with the pin when the owner fixed it, and the pencil that types a new one) and its time; its latest message; then the icon of its AI, its project and its branch. It is selected when it is the tab selected. Everything that comes from outside is text.
function activeNode({ row: r, tab: t }: Active, now: number) {
  const key = r.projectKey;
  const row = tag("button", "orca-active");
  row.type = "button";
  row.dataset.key = `tab:${t.id}`;
  // Not `data-tab`: that names a tab of the work pane, which the pane tree looks for with `closest`.
  row.dataset.session = t.id;
  row.setAttribute("aria-pressed", String(key === pickedProject() && t.id === selectedTab()));
  const head = tag("span", "orca-active-head");
  head.append(statusIcon(t.status, t.label));
  if (editing?.id === t.id && t.titleKey !== undefined) head.append(titleInput(t.id, t.titleKey, t.environment, editing.value));
  else {
    head.append(tag("span", "orca-active-title", t.title));
    if (t.fixed) {
      const pin = tag("span", "orca-active-pin", "📌");
      pin.setAttribute("role", "img");
      pin.setAttribute("aria-label", "固定");
      head.append(pin);
    }
    if (t.titleKey !== undefined) head.append(editButton(t));
  }
  head.append(tag("span", "orca-active-time", activeTime(r, now)));
  row.append(head);
  if (r.latest) row.append(tag("span", "orca-active-latest", r.latest));
  const foot = tag("span", "orca-active-foot");
  foot.append(agentIcon(r.agent), tag("span", "orca-active-project", projectNameOf(r)), tag("span", "orca-active-branch", branchOf(r)));
  row.append(foot);
  row.onclick = () => selectSession(key, t.id);
  row.oncontextmenu = (e) => {
    e.preventDefault();
    // A terminal is shown in one place at a time: the selected project's is in the work pane, and a session with no terminal has none to show.
    if (key === pickedProject() || (tabsOf(key).find((x) => x.id === t.id)?.handle ?? null) === null) return;
    openPeek(key, t.id, `tab:${t.id}`);
    syncPeek();
  };
  return row;
}

// The list of the work (A-8): the rows one step in from the heading, or the line that says there are none.
function activeNodes(sessions: Active[], now: number): HTMLElement[] {
  if (sessions.length === 0) return [emptyNode("作業中のセッションがありません")];
  const list = tag("div", "orca-actives");
  list.append(...sessions.map((s) => activeNode(s, now)));
  return [list];
}

// Whether the titles of sessions that a list read well no longer holds are being taken out.
let forgettingTitles = false;
// The titles (target and key) whose taking out failed: they are not sent again until the screen is shown again (`showOrca`), so a write that keeps failing is not made at every read of the list.
const forgetFailed = new Set<string>();

// A title of a session that the list of its place, read well, no longer holds is taken out (A-8). A list that failed or is not on the screen says nothing, so no title goes for it.
async function forgetTitles() {
  if (forgettingTitles) return;
  const gone = new Map<string | null, string[]>();
  for (const [target, keyed] of Object.entries(titles)) {
    const environment = target === THIS_MACHINE ? null : target;
    if (!listRead(environment)) continue;
    const live = new Set<string | null>([...mix.rows.filter((r) => placeOf(r) === environment).map((r) => (isClaudeRow(r) ? r.paneKey : r.handle)), ...mix.terminals.filter((t) => placeOf(t) === environment).map((t) => t.handle)]);
    const keys = Object.keys(keyed).filter((key) => !live.has(key) && !forgetFailed.has(`${target}\0${key}`));
    if (keys.length > 0) gone.set(environment, keys);
  }
  if (gone.size === 0) return;
  forgettingTitles = true;
  // One call for each place, which reads and writes the file once for all its keys.
  for (const [environment, keys] of gone) {
    try {
      titles = await invoke("orca_titles_forget", { target: titleTarget(environment), keys });
    } catch (e) {
      logError("orca", e);
      for (const key of keys) forgetFailed.add(`${titleTarget(environment)}\0${key}`);
    }
  }
  forgettingTitles = false;
  draw();
}

// Reads the titles the owner fixed, once, at the start of the screen.
async function loadTitles() {
  try {
    titles = await invoke("orca_titles");
  } catch (e) {
    logError("orca", e);
    return;
  }
  void forgetTitles();
  draw();
}

// A project: its name as a heading, and at the right end the chip of its saved environment and the mark of the formations with the number of their worktrees (it shows no status: the rows of its worktrees do). Under it are the rows of its worktrees (A-8).
function projectNode(key: string, name: string, environment: string | null, onCursor: boolean, re: RegExp | null) {
  const wrap = tag("div", "orca-proj");
  const row = tag("button", "orca-project");
  row.type = "button";
  row.dataset.key = key;
  row.setAttribute("aria-pressed", String(key === pickedProject()));
  if (onCursor) row.dataset.cursor = "true";
  const label = tag("span", "orca-project-name");
  label.append(...nameNodes(name, re));
  row.append(label);
  if (environment !== null) row.append(environmentChip(environment));
  // The worktrees of the launched children of the formations, which the list draws no row for: the mark of a formation and their number, at the right end (none when there is none).
  const children = childFolderCount(key);
  if (children > 0) row.append(countNode("orca-project-formation", FORMATION_SVG, children, `フォーメーション ${children}`));
  row.onclick = () => selectProject(key);
  row.oncontextmenu = (e) => {
    e.preventDefault();
    // The first session of the project (A-40). A selected project's terminal is in the work pane, and a project with no session, or a session with no terminal, has none to show.
    // Read at the press: the row is not drawn again when its first session changes.
    const first = ownTabs(key)[0];
    if (key === pickedProject() || first === undefined || first.handle === null) return;
    openPeek(key, first.id, key);
    syncPeek();
  };
  wrap.append(row, ...worktreesOf(key, environment).map((w) => worktreeNode(key, w)));
  return wrap;
}

function emptyNode(text: string) {
  if (view === null) {
    const loadingRow = tag("div", "pending");
    loadingRow.append(tag("span", "spin"), tag("span", "sp", "読み込んでいます…"));
    return loadingRow;
  }
  return view.state === "ready" ? tag("div", "feed-empty", text) : tag("div");
}

// Keeps `workingOrder` in step with the sessions of a read that worked. A project is in the working group when a session of it works (its own status may be a question, which outranks working), or when its icon works with no working Claude row (another agent, or a worktree's status). One that works and was not in the group enters it at the front (the newest first among those that enter together, as the read lists them); one that does not work leaves it. A read that failed, or the first one of a new target, says nothing.
function trackWorking() {
  if (view === null || (view.state !== "ready" && here?.state !== "ready")) return;
  if (view.target !== workingTarget) {
    workingTarget = view.target;
    workingOrder = [];
  }
  const working = new Set(mix.rows.filter((r) => r.status === "working").map((r) => r.projectKey));
  for (const p of mix.projects) if (p.status === "working") working.add(p.key);
  const keys = mix.projects.map((p) => p.key).filter((k) => working.has(k));
  const kept = workingOrder.filter((k) => keys.includes(k));
  workingOrder = [...keys.filter((k) => !kept.includes(k)), ...kept];
}

// The projects that work with nothing but a launched child's sessions (A-8): a working session, every working session a child's, and no session of the owner's that has not stopped (it may ask a question or wait). Found once for each drawing.
let childOnly = new Set<string>();
function trackChildOnly() {
  const working = new Set<string>();
  const own = new Set<string>();
  for (const r of mix.rows) {
    if (!isChildSession(r)) {
      if (!isStopped(r)) own.add(r.projectKey);
    } else if (r.status === "working") working.add(r.projectKey);
  }
  childOnly = new Set([...working].filter((k) => !own.has(k)));
}

// The rows of the list: the projects of the target (the working ones first, in the order they began to work, then the stopped ones, which have a session and do not work, then those with no session, both as the read lists them). The working projects that work with a child's sessions alone go last, so that they sit above the link of the projects that are not running.
function projectRows(): OrcaProject[] {
  const all = mix.projects;
  const rest = all.filter((p) => !workingOrder.includes(p.key));
  const pick = (keys: string[]) => keys.flatMap((k) => all.filter((p) => p.key === k));
  return [...pick(workingOrder.filter((k) => !childOnly.has(k))), ...rest.filter((p) => p.sessions > 0), ...rest.filter((p) => p.sessions === 0), ...pick(workingOrder.filter((k) => childOnly.has(k)))];
}

// The search text (A-19), trimmed, and as a regular expression (`partMatcher` of dom.ts: special characters escaped, a case-folded part of a name). The expression is made once for each drawing (null while nothing is typed); its capture group serves `split` below.
const needle = () => query.trim();
const matcher = () => partMatcher(query);

// A name with the letters that match the search text in bold (`split` with a capture group puts the matches at the odd places).
function nameNodes(name: string, re: RegExp | null): (string | HTMLElement)[] {
  if (re === null) return [name];
  return name
    .split(re)
    .map((part, i) => (i % 2 ? tag("b", "", part) : part))
    .filter((part) => part !== "");
}

// A project that is not running (A-8): the gray dot (nothing works, waits or has stopped there), and no session and no terminal. The selected project is never one, so the row the work pane shows stays in the list.
const isNotRunning = (p: OrcaProject) => p.status === "idle" && p.sessions === 0 && p.key !== pickedProject();

// The rows the list shows, the running ones first and then the ones that are not running: the whole list while a search text is typed (the rows whose name holds it), else the running ones alone (the others are in the region under the link, `stoppedRows`).
function visibleRows(re: RegExp | null) {
  const rows = projectRows();
  if (re !== null) return [...rows.filter((r) => !isNotRunning(r)), ...rows.filter(isNotRunning)].filter((r) => re.test(r.name));
  return rows.filter((r) => !isNotRunning(r));
}

// The rows of the region at the bottom of the list: the projects that are not running, while the link is open (none while a search text is typed, which lists them in the list itself).
const stoppedRows = () => (stoppedOpen && needle() === "" && !activeOnly ? projectRows().filter(isNotRunning) : []);

// How many projects are not running, which the link counts (none while a search text is typed, which has no link, and none while the list is the work).
const stoppedCount = () => (needle() === "" && !activeOnly ? mix.projects.filter(isNotRunning).length : 0);

// The link at the bottom of the list (A-8): "› 起動していない N 件" while the others are closed, "起動していないものを隠す" while they are listed under it.
function stoppedToggle(count: number) {
  const button = tag("button", "orca-stopped-toggle");
  button.type = "button";
  button.dataset.key = "stopped-toggle";
  button.setAttribute("aria-expanded", String(stoppedOpen));
  button.innerHTML = CHEVRON_SVG;
  button.append(stoppedOpen ? "起動していないものを隠す" : `起動していない ${count} 件`);
  button.onclick = () => {
    stoppedOpen = !stoppedOpen;
    drawFeed();
  };
  return button;
}

// The keys of the rows the keys of the search field can reach, in the order of the list (none while nothing is typed), and the one they are on.
function reachable(rows = visibleRows(matcher())) {
  if (needle() === "") return [];
  return rows.map((r) => r.key);
}
function cursorKey(rows = visibleRows(matcher())) {
  const keys = reachable(rows);
  return cursor !== null && keys.includes(cursor) ? cursor : (keys[0] ?? null);
}

// The projects of `rows`, each with the rows of its worktrees. A list with no running project says it has none only when no project is left out under the link either.
function projectNodes(re: RegExp | null, rows: ReturnType<typeof visibleRows>, on: string | null): HTMLElement[] {
  const nodes = rows.map((r) => projectNode(r.key, r.name, placeOf(r), r.key === on, re));
  return nodes.length || stoppedCount() > 0 ? nodes : [emptyNode(needle() === "" ? "プロジェクトがありません" : "一致するプロジェクトがありません")];
}

// The region at the bottom of the list (A-8): the link, and under it the projects that are not running while it is open. Its scroll position stays.
function drawStopped() {
  const count = stoppedCount();
  const box = $("orca-stopped");
  box.hidden = count === 0;
  const list = $("orca-stopped-feed");
  const rows = stoppedRows();
  list.hidden = rows.length === 0;
  const top = list.scrollTop;
  $("orca-stopped-bar").replaceChildren(...(count === 0 ? [] : [stoppedToggle(count)]));
  list.replaceChildren(...rows.map((r) => projectNode(r.key, r.name, placeOf(r), false, null)));
  list.scrollTop = top;
}

// Draws the list where it is: the scroll position and the focused row stay, and nothing is drawn when nothing changed.
function drawFeed() {
  newestDrawn = new Map(mix.worktrees.map((w) => [w, newestRow(w)]));
  try {
    drawFeedNow();
  } finally {
    newestDrawn = null;
  }
}

function drawFeedNow() {
  trackWorking();
  trackChildOnly();
  findPickedAt();
  // Only what is drawn: a project's time of activity moves with the work and would redraw the list (and restart the working mark) for nothing.
  const rowOf = (p: OrcaProject) => [p.key, p.name, p.status, p.sessions, placeOf(p), childFolderCount(p.key), childOnly.has(p.key)];
  // The rows of the worktrees: their status, their branch and the AI of their newest session.
  const worktreeOf = (w: OrcaWorktree) => [w.path, w.projectKey, placeOf(w), w.branch, w.gitBranch, w.status, w.archived, w.isMain, inChildWorktree(w), newestOf(w)?.agent ?? null, newestOf(w) !== undefined];
  // The rows of the projects, the search expression and the row the keys are on: found once for this drawing.
  const re = matcher();
  const rows = visibleRows(re);
  const on = cursorKey(rows);
  // The sessions of the work, with what is drawn of each (the time moves by the minute, so it is part of the key).
  const now = Date.now();
  const sessions = activeShown() ? activeSessions() : [];
  const sessionOf = ({ row: r, tab: t }: Active) => [t.id, t.status, t.label, t.title, t.fixed ?? false, r.latest, activeTime(r, now), r.agent ?? null, projectNameOf(r), branchOf(r), r.projectKey];
  const key = JSON.stringify([view?.state ?? null, mix.projects.map(rowOf), mix.worktrees.map(worktreeOf), needle(), on, pickedProject(), pickedAt, stoppedOpen, activeShown(), sessions.map(sessionOf), selectedTab(), editing?.id ?? null]);
  if (key === feedKey) return;
  feedKey = key;
  const box = feed();
  const top = box.scrollTop;
  const focused = (document.activeElement as HTMLElement | null)?.dataset?.key;
  // The field of a title being typed is moved to its new row as it is (`titleInput`); what it selects is put back after the move.
  const field = titleField?.isConnected ? titleField : null;
  const selected = field === null ? null : { start: field.selectionStart, end: field.selectionEnd, direction: field.selectionDirection };
  redrawing = true;
  try {
    box.replaceChildren(...(activeShown() ? activeNodes(sessions, now) : projectNodes(re, rows, on)));
    box.scrollTop = top;
    drawStopped();
  } finally {
    redrawing = false;
  }
  if (focused) $("orca-list").querySelector<HTMLElement>(`[data-key="${CSS.escape(focused)}"]`)?.focus({ preventScroll: true });
  if (selected !== null && field?.isConnected) field.setSelectionRange(selected.start, selected.end, selected.direction ?? undefined);
}

function tabNode(t: Tab, selected: boolean) {
  const wrap = tag("div", "orca-tab");
  wrap.dataset.tab = t.id;
  wrap.setAttribute("role", "presentation");
  const select = tag("button", "orca-tab-btn");
  select.type = "button";
  select.setAttribute("role", "tab");
  select.setAttribute("aria-selected", String(selected));
  select.append(t.outside ? lockIcon() : t.kind === "file" ? fileIcon() : t.kind === "diff" ? diffIcon() : t.kind === "definition" ? definitionIcon() : t.kind === "database" ? databaseIcon() : t.kind === "jira" ? ticketIcon() : t.kind === "todo" ? todoIcon() : statusIcon(t.status, t.label), tag("span", "orca-tab-title", t.title));
  if (t.kind === "definition") wrap.dataset.definition = "true";
  if (t.kind === "database") wrap.dataset.database = "true";
  if (t.kind === "jira") wrap.dataset.jira = "true";
  if (t.kind === "file") {
    wrap.dataset.file = "true";
    if (t.outside) {
      wrap.dataset.outside = "true";
      if (t.gem) select.append(tag("span", "orca-tab-gem", "gem"));
    }
    if (dirtyIds().has(t.id)) {
      const unsaved = tag("span", "orca-tab-dirty");
      unsaved.setAttribute("role", "img");
      unsaved.setAttribute("aria-label", "未保存");
      select.append(unsaved);
    }
  }
  select.onclick = () => selectTab(t.id);
  // The close button is beside the tab, not in it, so that pressing it never selects the tab.
  const close = tag("button", "icon-btn orca-tab-close");
  close.type = "button";
  close.setAttribute("aria-label", "閉じる");
  close.innerHTML = CLOSE_SVG;
  close.disabled = (t.kind === "claude" && t.handle === null) || closing.has(t.id);
  // A Jira tab with a description or a comment typed and not saved asks first (J-2, "Closing"); every other tab closes at once.
  close.onclick = () => (t.kind === "jira" && hasJiraDraft(t.id) ? confirmCloseDraft(close, () => void closeTab(t)) : closeTab(t));
  wrap.append(select, close);
  return wrap;
}

// The line under a pane's strip that says why it shows no terminal, else null.
function emptyText(tabs: Tab[], tab: Tab | undefined) {
  if (started !== null) return null;
  if (projectKey === null) return "プロジェクトを選んでください";
  if (tabs.length === 0) return "セッションはありません";
  return tab !== undefined && !isDocument(tab) && tab.handle === null ? "このセッションのターミナルはありません" : null;
}

// The tree of the layout for drawing: each pane with the tabs it holds that the list still has (a tab that left shows no more before Rust's next answer), and the one it shows.
// A tab id the layout holds from before a terminal changed kind is taken as the tab with the same handle (`find`) until Rust's answer.
function treeOf(node: PaneNode, tabs: Tab[], focus: string | null, plusDisabled: boolean, find: (id: string) => Tab | undefined): TreeModel {
  if (node.kind === "split") return { kind: "split", direction: node.direction, children: node.children.map((c) => treeOf(c, tabs, focus, plusDisabled, find)), sizes: node.sizes };
  const mine = [...new Set(node.tabs.flatMap((id) => find(id) ?? []))];
  const dirty = dirtyIds();
  const selected = find(node.selected);
  const tab = mine.find((t) => t.id === selected?.id);
  const pane: PaneModel = {
    id: node.id,
    key: JSON.stringify([mine.map(({ latest, ...t }) => t), node.selected, [...closing], mine.filter((t) => dirty.has(t.id)).map((t) => t.id)]),
    tabs: () => mine.map((t) => tabNode(t, t.id === tab?.id)),
    focused: node.id === focus,
    empty: emptyText(tabs, tab),
    terminal: !!tab?.handle,
    editor: tab !== undefined && isDocument(tab),
    plusDisabled,
    filesShown: filesShown(),
    listOpen,
  };
  return { kind: "pane", pane };
}

// The work pane follows the layout: the panes with their tab strips (a project with no layout yet, or with no tab, has one empty pane), and the terminal of the tab selected in each pane, else a line that says why there is none.
function drawWork(tabs: Tab[]) {
  syncLayout(tabs);
  const layout = currentLayout();
  const plusDisabled = busy || startWaits() || projectKey === null || view === null || view.state === "missing";
  const empty: TreeModel = { kind: "pane", pane: { id: "", key: "", tabs: () => [], focused: false, empty: emptyText(tabs, undefined), terminal: false, editor: false, plusDisabled, filesShown: filesShown(), listOpen } };
  paneHosts = drawTree(layout?.root ? treeOf(layout.root, tabs, layout.focus, plusDisabled, (id) => tabOfId(tabs, id)) : empty);
}

// Shows the terminal of the tab selected in each pane while the screen is shown: streamed from a saved environment or from this machine's paired Orca, else mirrored.
function syncTerminal(tabs: Tab[] = projectKey === null ? [] : tabsOf(projectKey)) {
  const layout = shown() ? currentLayout() : null;
  const placements: Placement[] = [];
  for (const pane of panesOf(layout?.root ?? null)) {
    const tab = tabOfId(tabs, pane.selected);
    const host = paneHosts.get(pane.id);
    if (tab?.handle && host) placements.push({ id: tab.handle, source: sourceOf({ ...tab, handle: tab.handle }), host });
  }
  if (placements.length === 0) return hideTerminals();
  showTerminals(placements, tabOfId(tabs, selectedTab() ?? "")?.handle ?? null);
}

// Shows the editor of the file tab selected in each pane while the screen is shown.
function syncEditor(tabs: Tab[]) {
  const layout = shown() ? currentLayout() : null;
  const placements: { id: string; host: HTMLElement }[] = [];
  for (const pane of panesOf(layout?.root ?? null)) {
    const tab = tabOfId(tabs, pane.selected);
    const host = editorHostOf(pane.id);
    if (tab?.kind === "file" && host) placements.push({ id: tab.id, host });
  }
  // A file that comes back into a pane is read again, whether the file pane is shown or not (A-18).
  showEditors(placements);
}

// Shows the difference of the diff tab selected in each pane while the screen is shown (in the host of the editor, which a pane shows one of).
function syncDiff(tabs: Tab[]) {
  const layout = shown() ? currentLayout() : null;
  const placements: { id: string; host: HTMLElement }[] = [];
  for (const pane of panesOf(layout?.root ?? null)) {
    const tab = tabOfId(tabs, pane.selected);
    const host = editorHostOf(pane.id);
    if (tab?.kind === "diff" && host) placements.push({ id: tab.id, host });
  }
  showDiffs(placements);
}

// Shows the definition of the definition tab selected in each pane while the screen is shown (in the host of the editor, which a pane shows one of).
function syncDefinition(tabs: Tab[]) {
  const layout = shown() ? currentLayout() : null;
  const placements: { id: string; host: HTMLElement }[] = [];
  for (const pane of panesOf(layout?.root ?? null)) {
    const tab = tabOfId(tabs, pane.selected);
    const host = editorHostOf(pane.id);
    if (tab?.kind === "definition" && host) placements.push({ id: tab.id, host });
  }
  showDefinitions(placements);
}

// Shows the page of the database tab selected in each pane while the screen is shown (in the host of the editor, which a pane shows one of).
function syncDatabase(tabs: Tab[]) {
  const layout = shown() ? currentLayout() : null;
  const placements: { id: string; host: HTMLElement }[] = [];
  for (const pane of panesOf(layout?.root ?? null)) {
    const tab = tabOfId(tabs, pane.selected);
    const host = editorHostOf(pane.id);
    if (tab?.kind === "database" && host) placements.push({ id: tab.id, host });
  }
  showDatabaseTabs(placements);
}

// Shows the detail of the task of the Todo tab selected in each pane while the screen is shown (in the host of the editor, which a pane shows one of, A-49).
function syncTodo(tabs: Tab[]) {
  const layout = shown() ? currentLayout() : null;
  const placements: { id: string; host: HTMLElement }[] = [];
  for (const pane of panesOf(layout?.root ?? null)) {
    const tab = tabOfId(tabs, pane.selected);
    const host = editorHostOf(pane.id);
    if (tab?.kind === "todo" && host) placements.push({ id: tab.id, host });
  }
  showTodoTabs(placements);
}

// Shows the ticket of the Jira tab selected in each pane while the screen is shown (in the host of the editor, which a pane shows one of).
function syncJira(tabs: Tab[]) {
  const layout = shown() ? currentLayout() : null;
  const placements: { id: string; host: HTMLElement }[] = [];
  for (const pane of panesOf(layout?.root ?? null)) {
    const tab = tabOfId(tabs, pane.selected);
    const host = editorHostOf(pane.id);
    if (tab?.kind === "jira" && host) placements.push({ id: tab.id, host });
  }
  showJiraTabs(placements);
}

// The git worktrees that the list of branches of the file pane showed and Orca's list lacks (A-25), by target and path: the label of their heading and of the tabs of their files, and the git branch they are on.
const gitWorktrees = new Map<string, { project: string; target: string | null; path: string; label: string; gitBranch: string }>();
const gitKey = (target: string | null, path: string) => `${target ?? ""}\n${path}`;
// The worktree picked in the list of branches (A-25): the file pane shows it instead of the selected tab's worktree, for the tab that was selected then of the project then. Another tab, or another project, ends it.
let pickedWorktree: { project: string; tab: string; target: string | null; path: string; label: string } | null = null;

// The worktree the file pane shows: the one picked in the list of branches while the tab stays selected, else the selected tab's, else (no tab) the main worktree of the selected project.
function filesWorktree(tabs: Tab[]): { path: string; label: string; environment: string | null } | null {
  if (pickedWorktree !== null) {
    if (pickedWorktree.project === projectKey && pickedWorktree.tab === (selectedTab() ?? "")) return { path: pickedWorktree.path, label: pickedWorktree.label, environment: pickedWorktree.target };
    pickedWorktree = null;
  }
  const tab = tabOfId(tabs, selectedTab() ?? "");
  if (tab !== undefined && tab.path !== "") return { path: tab.path, label: tab.where, environment: tab.environment };
  if (tab !== undefined || projectKey === null) return null;
  const main = mix.worktrees.find((w) => w.projectKey === projectKey && w.isMain);
  // A project with tabs whose layout is not answered yet has no selected tab for a moment: nothing is read for it,
  // except when the only tabs are files of the main worktree (the first file opened in a project with no tab), whose tree stays.
  if (tabs.some((t) => !isDocument(t) || t.path !== main?.path)) return null;
  return main === undefined ? null : { path: main.path, label: worktreeLabel(main), environment: placeOf(main) };
}

// The file pane follows its worktree and the files open in it.
function drawFiles(tabs: Tab[]) {
  const worktree = filesWorktree(tabs);
  const target = worktree?.environment ?? null;
  // The branch of the heading is a button (A-25) for a worktree of the list that is on a git branch. It is the git branch, not Orca's name of the worktree.
  const listed = worktree === null ? undefined : mix.worktrees.find((w) => w.path === worktree.path && placeOf(w) === target);
  // A git worktree that Orca's list lacks has its branch from the list of branches.
  const git = worktree === null || listed !== undefined ? undefined : gitWorktrees.get(gitKey(target, worktree.path));
  const branch = listed !== undefined ? (listed.gitBranch !== "" && worktree?.label === worktreeLabel(listed) ? listed.gitBranch : null) : git !== undefined && git.gitBranch !== "" && worktree?.label === git.label ? git.gitBranch : null;
  syncFiles(worktree === null ? null : { target, path: worktree.path, label: worktree.label, project: projectKey ?? "", branch }, worktree === null || projectKey === null ? new Set() : openedIn(target, projectKey, worktree.path));
}

// A file of the file pane was pressed twice: it opens as a tab in the focused pane and is selected, and the editor takes the typing.
function openFile(relative: string) {
  const worktree = projectKey === null ? null : filesWorktree(tabsOf(projectKey));
  if (worktree === null || projectKey === null || view === null) return;
  started = null;
  const id = openEditorFile(worktree.environment, projectKey, worktree.path, relative);
  // The select asks Rust for the layout with the new tab in it (`runPaneOp` reads the tabs when it asks).
  chooseTab(id);
  draw();
}

// A name of the editor was pressed with the Command key and the right button (A-34): the definition tab of the project (made when there is none) asks for the definition of the name. A new tab is split off below the pane of the editor that asked (A-17); the tab that is open already, wherever it is, is selected, and the layout stays.
function askDefinition(query: DefinitionQuery) {
  if (projectKey === null || view === null) return;
  started = null;
  const { tab, created } = openDefinition(query);
  const pane = panesOf(currentLayout()?.root ?? null).find((p) => p.tabs.includes(query.tab));
  // The move adds the new tab to the layout before it moves it (Rust mends the layout against the tabs the screen shows first).
  if (created && pane !== undefined) runPaneOp({ kind: "move", tab: tab.id, pane: pane.id, edge: "bottom" });
  else chooseTab(tab.id);
  draw();
}

// A place of a definition was opened (A-34): its file is a tab of the editor, in the pane of the editor that asked (the first pane that is not the definition's when that tab is gone), and the caret goes to the place when the text is shown. A file that is open already is selected where it is.
function openPlace(place: DefinitionOpen) {
  const { query, path, outside, line, character } = place;
  if (projectKey === null || view === null) return;
  started = null;
  const id = openEditorFile(query.target, query.project, query.path, path, outside ? query.server : null);
  // The file is in a window of its own (A-46): the window comes to the front.
  if (focusPopout(id)) return;
  const panes = panesOf(currentLayout()?.root ?? null);
  const near = panes.find((p) => p.tabs.includes(query.tab)) ?? panes.find((p) => !p.tabs.includes(place.definition));
  if (near !== undefined && !panes.some((p) => p.tabs.includes(id))) runPaneOp({ kind: "move", tab: id, pane: near.id, edge: "center" });
  else chooseTab(id);
  draw();
  goTo(id, line, character);
}

// A request to open an HTML preview (A-45, #985), from a Claude Code through the app (a push of a saved environment's PC, or the screen bridge of this PC): the file is a tab of the project that has the worktree, in the preview (a new tab is placed at the right end, below; a file that is open already is selected when that project is the one selected). The request is data from outside, so Rust checks it again (`orca_preview_check`: the file A-31 opens, a worktree of the list read just now), and the list held here must have the worktree (it is read again once when it lacks it, for a worktree that was made a moment ago). The screen is not switched and no project is selected for it: another project, or a formation selected, only gets the tab; a screen that is not shown has it ready when it is shown again.
// A tab that is new is placed in the pane at the right end of that project's layout, whichever project is selected, and no pane takes the focus: with one pane that pane is split to the right, and with more the tab is stacked on the rightmost pane (A-17, `placeRight`). A file that is open already stays where it is and is selected there (as it is when it is opened from the file list).
// The screen answers once the check has passed, and opens the tab after the answer: the read of the list may take longer than the wait of the bridge (5 seconds), and a tool that failed on the wait would leave a tab that opens later. A refusal after the answer is a card (A-28).
async function openPreview(fields: Fields) {
  const [path, relative, environment] = [fields.path ?? "", fields.relative ?? "", fields.environment || null];
  if (view === null) throw new Error("開発の画面の一覧をまだ読めていません");
  await invoke("orca_preview_check", { path, relative, environment });
  void openCheckedPreview(path, relative, environment, true).catch((e) => showFailure("orca", e instanceof Error ? e.message : e));
}

async function openCheckedPreview(path: string, relative: string, environment: string | null, right = false) {
  const find = () => mix.worktrees.find((w) => w.path === path && placeOf(w) === environment);
  let worktree = find();
  if (worktree === undefined) {
    await refreshOrca(true);
    worktree = find();
  }
  if (worktree === undefined) throw new Error("そのフォルダは、一覧のプロジェクトにありません");
  const { projectKey: key } = worktree;
  const open = new Set(filesOf(environment, key).map((f) => f.id));
  const id = openEditorFile(environment, key, path, relative);
  // A tab that is new (not a file open here, and not one in a window of its own) goes to the right end; the focus stays where it is.
  if (right && !open.has(id) && !isAway(id)) runPaneOp({ kind: "placeRight", tab: id }, key);
  else if (currentFormation() === null && key === projectKey) chooseTab(id);
  draw();
}

// A `file:` link ⌘+clicked in a terminal (A-8, #1304, #1350): Rust gives its path inside the worktree of the terminal (and refuses one outside it, which opens on this machine: an HTML file with `open`, any other file in Zed), then an HTML file (`.html` or `.htm`) opens in the default browser (A-31), of this machine and of a saved environment's PC alike, and any other file is a tab of the project in the editor (A-18).
async function openTerminalLink(source: TermSource, uri: string) {
  const { path, environment } = source;
  let relative: string;
  try {
    relative = await invoke("orca_link_relative", { uri, path });
  } catch (e) {
    // A link that names no file inside the worktree: on this machine it opens with `open` for an HTML file and in Zed for any other (Rust checks the link again and refuses what names no file); a saved environment's file is not on this machine, so the refusal is shown as it is.
    if (environment !== null) throw e;
    await invoke("orca_link_open", { uri });
    return;
  }
  if (/\.html?$/i.test(relative)) await invoke("orca_file_open_in_browser", { path, relative, environment });
  else await openCheckedPreview(path, relative, environment);
}

registerDraftTarget("preview-open", {
  names: ["path", "relative", "environment"],
  isOpen: () => true,
  // The target only takes a request: a read holds nothing.
  read: () => ({ path: "", relative: "", environment: "" }),
  write: openPreview,
});

// A table of the database part of the file pane was pressed (A-43): it opens as a tab in the focused pane and is selected, with the first page of its records; one that is open already is selected and read again.
function openDatabaseTable(profile: DatabaseProfileView, database: string, table: string) {
  if (projectKey === null || view === null) return;
  started = null;
  chooseTab(openTable(projectPlace(projectKey), projectKey, profile, database, table).tab.id);
  draw();
}

// 「新規クエリ」 of a database of the database part was pressed (A-43): the SQL of the database opens as a new tab in the focused pane, and takes the typing.
function openDatabaseQuery(profile: DatabaseProfileView, database: string) {
  if (projectKey === null || view === null) return;
  started = null;
  chooseTab(openQuery(projectPlace(projectKey), projectKey, profile, database).id);
  draw();
}

// A ticket of the Jira part of the file pane was pressed (J-2): it opens as a tab in the focused pane and is selected, and is read; one that is open already is selected and read again.
function openJiraIssue(key: string, boardId: number) {
  if (projectKey === null || view === null) return;
  started = null;
  chooseTab(openJiraTab(projectPlace(projectKey), projectKey, key, boardId).tab.id);
  draw();
}

// A task of the Todo part of the file pane was pressed, or a subtask or the parent of a task's detail (A-49): it opens as a tab in the focused pane and is selected; one that is open already is selected. A task that has a window of its own (T-11) brings the window to the front instead.
function openTodoTask(id: string) {
  if (focusPopout(`todo:${id}`)) return;
  if (projectKey === null || view === null) return;
  started = null;
  chooseTab(openTaskTab(projectPlace(projectKey), projectKey, id).id);
  draw();
}

// 「＋」 of the Jira part was pressed (J-2, #874): the tab of a new ticket opens as a tab in the focused pane and is selected; one that is open already is selected and read again.
function openNewJiraTicket(boardId: number, sprintId: number | null) {
  if (projectKey === null || view === null) return;
  started = null;
  chooseTab(openNewJiraTab(projectPlace(projectKey), projectKey, boardId, sprintId).id);
  draw();
}

// The difference of a file of the file pane from HEAD (its menu), or, with `commit`, of a file of a commit of the history (A-27): it opens as a tab in the focused pane and is selected; one that is open already is selected and read again.
function openDiff(relative: string, commit: DiffCommit | null = null) {
  const worktree = projectKey === null ? null : filesWorktree(tabsOf(projectKey));
  if (worktree === null || projectKey === null || view === null) return;
  started = null;
  const id = openDiffTab(worktree.environment, projectKey, worktree.path, relative, commit);
  chooseTab(id);
  draw();
}

// The note of a start that was answered, at the bottom right (toast.ts): it waits for the tab of the session, or (Orca named neither its pane nor its terminal) says it was started. `draw` shows it on every screen, so that it goes with the wait whichever screen is shown.
function drawStarted() {
  if (started === null) hideStay();
  else if (startWaits()) showStay("セッションを始めました。一覧に現れるのを待っています…");
  else showStay("セッションを始めました。Orca の画面で開けます。", false);
}

// Takes a read as the one shown. A read that did not learn the target and the environments (a poll, or a failed `environment list`) leaves the ones held;
// a failed read keeps the rows, worktrees, projects and terminals held while the target is the same; a missing command empties them.
function adopt(read: OrcaOverview) {
  const next = !read.known && view !== null ? { ...read, target: view.target, environments: view.environments } : read;
  const keep = next.state === "failed" && view !== null && view.state !== "missing" && view.target === next.target;
  // A target that changed (the saved one is gone, or the file was changed): the notices and the base of the old one are not the new one's.
  if (view !== null && next.target !== view.target) forgetNotices();
  view = keep ? { ...next, rows: view!.rows, worktrees: view!.worktrees, projects: view!.projects, terminals: view!.terminals } : next;
  // The count of the waiting ones and the notices are the target's alone (A-6): `view` holds the target's lists, and this machine's, beside them, are not tracked (only its working rows mark the icon, `hereWorking`).
  if (view.state === "ready") track(view.rows);
  else if (view.state === "missing") forgetNotices();
  else workingCount = 0;
  // This machine's stream gives its list: a read of the CLI that comes meanwhile is not taken over it.
  adoptHere(localStreaming() ? undefined : next.local);
  settle();
  readAgents(false);
}

// Takes this machine's read beside a saved environment's (A-33): while this machine is the target, or the command is missing, there is none. A read that did not come with one (a poll that failed before it, an event of the stream) leaves what is held,
// and one that failed keeps the lists of the last good read and says its state, so that this machine's rows stay while it cannot be read.
function adoptHere(read: OrcaLocal | null | undefined) {
  if (view === null || view.target === null || view.state === "missing") here = null;
  else if (read) {
    here = read.state === "ready" ? read : { ...read, rows: here?.rows ?? [], worktrees: here?.worktrees ?? [], projects: here?.projects ?? [], terminals: here?.terminals ?? [] };
    hereTry = Date.now();
  }
  hereWorking = workingOf(here);
  remix();
}

// Puts the lists of the target and of this machine in one (A-33): this machine's first, and the projects newest first as each list is (a stable sort keeps this machine's first on a tie). The sidebar's count and the side pane of A-9 read `view`, not this.
function remix() {
  if (view === null || view.target === null || here === null) {
    mix = { rows: view?.rows ?? [], worktrees: view?.worktrees ?? [], projects: view?.projects ?? [], terminals: view?.terminals ?? [] };
    return;
  }
  mix = {
    rows: [...here.rows, ...view.rows],
    worktrees: [...here.worktrees, ...view.worktrees],
    projects: [...here.projects, ...view.projects].sort((a, b) => b.atMs - a.atMs),
    terminals: [...here.terminals, ...view.terminals],
  };
}

// What a read of the lists leaves to do: a terminal that left Orca's list leaves the tabs with its screen (in each place that was read well), the order of tabs gone is dropped, and a start that waits is looked for.
function settle() {
  if (view === null) return;
  const read = [...(view.state === "ready" ? [view.target] : []), ...(here?.state === "ready" ? [null] : [])];
  if (read.length > 0) {
    const held = liveHandles();
    pruneTerminals((handle, source) => !read.includes(source.environment) || held.has(handle));
    forgetGone();
  }
  void forgetTitles();
  claimStarted();
}

// A start that gave a pane key or a handle waits for its tab: a Claude session's row is matched by either (as the side pane of A-9 does), a terminal by its handle, and an AI CLI's start by both (it is a plain terminal, or a Claude row when it is Claude that runs in it).
const startWaits = () => started !== null && (started.paneKey !== null || started.handle !== null);

// A start whose tab the read holds now is selected (its project and its tab, so its terminal shows); one that waited too long, even if the read failed, or one for another target, is dropped.
function claimStarted() {
  if (!startWaits()) return;
  const wait = started!;
  // A formation is selected meanwhile: the session is not selected, because that would take the screen back to the work pane (the start is dropped).
  if (currentFormation() !== null) {
    started = null;
    return;
  }
  if (Date.now() > wait.until) {
    started = null;
    return;
  }
  if (view === null) return;
  // The list of the place the start was made in: the target's, or this machine's beside it (A-33). Another target, or no read of this machine yet, ends the wait; a list that failed (or is not read yet) keeps it till its 30 seconds are over.
  const place = wait.target === view.target ? view : wait.target === null ? here : null;
  if (place === null) {
    started = null;
    return;
  }
  if (place.state !== "ready") return;
  // Only an item of the place the start was made in: the list holds this machine's items beside the target's, and a pane key or a handle of another place is another session.
  const row = wait.kind !== "terminal" ? mix.rows.find((r) => placeOf(r) === wait.target && ((wait.paneKey !== null && r.paneKey === wait.paneKey) || (wait.handle !== null && r.handle === wait.handle))) : undefined;
  const terminal = wait.kind !== "claude" && wait.handle !== null ? mix.terminals.find((t) => placeOf(t) === wait.target && t.handle === wait.handle) : undefined;
  if (row?.paneKey) pickRow(row);
  if (terminal) pickTerminal(terminal);
  if (row || terminal) started = null;
}

// The order of tabs that are no longer anywhere is dropped, so it does not pile up.
function forgetGone() {
  const live = new Set<string>([...mix.rows.flatMap((r) => (r.paneKey === null ? [] : [r.handle ?? claudeTabId(r.paneKey)])), ...mix.terminals.map((t) => t.handle), ...filesOf(projectPlace(projectKey ?? ""), projectKey ?? "").map((f) => f.id), ...awayIn(projectKey ?? "", []), ...diffsOf(projectPlace(projectKey ?? ""), projectKey ?? "").map((d) => d.id), ...definitionsOf(projectPlace(projectKey ?? ""), projectKey ?? "").map((d) => d.id), ...databaseTabsOf(projectPlace(projectKey ?? ""), projectKey ?? "").map((d) => d.id), ...jiraTabsOf(projectPlace(projectKey ?? ""), projectKey ?? "").map((j) => j.id), ...todoTabsOf(projectPlace(projectKey ?? ""), projectKey ?? "").map((k) => k.id)]);
  for (const key of seen.keys()) if (!live.has(key)) seen.delete(key);
  for (const handle of endedHandles) if (!live.has(handle)) endedHandles.delete(handle);
}

// Whether the language server of the worktree at `path` of `environment` is to stop (A-34): no tab of the worktree is open (a session, a terminal, a file, a difference or a definition of any project), or it has not the worktree any more in a list that was read well. A place that the screen does not list now (another saved environment than the one it shows) has no session or terminal tab open, so it needs no list: its server stops when no file or difference of the worktree is open.
function serverGone(environment: string | null, path: string) {
  const listed = environment === view?.target || (environment === null && here !== null);
  const kept = () => hasFileIn(environment, path) || awayFileIn(environment, path) || hasDiffIn(environment, path) || hasDefinitionIn(environment, path);
  if (!listed) return !kept();
  if (!listRead(environment)) return false;
  if (worktreeGone(environment, path)) return true;
  const open = mix.rows.some((r) => r.paneKey !== null && r.path === path && placeOf(r) === environment) || mix.terminals.some((t) => t.path === path && placeOf(t) === environment);
  return !open && !kept();
}

// Whether the list of `environment` is on the screen and was read well.
const listRead = (environment: string | null) => (environment === view?.target ? view?.state === "ready" : environment === null && here?.state === "ready");

// Whether Orca's list, read well, has not the worktree at `path` of `environment` any more (A-34). A list that is not on the screen or not read well does not say it.
function worktreeGone(environment: string | null, path: string) {
  return listRead(environment) && !mix.worktrees.some((w) => w.path === path && placeOf(w) === environment);
}

// The modal of A-40 shows the session it was opened for as the list has it now, and closes when the list no longer has it, when its project was selected, or when the screen is not shown.
function syncPeek() {
  const at = peeking();
  if (at === null) return;
  const t = listShown() && at.project !== pickedProject() ? tabsOf(at.project).find((x) => x.id === at.tab) : undefined;
  // A session in a window of its own (A-46) has its terminal there, and a terminal is shown in one place at a time.
  if (t === undefined || t.handle === null || isAway(t.id)) return closePeek();
  const name = mix.projects.find((p) => p.key === at.project)?.name ?? "";
  drawPeek({ status: t.status, label: t.label, project: name, title: t.latest ?? t.title, environment: t.environment, source: sourceOf({ ...t, handle: t.handle }) });
}

function draw() {
  drawScreen();
  watchFiles();
  syncPopouts(lookPopout);
}

// Watches the disk of the worktrees whose files the screen shows, where the list streams (A-12, A-18). The screen calls it when another screen is shown, which lets them go, and takes the cards of the reads off (A-28).
export function watchFiles() {
  drawNotice(listShown());
  drawJiraNotices();
  syncFileWatches(shown() && !document.hidden, streamsEnvironment);
}

function drawScreen() {
  syncServers(serverGone);
  drawBadge();
  drawStarted();
  // Before the terminals of the screen are shown, so that a terminal the project selected now owns is not held by the modal.
  syncPeek();
  drawNotice(listShown());
  if (!listShown()) return pauseLsp();
  drawSearch();
  drawFeed();
  // A formation takes the place of the work pane: the terminals of the pane are hidden, and nothing else of it is drawn.
  if (!shown()) {
    pauseLsp();
    return syncTerminal();
  }
  const tabs = projectKey === null ? [] : tabsOf(projectKey);
  drawWork(tabs);
  drawFiles(tabs);
  syncTerminal(tabs);
  syncEditor(tabs);
  syncDiff(tabs);
  syncDefinition(tabs);
  syncDatabase(tabs);
  syncJira(tabs);
  syncTodo(tabs);
}

// ---- the stream of the list ----

// Whether this machine's Orca has a stream that is not down: its list and its terminals come by it, wherever the target is.
const localStreaming = () => {
  const stream = streams.get(null);
  return stream !== undefined && !stream.down;
};

// Whether the list of the target held is streamed (this machine's, only while its stream is connected).
const streaming = () => view !== null && (view.target === null ? localStreaming() : streams.has(view.target));

// Reads whether this machine's Orca is paired, and streams or stops streaming its list by it. The first read of the list asks for it, and the settings do after a pairing is saved or revoked (A-12).
async function readPairing() {
  const seq = ++pairingSeq;
  let next = false;
  try {
    next = (await invoke("orca_pairing_status")).paired;
  } catch (e) {
    logError("orca", e);
  }
  if (seq !== pairingSeq) return;
  paired = next;
  // A pairing saved again: the stream of this machine connects anew, with the pairing now kept (the open ends the old one).
  if (next) streams.delete(null);
  syncStream();
  draw();
}

// The pairing of this machine's Orca was saved or revoked in the settings.
export function pairingChanged() {
  if (!screenOn("orca")) return;
  void readPairing();
}

// Streams the list of each place that has one: the target while it is a saved environment that is listed, and this machine while its Orca is paired (and the command is there), whatever the target is. It ends the stream of a place that has none any more.
// The stream tries a lost connection again by itself.
function syncStream() {
  const want = new Set<string | null>();
  if (view !== null && view.state !== "missing" && screenOn("orca")) {
    if (paired === null && pairingSeq === 0) void readPairing();
    if (view.target !== null && view.environments.includes(view.target)) want.add(view.target);
    if (paired) want.add(null);
  }
  // A new stream of a saved environment ends the old one by itself: a close is a call of its own, which could reach Rust after the open and end the new stream.
  const savedWanted = [...want].some((place) => place !== null);
  for (const place of [...streams.keys()]) {
    if (want.has(place)) continue;
    streams.delete(place);
    if (place === null || !savedWanted) invoke("orca_stream_close", { environment: place }).catch(() => {});
  }
  for (const place of want) if (!streams.has(place)) openStream(place);
}

// Opens the stream of `place`: the name of a saved environment, null for this machine's Orca.
function openStream(place: string | null) {
  const channel = new window.__TAURI__.core.Channel<OrcaStreamEvent>();
  const stream: Stream = { channel, down: false };
  streams.set(place, stream);
  const current = () => streams.get(place) === stream && view !== null && (place === null || view.target === place);
  channel.onmessage = (event) => {
    if (current()) onStream(place, event);
  };
  invoke("orca_stream_open", { environment: place, channel }).catch((e) => {
    if (current()) onStream(place, { kind: "status", live: false, message: String(e) });
  });
}

// A list of the stream of the target is taken as a read that worked; a lost connection as one that failed (the rows stay, and the status says so until the list comes again).
// This machine's stream that is lost is no failure of the list: the list is read by the clock and the terminals are mirrors until it connects again, which its next list tells, and the loss goes to the log (A-28).
// Beside a saved environment that is the target, this machine's list is the one of `here`.
function onStream(place: string | null, event: OrcaStreamEvent) {
  const stream = streams.get(place);
  if (view === null || stream === undefined) return;
  if (event.kind === "status") {
    if (event.live) return;
    if (place !== null) adopt({ ...view, state: "failed", message: event.message, known: false, local: null });
    else if (!stream.down) {
      stream.down = true;
      logError("orca", `このマシンの Orca のストリームが落ちました: ${event.message}`);
      if (view.target === null) void load(clockScope(), true);
      else void loadHere(true);
    }
  } else if (place === null && view.target !== null) {
    stream.down = false;
    adoptHere({ state: "ready", message: "", rows: event.rows, worktrees: event.worktrees, projects: event.projects, terminals: event.terminals });
    settle();
  } else {
    stream.down = false;
    adopt({ ...view, state: "ready", message: "", rows: event.rows, worktrees: event.worktrees, projects: event.projects, terminals: event.terminals, known: false, local: null });
  }
  draw();
}

// What a read after a failure, the first one and one with the command missing ask for: everything. A working list is read for its agents (the screen shown) or their count.
const clockScope = (): Scope => (view?.state !== "ready" ? "full" : listShown() ? "screen" : "badge");

// Reads the list. Only the latest request is used; `force` starts one although another is on its way (after a launch, a close or a change of the target).
async function load(scope: Scope, force = false) {
  if (loading && !force) return;
  const seq = ++loadSeq;
  loading = true;
  lastTry = Date.now();
  // A read of the lists reads this machine's beside a saved environment's, so the clock's read of it (`loadHere`) waits one period.
  if (scope !== "badge" && view?.target != null) hereTry = Date.now();
  let next: OrcaOverview;
  try {
    next = await invoke("orca_overview", { scope, target: view?.target ?? null });
  } catch (e) {
    next = { state: "failed", message: String(e), target: null, environments: [], rows: [], worktrees: [], projects: [], terminals: [], known: false };
  }
  if (seq !== loadSeq) return;
  loading = false;
  lastTry = Date.now();
  // A read for the count alone has no terminals: it only moves the count, and a failure of it is left to the next read.
  if (scope === "badge" && next.state !== "missing") {
    if (next.state === "ready") track(next.rows);
    else workingCount = 0;
    // The read for the count carries this machine's rows beside a saved environment's; one that has none (the stream of this machine gives them, or this machine is the target) leaves what is held.
    if (next.local && !localStreaming()) hereWorking = workingOf(next.local);
    drawBadge();
    return;
  }
  adopt(next);
  syncStream();
  draw();
}

// Reads this machine's lists while a saved environment is the target and streamed, and this machine's stream is not (A-33): the stream gives the target's, and `orca_overview` is not read by the clock then. `force` starts a read although another is on its way (after a start or a close), and the return of the older one is dropped. It is the read of the pane of A-9 for this machine (`orca_destination`),
// which changes nothing else of the screen. A read of a target that changed meanwhile is dropped, and one that failed keeps the lists of the last good one (`adoptHere`).
async function loadHere(force = false) {
  const target = view?.target ?? null;
  if ((hereLoading && !force) || target === null || !streaming() || localStreaming()) return;
  const seq = ++hereSeq;
  hereLoading = true;
  hereTry = Date.now();
  const read = await readDestination(null, false);
  if (seq !== hereSeq) return;
  hereLoading = false;
  hereTry = Date.now();
  if (view?.target !== target || !streaming() || localStreaming()) return;
  adoptHere(read);
  settle();
  draw();
}

// Reads the list again after an operation in `place` (a start, a close): `orca_overview` reads both places, and a streamed place says its own change by itself, so only this machine's is read then, and not while its stream runs.
function reread(place: string | null) {
  if (!streaming()) load(clockScope(), true);
  else if (place === null) void loadHere(true);
}

// Reads again, without a word, the files and the differences that the panes show now (the clock, and a branch of the worktree that changed).
function rereadTabs() {
  refreshEditors();
  refreshDiffs();
}

// The clock's read of the files (A-18, A-24, A-27): the tabs of files and differences that the panes show, and, while the file pane is shown, what it shows (the tree, or the history). Each skips what is still being read.
// The files and the tree of a worktree whose disk is watched and ready are read when the watch tells a change, so the clock leaves them; the differences, the history and the marks of the tree (A-39: `rereadChanges`, with no read of the folders) stay (a commit is no change that Orca tells). Orca does not watch `.git` and `node_modules`, so the clock reads a file in them, and the tree while one of their folders is open.
function rereadFiles() {
  const tree = treeWatch();
  if (filesShown()) {
    if (tree !== null && watchReady(tree.target, tree.path) && !openFolders().some(unwatched)) rereadChanges();
    else refreshFiles(true);
  }
  refreshEditors((target, path, relative) => watchReady(target, path) && !unwatched(relative));
  refreshDiffs();
}

function refresh() {
  // The terminals are shown only while the screen is shown.
  if (!shown()) syncTerminal();
  syncPeek();
  // The time of the rows of the work moves by the minute, with no read of the list (a streamed list is read by no clock).
  if (listShown() && activeShown() && !document.hidden) drawFeed();
  // The files are read again every period while the screen and the window are shown, whatever the file pane and the list do (streamed or being read).
  if (!shown() || document.hidden) filesAt = Date.now();
  else if (Date.now() - filesAt >= shownMs()) {
    filesAt = Date.now();
    rereadFiles();
  }
  // The wait for a new tab ends after its 30 seconds, also while a streamed list is not read by the clock.
  if (startWaits() && Date.now() > started!.until) {
    started = null;
    draw();
  }
  // A streamed list is not read by the clock, but this machine's beside it is, every period while the screen is shown (A-33).
  if (streaming() && listShown() && !document.hidden && Date.now() - hereTry >= shownMs()) void loadHere();
  if (document.hidden || loading || streaming()) return;
  // A missing command is not looked for again by the clock.
  if (view?.state === "missing") return;
  if (Date.now() - lastTry >= (listShown() ? shownMs() : HIDDEN_MS)) load(clockScope());
}

// ---- the side pane's share (A-9) ----

// The last read, for a side pane to draw at once while it reads again.
export const heldOrca = () => view;

// Whether the list of `environment` is streamed (null: this machine's, while its stream is connected, whatever the target is): only then can a pane of A-9 or a tab stream the terminal of a session in it (A-12).
export const streamsEnvironment = (environment: string | null) => (environment === null ? view !== null && localStreaming() : streaming() && view?.target === environment);

// Reads the list for a side pane (the agents with their terminals, and the worktrees), whatever screen is shown, and gives what is held after it. `force` starts the read although another is on its way (the first read of a pane and the read after a send); the poll of a shown session does not. The first read of the app asks for the target too.
export async function refreshOrca(force: boolean) {
  // A streamed list is what Orca holds now.
  if (!streaming()) await load(view?.state === "ready" ? "screen" : "full", force);
  return view;
}

// Reads the lists of one destination for the side pane (A-9), whatever target the Orca screen holds, and changes nothing of the screen. A `force` false (the poll of a shown session) does not ask for the saved environments again. A read that threw is a failed one.
export async function readDestination(environment: string | null, force: boolean): Promise<OrcaOverview> {
  try {
    return await invoke("orca_destination", { environment, force });
  } catch (e) {
    return { state: "failed", message: String(e), target: environment, environments: [], rows: [], worktrees: [], projects: [], terminals: [], known: false };
  }
}

// Selects the session of the pane `paneKey` on the Orca screen and shows the screen ("開発画面で開く"). A session the list does not hold yet leaves the project and the tab as they are, and the work pane is shown all the same: no formation stays selected.
// `environment` is where the session runs (null: this machine, else the name of the saved environment), and only a row of that place is the session: the list holds the rows of this machine beside the target's (A-33), and the same pane key in another place is another session.
// `follow` is given by a hand-over (A-9) with the handle its launch answered: a session that the list does not hold yet is followed as the plus follows its start, so once the list holds it, its project and tab are selected.
// A place that is neither the target nor this machine is not in the list, so the screen is shown with the selection as it is.
export function openInOrca(paneKey: string | null, environment: string | null, follow?: { handle: string | null }) {
  deselectFormation();
  const row = paneKey === null ? null : (mix.rows.find((r) => r.paneKey === paneKey && placeOf(r) === environment) ?? null);
  if (row) {
    setProject(row.projectKey);
    chooseTab(rowTabId(row) ?? claudeTabId(row.paneKey!));
  } else if (follow !== undefined && (paneKey !== null || follow.handle !== null)) {
    started = { kind: "claude", paneKey, handle: follow.handle, target: environment, until: Date.now() + START_WAIT_MS };
    claimStarted();
  }
  setScreen("orca");
}

// The Orca screen is shown: what was read stays on screen while a new read is on its way.
export function showOrca() {
  show("orca");
  readAgents(true);
  forgetFailed.clear();
  feedKey = "";
  draw();
  // The environments are read when the screen is shown, whatever read is on its way.
  load("full", true);
}

// The dialog of the worktrees, narrowed by a filter on `{repo} ・ {branch}`, under the plus of the work pane and under the chip of the side pane of A-9. A pick closes it.
export function openWorktreeDialog(anchor: Element, worktrees: OrcaWorktree[], chosen: string | null, pick: (worktree: OrcaWorktree) => void) {
  const pop = tag("div", "menu orca-dest-pop");
  pop.setAttribute("role", "dialog");
  pop.setAttribute("aria-label", "起動先の worktree");
  const filter = tag("input");
  filter.setAttribute("aria-label", "worktree を絞り込む");
  filter.placeholder = "worktree を絞り込む";
  filter.autocomplete = "off";
  const rows = tag("div", "orca-dest-list");
  const drawRows = () => {
    const q = filter.value.trim().toLowerCase();
    const hits = worktrees.filter((w) => worktreeLabel(w).toLowerCase().includes(q));
    rows.replaceChildren(
      ...(hits.length
        ? hits.map((w) => {
            const b = tag("button");
            b.type = "button";
            b.dataset.path = w.path;
            b.setAttribute("aria-current", String(w.path === chosen));
            b.append(tag("b", "", w.repo), tag("span", "", w.branch));
            b.onclick = () => {
              closeMenu();
              pick(w);
            };
            return b;
          })
        : [tag("p", "empty", "該当する worktree がありません")]),
    );
  };
  filter.oninput = drawRows;
  drawRows();
  pop.append(filter, rows);
  showMenu(anchor, pop);
  filter.focus();
}

// ---- selecting and closing ----

// Makes `key` the selected project.
function setProject(key: string | null) {
  projectKey = key;
  // A project or a session is selected: no formation is.
  if (key !== null) deselectFormation();
}

// Selects the project and, in it, the tab last selected there, else the first.
function selectProject(key: string) {
  started = null;
  setProject(key);
  draw();
}

// A session: selects its project and its tab.
function selectSession(key: string, id: string) {
  started = null;
  setProject(key);
  chooseTab(id);
  draw();
}

function selectTab(id: string) {
  started = null;
  chooseTab(id);
  draw();
}

// Asks Rust for the layout of the selected project (or of the project `key`), with `op` when the user did something to it; the screen is drawn again once it answers. A failure shows its message.
function runPaneOp(op: PaneOp | null, key = projectKey) {
  if (key === null || view === null) return;
  const [target, place] = [view.target, projectPlace(key)];
  const tabs = (): PaneTabs | null => {
    if (view === null || view.target !== target || view.state === "missing") return null;
    const now = tabsOf(key);
    const ids = now.map((t) => t.id);
    return { ids, away: awayIn(key, ids), handles: Object.fromEntries(now.flatMap((t) => (t.handle === null ? [] : [[t.id, t.handle]]))) };
  };
  syncPanes(place, key, tabs, op, () => draw(), (e) => showFailure("orca", e));
}

// Asks for the layout when the project's tabs are not the ones it was asked for with (the first time, and each time a tab came or went); only a read that worked says what the tabs are.
function syncLayout(tabs: Tab[]) {
  if (projectKey === null || view === null || view.state !== "ready") return;
  const ids = tabs.map((t) => t.id);
  if (needsSync(projectPlace(projectKey), projectKey, ids, awayIn(projectKey, ids))) runPaneOp(null);
}

// Selects the tab in its pane and gives the pane the focus, at once and then in Rust (nothing is asked when it is the selected tab already).
function chooseTab(id: string) {
  // A tab in a window of its own (A-46) is not in a pane: the window comes to the front.
  if (focusPopout(id)) return;
  if (projectKey === null || view === null || selectedTab() === id) return;
  const op: PaneOp = { kind: "select", tab: id };
  applyLocal(projectPlace(projectKey), projectKey, op);
  runPaneOp(op);
}

// The pane was pressed: it takes the focus.
function focusPane(pane: string) {
  const layout = currentLayout();
  if (projectKey === null || view === null || layout === null || layout.focus === pane || !panesOf(layout.root).some((p) => p.id === pane)) return;
  const op: PaneOp = { kind: "focus", pane };
  applyLocal(projectPlace(projectKey), projectKey, op);
  runPaneOp(op);
  draw();
}

// Makes the row's project and tab the selection (the row has a pane key).
function pickRow(r: OrcaRow) {
  setProject(r.projectKey);
  chooseTab(rowTabId(r) ?? claudeTabId(r.paneKey!));
}

// Makes the plain terminal's project and tab the selection.
function pickTerminal(t: OrcaTerminal) {
  setProject(t.projectKey);
  chooseTab(plainTabId(t.handle));
}

// Closes a tab. An Orca terminal is closed in Orca, and the list is read at once: it leaves the tabs then, and a failure keeps the tab, shows the message and reads the list again.
// It says whether the tab was closed (the window of A-46 is ended by it); a file says no: a file in a window is closed by the page of its window. A diff, a definition and a database tab are closed here, whether a window shows them or not.
async function closeTab(tab: Tab): Promise<boolean> {
  if (closing.has(tab.id)) return false;
  closing.add(tab.id);
  draw();
  if (tab.kind === "file") {
    // A file is closed here once its typing is saved (a save that cannot be made keeps the tab, and its message was shown).
    await closeFile(tab.id);
    closing.delete(tab.id);
    draw();
    return false;
  }
  if (tab.kind === "diff" || tab.kind === "definition" || tab.kind === "database" || tab.kind === "jira" || tab.kind === "todo") {
    (tab.kind === "diff" ? closeDiff : tab.kind === "definition" ? closeDefinition : tab.kind === "jira" ? closeJiraTab : tab.kind === "todo" ? closeTodoTab : closeDatabaseTab)(tab.id);
    closing.delete(tab.id);
    draw();
    return true;
  }
  try {
    await invoke("orca_close", { handle: tab.handle!, environment: tab.environment });
  } catch (e) {
    showFailure("orca", e);
    closing.delete(tab.id);
    draw();
    // The terminal may be gone from Orca already: the list is read again, and the tab leaves only if the read no longer holds it.
    reread(tab.environment);
    return false;
  }
  closing.delete(tab.id);
  draw();
  // A streamed list says the close by itself.
  reread(tab.environment);
  return true;
}

// The menu of a tab (the right button): it splits its pane, which takes the tab to a new pane at its right or below it (a pane with one tab cannot be split, so it has no split); on a Claude session, a terminal, a file, a diff, a definition and a database tab it opens the tab in a window of its own, also when it is alone in its pane (A-46); and on a file of a worktree it copies the file's path and its path from the worktree, as the menu of the file pane does (A-18), after a line when the split is there. A tab with neither has no menu.
function openTabMenu(anchor: Element, tab: string, pane: string) {
  const item = (label: string, icon: string, pick: () => unknown): MenuItem => ({ label, color: "var(--accent)", icon, current: false, pick });
  const split = (panesOf(currentLayout()?.root ?? null).find((p) => p.id === pane)?.tabs.length ?? 0) >= 2;
  const file = projectKey === null ? undefined : filesOf(projectPlace(projectKey), projectKey).find((f) => f.id === tab);
  const items: MenuItem[] = split ? [item("右に分割", COLUMNS_SVG, () => runPaneOp({ kind: "move", tab, pane, edge: "right" })), item("下に分割", ROWS_SVG, () => runPaneOp({ kind: "move", tab, pane, edge: "bottom" }))] : [];
  const found = projectKey === null ? undefined : tabsOf(projectKey).find((t) => t.id === tab);
  const entry = found === undefined ? null : popoutTab(found, projectKey!);
  if (entry !== null && found !== undefined) items.push(item("別ウィンドウで開く", POPOUT_SVG, () => void popOutTab(entry, found)));
  if (file !== undefined && !file.outside) {
    const [path, from] = [`${file.path.replace(/\/+$/, "")}/${file.relative}`, file.relative];
    items.push({ ...item("パスのコピー", COPY_PATH_SVG, () => void copyText(path, "パスをコピーしました")), divider: items.length > 0 }, item("相対パスをコピー", COPY_PATH_SVG, () => void copyText(from, "相対パスをコピーしました")));
  }
  if (items.length > 0) openMenu(anchor, items);
}

// ---- the windows of the tabs (A-46) ----

// What the window of the tab `t` of the project `project` shows, null for a tab that has no window to show (a Claude session and a terminal that have a terminal do, a file: the scratchpad's too, and one outside the worktree that has its server, and a diff, a definition and a database tab, which the window reads again from their conditions).
function popoutTab(t: Tab, project: string): PopoutTab | null {
  const place = projectPlace(project);
  const doc = { tab: t.id, project, title: t.title, status: "done" as const, label: "", environment: t.environment };
  if (t.kind === "diff") {
    const d = diffsOf(place, project).find((x) => x.id === t.id);
    return d === undefined ? null : { ...doc, content: { kind: "diff", path: d.path, relative: d.relative, commit: d.commit } };
  }
  if (t.kind === "definition") {
    const d = definitionsOf(place, project).find((x) => x.id === t.id);
    if (d === undefined) return null;
    const { tab: _asked, ...query } = d.query;
    return { ...doc, content: { kind: "definition", ...query } };
  }
  // A task's tab is the Todo screen's kind of window (T-11): its id, its project `todo` and its place are fixed, and it shows the task as Todoist has it.
  if (t.kind === "todo") {
    const k = todoTabsOf(place, project).find((x) => x.id === t.id);
    return k === undefined ? null : { tab: `todo:${k.taskId}`, project: "todo", title: t.title, status: "done", label: "", environment: null, content: { kind: "todo", id: k.taskId } };
  }
  if (t.kind === "database") {
    const d = databaseTabsOf(place, project).find((x) => x.id === t.id);
    return d === undefined ? null : { ...doc, content: { kind: "database", ...conditionOf(d) } };
  }
  if (t.kind === "file") {
    const f = filesOf(projectPlace(project), project).find((x) => x.id === t.id);
    if (f === undefined || (f.outside && f.server === null)) return null;
    return { tab: t.id, project, title: t.title, status: "done", label: "", environment: t.environment, content: { kind: "file", path: f.path, relative: f.relative, server: f.outside ? f.server : null } };
  }
  if ((t.kind !== "claude" && t.kind !== "plain") || t.handle === null) return null;
  const terminal = { handle: t.handle, path: t.path, stream: streamsEnvironment(t.environment), ended: isEnded(t) };
  return { tab: t.id, project, title: t.title, status: t.status, label: t.label, environment: t.environment, content: t.kind === "claude" ? { kind: "claude", ...terminal } : { kind: "terminal", ...terminal } };
}

// The tab of a window as the list has it now: its terminal is the one that stays when its id changes (a plain terminal where Claude starts). null when the list no longer has it; undefined when the list of its place cannot say.
function lookPopout(entry: PopoutTab): PopoutTab | null | undefined {
  // A file is no row of the list: its window holds it until it is closed.
  if (entry.content.kind === "file") return entry;
  const documents = entry.content.kind === "diff" || entry.content.kind === "definition" || entry.content.kind === "database";
  // A diff, a definition and a database tab are kept by this screen (not read from the list): the window follows the tab, which a new question of the definition tab changes.
  if (!documents && !listRead(projectPlace(entry.project))) return undefined;
  const tabs = tabsOf(entry.project);
  const handle = entry.content.kind === "claude" || entry.content.kind === "terminal" ? entry.content.handle : null;
  const found = tabs.find((t) => t.id === entry.tab) ?? (handle === null ? undefined : tabs.find((t) => t.handle === handle));
  return found === undefined ? null : popoutTab(found, entry.project);
}

// Puts the tab in a window. A file is saved first, as a close saves it, and leaves the editor of this page (the page of the window opens it again, A-46): a save that failed or was refused keeps the tab in its pane.
async function popOutTab(entry: PopoutTab, tab: Tab) {
  // A task that has a window already, from either screen, brings it to the front and keeps the tab; else the tab leaves the pane and the window shows the task (A-49).
  if (entry.content.kind === "todo") {
    if (focusPopout(entry.tab)) return;
    await closeTab(tab);
    return popOut(entry, true);
  }
  if (entry.content.kind === "file" && !((await saveFile(entry.tab)) && (await closeFile(entry.tab)))) return;
  await popOut(entry);
}

// Opens a file in the editor, with the id its tab already has when a window gives it back; a file that a window holds is not opened a second time: the id of its tab is given, and `chooseTab` brings the window to the front.
function openEditorFile(target: string | null, project: string, path: string, relative: string, outside: string | null = null, id?: string) {
  return awayFile(target, project, path, relative, outside !== null) ?? openFileHere(target, project, path, relative, outside, id);
}

// The editor of a file window asked for the definition of a name (A-34): the definition tab is made in the project of the file, in its pane when that project is selected.
function askPopoutDefinition(query: DefinitionQuery) {
  if (view === null) return;
  if (projectKey === query.project) askDefinition(query);
  else {
    openDefinition(query);
    draw();
  }
}

// The definition tab of a window asked to open a place (A-46): it opens in the pane of the project of the question when that project is selected, and otherwise as a tab of that project, which its pane shows when it is selected.
function openPopoutPlace(place: DefinitionOpen) {
  if (view === null) return;
  if (projectKey === place.query.project) return openPlace(place);
  const { query, path, outside, line, character } = place;
  const id = openEditorFile(query.target, query.project, query.path, path, outside ? query.server : null);
  if (focusPopout(id)) return;
  draw();
  goTo(id, line, character);
}

// A file whose window was put back, or could not be made, is opened again in its pane with the id it had, so the layout gives it its place.
function reopenFile(entry: PopoutTab) {
  if (entry.content.kind === "file") openEditorFile(entry.environment, entry.project, entry.content.path, entry.content.relative, entry.content.server, entry.tab);
}

// The red button of a window closes its tab as the × of its pane does; a tab that the list no longer has is closed already.
async function closeWindowTab(project: string, id: string) {
  const tab = tabsOf(project).find((t) => t.id === id);
  return tab === undefined || closeTab(tab);
}

// Reads the AI CLIs of the places of the lists (A-16): this machine, and the target when it is a saved environment that is listed. A place that left the lists is forgotten and its read is dropped; nothing is read while another screen is shown, or the command is missing.
// A place that was read (well or not) is read again only by `force` (the screen being shown), never by the clock, and then only when its list could not be read or was read a minute ago or more.
function readAgents(force: boolean) {
  const want = view === null || view.state === "missing" ? [] : [null, ...(view.target !== null && view.environments.includes(view.target) ? [view.target] : [])];
  for (const place of [...agentLists.keys(), ...agentReads.keys()]) {
    if (want.includes(place)) continue;
    agentLists.delete(place);
    agentReadAt.delete(place);
    agentReads.delete(place);
  }
  if (!listShown()) return;
  const stale = (place: string | null) => agentLists.get(place) === null || Date.now() - agentReadAt.get(place)! >= AGENTS_TRUST_MS;
  for (const place of want) if (!agentReads.has(place) && (!agentLists.has(place) || (force && stale(place)))) readAgentsOf(place);
}

function readAgentsOf(place: string | null) {
  const take = (agents: OrcaAgent[] | null, error?: unknown) => {
    // Dropped: the place left the lists, or a newer read of it took its turn.
    if (agentReads.get(place) !== read) return;
    agentReads.delete(place);
    // The screen was left meanwhile: nothing is kept or shown.
    if (!listShown()) return;
    agentLists.set(place, agents);
    agentReadAt.set(place, Date.now());
    // A place whose read of the list failed says so on its card already.
    if (agents === null) readFailed(place) ? logError("orca", error) : showFailure("orca", error);
  };
  const read: Promise<void> = invoke("orca_agents_installed", { environment: place }).then(
    (agents) => take(agents),
    (e) => take(null, e),
  );
  agentReads.set(place, read);
}

// The plus (A-16, A-29): a row of the icons of "ターミナルを開く" and "スクラッチパッド" above a line and the rows of the AI CLIs that the place of the selected project can start ("Claude を起動" first, when it is listed; a line that says so when the list could not be read). The terminal, Claude and the other CLIs start in a worktree of the project selected in the list pane, and the scratchpad is a file of that worktree.
// A place whose list was never read is waited for first.
async function openStartMenu(anchor: Element) {
  if (view === null || projectKey === null) return;
  const from = projectKey;
  const place = projectPlace(from);
  if (!agentLists.has(place) && !agentReads.has(place)) readAgents(false);
  await agentReads.get(place);
  if (view === null || projectKey !== from) return;
  const list = agentLists.get(place);
  if (list === undefined) return;
  const row = (label: string, icon: string, pick: (worktree: OrcaWorktree) => unknown): MenuItem => ({ label, color: "var(--accent)", icon, current: false, pick: () => void chooseWorktree(anchor, pick) });
  const rows: MenuItem[] = [
    ...(list?.some((a) => a.id === "claude") ? [row("Claude を起動", withClass(CLAUDE_SVG, "orca-start-claude"), (w) => start("claude", w))] : []),
    ...(list ?? []).filter((a) => a.id !== "claude").map((a) => row(`${a.name} を起動`, AGENT_SVG, (w) => start("agent", w, a.id))),
  ];
  openMenu(
    anchor,
    rows,
    {
      icons: [
        { label: "ターミナルを開く", icon: TERMINAL_SVG, pick: () => void chooseWorktree(anchor, (w) => start("terminal", w)) },
        { label: "スクラッチパッド", icon: SCRATCHPAD_SVG, pick: () => void chooseWorktree(anchor, (w) => askScratchpad(anchor, w.path, placeOf(w))) },
      ],
    },
  );
}

// A project with one worktree acts in it at once; with none or more than one, the dialog of the worktrees narrowed to the project's asks (a project with none says so there). The worktrees of the formations' children are not among them (A-16, A-37); the list of the formations is waited for only when it was never read, and is read again behind the choice when it is not recent.
async function chooseWorktree(anchor: Element, act: (worktree: OrcaWorktree) => void) {
  if (view === null || projectKey === null) return;
  const from = projectKey;
  await readForChoice();
  if (view === null || projectKey !== from) return;
  const mine = mix.worktrees.filter((w) => w.projectKey === projectKey && !inChildWorktree(w));
  if (mine.length === 1) act(mine[0]);
  else openWorktreeDialog(anchor, mine, null, act);
}

// Asks for the name of the scratchpad file in the worktree at `path` (A-29). The file opens in the project that was selected when it was asked for; a selection made meanwhile leaves it made and not opened.
function askScratchpad(anchor: Element, path: string, environment: string | null) {
  if (view === null || projectKey === null) return;
  const from = projectKey;
  openScratchpad(anchor, { path, environment }, (file) => {
    if (projectKey !== from || projectPlace(from) !== environment) return;
    started = null;
    const id = openEditorFile(environment, from, path, file);
    chooseTab(id);
    draw();
    rereadScratchpad(environment, path);
  });
}

// Starts Claude (with no first prompt: the user types it in the terminal), another AI CLI (`agent`, A-16) or a plain terminal in the worktree, once; a failure shows its message. The project and its tab stay selected, and the new tab is followed: once the list holds it, it is selected.
async function start(kind: StartKind, worktree: OrcaWorktree, agent?: string) {
  if (busy || startWaits() || view === null) return;
  const { path } = worktree;
  const target = placeOf(worktree);
  const [from, tab] = [projectKey, selectedTab()];
  busy = true;
  started = null;
  draw();
  try {
    const launched = kind === "agent" ? await invoke("orca_agent_launch", { path, agent: agent!, environment: target }) : await invoke(kind === "claude" ? "orca_start" : "orca_terminal_create", { path, environment: target });
    // A selection made while the start was on its way is not left for the new tab.
    if (projectKey === from && selectedTab() === tab) {
      started = { kind, paneKey: launched.paneKey, handle: launched.handle, target, until: Date.now() + START_WAIT_MS };
      // A streamed list that held the new tab before this reply came is matched now; no event is to come for it.
      claimStarted();
    }
    reread(target);
  } catch (e) {
    showFailure("orca", e);
  } finally {
    busy = false;
    draw();
  }
}

// A-34: the Claude tab that the language server part started in the worktree of `target` (or found again, which Rust answers when the tab of that worktree and language is still listed) is followed as the plus follows its start: once the list holds it, it is selected. The list is read at once, so a new tab appears and an old one is selected again.
function followLsp(launched: OrcaStarted, target: string | null) {
  started = { kind: "claude", paneKey: launched.paneKey, handle: launched.handle, target, until: Date.now() + START_WAIT_MS };
  claimStarted();
  reread(target);
}

// An icon of the strip (A-18) opens the file pane on its part. The pressed icon is hidden by the draw, so the focus goes on to the icon of the same part in the top row of the pane.
function openFilesAndDraw(next: FilesMode) {
  openFilesAs(next);
  draw();
  document.getElementById(`orca-files-mode-${next}`)?.focus({ preventScroll: true });
}

// The button of the file pane (A-18) is in the top row of the pane while it is shown, and at the right end of the tab strip of the corner pane while it is hidden.
// The pressed button is hidden by the draw, so the focus goes on to the button that is shown now.
function toggleFilesAndDraw() {
  const focused = document.activeElement?.classList.contains("orca-files-toggle") ?? false;
  toggleFiles();
  draw();
  if (focused) {
    const shown = [...document.querySelectorAll<HTMLElement>(".orca-files-toggle")].find((b) => b.offsetParent !== null);
    shown?.focus({ preventScroll: true });
  }
}

// The button that opens the list again while a formation is shown (A-23, A-37): the tab strip of the work pane, which has it otherwise, is hidden then, so the head of the leader's pane has the same button, only while the list is closed.
function drawFormationToggle() {
  const button = $("formation-list-toggle");
  button.hidden = listOpen;
  drawListToggle(button, listOpen);
}

// Closes the list of projects with its divider, or opens it again (A-23). The divider's ratio is kept, so the list opens at the width it had.
// The pressed button is hidden by it, so the focus goes on to the button that is shown now.
function toggleList() {
  const focused = document.activeElement?.classList.contains("list-toggle") ?? false;
  listOpen = !listOpen;
  $("orca-list").hidden = !listOpen;
  $("orca-split").hidden = !listOpen;
  drawListToggle($("orca-list-toggle"), listOpen);
  drawFormationToggle();
  draw();
  if (focused) {
    const shown = [...document.querySelectorAll<HTMLElement>(".list-toggle")].find((b) => b.offsetParent !== null);
    shown?.focus({ preventScroll: true });
  }
}

// ---- the search field (A-19) ----

const searchInput = () => $<HTMLInputElement>("orca-search-input");

// What a change of the text or of the row the keys are on redraws: the field and the list. The work pane does not change with it.
function drawSearchList() {
  drawSearch();
  drawFeed();
}

// Ends the search: the list is the whole list again (the field stays as it is).
function clearSearch() {
  query = "";
  cursor = null;
  searchInput().value = "";
  drawSearchList();
}

// Opens the field in place of the heading's row, and gives it the focus with its text selected.
function openSearch() {
  searchOpen = true;
  drawSearch();
  searchInput().focus();
  searchInput().select();
}

// Clears the text and shows the heading's row again.
function closeSearch() {
  searchOpen = false;
  clearSearch();
}

// ⌘J: the list opens if it is closed, and the field opens and takes the focus.
function focusSearch() {
  if (!listOpen) toggleList();
  draw();
  openSearch();
}

// ↑ and ↓ move the row the keys are on along the rows the search leaves, and stop at the first and the last.
function moveCursor(step: number) {
  const keys = reachable();
  const at = cursorKey();
  if (at === null) return;
  cursor = keys[Math.min(keys.length - 1, Math.max(0, keys.indexOf(at) + step))];
  drawSearchList();
  feed().querySelector('[data-cursor="true"]')?.scrollIntoView({ block: "nearest" });
}

function initSearch() {
  const input = searchInput();
  input.oninput = () => {
    query = input.value;
    cursor = null;
    drawSearchList();
  };
  input.onkeydown = (e) => {
    if (composing(e)) return;
    if (e.key === "Escape") {
      closeSearch();
      input.blur();
    } else if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      e.preventDefault();
      moveCursor(e.key === "ArrowDown" ? 1 : -1);
    } else if (e.key === "Enter") {
      const key = cursorKey();
      if (key !== null) selectProject(key);
    }
  };
  // The focus left the field with no text in it: the heading's row comes back. A window that lost the focus keeps the field as the active element, and keeps it open.
  input.onblur = () =>
    setTimeout(() => {
      if (searchOpen && input.value === "" && document.activeElement !== input) closeSearch();
    }, 0);
  $("orca-search-open").onclick = openSearch;
  $("orca-bell").onclick = () => {
    activeOnly = !activeOnly;
    drawBell();
    drawFeed();
  };
  $("orca-search-clear").onclick = () => {
    clearSearch();
    input.focus();
  };
  // Capture phase, so that a terminal or the editor with the focus does not take the key first.
  document.addEventListener(
    "keydown",
    (e) => {
      if (!listShown() || e.key !== "j" || !(isMac ? e.metaKey : e.ctrlKey) || e.altKey || e.shiftKey || composing(e)) return;
      e.preventDefault();
      e.stopPropagation();
      focusSearch();
    },
    true,
  );
}

export function initOrca() {
  initOrcaTerminal((e) => showFailure("orca", e), (source, uri) => void openTerminalLink(source, uri).catch((e) => showFailure("orca", e)));
  initPeek(statusIcon, selectSession);
  initWorkTodoPopout((id) => {
    if (todoState.taskById.has(id)) openTodoTask(id);
  });
  initOrcaTodo({ open: openTodoTask, changed: draw });
  initPopout({ changed: draw, close: closeWindowTab, reopen: reopenFile, definition: askPopoutDefinition, place: openPopoutPlace, lost: (id, error) => void lostConnection(id, error), failed: (e) => showFailure("orca", e) });
  initSplit($("orca"), $("orca-split"), { side: "left", min: 0.15, max: 0.5, initial: 0.19, property: "--list-w" });
  initSplit($("orca"), $("orca-files-split"), { side: "right", min: 0.15, max: 0.4, initial: 0.22, property: "--files-w" });
  initOrcaEditor({ changed: draw, error: (e) => showFailure("orca", e), definition: askDefinition, serve: (target, project, path, server) => void ensureServer({ target, project, path }, server), mayAsk });
  initLsp({ changed: ({ target, project }) => resolveServers(target, project), started: followLsp });
  initDefinition({ open: openPlace });
  initDatabaseTabs({ lost: (id, error) => void lostConnection(id, error) });
  initOrcaDatabase({ table: openDatabaseTable, query: openDatabaseQuery, gone: (id) => {
      if (closeConnectionTabs(id)) draw();
    } });
  // A new ticket was made in its tab (J-2, #874): the tab is selected, with the key as its title.
  initJiraTab({
    created: (t) => {
      if (projectKey === t.project && projectPlace(t.project) === t.target) chooseTab(t.id);
      draw();
    },
  });
  initOrcaFiles({ open: (relative) => openFile(relative), jira: openJiraIssue, newJira: openNewJiraTicket, diff: (relative) => openDiff(relative), commitDiff: openDiff, toggle: toggleFilesAndDraw,
    // A-25: after the app's own switch the tabs shown are read again with the tree, and the list (a streamed one is read again by Rust, which the switch told).
    // A git worktree that Orca's list lacks is on the branch the switch made, which the list cannot say.
    switched: (here, branch) => {
      const git = gitWorktrees.get(gitKey(here.target, here.path));
      if (git !== undefined) git.gitBranch = branch;
      rereadTabs();
      void refreshOrca(true);
    },
    // A-25: a worktree picked in the list of branches is shown in the file pane, for as long as the tab selected now stays selected. One that Orca's list lacks is named after the project and its folder.
    picked: (here, worktree) => {
      if (projectKey === null) return;
      const listed = mix.worktrees.find((w) => w.path === worktree.path && placeOf(w) === here.target);
      const name = mix.projects.find((p) => p.key === projectKey)?.name ?? "";
      const label = listed !== undefined ? worktreeLabel(listed) : worktreeLabel({ repo: name, branch: worktree.name });
      if (listed === undefined) gitWorktrees.set(gitKey(here.target, worktree.path), { project: here.project, target: here.target, path: worktree.path, label, gitBranch: worktree.gitBranch });
      pickedWorktree = { project: projectKey, tab: selectedTab() ?? "", target: here.target, path: worktree.path, label };
      draw();
    },
    // A-25: a git worktree that the answer of the list of branches does not hold any more is forgotten.
    read: (here, read) => {
      for (const [key, git] of gitWorktrees) {
        if (git.project === here.project && git.target === here.target && !read.some((w) => w.path === git.path)) gitWorktrees.delete(key);
      }
    },
    moved: rereadTabs,
    watching: watchFiles,
    // One draw for the whole delete, not one for each entry whose tabs closed.
    deleted: (here, deleted) => {
      let closed = false;
      for (const { relative, folder } of deleted) closed = discardFiles(here.target, here.project, here.path, relative, folder) || closed;
      if (closed) draw();
    },
    // A-18: the tabs of the files that a move takes along wait with their saves, and take the new path (and the new name of the tab) when it is done.
    moving: async (here, relative) => {
      const release = await holdFiles(here.target, here.project, here.path, relative);
      return (to) => {
        if (release(to)) draw();
      };
    },
  });
  // The clock and the first read of the list run while the development screen is on in the menu (A-50). Turning it off stops them and ends the streams; turning it on reads the list again.
  let clock: number | null = null;
  const onVisible = () => {
    // A session shown again after the window was hidden is seen.
    drawBadge();
    refresh();
    watchFiles();
  };
  whileOn(
    "orca",
    () => {
      clock = window.setInterval(refresh, (1000 * shownMs()) / SHOWN_MS);
      document.addEventListener("visibilitychange", onVisible);
      load("full");
    },
    () => {
      if (clock !== null) window.clearInterval(clock);
      clock = null;
      document.removeEventListener("visibilitychange", onVisible);
      // The read on its way is dropped, the connections of the streams are closed, and the count goes.
      loadSeq++;
      loading = false;
      syncStream();
      workingCount = 0;
      hereWorking = 0;
      waitingCount = 0;
      notified.clear();
      drawBadge();
    },
  );
  // The files and the history of the file pane are read again when the app is activated (A-18, A-27), and by the clock (`refresh`), as nothing watches the disk.
  window.addEventListener("focus", () => shown() && refreshFiles());
  initSearch();
  const toggle = listToggle("プロジェクト一覧", toggleList);
  toggle.id = "orca-list-toggle";
  drawListToggle(toggle, listOpen);
  $("orca-header").prepend(toggle);
  const inFormation = listToggle("プロジェクト一覧", toggleList);
  inFormation.id = "formation-list-toggle";
  $("formation-head").prepend(inFormation);
  drawFormationToggle();
  const add = $("orca-add");
  // The places are this Mac and the target when it is a saved environment: those are the lists the screen reads again after the add (A-33).
  add.onclick = () => openAddProject(add, view !== null && view.target !== null && view.environments.includes(view.target) ? [view.target] : [], () => void load("full", true));
  initPaneTree($("orca-panes"), {
    plus: (anchor, pane) => {
      focusPane(pane);
      void openStartMenu(anchor);
    },
    files: toggleFilesAndDraw,
    mode: openFilesAndDraw,
    list: toggleList,
    focus: focusPane,
    move: (tab, pane, edge) => runPaneOp({ kind: "move", tab, pane, edge }),
    resize: (before, after, share) => {
      const op: PaneOp = { kind: "resize", before, after, share };
      if (projectKey !== null && view !== null) applyLocal(projectPlace(projectKey), projectKey, op);
      runPaneOp(op);
    },
    menu: openTabMenu,
  });
  void loadTitles();
}
