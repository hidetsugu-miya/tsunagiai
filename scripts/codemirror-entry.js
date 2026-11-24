// The entry of the bundle src/vendor/codemirror.js (scripts/build-codemirror.mjs): the editor of the Orca screen (A-18), as CodeMirror 6 with what the app uses of it.
// The page gets one function, `TsunagiaiCodeMirror.create`; everything else (the languages, the folding, the keys, the band of the cursor's line) is decided here.
import { Annotation, Compartment, EditorState, Transaction } from "@codemirror/state";
import { Decoration, EditorView, ViewPlugin, keymap, lineNumbers } from "@codemirror/view";
import { LanguageSupport, StreamLanguage, codeFolding, foldGutter, foldKeymap, foldService, syntaxHighlighting } from "@codemirror/language";
import { classHighlighter } from "@lezer/highlight";
import { defaultKeymap, history, historyKeymap, indentWithTab } from "@codemirror/commands";
import { cpp } from "@codemirror/lang-cpp";
import { css } from "@codemirror/lang-css";
import { go } from "@codemirror/lang-go";
import { html } from "@codemirror/lang-html";
import { java } from "@codemirror/lang-java";
import { jsxLanguage, tsxLanguage } from "@codemirror/lang-javascript";
import { json } from "@codemirror/lang-json";
import { less } from "@codemirror/lang-less";
import { liquid } from "@codemirror/lang-liquid";
import { markdown, markdownLanguage } from "@codemirror/lang-markdown";
import { php } from "@codemirror/lang-php";
import { python } from "@codemirror/lang-python";
import { rust } from "@codemirror/lang-rust";
import { sass } from "@codemirror/lang-sass";
import { MySQL, PostgreSQL, sql } from "@codemirror/lang-sql";
import { vue } from "@codemirror/lang-vue";
import { xml } from "@codemirror/lang-xml";
import { yaml } from "@codemirror/lang-yaml";
import { clojure } from "@codemirror/legacy-modes/mode/clojure";
import { cmake } from "@codemirror/legacy-modes/mode/cmake";
import { coffeeScript } from "@codemirror/legacy-modes/mode/coffeescript";
import { csharp, dart, kotlin, objectiveC, scala } from "@codemirror/legacy-modes/mode/clike";
import { cypher } from "@codemirror/legacy-modes/mode/cypher";
import { dockerFile } from "@codemirror/legacy-modes/mode/dockerfile";
import { ecl } from "@codemirror/legacy-modes/mode/ecl";
import { erlang } from "@codemirror/legacy-modes/mode/erlang";
import { groovy } from "@codemirror/legacy-modes/mode/groovy";
import { haskell } from "@codemirror/legacy-modes/mode/haskell";
import { jinja2 } from "@codemirror/legacy-modes/mode/jinja2";
import { julia } from "@codemirror/legacy-modes/mode/julia";
import { lua } from "@codemirror/legacy-modes/mode/lua";
import { fSharp } from "@codemirror/legacy-modes/mode/mllike";
import { pascal } from "@codemirror/legacy-modes/mode/pascal";
import { perl } from "@codemirror/legacy-modes/mode/perl";
import { powerShell } from "@codemirror/legacy-modes/mode/powershell";
import { properties } from "@codemirror/legacy-modes/mode/properties";
import { protobuf } from "@codemirror/legacy-modes/mode/protobuf";
import { pug } from "@codemirror/legacy-modes/mode/pug";
import { r } from "@codemirror/legacy-modes/mode/r";
import { ruby } from "@codemirror/legacy-modes/mode/ruby";
import { scheme } from "@codemirror/legacy-modes/mode/scheme";
import { shell } from "@codemirror/legacy-modes/mode/shell";
import { sparql } from "@codemirror/legacy-modes/mode/sparql";
import { swift } from "@codemirror/legacy-modes/mode/swift";
import { tcl } from "@codemirror/legacy-modes/mode/tcl";
import { vb } from "@codemirror/legacy-modes/mode/vb";
import { verilog } from "@codemirror/legacy-modes/mode/verilog";

// HTML as the parts of the other languages use it: the editor adds no key or input of its own, so it closes no tag.
const plainHtml = () => html({ autoCloseTags: false, matchClosingTags: false });
const stream = (mode) => () => new LanguageSupport(StreamLanguage.define(mode));

// The language names are Orca's (`orca_file_read`'s `language`, src-tauri/src/orca_language.rs). A language of Lezer folds by its syntax tree (the `foldNodeProp` of its nodes).
const LEZER = {
  typescript: () => new LanguageSupport(tsxLanguage),
  javascript: () => new LanguageSupport(jsxLanguage),
  "glimmer-ts": () => new LanguageSupport(tsxLanguage),
  "glimmer-js": () => new LanguageSupport(jsxLanguage),
  json: () => json(),
  jsonl: () => json(),
  notebook: () => json(),
  css: () => css(),
  scss: () => sass(),
  less: () => less(),
  html: plainHtml,
  svelte: plainHtml,
  astro: plainHtml,
  xml: () => xml({ autoCloseTags: false }),
  markdown: () => markdownLanguageSupport(),
  mdx: () => markdownLanguageSupport(),
  quarto: () => markdownLanguageSupport(),
  python: () => python(),
  rust: () => rust(),
  go: () => go(),
  java: () => java(),
  apex: () => java(),
  c: () => cpp(),
  cpp: () => cpp(),
  "cuda-cpp": () => cpp(),
  php: () => php({ baseLanguage: plainHtml().language }),
  sql: () => sql(),
  mysql: () => sql({ dialect: MySQL }),
  pgsql: () => sql({ dialect: PostgreSQL }),
  redshift: () => sql({ dialect: PostgreSQL }),
  yaml: () => yaml(),
  liquid: () => liquid({ base: plainHtml() }),
};

// GitHub flavored Markdown, with no key of its own (Enter does not continue a list) and no paste of a link.
const markdownLanguageSupport = () => markdown({ base: markdownLanguage, addKeymap: false, pasteURLAsLink: false, htmlTagLanguage: plainHtml() });

// A language with no `foldNodeProp`: a language of StreamLanguage (the old modes of CodeMirror), the Vue template, and the languages that have no grammar here. They fold by the indentation, below.
const INDENT = {
  vue: () => vue(),
  twig: stream(jinja2),
  ruby: stream(ruby),
  shell: stream(shell),
  powershell: stream(powerShell),
  perl: stream(perl),
  lua: stream(lua),
  r: stream(r),
  swift: stream(swift),
  kotlin: stream(kotlin),
  scala: stream(scala),
  csharp: stream(csharp),
  "objective-c": stream(objectiveC),
  dart: stream(dart),
  groovy: stream(groovy),
  dockerfile: stream(dockerFile),
  ini: stream(properties),
  dotenv: stream(properties),
  proto: stream(protobuf),
  cmake: stream(cmake),
  erlang: stream(erlang),
  haskell: stream(haskell),
  clojure: stream(clojure),
  julia: stream(julia),
  coffeescript: stream(coffeeScript),
  scheme: stream(scheme),
  tcl: stream(tcl),
  vb: stream(vb),
  pascal: stream(pascal),
  verilog: stream(verilog),
  systemverilog: stream(verilog),
  fsharp: stream(fSharp),
  cypher: stream(cypher),
  sparql: stream(sparql),
  pug: stream(pug),
  ecl: stream(ecl),
};

// Folding by the indentation, as Monaco does by default and Zed does: a line folds when the next line that is not blank is indented deeper, and the range runs to the last line deeper than it
// (so the line that closes the block, an `end` or a `}`, stays). A tab counts as 2.
const indentOf = (text) => {
  let n = 0;
  for (const c of /^[ \t]*/.exec(text)[0]) n += c === "\t" ? 2 : 1;
  return n;
};
const foldByIndent = foldService.of((state, from) => {
  const line = state.doc.lineAt(from);
  if (!line.text.trim()) return null;
  const base = indentOf(line.text);
  let last = null;
  for (let i = line.number + 1; i <= state.doc.lines; i++) {
    const next = state.doc.line(i);
    if (!next.text.trim()) continue;
    if (indentOf(next.text) <= base) break;
    last = next;
  }
  return last === null ? null : { from: line.to, to: last.to };
});

const languageOf = (name) => {
  if (Object.hasOwn(LEZER, name)) return LEZER[name]();
  return [Object.hasOwn(INDENT, name) ? INDENT[name]() : [], foldByIndent];
};

// The band of the line the cursor is on, only while the editor has the focus and nothing is selected.
const cursorLine = ViewPlugin.fromClass(
  class {
    constructor(view) {
      this.decorations = this.build(view);
    }
    update(update) {
      if (update.docChanged || update.selectionSet || update.focusChanged) this.decorations = this.build(update.view);
    }
    build(view) {
      const { main } = view.state.selection;
      if (!view.hasFocus || !main.empty) return Decoration.none;
      return Decoration.set([Decoration.line({ class: "cm-activeLine" }).range(view.state.doc.lineAt(main.head).from)]);
    }
  },
  { decorations: (plugin) => plugin.decorations },
);

// A change that comes from outside the editor (the file read again from the disk): it does not call `onChange` and is not put in the history.
const outside = Annotation.define();

// The one change from `old` to `next`: what is common at the start and at the end stays, so the cursor, the scroll and the folds keep their places.
const changeTo = (old, next) => {
  let from = 0;
  const most = Math.min(old.length, next.length);
  while (from < most && old.charCodeAt(from) === next.charCodeAt(from)) from++;
  let end = 0;
  while (end < most - from && old.charCodeAt(old.length - 1 - end) === next.charCodeAt(next.length - 1 - end)) end++;
  return { from, to: old.length - end, insert: next.slice(from, next.length - end) };
};

// What stands for a folded range: a small `…` that opens the range when it is pressed. It has no title, so no tooltip comes with it.
const foldPlaceholder = (view, onclick) => {
  const element = document.createElement("span");
  element.textContent = "…";
  element.setAttribute("aria-label", view.state.phrase("folded code"));
  element.className = "cm-foldPlaceholder";
  element.onclick = onclick;
  return element;
};

const labelAttributes = (label) => EditorView.contentAttributes.of({ "aria-label": label });

// Draws `text` in `host` as the editor of a file of the language `language` (Orca's name, "plaintext" for the rest).
// `marker(open)` makes the arrow of a foldable line (an element, `open` for a line that is not folded); with none, the editor draws no arrow and still folds by its keys (⌥⌘[ and ⌥⌘]). A folded range is drawn as `…` and does not change the text, which `text()` and `onChange` see.
// `onChange()` is called after each change that the owner makes (a key, a paste, an undo) and after `edit`, never after `replace`.
export function create(host, { text, language, readOnly, label, marker, onChange }) {
  const labelSlot = new Compartment();
  const extensions = [
    lineNumbers(),
    marker ? foldGutter({ markerDOM: marker }) : [],
    codeFolding({ placeholderDOM: foldPlaceholder }),
    history(),
    syntaxHighlighting(classHighlighter),
    languageOf(language),
    cursorLine,
    keymap.of([indentWithTab, ...foldKeymap, ...historyKeymap, ...defaultKeymap]),
    EditorState.tabSize.of(2),
    EditorState.readOnly.of(readOnly === true),
    labelSlot.of(labelAttributes(label)),
    EditorView.updateListener.of((update) => {
      if (update.transactions.some((tr) => tr.docChanged && !tr.annotation(outside))) onChange();
    }),
  ];
  const view = new EditorView({ parent: host, state: EditorState.create({ doc: text, extensions }) });
  const put = (next, annotations) => {
    const old = view.state.doc.toString();
    if (old !== next) view.dispatch({ changes: changeTo(old, next), annotations });
  };
  return {
    text: () => view.state.doc.toString(),
    // The text read again from outside: no `onChange`, no step of the history.
    replace: (next) => put(next, [outside.of(true), Transaction.addToHistory.of(false)]),
    // The text of the owner's own edit made elsewhere (the rich view): it is an edit like a key, so `onChange` is called and it can be undone.
    edit: (next) => put(next, []),
    // The offset of the character under the point (x, y of the window), null where there is none (past the end of a line, or below the last).
    offsetAt(x, y) {
      const caret = view.posAtCoords({ x, y });
      if (caret === null) return null;
      for (const at of [caret, caret - 1]) {
        const box = at < 0 ? null : view.coordsForChar(at);
        if (box !== null && x >= box.left && x < box.right && y >= box.top && y < box.bottom) return at;
      }
      return null;
    },
    // The box on the page of the text from `from` to `to`, null when it is not drawn.
    boxOf(from, to) {
      const start = view.coordsAtPos(from, 1);
      const end = view.coordsAtPos(to, -1);
      if (start === null || end === null) return null;
      const left = Math.min(start.left, end.left);
      const top = Math.min(start.top, end.top);
      return new DOMRect(left, top, Math.max(start.right, end.right) - left, Math.max(start.bottom, end.bottom) - top);
    },
    // Puts the caret at the line (from 0) and the character (UTF-16 units) in it, in the middle of the pane; a place past the end is the end.
    goTo(line, character) {
      const at = view.state.doc.line(Math.min(Math.max(line, 0), view.state.doc.lines - 1) + 1);
      const pos = at.from + Math.min(character, at.length);
      view.dispatch({ selection: { anchor: pos }, effects: EditorView.scrollIntoView(pos, { y: "center" }) });
      view.focus();
    },
    label: (next) => view.dispatch({ effects: labelSlot.reconfigure(labelAttributes(next)) }),
    focus: () => view.focus(),
    dom: view.dom,
    scrollDOM: view.scrollDOM,
    destroy: () => view.destroy(),
  };
}
