// The rich field for writing a message: the Slack posts of S-21, the thread reply of S-6 and the body of a mail reply (M-10). One frame that holds a toolbar of the styles, the Milkdown editor under it (src/vendor/milkdown.js, A-26) and, unless `arrow` is off, the round send arrow at the right end of the row below.
// The owner puts `el` in its pane and keeps the text itself (the Markdown of the field, `markdown()`); Rust turns it into mrkdwn (`markdown: true` of `slack_channel_post`, S-21) or into the HTML of a mail (`markdown: true` of `send_mail`, M-10) when it sends.
// Milkdown is read the first time `ensure()` is called. Until it is there the frame is drawn with the field off and the arrow off, and `ensure()` says when it is ready. The field has no placeholder (`.agents/rules/frontend.md`).
import { composing, isMac, tag } from "./dom.js";
import { BOLD_SVG, BULLET_LIST_SVG, CODE_BLOCK_SVG, FORMAT_LINK_SVG, INLINE_CODE_SVG, ITALIC_SVG, ORDERED_LIST_SVG, QUOTE_SVG, SEND_SVG, STRIKE_SVG } from "./icons.js";
import { loadMilkdown } from "./vendor-load.js";

export interface RichEditorOptions {
  // Ids of the parts are `{prefix}-input` (the field), `{prefix}-send` (the arrow) and `{prefix}-tools` (the toolbar).
  prefix: string;
  // The accessible name of the field.
  label: string;
  // Whether the frame has the send arrow (default true). The owner of a field with its own send button turns it off.
  arrow?: boolean;
  // The accessible name of the arrow (default "投稿").
  sendLabel?: string;
  // The text changed by typing or by a toolbar button (not by `set`).
  onChange: () => void;
  // Cmd+Enter (Ctrl+Enter off macOS) in the field, or the arrow pressed.
  onSubmit: () => void;
}

export interface RichEditor {
  el: HTMLElement;
  // Reads Milkdown if it is not read yet and makes the editor; resolves when it is ready. A failed read is tried again at the next call.
  ensure(): Promise<void>;
  ready(): boolean;
  // Puts the cursor in the field (nothing before it is ready).
  focus(): void;
  markdown(): string;
  // True when the field holds no text but spaces.
  blank(): boolean;
  // Replaces the content with `markdown` (calls no `onChange`).
  set(markdown: string): void;
  // The field and the toolbar are off while busy.
  setBusy(busy: boolean): void;
  // Nothing when the frame has no arrow.
  setSendDisabled(disabled: boolean): void;
}

const TOOLS: { name: MilkdownCommand | null; label: string; svg: string }[] = [
  { name: "bold", label: "太字", svg: BOLD_SVG },
  { name: "italic", label: "斜体", svg: ITALIC_SVG },
  { name: "strike", label: "取り消し線", svg: STRIKE_SVG },
  { name: null, label: "", svg: "" },
  { name: "link", label: "リンク", svg: FORMAT_LINK_SVG },
  { name: "orderedList", label: "番号付きリスト", svg: ORDERED_LIST_SVG },
  { name: "bulletList", label: "箇条書き", svg: BULLET_LIST_SVG },
  { name: null, label: "", svg: "" },
  { name: "quote", label: "引用", svg: QUOTE_SVG },
  { name: "code", label: "コード", svg: INLINE_CODE_SVG },
  { name: "codeBlock", label: "コードブロック", svg: CODE_BLOCK_SVG },
];

export function createRichEditor({ prefix, label, arrow = true, sendLabel = "投稿", onChange, onSubmit }: RichEditorOptions): RichEditor {
  let view: MilkdownComposer | null = null;
  let loading: Promise<void> | null = null;
  let busy = false;
  // True while `set` replaces the content, whose change is not the user's.
  let silent = false;

  const frame = tag("div", "composer rich-composer");
  const tools = tag("div", "rich-tools");
  tools.id = `${prefix}-tools`;
  tools.setAttribute("role", "toolbar");
  tools.setAttribute("aria-label", "書式");
  const host = tag("div", "rich-input");
  host.id = `${prefix}-input`;
  const send = tag("button", "icon-btn chat-send chat-send-icon");
  send.id = `${prefix}-send`;
  send.setAttribute("aria-label", sendLabel);
  send.insertAdjacentHTML("beforeend", SEND_SVG);
  send.disabled = true;
  send.onclick = onSubmit;
  const foot = tag("div", "composer-foot composer-end");
  foot.append(send);

  const buttons: HTMLButtonElement[] = [];
  const href = tag("input", "rich-href");
  href.type = "text";
  href.hidden = true;
  href.autocomplete = "off";
  href.setAttribute("aria-label", "リンクの URL");
  const closeHref = () => {
    href.hidden = true;
    href.value = "";
  };
  // Runs a command on the selection of the editor, and tells the owner the text changed (the editor calls `onChange` for a change of the document, so nothing is told here).
  const run = (name: MilkdownCommand) => {
    if (!view || busy) return;
    if (name === "link") {
      href.hidden = !href.hidden;
      if (href.hidden) view.focus();
      else href.focus();
      return;
    }
    view.run(name);
  };
  for (const t of TOOLS) {
    if (!t.name) {
      tools.append(tag("span", "rich-sep"));
      continue;
    }
    const name = t.name;
    const b = tag("button", "icon-btn rich-tool");
    b.type = "button";
    b.disabled = true;
    b.setAttribute("aria-label", t.label);
    b.insertAdjacentHTML("beforeend", t.svg);
    // A press must not take the focus (and the selection) from the field.
    b.onmousedown = (e) => e.preventDefault();
    b.onclick = () => run(name);
    buttons.push(b);
    tools.append(b);
  }
  href.onkeydown = (e) => {
    if (composing(e)) return;
    if (e.key === "Enter") {
      e.preventDefault();
      const url = href.value.trim();
      closeHref();
      if (url && view) view.run("link", { href: url });
    } else if (e.key === "Escape") {
      e.preventDefault();
      closeHref();
      view?.focus();
    }
  };
  tools.append(href);
  frame.append(tools, host);
  if (arrow) frame.append(foot);

  // Cmd+Enter (Ctrl+Enter off macOS) sends and is kept from the editor, unless it only confirms an IME conversion. Enter alone is the editor's own line break.
  host.addEventListener(
    "keydown",
    (e) => {
      if (e.key !== "Enter" || composing(e) || !(isMac ? e.metaKey : e.ctrlKey)) return;
      e.preventDefault();
      e.stopPropagation();
      onSubmit();
    },
    true,
  );

  const apply = () => {
    for (const b of buttons) b.disabled = busy || !view;
    view?.setEditable(!busy);
    frame.classList.toggle("busy", busy);
    if (busy) closeHref();
  };

  async function start() {
    await loadMilkdown();
    const made = await TsunagiaiMilkdown.compose(host, () => {
      if (!silent) onChange();
    });
    view = made;
    host.querySelector(".ProseMirror")?.setAttribute("aria-label", label);
    apply();
  }

  return {
    el: frame,
    ensure() {
      if (!loading) {
        loading = start().catch((e) => {
          loading = null;
          throw e;
        });
      }
      return loading;
    },
    ready: () => view !== null,
    focus: () => view?.focus(),
    markdown: () => view?.markdown() ?? "",
    blank: () => view?.blank() ?? true,
    set(markdown) {
      if (!view) return;
      silent = true;
      try {
        view.set(markdown);
      } finally {
        silent = false;
      }
    },
    setBusy(b) {
      busy = b;
      apply();
    },
    setSendDisabled(disabled) {
      send.disabled = disabled || !view;
    },
  };
}
