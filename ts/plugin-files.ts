// The file tree and the editors of the Plugins tab of the settings screen (A-51, #1537): at the right the tree of the selected plugin's folder (`plugin_files`), and, in the middle beside the tabs of Claude Code, an editor tab for each file that a double press opened (`plugin_file_read`, `plugin_file_write`). `ts/plugin-settings.ts` owns the tabs and tells this module which plugin and which file is shown; Rust reads and writes the folder and keeps every path inside it.
// The tree: the folders first, then the files, by name, as Rust lists them; a folder is opened and closed by a press and read when it is opened. The head shows the plugin's folder (`Plugin.path`) and a button that reads the tree and the open files again.
// The editor is CodeMirror 6 as the Orca screen's (A-18; the same `TsunagiaiCodeMirror`, read when the first file is opened): the text is saved with Cmd+S (Ctrl+S) while the editor's tab is shown, never by itself, with the signature of the text that was read, and Rust writes only if the disk still holds it. A refusal (the file changed on the disk, is gone or is no UTF-8 now) writes nothing, is said on a card, and leaves the typing in the editor.
// While the panel is shown the tree and the open files of the plugin selected are read again every POLL_MS and when the window gets the focus back, because Claude Code of a tab writes the files too: an open file with typing that is not saved, or that is being saved, is never replaced, and a file read again with another signature is put in with the caret, the scroll and the folds kept. A read of that kind that fails says nothing.
// The editors are kept in memory only, by plugin and file; a plugin that left the folder takes its editors and its tree with it (`dropPlugin`).
import type { OrcaFileText } from "./bindings/OrcaFileText";
import type { Plugin } from "./bindings/Plugin";
import type { PluginEntry } from "./bindings/PluginEntry";
import { $, tag } from "./dom.js";
import { showFailure } from "./error-card.js";
import { CHEVRON_SVG, FILE_SVG, FOLDER_SVG, RELOAD_SVG } from "./icons.js";
import { invoke } from "./ipc.js";
import { loadCodeMirror } from "./vendor-load.js";

// How often the panel reads the tree and the open files again while it is shown.
const POLL_MS = 3000;

// What the heading of an editor says of the save.
type Save = "idle" | "dirty" | "saving" | "saved" | "changed" | "missing" | "not-utf8" | "error";

const SAVE_LABELS: Record<Save, string> = {
  idle: "",
  dirty: "未保存",
  saving: "保存中",
  saved: "保存しました",
  changed: "ディスクのファイルが変わっています",
  missing: "ファイルが見つかりません",
  "not-utf8": "ディスクのファイルが UTF-8 ではなくなっています",
  error: "保存できません",
};

// The states of a save that the disk refused: the typing is not saved and a save sends the same signature again, so a tab in one of them is closed without saving.
const REFUSED: Save[] = ["changed", "missing", "not-utf8", "error"];

interface Editor {
  folder: string;
  relative: string;
  el: HTMLElement;
  state: HTMLElement;
  body: HTMLElement;
  cm: CodeMirrorEditor | null;
  // What the disk held when the file was read or last saved.
  signature: string;
  crlf: boolean;
  read: "loading" | "ready" | "failed";
  save: Save;
  // Typing that is not on the disk.
  dirty: boolean;
  writing: Promise<boolean> | null;
  // Focus the text when it is first shown.
  wantFocus: boolean;
}

// The tree of a plugin: the entries of each folder read (by the folder's path from the plugin's folder, "" for the plugin's own), the folders that are open, and the file selected.
interface Tree {
  dirs: Map<string, PluginEntry[]>;
  expanded: Set<string>;
  selected: string | null;
}

let on: { open: (folder: string, relative: string) => void; changed: () => void; failed: (folder: string, relative: string) => void } = { open: () => {}, changed: () => {}, failed: () => {} };
const editors = new Map<string, Editor>();
const trees = new Map<string, Tree>();
// The plugin whose tree is shown, and its head.
let current: Plugin | null = null;
let timer: number | null = null;
// The editor that is shown: Command and S anywhere in the settings saves it.
let shownEditor: Editor | null = null;

const keyOf = (folder: string, relative: string) => `${folder}/${relative}`;
const textOf = (e: unknown) => (e instanceof Error ? e.message : String(e));

// ---- the tree ----

function treeOf(folder: string): Tree {
  let tree = trees.get(folder);
  if (!tree) {
    tree = { dirs: new Map(), expanded: new Set(), selected: null };
    trees.set(folder, tree);
  }
  return tree;
}

function icon(svg: string) {
  const node = tag("span", "orca-file-ic");
  node.innerHTML = svg;
  return node;
}

function row(folder: string, tree: Tree, entry: PluginEntry, relative: string, depth: number) {
  const button = tag("button", "orca-file");
  button.type = "button";
  button.dataset.path = relative;
  button.dataset.kind = entry.folder ? "dir" : "file";
  button.dataset.selected = String(tree.selected === relative);
  button.style.setProperty("--depth", String(depth));
  const mark = tag("span", "orca-file-mark");
  mark.innerHTML = CHEVRON_SVG;
  button.append(mark, icon(entry.folder ? FOLDER_SVG : FILE_SVG), tag("span", "orca-file-name", entry.name));
  if (entry.folder) {
    button.setAttribute("aria-expanded", String(tree.expanded.has(relative)));
    button.onclick = () => toggle(folder, relative);
  } else {
    button.dataset.open = String(editors.has(keyOf(folder, relative)));
    // A file opens on a double press (or Enter), so a single press only selects it.
    button.onclick = () => {
      button.focus({ preventScroll: true });
      tree.selected = relative;
      draw();
    };
    button.ondblclick = () => on.open(folder, relative);
    button.onkeydown = (e) => {
      if (e.key === "Enter") on.open(folder, relative);
    };
  }
  return button;
}

// Draws the tree of the plugin shown: the entries of each folder that is open, under it.
function draw() {
  const tree = current === null ? undefined : trees.get(current.folder);
  const rows: HTMLElement[] = [];
  const walk = (dir: string, depth: number) => {
    if (current === null || tree === undefined) return;
    for (const entry of tree.dirs.get(dir) ?? []) {
      const relative = dir === "" ? entry.name : `${dir}/${entry.name}`;
      rows.push(row(current.folder, tree, entry, relative, depth));
      if (entry.folder && tree.expanded.has(relative)) walk(relative, depth + 1);
    }
  };
  walk("", 0);
  $("plugin-files-path").textContent = current?.path ?? "";
  $<HTMLButtonElement>("plugin-files-reload").disabled = current === null;
  $("plugin-tree").replaceChildren(...rows);
}

// Opens or closes the folder `relative`; one that is opened is read first.
function toggle(folder: string, relative: string) {
  const tree = treeOf(folder);
  if (tree.expanded.delete(relative)) return draw();
  tree.expanded.add(relative);
  draw();
  void readTree(folder, true, [relative]);
}

// Reads the entries of `dirs` (the plugin's own folder and each folder that is open, unless given) and draws them. `say`: a failure is said on a card (the owner pressed something); the clock and the focus say nothing, and a folder that cannot be read any more is closed.
async function readTree(folder: string, say: boolean, dirs: string[] = ["", ...treeOf(folder).expanded]) {
  const tree = treeOf(folder);
  const answers = await Promise.all(
    dirs.map((dir) =>
      invoke("plugin_files", { folder, dir }).then(
        (entries) => ({ dir, entries }),
        (e: unknown) => ({ dir, entries: null, error: e }),
      ),
    ),
  );
  if (trees.get(folder) !== tree) return;
  for (const answer of answers) {
    if (answer.entries !== null) {
      tree.dirs.set(answer.dir, answer.entries);
      continue;
    }
    if (answer.dir !== "") {
      tree.expanded.delete(answer.dir);
      tree.dirs.delete(answer.dir);
    }
    if (say) showFailure("plugin-files", answer.error);
  }
  if (current?.folder === folder) draw();
}

// Shows the tree of `plugin` (none: no tree). The tree is read when another plugin comes, and again by `reread`.
export function showTree(plugin: Plugin | null) {
  const changed = current?.folder !== plugin?.folder;
  current = plugin;
  draw();
  if (plugin !== null && changed) void readTree(plugin.folder, true);
}

// The plugin left the folder: its tree and its editors go.
export function dropPlugin(folder: string) {
  trees.delete(folder);
  for (const [key, ed] of [...editors]) {
    if (ed.folder !== folder) continue;
    ed.cm?.destroy();
    ed.el.remove();
    editors.delete(key);
  }
  if (current?.folder === folder) {
    current = null;
    draw();
  }
}

// ---- the editors ----

function setSave(ed: Editor, save: Save) {
  ed.save = save;
  ed.state.textContent = SAVE_LABELS[save];
  ed.state.dataset.state = save;
}

// The arrow of a line that can be folded, as the editor of the Orca screen draws it.
function foldMarker(open: boolean): HTMLElement {
  const mark = tag("span", open ? "orca-fold open" : "orca-fold");
  mark.innerHTML = CHEVRON_SVG;
  return mark;
}

export const hasEditor = (folder: string, relative: string) => editors.has(keyOf(folder, relative));

// Whether the file has typing that is not on the disk (its tab is marked).
export const isDirty = (folder: string, relative: string) => editors.get(keyOf(folder, relative))?.dirty ?? false;

// Makes the editor of the file, hidden, and reads the file into it; one that is open is left as it is. A file that cannot be read says so on a card and is given back to the tabs (`failed`).
export function openEditor(folder: string, relative: string) {
  const key = keyOf(folder, relative);
  if (editors.has(key)) return;
  const el = tag("div", "orca-edit");
  el.hidden = true;
  const head = tag("div", "orca-edit-head");
  const state = tag("span", "orca-edit-state");
  const body = tag("div", "orca-edit-body");
  head.append(tag("span", "orca-edit-path", relative), state);
  el.append(head, body);
  const ed: Editor = { folder, relative, el, state, body, cm: null, signature: "", crlf: false, read: "loading", save: "idle", dirty: false, writing: null, wantFocus: true };
  editors.set(key, ed);
  $("plugin-editors").append(el);
  draw();
  void load(ed);
}

async function load(ed: Editor) {
  try {
    // CodeMirror is read the first time a file is opened, beside the read of the file.
    const [text] = await Promise.all([invoke("plugin_file_read", { folder: ed.folder, path: ed.relative }), loadCodeMirror()]);
    if (editors.get(keyOf(ed.folder, ed.relative)) !== ed) return;
    ed.signature = text.signature;
    ed.crlf = text.crlf;
    ed.cm = TsunagiaiCodeMirror.create(ed.body, {
      text: text.content,
      language: text.language,
      readOnly: false,
      label: ed.relative,
      marker: foldMarker,
      onChange: () => {
        if (!ed.dirty) {
          ed.dirty = true;
          on.changed();
        }
        setSave(ed, "dirty");
      },
    });
    ed.read = "ready";
    focusIfWanted(ed);
  } catch (e) {
    if (editors.get(keyOf(ed.folder, ed.relative)) !== ed) return;
    ed.read = "failed";
    showFailure("plugin-files", textOf(e));
    ed.cm?.destroy();
    ed.el.remove();
    editors.delete(keyOf(ed.folder, ed.relative));
    on.failed(ed.folder, ed.relative);
  }
}

function focusIfWanted(ed: Editor) {
  if (!ed.wantFocus || !ed.cm || ed.el.hidden) return;
  ed.wantFocus = false;
  ed.cm.focus();
}

// Shows the editor of one file and hides the others (none: all are hidden, and so is the place of the editors).
export function showEditor(folder: string | null, relative: string | null) {
  shownEditor = null;
  for (const ed of editors.values()) {
    const match = folder !== null && ed.folder === folder && ed.relative === relative;
    ed.el.hidden = !match;
    if (match) {
      shownEditor = ed;
      focusIfWanted(ed);
    }
  }
  $("plugin-editors").hidden = shownEditor === null;
}

// Saves the text now, once at a time (a call while a save is on its way waits for it). True when nothing is left unsaved: the text is on the disk, or there was none to save. A refusal writes nothing, is said on a card and leaves the typing in the editor.
async function save(ed: Editor): Promise<boolean> {
  if (ed.writing) await ed.writing;
  if (!ed.dirty || !ed.cm || ed.read !== "ready") return !ed.dirty;
  const writing = write(ed, ed.cm.text());
  ed.writing = writing;
  const done = await writing;
  ed.writing = null;
  on.changed();
  return done;
}

async function write(ed: Editor, sent: string): Promise<boolean> {
  setSave(ed, "saving");
  try {
    const saved = await invoke("plugin_file_write", { folder: ed.folder, path: ed.relative, content: sent, crlf: ed.crlf, signature: ed.signature });
    if (saved.state !== "saved") {
      setSave(ed, saved.state);
      showFailure("plugin-files", `${ed.relative}: ${SAVE_LABELS[saved.state]}`);
      return false;
    }
    ed.signature = saved.signature;
    // Typing that came in while the save was on its way is still not on the disk.
    if (ed.cm?.text() === sent) {
      ed.dirty = false;
      setSave(ed, "saved");
    } else {
      setSave(ed, "dirty");
    }
    return true;
  } catch (e) {
    setSave(ed, "error");
    showFailure("plugin-files", textOf(e));
    return false;
  }
}

// Closes the editor of the file. Typing is saved first; when that fails the editor stays (false), and the next close gives the typing up, as does a close after the disk refused a save: the card has told the owner already.
export async function closeEditor(folder: string, relative: string): Promise<boolean> {
  const key = keyOf(folder, relative);
  const ed = editors.get(key);
  if (!ed) return true;
  if (ed.dirty && !REFUSED.includes(ed.save) && !(await save(ed))) return false;
  if (editors.get(key) !== ed) return true;
  ed.cm?.destroy();
  ed.el.remove();
  editors.delete(key);
  draw();
  return true;
}

// Reads the file again for an editor with no typing: a text that differs from what was read replaces the editor's, which keeps its caret, scroll and folds and records no step of the history.
async function reread(ed: Editor) {
  if (ed.read !== "ready" || ed.dirty || ed.writing) return;
  let text: OrcaFileText;
  try {
    text = await invoke("plugin_file_read", { folder: ed.folder, path: ed.relative });
  } catch {
    return;
  }
  if (editors.get(keyOf(ed.folder, ed.relative)) !== ed || ed.dirty || ed.writing || !ed.cm || text.signature === ed.signature) return;
  ed.signature = text.signature;
  ed.crlf = text.crlf;
  ed.cm.replace(text.content);
}

// Reads the tree and the open files of the plugin shown again (the clock, the focus of the window, a tab shown again, the button of the head). `say`: a failure of the tree is said on a card.
export function rereadFiles(say = false) {
  if (current === null) return;
  const folder = current.folder;
  void readTree(folder, say);
  for (const ed of editors.values()) if (ed.folder === folder) void reread(ed);
}

// The panel is shown (true) or not: the clock that reads the files again runs only while it is.
export function watchFiles(shown: boolean) {
  if (shown && timer === null) timer = window.setInterval(() => rereadFiles(), POLL_MS);
  if (!shown && timer !== null) {
    clearInterval(timer);
    timer = null;
  }
}

export function initPluginFiles(handlers: typeof on) {
  on = handlers;
  const files = $("plugin-files");
  const head = tag("div", "plugin-files-head");
  const reload = tag("button", "icon-btn");
  reload.id = "plugin-files-reload";
  reload.type = "button";
  reload.setAttribute("aria-label", "読み直す");
  reload.innerHTML = RELOAD_SVG;
  reload.onclick = () => rereadFiles(true);
  const path = tag("span", "plugin-files-path");
  path.id = "plugin-files-path";
  const tree = tag("div", "");
  tree.id = "plugin-tree";
  files.replaceChildren(head, tree);
  head.append(path, reload);
  // The place of the editors is under the terminal of the tabs, in the middle.
  const host = tag("div", "");
  host.id = "plugin-editors";
  host.hidden = true;
  $("plugin-term").after(host);
  document.addEventListener("keydown", (e) => {
    if (shownEditor !== null && (e.metaKey || e.ctrlKey) && !e.altKey && !e.shiftKey && e.key.toLowerCase() === "s") {
      e.preventDefault();
      void save(shownEditor);
    }
  });
  window.addEventListener("focus", () => {
    if (timer !== null) rereadFiles();
  });
}
