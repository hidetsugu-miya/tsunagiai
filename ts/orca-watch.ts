// A-12, A-18, A-24: the watch of the disk. Where the Orca screen streams (the saved environment that is the target, and this machine once it is paired), each worktree whose files the screen shows (a file in an editor tab, a difference tab, the tree of the file pane) is watched with `orca_stream_files` (Orca's `files.watch`), and a change that Orca tells is read again at once, without a word, by the same quiet reads as the clock's: the files it touches, the differences of the worktree and the tree.
// A watch that is ready takes the place of the clock for the files and the tree of its worktree (`watchReady`); the differences stay on the clock too, because a commit moves HEAD with no word of Orca's. A worktree that is not watched, or whose watch is not ready (it has not started, ended or its connection is lost), is read by the clock as before.
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
}

const watches = new Map<string, Watch>();
let lastGeneration = 0;

const keyOf = (target: string | null, path: string) => `${target ?? ""}\n${path}`;

// Whether the disk of the worktree is watched and the watch is set: its files and its tree are not read by the clock.
export const watchReady = (target: string | null, path: string) => watches.get(keyOf(target, path))?.ready === true;

// Reads what the worktree shows again. `touched` says, for the absolute path of a file, whether the change reaches it.
function reread(target: string | null, path: string, touched: (absolute: string) => boolean) {
  rereadEditors(target, path, touched);
  rereadDiffs(target, path);
  const tree = treeWatch();
  if (tree !== null && tree.target === target && tree.path === path) rereadTree();
}

// Which files a change reaches: a path that is named, and everything under a folder that is named (a deleted path may have been a folder). A path outside the worktree (Orca names the real path of a link) cannot be matched, so every file of the worktree is read.
export function touching(root: string, paths: string[], directories: string[]): (absolute: string) => boolean {
  const base = root.replace(/\/+$/, "");
  if (paths.some((p) => !p.startsWith(`${base}/`))) return () => true;
  const named = new Set(paths);
  return (absolute) => named.has(absolute) || directories.some((d) => absolute.startsWith(`${d}/`));
}

function open(target: string | null, path: string) {
  const watch: Watch = { target, path, generation: ++lastGeneration, ready: false };
  watches.set(keyOf(target, path), watch);
  const channel = new window.__TAURI__.core.Channel<OrcaFilesEvent>();
  channel.onmessage = (event) => {
    if (watches.get(keyOf(target, path)) !== watch) return;
    if (event.kind === "ready") {
      watch.ready = true;
      // What changed before the watch was set is not told: everything is read once.
      reread(target, path, () => true);
    } else if (event.kind === "changed") {
      reread(target, path, touching(path, event.paths, event.directories));
    } else {
      watch.ready = false;
    }
  };
  invoke("orca_stream_files", { environment: target, path, generation: watch.generation, channel }).catch(() => {
    if (watches.get(keyOf(target, path)) === watch) watch.ready = false;
  });
}

// Watches the worktrees that the screen needs and lets go of the others. `visible`: the Orca screen is shown with its work pane and the window is not hidden. `streams`: whether the place (null: this machine) streams (A-12).
export function syncFileWatches(visible: boolean, streams: (target: string | null) => boolean) {
  const wanted = new Map<string, { target: string | null; path: string }>();
  if (visible) {
    const tree = treeWatch();
    for (const w of [...editorWorktrees(), ...diffWorktrees(), ...(tree === null ? [] : [tree])]) if (streams(w.target)) wanted.set(keyOf(w.target, w.path), w);
  }
  for (const [key, watch] of [...watches]) {
    if (wanted.has(key)) continue;
    watches.delete(key);
    invoke("orca_stream_files_close", { environment: watch.target, path: watch.path, generation: watch.generation }).catch(() => {});
  }
  for (const [key, w] of wanted) if (!watches.has(key)) open(w.target, w.path);
}
