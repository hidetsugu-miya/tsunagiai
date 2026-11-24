// The editor of the Orca screen (A-18): a file of a worktree opened as a tab of the work pane, in CodeMirror 6 (`src/vendor/codemirror.js`, read when the first file is opened) with the numbers of its lines at its left and its text in colors (A-21). Rust reads and saves the text (`orca_file_read`, `orca_file_write`), decides whether a save went through and names the language to color it by; this module draws it and takes the typing.
// A file is saved by itself: once the typing has stopped for the time of the settings, the text goes to Rust with the signature of the text that was read, and Orca writes only if the disk still holds it.
// When it does not (the file was changed elsewhere, or is gone), nothing is written and the heading says so; the text stays in the editor and is not tried again until the tab is opened anew.
// Typing that still waits for its timer when the window is closed is sent at once (`pagehide`).
// A file that a pane shows is read again at once when the watch of the disk tells a change (`rereadEditors`, A-18), by the clock of the Orca screen where the disk is not watched (whether the file pane is shown or not), and when it is shown again after it was out of the page (`refreshEditors`, `showEditors`): only a file with no typing that waits for the disk, and its text is replaced (an edit that the history keeps, with the caret, the scroll and the folds kept) only when the disk holds another text than the one that was read. A read that fails says nothing.
// A file whose language a language server takes asks for its definitions (A-34): the right button with the Command key on a name sends the editor's text, with the place of the character under the mouse, to the screen (`definition`), which shows the answer in the definition tab under the pane of the editor. A file the definition put outside the worktree (a gem) is a file of this editor too, read only (`outside`: its `relative` is the server's absolute path, Rust reads it by `lsp_read_outside`, and nothing is saved), and a place of a definition is gone to by `goTo`.
// While the Command key is down and the mouse stays on a name for LINK_WAIT_MS, the editor asks whether the name has a definition (`lsp_definition_exists`, only of a server that is running) and draws an underline under it in the accent color, in the box of the text that CodeMirror gives (`boxOf`), with the pointer for the cursor (A-34, `showLink`, `hideLink`). The answer is kept by the name's range until the text changes; the key's release, the mouse leaving the editor, typing and the scroll take the underline away.
// The line of the caret (the source) has a faint band under the text, drawn by CodeMirror, and the paragraph of the caret (the rich view) has one drawn here (A-18, A-26): `placeRichBand`, called for each file at each change of the selection of the page.
// The open files are kept in memory only, by target and project, as the tabs of the work pane (their ids are `file:{n}`); a tab that is not shown keeps its text, its timer and its save.
// A Markdown file (the language Rust names `markdown`) has two buttons in its heading, the source (`<>`) and the rich view (the pencil), and opens in the rich view (A-26): Milkdown draws the text, without its front matter. The rich view is edited (the edit is put into the text of the editor by Rust, `markdown_patch`, and saved as any typing is) unless the file does not load and export the same twice or Rust cannot put an edit into it; then it is read only and the file opens in the source. The choice is kept for the file while it is open, in memory only.
// An HTML file (its name ends with `.html`, whatever the case) has the source and the preview (the eye) in its heading, and opens in the preview (A-42): a frame that shows the address `orca_file_preview_url` gives (A-31), after the typing that waits is saved. While the preview is shown a button of the heading makes the frame again, which reads the file again; nothing else does.
import { tag } from "./dom.js";
import { CHEVRON_SVG, CODE_SVG, EDIT_SVG, EYE_SVG, LOCK_SVG, RELOAD_SVG } from "./icons.js";
import { invoke } from "./ipc.js";
import type { DefinitionQuery } from "./orca-definition.js";
import { loadCodeMirror, loadMilkdown, loadPele } from "./vendor-load.js";

// What the heading says of the save: nothing yet, waiting for the typing to stop, on its way, done, or not done (and why).
type Save = "idle" | "pending" | "saving" | "saved" | "changed" | "missing" | "not-utf8" | "error";

const SAVE_LABELS: Record<Save, string> = {
  idle: "",
  pending: "保存待ち",
  saving: "保存中",
  saved: "保存しました",
  changed: "ディスクのファイルが変わっています",
  missing: "ファイルが見つかりません",
  "not-utf8": "ディスクのファイルが UTF-8 ではなくなっています",
  error: "保存できません",
};

// The views of a file: the rich view of a Markdown file (A-26), the source, and the preview of an HTML file (A-42).
type Mode = "rich" | "source" | "preview";

interface EditorFile {
  id: string;
  target: string | null;
  project: string;
  // The worktree, and the file in it (relative).
  path: string;
  relative: string;
  // A file outside the worktree that the language server gave as a definition (A-34): `relative` is its absolute path on the server's side, and it is read only.
  outside: boolean;
  // The language Rust named for the file (A-21), once it is read.
  language: string;
  // The server of the project that takes that language (A-34), found once the file is read: none asks nothing. For a file outside the worktree, the server that gave it.
  server: string | null;
  // The underline of the Command key (A-34): the element (in the box of the text, over the editor), the place of the mouse in the editor (null: it is not in it), the timer of the wait for the mouse to stay, the count that drops an answer older than the last move or hide, the box of the name that is underlined (null: none), and the answers kept (by line, start and end of the name) for the text of the edit `knownEdits`.
  link: HTMLElement;
  hover: { x: number; y: number } | null;
  linkTimer: number | null;
  linkSeq: number;
  linkBox: DOMRect | null;
  known: Map<string, boolean>;
  knownEdits: number;
  // The place the screen asked to go to (a definition), kept until the text is shown: the line from 0 and the character in UTF-16 units.
  jump: { line: number; character: number } | null;
  // The text of the read (null until it is read), whether the file has CRLF, and the signature of what the disk held then; a save that went through brings the signature up to date.
  signature: string;
  crlf: boolean;
  read: "loading" | "ready" | "failed";
  save: Save;
  // Typing not on the disk yet.
  dirty: boolean;
  // A save was refused: nothing is saved again.
  blocked: boolean;
  timer: number | null;
  writing: Promise<void> | null;
  // The file is being moved (A-18): nothing is saved until the move is over, so that no save goes to the place it leaves.
  held: boolean;
  // The quiet read (`reread`) is on its way; the file was put in a pane once, and was taken out of the page after that (it is read again when it is put back).
  rereading: boolean;
  // A change that the watch of the disk told (A-18) came while the quiet read was on its way: it is read once more when that ends.
  again: boolean;
  placed: boolean;
  out: boolean;
  // Focus the text when it is first shown.
  wantFocus: boolean;
  // A Markdown file: the buttons of the heading (`modes`, hidden for another file), the view that is shown (`mode`; "rich" is the start), the box of the editor (`body`), the box of the rich view (`rich`) with the Milkdown editor in it (`view`, null: none), and the count that tells a drawing of the rich view that waits for the library that it is out of date.
  // The edit of the rich view: `richBase` is the text of the editor when the view was drawn and `richBefore` what Milkdown exported then (the edit is put into `richBase` from them, so the text of the editor is always the base with the whole edit in it); `richPending`: the document changed and the editor does not hold it yet, `richTimer` waits to put it there, `richSync` is the put on its way. `richFirst`: the view was not drawn yet (a file that cannot be edited in it opens in the source).
  markdown: boolean;
  mode: Mode;
  modes: HTMLElement;
  sourceButton: HTMLButtonElement;
  richButton: HTMLButtonElement;
  // An HTML file (A-42; decided by its name, so it is known before the file is read): the preview button and the button that makes the frame again (shown only while the preview is). `preview` is the box of the frame, and `previewTurn` the count that tells a drawing of the frame that waits (for the save and for the address) that it is out of date.
  html: boolean;
  // An image file (A-18; decided by its name, so it is known before the file is read): the box that shows the picture (`picture`, hidden until it is read) instead of the text.
  image: boolean;
  picture: HTMLElement;
  previewButton: HTMLButtonElement;
  reloadButton: HTMLButtonElement;
  preview: HTMLElement;
  previewTurn: number;
  body: HTMLElement;
  rich: HTMLElement;
  view: MilkdownView | null;
  richTurn: number;
  richBase: string;
  richBefore: string;
  richPending: boolean;
  richTimer: number | null;
  richSync: Promise<void> | null;
  richFirst: boolean;
  el: HTMLElement;
  // The editor (null until the file is read and CodeMirror is loaded), and how many times its text changed (by the owner and by the page: the answers kept of the definitions are for one text, `known`).
  cm: CodeMirrorEditor | null;
  edits: number;
  // The band under the paragraph of the caret of the rich view, in the box of the rich view and under its text, and the frame in which it is put (null: none waits).
  richBand: HTMLElement;
  richFrame: number | null;
  state: HTMLElement;
  // The path of the heading.
  where: HTMLElement;
  note: HTMLElement;
}

// After a change of the rich view, how long it waits for more changes before the edit is put into the editor.
const RICH_WAIT_MS = 200;
// How long the mouse stays on a name, with the Command key down, before the editor asks whether the name has a definition.
const LINK_WAIT_MS = 150;

// The names of the files the editor shows as a picture (A-18): by the extension, whatever the case. Rust decides the same (`image_mime`).
const IMAGE_NAME = /\.(png|jpe?g|gif|webp)$/i;

const files = new Map<string, EditorFile>();
let lastId = 0;
let autosaveMs = 1000;
let changed: () => void = () => {};
let fail: (e: unknown) => void = () => {};
let definition: (query: DefinitionQuery) => void = () => {};
let serve: (target: string | null, project: string, path: string, server: string) => void = () => {};
let mayAsk: (target: string | null, path: string, server: string) => boolean = () => true;

export const nameOf = (relative: string) => relative.slice(relative.lastIndexOf("/") + 1);

// Sets how long after the typing stops a file is saved (the settings card).
export function setAutosaveMs(ms: number) {
  autosaveMs = ms;
}

// The text of the editor now (lines end with \n; CRLF is Rust's, `crlf`), empty until the file is read.
const textOf = (f: EditorFile) => f.cm?.text() ?? "";

const canSave = (f: EditorFile) => !f.outside && f.read === "ready" && f.dirty && !f.blocked && !f.held && f.save !== "error";

function setSave(f: EditorFile, save: Save) {
  f.save = save;
  f.state.textContent = SAVE_LABELS[save];
  f.state.dataset.state = save;
}

// The blocks of the rich view that take the band: a paragraph (also that of a list item), a heading, a code block and a table cell.
const RICH_BLOCKS = "p, h1, h2, h3, h4, h5, h6, pre, th, td";

// Puts the band of the rich view at the next frame, once for the calls that come before it (a key and the change of the selection that it makes ask for it together).
function placeRichBand(f: EditorFile) {
  if (f.richFrame !== null) return;
  f.richFrame = requestAnimationFrame(() => {
    f.richFrame = null;
    putRichBand(f);
  });
}

// Puts the band of the rich view under the block the caret is in, as wide as the editor. It is hidden when the editor has not the focus and while a range is selected.
function putRichBand(f: EditorFile) {
  const pm = f.rich.querySelector<HTMLElement>(".ProseMirror");
  const selection = getSelection();
  const node = selection?.anchorNode ?? null;
  const at = node instanceof Element ? node : (node?.parentElement ?? null);
  const block = pm && selection?.isCollapsed && at && pm.contains(document.activeElement) && pm.contains(at) ? at.closest<HTMLElement>(RICH_BLOCKS) : null;
  if (!pm || !block || !pm.contains(block)) {
    f.richBand.hidden = true;
    return;
  }
  const box = block.getBoundingClientRect();
  const host = f.rich.getBoundingClientRect();
  const column = pm.getBoundingClientRect();
  f.richBand.style.top = `${box.top - host.top + f.rich.scrollTop}px`;
  f.richBand.style.left = `${column.left - host.left + f.rich.scrollLeft}px`;
  f.richBand.style.width = `${column.width}px`;
  f.richBand.style.height = `${box.height}px`;
  f.richBand.hidden = false;
}

// The selection of the page changed, or the focus moved: the file that holds the focus, and a file whose band is shown (it hides it unless the caret is in it), put their bands again; a file with its band hidden and no focus has nothing to change.
function placeRichBands() {
  const active = document.activeElement;
  for (const f of files.values()) if (f.el.isConnected && (f.el.contains(active) || !f.richBand.hidden)) placeRichBand(f);
}

function clearTimer(f: EditorFile) {
  if (f.timer !== null) clearTimeout(f.timer);
  f.timer = null;
}

// Saves the text now, once at a time: a call while a save is on its way waits for it. Typing that came in meanwhile is saved by a timer that the end of the save sets.
function flush(f: EditorFile): Promise<void> {
  clearTimer(f);
  if (f.writing) return f.writing;
  if (!f.richPending && !canSave(f)) return Promise.resolve();
  // An edit of the rich view that is not in the editor yet is put there first.
  f.writing = syncRich(f)
    .then(() => (canSave(f) ? write(f) : undefined))
    .finally(() => {
      f.writing = null;
      changed();
    });
  return f.writing;
}

async function write(f: EditorFile) {
  const sent = textOf(f);
  setSave(f, "saving");
  try {
    const saved = await invoke("orca_file_write", { path: f.path, relative: f.relative, content: sent, crlf: f.crlf, signature: f.signature, environment: f.target });
    if (saved.state !== "saved") {
      f.blocked = true;
      setSave(f, saved.state);
      return;
    }
    f.signature = saved.signature;
    if (textOf(f) === sent) {
      f.dirty = false;
      setSave(f, "saved");
    } else {
      schedule(f);
    }
  } catch (e) {
    setSave(f, "error");
    fail(e);
  }
}

// The text of the editor changed (typed in the source, or put there from the rich view): marks the file as changed and waits for the typing to stop.
function typed(f: EditorFile) {
  if (!f.dirty) {
    f.dirty = true;
    changed();
  }
  schedule(f);
}

// Waits for the typing to stop, then saves.
function schedule(f: EditorFile) {
  clearTimer(f);
  if (f.blocked) return;
  setSave(f, "pending");
  // A file that is being moved waits for the end of the move (`holdFiles`).
  if (f.held) return;
  f.timer = window.setTimeout(() => void flush(f), autosaveMs);
}

// The document of the rich view changed: the edit is put into the editor after RICH_WAIT_MS (at most one wait at a time, so the text is put there while the typing goes on).
function richChanged(f: EditorFile) {
  f.richPending = true;
  placeRichBand(f);
  if (f.richTimer === null)
    f.richTimer = window.setTimeout(() => {
      f.richTimer = null;
      void syncRich(f);
    }, RICH_WAIT_MS);
}

// Puts the edit of the rich view into the editor (Rust's `markdown_patch` applies it to the text the view was drawn from) and waits until it is there; a call while a put is on its way waits for it.
function syncRich(f: EditorFile): Promise<void> {
  if (f.richTimer !== null) clearTimeout(f.richTimer);
  f.richTimer = null;
  if (!f.richPending) return f.richSync ?? Promise.resolve();
  f.richSync ??= putRich(f).finally(() => {
    f.richSync = null;
  });
  return f.richSync;
}

async function putRich(f: EditorFile) {
  while (f.richPending && f.view) {
    f.richPending = false;
    const turn = f.richTurn;
    try {
      const patched = await invoke("markdown_patch", { original: f.richBase, before: f.richBefore, after: f.view.markdown() });
      if (turn !== f.richTurn) return;
      if (patched.kind === "conflict") {
        // The edit cannot be put into the text: the text stays as it is, and is edited in the source.
        setMode(f, "source");
        fail("リッチビューの編集を元のテキストに反映できません");
        return;
      }
      // An edit like a key: the editor tells the change (`onChange`), which marks the file as changed.
      if (patched.text !== textOf(f)) f.cm?.edit(patched.text);
    } catch (e) {
      if (turn !== f.richTurn) return;
      setMode(f, "source");
      fail(e);
      return;
    }
  }
}

// Takes the Milkdown editor out of the rich view, and cancels a drawing of it that waits.
function clearRich(f: EditorFile) {
  f.richTurn++;
  if (f.richTimer !== null) clearTimeout(f.richTimer);
  f.richTimer = null;
  f.richPending = false;
  const view = f.view;
  f.view = null;
  void view?.destroy().catch(() => {});
  f.richBand.hidden = true;
  f.rich.replaceChildren(f.richBand);
}

// Draws the text of the file in the rich view: Milkdown is read the first time, and the front matter is cut off by Rust and kept out of the editor. A drawing that is out of date when the library or the cut comes (the view was left, the file closed) is dropped.
// The view is made editable when the editor loads and exports the text to the same text twice and Rust can put the (unchanged) export into the text; else it stays read only, and a file that was just opened is shown in the source.
async function drawRich(f: EditorFile) {
  clearRich(f);
  const turn = f.richTurn;
  const text = textOf(f);
  try {
    const [{ body }] = await Promise.all([invoke("markdown_split", { text }), loadMilkdown()]);
    // A mermaid block is drawn as a diagram (A-26): Pele is read before the view is drawn, so the diagrams are in it when it is (the scroll that a redraw keeps is not moved by a diagram that comes later). A file that has none does not read it, and one that fails to read leaves the block as code.
    if (/^ {0,3}(```|~~~)[ \t]*mermaid\b/m.test(body)) await loadPele().catch(() => {});
    if (turn !== f.richTurn) return;
    const host = tag("div");
    f.rich.append(host);
    const view = await TsunagiaiMilkdown.mount(host, body);
    if (turn !== f.richTurn) {
      void view.destroy().catch(() => {});
      host.remove();
      return;
    }
    f.view = view;
    const before = view.markdown();
    const [again, patched] = await Promise.all([TsunagiaiMilkdown.normalize(before), invoke("markdown_patch", { original: text, before, after: before })]);
    if (turn !== f.richTurn) return;
    const first = f.richFirst;
    f.richFirst = false;
    if (again === before && patched.kind === "patched" && patched.text === text) {
      f.richBase = text;
      f.richBefore = before;
      view.edit(() => richChanged(f));
    } else if (first) {
      setMode(f, "source");
    }
  } catch (e) {
    if (turn !== f.richTurn) return;
    // The text stays readable: the source is shown.
    setMode(f, "source");
    fail(e);
  }
}

// Takes the frame out of the preview, which stops its load, and drops a drawing of the frame that waits.
function clearPreview(f: EditorFile) {
  f.previewTurn++;
  f.preview.replaceChildren();
}

// Shows the page of an HTML file in a new frame (A-42): the typing that waits is saved first, so the page the server sends is the text of the editor. The frame it replaces stays until the new one is put in (a reload). The address goes only into `src` of the frame: it is not kept anywhere else. A failure is a card, and the source is shown. A drawing that is out of date when the save or the address comes (the preview was left, the file closed, another drawing began) is dropped.
async function drawPreview(f: EditorFile) {
  const turn = ++f.previewTurn;
  try {
    await flush(f);
    if (turn !== f.previewTurn) return;
    // A save that did not go through keeps the editor on the source (the heading says why), so the owner sees the text that is not on the disk, not a preview of the old file.
    if (f.save === "error" || f.blocked) {
      setMode(f, "source");
      return;
    }
    const address = await invoke("orca_file_preview_url", { path: f.path, relative: f.relative, environment: f.target });
    if (turn !== f.previewTurn) return;
    const frame = tag("iframe");
    frame.setAttribute("sandbox", "allow-scripts allow-same-origin");
    frame.src = address;
    f.preview.replaceChildren(frame);
  } catch (e) {
    if (turn !== f.previewTurn) return;
    setMode(f, "source");
    fail(e);
  }
}

// Shows the source, the rich view of a Markdown file or the preview of an HTML file (a file of another language has only its text).
function setMode(f: EditorFile, mode: Mode) {
  f.mode = mode;
  const rich = f.markdown && mode === "rich";
  const preview = f.html && mode === "preview";
  f.modes.hidden = !f.markdown && !f.html;
  f.richButton.hidden = !f.markdown;
  f.previewButton.hidden = !f.html;
  f.reloadButton.hidden = !preview;
  f.sourceButton.setAttribute("aria-pressed", String(!rich && !preview));
  f.richButton.setAttribute("aria-pressed", String(rich));
  f.previewButton.setAttribute("aria-pressed", String(preview));
  f.body.hidden = rich || preview;
  f.rich.hidden = !rich;
  f.preview.hidden = !preview;
  if (preview) void drawPreview(f);
  else clearPreview(f);
  if (rich) void drawRich(f);
  else clearRich(f);
}

// The server that gave a file outside the worktree (A-34); none is an error in Japanese.
function serverOf(f: EditorFile) {
  if (f.server === null) throw new Error("言語サーバーがありません");
  return f.server;
}

// The file outside the worktree, as the editor takes a file (read only, with the language that Rust gave it by its name).
async function readOutside(f: EditorFile) {
  const read = await invoke("lsp_read_outside", { environment: f.target, project: f.project, worktree: f.path, server: serverOf(f), path: f.relative });
  return { content: read.text, crlf: false, signature: "", language: read.language };
}

// Looks for the server of the project that takes the language of the file (A-34): with none the Command key and the right button ask nothing, and one that is found is started when the settings say so.
function lookServer(f: EditorFile) {
  void invoke("lsp_server_for", { environment: f.target, project: f.project, language: f.language }).then(
    (server) => {
      if (f.server !== server) hideLink(f);
      f.server = server;
      if (server !== null) serve(f.target, f.project, f.path, server);
    },
    () => {},
  );
}

// The files of the project that are open look for their server again, once its settings changed (a server renamed, or a language taken by another).
export function resolveServers(target: string | null, project: string) {
  for (const f of filesOf(target, project)) if (!f.outside && !f.image && f.read === "ready") lookServer(f);
}

// Shows the picture of an image file (A-18): Rust reads it and answers a `data:` URI, which goes into an img that the pane's width holds and that is never larger than the picture.
async function loadImage(f: EditorFile) {
  const uri = await invoke("orca_file_image", { path: f.path, relative: f.relative, environment: f.target });
  const img = tag("img");
  img.alt = nameOf(f.relative);
  img.src = uri;
  f.picture.replaceChildren(img);
  f.picture.hidden = false;
  f.read = "ready";
}

// The arrow of a line that can be folded (A-18), drawn right of the line number: it points down while the line is open and right while it is folded, and the style shows an open one only while the pointer is over the numbers.
function foldMarker(open: boolean): HTMLElement {
  const mark = tag("span", open ? "orca-fold open" : "orca-fold");
  mark.innerHTML = CHEVRON_SVG;
  return mark;
}

async function load(f: EditorFile) {
  try {
    if (f.image) {
      await loadImage(f);
      changed();
      return;
    }
    // CodeMirror is read the first time a file is opened, beside the read of the file; one that cannot be read fails the file as a file that cannot be read does (the note says so, and opening the file again tries again).
    const [text] = await Promise.all([f.outside ? readOutside(f) : invoke("orca_file_read", { path: f.path, relative: f.relative, environment: f.target }), loadCodeMirror()]);
    f.language = text.language;
    // A file outside the worktree is marked `gem` when it is a Ruby file.
    if (f.outside) f.state.textContent = text.language === "ruby" ? "gem" : "";
    f.markdown = text.language === "markdown";
    f.crlf = text.crlf;
    f.signature = text.signature;
    f.cm = TsunagiaiCodeMirror.create(f.body, {
      text: text.content,
      language: text.language,
      readOnly: f.outside,
      label: f.relative,
      marker: foldMarker,
      onChange: () => {
        f.edits++;
        hideLink(f);
        typed(f);
      },
    });
    watchMouse(f, f.cm);
    f.read = "ready";
    setMode(f, f.mode);
    // The server that takes the file's language is looked for once the text is shown; with none the Command key and the right button ask nothing. A file of a worktree starts that server (A-34); a file outside the worktree belongs to a server that is there already.
    if (!f.outside) lookServer(f);
  } catch (e) {
    f.read = "failed";
    f.note.textContent = e instanceof Error ? e.message : String(e);
    f.note.hidden = false;
    f.body.hidden = true;
  }
  changed();
}

// The offset in the text of the character under the point (`x`, `y` of the window), none where there is no character (past the end of a line, or below the last): CodeMirror answers it from the characters it draws.
function offsetAt(f: EditorFile, x: number, y: number): number | null {
  return f.cm?.offsetAt(x, y) ?? null;
}

// Where the character at `offset` of `text` is: the offset of the start of its line, the line from 0, the character in that line (UTF-16 units) and the text of the line.
function placeOf(text: string, offset: number) {
  const lineStart = offset === 0 ? 0 : text.lastIndexOf("\n", offset - 1) + 1;
  let line = 0;
  for (let i = text.indexOf("\n"); i !== -1 && i < lineStart; i = text.indexOf("\n", i + 1)) line++;
  const end = text.indexOf("\n", offset);
  return { lineStart, line, character: offset - lineStart, lineText: text.slice(lineStart, end === -1 ? undefined : end) };
}

// Whether the Command key may draw an underline in the file: its text is shown in the source, it is a file of the worktree and a server takes its language (a file outside the worktree asks nothing, as the right button does).
const linkReady = (f: EditorFile) => f.read === "ready" && !f.outside && f.server !== null && !f.body.hidden;

// The cursor over the text of the editor (the pointer while an underline is drawn, else the editor's own).
function setCursor(f: EditorFile, cursor: string) {
  const content = f.cm?.dom.querySelector<HTMLElement>(".cm-content");
  if (content) content.style.cursor = cursor;
}

// Takes the underline away and drops what waits for it: the timer of the wait and the answer that is on its way.
function hideLink(f: EditorFile) {
  f.linkSeq++;
  if (f.linkTimer !== null) {
    clearTimeout(f.linkTimer);
    f.linkTimer = null;
  }
  f.linkBox = null;
  if (!f.link.hidden) {
    f.link.hidden = true;
    setCursor(f, "");
  }
}

// Starts the wait for the mouse to stay where it is (any underline and older wait are taken away first).
function waitLink(f: EditorFile) {
  hideLink(f);
  const at = f.hover;
  if (at === null || !linkReady(f)) return;
  const seq = f.linkSeq;
  f.linkTimer = window.setTimeout(() => {
    f.linkTimer = null;
    void probeLink(f, at.x, at.y, seq);
  }, LINK_WAIT_MS);
}

// Underlines the name under the point when the server has a definition for it (A-34). The answer is kept by the range of the name until the text changes, so the same name is not asked again; an answer that failed (a server that is not running is one) is not kept and draws nothing. An answer that comes after the underline was taken away or the mouse moved on (`seq`) is dropped.
async function probeLink(f: EditorFile, x: number, y: number, seq: number) {
  const offset = offsetAt(f, x, y);
  const server = f.server;
  // A server that is indexing or stopped can only refuse: nothing is sent to it.
  if (offset === null || server === null || !mayAsk(f.target, f.path, server)) return;
  const text = textOf(f);
  const { lineStart, line, character, lineText } = placeOf(text, offset);
  try {
    const word = await invoke("lsp_word", { line: lineText, character });
    if (word === null || seq !== f.linkSeq) return;
    const start = lineText.lastIndexOf(word, character);
    if (start === -1) return;
    const key = `${line}:${start}:${start + word.length}`;
    if (f.knownEdits !== f.edits) {
      f.known.clear();
      f.knownEdits = f.edits;
    }
    let has = f.known.get(key);
    if (has === undefined) {
      has = await invoke("lsp_definition_exists", { environment: f.target, worktree: f.path, server, relative: f.relative, text, line, character });
      if (seq !== f.linkSeq) return;
      f.known.set(key, has);
    }
    if (has) showLink(f, lineStart + start, lineStart + start + word.length);
  } catch {
    // Nothing is drawn.
  }
}

// Draws the underline under the text from `from` to `to`, in the box of the editor: the box of the text is where CodeMirror drew it, so the line is under the letters the owner sees. The cursor over the text is the pointer while it is drawn.
function showLink(f: EditorFile, from: number, to: number) {
  const box = f.cm?.boxOf(from, to) ?? null;
  if (box === null) return;
  const at = f.body.getBoundingClientRect();
  f.link.style.left = `${box.left - at.left}px`;
  f.link.style.top = `${box.bottom - at.top - 1}px`;
  f.link.style.width = `${box.width}px`;
  f.link.hidden = false;
  f.linkBox = box;
  setCursor(f, "pointer");
}

const hideLinks = () => {
  for (const f of files.values()) hideLink(f);
};

// The right button with the Command key on the text (A-34): the character under the mouse, not the caret, is where the definition is asked (the line from 0 and the character in UTF-16 units, which is the index of a string of the page). Rust finds the name there from the text of the line; where there is none nothing happens.
async function askDefinition(f: EditorFile, x: number, y: number) {
  const offset = offsetAt(f, x, y);
  if (offset === null) return;
  const text = textOf(f);
  const { line, character, lineText } = placeOf(text, offset);
  try {
    const word = await invoke("lsp_word", { line: lineText, character });
    if (word === null) return;
    if (f.server !== null) definition({ target: f.target, project: f.project, path: f.path, server: f.server, relative: f.relative, text, line, character, word, tab: f.id });
  } catch (e) {
    fail(e);
  }
}

// Puts the caret at the place `jump` names, in view and in the middle of the pane, once the text is shown (the line from 0, the character in UTF-16 units; a place past the end is the end).
function flushJump(f: EditorFile) {
  const jump = f.jump;
  if (jump === null || f.read !== "ready" || !f.el.isConnected || f.body.hidden || f.cm === null || f.cm.scrollDOM.clientHeight === 0) return;
  f.jump = null;
  f.cm.goTo(jump.line, jump.character);
}

// Goes to a place of the file of the tab `id` (A-34): at once when its text is shown, else when it is.
export function goTo(id: string, line: number, character: number) {
  const f = files.get(id);
  if (f === undefined) return;
  f.jump = { line, character };
  flushJump(f);
}

// Whether the text may be replaced by the disk's: the file is read, is a worktree's, and has no typing that is not on the disk, on its way to it or refused by it.
const canReread = (f: EditorFile) => f.read === "ready" && !f.outside && !f.image && !f.dirty && !f.blocked && !f.held && !f.richPending && f.richSync === null && f.writing === null && f.timer === null && f.save !== "error";

// Reads the file again without a word (the clock, and a tab shown again). The signature of the read says whether the disk still holds the text that was read: when it does, nothing is drawn. Another text takes the place of the one shown as a change from outside (`replace`: the caret, the selection, the scroll and the folds stay where they are, the history keeps its steps and the file is not marked as changed); the rich view of a Markdown file is drawn again and keeps its scroll.
// Typing that came while the read was on its way keeps the text as it is, saved by then or not, and a failure keeps what is shown.
// `again` (a change that the watch of the disk told) makes a read that is on its way be followed by one more, so that a change that came meanwhile is not lost.
async function reread(f: EditorFile, again = false) {
  if (f.rereading) {
    f.again ||= again;
    return;
  }
  if (!canReread(f)) return;
  const relative = f.relative;
  // A save that ends while the read is on its way gives the file another signature: the answer is then older than the disk.
  const signature = f.signature;
  f.rereading = true;
  try {
    const text = await invoke("orca_file_read", { path: f.path, relative, environment: f.target });
    if (files.get(f.id) !== f || f.relative !== relative || !canReread(f) || f.signature !== signature || text.signature === f.signature) return;
    f.signature = text.signature;
    f.crlf = text.crlf;
    if (text.content === textOf(f)) return;
    const richTop = f.rich.scrollTop;
    f.cm?.replace(text.content);
    f.edits++;
    hideLink(f);
    setSave(f, "idle");
    if (f.markdown && f.mode === "rich") {
      void drawRich(f).then(() => {
        f.rich.scrollTop = richTop;
      });
    }
  } catch {
    // What is shown stays.
  } finally {
    f.rereading = false;
    if (f.again) {
      f.again = false;
      void reread(f);
    }
  }
}

function create(id: string, target: string | null, project: string, path: string, relative: string, outside: boolean, server: string | null): EditorFile {
  const el = tag("div", "orca-edit");
  el.dataset.file = id;
  const head = tag("div", "orca-edit-head");
  const state = tag("span", "orca-edit-state");
  state.setAttribute("role", "status");
  const sourceButton = tag("button", "icon-btn orca-edit-mode");
  sourceButton.type = "button";
  sourceButton.setAttribute("aria-label", "ソース");
  sourceButton.innerHTML = CODE_SVG;
  const richButton = tag("button", "icon-btn orca-edit-mode");
  richButton.type = "button";
  richButton.setAttribute("aria-label", "リッチ");
  richButton.innerHTML = EDIT_SVG;
  const previewButton = tag("button", "icon-btn orca-edit-mode");
  previewButton.type = "button";
  previewButton.setAttribute("aria-label", "プレビュー");
  previewButton.innerHTML = EYE_SVG;
  const reloadButton = tag("button", "icon-btn orca-edit-mode");
  reloadButton.type = "button";
  reloadButton.setAttribute("aria-label", "再読み込み");
  reloadButton.innerHTML = RELOAD_SVG;
  reloadButton.hidden = true;
  const modes = tag("span", "orca-edit-modes");
  modes.hidden = true;
  modes.append(sourceButton, richButton, previewButton, reloadButton);
  const where = tag("span", "orca-edit-path", relative);
  // A file outside the worktree is read only: a lock before its path, and `gem` (for a Ruby file, once it is read) where the state of a save is.
  if (outside) {
    const lock = tag("span", "orca-edit-lock");
    lock.setAttribute("role", "img");
    lock.setAttribute("aria-label", "読み取り専用");
    lock.innerHTML = LOCK_SVG;
    head.append(lock);
    state.dataset.state = "outside";
  }
  head.append(where, state, modes);
  const note = tag("p", "orca-empty feed-empty");
  note.hidden = true;
  const link = tag("div", "orca-edit-link");
  link.hidden = true;
  const body = tag("div", "orca-edit-body");
  body.append(link);
  const rich = tag("div", "orca-edit-rich");
  rich.hidden = true;
  const richBand = tag("div", "orca-edit-rich-band");
  richBand.hidden = true;
  rich.append(richBand);
  const preview = tag("div", "orca-edit-preview");
  preview.hidden = true;
  const picture = tag("div", "orca-edit-picture");
  picture.hidden = true;
  el.append(head, note, body, rich, preview, picture);
  const html = !outside && /\.html$/i.test(nameOf(relative));
  const image = !outside && IMAGE_NAME.test(nameOf(relative));
  body.hidden = image;
  const f: EditorFile = { id, target, project, path, relative, outside, language: "", server, jump: null, signature: "", crlf: false, read: "loading", save: "idle", dirty: false, blocked: false, timer: null, writing: null, held: false, rereading: false, again: false, placed: false, out: false, wantFocus: true, richBand, richFrame: null, markdown: false, mode: html ? "preview" : "rich", modes, sourceButton, richButton, html, image, picture, previewButton, reloadButton, preview, previewTurn: 0, body, rich, view: null, richTurn: 0, richBase: "", richBefore: "", richPending: false, richTimer: null, richSync: null, richFirst: true, el, cm: null, edits: 0, state, where, note, link, hover: null, linkTimer: null, linkSeq: 0, linkBox: null, known: new Map(), knownEdits: 0 };
  rich.addEventListener("focusin", () => placeRichBand(f));
  rich.addEventListener("focusout", () => placeRichBand(f));
  sourceButton.onclick = async () => {
    if (f.mode === "source") return;
    // The edit of the rich view is in the textarea before the source is shown.
    await syncRich(f);
    setMode(f, "source");
    f.wantFocus = false;
    f.cm?.focus();
  };
  richButton.onclick = () => {
    if (f.mode !== "rich") setMode(f, "rich");
  };
  previewButton.onclick = () => {
    if (f.mode !== "preview") setMode(f, "preview");
  };
  reloadButton.onclick = () => {
    if (f.mode === "preview") void drawPreview(f);
  };
  return f;
}

// The mouse in the editor of the file (A-34): the Command key and the mouse staying on a name draw the underline of a definition, the right button with the Command key asks for it, and the scroll takes the underline away.
function watchMouse(f: EditorFile, cm: CodeMirrorEditor) {
  cm.scrollDOM.addEventListener("scroll", () => hideLink(f));
  cm.dom.addEventListener("mousemove", (e) => {
    f.hover = { x: e.clientX, y: e.clientY };
    if (!e.metaKey) {
      hideLink(f);
      return;
    }
    const box = f.linkBox;
    if (box !== null && e.clientX >= box.left && e.clientX < box.right && e.clientY >= box.top && e.clientY < box.bottom) return;
    waitLink(f);
  });
  cm.dom.addEventListener("mouseleave", () => {
    f.hover = null;
    hideLink(f);
  });
  cm.dom.addEventListener("contextmenu", (e) => {
    if (!e.metaKey || f.outside || f.read !== "ready" || f.server === null || f.body.hidden) return;
    e.preventDefault();
    void askDefinition(f, e.clientX, e.clientY);
  });
}

// Opens the file as a tab of the project and gives its id (with `outside`, the server that gave a file outside the worktree that a definition named, read only: `relative` is its absolute path on the server's side, A-34); a file that is open already is not read here (`showEditors` reads it again when its tab is put back in a pane).
// `id` is the id the tab has already (A-46: a file that goes to a window of its own and comes back keeps the place its tab has in the layout); the counter passes it, so no tab made later takes it.
export function openFile(target: string | null, project: string, path: string, relative: string, outside: string | null = null, id?: string) {
  const open = [...files.values()].find((f) => f.target === target && f.project === project && f.path === path && f.relative === relative && f.outside === (outside !== null));
  if (open) {
    open.wantFocus = true;
    return open.id;
  }
  if (id !== undefined) reserveId(id);
  const f = create(id ?? `file:${++lastId}`, target, project, path, relative, outside !== null, outside);
  files.set(f.id, f);
  void load(f);
  return f.id;
}

// Makes the counter of the ids pass the id of a tab that is held somewhere else (a window of its own, A-46), so a file opened later does not take it.
export function reserveId(id: string) {
  lastId = Math.max(lastId, Number(id.slice("file:".length)) || 0);
}

// The open files of the project, in the order they were opened.
export const filesOf = (target: string | null, project: string) => [...files.values()].filter((f) => f.target === target && f.project === project);

// Whether a file is open in any project as a tab of the worktree at `path` (one outside it that a definition named counts: its tab is the worktree's), A-34.
export const hasFileIn = (target: string | null, path: string) => [...files.values()].some((f) => f.target === target && f.path === path);

// The ids of the files with typing that is not on the disk.
export const dirtyIds = () => new Set([...files.values()].filter((f) => f.dirty).map((f) => f.id));

// The files of the worktree at `path` that are open in the project, by their relative paths (the file list colors them).
export const openedIn = (target: string | null, project: string, path: string) => new Set(filesOf(target, project).filter((f) => !f.outside && f.path === path).map((f) => f.relative));

// Saves the typing of a file as a close does: the edit of the rich view is put in the text, a save that failed before is tried again (one try: a failure ends the loop), and the loop saves until nothing is left that can be saved.
async function settle(f: EditorFile) {
  await syncRich(f);
  if (f.save === "error") setSave(f, "pending");
  while (canSave(f)) await flush(f);
}

// Saves the typing of the tab, as a close does, and says whether none is left unsaved: a save that failed (its message is shown) or was refused (the heading says so) leaves it. A file that is not open has none (A-46: the tab goes to a window of its own only after this).
export async function saveFile(id: string) {
  const f = files.get(id);
  if (!f) return true;
  await settle(f);
  return !f.dirty;
}

// Closes the tab after its typing is saved. A save that cannot be made keeps the tab (its message is shown); one that was refused (the disk changed) is said in the heading already, and the tab closes without it.
export async function closeFile(id: string) {
  const f = files.get(id);
  if (!f) return true;
  await settle(f);
  if (f.dirty && !f.blocked) return false;
  hideLink(f);
  clearTimer(f);
  f.cm?.destroy();
  clearRich(f);
  clearPreview(f);
  f.el.remove();
  files.delete(id);
  return true;
}

// Takes out the tabs of the files of the worktree at `path` that are gone from the disk (A-18): the file `relative`, or with `folder` every file under that folder. Their typing is not saved (there is nothing to save it to), and a save on its way is not waited for. True when a tab was closed.
export function discardFiles(target: string | null, project: string, path: string, relative: string, folder: boolean) {
  const gone = filesOf(target, project).filter((f) => !f.outside && f.path === path && (f.relative === relative || (folder && f.relative.startsWith(`${relative}/`))));
  for (const f of gone) {
    hideLink(f);
    clearTimer(f);
    f.cm?.destroy();
    clearRich(f);
    clearPreview(f);
    f.el.remove();
    files.delete(f.id);
  }
  return gone.length > 0;
}

// Holds the saves of the open files of the worktree at `path` that a move of `relative` takes along (the file itself, or the files under the folder), and waits for the save of each that is on its way, so that nothing is written to the old place once the move is asked for (A-18). The typing goes on and stays in the tab.
// The function it answers ends the hold: with `to`, the place `relative` was moved to, each file takes its new path (the heading and the name of the tab follow; the text, its signature and the language it was opened with stay), and with null (the move failed) the paths stay. Typing that waited is saved then, to the path the file has now. It answers whether a path changed.
export async function holdFiles(target: string | null, project: string, path: string, relative: string) {
  const moved = filesOf(target, project).filter((f) => !f.outside && f.path === path && !f.held && (f.relative === relative || f.relative.startsWith(`${relative}/`)));
  for (const f of moved) {
    f.held = true;
    clearTimer(f);
  }
  await Promise.all(moved.map((f) => f.writing));
  return (to: string | null) => {
    // A tab that was closed meanwhile is left out.
    const open = moved.filter((f) => files.get(f.id) === f);
    for (const f of open) {
      f.held = false;
      if (to !== null) {
        f.relative = to + f.relative.slice(relative.length);
        f.where.textContent = f.relative;
        f.cm?.label(f.relative);
      }
      if (f.dirty && !f.blocked && f.save !== "error") schedule(f);
    }
    return to !== null && open.length > 0;
  };
}

// Reads again, without a word, the files that the panes show now (the clock of the Orca screen, and a branch that changed), except those that `skip` names (the worktree and the path of the file from it): their disk is watched (A-18).
export function refreshEditors(skip: (target: string | null, path: string, relative: string) => boolean = () => false) {
  for (const f of files.values()) if (f.el.isConnected && !skip(f.target, f.path, f.relative)) void reread(f);
}

// The worktrees (target and path) whose files the panes show now, whose disk the watch of Orca tells about (A-18).
export function editorWorktrees() {
  return [...files.values()].filter((f) => f.el.isConnected && !f.outside).map((f) => ({ target: f.target, path: f.path }));
}

// Reads again, without a word, the files of the worktree that the panes show now and that `touched` names (it is given the absolute path of each), because the watch of the disk told a change (A-18).
export function rereadEditors(target: string | null, path: string, touched: (absolute: string) => boolean) {
  const root = path.replace(/\/+$/, "");
  for (const f of files.values()) if (f.el.isConnected && f.target === target && f.path === path && touched(`${root}/${f.relative}`)) void reread(f, true);
}

// Shows each file of `placements` in its host element and takes every other file out of the page (it keeps its text). A file that was out of the page and is put back is read again.
export function showEditors(placements: { id: string; host: HTMLElement }[]) {
  const shown = new Set(placements.map((p) => p.id));
  for (const [id, f] of files) {
    if (shown.has(id)) continue;
    f.el.remove();
    if (f.placed) f.out = true;
  }
  for (const { id, host } of placements) {
    const f = files.get(id);
    if (!f) continue;
    const back = f.out;
    f.placed = true;
    f.out = false;
    if (f.el.parentElement !== host) host.replaceChildren(f.el);
    if (f.wantFocus && f.cm !== null && !f.body.hidden) {
      f.wantFocus = false;
      f.cm.focus();
    }
    flushJump(f);
    if (back) void reread(f);
  }
}

export function initOrcaEditor(on: { changed: () => void; error: (e: unknown) => void; definition: (query: DefinitionQuery) => void; serve: (target: string | null, project: string, path: string, server: string) => void; mayAsk: (target: string | null, path: string, server: string) => boolean }) {
  changed = on.changed;
  fail = on.error;
  definition = on.definition;
  serve = on.serve;
  mayAsk = on.mayAsk;
  document.addEventListener("selectionchange", placeRichBands);
  // The Command key pressed over a name that the mouse is on starts the wait; its release, and the window losing the focus, take every underline away.
  document.addEventListener("keydown", (e) => {
    if (e.key !== "Meta" || e.repeat) return;
    for (const f of files.values()) if (f.hover !== null && f.el.isConnected) waitLink(f);
  });
  document.addEventListener("keyup", (e) => {
    if (e.key === "Meta") hideLinks();
  });
  window.addEventListener("blur", hideLinks);
  // The page is going away (the window is closed): the typing that waits for its timer is sent now, for every file that can be saved.
  window.addEventListener("pagehide", () => {
    for (const f of files.values()) void flush(f);
  });
}
