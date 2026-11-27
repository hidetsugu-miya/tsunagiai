// The file pane of the Orca screen (A-18): the files of the worktree of the selected tab (with no tab, the main worktree of the selected project), as a tree on the right of the work pane. Rust reads a folder (`orca_files_list`: its entries sorted) and, after it, which of them git ignores (`orca_files_ignored`) and which differ from HEAD (`orca_files_changes`, A-39); this module draws the folder at once, marks the ignored and the changed entries when the answers come, and takes the presses.
// A folder is read the first time it is opened and drawn from what was read after that, and the root and then the open folders are read again, side by side (at most `reads()` at a time), when the window gets the focus back and, while the pane is shown, by the clock of the Orca screen (`refreshFiles`, called by orca.ts), after the app's own create, delete and move, and after a switch of the branch, the app's own or one the list of Orca shows (`syncFiles`). A read by the clock or for a branch that changed outside the app says nothing when it fails (what is shown stays). Where the Orca screen streams (A-12), the disk is watched (`orca-watch.ts`, Orca's `files.watch`) and the folders that hold a path that changed or lie above it (read ones, not in an ignored folder) are read again at once (`rereadTree`), and the clock does not read the tree while its worktree is watched, unless a folder of `node_modules` or `.git` is open (Orca does not watch them), but it still asks the marks of the folders that were read (`rereadChanges`), because a commit is no change that Orca tells; elsewhere nothing watches the disk. A press on a row selects it (with ⌘ it adds the row to the selection or takes it off, with Shift it selects the rows from the one pressed before), and the selected rows are drawn in the accent color. A file opens in the editor on a double press, and the right button on a row opens the menu that copies its path (and, on a file, downloads it; on a folder, first makes a new file or folder in it, as the right button on the empty part of the tree does in the root; on a row that differs from HEAD, after a line, stages it, unstages it and puts it back, which asks first, A-44; last, after a line, 「移動・名前の変更」, which turns the row into a field with its path from the worktree, and the delete, which asks first and deletes for good, A-18; on several selected rows the menu is the delete alone, as the Delete key is, A-18). A row is also moved by dragging it onto a folder's row or onto the empty part of the tree (the root of the worktree). The pane is shown or hidden by the button in its top row while it is shown, and by the button at the right end of the tab strip of the corner pane while it is hidden.
// A file or folder dragged in from outside is put in the folder under the pointer (A-47, `putDropped`): the tree is a drop zone of `orca-attach.ts`, marks the folder with `data-drop` as a dragged row does, asks about each name that is taken, and shows the progress above the tree.
// The tree belongs to one worktree of one target: another tab's worktree gives a new tree (nothing is kept of the old one, and an answer that comes late for the old one is dropped).
// The top row also has the three buttons that choose what the pane shows under the heading, the files, the history of the worktree (A-27, orca-history.ts) or the language server of the worktree (A-34, orca-lsp.ts), a fourth for the connections of the database screen (A-43, orca-database.ts) and a fifth for the tickets of Jira (J-2, orca-jira.ts), which belong to no worktree and hide the heading; the choice is kept in memory only, and the heading serves the files, the history and the language server, and so do the reads at the return of the focus and by the clock (`refreshFiles`), which the language server and the connections have none of, and the tickets have none by the clock (the focus tries again a first read that failed).
import type { OrcaDeleteEntry } from "./bindings/OrcaDeleteEntry";
import type { OrcaDeleted } from "./bindings/OrcaDeleted";
import type { OrcaDir } from "./bindings/OrcaDir";
import type { OrcaFileEntry } from "./bindings/OrcaFileEntry";
import type { OrcaGitChange } from "./bindings/OrcaGitChange";
import type { OrcaGitMark } from "./bindings/OrcaGitMark";
import type { OrcaGitWorktree } from "./bindings/OrcaGitWorktree";
import { $, composing, tag } from "./dom.js";
import { confirmDelete, confirmDeleteMany, confirmRevert } from "./hint.js";
import { BRANCH_SVG, CHEVRON_SVG, COPY_PATH_SVG, DATABASE_SVG, DELETE_SVG, DIFF_SVG, DOWNLOAD_SVG, FILE_SVG, FOLDER_SVG, MINUS_CIRCLE_SVG, MOVE_SVG, OPEN_SVG, PLUS_SVG, RETURN_SVG, SERVER_SVG, TICKET_SVG } from "./icons.js";
import { invoke } from "./ipc.js";
import { openMenu } from "./menu.js";
import { closeBranchDialog, openBranchDialog } from "./orca-branch.js";
import type { DiffCommit } from "./orca-diff.js";
import { checkHistory, initHistory, refreshHistory, reloadHistory, syncHistory } from "./orca-history.js";
import { syncOrcaDatabase } from "./orca-database.js";
import { initOrcaJira, refreshOrcaJira, syncOrcaJira } from "./orca-jira.js";
import { syncLsp } from "./orca-lsp.js";
import { type Dropped, fileBase64, listenForDrops } from "./orca-attach.js";
import { toast } from "./toast.js";
import { showFailure } from "./error-card.js";
import { copyText } from "./view.js";

// The worktree shown (the selected tab's, else the selected project's main one), with the name its heading shows ("{repo} ・ {branch}"). `branch` is the git branch of the worktree, which the heading makes a button (A-25), null where it stays text (a worktree the list does not hold, or one on no branch); `project` is the key of the project of the worktree.
export interface FilesContext {
  target: string | null;
  path: string;
  label: string;
  project: string;
  branch: string | null;
}

// What was read of a folder: its entries (kept while it is read again), the message of a read that failed, and whether one is on its way.
interface Listing {
  dir: OrcaDir | null;
  error: string | null;
  busy: boolean;
}

let shown = false;
// What the pane shows under the heading.
let mode: "files" | "history" | "server" | "database" | "jira" = "files";
let context: FilesContext | null = null;
// A new tree (another worktree) ends the reads of the old one.
let generation = 0;
const listings = new Map<string, Listing>();
// How git sees the entries that differ from HEAD (A-39), by path from the worktree. It outlives the listings, so a read again keeps the marks until the answer replaces them. `asked` counts the questions of each folder, so that only the last answer is taken.
const changes = new Map<string, OrcaGitMark>();
const asked = new Map<string, number>();
const expanded = new Set<string>();
// The rows that are selected (A-18), by path from the worktree, with whether each is a folder, in the order they were selected; and the row a Shift press counts from (the last one pressed without Shift). A row that is not drawn any more (its folder closed, or it is gone) leaves the selection, so what is deleted is what is drawn selected.
const selected = new Map<string, boolean>();
let anchor: string | null = null;
// What the pane draws now; it is drawn again only when this changes.
let drawn = "";
let version = 0;
// Whether a drawing is waiting for the next frame (the reads that end in it are drawn once).
let waiting = false;
// The name being typed for a new file or folder (A-18): the first row of the folder `dir`. `text` is what is typed (kept while the tree is drawn again), `busy` that the create is on its way.
interface Creating {
  dir: string;
  folder: boolean;
  text: string;
  busy: boolean;
}
let creating: Creating | null = null;
// The path being typed for a move or a new name (A-18): the row of `from` is the field. `text` is what is typed (it starts as `from`), `busy` that the move is on its way.
interface Renaming {
  from: string;
  folder: boolean;
  text: string;
  busy: boolean;
}
let renaming: Renaming | null = null;
// Whether a move is on its way (one at a time).
let moving = false;
// The folder a dragged row would be dropped in ("" is the root of the worktree), which is drawn as the place of the drop; null while nothing is dragged over one.
let dropDir: string | null = null;
// A-47: a drop from outside is on its way (from the drop to its end, the questions included), and the files of it that are put: the folder, how many are put of how many. A drop is not taken while one is on its way.
let dropBusy = false;
let dropping: { dir: string; done: number; total: number } | null = null;
// The question about a name that is taken (A-47) while it is open: closing it answers "skip".
let asking: { skip: () => void } | null = null;
// A drag starts once the pointer has moved this far from its press, and a closed folder under a dragged row opens after this long.
const DRAG_PX = 5;
const DRAG_OPEN_MS = 600;
// Whether the tree is being replaced: the loss of the field that goes with it is not a blur of the owner.
let redrawing = false;
let openFile: (relative: string) => void = () => {};
let openDiff: (relative: string) => void = () => {};
let branchSwitched: (here: FilesContext, branch: string) => void = () => {};
// Told that a worktree was picked in the list of branches (A-25): the screen shows it in this pane.
let worktreePicked: (here: FilesContext, worktree: OrcaGitWorktree) => void = () => {};
// Told the answer of the list of branches for the worktrees of the project (A-25).
let worktreesRead: (here: FilesContext, worktrees: OrcaGitWorktree[]) => void = () => {};
// Told that the list of Orca shows another branch for the worktree than the pane knew (a switch made outside the app): the tabs of its files are read again.
let branchMoved: () => void = () => {};
// Told that the part of the pane changed, so the watch of the disk follows what is shown (A-18).
let modeChanged: () => void = () => {};
// A change of the disk came while the tree was being read (A-18): it is read once more when that ends.
let treeAgain = false;
// The branch the app itself just switched the worktree to: the tree and the history were read for it then, so the list that shows it starts no second read.
let switchedTo: string | null = null;
// Told that the entries `deleted` (each a file, or with `folder` the folder and everything under it) are gone, so the tabs of the editor that hold them close, and the screen is drawn once.
let gone: (here: FilesContext, deleted: OrcaDeleteEntry[]) => void = () => {};
// Told that `relative` is about to be moved: the editor holds the saves of the files it takes along, and the function it answers is called when the move is over, with the new place or with null when it failed.
let hold: (here: FilesContext, relative: string) => Promise<(to: string | null) => void> = async () => () => {};
// The heading as it is drawn (the label and the branch), so that the branch button stays while the list under it is open.
let drawnTitle = "";
// The files open in the worktree, which the last drawing colored.
let opened = new Set<string>();

export const filesShown = () => shown;

export function toggleFiles() {
  shown = !shown;
  $("orca-files").hidden = !shown;
  $("orca-files-split").hidden = !shown;
  syncModes();
}

// Shows the part of the pane that is chosen, and starts the read of it that is due: the history is read only while it is shown, the root of the tree only while the files are, and the language server and the connections only while they are shown.
function syncModes() {
  const part = shownPart();
  $("orca-files-tree").hidden = part !== "files";
  $("orca-history").hidden = part !== "history";
  $("orca-server").hidden = part !== "server";
  $("orca-database").hidden = part !== "database";
  $("orca-jira").hidden = part !== "jira";
  $("orca-files-head").hidden = part === "database" || part === "jira";
  for (const [name, button] of [["files", "orca-files-mode-files"], ["history", "orca-files-mode-history"], ["server", "orca-files-mode-server"], ["database", "orca-files-mode-database"], ["jira", "orca-files-mode-jira"]] as const) $(button).setAttribute("aria-pressed", String(part === name));
  syncHistory(context === null ? null : { target: context.target, path: context.path }, shown && part === "history");
  syncLsp(context === null ? null : { target: context.target, project: context.project, path: context.path }, shown && part === "server");
  syncOrcaDatabase(shown && part === "database");
  syncOrcaJira(shown && part === "jira", context === null ? null : { environment: context.target, project: context.project });
  drawDrop();
  if (shown && part === "files" && context !== null && !listings.has("")) void readDir("");
}

// The part of the pane that is shown: the choice.
const shownPart = () => mode;
const showsHistory = () => shownPart() === "history";

function chooseMode(next: "files" | "history" | "server" | "database" | "jira") {
  if (mode === next) return;
  mode = next;
  syncModes();
  modeChanged();
}

// Whether the list marked the folder `dir` as ignored (what it holds is ignored then, and Rust does not ask git).
function ignoredDir(dir: string) {
  const parent = dir.slice(0, Math.max(0, dir.lastIndexOf("/")));
  return listings.get(parent)?.dir?.entries.find((e) => e.path === dir)?.ignored ?? false;
}

// Draws at the next frame, once for the reads that end before it.
function drawSoon() {
  if (waiting) return;
  waiting = true;
  requestAnimationFrame(() => {
    waiting = false;
    draw();
  });
}

// Marks the entries of `read`, the folder `dir` as it was listed, that git ignores, and takes the mark off the ones it does not name (`read` may hold the marks of the earlier listing, `readDir`). It is asked after the folder is drawn, and an answer that fails leaves `read` as it is. The answer is dropped when the tree is another worktree's by then, or the folder was read again, and nothing is drawn when it names the entries that are marked already.
async function markIgnored(here: FilesContext, mine: number, dir: string, read: OrcaDir) {
  let paths: string[];
  try {
    paths = await invoke("orca_files_ignored", { path: here.path, paths: read.entries.map((e) => e.path), environment: here.target });
  } catch {
    return;
  }
  const listing = listings.get(dir);
  if (mine !== generation || listing?.dir !== read) return;
  const ignored = new Set(paths);
  if (read.entries.every((e) => e.ignored === ignored.has(e.path))) return;
  listings.set(dir, { ...listing, dir: { ...read, entries: read.entries.map((e) => ({ ...e, ignored: ignored.has(e.path) })) } });
  version++;
  drawSoon();
}

// A folder as it was listed, whose marks of differences are to be asked, with the number of its question (taken when it was listed, so that the folder that was listed last is the one that is answered).
interface Listed {
  dir: string;
  read: OrcaDir;
  token: number;
}

// How many paths one question of `orca_files_changes` takes at most (the limit of a list in Rust).
const CHANGES_LIMIT = 5000;

// Takes the marks of the entries of the folders `listed`, each as it was listed, from `orca_files_changes` (A-39): an entry the answer does not name loses its mark. The folders of one read go in one question (one `git.status` of the worktree, not one for each folder), and in several only when their entries pass CHANGES_LIMIT. It is asked after the folders are drawn, and an answer that fails leaves the marks as they are. Only the last question of a folder (the one whose number `readDir` took last) is answered, and an answer that comes after the tree became another worktree's, or the folder was dropped, is dropped. Nothing is drawn when the marks are the ones shown.
async function markChanges(here: FilesContext, mine: number, listed: Listed[]) {
  const groups: Listed[][] = [];
  let size = 0;
  for (const l of listed) {
    if (groups.length === 0 || size + l.read.entries.length > CHANGES_LIMIT) {
      groups.push([]);
      size = 0;
    }
    groups[groups.length - 1].push(l);
    size += l.read.entries.length;
  }
  await Promise.all(groups.map((group) => markGroup(here, mine, group)));
}

async function markGroup(here: FilesContext, mine: number, group: Listed[]) {
  let answer: OrcaGitChange[];
  try {
    answer = await invoke("orca_files_changes", { path: here.path, paths: group.flatMap((l) => l.read.entries.map((e) => e.path)), environment: here.target });
  } catch {
    return;
  }
  if (mine !== generation) return;
  const now = new Map(answer.map((c) => [c.path, c.mark]));
  let moved = false;
  for (const { dir, read, token } of group) {
    if (asked.get(dir) !== token || !listings.has(dir)) continue;
    for (const e of read.entries) {
      const mark = now.get(e.path);
      if (changes.get(e.path) === mark) continue;
      moved = true;
      if (mark === undefined) changes.delete(e.path);
      else changes.set(e.path, mark);
    }
  }
  if (!moved) return;
  version++;
  drawSoon();
}

// The entries of the folder `dir` of the worktree.
const listDir = (here: FilesContext, dir: string, ignored: boolean): Promise<OrcaDir> => invoke("orca_files_list", { path: here.path, dir, ignored, environment: here.target });

// Reads the folder `dir`. With `quiet` (the clock, and a branch that changed outside the app) a read that fails says nothing and keeps what the folder shows, when it was read before. With `clock` (the clock alone) a read that finds the entries held asks no ignore marks. With `pending` (the read of a reload) the folder is put there to have its marks of differences asked with the others, once; without it they are asked for this folder alone.
async function readDir(dir: string, quiet = false, clock = false, pending?: Listed[]) {
  const here = context;
  if (here === null) return;
  const mine = generation;
  const held = listings.get(dir);
  // What a folder that the list marked as ignored holds is ignored too, and Rust does not ask git for it.
  const inherited = ignoredDir(dir);
  listings.set(dir, { dir: held?.dir ?? null, error: null, busy: true });
  let next: Listing;
  try {
    const read = await listDir(here, dir, inherited);
    // The entries that the earlier listing marked as ignored keep the mark until the answer of git replaces it, so that a reload does not blink it away.
    const was = new Set(held?.dir?.entries.filter((e) => e.ignored).map((e) => e.path));
    next = { dir: inherited || was.size === 0 ? read : { ...read, entries: read.entries.map((e) => (was.has(e.path) ? { ...e, ignored: true } : e)) }, error: null, busy: false };
  } catch (e) {
    if (quiet && held !== undefined) {
      if (mine === generation && listings.get(dir)?.busy) listings.set(dir, { ...held, busy: false });
      return;
    }
    next = { dir: held?.dir ?? null, error: String(e), busy: false };
  }
  if (mine !== generation) return;
  if (next.error !== null) showFailure("orca-files", next.error);
  // A read that finds what is held (the same entries in the same order, and as many in the folder) keeps it, marks and all, and draws nothing.
  const was = held?.dir;
  const now = next.dir;
  const same = held?.error === null && next.error === null && was != null && now !== null && was.total === now.total && was.entries.length === now.entries.length && was.entries.every((e, i) => e.path === now.entries[i].path && e.isDirectory === now.entries[i].isDirectory);
  if (same) {
    next = { ...next, dir: was };
    listings.set(dir, next);
  } else {
    listings.set(dir, next);
    version++;
    drawSoon();
  }
  if (inherited || next.dir === null || next.error !== null || next.dir.entries.length === 0) return;
  // The differences from HEAD can change with no change of the entries (a file is edited), so the clock asks for them too, for all the folders in one question.
  const token = (asked.get(dir) ?? 0) + 1;
  asked.set(dir, token);
  const listed = { dir, read: next.dir, token };
  if (pending) pending.push(listed);
  else void markChanges(here, mine, [listed]);
  // The clock does not ask git again for the ignore marks of a folder that holds what it held: they are asked for at the next read that is not the clock's.
  if (!(same && clock)) void markIgnored(here, mine, dir, next.dir);
}

// Whether the question of the clock is still on its way: the clock asks nothing more until it is answered (A-18, "Nothing is read twice at once"), so that a slow `git.status` is answered and not asked over again.
let changesBusy = false;

// Asks again the marks (A-39) of the entries of every folder that was read, in one question and with no read of the folders: the clock does it while the watch of the worktree is ready, because a commit made outside the app changes no file that Orca tells and clears the marks. It leaves a folder that is being read (its read asks), one that the list marked as ignored, and a folder that holds nothing or failed; the answer is dropped by the guards of `markGroup`. It asks nothing while the pane does not show the tree.
export function rereadChanges() {
  const here = context;
  if (changesBusy || treeWatch() === null || here === null) return;
  const listed: Listed[] = [];
  for (const [dir, { dir: read, error, busy }] of listings) {
    if (busy || error !== null || read === null || read.entries.length === 0 || ignoredDir(dir)) continue;
    const token = (asked.get(dir) ?? 0) + 1;
    asked.set(dir, token);
    listed.push({ dir, read, token });
  }
  if (listed.length === 0) return;
  changesBusy = true;
  void markChanges(here, generation, listed).finally(() => {
    changesBusy = false;
  });
}

// How many folders a read of the open folders takes at once, as Orca's own window does: 16 on this machine, 8 on a saved environment (its connection is a paired server's).
const reads = (here: FilesContext) => (here.target === null ? 16 : 8);

// Reads the root, and when it is read the folders that are open again, side by side (with `only`, the folders it names alone). The root goes first alone, so that the check of the worktree that its read may start is done once, not once for each folder read at the same time. A folder that was read and is closed is dropped, so that it is read when it is opened next. Another worktree's tree ends it. `quiet` and `clock`: see `readDir`.
async function reload(quiet = false, clock = false, only?: string[]) {
  const here = context;
  if (here === null) return;
  const mine = generation;
  const queue = only === undefined ? [...expanded] : only.filter((dir) => dir !== "");
  for (const dir of [...listings.keys()]) if (dir !== "" && !expanded.has(dir)) listings.delete(dir);
  const pending: Listed[] = [];
  if (only === undefined || only.includes("")) await readDir("", quiet, clock, pending);
  const worker = async () => {
    for (let dir = queue.shift(); dir !== undefined; dir = queue.shift()) {
      if (mine !== generation) return;
      await readDir(dir, quiet, clock, pending);
    }
  };
  await Promise.all(Array.from({ length: Math.min(queue.length, reads(here)) }, worker));
  // The differences from HEAD of every folder that was read are asked once, so that a read of many open folders runs one `git.status`.
  if (mine === generation && pending.length > 0) void markChanges(here, mine, pending);
  if (treeAgain && mine === generation) {
    treeAgain = false;
    void reload(true, true);
  }
}

// Reads again what the pane shows, when the window gets the focus back: the files (the root, then the open folders) or the history (from the start). It does nothing while the pane is hidden or has no worktree, and while a read of the same kind is on its way, so a failed read is tried again at the next return.
// With `clock` it is the read of the clock of the Orca screen (A-18, A-27), which says nothing: the tree is drawn again only where a folder changed, the history only when its first commits are not the ones held (`checkHistory`), and a read that fails keeps what is shown.
export function refreshFiles(clock = false) {
  if (!shown || context === null) return;
  if (shownPart() === "jira") {
    if (!clock) refreshOrcaJira();
    return;
  }
  if (shownPart() === "server" || shownPart() === "database") return;
  if (showsHistory()) {
    if (clock) void checkHistory();
    else refreshHistory();
  } else if (![...listings.values()].some((l) => l.busy)) void reload(clock, clock);
}

// The worktree whose tree the pane shows now (null: none), whose disk the watch of Orca tells about (A-18): the history, the language server and the connections have no tree.
export const treeWatch = () => (shown && context !== null && shownPart() === "files" ? { target: context.target, path: context.path } : null);

// Whether the folder `dir`, or a folder it lies in, was marked as ignored by the list: Orca's watch tells of what changes there (a build writes there without a pause), and it is not read.
function inIgnored(dir: string) {
  for (let up = dir; up !== ""; up = parentOf(up)) if (ignoredDir(up)) return true;
  return false;
}

// The folders that are open (a folder of `node_modules` or `.git` among them is read by the clock, because Orca does not watch it).
export const openFolders = () => [...expanded];

// The folders that were read and that hold `relative` or lie above it, up to the root: none when the folder that holds it is in an ignored folder.
function readAbove(relative: string) {
  const found: string[] = [];
  const own = parentOf(relative);
  if (inIgnored(own)) return found;
  for (let up = own; ; up = parentOf(up)) {
    if (listings.has(up)) found.push(up);
    if (up === "") return found;
  }
}

// Reads the tree again, without a word, because the watch of the disk told a change (A-18), as the clock reads it. `relatives` are the paths that changed, from the worktree: only the folders that hold one of them or lie above it and that were read (the root, and the open folders) are read, so that the mark of a folder row (A-39) follows a file deep in it, and a path in an ignored folder reads none; null reads the root and the open folders. A read that is on its way is followed by a read of all of them.
export function rereadTree(relatives: string[] | null) {
  if (treeWatch() === null) return;
  const dirs = relatives === null ? null : [...new Set(relatives.flatMap(readAbove))];
  const read = dirs === null ? [...listings.keys()] : dirs;
  if (read.some((dir) => listings.get(dir)?.busy)) treeAgain = true;
  else if (dirs === null) void reload(true, true);
  else if (dirs.length > 0) void reload(true, true, dirs);
}

// A scratchpad file was made in `.orca/scratchpad` of the worktree at `path` (A-29): when the tree is that worktree's, the folders on the way to it that it has read are read again, the root first, so that a folder that was not there shows now.
export function rereadScratchpad(target: string | null, path: string) {
  if (context === null || context.path !== path || context.target !== target) return;
  const mine = generation;
  const here = context;
  void (async () => {
    const pending: Listed[] = [];
    for (const dir of ["", ".orca", ".orca/scratchpad"]) if (listings.has(dir)) await readDir(dir, false, false, pending);
    if (mine === generation && pending.length > 0) void markChanges(here, mine, pending);
  })();
}

// Opens the folder: it is drawn from what was read (the next return of the focus reads it again; a folder whose read failed is read again when it is opened), waited for while it is being read, and read when it was not.
function expandDir(path: string) {
  expanded.add(path);
  const held = listings.get(path);
  if (held !== undefined && (held.busy || (held.dir !== null && held.error === null))) {
    version++;
    draw();
  } else {
    void readDir(path);
  }
}

function toggleDir(path: string) {
  if (expanded.has(path)) {
    expanded.delete(path);
    version++;
    draw();
  } else {
    expandDir(path);
  }
}

// Asks for the name of a new file or folder in `dir`: the folder is opened (and read when it was not), and the first row in it is the field.
function startCreate(dir: string, folder: boolean) {
  if (context === null || renaming?.busy) return;
  renaming = null;
  creating = { dir, folder, text: "", busy: false };
  if (dir !== "") expandDir(dir);
  else if (!listings.has("")) void readDir("");
  version++;
  draw();
  focusField(true);
}

function cancelCreate() {
  if (creating === null || creating.busy) return;
  creating = null;
  version++;
  draw();
}

// Makes the file or folder named by the field. A blank name is a cancel. Rust checks the name, and a name that is taken is its error: the field goes and the message is shown. After it is made the folder is read again, and a new file opens in the editor.
async function submitCreate() {
  const here = context;
  const field = creating;
  if (here === null || field === null || field.busy) return;
  const name = field.text.trim();
  if (name === "") return cancelCreate();
  field.busy = true;
  const mine = generation;
  try {
    const relative = await invoke("orca_file_create", { path: here.path, dir: field.dir, name, folder: field.folder, environment: here.target });
    if (mine !== generation) return;
    if (creating === field) {
      creating = null;
      version++;
    }
    await readDir(field.dir);
    draw();
    if (!field.folder && mine === generation) openFile(relative);
  } catch (e) {
    if (mine !== generation) return;
    if (creating === field) creating = null;
    version++;
    draw();
    showFailure("orca-files", e);
  }
}

// A row with a field in place of the name: Enter and the loss of the keys inside the window (while the field is still `current`) run `submit`, Escape runs `cancel`. The loss of the keys that comes with the window going to the back runs nothing, and the field stays.
function fieldRow(depth: number, field: { text: string; folder: boolean }, label: string, current: () => boolean, submit: () => unknown, cancel: () => void) {
  const line = tag("div", "orca-file-new");
  line.style.setProperty("--depth", String(depth));
  const input = tag("input", "orca-file-input");
  input.type = "text";
  input.value = field.text;
  input.autocomplete = "off";
  input.spellcheck = false;
  input.setAttribute("aria-label", label);
  input.oninput = () => {
    field.text = input.value;
  };
  input.onkeydown = (e) => {
    if (composing(e)) return;
    if (e.key === "Enter") {
      e.preventDefault();
      void submit();
    } else if (e.key === "Escape") {
      e.preventDefault();
      e.stopPropagation();
      cancel();
    }
  };
  input.onblur = () => {
    if (!redrawing && document.hasFocus() && current()) void submit();
  };
  line.append(tag("span", "orca-file-mark"), icon(field.folder ? FOLDER_SVG : FILE_SVG), input);
  return line;
}

// The row with the field of the name being typed. Leaving the field with a name typed makes it, and with none cancels it.
const createRow = (depth: number, field: Creating) => fieldRow(depth, field, field.folder ? "新しいフォルダーの名前" : "新しいファイルの名前", () => creating === field, submitCreate, cancelCreate);

// The row of the entry that is being moved or named anew: the field holds its path from the worktree. Leaving the field with another path typed moves it, and with the same or none cancels it.
const renameRow = (depth: number, field: Renaming) => fieldRow(depth, field, "移動先のパス", () => renaming === field, submitRename, cancelRename);

// Puts the keys in the field of the name. `scroll` brings it into view (it was just asked for), and `select` is the part of its text that is selected (none: the caret is at the end).
function focusField(scroll: boolean, select?: [number, number]) {
  const input = $("orca-files-tree").querySelector<HTMLInputElement>(".orca-file-input");
  if (input === null) return;
  input.focus({ preventScroll: !scroll });
  input.setSelectionRange(select?.[0] ?? input.value.length, select?.[1] ?? input.value.length);
  if (scroll) input.scrollIntoView({ block: "nearest" });
}

const parentOf = (relative: string) => relative.slice(0, Math.max(0, relative.lastIndexOf("/")));

// Moves the file or folder `from` to `to` (both from the worktree; Orca's `files.rename`, which overwrites nothing, so a taken place is Rust's error). The editor holds the saves of the open files it takes along until the answer comes, and they follow to the new place. After it what was read of a moved folder is dropped (its open folders stay open at the new place and are read there), and the folder it left and the one it went to are read again: of the target, the nearest folder that was read, so that a folder made on the way shows. The folder it left is read first, alone, and the others side by side, as `reload` does. A worktree that is not the tree's any more only moves the tabs.
async function move(here: FilesContext, from: string, to: string, folder: boolean) {
  if (moving) return;
  moving = true;
  const mine = generation;
  try {
    const release = await hold(here, from);
    try {
      await invoke("orca_file_move", { path: here.path, from, to, environment: here.target });
    } catch (e) {
      release(null);
      if (mine === generation) showFailure("orca-files", e);
      return;
    }
    release(to);
  } finally {
    moving = false;
  }
  if (mine !== generation) return;
  const under = (path: string) => path === from || path.startsWith(`${from}/`);
  const reopened: string[] = [];
  if (folder) {
    for (const path of [...listings.keys()]) if (under(path)) listings.delete(path);
    for (const path of [...expanded].filter(under)) {
      expanded.delete(path);
      expanded.add(to + path.slice(from.length));
      reopened.push(to + path.slice(from.length));
    }
    if (creating !== null && under(creating.dir)) creating = null;
  }
  let target = parentOf(to);
  while (target !== "" && !listings.has(target)) target = parentOf(target);
  const [first, ...queue] = new Set([parentOf(from), target, ...reopened]);
  const pending: Listed[] = [];
  await readDir(first, false, false, pending);
  const worker = async () => {
    for (let dir = queue.shift(); dir !== undefined; dir = queue.shift()) {
      if (mine !== generation) return;
      await readDir(dir, false, false, pending);
    }
  };
  await Promise.all(Array.from({ length: Math.min(queue.length, reads(here)) }, worker));
  if (mine === generation && pending.length > 0) void markChanges(here, mine, pending);
}

// Turns the row of `relative` into the field of its path from the worktree, with the name selected (a file's without its extension).
function startRename(relative: string, folder: boolean) {
  if (context === null || creating?.busy || renaming?.busy) return;
  creating = null;
  renaming = { from: relative, folder, text: relative, busy: false };
  version++;
  draw();
  const start = relative.lastIndexOf("/") + 1;
  const dot = relative.lastIndexOf(".");
  focusField(true, [start, folder || dot <= start ? relative.length : dot]);
}

function cancelRename() {
  if (renaming === null || renaming.busy) return;
  renaming = null;
  version++;
  draw();
}

// Moves the entry to the path of the field. A blank path and the path it has are a cancel. Rust checks the path; the field goes when the answer comes, and a failure is shown. While another move (a drag's) is on its way nothing is asked and the field stays.
async function submitRename() {
  const here = context;
  const field = renaming;
  if (here === null || field === null || field.busy) return;
  const to = field.text.trim();
  if (to === "" || to === field.from) return cancelRename();
  if (moving) return;
  field.busy = true;
  await move(here, field.from, to, field.folder);
  if (renaming !== field) return;
  renaming = null;
  version++;
  draw();
}

// The folder a row dragged from `from` would go to at `at`, the element under the pointer: the folder of the row under it, or the root of the worktree on the part of the tree with no row. Null where nothing is dropped: outside the tree, on a file's row, on the folder the entry is in already, on itself and inside itself.
function dropAt(at: Element | null, from: string) {
  if (at === null || !$("orca-files-tree").contains(at)) return null;
  const over = at.closest<HTMLElement>(".orca-file");
  if (over !== null && over.dataset.kind !== "dir") return null;
  const dir = over?.dataset.path ?? "";
  return dir === parentOf(from) || dir === from || dir.startsWith(`${from}/`) ? null : dir;
}

// Marks the folder of the drop: its row, or the tree for the root of the worktree.
function showDrop(dir: string | null) {
  if (dir === dropDir) return;
  dropDir = dir;
  const tree = $("orca-files-tree");
  for (const marked of tree.querySelectorAll("[data-drop]")) marked.removeAttribute("data-drop");
  if (dir === "") tree.dataset.drop = "true";
  else delete tree.dataset.drop;
  if (dir) tree.querySelector<HTMLElement>(`.orca-file[data-path="${CSS.escape(dir)}"]`)?.setAttribute("data-drop", "true");
}

// A press on a row that moves past a few pixels drags the entry (A-18): its name follows the pointer, the folder it would go to is marked, and a closed folder the pointer rests on opens. The release moves it into the marked folder, and does nothing elsewhere; Escape or a cancel ends the drag.
function startDrag(down: PointerEvent, entry: OrcaFileEntry) {
  const here = context;
  if (down.button !== 0 || here === null || moving) return;
  const mine = generation;
  let ghost: HTMLElement | null = null;
  let rest: { dir: string; timer: number } | null = null;
  const unrest = () => {
    if (rest !== null) clearTimeout(rest.timer);
    rest = null;
  };
  const end = () => {
    document.removeEventListener("pointermove", moved);
    document.removeEventListener("pointerup", up);
    document.removeEventListener("pointercancel", end);
    document.removeEventListener("keydown", key);
    document.body.classList.remove("orca-dragging");
    unrest();
    ghost?.remove();
    showDrop(null);
  };
  const moved = (e: PointerEvent) => {
    if (mine !== generation) return end();
    if (ghost === null) {
      if (Math.hypot(e.clientX - down.clientX, e.clientY - down.clientY) < DRAG_PX) return;
      ghost = tag("div", "orca-file-drag", entry.name);
      document.body.append(ghost);
      document.body.classList.add("orca-dragging");
    }
    Object.assign(ghost.style, { left: `${e.clientX + 10}px`, top: `${e.clientY + 8}px` });
    const at = document.elementFromPoint(e.clientX, e.clientY);
    showDrop(dropAt(at, entry.path));
    // A closed folder under the pointer (not the dragged one or one inside it) opens when the pointer stays on it.
    const over = at?.closest<HTMLElement>('#orca-files-tree .orca-file[data-kind="dir"][aria-expanded="false"]');
    const dir = over?.dataset.path;
    if (dir === undefined || dir === entry.path || dir.startsWith(`${entry.path}/`)) return unrest();
    if (rest?.dir === dir) return;
    unrest();
    rest = {
      dir,
      timer: window.setTimeout(() => {
        rest = null;
        if (mine === generation && !expanded.has(dir)) expandDir(dir);
      }, DRAG_OPEN_MS),
    };
  };
  const up = (e: PointerEvent) => {
    const dragged = ghost !== null;
    end();
    if (!dragged) return;
    // The click that follows the release would open or close the folder under it.
    const swallow = (c: Event) => c.stopPropagation();
    window.addEventListener("click", swallow, { capture: true, once: true });
    setTimeout(() => window.removeEventListener("click", swallow, true), 0);
    const dir = mine === generation ? dropAt(document.elementFromPoint(e.clientX, e.clientY), entry.path) : null;
    if (dir !== null) void move(here, entry.path, dir === "" ? entry.name : `${dir}/${entry.name}`, entry.isDirectory);
  };
  const key = (e: KeyboardEvent) => e.key === "Escape" && end();
  document.addEventListener("pointermove", moved);
  document.addEventListener("pointerup", up);
  document.addEventListener("pointercancel", end);
  document.addEventListener("keydown", key);
}

// A-47: the folder a drop at `target`, the element under the pointer, goes to: the folder of a folder's row, the folder that holds a file's row, and the root of the worktree ("") on the part of the tree with no row.
function dropDirAt(target: EventTarget | null) {
  const over = (target as Element | null)?.closest<HTMLElement>(".orca-file");
  if (over === null || over === undefined) return "";
  const path = over.dataset.path ?? "";
  return over.dataset.kind === "dir" ? path : parentOf(path);
}

// A-47: how a folder is named in the words of a drop: its path, and the worktree's own folder by the name of the project.
function folderName(dir: string) {
  if (dir !== "") return `${dir}/`;
  const here = context;
  if (here === null) return "";
  const end = ` ・ ${here.branch}`;
  return `${here.branch !== null && here.label.endsWith(end) ? here.label.slice(0, here.label.length - end.length) : here.label}/`;
}

// A-47: the line above the tree while a drop is put: the folder, how many files are put of how many, and the bar.
function drawDrop() {
  const now = dropping;
  const live = now !== null && shownPart() === "files";
  $("orca-drop").hidden = !live;
  if (!live) return;
  $("orca-drop-label").textContent = `${folderName(now.dir)} に置いています`;
  $("orca-drop-count").textContent = `${now.done} / ${now.total}`;
  $("orca-drop-fill").style.width = `${now.total === 0 ? 100 : (now.done / now.total) * 100}%`;
}

// A-47: what the owner answered for a file whose name is taken in the folder: replace it, put it under another name, or leave it; `all` is that the rest of the drop that is taken is answered the same way.
type Answer = "overwrite" | "copy" | "skip";

// Asks about the file `name`, which the folder `dir` holds already, with `left` more such files after it (the checkbox for them is there when it is not 0). What is there is a folder when `folder` is true, and a folder is not replaced by a file, so the question has no 「上書き」. The question is a card over the tree; Escape leaves the file, and so does the end of the tree.
function askTaken(dir: string, name: string, left: number, folder: boolean): Promise<{ answer: Answer; all: boolean }> {
  return new Promise((resolve) => {
    const where = folderName(dir);
    const is = folder ? "フォルダーとして" : "";
    const pop = tag("div", "pop orca-drop-pop");
    pop.setAttribute("role", "alertdialog");
    pop.setAttribute("aria-label", `${name} は ${where} に${is}もうあります`);
    const text = tag("p");
    text.append(tag("b", "", name), ` は ${where} に${is}もうあります。`);
    pop.append(text);
    const check = tag("input");
    check.type = "checkbox";
    if (left > 0) {
      const label = tag("label", "orca-drop-all");
      label.append(check, `残りの ${left} 件も同じにする`);
      pop.append(label);
    }
    const key = (e: KeyboardEvent) => {
      if (e.key !== "Escape" || composing(e)) return;
      e.preventDefault();
      e.stopImmediatePropagation();
      done("skip");
    };
    const done = (answer: Answer) => {
      window.removeEventListener("keydown", key, true);
      pop.remove();
      asking = null;
      resolve({ answer, all: check.checked });
    };
    const actions = tag("div", "popup-actions");
    const choices: [string, Answer, string][] = [["やめる", "skip", ""], ["別名で置く", "copy", ""]];
    if (!folder) choices.push(["上書き", "overwrite", " danger"]);
    const buttons = choices.map(([label, answer, extra]) => {
      const button = tag("button", `text-btn${extra}`, label);
      button.type = "button";
      button.onclick = () => done(answer);
      return button;
    });
    actions.append(...buttons);
    pop.append(actions);
    window.addEventListener("keydown", key, true);
    asking = { skip: () => done("skip") };
    document.body.append(pop);
    const r = $("orca-files-tree").getBoundingClientRect();
    const width = Math.min(320, r.width - 16);
    Object.assign(pop.style, { width: `${width}px`, left: `${r.left + (r.width - width) / 2}px`, top: `${r.top + 24}px` });
    buttons[0].focus();
  });
}

// A-47: the words of a card for the files `names` that are not put, for `why`.
const refused = (names: string[], why: string) => `${names[0]}${names.length > 1 ? ` ほか ${names.length - 1} 件` : ""} ${why}`;

// A-47: the most one drop holds (files, and bytes in all), and the most one file is (the same as A-10's).
const DROP_FILES = 1000;
const DROP_BYTES = 200 * 1024 * 1024;
const DROP_FILE = 20 * 1024 * 1024;

// A-47: `dir` and `sub` (a folder inside what was dropped, "" for none) as one path of the worktree.
const joinDir = (dir: string, sub: string) => (dir === "" ? sub : sub === "" ? dir : `${dir}/${sub}`);

// A-47: puts what was dropped in the folder `dir` of the worktree: the files, and the folders with what is in them in the same layout. A drop over the number or the total puts nothing, a file over 20 MiB is left with a card, and for each name that a folder holds the owner is asked (all the questions come before the first folder is made or the first file goes). The folders are made first, then the files are put one after another, and each one's row appears as soon as it is put: the folders that are shown are read again while the next file goes (at most one read at a time). A failure shows its card and stops at that file. A tree that became another worktree's ends it.
async function putDropped(dir: string, read: Promise<Dropped>) {
  const here = context;
  if (here === null || dropBusy) {
    read.catch(() => {});
    return;
  }
  dropBusy = true;
  const mine = generation;
  // The read of the folders that is on its way while files are put (the closure of `reread` sets it, so the type is stated to keep the checks from taking it for null), and the folders that wait for the next read.
  let reading = null as Promise<void> | null;
  const stale = new Set<string>();
  const reread = (...dirs: string[]) => {
    for (const d of dirs) if (d === dir || listings.has(d)) stale.add(d);
    if (reading !== null) return;
    reading = (async () => {
      while (stale.size > 0 && mine === generation) {
        const next = [...stale];
        stale.clear();
        for (const d of next) await readDir(d, true);
      }
      reading = null;
    })();
  };
  try {
    const dropped = await read;
    const total = dropped.files.reduce((sum, f) => sum + f.file.size, 0);
    if (dropped.over || total > DROP_BYTES) return showFailure("orca-files", "一度に置けるのは 1,000 ファイル、合計 200 MiB までです");
    const big = dropped.files.filter((f) => f.file.size > DROP_FILE);
    if (big.length > 0) showFailure("orca-files", refused(big.map((f) => f.file.name), "は 20 MiB を超えるので置けません"));
    const files = dropped.files.filter((f) => f.file.size <= DROP_FILE).map((f) => ({ file: f.file, dir: joinDir(dir, f.dir), top: f.dir.split("/")[0] }));
    if (files.length === 0 && dropped.folders.length === 0) return;
    // Which names are taken: the names the drop puts in `dir` itself (a folder's name too, so that one that is there is known), then the files of each folder of the drop, only where the folder of the drop is there already (a folder that is new holds nothing).
    // The taken names are keyed by folder and name, and hold whether what is there is a folder (read from the folder's listing; null when the listing does not show it, as when Orca's page was full). A folder's listing is read once, for all the questions of that folder.
    const taken = new Map<string, boolean | null>();
    const listed = new Map<string, Map<string, boolean>>();
    const ask = async (where: string, names: string[]) => {
      for (let at = 0; at < names.length; at += DROP_FILES) {
        const found = await invoke("orca_drop_taken", { path: here.path, dir: where, names: names.slice(at, at + DROP_FILES), environment: here.target });
        if (found.length === 0) continue;
        let kinds = listed.get(where);
        if (kinds === undefined) {
          kinds = new Map((await listDir(here, where, false)).entries.map((e) => [e.name, e.isDirectory]));
          listed.set(where, kinds);
        }
        for (const name of found) taken.set(`${where}\n${name}`, kinds.get(name) ?? null);
      }
    };
    const own = [...files.filter((f) => f.dir === dir).map((f) => f.file.name), ...dropped.folders.filter((f) => !f.includes("/"))];
    if (own.length > 0) await ask(dir, own);
    if (mine !== generation) return;
    // A name that is a file there holds nothing, so nothing is asked under it (the questions would be answered by an error of Orca, not by a name).
    const there = new Set(own.filter((name) => taken.has(`${dir}\n${name}`) && taken.get(`${dir}\n${name}`) !== false));
    // In each folder of the drop under a folder that is there: its files, and the folders of the drop directly under it.
    const inside = new Map<string, string[]>();
    const put = (where: string, name: string) => inside.set(where, [...(inside.get(where) ?? []), name]);
    for (const f of files) if (f.dir !== dir && there.has(f.top)) put(f.dir, f.file.name);
    for (const f of dropped.folders) if (f.includes("/") && there.has(f.split("/")[0])) put(joinDir(dir, f.slice(0, f.lastIndexOf("/"))), f.slice(f.lastIndexOf("/") + 1));
    // The folders nearer the folder under the pointer are asked first, so that a folder that is a file there is known before the folders under it are asked about.
    const underFile = (where: string) => {
      const parts = where.slice(dir === "" ? 0 : dir.length + 1).split("/");
      return parts.some((name, i) => taken.get(`${joinDir(dir, parts.slice(0, i).join("/"))}\n${name}`) === false);
    };
    for (const [where, names] of [...inside].sort((a, b) => a[0].split("/").length - b[0].split("/").length)) {
      if (underFile(where)) continue;
      await ask(where, names);
      if (mine !== generation) return;
    }
    // A folder of the drop whose name is a file there is not put, and nothing is, so the drop stops before a question is asked.
    const clash = dropped.folders.filter((f) => taken.get(`${joinDir(dir, f.slice(0, Math.max(f.lastIndexOf("/"), 0)))}\n${f.slice(f.lastIndexOf("/") + 1)}`) === false);
    if (clash.length > 0) return showFailure("orca-files", refused(clash, "と同じ名前のファイルが置き先にあるので、何も置きません"));
    const plan: { file: File; dir: string; onTaken: "overwrite" | "copy" }[] = [];
    let same: Answer | null = null;
    let left = files.filter((f) => taken.has(`${f.dir}\n${f.file.name}`)).length;
    for (const { file, dir: where } of files) {
      if (!taken.has(`${where}\n${file.name}`)) {
        plan.push({ file, dir: where, onTaken: "copy" });
        continue;
      }
      left--;
      // A folder is never replaced by a file, so "replace" answered for the rest does not reach a file whose name is a folder there.
      const folder = taken.get(`${where}\n${file.name}`) === true;
      let answer: Answer | null = same === "overwrite" && folder ? null : same;
      if (answer === null) {
        const reply = await askTaken(where, file.name, left, folder);
        if (mine !== generation) return;
        answer = reply.answer;
        if (reply.all) same = answer;
      }
      if (answer !== "skip") plan.push({ file, dir: where, onTaken: answer });
    }
    if (plan.length === 0 && dropped.folders.length === 0) return;
    const progress = { dir, done: 0, total: plan.length };
    dropping = progress;
    version++;
    if (dir !== "") expandDir(dir);
    draw();
    drawDrop();
    // A folder that holds no other folder of the drop is made with the folders on the way, so each folder of the drop is made by one of these.
    for (const folder of dropped.folders.filter((f) => !dropped.folders.some((g) => g.startsWith(`${f}/`)))) {
      await invoke("orca_drop_dir", { path: here.path, dir: joinDir(dir, folder), environment: here.target });
      if (mine !== generation) return;
    }
    if (dropped.folders.length > 0) reread(dir);
    for (const { file, dir: where, onTaken } of plan) {
      const data = await fileBase64(file);
      await invoke("orca_drop_file", { path: here.path, dir: where, name: file.name, data, onTaken, environment: here.target });
      if (mine !== generation) return;
      progress.done++;
      drawDrop();
      reread(dir, where);
    }
  } catch (e) {
    if (mine === generation) showFailure("orca-files", e);
  } finally {
    await reading;
    dropBusy = false;
    if (mine === generation) {
      dropping = null;
      version++;
      draw();
      drawDrop();
    }
  }
}

// Saves the file to this PC (A-22): Rust opens the save dialog and writes where it says, so the page names no place. Nothing is shown when the dialog is cancelled.
async function download(here: FilesContext, relative: string) {
  try {
    const name = await invoke("orca_file_download", { path: here.path, relative, environment: here.target });
    if (name !== null) toast(`${name} をダウンロードしました`);
  } catch (e) {
    showFailure("orca-files", e);
  }
}

// Opens the HTML file in the default browser of this PC (A-31): Rust serves the worktree and hands the address to the system, so nothing is said when it works (the browser comes to the front).
const openInBrowser = (here: FilesContext, relative: string) => invoke("orca_file_open_in_browser", { path: here.path, relative, environment: here.target }).catch((e) => showFailure("orca-files", e));

// Deletes the files and folders for good (Orca's `files.delete`, which skips the Trash) once the confirmation has been answered. What is gone leaves the editor and the tree: a folder's reads are dropped, and the folders they were in are read again, side by side. Where one entry fails Rust stops there, so what was deleted before it is drawn as gone and the message is shown. A worktree that is not the tree's any more only closes the tabs.
async function remove(here: FilesContext, entries: OrcaDeleteEntry[]) {
  const mine = generation;
  let answer: OrcaDeleted;
  try {
    answer = await invoke("orca_files_delete", { path: here.path, entries, environment: here.target });
  } catch (e) {
    if (mine === generation) showFailure("orca-files", e);
    return;
  }
  // The message comes first: closing a tab may show another worktree's tree, which is a new tree.
  if (mine === generation && answer.error !== null) showFailure("orca-files", answer.error);
  gone(here, answer.deleted);
  if (mine !== generation) return;
  for (const { relative, folder } of answer.deleted) {
    if (!folder) continue;
    const under = (path: string) => path === relative || path.startsWith(`${relative}/`);
    for (const path of [...listings.keys()]) if (under(path)) listings.delete(path);
    for (const path of [...expanded]) if (under(path)) expanded.delete(path);
    if (creating !== null && under(creating.dir)) creating = null;
  }
  const queue = [...new Set(answer.deleted.map((d) => parentOf(d.relative)))].filter((dir) => dir === "" || listings.has(dir));
  const pending: Listed[] = [];
  const worker = async () => {
    for (let dir = queue.shift(); dir !== undefined; dir = queue.shift()) {
      if (mine !== generation) return;
      await readDir(dir, false, false, pending);
    }
  };
  await Promise.all(Array.from({ length: Math.min(queue.length, reads(here)) }, worker));
  if (mine === generation && pending.length > 0) void markChanges(here, mine, pending);
}

// A git write of A-44 (stage, unstage or put back) on a file or folder, and then the files are read again, whatever the answer was: a call that failed after another went through leaves what the first did, and the marks and the entries of the tree change with the write (a new file that is put back is gone). Orca's refusal is the message shown. An answer that comes after the tree became another worktree's says nothing and reads nothing.
async function gitWrite(write: () => Promise<null>) {
  const mine = generation;
  try {
    await write();
  } catch (e) {
    if (mine === generation) showFailure("orca-files", e);
  }
  if (mine === generation) void reload();
}

// The rows drawn now, in the order of the tree.
const drawnRows = () => [...$("orca-files-tree").querySelectorAll<HTMLElement>(".orca-file")].map((e) => ({ path: e.dataset.path ?? "", folder: e.dataset.kind === "dir" }));

// Marks the drawn rows of the selection.
function paintSelection() {
  for (const node of $("orca-files-tree").querySelectorAll<HTMLElement>(".orca-file")) node.dataset.selected = String(selected.has(node.dataset.path ?? ""));
}

// Selects by a press on a row (A-18): ⌘ adds the row or takes it off, Shift selects the rows from the anchor to this one (when the anchor is still drawn), and a press with neither selects this row alone. A Shift press keeps the anchor.
function select(entry: OrcaFileEntry, e: MouseEvent) {
  const rows = drawnRows();
  const from = anchor === null ? -1 : rows.findIndex((r) => r.path === anchor);
  const to = rows.findIndex((r) => r.path === entry.path);
  if (e.shiftKey && from !== -1 && to !== -1) {
    selected.clear();
    for (const r of rows.slice(Math.min(from, to), Math.max(from, to) + 1)) selected.set(r.path, r.folder);
  } else if (e.metaKey || e.ctrlKey) {
    if (!selected.delete(entry.path)) selected.set(entry.path, entry.isDirectory);
    anchor = entry.path;
  } else {
    selected.clear();
    selected.set(entry.path, entry.isDirectory);
    anchor = entry.path;
  }
  paintSelection();
}

// Asks before the selected rows are deleted, in the popup under `anchor`: by the name of the row when it is one, by the count when there are more (A-18).
function askDelete(anchor: Element) {
  const here = context;
  const entries = [...selected].map(([relative, folder]) => ({ relative, folder }));
  if (here === null || entries.length === 0) return;
  const done = () => void remove(here, entries);
  if (entries.length === 1) confirmDelete(anchor, entries[0].relative.slice(entries[0].relative.lastIndexOf("/") + 1), done);
  else confirmDeleteMany(anchor, entries.length, done);
}

// The Delete key (and the key that is called delete on a Mac keyboard) on the tree asks to delete the selected rows, under the row that was pressed last. A field of the tree takes its own keys.
function deleteKey(e: KeyboardEvent) {
  if ((e.key !== "Delete" && e.key !== "Backspace") || e.target instanceof HTMLInputElement || composing(e) || selected.size === 0) return;
  const path = anchor !== null && selected.has(anchor) ? anchor : [...selected.keys()][0];
  const name = $("orca-files-tree").querySelector(`.orca-file[data-path="${CSS.escape(path)}"] .orca-file-name`);
  if (name === null) return;
  e.preventDefault();
  askDelete(name);
}

const menuItem = (label: string, icon: string, pick: () => unknown) => ({ label, color: "var(--accent)", icon, current: false, pick });

// The two items that make a new file or folder in the folder `dir` (the empty one is the worktree's root).
const createItems = (dir: string) => [menuItem("新規ファイル", FILE_SVG, () => startCreate(dir, false)), menuItem("新規フォルダー", FOLDER_SVG, () => startCreate(dir, true))];

// The three git writes of A-44 for the row `relative`, with a line above them: only on a row that differs from HEAD (it has a mark, A-39), and none on a row with no difference. Putting back asks first, in the popup under `anchor`, because it cannot be undone and deletes what is new.
function gitItems(here: FilesContext, anchor: Element, relative: string, folder: boolean) {
  const mark = changes.get(relative);
  if (mark === undefined) return [];
  const args = { path: here.path, paths: [relative], environment: here.target };
  const revert = () => confirmRevert(anchor, relative.slice(relative.lastIndexOf("/") + 1), folder, mark === "new", () => void gitWrite(() => invoke("orca_files_revert", args)));
  return [
    { ...menuItem("ステージ", PLUS_SVG, () => void gitWrite(() => invoke("orca_files_stage", args))), divider: true },
    menuItem("ステージ解除", MINUS_CIRCLE_SVG, () => void gitWrite(() => invoke("orca_files_unstage", args))),
    { ...menuItem("変更を元に戻す", RETURN_SVG, revert), danger: true },
  ];
}

// The menu of a row (the right button): on a folder the new file and folder and then, after a line, the copies; on a file the path of the entry on the machine of the worktree, its path from the worktree, the download (not on a file of this machine, A-22), the difference from HEAD (A-24) and, when its name ends with `.html` or `.htm` (whatever the case; Rust refuses any other name), 「ブラウザで開く」 (A-31); on both, when the row differs from HEAD (A-39), after a line, 「ステージ」, 「ステージ解除」 and 「変更を元に戻す」 in red (A-44); and on both, last and after a line, 「移動・名前の変更」 and the delete in red. The menu sets and removes aria-expanded on its anchor, so the anchor is the row's name, not the row, whose own aria-expanded is the state of its folder.
function openRowMenu(anchor: Element, relative: string, isDirectory: boolean) {
  const here = context;
  if (here === null) return;
  const copy = (label: string, text: string, done: string) => menuItem(label, COPY_PATH_SVG, () => void copyText(text, done));
  const del = { ...menuItem(selected.size > 1 ? `${selected.size} 件を削除` : "削除", DELETE_SVG, () => askDelete(anchor)), danger: true };
  // Several rows are selected: the menu is the delete of them, since the other items are of one row.
  if (selected.size > 1) return openMenu(anchor, [del]);
  const rename = { ...menuItem("移動・名前の変更", MOVE_SVG, () => startRename(relative, isDirectory)), divider: true };
  const [path, from] = [copy("パスのコピー", `${here.path.replace(/\/+$/, "")}/${relative}`, "パスをコピーしました"), copy("相対パスをコピー", relative, "相対パスをコピーしました")];
  const git = gitItems(here, anchor, relative, isDirectory);
  if (isDirectory) openMenu(anchor, [...createItems(relative), { ...path, divider: true }, from, ...git, rename, del]);
  else openMenu(anchor, [path, from, ...(here.target === null ? [] : [menuItem("ダウンロード", DOWNLOAD_SVG, () => void download(here, relative))]), menuItem("差分を表示", DIFF_SVG, () => openDiff(relative)), ...(/\.html?$/i.test(relative) ? [menuItem("ブラウザで開く", OPEN_SVG, () => void openInBrowser(here, relative))] : []), ...git, rename, del]);
}

// The menu of the empty part of the tree (the right button): the new file and folder in the root of the worktree, where the pointer is.
function openRootMenu(e: MouseEvent) {
  if (context === null || (e.target as Element).closest(".orca-file, .orca-file-new") !== null) return;
  e.preventDefault();
  openMenu($("orca-files-tree"), createItems(""), { at: { x: e.clientX, y: e.clientY } });
}

function row(entry: OrcaFileEntry, depth: number) {
  const button = tag("button", "orca-file");
  button.type = "button";
  button.dataset.path = entry.path;
  button.dataset.kind = entry.isDirectory ? "dir" : "file";
  button.dataset.ignored = String(entry.ignored);
  button.style.setProperty("--depth", String(depth));
  if (entry.isDirectory && dropDir === entry.path) button.dataset.drop = "true";
  button.onpointerdown = (e) => startDrag(e, entry);
  const name = tag("span", "orca-file-name", entry.name);
  button.dataset.selected = String(selected.has(entry.path));
  button.oncontextmenu = (e) => {
    e.preventDefault();
    // The right button on a row that is not selected selects it alone, as on one that is selected it keeps the selection.
    if (!selected.has(entry.path)) {
      selected.clear();
      selected.set(entry.path, entry.isDirectory);
      anchor = entry.path;
      paintSelection();
    }
    openRowMenu(name, entry.path, entry.isDirectory);
  };
  // A press selects the row, and a press with neither ⌘ nor Shift on a folder opens or closes it too. The row takes the keys (WKWebView does not focus a button on a press), so the Delete key reaches the tree.
  button.onclick = (e) => {
    button.focus({ preventScroll: true });
    select(entry, e);
    if (entry.isDirectory && !e.metaKey && !e.ctrlKey && !e.shiftKey) toggleDir(entry.path);
  };
  const mark = tag("span", "orca-file-mark");
  if (entry.isDirectory) {
    const open = expanded.has(entry.path);
    button.setAttribute("aria-expanded", String(open));
    mark.innerHTML = CHEVRON_SVG;
    button.append(mark, icon(FOLDER_SVG));
  } else {
    button.dataset.open = String(opened.has(entry.path));
    button.append(mark, entry.icon === null ? icon(FILE_SVG) : kindIcon(entry.icon));
    // A file opens on a double press (or Enter), so a single press only selects it.
    button.ondblclick = () => openFile(entry.path);
    button.onkeydown = (e) => {
      if (e.key === "Enter") openFile(entry.path);
    };
  }
  button.append(name);
  if (entry.isDirectory && dropping?.dir === entry.path) button.append(tag("span", "spin orca-file-spin"));
  // A change from HEAD (A-39): the name and the icon take the color, and the right end has `M` or `U` on a file and a dot on a folder.
  const change = changes.get(entry.path);
  if (change !== undefined) {
    button.dataset.change = change;
    button.append(tag("span", "orca-file-git", entry.isDirectory ? "" : change === "new" ? "U" : "M"));
  }
  return button;
}

function icon(svg: string) {
  const node = tag("span", "orca-file-ic");
  node.innerHTML = svg;
  return node;
}

// The icon of a kind of file (A-18): an SVG of JetBrains' that the app holds (src/vendor/jetbrains-icons/), drawn as an image of the same origin. A press and a drag on it are the row's, so it is not an image to drag.
function kindIcon(name: string) {
  const node = tag("span", "orca-file-ic");
  const image = document.createElement("img");
  image.src = `vendor/jetbrains-icons/${name}.svg`;
  image.alt = "";
  image.draggable = false;
  node.append(image);
  return node;
}

function note(text: string, depth: number) {
  const line = tag("p", "orca-file-note", text);
  line.style.setProperty("--depth", String(depth));
  return line;
}

// The rows of the folder `dir` and, under each open folder, its own.
function rows(dir: string, depth: number): HTMLElement[] {
  const listing = listings.get(dir);
  if (!listing) return [];
  const nodes: HTMLElement[] = [];
  if (creating?.dir === dir) nodes.push(createRow(depth, creating));
  if (listing.dir === null) {
    if (listing.busy) {
      const loading = tag("div", "pending");
      loading.append(tag("span", "spin"), tag("span", "sp", "読み込んでいます…"));
      nodes.push(loading);
    }
    return nodes;
  }
  for (const entry of listing.dir.entries) {
    nodes.push(renaming?.from === entry.path ? renameRow(depth, renaming) : row(entry, depth));
    if (entry.isDirectory && expanded.has(entry.path)) nodes.push(...rows(entry.path, depth + 1));
  }
  const more = listing.dir.total - listing.dir.entries.length;
  if (more > 0) nodes.push(note(`ほか ${more} 件`, depth));
  return nodes;
}

// The branch button of the heading: the list of branches opens under it (A-25), and a switch reads the tree again as well as the list of Orca.
function openBranches(anchor: Element) {
  const here = context;
  if (here === null || here.branch === null) return;
  openBranchDialog(
    anchor,
    { target: here.target, path: here.path, repo: here.project, branch: here.branch },
    (branch) => {
      switchedTo = branch;
      void reload();
      reloadHistory();
      branchSwitched(here, branch);
    },
    (worktree) => worktreePicked(here, worktree),
    (worktrees) => worktreesRead(here, worktrees),
  );
}

// Draws the heading: the name, and the git branch as a button when it has one. The branch is the end of the name when Orca's name of the worktree is the branch, else it follows the name.
function drawTitle() {
  const key = JSON.stringify([context?.label, context?.branch]);
  if (key === drawnTitle) return;
  drawnTitle = key;
  const title = $("orca-files-title");
  if (context === null || context.branch === null) {
    title.replaceChildren(tag("span", "", context?.label ?? ""));
    return;
  }
  const button = tag("button", "orca-branch-btn", context.branch);
  button.type = "button";
  button.onclick = () => openBranches(button);
  const separator = " ・ ";
  const named = context.label.endsWith(separator + context.branch);
  const name = tag("span", "", named ? context.label.slice(0, context.label.length - context.branch.length) : `${context.label}${separator}`);
  title.replaceChildren(name, button);
}

// Draws the pane, unless it is what is drawn already.
function draw() {
  const key = JSON.stringify([shown, context, version, [...opened]]);
  if (key === drawn) return;
  drawn = key;
  drawTitle();
  const tree = $("orca-files-tree");
  const top = tree.scrollTop;
  const focused = (document.activeElement as HTMLElement | null)?.dataset?.path;
  // The field that has the keys gets them back in the new tree, with what was selected in it.
  const field = document.activeElement;
  const typing: [number, number] | null = field instanceof HTMLInputElement && field.classList.contains("orca-file-input") ? [field.selectionStart ?? field.value.length, field.selectionEnd ?? field.value.length] : null;
  redrawing = true;
  tree.replaceChildren(...(context === null ? [] : rows("", 0)));
  redrawing = false;
  tree.scrollTop = top;
  const present = new Set(drawnRows().map((r) => r.path));
  for (const path of [...selected.keys()]) if (!present.has(path)) selected.delete(path);
  if (anchor !== null && !present.has(anchor)) anchor = null;
  if (focused) tree.querySelector<HTMLElement>(`[data-path="${CSS.escape(focused)}"]`)?.focus({ preventScroll: true });
  if (typing) focusField(false, typing);
}

// Follows the selected tab: its worktree (null: none), and the files open in it. Another worktree starts a new tree, read at once while the pane is shown.
// The same worktree on another git branch than the pane knew (the list of Orca says so: a switch made outside the app) has its tree and its history read again at once while the pane is shown, without a word, and the screen is told (`branchMoved`); the branch the app itself switched to was read already.
export function syncFiles(next: FilesContext | null, open: Set<string>) {
  opened = open;
  const same = next?.path === context?.path && next?.target === context?.target;
  const moved = same && next != null && context != null && next.branch !== null && context.branch !== null && next.branch !== context.branch;
  if (!same) {
    switchedTo = null;
    treeAgain = false;
    generation++;
    // A drop of the old tree ends: its question closes, its progress goes, and the loop stops at its next step.
    dropping = null;
    asking?.skip();
    listings.clear();
    expanded.clear();
    changes.clear();
    asked.clear();
    creating = null;
    renaming = null;
    selected.clear();
    anchor = null;
    version++;
    // A list of branches is of the worktree that was shown.
    closeBranchDialog();
  }
  context = next;
  syncModes();
  draw();
  if (!moved) return;
  const own = next?.branch === switchedTo;
  switchedTo = null;
  if (own || !shown) return;
  if (![...listings.values()].some((l) => l.busy)) void reload(true);
  refreshHistory();
  branchMoved();
}

export function initOrcaFiles(on: { open: (relative: string) => void; jira: (key: string, boardId: number) => void; newJira: (boardId: number, sprintId: number | null) => void; diff: (relative: string) => void; commitDiff: (relative: string, commit: DiffCommit) => void; toggle: () => void; switched: (here: FilesContext, branch: string) => void; picked: (here: FilesContext, worktree: OrcaGitWorktree) => void; read: (here: FilesContext, worktrees: OrcaGitWorktree[]) => void; moved: () => void; watching: () => void; deleted: (here: FilesContext, deleted: OrcaDeleteEntry[]) => void; moving: (here: FilesContext, relative: string) => Promise<(to: string | null) => void> }) {
  openFile = on.open;
  openDiff = on.diff;
  branchSwitched = on.switched;
  worktreePicked = on.picked;
  worktreesRead = on.read;
  branchMoved = on.moved;
  modeChanged = on.watching;
  gone = on.deleted;
  hold = on.moving;
  initHistory({ open: on.commitDiff });
  $("orca-files-tree").oncontextmenu = openRootMenu;
  $("orca-files-tree").onkeydown = deleteKey;
  listenForDrops($("orca-files-tree"), DROP_FILES, {
    over: (target) => {
      const take = context !== null && !dropBusy && !moving;
      showDrop(take ? dropDirAt(target) : null);
      return take;
    },
    leave: () => showDrop(null),
    drop: (target, read) => void putDropped(dropDirAt(target), read),
  });
  $("orca-files-toggle").innerHTML = FOLDER_SVG;
  $("orca-files-toggle").onclick = on.toggle;
  $("orca-files-mode-files").innerHTML = FILE_SVG;
  $("orca-files-mode-files").onclick = () => chooseMode("files");
  $("orca-files-mode-history").innerHTML = BRANCH_SVG;
  $("orca-files-mode-history").onclick = () => chooseMode("history");
  $("orca-files-mode-server").innerHTML = SERVER_SVG;
  $("orca-files-mode-server").onclick = () => chooseMode("server");
  $("orca-files-mode-database").innerHTML = DATABASE_SVG;
  $("orca-files-mode-database").onclick = () => chooseMode("database");
  $("orca-files-mode-jira").innerHTML = TICKET_SVG;
  $("orca-files-mode-jira").onclick = () => chooseMode("jira");
  initOrcaJira({ open: on.jira, create: on.newJira });
}
