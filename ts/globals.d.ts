// What the page provides outside the modules: Tauri's global (`withGlobalTauri`) and the classic scripts of src/vendor/.
interface Window {
  __TAURI__: {
    core: {
      invoke(command: string, args?: unknown, options?: { headers: Record<string, string> }): Promise<unknown>;
      // A stream from Rust: it is passed as an argument of a command, and what Rust sends reaches `onmessage`.
      Channel: new <T>() => { onmessage: (message: T) => void };
    };
    // What Rust sends with `emit` (the Slack list's Socket Mode, S-16); the answer takes the listener off.
    event: {
      listen<T>(event: string, handler: (event: { payload: T }) => void): Promise<() => void>;
    };
  };
  // E2E build only (e2e/fixtures.js): the periods of the timers that a spec shortens (ts/e2e-timers.ts).
  __e2e_timers__?: Partial<Record<"orcaClock" | "orcaMirror" | "databaseProfiles" | "formationFlow" | "lspSettings" | "machineResources" | "machineUsage" | "calendarNotice", number>>;
  // E2E build only: a spec sets it before it shows a terminal to have the WebGL renderer, which the build leaves off (ts/orca-terminal.ts).
  __e2e_webgl__?: boolean;
}

declare const marked: { parse(markdown: string, options?: { breaks?: boolean }): string };
// highlight.js (src/vendor/highlight.min.js and highlight-languages.js): only what the editor of the Orca screen uses (A-21). `value` is the text with its tokens in `<span class="hljs-...">`, the text itself escaped.
declare const hljs: { highlight(code: string, options: { language: string; ignoreIllegals?: boolean }): { value: string } };
// Milkdown (src/vendor/milkdown.js, bundled by scripts/build-milkdown.mjs, A-26). `mount` draws a Markdown text in `root`, read only: `markdown()` is what the editor exports now, `edit(onEdit)` makes it editable and calls `onEdit` after each change of the document, and `destroy` takes the editor out of `root`. `normalize` is the export of a text by an editor that is drawn nowhere.
interface MilkdownView {
  destroy(): Promise<unknown>;
  markdown(): string;
  edit(onEdit: () => void): void;
}
// `compose` makes an editable editor for writing a message (S-21): `onChange` is called after each change of the document (also one made by `set`), `blank` is true when it holds no text but spaces, `set` replaces the content, `run` runs one command of the toolbar and gives the focus back to the text (`link` takes `{ href }`), and `setEditable` turns the typing on or off.
type MilkdownCommand = "bold" | "italic" | "strike" | "link" | "orderedList" | "bulletList" | "quote" | "code" | "codeBlock";
interface MilkdownComposer {
  destroy(): Promise<unknown>;
  markdown(): string;
  blank(): boolean;
  set(markdown: string): void;
  focus(): void;
  setEditable(on: boolean): void;
  run(name: MilkdownCommand, payload?: { href: string }): void;
}
declare const TsunagiaiMilkdown: {
  mount(root: HTMLElement, markdown: string): Promise<MilkdownView>;
  normalize(markdown: string): Promise<string>;
  compose(root: HTMLElement, onChange: () => void): Promise<MilkdownComposer>;
};
// CodeMirror 6 (src/vendor/codemirror.js, bundled by scripts/build-codemirror.mjs, A-18). `create` draws `text` in `host` as the editor of a file whose language is `language` (Orca's name for it, as `orca_file_read` gives it; one that has no grammar here is drawn plain).
// `marker(open)` makes the arrow of a line that can be folded (`open` for a line that is not folded); with none the editor draws no arrow. `onChange` is called after each change by the owner (a key, a paste, an undo) and after `edit`, not after `replace`.
// `text` is the text now (lines end with \n). `replace` puts a text that comes from outside (the file read again) in place: the cursor, the scroll and the folds stay, `onChange` is not called and the history takes no step. `edit` puts in the text of an edit made elsewhere (the rich view): it is an edit like a key.
// `offsetAt` is the offset of the character under the point (x, y of the window), null where there is none; `boxOf` is the box on the page of the text from one offset to another, null when it is not drawn; `goTo` puts the caret at a line (from 0) and a character (UTF-16 units) and shows it in the middle; `label` changes the aria-label; `dom` is the editor's element and `scrollDOM` the one that scrolls.
interface CodeMirrorEditor {
  text(): string;
  replace(text: string): void;
  edit(text: string): void;
  offsetAt(x: number, y: number): number | null;
  boxOf(from: number, to: number): DOMRect | null;
  goTo(line: number, character: number): void;
  label(label: string): void;
  focus(): void;
  readonly dom: HTMLElement;
  readonly scrollDOM: HTMLElement;
  destroy(): void;
}
declare const TsunagiaiCodeMirror: {
  create(
    host: HTMLElement,
    options: { text: string; language: string; readOnly: boolean; label: string; marker?: (open: boolean) => HTMLElement; onChange: () => void },
  ): CodeMirrorEditor;
};
// Pele (src/vendor/pele.global.js, A-41 and A-26; the rich view reads it through the bundle of Milkdown, scripts/milkdown-entry.js): only `render`, which gives the SVG of one diagram and its size, and throws a `PeleError` when the text cannot be drawn. It makes no HTML label and no script, and the options here cut the links and the images.
declare const pele: {
  render(source: string, options?: { fontFamily?: string; idPrefix?: string; links?: boolean; images?: boolean }): { svg: string; width: number; height: number };
};
declare const DOMPurify: { sanitize(html: string, config?: Record<string, unknown>): string };

// xterm.js (src/vendor/xterm.js), its fit addon (src/vendor/addon-fit.js), its Unicode 11 addon (src/vendor/addon-unicode11.js), its web links addon (src/vendor/addon-web-links.js) and its WebGL addon (src/vendor/addon-webgl.js): only what the terminals of the Orca screen use.
interface XTerm {
  cols: number;
  rows: number;
  // The widths of characters (Unicode 11, set when the addon is loaded); a proposed API of xterm.js, so the terminal is made with `allowProposedApi`.
  unicode: { activeVersion: string };
  open(parent: HTMLElement): void;
  // `callback` is called once the data is parsed.
  write(data: string, callback?: () => void): void;
  reset(): void;
  resize(cols: number, rows: number): void;
  focus(): void;
  // Types `data` as a paste: wrapped in the bracketed-paste marks when the program asked for them (A-10).
  paste(data: string): void;
  // Drops the selection (a link that was opened leaves none, as in Orca).
  clearSelection(): void;
  hasSelection(): boolean;
  onSelectionChange(listener: () => void): { dispose(): void };
  dispose(): void;
  loadAddon(addon: unknown): void;
  onData(listener: (data: string) => void): { dispose(): void };
  // The options that are set while the terminal lives (A-13): the font of Ghostty's settings and the colors of the theme (A-14).
  options: { fontFamily: string; fontSize: number; fontWeight: string | number; theme: Record<string, unknown> };
  // `handler` gets the data of each OSC sequence with the number `ident` (OSC 52 asks for the clipboard); true says it was handled.
  parser: { registerOscHandler(ident: number, handler: (data: string) => boolean): { dispose(): void } };
  // `handler` is asked for each key event first; false keeps xterm.js from handling it.
  attachCustomKeyEventHandler(handler: (event: KeyboardEvent) => boolean): void;
}
declare const Terminal: new (options?: Record<string, unknown>) => XTerm;
declare const FitAddon: { FitAddon: new () => { fit(): void; proposeDimensions(): { cols: number; rows: number } | undefined } };
declare const Unicode11Addon: { Unicode11Addon: new () => unknown };
// The WebGL renderer (a pre-release of the addon): `onContextLoss` fires when the GPU takes the context away, and `dispose` gives the drawing back to xterm.js's DOM renderer.
declare const WebglAddon: {
  WebglAddon: new () => { onContextLoss(listener: () => void): { dispose(): void }; dispose(): void };
};
// `handler` is called with the click on a link; `hover` and `leave` with the pointer over it; `urlRegex` finds the URLs in a line.
declare const WebLinksAddon: {
  WebLinksAddon: new (
    handler: (event: MouseEvent, uri: string) => void,
    options: { hover: (event: MouseEvent, uri: string) => void; leave: (event: MouseEvent, uri: string) => void; urlRegex: RegExp },
  ) => unknown;
};
