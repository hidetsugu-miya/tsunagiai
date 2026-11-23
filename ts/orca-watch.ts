// A-12, A-18, A-24: the watch of the disk. Where the Orca screen streams (the saved environment that is the target, and this machine once it is paired), each worktree whose files the screen shows (a file in an editor tab, a difference tab, the tree of the file pane) is watched with `orca_stream_files` (Orca's `files.watch`), and a change that Orca tells is read again at once, without a word, by the same quiet reads as the clock's: the files it touches, the differences of the worktree and the tree.
// A watch that is ready takes the place of the clock for the files and the tree of its worktree (`watchReady`), except a file under `node_modules` or `.git` and the tree while a folder of those is open (`unwatched`: Orca does not watch them); the differences stay on the clock too, because a commit moves HEAD with no word of Orca's. A worktree that is not watched, or whose watch is not ready (it has not started, ended or its connection is lost), is read by the clock as before.
// What a change makes the screen read again is narrowed to what it names: the files and the differences of the paths it names (or under a folder it names), and the folders of the tree that hold a path it names and that were read (not one that the list marked as ignored). The changes of a worktree are read at most once in a second (`EVERY_MS`): those that come in between are read together after it.
// A watch ends when nothing needs it (the screen or the window is hidden, no tab or tree shows the worktree, or its place no longer streams), and a watch that Orca ended is not made again until the worktree is wanted anew.
import type { OrcaFilesEvent } from "./bindings/OrcaFilesEvent";
import { invoke } from "./ipc.js";
import { diffWorktrees, rereadDiffs } from "./orca-diff.js";
import { editorWorktrees, rereadEditors } from "./orca-editor.js";
import { rereadTree, treeWatch } from "./orca-files.js";

interface Watch {
  target: string | null;
  path: string;
  generation: number;
  ready: boolean;
  // When the last change was read, the changes that wait for the next second, and the timer that reads them.
  at: number;
  paths: Set<string>;
  directories: Set<string>;
  timer: number | null;
}

// The shortest time between two reads that the changes of a worktree ask for: a build writes without a pause.
const EVERY_MS = 1000;

const watches = new Map<string, Watch>();
let lastGeneration = 0;
// The worktrees that the last `syncFileWatches` found needed, as their keys.
let held = "";

const keyOf = (target: string | null, path: string) => `${target ?? ""}\n${path}`;

// Whether the disk of the worktree is watched and the watch is set: its files and its tree are not read by the clock.
export const watchReady = (target: string | null, path: string) => watches.get(keyOf(target, path))?.ready === true;

// What Orca does not watch (nothing inside `.git` or `node_modules`, A-12), by the path from the worktree: a file or a folder there is read by the clock even while the watch is ready.
export const unwatched = (relative: string) => /(^|\/)(\.git|node_modules)(\/|$)/.test(relative);

// Reads what the worktree shows again. `touched` says, for the absolute path of a file, whether the change reaches it; `changed` is the absolute paths that changed (null: everything is read).
function reread(target: string | null, path: string, touched: (absolute: string) => boolean, changed: string[] | null) {
  rereadEditors(target, path, touched);
  rereadDiffs(target, path, touched);
  const tree = treeWatch();
  if (tree === null || tree.target !== target || tree.path !== path) return;
  const base = path.replace(/\/+$/, "");
  // A path outside the worktree cannot be placed in the tree, so then all of it is read.
  rereadTree(changed?.every((p) => p.startsWith(`${base}/`)) ? changed.map((p) => p.slice(base.length + 1)) : null);
}

function stop(watch: Watch) {
  if (watch.timer !== null) clearTimeout(watch.timer);
  watch.timer = null;
  watch.paths.clear();
  watch.directories.clear();
}

// Reads the changes that were told since the last read.
function flush(watch: Watch) {
  const paths = [...watch.paths];
  const directories = [...watch.directories];
  stop(watch);
  watch.at = Date.now();
  reread(watch.target, watch.path, touching(watch.path, paths, directories), paths);
}

// Which files a change reaches: a path that is named, and everything under a folder that is named (a deleted path may have been a folder). A path outside the worktree (Orca names the real path of a link) cannot be matched, so every file of the worktree is read.
export function touching(root: string, paths: string[], directories: string[]): (absolute: string) => boolean {
  const base = root.replace(/\/+$/, "");
  if (paths.some((p) => !p.startsWith(`${base}/`))) return () => true;
  const named = new Set(paths);
  return (absolute) => named.has(absolute) || directories.some((d) => absolute.startsWith(`${d}/`));
}

function open(target: string | null, path: string) {
  const watch: Watch = { target, path, generation: ++lastGeneration, ready: false, at: 0, paths: new Set(), directories: new Set(), timer: null };
  watches.set(keyOf(target, path), watch);
  const channel = new window.__TAURI__.core.Channel<OrcaFilesEvent>();
  channel.onmessage = (event) => {
    if (watches.get(keyOf(target, path)) !== watch) return;
    if (event.kind === "ready") {
      watch.ready = true;
      stop(watch);
      // What changed before the watch was set is not told: everything is read once.
      reread(target, path, () => true, null);
    } else if (event.kind === "changed") {
      for (const p of event.paths) watch.paths.add(p);
      for (const d of event.directories) watch.directories.add(d);
      if (watch.timer !== null) return;
      const wait = watch.at + EVERY_MS - Date.now();
      if (wait <= 0) flush(watch);
      else
        watch.timer = window.setTimeout(() => {
          if (watches.get(keyOf(target, path)) === watch) flush(watch);
        }, wait);
    } else {
      watch.ready = false;
      stop(watch);
    }
  };
  invoke("orca_stream_files", { environment: target, path, generation: watch.generation, channel }).catch(() => {
    if (watches.get(keyOf(target, path)) === watch) watch.ready = false;
  });
}

// Watches the worktrees that the screen needs and lets go of the others. `visible`: the Orca screen is shown with its work pane and the window is not hidden. `streams`: whether the place (null: this machine) streams (A-12).
export function syncFileWatches(visible: boolean, streams: (target: string | null) => boolean) {
  const tree = treeWatch();
  const shown = visible ? [...editorWorktrees(), ...diffWorktrees(), ...(tree === null ? [] : [tree])].filter((w) => streams(w.target)) : [];
  // The screen draws often: nothing is done while the worktrees it needs are the ones it needed last time.
  const needed = shown.map((w) => keyOf(w.target, w.path)).join("\0");
  if (needed === held) return;
  held = needed;
  const wanted = new Map(shown.map((w) => [keyOf(w.target, w.path), w]));
  for (const [key, watch] of [...watches]) {
    if (wanted.has(key)) continue;
    stop(watch);
    watches.delete(key);
    invoke("orca_stream_files_close", { environment: watch.target, path: watch.path, generation: watch.generation }).catch(() => {});
  }
  for (const [key, w] of wanted) if (!watches.has(key)) open(w.target, w.path);
}
