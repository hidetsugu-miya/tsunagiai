// What the two specs of the Orca screen share (`specs/orca.e2e.ts` and `specs/orca-files.e2e.ts`): the sample list, how the screen is opened, and how its tabs, projects and menus are found.
// A helper that only one of them uses stays in that spec. The mocks stay in `support.ts`; `orcaOverview` and `streamList` here put each item where the list was read from, on top of those of `support.ts`.
import type { OrcaLocal } from "../ts/bindings/OrcaLocal";
import type { OrcaOverview } from "../ts/bindings/OrcaOverview";
import type { OrcaRow } from "../ts/bindings/OrcaRow";
import type { OrcaStreamEvent } from "../ts/bindings/OrcaStreamEvent";
import type { OrcaTerminal } from "../ts/bindings/OrcaTerminal";
import type { OrcaWorktree } from "../ts/bindings/OrcaWorktree";
import { boot, inbox, onceId, orcaOverview as readOf, orcaRow, orcaWorktree, streamList as streamOf, textsOf } from "./support";

// A finished agent has one stop time that every read of it repeats, as Orca's `updatedAt` does (A-6: a stopped row with a newer time is a new notice), so the done row of `sample` keeps its time.
const DONE_AT = Date.now() - 18 * 60_000 - 5_000;
// A running, a waiting and a done agent, and a second running one that has no pane (its session has no tab). Each has its own project (`proj_{repo}`).
export const sample = () => [
  orcaRow("example-app", "feat/a", "Write the docs", { minutes: 2 }),
  orcaRow("example-api", "main", "Fix the parser", { group: "waiting", minutes: 5 }),
  orcaRow("example-web", "dev", "Update the page", { minutes: 11, handle: null, paneKey: null }),
  orcaRow("example-lib", "feature/x", "Opened the pull request.", { group: "done", atMs: DONE_AT }),
];
export const worktrees = () => [orcaWorktree("example-app", "feat/a"), orcaWorktree("example-api", "main")];

// Rust says where each item of a list is (`environment`: the name of the saved environment the list was read from, none for this machine). An item that names no place is put in `environment`; one that names it (null: this machine's) stays.
const placed = <T extends { environment?: string | null }>(items: T[], environment: string | null): T[] => (environment === null ? items : items.map((item) => (item.environment === undefined ? { ...item, environment } : item)));

// `orcaOverview` of `support.ts`, with every item put where the target is, as Rust does.
export const orcaOverview = (rows: OrcaRow[], worktrees: OrcaWorktree[] = [], extra: Partial<OrcaOverview> = {}): OrcaOverview => {
  const read = readOf(rows, worktrees, extra);
  const at = read.target;
  return { ...read, rows: placed(read.rows, at), worktrees: placed(read.worktrees, at), projects: placed(read.projects, at), terminals: placed(read.terminals, at) };
};

// `streamList` of `support.ts`, with every item put in the saved environment that streams it (`Studio`, as the specs stream it), as Rust does; `null` is this machine's Orca (A-12), whose items name no place.
export const streamList = (rows: OrcaRow[], worktrees: OrcaWorktree[] = [], terminals: OrcaTerminal[] = [], environment: string | null = "Studio"): OrcaStreamEvent => {
  const event = streamOf(rows, worktrees, terminals);
  if (event.kind !== "list") return event;
  return { ...event, rows: placed(event.rows, environment), worktrees: placed(event.worktrees, environment), projects: placed(event.projects, environment), terminals: placed(event.terminals, environment) };
};

// The list `read` with the projects of `repos` (and their rows, worktrees and terminals) on this machine, while the rest of it stays where it is: a list of a saved environment that holds this machine's items too.
export const onThisMachine = (read: OrcaOverview, ...repos: string[]): OrcaOverview => {
  const keys = repos.map((repo) => `proj_${repo}`);
  const move = <T extends { environment?: string | null }>(items: T[], keyOf: (item: T) => string): T[] => items.map((item) => (keys.includes(keyOf(item)) ? { ...item, environment: null } : item));
  return { ...read, rows: move(read.rows, (r) => r.projectKey), worktrees: move(read.worktrees, (w) => w.projectKey), projects: move(read.projects, (p) => p.key), terminals: move(read.terminals, (t) => t.projectKey) };
};

// `local` of `orca_overview` (A-6, A-33): this machine's lists beside those of a saved environment, which has its own state. Its items name no place (this machine's); `extra` gives another state or lists.
export const beside = (rows: OrcaRow[], worktrees: OrcaWorktree[] = [], extra: Partial<OrcaLocal> = {}): OrcaLocal => {
  const { state, message, rows: held, worktrees: trees, projects, terminals } = readOf(rows, worktrees);
  return { state, message, rows: held, worktrees: trees, projects, terminals, ...extra };
};

// A saved environment as the target: its list is streamed.
export const studio = { target: "Studio", environments: ["Studio", "Lab"] };

// The app with `value` as what Orca answers, and the Orca screen open.
export async function openOrca(value = orcaOverview(sample(), worktrees()), fixtures: Record<string, unknown> = {}) {
  await boot({ inbox: inbox(), orca_overview: value, ...fixtures });
  await $("#nav-orca").click();
  await expect($("#orca")).toBeDisplayed();
}

// Leaves the Orca screen and shows it again: showing the screen reads the list (with the environments), whatever read is on its way.
export async function showAgain() {
  await $("#nav-mail").click();
  await $("#nav-orca").click();
  await expect($("#orca")).toBeDisplayed();
}

export const selectedTab = () => $('.orca-tabs [role="tab"][aria-selected="true"]');
export const tabTitles = () => textsOf(".orca-tabs .orca-tab-title");
export const tabOf = (id: string) => $(`.orca-tabs [data-tab="${id}"]`);
export const claudeTab = (repo: string) => `claude:tab_${repo}:leaf_1`;

// The page's own press of an item of a menu, found by its text, or by its aria-label for an icon button (the driver's click focuses the button after the page's handler ran, which no real press does).
export async function pickItem(label: string) {
  await browser.execute(
    (id, text) => {
      if (!window.__e2e_once__(id)) return;
      [...document.querySelectorAll<HTMLElement>('.menu[role="menu"] button')].find((b) => (b.getAttribute("aria-label") ?? b.textContent) === text)!.click();
    },
    onceId(),
    label,
  );
}

// The button of the file pane that is on the screen (one at a time: the corner pane's while the pane is hidden, the pane's own while it is shown).
// The pane's own has no `hidden` of its own (the pane around it has), so it is found by the pane.
export const filesToggle = () => $(".orca-tabbar .orca-files-toggle:not([hidden]), #orca-files:not([hidden]) .orca-files-toggle");

export const project = (name: string) => $(`//*[@id="orca-list"]//button[contains(@class,"orca-project")][.//span[@class="orca-project-name"][. = "${name}"]]`);

// The source view of a file in the editor (A-18) is CodeMirror 6, so a spec reads and drives its DOM: the lines are `.cm-line` in `.cm-content`, and only the lines near the window are drawn (a spec that reads or moves the caret by an offset keeps to the lines at the top).
export const CONTENT = ".orca-edit-body .cm-content";

// The text of the editor now, all of it: read from the editor (`window.__e2e_editors__`, e2e/fixtures.js), because the page draws only the lines near the window.
export const editorText = () =>
  browser.execute(() => {
    const dom = document.querySelector(".orca-edit-body .cm-editor");
    return window.__e2e_editors__.find((editor) => editor.dom === dom)?.text() ?? "";
  });

// Waits until the editor holds `content`, and says what it holds when it never does.
export async function waitForText(content: string) {
  let last = "";
  try {
    await browser.waitUntil(async () => {
      last = await editorText();
      return last === content;
    });
  } catch {
    throw new Error(`the editor holds ${JSON.stringify(last)}, not ${JSON.stringify(content)}`);
  }
}

// The box on the page of the character at each of `offsets` of the text of the editor (null: it is not drawn, or the offset is a line end).
export const charBoxes = (...offsets: number[]) =>
  browser.execute((list) => {
    const lines = [...(document.querySelector(".orca-edit-body .cm-content")?.querySelectorAll(".cm-line") ?? [])];
    return list.map((offset) => {
      let left = offset;
      for (const line of lines) {
        const length = line.textContent!.length;
        if (left >= length) {
          left -= length + 1;
          continue;
        }
        const walker = document.createTreeWalker(line, NodeFilter.SHOW_TEXT);
        for (let node = walker.nextNode() as Text | null; node !== null; node = walker.nextNode() as Text | null) {
          if (left >= node.length) {
            left -= node.length;
            continue;
          }
          const range = document.createRange();
          range.setStart(node, left);
          range.setEnd(node, left + 1);
          const box = range.getBoundingClientRect();
          return { left: box.left, top: box.top, right: box.right, bottom: box.bottom, width: box.width, height: box.height };
        }
        return null;
      }
      return null;
    });
  }, offsets);
export type CharBox = NonNullable<Awaited<ReturnType<typeof charBoxes>>[number]>;

// The window of the E2E build has no focus (`document.hasFocus()` is false), and the editor draws its caret, its band and its selection only while its document has the focus: the page says it has, as the window of the owner has it.
export const claimFocus = () =>
  browser.execute(() => {
    document.hasFocus = () => true;
  });

// Gives the editor the focus as the owner's click does (the page says its window has it).
export const focusEditor = () =>
  browser.execute(() => {
    document.hasFocus = () => true;
    const content = document.querySelector<HTMLElement>(".orca-edit-body .cm-content")!;
    content.focus({ preventScroll: true });
    content.dispatchEvent(new FocusEvent("focus"));
  });

// Takes the focus from the editor, and the page says its window has none again.
export const blurEditor = () =>
  browser.execute(() => {
    delete (document as { hasFocus?: unknown }).hasFocus;
    const content = document.querySelector<HTMLElement>(".orca-edit-body .cm-content")!;
    content.blur();
    content.dispatchEvent(new FocusEvent("blur"));
  });

const frames = () => browser.execute("return new Promise((done) => requestAnimationFrame(() => requestAnimationFrame(done)))");

// Gives the editor the focus and puts the selection from offset `start` to `end` of its text in it (the lines drawn are the ones that can hold it). The editor takes the selection of the page at the `selectionchange` that follows.
export async function setCaret(start: number, end = start) {
  await focusEditor();
  await browser.execute(
    (a, b) => {
      const lines = [...document.querySelector(".orca-edit-body .cm-content")!.querySelectorAll(".cm-line")];
      const place = (offset: number): [Node, number] => {
        let left = offset;
        for (const line of lines) {
          const length = line.textContent!.length;
          if (left > length) {
            left -= length + 1;
            continue;
          }
          const walker = document.createTreeWalker(line, NodeFilter.SHOW_TEXT);
          for (let node = walker.nextNode() as Text | null; node !== null; node = walker.nextNode() as Text | null) {
            if (left <= node.length) return [node, left];
            left -= node.length;
          }
          return [line, 0];
        }
        const last = lines[lines.length - 1];
        return [last, last.childNodes.length];
      };
      const [anchor, anchorAt] = place(a);
      const [focus, focusAt] = place(b);
      const range = document.createRange();
      range.setStart(anchor, anchorAt);
      range.setEnd(focus, focusAt);
      const selection = getSelection()!;
      selection.removeAllRanges();
      selection.addRange(range);
    },
    start,
    end,
  );
  await frames();
}

// Where the caret of the editor is in its text (the end of the selection), null while the page has no selection in it. The editor puts its selection in the page only while it has the focus (`claimFocus`).
export const caretOffset = () =>
  browser.execute(() => {
    const content = document.querySelector(".orca-edit-body .cm-content")!;
    const selection = getSelection()!;
    const node = selection.focusNode;
    if (node === null || !content.contains(node)) return null;
    const lines = [...content.querySelectorAll(".cm-line")];
    const line = node === content ? lines[Math.min(selection.focusOffset, lines.length - 1)] : (node instanceof Element ? node : node.parentElement!).closest(".cm-line")!;
    const before = lines.slice(0, lines.indexOf(line)).reduce((n, l) => n + l.textContent!.length + 1, 0);
    if (node === content) return before + (selection.focusOffset >= lines.length ? line.textContent!.length : 0);
    const range = document.createRange();
    range.setStart(line, 0);
    range.setEnd(node, selection.focusOffset);
    return before + range.toString().length;
  });

// The keys of WebDriver: Command, Enter, Tab, Backspace and the arrow down.
const META = "\u{E03D}";
const ENTER = "\u{E007}";
const TAB = "\u{E004}";
const BACKSPACE = "\u{E003}";
const ARROW_DOWN = "\u{E015}";

// Types `text` with real keys, a line feed as Enter and a tab as Tab (the editor indents by them).
async function typeKeys(text: string) {
  for (const part of text.split(/(\n|\t)/)) {
    if (part === "\n") await browser.keys(ENTER);
    else if (part === "\t") await browser.keys(TAB);
    else if (part !== "") await browser.keys(part);
  }
}

// Types `add` at the end of the text of the editor, as the owner does (the keys go to the editor, which has the focus); the page says its window has the focus until the keys are typed.
export async function typeIn(add: string) {
  await focusEditor();
  await browser.keys([META, ARROW_DOWN]);
  await typeKeys(add);
  await browser.execute(() => {
    delete (document as { hasFocus?: unknown }).hasFocus;
  });
}

// Takes the whole text of the editor out and types `value` in its place (select all, Backspace and the keys).
export async function setText(value: string) {
  await focusEditor();
  await browser.keys([META, "a"]);
  await browser.keys(BACKSPACE);
  await typeKeys(value);
  await browser.execute(() => {
    delete (document as { hasFocus?: unknown }).hasFocus;
  });
}

// The keys that fold and open the range at the caret: Option and Command with [ and with ] (A-18).
const ALT = "\u{E00A}";
export const pressFold = () => browser.keys([ALT, META, "["]);
export const pressUnfold = () => browser.keys([ALT, META, "]"]);

// The key Tab and Enter at the caret, with nothing typed before them.
export const pressTab = () => browser.keys(TAB);
export const pressEnter = () => browser.keys(ENTER);
