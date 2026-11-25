import type { MarkdownParts } from "../../ts/bindings/MarkdownParts";
import type { MarkdownPatchResult } from "../../ts/bindings/MarkdownPatchResult";
import type { OrcaCommit } from "../../ts/bindings/OrcaCommit";
import type { OrcaCommitFile } from "../../ts/bindings/OrcaCommitFile";
import type { OrcaCommitFiles } from "../../ts/bindings/OrcaCommitFiles";
import type { OrcaCommitList } from "../../ts/bindings/OrcaCommitList";
import type { OrcaDeleted } from "../../ts/bindings/OrcaDeleted";
import type { OrcaDiffRow } from "../../ts/bindings/OrcaDiffRow";
import type { OrcaDir } from "../../ts/bindings/OrcaDir";
import type { OrcaFileDiff } from "../../ts/bindings/OrcaFileDiff";
import type { OrcaFileText } from "../../ts/bindings/OrcaFileText";
import type { OrcaGitChange } from "../../ts/bindings/OrcaGitChange";
import type { OrcaGitMark } from "../../ts/bindings/OrcaGitMark";
import type { OrcaGitWorktree } from "../../ts/bindings/OrcaGitWorktree";
import type { OrcaLocalBranch } from "../../ts/bindings/OrcaLocalBranch";
import type { OrcaRemoteBranch } from "../../ts/bindings/OrcaRemoteBranch";
import type { OrcaSaved } from "../../ts/bindings/OrcaSaved";
import type { PaneLayout } from "../../ts/bindings/PaneLayout";
import type { PaneNode } from "../../ts/bindings/PaneNode";
import { type GivenFile, callsOf, copiedTexts, count, huge, note, databaseCell, databaseColumn, databaseProfile, databaseRecords, databaseSqlResult, databaseStructure, databaseTable, emitEvent, fontSettings, holds, mock, onceId, orcaRow, orcaTerminal, orcaWorktree, popoutTab, rejects, release, sendFiles, sendPopout, sendStream, stubClipboard, textsOf, timers, waitForCalls, waitForCount, CARDS, CARD } from "../support";
import { blurEditor, caretOffset, charBoxes, claudeTab, CONTENT, editorText, filesToggle, onThisMachine, openOrca, orcaOverview, pickItem, pressEnter, pressFold, pressTab, pressUnfold, project, sample, selectedTab, setCaret, setText, showAgain, streamList, studio, tabOf, tabTitles, typeIn, waitForText, worktrees } from "../orca-support";

// A-18: the file pane and the editor. Rust reads the folders, reads and saves the text, and decides whether a save went through (unit tests); here the screen is checked: what it asks of Rust, and how it draws the answers.
describe("orca: files and editor (A-18)", () => {
  const claude = claudeTab("example-app");
  const zsh = "orca:term_example-app_zsh";
  const pane = (id: string, tabs: string[], selected = tabs[0]): PaneNode => ({ kind: "pane", id, tabs, selected });
  const layout = (root: PaneNode, focus: string): PaneLayout => ({ root, focus });
  // The entries of the folder `dir`: [name, is a folder, ignored by git, the icon Rust names for the file]. Rust lists a folder with no entry marked unless the folder itself is ignored (the third is then true); the marks of the others come from `orca_files_ignored`.
  const dirOf = (dir: string, entries: [string, boolean, boolean?, string?][]): OrcaDir => ({
    entries: entries.map(([name, isDirectory, ignored = false, icon = null]) => ({ name, path: dir === "" ? name : `${dir}/${name}`, isDirectory, ignored, icon })),
    total: entries.length,
  });
  const root = () =>
    dirOf("", [
      ["src", true],
      ["target", true],
      ["a.rs", false],
      ["b.log", false],
    ]);
  // What `orca_files_ignored` answers for the root.
  const rootIgnored = ["target", "b.log"];
  const isIgnored = (path: string) => browser.execute((p) => document.querySelector<HTMLElement>(`.orca-file[data-path="${p}"]`)?.dataset.ignored, path);
  // A-39: the entry `path` differs from HEAD (`orca_files_changes`), and how the row of an entry looks.
  const change = (path: string, mark: OrcaGitMark): OrcaGitChange => ({ path, mark });
  const gitLook = (path: string) =>
    browser.execute((p) => {
      const node = document.querySelector<HTMLElement>(`.orca-file[data-path="${p}"]`)!;
      const name = getComputedStyle(node.querySelector(".orca-file-name")!);
      const git = node.querySelector<HTMLElement>(".orca-file-git");
      const box = git?.getBoundingClientRect();
      const style = git === null ? null : getComputedStyle(git);
      return {
        change: node.dataset.change ?? null,
        name: name.color,
        weight: name.fontWeight,
        style: name.fontStyle,
        icon: getComputedStyle(node.querySelector(".orca-file-ic")!).color,
        background: getComputedStyle(node).backgroundColor,
        opacity: getComputedStyle(node).opacity,
        git: git === null || box === undefined || style === null ? null : { text: git.textContent, color: style.color, fill: style.backgroundColor, width: box.width, height: box.height, radius: style.borderRadius, fromEnd: node.getBoundingClientRect().right - box.right },
      };
    }, path);
  const WARN = "rgb(154, 91, 0)";
  const INS = "rgb(26, 127, 55)";
  const WHITE = "rgb(255, 255, 255)";
  // A press on a row with ⌘: it adds the row to the selection (a folder is not opened by it).
  const metaPress = (path: string) =>
    browser.execute(
      (p, once) => {
        if (!window.__e2e_once__(once)) return;
        document.querySelector(`.orca-file[data-path="${p}"]`)!.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true, metaKey: true }));
      },
      path,
      onceId(),
    );
  const text = (content: string, signature = "sig-1", language = "plaintext"): OrcaFileText => ({ content, crlf: false, signature, language });
  const saved = (signature: string): OrcaSaved => ({ state: "saved", signature });
  const names = () => textsOf("#orca-files-tree .orca-file-name");
  const toggleBoxes = () =>
    browser.execute(() =>
      [...document.querySelectorAll<HTMLElement>(".orca-files-toggle")]
        .filter((e) => e.getClientRects().length > 0)
        .map((e) => {
          const r = e.getBoundingClientRect();
          return { top: r.top, right: r.right, bottom: r.bottom, inFiles: e.closest("#orca-files") !== null, pressed: e.getAttribute("aria-pressed"), label: e.getAttribute("aria-label") };
        }),
    );
  const row = (path: string) => $(`#orca-files-tree .orca-file[data-path="${path}"]`);
  const stateText = () => $(".orca-edit-state");
  const dirtyMarks = () => count(".orca-tab-dirty");

  // The app with the example-app project selected, its Claude session the selected tab, the file pane open and its root read.
  async function openFiles(fixtures: Record<string, unknown> = {}, value = orcaOverview(sample(), worktrees())) {
    await openOrca(value, { orca_terminal_read: ["$"], orca_files_list: root(), orca_files_ignored: rootIgnored, editor_settings: { autosaveMs: 100 }, ...fixtures });
    await project("example-app").click();
    await expect(selectedTab()).toBeDisplayed();
    await filesToggle().click();
    await expect($("#orca-files")).toBeDisplayed();
  }

  // The window gets the focus back (the app is activated): the file pane reads again what it shows (A-18, A-27).
  const focusBack = () => browser.execute(() => window.dispatchEvent(new Event("focus")));

  // The page's own double press on a file of the tree.
  const doublePress = (path: string) =>
    browser.execute(
      (p, once) => {
        if (!window.__e2e_once__(once)) return;
        document.querySelector(`.orca-file[data-path="${p}"]`)!.dispatchEvent(new MouseEvent("dblclick", { bubbles: true, cancelable: true }));
      },
      path,
      onceId(),
    );
  // Typing in the editor shown: real keys at the end of its text (a line feed is Enter).
  const type = typeIn;
  // highlight.js is read the first time a diff is colored (#414, A-24), so the colors of a diff come a little after its rows: waits for the library and for the frame that draws the rows again.
  const waitForColors = async () => {
    await browser.waitUntil(() => browser.execute("return typeof hljs !== 'undefined'"), { timeoutMsg: "highlight.js was never read" });
    await browser.execute("return new Promise((done) => requestAnimationFrame(() => requestAnimationFrame(done)))");
  };
  // Opens a.rs with the answer of the read and waits for its text (`rows` is how many rows the tree has).
  async function openFileWith(read: OrcaFileText, rows = 4) {
    await mock("orca_file_read", read);
    await waitForCount("#orca-files-tree .orca-file", rows);
    await doublePress("a.rs");
    await waitForText(read.content);
  }
  // Opens a.rs with `content` and waits for its text (`rows` is how many rows the tree has).
  const openA = (content = "fn main() {}\n", signature = "sig-1", rows = 4) => openFileWith(text(content, signature), rows);

  it("draws the text of the editor with the family and size chosen in the settings (A-20), apart from the terminals", async () => {
    await openFiles({ font_settings: fontSettings({ editor: { family: "Menlo", size: 18, ghostty: false }, orcaWork: { family: null, size: 13, ghostty: false } }) });
    await openA();
    const area = () => browser.execute(() => ({ size: getComputedStyle(document.querySelector(".orca-edit-body .cm-line")!).fontSize, family: getComputedStyle(document.querySelector(".orca-edit-body .cm-line")!).fontFamily }));
    await browser.waitUntil(async () => (await area()).size === "18px", { timeoutMsg: "the editor never took the size" });
    expect((await area()).family).toContain("Menlo");
  });

  it("draws the heading of the editor with the family and size chosen for the work pane, and the text with those of the editor (A-20)", async () => {
    await openFiles({ font_settings: fontSettings({ orcaPane: { family: "Menlo", size: 21, ghostty: false } }) });
    await openA();
    const head = () => browser.execute(() => ({ size: getComputedStyle(document.querySelector(".orca-edit-head")!).fontSize, family: getComputedStyle(document.querySelector(".orca-edit-head")!).fontFamily }));
    // The heading is 12px of its own: 12 * 21 / 14.
    await browser.waitUntil(async () => (await head()).size === "18px", { timeoutMsg: "the heading never took the size" });
    expect((await head()).family).toContain("Menlo");
    expect(await browser.execute(() => getComputedStyle(document.querySelector(".orca-edit-body .cm-line")!).fontSize)).toBe("12.5px");
  });

  it("keeps the text of the tab bar, the tabs, the file pane's heading and the editor's heading inside their boxes at the largest size of the work pane (A-20)", async () => {
    await openFiles({ font_settings: fontSettings({ orcaPane: { family: null, size: 32, ghostty: false } }) });
    await openA();
    await browser.waitUntil(async () => (await browser.execute(() => getComputedStyle(document.getElementById("orca-work")!).fontSize)) === "32px", { timeoutMsg: "the work pane never took the size" });
    const outside = await browser.execute(() => {
      const pairs: [string, string][] = [
        [".orca-tabbar", ".orca-tab"],
        [".orca-tab", ".orca-tab-title"],
        ["#orca-files-head", "#orca-files-title"],
        [".orca-edit-head", ".orca-edit-path"],
        [".orca-edit-head", ".orca-edit-state"],
      ];
      const found: string[] = [];
      let checked = 0;
      for (const [box, text] of pairs) {
        for (const t of document.querySelectorAll(`${box} ${text}`)) {
          const b = t.closest(box)!.getBoundingClientRect();
          const r = t.getBoundingClientRect();
          checked++;
          if (r.height > 0 && (r.top < b.top - 0.5 || r.bottom > b.bottom + 0.5)) found.push(`${text} in ${box}`);
        }
      }
      return { found, checked };
    });
    expect(outside.checked).toBeGreaterThanOrEqual(5);
    expect(outside.found).toEqual([]);
  });

  it("draws the text of the editor with the first font while none is chosen", async () => {
    await openFiles();
    await openA();
    expect(await browser.execute(() => getComputedStyle(document.querySelector(".orca-edit-body .cm-line")!).fontSize)).toBe("12.5px");
  });

  // A-21: the colors of the editor. The language is Rust's (`orca_file_read` answers `language`); the tokens are the elements that CodeMirror's highlighter gives its classes `tok-*`.
  const tokens = (kind: string) => textsOf(`.orca-edit-body .tok-${kind}`);
  const rust = (content: string) => text(content, "sig-1", "rust");

  it("colors the text of a file by its language, with the classes of the highlighter in the lines of the editor (A-21)", async () => {
    await openFiles();
    await openFileWith(rust('fn main() {\n    let x = "a"; // note\n}\n'));
    expect(await tokens("keyword")).toEqual(["fn", "let"]);
    expect(await tokens("string")).toEqual(['"a"']);
    expect(await tokens("comment")).toEqual(["// note"]);
    expect(await editorText()).toBe('fn main() {\n    let x = "a"; // note\n}\n');
    // The numbers are the editor's own box, apart from its text.
    await expect($(".orca-edit-body .cm-gutters")).toHaveAttribute("aria-hidden", "true");
  });

  it("reads xterm.js with the first terminal and CodeMirror with the first file, and highlight.js with no file: only a diff is colored by it, and none of them is read at the start (#414)", async () => {
    const read = (name: string) => browser.execute(`return typeof ${name} !== 'undefined'`);
    await openOrca(orcaOverview(sample(), worktrees()), { orca_terminal_read: ["$"], orca_files_list: root(), orca_files_ignored: rootIgnored, editor_settings: { autosaveMs: 100 } });
    expect(await read("TsunagiaiCodeMirror")).toBe(false);
    expect(await read("hljs")).toBe(false);
    await project("example-app").click();
    await browser.waitUntil(() => read("Terminal"), { timeoutMsg: "xterm.js was never read" });
    expect(await read("TsunagiaiCodeMirror")).toBe(false);
    expect(await read("hljs")).toBe(false);
    await filesToggle().click();
    await openFileWith(rust("fn a() {}\n"));
    expect(await read("TsunagiaiCodeMirror")).toBe(true);
    expect(await read("hljs")).toBe(false);
    expect(await tokens("keyword")).toEqual(["fn"]);
  });

  it("shows the color of a token and the color of the plain text apart (A-21)", async () => {
    await openFiles();
    await openFileWith(rust("fn a() {}\n"));
    const colors = await browser.execute(() => ({
      keyword: getComputedStyle(document.querySelector(".orca-edit-body .tok-keyword")!).color,
      plain: getComputedStyle(document.querySelector(".orca-edit-body .cm-line")!).color,
    }));
    expect(colors.keyword).toBe("rgb(207, 34, 46)");
    expect(colors.plain).not.toBe(colors.keyword);
  });

  it("draws the text plain for a language the editor has no grammar for (A-21)", async () => {
    await openFiles();
    await openFileWith(text('const std = @import("std");\n', "sig-1", "zig"));
    expect(await count(".orca-edit-body [class*='tok-']")).toBe(0);
    expect(await editorText()).toBe('const std = @import("std");\n');
  });

  it("draws the text of the file as text, so a tag in it stays text (A-21)", async () => {
    await openFiles();
    await openFileWith(text('<img src=x onerror="alert(1)"> &amp;\n', "sig-1", "plaintext"));
    expect(await count(".orca-edit-body .cm-line img:not(.cm-widgetBuffer)")).toBe(0);
    expect(await editorText()).toBe('<img src=x onerror="alert(1)"> &amp;\n');
  });

  // A-26: a Markdown file (the language Rust names `markdown`) opens in the rich view that Milkdown draws, and has the buttons of the source (`<>`) and the rich view (the pencil) in its heading. `markdown_split` is Rust's cut of the front matter and `markdown_patch` puts the edit of the rich view into the text: the mocks answer them, and the spec checks what the page sends, draws and saves.
  const markdown = (content: string) => text(content, "sig-1", "markdown");
  const parts = (body: string, front = ""): MarkdownParts => ({ front, body });
  const patched = (text: string): MarkdownPatchResult => ({ kind: "patched", text });
  type PatchCall = { original: string; before: string; after: string };
  const modeButton = (label: string) => $(`.orca-edit-mode[aria-label="${label}"]`);
  const rich = (selector: string) => textsOf(`.orca-edit-rich .ProseMirror ${selector}`);
  // Opens a.rs as a Markdown file whose body (the text after its front matter) is `body`. `patch` is what Rust answers `markdown_patch` with (the text as it is, unless a spec says otherwise): the answer to the unchanged export decides whether the rich view can be edited.
  async function startMarkdown(content: string, body: string, front: string, patch: MarkdownPatchResult) {
    await mock("markdown_split", parts(body, front));
    await mock("markdown_patch", patch);
    await mock("orca_file_read", markdown(content));
    await waitForCount("#orca-files-tree .orca-file", 4);
    await doublePress("a.rs");
  }
  // Opens it and waits for the rich view to be drawn and to be editable.
  async function openMarkdown(content: string, body = content, front = "") {
    await startMarkdown(content, body, front, patched(content));
    await waitForCount(".orca-edit-rich .ProseMirror", 1);
    await $('.orca-edit-rich .ProseMirror[contenteditable="true"]').waitForExist({ timeoutMsg: "the rich view was never editable" });
  }
  // Types `t` at the end of the last paragraph of the rich view. The window of the E2E build has no focus, so a click does not focus the editor (and End does not move the caret): the script focuses it and puts the caret there, and the keys are real.
  async function typeRich(t: string) {
    await browser.execute(() => {
      const view = document.querySelector<HTMLElement>(".orca-edit-rich .ProseMirror")!;
      view.focus();
      const range = document.createRange();
      range.selectNodeContents(view.querySelector(":scope > p:last-child")!);
      range.collapse(false);
      const selection = getSelection()!;
      selection.removeAllRanges();
      selection.addRange(range);
    });
    await browser.keys(t);
  }
  const mdSample = "# 見出し\n\n本文の **太字** と `code`\n\n- [x] 済み\n- [ ] 未\n\n| a | b |\n| - | - |\n| 1 | 2 |\n";

  it("opens a Markdown file in the rich view, which Milkdown draws and which can be edited (A-26)", async () => {
    await openFiles();
    await openMarkdown(mdSample);
    expect(await rich("h1")).toEqual(["見出し"]);
    expect(await rich("strong")).toEqual(["太字"]);
    expect(await rich("p code")).toEqual(["code"]);
    expect(await rich("th")).toEqual(["a", "b"]);
    expect(await count('.orca-edit-rich li[data-item-type="task"]')).toBe(2);
    await expect($(".orca-edit-rich .ProseMirror")).toHaveAttribute("contenteditable", "true");
    await expect($(".orca-edit-rich")).toBeDisplayed();
    await expect($(".orca-edit-body")).not.toBeDisplayed();
    await expect(modeButton("リッチ")).toHaveAttribute("aria-pressed", "true");
    await expect(modeButton("ソース")).toHaveAttribute("aria-pressed", "false");
    await expect(modeButton("プレビュー")).not.toBeDisplayed();
    await expect(modeButton("再読み込み")).not.toBeDisplayed();
    expect(await callsOf("markdown_split")).toEqual([{ text: mdSample }]);
    // The unchanged export is what Rust is asked to put into the text, to know that it can.
    const [check] = (await callsOf("markdown_patch")) as PatchCall[];
    expect(check.original).toBe(mdSample);
    expect(check.before).toContain("見出し");
    expect(check.after).toBe(check.before);
  });

  it("reads Milkdown from vendor/ when the first Markdown file is drawn, and not at the start (A-26)", async () => {
    const read = () => browser.execute("return typeof TsunagiaiMilkdown !== 'undefined'");
    await openFiles();
    expect(await read()).toBe(false);
    await openMarkdown("# a\n");
    expect(await read()).toBe(true);
  });

  it("gives Milkdown the body without the front matter, which Rust cuts off (A-26)", async () => {
    const content = "---\ntitle: 題\n---\n# 本文\n";
    await openFiles();
    await openMarkdown(content, "# 本文\n", "---\ntitle: 題\n---\n");
    expect(await callsOf("markdown_split")).toEqual([{ text: content }]);
    expect(await rich("h1")).toEqual(["本文"]);
    expect(await browser.execute(() => document.querySelector(".orca-edit-rich")!.textContent)).not.toContain("title");
  });

  // A-26: a code block of the language `mermaid` is drawn as the diagram that Pele makes, in its place; the document is the same, so what is saved is the same.
  const fence = (source: string) => `\`\`\`mermaid\n${source}\n\`\`\``;
  const flow = "flowchart LR\n  A[開始] --> B[終了]";
  const diagramBox = ".orca-edit-rich pre[data-diagram='drawn']";
  const diagramText = () => browser.execute((s) => document.querySelector(`${s} svg`)?.textContent ?? null, diagramBox);

  it("draws a mermaid block as a diagram in place of its code, reads Pele only for such a file, and sends the same text to markdown_patch (A-26)", async () => {
    const content = `# 図\n\n${fence(flow)}\n\n末尾\n`;
    await openFiles();
    expect(await browser.execute("return typeof pele")).toBe("undefined");
    await openMarkdown(content);
    await $(diagramBox).waitForExist({ timeoutMsg: "the diagram was never drawn" });
    expect(await count(`${diagramBox} svg.pele`)).toBe(1);
    expect(await diagramText()).toContain("開始");
    expect(await count(".orca-edit-rich .orca-diagram svg")).toBe(1);
    expect(await browser.execute(() => document.querySelectorAll('script[src$="pele.global.js"]').length)).toBe(1);
    // The code is not shown: the block is the diagram alone.
    await expect($(`${diagramBox} > code`)).not.toBeDisplayed();
    expect(await browser.execute(() => (document.querySelector(".orca-edit-rich") as HTMLElement).innerText)).not.toContain("flowchart");
    // The document is the text of the file: the export and the patch are what they are without a diagram.
    const calls = (await callsOf("markdown_patch")) as PatchCall[];
    const check = calls[calls.length - 1];
    expect(check.original).toBe(content);
    expect(check.before).toContain(fence(flow));
    expect(check.after).toBe(check.before);
    // Typing elsewhere in the view sends the diagram's text as it was.
    await mock("markdown_patch", patched(`${content}X`));
    await typeRich("X");
    const [call] = (await waitForCalls("markdown_patch")) as PatchCall[];
    expect(call.before).toBe(check.before);
    expect(call.after).toContain(fence(flow));
    expect(call.after).toContain("末尾X");
    // The source is the text, with the diagram's text to edit.
    await modeButton("ソース").click();
    await waitForText(`${content}X`);
  });

  it("does not read Pele for a Markdown file with no mermaid block (A-26)", async () => {
    await openFiles();
    await openMarkdown(mdSample);
    expect(await rich("h1")).toEqual(["見出し"]);
    expect(await browser.execute("return typeof pele")).toBe("undefined");
    expect(await browser.execute(() => document.querySelectorAll('script[src$="pele.global.js"]').length)).toBe(0);
  });

  it("leaves a mermaid block that Pele cannot draw as a code block with its text (A-26)", async () => {
    const bad = "flowchart TD\n  A[開始 --> ((";
    await openFiles();
    await openMarkdown(`# 図\n\n${fence(bad)}\n`);
    await browser.waitUntil(() => browser.execute("return typeof pele !== 'undefined'"), { timeoutMsg: "Pele was never read" });
    await browser.pause(300);
    expect(await count(".orca-edit-rich pre[data-diagram]")).toBe(0);
    expect(await count(".orca-edit-rich .orca-diagram svg")).toBe(0);
    await expect($(".orca-edit-rich pre > code")).toBeDisplayed();
    expect(await rich("pre > code")).toEqual([bad]);
    const [check] = (await callsOf("markdown_patch")) as PatchCall[];
    expect(check.before).toContain(fence(bad));
  });

  // The caret at the start (`start`) or the end of the first element `selector` of the rich view, which gets the focus; the window of the E2E build has no focus, so the script puts it there and the keys are real.
  const caretIn = (selector: string, start: boolean) =>
    browser.execute(
      (s, atStart) => {
        const view = document.querySelector<HTMLElement>(".orca-edit-rich .ProseMirror")!;
        view.focus();
        const range = document.createRange();
        range.selectNodeContents(view.querySelector(s)!);
        range.collapse(atStart);
        const selection = getSelection()!;
        selection.removeAllRanges();
        selection.addRange(range);
      },
      selector,
      start,
    );

  it("keeps a mermaid block typed in the rich view as code that can be edited, also when its text could be drawn (A-26)", async () => {
    await openFiles();
    await openMarkdown(`# 図\n\n${fence("")}\n\n末尾\n`);
    await browser.waitUntil(() => browser.execute("return typeof pele !== 'undefined'"), { timeoutMsg: "Pele was never read" });
    expect(await count(".orca-edit-rich pre[data-diagram]")).toBe(0);
    await caretIn("pre > code", false);
    await browser.keys("graph");
    await browser.keys(" TD");
    // The text is a diagram that Pele draws, and the block is still the code that is being typed.
    await browser.waitUntil(async () => (await rich("pre > code")).join("") === "graph TD", { timeoutMsg: "the typing never reached the block" });
    expect(await count(".orca-edit-rich pre[data-diagram]")).toBe(0);
    expect(await count(".orca-edit-rich .orca-diagram")).toBe(0);
    await expect($(".orca-edit-rich pre > code")).toBeDisplayed();
    expect(await browser.execute(() => document.querySelector(".orca-edit-rich pre")!.hasAttribute("contenteditable"))).toBe(false);
    // What the editor exports is the typed text (the patch is sent after the wait for more changes).
    await browser.waitUntil(async () => ((await callsOf("markdown_patch")) as PatchCall[]).some((c) => c.after.includes(fence("graph TD"))), { timeoutMsg: "the typed block never reached markdown_patch" });
  });

  it("turns a drawn diagram into code that holds the text of the paragraph that Backspace joined to it (A-26)", async () => {
    await openFiles();
    await openMarkdown(`# 図\n\n${fence(flow)}\n\n末尾\n`);
    await $(diagramBox).waitForExist({ timeoutMsg: "the diagram was never drawn" });
    await caretIn(":scope > p:last-child", true);
    await browser.keys("Backspace");
    await browser.waitUntil(async () => (await count(".orca-edit-rich pre[data-diagram]")) === 0, { timeoutMsg: "the diagram never went" });
    expect(await count(".orca-edit-rich .orca-diagram")).toBe(0);
    await expect($(".orca-edit-rich pre > code")).toBeDisplayed();
    expect((await rich("pre > code"))[0]).toContain("末尾");
    expect((await rich("pre > code"))[0]).toContain("flowchart LR");
  });

  it("draws the diagram again when the rich view is drawn again by the clock, and keeps the scroll (A-18, A-26)", async () => {
    const first = `# 図\n\n${fence(flow)}\n${"\n行\n".repeat(60)}`;
    const next = `# 図\n\n${fence("flowchart LR\n  A[再読] --> B[完了]")}\n${"\n行\n".repeat(60)}`;
    await openFiles({ ...timers({ orcaClock: 1000 }), editor_settings: { autosaveMs: 60000 } });
    await openMarkdown(first);
    await $(diagramBox).waitForExist({ timeoutMsg: "the diagram was never drawn" });
    expect(await diagramText()).toContain("開始");
    await browser.execute(() => {
      document.querySelector(".orca-edit-rich")!.scrollTop = 300;
    });
    await mock("markdown_split", parts(next));
    await mock("markdown_patch", patched(next));
    await mock("orca_file_read", text(next, "sig-2", "markdown"));
    await browser.waitUntil(async () => ((await diagramText()) ?? "").includes("再読"), { timeoutMsg: "the diagram was never drawn again" });
    expect(await diagramText()).not.toContain("開始");
    expect(await count(".orca-edit-rich .orca-diagram svg")).toBe(1);
    expect(await browser.execute(() => document.querySelector(".orca-edit-rich")!.scrollTop)).toBe(300);
  });

  // A-26: the band under the paragraph of the caret (`.orca-edit-rich-band`).
  const richBand = () =>
    browser.execute(() => {
      const b = document.querySelector<HTMLElement>(".orca-edit-rich-band")!;
      const r = b.getBoundingClientRect();
      return { hidden: b.hidden, top: r.top, bottom: r.bottom, left: r.left, right: r.right, background: getComputedStyle(b).backgroundColor };
    });
  const boxOf = (selector: string) =>
    browser.execute((s) => {
      const r = document.querySelector(`.orca-edit-rich .ProseMirror ${s}`)!.getBoundingClientRect();
      return { top: r.top, bottom: r.bottom, left: r.left };
    }, selector);
  // The caret at the start of the first element `selector` of the rich view, which has the focus (or, with `whole`, the whole content of the element selected).
  const caretInRich = (selector: string, whole = false) =>
    browser.execute(
      (s, all) => {
        const view = document.querySelector<HTMLElement>(".orca-edit-rich .ProseMirror")!;
        view.focus();
        const r = document.createRange();
        r.selectNodeContents(view.querySelector(s)!);
        if (!all) r.collapse(true);
        const selection = getSelection()!;
        selection.removeAllRanges();
        selection.addRange(r);
      },
      selector,
      whole,
    );
  const bandAt = (selector: string) =>
    browser.waitUntil(
      async () => {
        const [b, box] = [await richBand(), await boxOf(selector)];
        return !b.hidden && Math.abs(b.top - box.top) < 1 && Math.abs(b.bottom - box.bottom) < 1;
      },
      { timeoutMsg: `the band never came under ${selector}` },
    );
  const richBandHidden = () => browser.waitUntil(async () => (await richBand()).hidden, { timeoutMsg: "the band of the rich view never went" });

  it("lays a faint band under the paragraph of the caret in the rich view, the heading and the item of a list included, and not over a selected range (A-26)", async () => {
    await openFiles();
    await openMarkdown(mdSample);
    await caretInRich("h1");
    await bandAt("h1");
    expect((await richBand()).background).not.toBe("rgba(0, 0, 0, 0)");
    await caretInRich("p");
    await bandAt("p");
    await caretInRich("li p");
    await bandAt("li p");
    // The band is as wide as the editor, so it reaches the marks of the list on the left of the item.
    expect((await richBand()).left).toBeLessThan((await boxOf("li p")).left);
    await caretInRich("p", true);
    await richBandHidden();
    await caretInRich("p");
    await bandAt("p");
    await browser.execute(() => document.querySelector<HTMLElement>(".orca-edit-rich .ProseMirror")!.blur());
    await richBandHidden();
  });

  it("switches a Markdown file to its source and back to the rich view with the buttons (A-26)", async () => {
    await openFiles();
    await openMarkdown("# 見出し\n");
    await modeButton("ソース").click();
    await expect($(".orca-edit-body")).toBeDisplayed();
    await expect($(".orca-edit-rich")).not.toBeDisplayed();
    await waitForText("# 見出し\n");
    await expect(modeButton("ソース")).toHaveAttribute("aria-pressed", "true");
    await expect(modeButton("リッチ")).toHaveAttribute("aria-pressed", "false");
    expect(await count(".orca-edit-rich .ProseMirror")).toBe(0);
    // The typing in the source is what the rich view draws next.
    await mock("orca_file_write", saved("sig-2"));
    await type("追記\n");
    await modeButton("リッチ").click();
    await waitForCount(".orca-edit-rich .ProseMirror", 1);
    await expect($(".orca-edit-rich")).toBeDisplayed();
    await expect($(".orca-edit-body")).not.toBeDisplayed();
    expect(await callsOf("markdown_split")).toEqual([{ text: "# 見出し\n" }, { text: "# 見出し\n追記\n" }]);
  });

  it("keeps the view of a Markdown file while it is open, when another tab is shown and the file again (A-26)", async () => {
    await openFiles();
    await openMarkdown("# 見出し\n");
    await modeButton("ソース").click();
    await tabOf(claude).$(".orca-tab-btn").click();
    await tabOf("file:1").$(".orca-tab-btn").click();
    await expect($(CONTENT)).toBeDisplayed();
    await expect($(".orca-edit-rich")).not.toBeDisplayed();
    await expect(modeButton("ソース")).toHaveAttribute("aria-pressed", "true");
  });

  const front = "---\ntitle: 題\n---\n";
  const body = "# 見出し\n\n* 項目\n\n本文\n";
  const edited = `${front}# 見出し\n\n* 項目\n\n本文X\n`;

  it("puts what is typed in the rich view into the original text through markdown_patch, and saves that text (A-26)", async () => {
    const content = front + body;
    await openFiles();
    await openMarkdown(content, body, front);
    const [check] = (await callsOf("markdown_patch")) as PatchCall[];
    await mock("markdown_patch", patched(edited));
    const write = await mock("orca_file_write", saved("sig-2"));
    await typeRich("X");
    const [call] = (await waitForCalls("markdown_patch")) as PatchCall[];
    // The whole file with its front matter and its own notation is the original; the editor's exports are the before and after of its body.
    expect(call.original).toBe(content);
    expect(call.before).toBe(check.before);
    expect(call.after).toContain("本文X");
    expect(call.after).not.toContain("title");
    // What is saved is Rust's answer, not the export of the editor.
    expect(await waitForCalls(write)).toEqual([{ path: "/work/example-app", relative: "a.rs", content: edited, crlf: false, signature: "sig-1", environment: null }]);
    await expect(stateText()).toHaveText("保存しました");
    await waitForText(edited);
  });

  it("shows the states of the save for an edit of the rich view as for typing in the source (A-26)", async () => {
    await openFiles({ editor_settings: { autosaveMs: 500 } });
    await openMarkdown(body);
    await mock("markdown_patch", patched(`${body}X`));
    const write = await mock("orca_file_write", holds);
    await typeRich("X");
    await expect(stateText()).toHaveText("保存待ち");
    expect(await dirtyMarks()).toBe(1);
    await waitForCalls(write);
    await expect(stateText()).toHaveText("保存中");
    await release(write, saved("sig-2"));
    await expect(stateText()).toHaveText("保存しました");
    await browser.waitUntil(async () => (await dirtyMarks()) === 0, { timeoutMsg: "the mark of the tab stayed" });
  });

  it("carries an edit of the rich view to the source at once, and the typing of the source back to the rich view (A-26)", async () => {
    const content = front + body;
    await openFiles();
    await openMarkdown(content, body, front);
    await mock("markdown_patch", patched(edited));
    await mock("orca_file_write", saved("sig-2"));
    await typeRich("X");
    // Pressed before the wait for more changes has passed: the edit is in the editor when the source is shown.
    await modeButton("ソース").click();
    await waitForText(edited);
    await expect($(".orca-edit-rich")).not.toBeDisplayed();
    await type("Y");
    await modeButton("リッチ").click();
    await waitForCount(".orca-edit-rich .ProseMirror", 1);
    expect(await callsOf("markdown_split")).toEqual([{ text: content }, { text: `${edited}Y` }]);
  });

  it("opens a file that Rust cannot put an edit into in the source, and shows its rich view read only (A-26)", async () => {
    await openFiles();
    await startMarkdown(body, body, "", { kind: "conflict" });
    await expect(modeButton("ソース")).toHaveAttribute("aria-pressed", "true");
    await expect($(CONTENT)).toBeDisplayed();
    await waitForText(body);
    await modeButton("リッチ").click();
    await waitForCount(".orca-edit-rich .ProseMirror", 1);
    await waitForCalls("markdown_patch", 2);
    await browser.pause(300);
    await expect($(".orca-edit-rich .ProseMirror")).toHaveAttribute("contenteditable", "false");
    await expect(modeButton("リッチ")).toHaveAttribute("aria-pressed", "true");
  });

  it("switches to the source and saves nothing when Rust cannot put an edit into the text (A-26)", async () => {
    await openFiles();
    await openMarkdown(body);
    await mock("markdown_patch", { kind: "conflict" } satisfies MarkdownPatchResult);
    const write = await mock("orca_file_write", saved("sig-2"));
    await typeRich("X");
    await expect(modeButton("ソース")).toHaveAttribute("aria-pressed", "true");
    await waitForText(body);
    await browser.pause(800);
    expect(await callsOf(write)).toEqual([]);
  });

  it("shows no buttons for a file that is not Markdown, and its text stays in the editor (A-26)", async () => {
    await openFiles();
    await openFileWith(rust("fn main() {}\n"));
    await expect($(".orca-edit-modes")).not.toBeDisplayed();
    await expect($(".orca-edit-rich")).not.toBeDisplayed();
    await expect($(CONTENT)).toBeDisplayed();
    expect(await callsOf("markdown_split")).toEqual([]);
  });

  it("colors the text again at each key (A-21)", async () => {
    await openFiles();
    await openFileWith(rust("let a = 1;\n"));
    expect(await tokens("comment")).toEqual([]);
    await type("// typed");
    await browser.waitUntil(async () => (await tokens("comment")).length === 1, { timeoutMsg: "the typed line was never colored" });
    expect(await tokens("comment")).toEqual(["// typed"]);
    expect(await editorText()).toBe("let a = 1;\n// typed");
  });

  it("draws only the lines near the window, and colors them, for a long text (A-21)", async () => {
    await openFiles();
    await openFileWith(rust("let a = 1;\n".repeat(3000)));
    await browser.waitUntil(async () => (await count(".orca-edit-body .tok-keyword")) > 0, { timeoutMsg: "the long text was never colored" });
    expect(await count(".orca-edit-body .cm-line")).toBeLessThan(3000);
  });

  // A-18: the band under the line of the caret (`.cm-activeLine`, which the editor marks only while it has the focus and nothing is selected), and where it is on the page.
  const band = () =>
    browser.execute(() => {
      const content = document.querySelector(".orca-edit-body .cm-content")!;
      const lines = [...content.querySelectorAll(".cm-line")];
      const at = lines.findIndex((l) => l.classList.contains("cm-activeLine"));
      if (at === -1) return { shown: false, line: null, top: 0, bottom: 0, width: 0, textWidth: 0, background: "", count: 0 };
      const r = lines[at].getBoundingClientRect();
      return { shown: true, line: String(at), top: r.top, bottom: r.bottom, width: r.width, textWidth: content.getBoundingClientRect().width, background: getComputedStyle(lines[at]).backgroundColor, count: lines.filter((l) => l.classList.contains("cm-activeLine")).length };
    });
  // The box of the letter at `index` of the text.
  const glyph = async (index: number) => {
    const [box] = await charBoxes(index);
    return { top: box!.top, bottom: box!.bottom };
  };
  // Gives the editor the focus and puts the selection `start` to `end` in it: the caret is moved by the script (the window of the E2E build has no focus, so a click does not focus the editor).
  const caretAt = setCaret;
  const bandOn = (line: string) => browser.waitUntil(async () => (await band()).line === line, { timeoutMsg: `the band never came to line ${line}` });
  const bandHidden = () => browser.waitUntil(async () => !(await band()).shown, { timeoutMsg: "the band never went" });

  it("lays a faint band under the line of the caret, across the box of the text and under the letters, and moves it with the caret (A-18)", async () => {
    await openFiles();
    await openA("alpha\nbeta\ngamma\n");
    await caretAt(0);
    await bandOn("0");
    await caretAt(6);
    await bandOn("1");
    const b = await band();
    const letter = await glyph(6);
    const next = await glyph(11);
    expect(b.count).toBe(1);
    expect(b.top).toBeLessThanOrEqual(letter.top);
    expect(b.bottom).toBeGreaterThanOrEqual(letter.bottom);
    expect(b.bottom).toBeLessThanOrEqual(next.top);
    expect(b.width).toBeCloseTo(b.textWidth, 0);
    expect(b.background).toBe("rgba(90, 107, 98, 0.1)");
    await caretAt(11);
    await bandOn("2");
    expect((await band()).top).toBeGreaterThan(b.top);
    await caretAt(6);
    await bandOn("1");
    expect((await band()).top).toBe(b.top);
  });

  it("does not draw the band over a selected range, and takes it off when the editor loses the focus (A-18)", async () => {
    await openFiles();
    await openA("alpha\nbeta\ngamma\n");
    await caretAt(6);
    await bandOn("1");
    await caretAt(6, 7);
    await bandHidden();
    await caretAt(6);
    await bandOn("1");
    await blurEditor();
    await bandHidden();
  });

  it("keeps the band on its line while the text scrolls (A-18)", async () => {
    await openFiles();
    await openA("x\n".repeat(200));
    // The editor puts the numbers on the lines when it has measured the text, a frame after the text is drawn: the number of a line is at that line once it has measured (`line` is the index of the line in the page).
    const numberAtLine = (n: string, line: number) =>
      browser.execute(
        (text, at) => {
          const lines = document.querySelectorAll(".orca-edit-body .cm-content .cm-line");
          const number = [...document.querySelectorAll<HTMLElement>(".orca-edit-body .cm-lineNumbers .cm-gutterElement")].find((e) => e.style.visibility !== "hidden" && e.textContent === text);
          return number !== undefined && lines[at] !== undefined && Math.abs(number.getBoundingClientRect().top - lines[at].getBoundingClientRect().top) < 0.5;
        },
        n,
        line,
      );
    await browser.waitUntil(() => numberAtLine("1", 0), { timeoutMsg: "the first number never came to the first line" });
    // The caret set in the page reaches the editor at the `selectionchange` that follows, and a draw of the lines in between puts the selection of the editor back: it is set again until the band is on its line.
    await browser.waitUntil(
      async () => {
        await caretAt(6);
        return (await band()).line === "3";
      },
      { timeoutMsg: "the band never came to line 3" },
    );
    await browser.waitUntil(() => numberAtLine("4", 3), { timeoutMsg: "the number of the band's line never came to it" });
    const before = (await band()).top;
    await browser.execute(() => {
      document.querySelector(".orca-edit-body .cm-scroller")!.scrollTop = 48;
    });
    await browser.waitUntil(async () => Math.abs((await band()).top - (before - 48)) < 0.5, { timeoutMsg: "the band never followed the scroll" });
  });

  // A-18: the numbers of the lines, in the editor's own box at the left of the text (`.cm-gutters`): the numbers of the lines near the window, and the widest one in a hidden element that sets the width.
  const numbers = () => browser.execute(() => [...document.querySelectorAll<HTMLElement>(".orca-edit-body .cm-lineNumbers .cm-gutterElement")].filter((e) => e.style.visibility !== "hidden").map((e) => e.textContent));
  // The number of the last line drawn (the first element is the hidden one that sets the width, with the digits of the last number as nines).
  const lastNumber = () =>
    browser.execute(() => {
      const drawn = [...document.querySelectorAll<HTMLElement>(".orca-edit-body .cm-lineNumbers .cm-gutterElement")].filter((e) => e.style.visibility !== "hidden");
      return drawn[drawn.length - 1].textContent;
    });
  // Scrolls the text to its end until the number `last` is the last one drawn (the heights of the lines not drawn are estimated, so the end moves while they are drawn).
  const scrollTo = (last: string) =>
    browser.waitUntil(
      async () => {
        await browser.execute(() => {
          const scroller = document.querySelector(".orca-edit-body .cm-scroller")!;
          scroller.scrollTop = scroller.scrollHeight;
        });
        return (await lastNumber()) === last;
      },
      { timeoutMsg: `the numbers never came to ${last}` },
    );
  const countTo = (n: number) => Array.from({ length: n }, (_, i) => String(i + 1));
  const gutterWidth = () => browser.execute(() => document.querySelector(".orca-edit-body .cm-gutters")!.getBoundingClientRect().width);

  it("numbers the lines of the text from 1, one number for each line, in the font of the text and in a fainter color (A-18)", async () => {
    await openFiles();
    await openA("fn main() {\n    run();\n}\n");
    // The empty line after the last line break is a line of the editor, and has its number.
    expect(await numbers()).toEqual(["1", "2", "3", "4"]);
    const look = await browser.execute(() => {
      const g = getComputedStyle(document.querySelector(".orca-edit-body .cm-gutters")!);
      const n = getComputedStyle([...document.querySelectorAll<HTMLElement>(".orca-edit-body .cm-lineNumbers .cm-gutterElement")].find((e) => e.style.visibility !== "hidden")!);
      const a = getComputedStyle(document.querySelector(".orca-edit-body .cm-line")!);
      return { gutter: [n.fontFamily, n.fontSize, n.lineHeight, g.color, n.textAlign], line: [a.fontFamily, a.fontSize, a.lineHeight, a.color] };
    });
    expect(look.gutter.slice(0, 3)).toEqual(look.line.slice(0, 3));
    expect(look.gutter[4]).toBe("right");
    expect(look.gutter[3]).not.toBe(look.line[3]);
    expect(look.gutter[3]).toBe("rgb(90, 107, 98)");
  });

  it("numbers the lines with the family and size chosen for the editor (A-18, A-20)", async () => {
    await openFiles({ font_settings: fontSettings({ editor: { family: "Menlo", size: 18, ghostty: false }, orcaWork: { family: null, size: 13, ghostty: false } }) });
    await openA("a\nb\n");
    await browser.waitUntil(async () => (await browser.execute(() => getComputedStyle(document.querySelector(".orca-edit-body .cm-gutters")!).fontSize)) === "18px", { timeoutMsg: "the numbers never took the size" });
    const font = await browser.execute(() => ({ gutter: getComputedStyle(document.querySelector(".orca-edit-body .cm-gutters")!).fontFamily, line: getComputedStyle(document.querySelector(".orca-edit-body .cm-line")!).fontFamily }));
    expect(font.gutter).toContain("Menlo");
    expect(font.gutter).toBe(font.line);
  });

  it("keeps the numbers in step with the lines as they are typed and deleted, and widens the box with the digits (A-18)", async () => {
    await openFiles();
    await openA("1\n2\n3\n4\n5\n6\n7\n8\n");
    expect(await numbers()).toEqual(countTo(9));
    const narrow = await gutterWidth();
    await type("9\n");
    await browser.waitUntil(async () => (await numbers()).length === 10, { timeoutMsg: "the numbers never grew" });
    expect(await numbers()).toEqual(countTo(10));
    expect(await gutterWidth()).toBeGreaterThan(narrow);
    await setText("1\n2\n3\n");
    await browser.waitUntil(async () => (await numbers()).length === 4, { timeoutMsg: "the numbers never shrank" });
    expect(await numbers()).toEqual(countTo(4));
    expect(await gutterWidth()).toBe(narrow);
    // Typing inside a line changes no number.
    await setText("1\n2x\n3\n");
    expect(await numbers()).toEqual(countTo(4));
    // An empty text is one line.
    await setText("");
    await browser.waitUntil(async () => (await numbers()).length === 1, { timeoutMsg: "the numbers never came back to one" });
    expect(await numbers()).toEqual(["1"]);
  });

  it("numbers a long text, and one line more at a key (A-18)", async () => {
    await openFiles();
    await openA("x\n".repeat(5000));
    expect((await numbers()).slice(0, 3)).toEqual(["1", "2", "3"]);
    await scrollTo("5001");
    await type("y\n");
    await browser.waitUntil(async () => (await lastNumber()) === "5002", { timeoutMsg: "the numbers never grew" });
  });

  it("keeps the numbers at the left while the text scrolls sideways, and moves them with the vertical scroll (A-18)", async () => {
    await openFiles();
    await openA(`${"x".repeat(400)}\n`.repeat(200));
    const first = () =>
      browser.execute(() => {
        const one = [...document.querySelectorAll<HTMLElement>(".orca-edit-body .cm-lineNumbers .cm-gutterElement")].find((e) => e.style.visibility !== "hidden")!;
        return {
          left: document.querySelector(".orca-edit-body .cm-gutters")!.getBoundingClientRect().left,
          numberLeft: one.getBoundingClientRect().left,
          numberTop: one.getBoundingClientRect().top,
          lineTop: document.querySelector(".orca-edit-body .cm-line")!.getBoundingClientRect().top,
          text: one.textContent,
        };
      });
    // The editor puts the numbers on the lines when it has measured the text, a frame after the text is drawn.
    await browser.waitUntil(async () => {
      const at = await first();
      return Math.abs(at.numberTop - at.lineTop) < 0.5;
    }, { timeoutMsg: "the first number never came to the first line" });
    const before = await first();
    await browser.execute(() => {
      const scroller = document.querySelector(".orca-edit-body .cm-scroller")!;
      scroller.scrollTop = 48;
      scroller.scrollLeft = 60;
    });
    await browser.waitUntil(async () => Math.abs((await first()).numberTop - (before.numberTop - 48)) < 0.5, { timeoutMsg: "the numbers never followed the scroll" });
    const moved = await first();
    expect(moved.left).toBe(before.left);
    expect(moved.numberLeft).toBe(before.numberLeft);
    expect(moved.numberTop).toBeCloseTo(moved.lineTop, 0);
    // The first number of the lines in view is that of the line the text shows there.
    expect(moved.text).toBe("1");
  });

  it("keeps the numbers out of the selection, the copy and the reading aloud, and out of the text (A-18)", async () => {
    await openFiles();
    await openA("alpha\nbeta\n");
    const gutter = await browser.execute(() => {
      const g = document.querySelector<HTMLElement>(".orca-edit-body .cm-gutters")!;
      return { hidden: g.getAttribute("aria-hidden"), userSelect: getComputedStyle(g).getPropertyValue("-webkit-user-select"), inContent: document.querySelector(".orca-edit-body .cm-content")!.contains(g) };
    });
    expect(gutter.hidden).toBe("true");
    expect(gutter.userSelect).toBe("none");
    expect(gutter.inContent).toBe(false);
    // What a copy of the text takes is the text and nothing of the numbers.
    expect(await editorText()).toBe("alpha\nbeta\n");
  });

  // A-18: folding. The arrows are the elements `.orca-fold` of the lines that can fold, in the gutter right of the numbers; the lines drawn and the `…` are read from the page.
  const json = '{\n  "a": {\n    "b": 1\n  },\n  "c": 2\n}\n';
  const ruby = "class A\n  def b\n    1\n  end\nend\n";
  const lineTexts = () => browser.execute(() => [...document.querySelectorAll(".orca-edit-body .cm-line")].map((l) => l.textContent));
  // The n-th arrow (from 1) of the lines that can fold; the first element of the gutter is the hidden one that sets its width.
  const arrow = (n: number) => $(`(//div[contains(@class,"cm-foldGutter")]//div[contains(@class,"cm-gutterElement")][not(contains(@style,"hidden"))]//span[contains(@class,"orca-fold")])[${n}]`);
  const arrows = () =>
    browser.execute(() =>
      [...document.querySelectorAll<HTMLElement>(".orca-edit-body .cm-foldGutter .cm-gutterElement")]
        .filter((e) => e.style.visibility !== "hidden" && e.querySelector(".orca-fold") !== null)
        .map((e) => {
          const mark = e.querySelector<HTMLElement>(".orca-fold")!;
          return { open: mark.classList.contains("open"), visibility: getComputedStyle(mark).visibility, title: mark.title, sameRow: e.getBoundingClientRect().top >= document.querySelector(".orca-edit-body .cm-lineNumbers")!.getBoundingClientRect().top };
        }),
    );
  const waitForArrows = (n: number) => browser.waitUntil(async () => (await arrows()).length === n, { timeoutMsg: `there were never ${n} arrows of folding` });
  // The pointer over the gutter, and away from it (over the heading of the editor).
  const overGutter = () => browser.action("pointer").move({ origin: $(".orca-edit-body .cm-foldGutter") }).perform();
  const awayFromGutter = () => browser.action("pointer").move({ origin: $(".orca-edit-head") }).perform();
  const pressOn = async (target: ChainablePromiseElement) => {
    await overGutter();
    await browser.action("pointer").move({ origin: target }).down().up().perform();
  };
  const placeholders = () => browser.execute(() => [...document.querySelectorAll(".orca-edit-body .cm-foldPlaceholder")].map((p) => ({ text: p.textContent, title: p.getAttribute("title") })));
  const openJson = async () => {
    await openFiles();
    await openFileWith(text(json, "sig-1", "json"));
    await waitForArrows(2);
  };

  it("draws the arrow of a line of JSON that can fold right of the numbers, only while the pointer is over them, and folds the lines with a press (A-18)", async () => {
    await openJson();
    await awayFromGutter();
    expect(await arrows()).toEqual([
      { open: true, visibility: "hidden", title: "", sameRow: true },
      { open: true, visibility: "hidden", title: "", sameRow: true },
    ]);
    // It is at the right of the numbers.
    expect(await browser.execute(() => document.querySelector(".orca-edit-body .cm-foldGutter")!.getBoundingClientRect().left >= document.querySelector(".orca-edit-body .cm-lineNumbers")!.getBoundingClientRect().right - 0.5)).toBe(true);
    // :hover never matches in the E2E window (it is hidden): the rule that shows an open line's arrow is read from the stylesheet, and it is the pointer over the numbers.
    const showing = await browser.execute(() => {
      for (const sheet of document.styleSheets)
        for (const rule of sheet.cssRules) if (rule instanceof CSSStyleRule && rule.selectorText.includes(".orca-fold.open") && rule.style.visibility === "visible") return rule.selectorText;
      return null;
    });
    expect(showing).toContain(".cm-gutters:hover");
    await pressOn(arrow(2));
    await browser.waitUntil(async () => (await placeholders()).length === 1, { timeoutMsg: "the line never folded" });
    expect(await lineTexts()).toEqual(["{", '  "a": {…},', '  "c": 2', "}", ""]);
    expect(await placeholders()).toEqual([{ text: "…", title: null }]);
    // A folded line keeps its arrow (right) without the pointer over the numbers.
    await awayFromGutter();
    expect((await arrows()).map((a) => [a.open, a.visibility])).toEqual([[true, "hidden"], [false, "visible"]]);
    await waitForText(json);
  });

  it("opens a fold with a press on the `…` or on the arrow of the folded line (A-18)", async () => {
    await openJson();
    await pressOn(arrow(2));
    await waitForCount(".orca-edit-body .cm-foldPlaceholder", 1);
    await browser.action("pointer").move({ origin: $(".orca-edit-body .cm-foldPlaceholder") }).down().up().perform();
    await waitForCount(".orca-edit-body .cm-foldPlaceholder", 0);
    expect(await lineTexts()).toEqual(["{", '  "a": {', '    "b": 1', "  },", '  "c": 2', "}", ""]);
    await pressOn(arrow(2));
    await waitForCount(".orca-edit-body .cm-foldPlaceholder", 1);
    await pressOn(arrow(2));
    await waitForCount(".orca-edit-body .cm-foldPlaceholder", 0);
    expect(await lineTexts()).toHaveLength(7);
  });

  it("folds a Ruby file by the indentation, and keeps the line of its end (A-18)", async () => {
    await openFiles();
    await openFileWith(text(ruby, "sig-1", "ruby"));
    await waitForArrows(2);
    await pressOn(arrow(2));
    await waitForCount(".orca-edit-body .cm-foldPlaceholder", 1);
    expect(await lineTexts()).toEqual(["class A", "  def b…", "  end", "end", ""]);
    await pressOn(arrow(1));
    await waitForCount(".orca-edit-body .cm-foldPlaceholder", 1);
    // The outer fold takes the inner one with the lines, and its last line, the `end` of the class, stays.
    expect(await lineTexts()).toEqual(["class A…", "end", ""]);
  });

  it("folds the range at the caret with Option and Command with [ and opens it with ] (A-18)", async () => {
    await openJson();
    // The editor takes the selection of the page at the `selectionchange` that follows, and a draw of the lines in between puts its own back: the caret is set again until the band is on the line of the caret (the second), and the key is pressed then.
    await browser.waitUntil(
      async () => {
        await setCaret(5);
        return (await band()).line === "1";
      },
      { timeoutMsg: "the band never came to line 1" },
    );
    await pressFold();
    await waitForCount(".orca-edit-body .cm-foldPlaceholder", 1);
    expect(await lineTexts()).toEqual(["{", '  "a": {…},', '  "c": 2', "}", ""]);
    await pressUnfold();
    await waitForCount(".orca-edit-body .cm-foldPlaceholder", 0);
    expect(await lineTexts()).toHaveLength(7);
  });

  it("saves the whole text of a file with a range folded, and a fold alone saves nothing (A-18)", async () => {
    await openJson();
    const write = await mock("orca_file_write", saved("sig-2"));
    await pressOn(arrow(2));
    await waitForCount(".orca-edit-body .cm-foldPlaceholder", 1);
    await browser.pause(500);
    expect(await callsOf(write)).toEqual([]);
    expect(await editorText()).toBe(json);
    await typeIn("x");
    const [call] = (await waitForCalls(write)) as { content: string }[];
    expect(call.content).toBe(`${json}x`);
  });

  it("indents the line with Tab, and carries the indent of the line to the next one with Enter (A-18)", async () => {
    await openFiles();
    await openA("a\n");
    await setCaret(0);
    await pressTab();
    await waitForText("  a\n");
    // The caret is at the end of "  a": Enter opens a line with the same indent.
    await setCaret(3);
    await pressEnter();
    await waitForText("  a\n  \n");
  });

  it("says why the file is not shown when CodeMirror cannot be read, and shows it when the file is opened again (A-18)", async () => {
    await openFiles();
    await mock("orca_file_read", text("fn main() {}\n"));
    await waitForCount("#orca-files-tree .orca-file", 4);
    // The read of the script fails, as a script that is gone does.
    await browser.execute(() => {
      const original = document.head.append.bind(document.head);
      document.head.append = (...nodes: (Node | string)[]) => {
        const mine = (n: Node | string) => n instanceof HTMLScriptElement && n.src.endsWith("/vendor/codemirror.js");
        for (const n of nodes) if (mine(n)) setTimeout(() => (n as HTMLScriptElement).onerror?.(new Event("error")), 0);
        original(...nodes.filter((n) => !mine(n)));
      };
    });
    await doublePress("a.rs");
    await expect($(".orca-edit .orca-empty")).toHaveText("vendor/codemirror.js を読めませんでした");
    await expect($(CONTENT)).not.toBeDisplayed();
    expect(await dirtyMarks()).toBe(0);
    await browser.execute(() => {
      delete (document.head as { append?: unknown }).append;
    });
    await tabOf("file:1").$(".orca-tab-close").click();
    await expect(tabOf("file:1")).not.toBeExisting();
    // The tree of the pane is read again when another tab is shown, and a press on a row waits for the rows.
    await waitForCount("#orca-files-tree .orca-file", 4);
    await doublePress("a.rs");
    await waitForText("fn main() {}\n");
  });

  it("has the colors in variables of the page, apart from the layout (A-21)", async () => {
    await openFiles();
    await openFileWith(rust("fn a() {}\n"));
    await browser.execute(() => document.documentElement.style.setProperty("--hl-keyword", "rgb(1, 2, 3)"));
    expect(await browser.execute(() => getComputedStyle(document.querySelector(".orca-edit-body .tok-keyword")!).color)).toBe("rgb(1, 2, 3)");
  });

  it("has one button that shows and hides the file pane: in the upper row of the pane while it is shown, at the right end of the tab strip while it is hidden", async () => {
    await openOrca(orcaOverview(sample(), worktrees()), { orca_terminal_read: ["$"] });
    await expect($("#orca-files")).not.toBeDisplayed();
    await expect($("#orca-files-split")).not.toBeDisplayed();
    const hidden = await toggleBoxes();
    expect(hidden).toHaveLength(1);
    expect(hidden[0].inFiles).toBe(false);
    expect(hidden[0].pressed).toBe("false");
    expect(hidden[0].label).toBe("ファイル欄");
    await mock("orca_files_list", root());
    await project("example-app").click();
    await filesToggle().click();
    await expect($("#orca-files")).toBeDisplayed();
    await expect($("#orca-files-split")).toBeDisplayed();
    const shown = await toggleBoxes();
    expect(shown).toHaveLength(1);
    expect(shown[0].inFiles).toBe(true);
    expect(shown[0].pressed).toBe("true");
    expect(shown[0].label).toBe("ファイル欄");
    const box = await browser.execute(() => {
      const r = (selector: string) => document.querySelector(selector)!.getBoundingClientRect();
      return { workRight: r("#orca-work").right, splitLeft: r("#orca-files-split").left, splitRight: r("#orca-files-split").right, filesLeft: r("#orca-files").left, filesRight: r("#orca-files").right, share: r("#orca-files").width / r("#orca").width, barTop: r("#orca-files-bar").top, barHeight: r("#orca-files-bar").height, headTop: r("#orca-files-head").top, headBottom: r("#orca-files-head").bottom, tabsTop: r(".orca-tabbar").top, tabs: r(".orca-tabbar").height, toggleRight: r("#orca-files-toggle").right };
    });
    expect(box.workRight).toBeLessThanOrEqual(box.splitLeft + 1);
    expect(box.splitRight).toBeLessThanOrEqual(box.filesLeft + 1);
    expect(box.share).toBeCloseTo(0.22, 2);
    // The upper row is as high as the tab strip and level with it; the heading is under it. The button is at the right end of the row.
    expect(box.barHeight).toBe(box.tabs);
    expect(box.barTop).toBe(box.tabsTop);
    expect(box.headTop).toBeGreaterThanOrEqual(box.barTop + box.barHeight - 1);
    expect(box.toggleRight).toBeLessThanOrEqual(box.filesRight);
    expect(box.filesRight - box.toggleRight).toBeLessThanOrEqual(8);
    await filesToggle().click();
    await expect($("#orca-files")).not.toBeDisplayed();
    await expect($("#orca-files-split")).not.toBeDisplayed();
    const back = await toggleBoxes();
    expect(back).toHaveLength(1);
    expect(back[0].inFiles).toBe(false);
    expect(back[0].pressed).toBe("false");
    const corner = await browser.execute(() => {
      const bar = document.querySelector(".orca-tabbar")!.getBoundingClientRect();
      const toggle = document.querySelector(".orca-tabbar .orca-files-toggle:not([hidden])")!.getBoundingClientRect();
      const plus = document.querySelector(".orca-plus")!.getBoundingClientRect();
      return { barRight: bar.right, toggleRight: toggle.right, plusRight: plus.right };
    });
    expect(corner.toggleRight).toBeLessThanOrEqual(corner.barRight);
    expect(corner.toggleRight).toBeGreaterThan(corner.plusRight);
  });

  it("moves the focus to the button that is shown when the focused button is pressed", async () => {
    await openOrca(orcaOverview(sample(), worktrees()), { orca_terminal_read: ["$"] });
    await mock("orca_files_list", root());
    await project("example-app").click();
    await $(".orca-tabbar [data-tab]").waitForDisplayed();
    // A press from the keyboard is a click on the focused button; the shown terminal would take the keys of WebDriver, so the click is made on the focused button itself.
    const pressFocused = (selector: string) =>
      browser.execute((s) => {
        const b = document.querySelector<HTMLElement>(s)!;
        b.focus();
        b.click();
        const a = document.activeElement;
        return { files: a?.closest("#orca-files") !== null, tabs: a?.closest(".orca-tabbar") !== null, toggle: a?.classList.contains("orca-files-toggle") ?? false };
      }, selector);
    const shown = await pressFocused(".orca-tabbar .orca-files-toggle:not([hidden])");
    await expect($("#orca-files")).toBeDisplayed();
    expect(shown).toEqual({ files: true, tabs: false, toggle: true });
    const hidden = await pressFocused("#orca-files-toggle");
    await expect($("#orca-files")).not.toBeDisplayed();
    expect(hidden).toEqual({ files: false, tabs: true, toggle: true });
  });

  it("puts the button in the pane in the top right corner only", async () => {
    const two = orcaOverview(sample(), worktrees(), { terminals: [orcaTerminal("example-app", "zsh")] });
    const side = layout({ kind: "split", direction: "row", children: [pane("p1", [claude]), pane("p2", [zsh])], sizes: [0.5, 0.5] }, "p1");
    await openOrca(two, { orca_terminal_read: ["$"], orca_panes: side });
    await project("example-app").click();
    await waitForCount(".orca-pane", 2);
    await expect($('.orca-pane[data-pane="p1"] .orca-files-toggle')).not.toBeDisplayed();
    await expect($('.orca-pane[data-pane="p2"] .orca-files-toggle')).toBeDisplayed();
    expect(await toggleBoxes()).toHaveLength(1);
    const stacked = layout({ kind: "split", direction: "column", children: [pane("p1", [claude]), pane("p2", [zsh])], sizes: [0.5, 0.5] }, "p1");
    await openOrca(two, { orca_terminal_read: ["$"], orca_panes: stacked });
    await project("example-app").click();
    await waitForCount(".orca-pane", 2);
    await expect($('.orca-pane[data-pane="p1"] .orca-files-toggle')).toBeDisplayed();
    await expect($('.orca-pane[data-pane="p2"] .orca-files-toggle')).not.toBeDisplayed();
    expect(await toggleBoxes()).toHaveLength(1);
  });

  it("shows the heading of the selected session's worktree, reads its root, and draws the folders first, with the ignored ones in italics once git has answered", async () => {
    await openFiles({ orca_files_ignored: holds });
    await expect($("#orca-files-title")).toHaveText("example-app ・ feat/a");
    await waitForCount("#orca-files-tree .orca-file", 4);
    expect(await callsOf("orca_files_list")).toEqual([{ path: "/work/example-app", dir: "", ignored: false, environment: null }]);
    expect(await names()).toEqual(["src", "target", "a.rs", "b.log"]);
    // The folder is drawn while git has not answered: nothing is marked yet, and the question is the entries of the list in its order.
    expect(await waitForCalls("orca_files_ignored")).toEqual([{ path: "/work/example-app", paths: ["src", "target", "a.rs", "b.log"], environment: null }]);
    const kinds = () => browser.execute(() => [...document.querySelectorAll<HTMLElement>(".orca-file")].map((e) => [e.dataset.kind, e.dataset.ignored]));
    expect(await kinds()).toEqual([["dir", "false"], ["dir", "false"], ["file", "false"], ["file", "false"]]);
    await release("orca_files_ignored", rootIgnored);
    await browser.waitUntil(async () => (await isIgnored("b.log")) === "true", { timeoutMsg: "the ignored mark never came" });
    expect(await kinds()).toEqual([["dir", "false"], ["dir", "true"], ["file", "false"], ["file", "true"]]);
    expect(await names()).toEqual(["src", "target", "a.rs", "b.log"]);
    const look = await browser.execute(() => {
      const style = (path: string) => getComputedStyle(document.querySelector(`.orca-file[data-path="${path}"] .orca-file-name`)!);
      const row = (path: string) => getComputedStyle(document.querySelector(`.orca-file[data-path="${path}"]`)!);
      return { plain: style("a.rs").fontStyle, ignored: style("b.log").fontStyle, plainOpacity: row("a.rs").opacity, ignoredOpacity: row("b.log").opacity };
    });
    expect(look).toEqual({ plain: "normal", ignored: "italic", plainOpacity: "1", ignoredOpacity: "0.55" });
  });

  it("marks nothing when git cannot answer, and shows no message for it", async () => {
    await openFiles({ orca_files_ignored: rejects("Orca に接続できません") });
    await waitForCount("#orca-files-tree .orca-file", 4);
    await waitForCalls("orca_files_ignored");
    await browser.pause(300);
    expect(await names()).toEqual(["src", "target", "a.rs", "b.log"]);
    expect(await isIgnored("target")).toBe("false");
    expect(await count("#orca-files-tree .orca-file-note")).toBe(0);
  });

  // A-39: the entries that differ from HEAD. Rust asks git (unit tests); here the screen is checked: the question, the colors, the marks at the right end, and when they are drawn.
  const changedRoot = () => dirOf("", [["src", true], ["lib", true], ["a.rs", false], ["b.rs", false], ["c.rs", false]]);
  const changedMarks = () => [change("src", "changed"), change("lib", "new"), change("a.rs", "changed"), change("b.rs", "new")];

  it("asks which entries differ from HEAD after the folder is drawn, and draws them in the color of their kind with M, U and a dot at the right end, and the others as they were (A-39)", async () => {
    await openFiles({ orca_files_list: changedRoot(), orca_files_ignored: [], orca_files_changes: holds });
    await waitForCount("#orca-files-tree .orca-file", 5);
    // The folder is drawn while git has not answered: nothing is marked yet, and the question is the entries of the list in its order.
    expect(await waitForCalls("orca_files_changes")).toEqual([{ path: "/work/example-app", paths: ["src", "lib", "a.rs", "b.rs", "c.rs"], environment: null }]);
    expect(await count(".orca-file[data-change]")).toBe(0);
    expect(await count(".orca-file-git")).toBe(0);
    await release("orca_files_changes", changedMarks());
    await browser.waitUntil(async () => (await gitLook("a.rs")).change === "changed", { timeoutMsg: "the change mark never came" });
    expect(await names()).toEqual(["src", "lib", "a.rs", "b.rs", "c.rs"]);
    const [a, b, c, src, lib] = [await gitLook("a.rs"), await gitLook("b.rs"), await gitLook("c.rs"), await gitLook("src"), await gitLook("lib")];
    // A file: the name and the icon in the color, not bold, and M or U at the right end in the same color.
    expect([a.change, a.name, a.icon, a.weight, a.git?.text, a.git?.color]).toEqual(["changed", WARN, WARN, "400", "M", WARN]);
    expect([b.change, b.name, b.icon, b.weight, b.git?.text, b.git?.color]).toEqual(["new", INS, INS, "400", "U", INS]);
    expect(a.git!.fromEnd).toBeGreaterThanOrEqual(7);
    expect(a.git!.fromEnd).toBeLessThanOrEqual(11);
    // A folder with a difference inside: the same colors and a dot (a filled circle with no text) at the right end.
    expect([src.change, src.name, src.icon, src.git?.text, src.git?.fill]).toEqual(["changed", WARN, WARN, "", WARN]);
    expect([lib.change, lib.name, lib.icon, lib.git?.text, lib.git?.fill]).toEqual(["new", INS, INS, "", INS]);
    expect([src.git!.width, src.git!.height, src.git!.radius]).toEqual([6, 6, "50%"]);
    expect(src.git!.fromEnd).toBeGreaterThanOrEqual(7);
    expect(src.git!.fromEnd).toBeLessThanOrEqual(13);
    // An entry with no difference has no mark and keeps the colors of every row.
    expect(c.change).toBeNull();
    expect(c.git).toBeNull();
    expect([c.name, c.icon]).not.toContain(WARN);
    expect([c.name, c.icon]).not.toContain(INS);
    expect(await names()).toEqual(["src", "lib", "a.rs", "b.rs", "c.rs"]);
  });

  it("keeps the colors and the marks white on the selected rows, and gives them back when the rows are not selected (A-39)", async () => {
    await openFiles({ orca_files_list: changedRoot(), orca_files_ignored: [], orca_files_changes: changedMarks() });
    await browser.waitUntil(async () => (await gitLook("a.rs")).change === "changed", { timeoutMsg: "the change mark never came" });
    await metaPress("a.rs");
    await metaPress("lib");
    const [a, lib] = [await gitLook("a.rs"), await gitLook("lib")];
    expect([a.name, a.icon, a.git?.color, a.background]).toEqual([WHITE, WHITE, WHITE, "rgb(30, 123, 82)"]);
    expect([lib.name, lib.icon, lib.git?.fill, lib.background]).toEqual([WHITE, WHITE, WHITE, "rgb(30, 123, 82)"]);
    // The mark of the kind is still there under the selection.
    expect([a.change, a.git?.text, lib.change]).toEqual(["changed", "M", "new"]);
    await metaPress("a.rs");
    expect((await gitLook("a.rs")).name).toBe(WARN);
    expect((await gitLook("lib")).name).toBe(WHITE);
  });

  it("draws a changed file that is open in the editor in the color of its kind on the open row's ground (A-39)", async () => {
    await openFiles({ orca_files_changes: [change("a.rs", "changed")] });
    await openA();
    await browser.waitUntil(async () => (await gitLook("a.rs")).change === "changed", { timeoutMsg: "the change mark never came" });
    await expect(row("a.rs")).toHaveAttribute("data-open", "true");
    const a = await gitLook("a.rs");
    expect([a.name, a.icon, a.background, a.git?.text]).toEqual([WARN, WARN, "rgb(227, 244, 234)", "M"]);
  });

  it("keeps the faint italics of an ignored entry that also differs from HEAD (A-39)", async () => {
    await openFiles({ orca_files_changes: [change("b.log", "new"), change("target", "changed")] });
    await browser.waitUntil(async () => (await isIgnored("b.log")) === "true", { timeoutMsg: "the ignored mark never came" });
    await browser.waitUntil(async () => (await gitLook("b.log")).change === "new", { timeoutMsg: "the change mark never came" });
    const log = await gitLook("b.log");
    expect([log.style, log.opacity, log.name, log.git?.text]).toEqual(["italic", "0.55", INS, "U"]);
    const plain = await gitLook("a.rs");
    expect([plain.style, plain.opacity, plain.change]).toEqual(["normal", "1", null]);
  });

  it("marks nothing when git cannot tell the differences, and shows no message for it (A-39)", async () => {
    await openFiles({ orca_files_changes: rejects("Orca に接続できません") });
    await waitForCount("#orca-files-tree .orca-file", 4);
    await waitForCalls("orca_files_changes");
    await browser.waitUntil(async () => (await isIgnored("b.log")) === "true", { timeoutMsg: "the ignored mark never came" });
    await browser.pause(300);
    expect(await names()).toEqual(["src", "target", "a.rs", "b.log"]);
    expect(await count(".orca-file[data-change]")).toBe(0);
    expect(await count(".orca-file-git")).toBe(0);
    expect(await count("#orca-files-tree .orca-file-note")).toBe(0);
    await expect($(CARDS)).not.toExist();
  });

  it("keeps the change marks through a read again until git answers, replaces them with the answer, and keeps them when git cannot answer (A-39)", async () => {
    await openFiles({ orca_files_changes: [change("a.rs", "changed")] });
    await browser.waitUntil(async () => (await gitLook("a.rs")).change === "changed", { timeoutMsg: "the change mark never came" });
    const marks = await mock("orca_files_changes", holds);
    await focusBack();
    expect(await waitForCalls(marks)).toEqual([{ path: "/work/example-app", paths: ["src", "target", "a.rs", "b.log"], environment: null }]);
    await browser.pause(300);
    expect((await gitLook("a.rs")).change).toBe("changed");
    // The answer replaces the marks: a.rs is no longer named.
    await release(marks, [change("src", "new")]);
    await browser.waitUntil(async () => (await gitLook("a.rs")).change === null, { timeoutMsg: "the answer never replaced the marks" });
    expect((await gitLook("src")).change).toBe("new");
    expect(await count(".orca-file-git")).toBe(1);
    // An answer that fails leaves the kept marks.
    const failing = await mock("orca_files_changes", rejects("Orca に接続できません"));
    await focusBack();
    await waitForCalls(failing);
    await browser.pause(300);
    expect((await gitLook("src")).change).toBe("new");
  });

  it("asks for the differences by the clock too, a folder that holds the same entries included, and not for its ignore marks (A-39)", async () => {
    await openFiles(timers({ orcaClock: 1000 }));
    await waitForCount("#orca-files-tree .orca-file", 4);
    await browser.waitUntil(async () => (await isIgnored("b.log")) === "true", { timeoutMsg: "the ignored mark never came" });
    const ignored = await mock("orca_files_ignored", rootIgnored);
    const marks = await mock("orca_files_changes", [change("a.rs", "changed")]);
    // A file was edited outside the app: the same entries, and the mark comes with no return of the focus.
    await browser.waitUntil(async () => (await gitLook("a.rs")).change === "changed", { timeoutMsg: "the clock never asked for the differences" });
    await mock("orca_files_changes", []);
    await browser.waitUntil(async () => (await gitLook("a.rs")).change === null, { timeoutMsg: "the clock never took the mark off" });
    expect(await callsOf(ignored)).toEqual([]);
    expect(await callsOf(marks)).not.toEqual([]);
  });

  it("asks for the differences of a folder that is opened, after it is drawn, and not of a folder that the list marked as ignored (A-39)", async () => {
    await openFiles();
    await waitForCount("#orca-files-tree .orca-file", 4);
    const marks = await mock("orca_files_changes", [change("src/lib", "changed"), change("src/gen.rs", "new")]);
    await mock("orca_files_list", dirOf("src", [["lib", true], ["gen.rs", false]]));
    await row("src").click();
    expect(await waitForCalls(marks)).toEqual([{ path: "/work/example-app", paths: ["src/lib", "src/gen.rs"], environment: null }]);
    await browser.waitUntil(async () => (await gitLook("src/gen.rs")).change === "new", { timeoutMsg: "the change mark never came" });
    expect((await gitLook("src/lib")).git?.text).toBe("");
    await browser.waitUntil(async () => (await isIgnored("target")) === "true", { timeoutMsg: "the ignored mark never came" });
    const none = await mock("orca_files_changes", []);
    await mock("orca_files_list", dirOf("target", [["debug", true, true]]));
    await row("target").click();
    await waitForCount("#orca-files-tree .orca-file", 7);
    await browser.pause(300);
    expect(await callsOf(none)).toEqual([]);
    expect(await count('.orca-file[data-path="target/debug"][data-change]')).toBe(0);
  });

  it("drops the change marks that come after another worktree's tree took the place (A-39)", async () => {
    const value = orcaOverview(sample(), [orcaWorktree("example-app", "feat/a"), orcaWorktree("example-app", "feat/b", { path: "/work/example-app-b" })], {
      terminals: [orcaTerminal("example-app", "zsh", { path: "/work/example-app-b", branch: "feat/b" })],
    });
    await openFiles({ orca_files_changes: holds }, value);
    await waitForCount("#orca-files-tree .orca-file", 4);
    await waitForCalls("orca_files_changes");
    const list = await mock("orca_files_list", dirOf("", [["target", true]]));
    await tabOf(zsh).$(".orca-tab-btn").click();
    await expect($("#orca-files-title")).toHaveText("example-app ・ feat/b");
    await waitForCalls(list);
    await browser.waitUntil(async () => (await names()).join() === "target", { timeoutMsg: "the tree of the other worktree never showed" });
    // The answer for the first worktree comes now, and names a path the new tree has too.
    await release("orca_files_changes", [change("target", "changed")]);
    await browser.pause(300);
    expect((await gitLook("target")).change).toBeNull();
  });

  // A-18: the icon of a file is the one Rust names (`icon`): the SVG of JetBrains' that the app holds, as an image of its own origin; a file with no icon and a folder keep the line drawing.
  it("draws the icon Rust names for a file as an image of the app's own, and the line drawing for a file with none and for a folder", async () => {
    await openFiles({ orca_files_list: dirOf("", [["src", true], ["user.rb", false, false, "ruby"], ["notes.txt", false]]), orca_files_ignored: [] });
    await waitForCount("#orca-files-tree .orca-file", 3);
    const looks = await browser.execute(() =>
      [...document.querySelectorAll<HTMLElement>("#orca-files-tree .orca-file")].map((node) => {
        const image = node.querySelector<HTMLImageElement>(".orca-file-ic img");
        return { path: node.dataset.path, images: node.querySelectorAll(".orca-file-ic img").length, lines: node.querySelectorAll(".orca-file-ic svg").length, src: image?.getAttribute("src") ?? null, loaded: (image?.naturalWidth ?? 0) > 0, alt: image?.alt ?? null, draggable: image?.draggable ?? null };
      }),
    );
    expect(looks).toEqual([
      { path: "src", images: 0, lines: 1, src: null, loaded: false, alt: null, draggable: null },
      { path: "user.rb", images: 1, lines: 0, src: "vendor/jetbrains-icons/ruby.svg", loaded: true, alt: "", draggable: false },
      { path: "notes.txt", images: 0, lines: 1, src: null, loaded: false, alt: null, draggable: null },
    ]);
  });

  it("reads a folder when it is pressed the first time, and draws it from what was read when it is opened again", async () => {
    await openFiles();
    await waitForCount("#orca-files-tree .orca-file", 4);
    const list = await mock("orca_files_list", dirOf("src", [["lib", true], ["main.rs", false]]));
    await row("src").click();
    expect(await waitForCalls(list)).toEqual([{ path: "/work/example-app", dir: "src", ignored: false, environment: null }]);
    await expect(row("src")).toHaveAttribute("aria-expanded", "true");
    expect(await names()).toEqual(["src", "lib", "main.rs", "target", "a.rs", "b.log"]);
    // A child is one level in.
    const depths = await browser.execute(() => ["src", "src/lib"].map((p) => document.querySelector<HTMLElement>(`.orca-file[data-path="${p}"]`)!.style.getPropertyValue("--depth")));
    expect(depths).toEqual(["0", "1"]);
    await row("src").click();
    await expect(row("src")).toHaveAttribute("aria-expanded", "false");
    expect(await names()).toEqual(["src", "target", "a.rs", "b.log"]);
    // Opened again, it is drawn at once from the list that is held: neither the folder nor its marks are asked for again.
    const marks = await mock("orca_files_ignored", ["src/lib"]);
    await row("src").click();
    await expect(row("src")).toHaveAttribute("aria-expanded", "true");
    expect(await names()).toEqual(["src", "lib", "main.rs", "target", "a.rs", "b.log"]);
    await browser.pause(300);
    expect(await callsOf(list)).toHaveLength(1);
    expect(await callsOf(marks)).toEqual([]);
  });

  it("has no reload button in the heading of the pane, for the files or for the history", async () => {
    await openFiles(historyFixtures());
    await waitForCount("#orca-files-tree .orca-file", 4);
    await expect($("#orca-files-title")).toBeDisplayed();
    expect(await count("#orca-files-head button:not(.orca-branch-btn)")).toBe(0);
    expect(await count("#orca-files-reload")).toBe(0);
    await paneMode("履歴").click();
    expect(await count("#orca-files-reload")).toBe(0);
  });

  it("reads the root and the open folders again when the window gets the focus back", async () => {
    await openFiles();
    await waitForCount("#orca-files-tree .orca-file", 4);
    await mock("orca_files_list", dirOf("src", [["lib", true]]));
    await row("src").click();
    await waitForCount("#orca-files-tree .orca-file", 5);
    const list = await mock("orca_files_list", dirOf("", [["src", true], ["new.rs", false]]));
    await focusBack();
    const calls = await waitForCalls(list, 2);
    expect(calls).toEqual([
      { path: "/work/example-app", dir: "", ignored: false, environment: null },
      { path: "/work/example-app", dir: "src", ignored: false, environment: null },
    ]);
  });

  it("asks for the differences of the root and of the open folders in one call when the tree is read again (A-39)", async () => {
    await openFiles();
    await waitForCount("#orca-files-tree .orca-file", 4);
    await mock("orca_files_list", dirOf("src", [["lib", true], ["gen.rs", false]]));
    await row("src").click();
    await waitForCount("#orca-files-tree .orca-file", 6);
    const marks = await mock("orca_files_changes", [change("src/gen.rs", "new")]);
    // The root first, alone, then `src`: each is answered with its own entries.
    const list = await mock("orca_files_list", holds);
    await focusBack();
    await waitForCalls(list);
    await release(list, root());
    await waitForCalls(list, 2);
    await release(list, dirOf("src", [["lib", true], ["gen.rs", false]]));
    expect(await waitForCalls(marks)).toEqual([{ path: "/work/example-app", paths: ["src", "target", "a.rs", "b.log", "src/lib", "src/gen.rs"], environment: null }]);
    await browser.waitUntil(async () => (await gitLook("src/gen.rs")).change === "new", { timeoutMsg: "the change mark never came" });
    await browser.pause(300);
    expect(await callsOf(marks)).toHaveLength(1);
  });

  it("reads nothing at the return of the focus while the file pane is hidden or the history is shown, and not a second time while a read is on its way", async () => {
    await openFiles(historyFixtures());
    await waitForCount("#orca-files-tree .orca-file", 4);
    const list = await mock("orca_files_list", holds);
    await focusBack();
    await waitForCalls(list);
    await focusBack();
    await browser.pause(300);
    expect(await callsOf(list)).toHaveLength(1);
    await release(list, root());
    await browser.pause(300);
    const again = await mock("orca_files_list", root());
    await paneMode("履歴").click();
    await waitForCount("#orca-history-list .orca-commit", 3);
    await focusBack();
    await browser.pause(300);
    expect(await callsOf(again)).toEqual([]);
    await paneMode("ファイル").click();
    await filesToggle().click();
    await expect($("#orca-files")).not.toBeDisplayed();
    await focusBack();
    await browser.pause(300);
    expect(await callsOf(again)).toEqual([]);
  });

  it("reads the root alone first, then the open folders again side by side, not one after the other", async () => {
    await openFiles();
    await waitForCount("#orca-files-tree .orca-file", 4);
    await mock("orca_files_list", dirOf("src", [["lib", true]]));
    await row("src").click();
    await waitForCount("#orca-files-tree .orca-file", 5);
    await mock("orca_files_list", dirOf("src/lib", [["x", false]]));
    await row("src/lib").click();
    await waitForCount("#orca-files-tree .orca-file", 6);
    const list = await mock("orca_files_list", holds);
    await focusBack();
    // Only the root is on its way while it has not been answered.
    expect(await waitForCalls(list)).toEqual([{ path: "/work/example-app", dir: "", ignored: false, environment: null }]);
    await browser.pause(300);
    expect(await callsOf(list)).toHaveLength(1);
    await release(list, dirOf("", [["src", true], ["target", true]]));
    // Both folders are on their way while neither has been answered.
    expect(await waitForCalls(list, 3)).toEqual([
      { path: "/work/example-app", dir: "", ignored: false, environment: null },
      { path: "/work/example-app", dir: "src", ignored: false, environment: null },
      { path: "/work/example-app", dir: "src/lib", ignored: false, environment: null },
    ]);
    await release(list, dirOf("src", [["lib", true]]));
    await release(list, dirOf("src/lib", [["y", false]]));
    await browser.waitUntil(async () => (await names()).join() === "src,lib,y,target", { timeoutMsg: "the reads never drew" });
  });

  it("reads at most 16 folders at once, after the root, when the focus comes back", async () => {
    const folders = Array.from({ length: 17 }, (_, i) => `d${i}`);
    await openFiles({ orca_files_list: dirOf("", folders.map((f) => [f, true])) });
    await waitForCount("#orca-files-tree .orca-file", 17);
    for (const f of folders) {
      const list = await mock("orca_files_list", dirOf(f, [["x", false]]));
      await row(f).click();
      await waitForCalls(list);
    }
    await waitForCount("#orca-files-tree .orca-file", 34);
    const list = await mock("orca_files_list", holds);
    await focusBack();
    await waitForCalls(list);
    await browser.pause(300);
    expect(await callsOf(list)).toHaveLength(1);
    await release(list, dirOf("", folders.map((f) => [f, true])));
    await waitForCalls(list, 17);
    await browser.pause(300);
    expect(await callsOf(list)).toHaveLength(17);
    // One answer frees one place, and the last folder is read.
    await release(list, dirOf("d0", [["x", false]]));
    expect(await waitForCalls(list, 18)).toHaveLength(18);
  });

  it("keeps the ignored marks through a read again until git answers, and keeps them when git cannot", async () => {
    await openFiles();
    await waitForCount("#orca-files-tree .orca-file", 4);
    await browser.waitUntil(async () => (await isIgnored("b.log")) === "true", { timeoutMsg: "the ignored mark never came" });
    const marks = await mock("orca_files_ignored", holds);
    await focusBack();
    await waitForCalls(marks);
    await browser.pause(300);
    expect(await isIgnored("b.log")).toBe("true");
    expect(await isIgnored("target")).toBe("true");
    expect(await isIgnored("a.rs")).toBe("false");
    // The answer replaces the marks: b.log is no longer named.
    await release(marks, ["target"]);
    await browser.waitUntil(async () => (await isIgnored("b.log")) === "false", { timeoutMsg: "the answer never replaced the marks" });
    expect(await isIgnored("target")).toBe("true");
    // An answer that fails leaves the kept marks.
    const failing = await mock("orca_files_ignored", rejects("Orca に接続できません"));
    await focusBack();
    await waitForCalls(failing);
    await browser.pause(300);
    expect(await isIgnored("target")).toBe("true");
  });

  it("reads a folder that was closed again after the focus came back, because the read dropped it", async () => {
    await openFiles();
    await waitForCount("#orca-files-tree .orca-file", 4);
    await mock("orca_files_list", dirOf("src", [["lib", true]]));
    await row("src").click();
    await waitForCount("#orca-files-tree .orca-file", 5);
    await row("src").click();
    await expect(row("src")).toHaveAttribute("aria-expanded", "false");
    const list = await mock("orca_files_list", dirOf("", [["src", true], ["target", true]]));
    await focusBack();
    expect(await waitForCalls(list)).toEqual([{ path: "/work/example-app", dir: "", ignored: false, environment: null }]);
    await browser.waitUntil(async () => (await names()).join() === "src,target", { timeoutMsg: "the root never drew" });
    const inner = await mock("orca_files_list", dirOf("src", [["new.rs", false]]));
    await row("src").click();
    expect(await waitForCalls(inner)).toEqual([{ path: "/work/example-app", dir: "src", ignored: false, environment: null }]);
    await browser.waitUntil(async () => (await names()).join() === "src,new.rs,target", { timeoutMsg: "the folder was not read again" });
  });

  it("does not ask for the ignore marks of a folder that the list marked as ignored", async () => {
    await openFiles();
    await waitForCount("#orca-files-tree .orca-file", 4);
    await browser.waitUntil(async () => (await isIgnored("target")) === "true", { timeoutMsg: "the ignored mark never came" });
    const marks = await mock("orca_files_ignored", []);
    const list = await mock("orca_files_list", dirOf("target", [["debug", true, true]]));
    await row("target").click();
    expect(await waitForCalls(list)).toEqual([{ path: "/work/example-app", dir: "target", ignored: true, environment: null }]);
    await waitForCount("#orca-files-tree .orca-file", 5);
    expect(await isIgnored("target/debug")).toBe("true");
    // A folder in it is ignored as well, and is read as one.
    const inner = await mock("orca_files_list", dirOf("target/debug", [["x", false, true]]));
    await row("target/debug").click();
    expect(await waitForCalls(inner)).toEqual([{ path: "/work/example-app", dir: "target/debug", ignored: true, environment: null }]);
    await waitForCount("#orca-files-tree .orca-file", 6);
    await browser.pause(300);
    expect(await callsOf(marks)).toEqual([]);
  });

  it("asks for the ignore marks of a folder that is opened, after it is drawn", async () => {
    await openFiles();
    await waitForCount("#orca-files-tree .orca-file", 4);
    const marks = await mock("orca_files_ignored", ["src/gen.rs"]);
    await mock("orca_files_list", dirOf("src", [["lib", true], ["gen.rs", false]]));
    await row("src").click();
    expect(await waitForCalls(marks)).toEqual([{ path: "/work/example-app", paths: ["src/lib", "src/gen.rs"], environment: null }]);
    await browser.waitUntil(async () => (await isIgnored("src/gen.rs")) === "true", { timeoutMsg: "the ignored mark never came" });
    expect(await isIgnored("src/lib")).toBe("false");
  });

  it("drops the ignore marks that come after another worktree's tree took the place", async () => {
    const value = orcaOverview(sample(), [orcaWorktree("example-app", "feat/a"), orcaWorktree("example-app", "feat/b", { path: "/work/example-app-b" })], {
      terminals: [orcaTerminal("example-app", "zsh", { path: "/work/example-app-b", branch: "feat/b" })],
    });
    await openFiles({ orca_files_ignored: holds }, value);
    await waitForCount("#orca-files-tree .orca-file", 4);
    await waitForCalls("orca_files_ignored");
    const list = await mock("orca_files_list", dirOf("", [["target", true]]));
    await tabOf(zsh).$(".orca-tab-btn").click();
    await expect($("#orca-files-title")).toHaveText("example-app ・ feat/b");
    await waitForCalls(list);
    await browser.waitUntil(async () => (await names()).join() === "target", { timeoutMsg: "the tree of the other worktree never showed" });
    // The answer for the first worktree comes now, and names a path the new tree has too.
    await release("orca_files_ignored", ["target"]);
    await browser.pause(300);
    expect(await isIgnored("target")).toBe("false");
  });

  it("shows another worktree's tree, and its name, when another tab is selected", async () => {
    const value = orcaOverview(sample(), [orcaWorktree("example-app", "feat/a"), orcaWorktree("example-app", "feat/b", { path: "/work/example-app-b" })], {
      terminals: [orcaTerminal("example-app", "zsh", { path: "/work/example-app-b", branch: "feat/b" })],
    });
    await openFiles({}, value);
    await waitForCount("#orca-files-tree .orca-file", 4);
    const list = await mock("orca_files_list", dirOf("", [["only-b.rs", false]]));
    await tabOf(zsh).$(".orca-tab-btn").click();
    await expect($("#orca-files-title")).toHaveText("example-app ・ feat/b");
    expect(await waitForCalls(list)).toEqual([{ path: "/work/example-app-b", dir: "", ignored: false, environment: null }]);
    await browser.waitUntil(async () => (await names()).join() === "only-b.rs", { timeoutMsg: "the tree of the other worktree never showed" });
  });

  // example-idle has no session (so no tab), and lists a worktree that is not the main one before the main one; example-app has a Claude session in a worktree that is not the main one.
  const withIdle = (extra: Record<string, unknown> = {}, more: ReturnType<typeof orcaWorktree>[] = []) =>
    orcaOverview(
      [orcaRow("example-app", "feat/b", "Write the docs", { path: "/work/example-app-b" })],
      [
        orcaWorktree("example-app", "main"),
        orcaWorktree("example-app", "feat/b", { path: "/work/example-app-b" }),
        orcaWorktree("example-idle", "feat/z", { path: "/work/example-idle-z" }),
        orcaWorktree("example-idle", "main"),
        ...more,
      ],
      extra,
    );

  // example-idle is not running (A-8), so the list keeps it under the link until the link is pressed.
  const pickIdle = async () => {
    await $("#orca-list .orca-stopped-toggle").click();
    await project("example-idle").click();
  };

  it("shows the main worktree of the selected project when it has no tab, and the selected tab's worktree once a project with a tab is selected", async () => {
    await openOrca(withIdle(), { orca_terminal_read: ["$"], orca_files_list: root() });
    await pickIdle();
    await expect($(".orca-empty")).toHaveText("セッションはありません");
    await filesToggle().click();
    await expect($("#orca-files-title")).toHaveText("example-idle ・ main");
    await waitForCount("#orca-files-tree .orca-file", 4);
    expect(await callsOf("orca_files_list")).toEqual([{ path: "/work/example-idle", dir: "", ignored: false, environment: null }]);
    const list = await mock("orca_files_list", dirOf("", [["only-b.rs", false]]));
    await project("example-app").click();
    await expect($("#orca-files-title")).toHaveText("example-app ・ feat/b");
    expect(await waitForCalls(list)).toEqual([{ path: "/work/example-app-b", dir: "", ignored: false, environment: null }]);
    await browser.waitUntil(async () => (await names()).join() === "only-b.rs", { timeoutMsg: "the tree of the selected tab never showed" });
  });

  it("opens a file of the main worktree in a tab when the project has no tab", async () => {
    await openOrca(withIdle(), { orca_terminal_read: ["$"], orca_files_list: root(), editor_settings: { autosaveMs: 100 } });
    await pickIdle();
    await filesToggle().click();
    await waitForCount("#orca-files-tree .orca-file", 4);
    const read = await mock("orca_file_read", text("fn main() {}\n"));
    await doublePress("a.rs");
    expect(await waitForCalls(read)).toEqual([{ path: "/work/example-idle", relative: "a.rs", environment: null }]);
    await expect(selectedTab().$(".orca-tab-title")).toHaveText("a.rs");
    await expect($("#orca-files-title")).toHaveText("example-idle ・ main");
  });

  it("keeps the open folders and does not read the root again when the first file of a project with no tab is opened", async () => {
    await openOrca(withIdle(), { orca_terminal_read: ["$"], orca_files_list: root(), editor_settings: { autosaveMs: 100 } });
    await pickIdle();
    await filesToggle().click();
    await waitForCount("#orca-files-tree .orca-file", 4);
    const inner = await mock("orca_files_list", dirOf("src", [["lib", true], ["main.rs", false]]));
    await row("src").click();
    await waitForCalls(inner);
    await waitForCount("#orca-files-tree .orca-file", 6);
    const list = await mock("orca_files_list", root());
    const read = await mock("orca_file_read", text("fn main() {}\n"));
    await doublePress("src/main.rs");
    expect(await waitForCalls(read)).toEqual([{ path: "/work/example-idle", relative: "src/main.rs", environment: null }]);
    await expect(selectedTab().$(".orca-tab-title")).toHaveText("main.rs");
    await expect($("#orca-files-title")).toHaveText("example-idle ・ main");
    expect(await names()).toEqual(["src", "lib", "main.rs", "target", "a.rs", "b.log"]);
    await expect(row("src")).toHaveAttribute("aria-expanded", "true");
    expect(await callsOf(list)).toEqual([]);
  });

  it("reads a saved environment's files with its name", async () => {
    await openOrca(orcaOverview(sample(), worktrees(), studio), { orca_terminal_read: ["$"], orca_files_list: root() });
    await project("example-app").click();
    await filesToggle().click();
    await waitForCount("#orca-files-tree .orca-file", 4);
    expect(await callsOf("orca_files_list")).toEqual([{ path: "/work/example-app", dir: "", ignored: false, environment: "Studio" }]);
    // The differences from HEAD (A-39) are asked at the same place.
    expect(await waitForCalls("orca_files_changes")).toEqual([{ path: "/work/example-app", paths: ["src", "target", "a.rs", "b.log"], environment: "Studio" }]);
  });

  it("shows the message of a root that cannot be read, and of a folder that cannot", async () => {
    await openFiles({ orca_files_list: rejects("Orca に接続できません") });
    await expect($("#orca-files-tree .orca-file-note.fail")).toHaveText("Orca に接続できません");
    await mock("orca_files_list", root());
    // The next return of the focus reads the root that failed again.
    await focusBack();
    await waitForCount("#orca-files-tree .orca-file", 4);
    await mock("orca_files_list", rejects("ファイルが見つかりません"));
    await row("src").click();
    await expect($("#orca-files-tree .orca-file-note.fail")).toHaveText("ファイルが見つかりません");
    expect(await names()).toEqual(["src", "target", "a.rs", "b.log"]);
  });

  it("says how many more entries a folder holds than were listed", async () => {
    await openFiles({ orca_files_list: { ...dirOf("", [["a.rs", false]]), total: 5001 } });
    await expect($("#orca-files-tree .orca-file-note")).toHaveText("ほか 5000 件");
  });

  it("opens a file in a tab with a file mark on a double press, selects it, and colors the file in the tree", async () => {
    await openFiles();
    const read = await mock("orca_file_read", text("fn main() {}\n"));
    await waitForCount("#orca-files-tree .orca-file", 4);
    // A single press only selects: nothing is read.
    await row("a.rs").click();
    expect(await callsOf(read)).toEqual([]);
    await expect(row("a.rs")).toHaveAttribute("data-open", "false");
    await doublePress("a.rs");
    expect(await waitForCalls(read)).toEqual([{ path: "/work/example-app", relative: "a.rs", environment: null }]);
    await expect(tabOf("file:1")).toBeExisting();
    await expect(selectedTab().$(".orca-tab-title")).toHaveText("a.rs");
    expect(await count('.orca-tabs [data-tab="file:1"] .orca-file-tab-ic')).toBe(1);
    expect(await tabTitles()).toEqual(["Write the docs", "a.rs"]);
    await waitForText("fn main() {}\n");
    await expect($(".orca-edit-path")).toHaveText("a.rs");
    await expect($(".orca-term")).not.toBeDisplayed();
    await expect(row("a.rs")).toHaveAttribute("data-open", "true");
    // The tab was asked for as one of the project's tabs.
    const asked = (await callsOf("orca_panes")).map((c) => (c as { tabs: string[] }).tabs);
    expect(asked[asked.length - 1]).toEqual([claude, "file:1"]);
    // The heading still names the worktree, with the file selected.
    await expect($("#orca-files-title")).toHaveText("example-app ・ feat/a");
    expect(await browser.execute(() => document.activeElement?.classList.contains("cm-content"))).toBe(true);
  });

  // A-17: the right button on a tab, as the page gets it.
  const rightClickTab = (tab: string) =>
    browser.execute(
      (id, once) => {
        if (!window.__e2e_once__(once)) return;
        document.querySelector(`[data-tab="${id}"]`)!.dispatchEvent(new MouseEvent("contextmenu", { bubbles: true, cancelable: true, button: 2 }));
      },
      tab,
      onceId(),
    );

  it("adds the window and the two copies, the copies after a line, to the menu of the tab of a file under the split, with a line icon on each row and no colored dot (A-17, A-46)", async () => {
    await openFiles();
    await openA();
    await stubClipboard();
    await rightClickTab("file:1");
    await expect($('.menu[role="menu"]')).toBeDisplayed();
    expect(await textsOf('.menu[role="menu"] > *')).toEqual(["右に分割", "下に分割", "別ウィンドウで開く", "", "パスのコピー", "相対パスをコピー"]);
    expect(await count('.menu[role="menu"] > [role="separator"]')).toBe(1);
    expect(await count('.menu[role="menu"] button svg')).toBe(5);
    expect(await count('.menu[role="menu"] .pdot')).toBe(0);
    // The split to the right is a square cut by a vertical line, the one below by a horizontal line.
    const [right, below] = await browser.execute(() => [...document.querySelectorAll('.menu[role="menu"] button')].slice(0, 2).map((b) => b.querySelector("path")!.getAttribute("d")));
    expect([right, below]).toEqual(["M12 4v16", "M3 12h18"]);
    await pickItem("パスのコピー");
    await browser.waitUntil(async () => (await copiedTexts()).length === 1, { timeoutMsg: "the path was never copied" });
    await expect($(".toast")).toHaveText(expect.stringContaining("パスをコピーしました"));
    await expect($(".menu")).not.toExist();
    await rightClickTab("file:1");
    await pickItem("相対パスをコピー");
    await browser.waitUntil(async () => (await copiedTexts()).length === 2, { timeoutMsg: "the relative path was never copied" });
    await expect($(".toast")).toHaveText(expect.stringContaining("相対パスをコピーしました"));
    expect(await copiedTexts()).toEqual(["/work/example-app/a.rs", "a.rs"]);
  });

  it("has the window and the two copies, with a line before the copies, on the tab of a file that is alone in its pane, and the window alone on the Claude tab that is alone in its pane (A-17, A-46)", async () => {
    await openFiles();
    await openA();
    await stubClipboard();
    await mock("orca_panes", layout({ kind: "split", direction: "row", children: [pane("p1", [claude]), pane("p2", ["file:1"])], sizes: [0.5, 0.5] }, "p2"));
    await tabOf(claude).$(".orca-tab-btn").click();
    await waitForCount(".orca-pane", 2);
    await rightClickTab("file:1");
    await expect($('.menu[role="menu"]')).toBeDisplayed();
    expect(await textsOf('.menu[role="menu"] > *')).toEqual(["別ウィンドウで開く", "", "パスのコピー", "相対パスをコピー"]);
    expect(await count('.menu[role="menu"] button svg')).toBe(3);
    await pickItem("相対パスをコピー");
    await browser.waitUntil(async () => (await copiedTexts()).length === 1, { timeoutMsg: "the relative path was never copied" });
    expect(await copiedTexts()).toEqual(["a.rs"]);
    await rightClickTab(claude);
    await expect($('.menu[role="menu"]')).toBeDisplayed();
    expect(await textsOf('.menu[role="menu"] > *')).toEqual(["別ウィンドウで開く"]);
  });

  it("opens a file that is open already by selecting its tab, and reads it again as it comes back into the pane: the text of the disk takes the place of the one held", async () => {
    await openFiles();
    await openA();
    await tabOf(claude).$(".orca-tab-btn").click();
    await expect($(CONTENT)).not.toBeExisting();
    // The file changed on the disk while its tab was not shown.
    const read = await mock("orca_file_read", text("fn main() {}\n// outside\n", "sig-2"));
    await doublePress("a.rs");
    await expect(selectedTab().$(".orca-tab-title")).toHaveText("a.rs");
    expect(await count(".orca-tabs [data-file]")).toBe(1);
    await waitForText("fn main() {}\n// outside\n");
    expect((await callsOf(read))[0]).toEqual({ path: "/work/example-app", relative: "a.rs", environment: null });
    expect(await dirtyMarks()).toBe(0);
  });

  it("keeps the typing of a file when another tab is shown and the file again", async () => {
    await openFiles({ editor_settings: { autosaveMs: 3000 } });
    await openA();
    await type("// more\n");
    await tabOf(claude).$(".orca-tab-btn").click();
    await tabOf("file:1").$(".orca-tab-btn").click();
    await waitForText("fn main() {}\n// more\n");
    expect(await callsOf("orca_file_read")).toHaveLength(1);
  });

  it("shows the message of a file that cannot be read in the tab, with no editor", async () => {
    await openFiles();
    await waitForCount("#orca-files-tree .orca-file", 4);
    await mock("orca_file_read", rejects("バイナリのファイルは開けません"));
    await doublePress("a.rs");
    await expect($(".orca-edit .orca-empty")).toHaveText("バイナリのファイルは開けません");
    await expect($(CONTENT)).not.toBeDisplayed();
    expect(await dirtyMarks()).toBe(0);
  });

  // A-18: an image file is shown as a picture, read by Rust (`orca_file_image`, a `data:` URI), and never as text.
  describe("an image file", () => {
    const svg = (width: number, height: number) => `data:image/svg+xml;base64,${btoa(`<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}"><rect width="100%" height="100%" fill="#2a7"/></svg>`)}`;
    const withImages = () =>
      openFiles({
        orca_files_list: dirOf("", [
          ["logo.png", false],
          ["PHOTO.JPG", false],
          ["data.bin", false],
        ]),
        orca_files_ignored: [],
      });
    // The picture waits for the img to load; then its natural width and the width it is drawn at, and the width the pane gives it.
    const picture = async () => {
      await browser.waitUntil(() => browser.execute(() => (document.querySelector<HTMLImageElement>(".orca-edit-picture img")?.naturalWidth ?? 0) > 0), { timeoutMsg: "the picture never loaded" });
      return browser.execute(() => {
        const img = document.querySelector<HTMLImageElement>(".orca-edit-picture img")!;
        const box = document.querySelector<HTMLElement>(".orca-edit-picture")!;
        const style = getComputedStyle(box);
        return { natural: img.naturalWidth, shown: Math.round(img.getBoundingClientRect().width), room: Math.round(box.clientWidth - Number.parseFloat(style.paddingLeft) - Number.parseFloat(style.paddingRight)) };
      });
    };

    it("draws a picture wider than the pane at the width of the pane", async () => {
      await withImages();
      await mock("orca_file_read", text("never read"));
      await mock("orca_file_image", svg(4000, 20));
      await waitForCount("#orca-files-tree .orca-file", 3);
      await doublePress("logo.png");
      await expect($(".orca-edit-picture img")).toBeDisplayed();
      await expect($(".orca-edit-body")).not.toBeDisplayed();
      await expect($(CONTENT)).not.toBeDisplayed();
      const drawn = await picture();
      expect(drawn.natural).toBe(4000);
      expect(drawn.shown).toBe(drawn.room);
      expect(drawn.shown).toBeLessThan(4000);
      expect(await callsOf("orca_file_image")).toEqual([{ path: "/work/example-app", relative: "logo.png", environment: null }]);
      expect(await callsOf("orca_file_read")).toEqual([]);
      expect(await dirtyMarks()).toBe(0);
    });

    it("keeps a small picture at its own size, and takes the extension in any case", async () => {
      await withImages();
      await mock("orca_file_image", svg(20, 20));
      await waitForCount("#orca-files-tree .orca-file", 3);
      await doublePress("PHOTO.JPG");
      const drawn = await picture();
      expect(drawn.natural).toBe(20);
      expect(drawn.shown).toBe(20);
      expect(await callsOf("orca_file_image")).toEqual([{ path: "/work/example-app", relative: "PHOTO.JPG", environment: null }]);
    });

    it("shows the message of an image that cannot be read, in the tab, with no picture", async () => {
      await withImages();
      await mock("orca_file_image", rejects("画像が大きすぎます（4096 KiB。3072 KiB までに縮められませんでした）"));
      await waitForCount("#orca-files-tree .orca-file", 3);
      await doublePress("logo.png");
      await expect($(".orca-edit .orca-empty")).toHaveText("画像が大きすぎます（4096 KiB。3072 KiB までに縮められませんでした）");
      await expect($(".orca-edit-picture")).not.toBeDisplayed();
      await expect($(CONTENT)).not.toBeDisplayed();
    });

    it("leaves a binary file that is no image to the text read, which refuses it", async () => {
      await withImages();
      await mock("orca_file_image", svg(20, 20));
      await mock("orca_file_read", rejects("バイナリのファイルは開けません"));
      await waitForCount("#orca-files-tree .orca-file", 3);
      await doublePress("data.bin");
      await expect($(".orca-edit .orca-empty")).toHaveText("バイナリのファイルは開けません");
      await expect($(".orca-edit-picture")).not.toBeDisplayed();
      expect(await callsOf("orca_file_image")).toEqual([]);
      expect(await callsOf("orca_file_read")).toEqual([{ path: "/work/example-app", relative: "data.bin", environment: null }]);
    });
  });

  it("saves by itself once the typing has stopped: waiting, saving, saved, and the mark of the tab goes", async () => {
    await openFiles({ editor_settings: { autosaveMs: 500 } });
    await openA();
    await expect(stateText()).toHaveText("");
    const write = await mock("orca_file_write", holds);
    await type("// x\n");
    expect(await dirtyMarks()).toBe(1);
    await expect(stateText()).toHaveText("保存待ち");
    expect(await callsOf(write)).toEqual([]);
    expect(await waitForCalls(write)).toEqual([{ path: "/work/example-app", relative: "a.rs", content: "fn main() {}\n// x\n", crlf: false, signature: "sig-1", environment: null }]);
    await expect(stateText()).toHaveText("保存中");
    expect(await dirtyMarks()).toBe(1);
    await release(write, saved("sig-2"));
    await expect(stateText()).toHaveText("保存しました");
    await browser.waitUntil(async () => (await dirtyMarks()) === 0, { timeoutMsg: "the mark of the tab stayed" });
  });

  it("saves the typing that waits for its timer when the page is hidden for good", async () => {
    await openFiles({ editor_settings: { autosaveMs: 3000 } });
    await openA();
    const write = await mock("orca_file_write", saved("sig-2"));
    await type("// x\n");
    await expect(stateText()).toHaveText("保存待ち");
    expect(await callsOf(write)).toEqual([]);
    await browser.execute((once) => {
      if (!window.__e2e_once__(once)) return;
      window.dispatchEvent(new Event("pagehide"));
    }, onceId());
    expect(await waitForCalls(write)).toEqual([{ path: "/work/example-app", relative: "a.rs", content: "fn main() {}\n// x\n", crlf: false, signature: "sig-1", environment: null }]);
    await expect(stateText()).toHaveText("保存しました");
  });

  it("restarts the wait with each key, and saves the whole text once", async () => {
    await openFiles({ editor_settings: { autosaveMs: 600 } });
    await openA();
    const write = await mock("orca_file_write", saved("sig-2"));
    await type("1");
    await browser.pause(300);
    await type("2");
    await browser.pause(300);
    await type("3");
    expect(await callsOf(write)).toEqual([]);
    const calls = await waitForCalls(write);
    expect((calls[0] as { content: string }).content).toBe("fn main() {}\n123");
    await browser.pause(800);
    expect(await callsOf(write)).toHaveLength(1);
  });

  it("sends the signature of the last save with the next one", async () => {
    await openFiles();
    await openA();
    const write = await mock("orca_file_write", saved("sig-2"));
    await type("a");
    await waitForCalls(write);
    await expect(stateText()).toHaveText("保存しました");
    await mock("orca_file_write", saved("sig-3"));
    await type("b");
    const calls = await waitForCalls("orca_file_write");
    expect(calls).toEqual([{ path: "/work/example-app", relative: "a.rs", content: "fn main() {}\nab", crlf: false, signature: "sig-2", environment: null }]);
  });

  it("sends what was typed while a save was on its way as the next save, once the first is done", async () => {
    await openFiles();
    await openA();
    const write = await mock("orca_file_write", holds);
    await type("a");
    await waitForCalls(write);
    await type("b");
    await release(write, saved("sig-2"));
    await expect(stateText()).not.toHaveText("保存しました");
    await mock("orca_file_write", saved("sig-3"));
    const calls = await waitForCalls("orca_file_write");
    expect(calls).toEqual([{ path: "/work/example-app", relative: "a.rs", content: "fn main() {}\nab", crlf: false, signature: "sig-2", environment: null }]);
    await expect(stateText()).toHaveText("保存しました");
    await browser.waitUntil(async () => (await dirtyMarks()) === 0, { timeoutMsg: "the mark of the tab stayed" });
  });

  it("does not save a file that the disk changed, says so in the heading, keeps the mark, and does not try again", async () => {
    await openFiles();
    await openA();
    const write = await mock("orca_file_write", { state: "changed", signature: "sig-1" } satisfies OrcaSaved);
    await type("a");
    await waitForCalls(write);
    await expect(stateText()).toHaveText("ディスクのファイルが変わっています");
    expect(await dirtyMarks()).toBe(1);
    await type("b");
    await browser.pause(600);
    expect(await callsOf(write)).toHaveLength(1);
    await waitForText("fn main() {}\nab");
    await expect($(CARDS)).not.toExist();
  });

  it("says when the file is gone or is no longer text", async () => {
    await openFiles();
    await openA();
    await mock("orca_file_write", { state: "missing", signature: "sig-1" } satisfies OrcaSaved);
    await type("a");
    await expect(stateText()).toHaveText("ファイルが見つかりません");
    await tabOf(claude).$(".orca-tab-btn").click();
    await mock("orca_file_read", text("x\n", "sig-x"));
    await mock("orca_files_list", dirOf("", [["a.rs", false], ["c.rs", false]]));
    await focusBack();
    await waitForCount("#orca-files-tree .orca-file", 2);
    await doublePress("c.rs");
    await mock("orca_file_write", { state: "not-utf8", signature: "sig-x" } satisfies OrcaSaved);
    await type("b");
    await expect(stateText()).toHaveText("ディスクのファイルが UTF-8 ではなくなっています");
  });

  it("shows the message of a save that failed, and saves again with the next typing", async () => {
    await openFiles();
    await openA();
    await mock("orca_file_write", rejects("Orca に接続できません"));
    await type("a");
    await expect($(CARD)).toHaveText("Orca に接続できません");
    await expect(stateText()).toHaveText("保存できません");
    expect(await dirtyMarks()).toBe(1);
    const again = await mock("orca_file_write", saved("sig-2"));
    await type("b");
    expect(await waitForCalls(again)).toEqual([{ path: "/work/example-app", relative: "a.rs", content: "fn main() {}\nab", crlf: false, signature: "sig-1", environment: null }]);
    await expect(stateText()).toHaveText("保存しました");
  });

  it("saves the typing of a file when its tab is closed, then closes it", async () => {
    await openFiles({ editor_settings: { autosaveMs: 3000 } });
    await openA();
    const write = await mock("orca_file_write", saved("sig-2"));
    await type("a");
    await tabOf("file:1").$(".orca-tab-close").click();
    expect(await waitForCalls(write)).toEqual([{ path: "/work/example-app", relative: "a.rs", content: "fn main() {}\na", crlf: false, signature: "sig-1", environment: null }]);
    await expect(tabOf("file:1")).not.toBeExisting();
    expect(await tabTitles()).toEqual(["Write the docs"]);
    await expect(row("a.rs")).toHaveAttribute("data-open", "false");
    await expect($(".orca-term")).toBeDisplayed();
  });

  it("closes a file with nothing to save without a save", async () => {
    await openFiles();
    await openA();
    const write = await mock("orca_file_write", saved("sig-2"));
    await tabOf("file:1").$(".orca-tab-close").click();
    await expect(tabOf("file:1")).not.toBeExisting();
    expect(await callsOf(write)).toEqual([]);
  });

  it("keeps the tab of a file whose save failed, and closes one whose save was refused", async () => {
    await openFiles({ editor_settings: { autosaveMs: 3000 } });
    await openA();
    await mock("orca_file_write", rejects("Orca に接続できません"));
    await type("a");
    await tabOf("file:1").$(".orca-tab-close").click();
    await expect($(CARD)).toHaveText("Orca に接続できません");
    await expect(tabOf("file:1")).toBeExisting();
    expect(await dirtyMarks()).toBe(1);
    await mock("orca_file_write", { state: "changed", signature: "sig-1" } satisfies OrcaSaved);
    await tabOf("file:1").$(".orca-tab-close").click();
    await expect(tabOf("file:1")).not.toBeExisting();
  });

  it("opens a second file as a second tab, each with its own text", async () => {
    await openFiles({ orca_files_list: dirOf("", [["a.rs", false], ["b.rs", false]]) });
    await openA("fn main() {}\n", "sig-1", 2);
    await mock("orca_file_read", text("pub fn b() {}\n", "sig-b"));
    await doublePress("b.rs");
    await waitForText("pub fn b() {}\n");
    expect(await tabTitles()).toEqual(["Write the docs", "a.rs", "b.rs"]);
    // a.rs comes back into the pane and is read again: the disk still holds the text that was read, so it stays.
    const again = await mock("orca_file_read", text("fn main() {}\n", "sig-1"));
    await tabOf("file:1").$(".orca-tab-btn").click();
    await waitForText("fn main() {}\n");
    expect((await waitForCalls(again))[0]).toEqual({ path: "/work/example-app", relative: "a.rs", environment: null });
  });

  // The right button on a row of the tree, as the page gets it; whether the page kept the browser's own menu from showing.
  const rightClickRow = (path: string) =>
    browser.execute(
      (p, once) => {
        if (!window.__e2e_once__(once)) return false;
        const event = new MouseEvent("contextmenu", { bubbles: true, cancelable: true, button: 2 });
        document.querySelector(`.orca-file[data-path="${p}"]`)!.dispatchEvent(event);
        return event.defaultPrevented;
      },
      path,
      onceId(),
    );

  // Whether the last item of the open menu is 「削除」 and is drawn in the danger color (the variable --danger), unlike the item before it.
  const deleteItemIsRed = () =>
    browser.execute(() => {
      const items = [...document.querySelectorAll<HTMLElement>('.menu[role="menu"] button')];
      const last = items[items.length - 1];
      const danger = getComputedStyle(document.documentElement).getPropertyValue("--danger").trim();
      const probe = document.createElement("span");
      probe.style.color = danger;
      document.body.append(probe);
      const expected = getComputedStyle(probe).color;
      probe.remove();
      return last.textContent === "削除" && danger !== "" && getComputedStyle(last).color === expected && getComputedStyle(items[items.length - 2]).color !== expected;
    });

  it("opens a menu of the two copies, the download, the diff, the move and the delete on the right button of a file, and writes the path and the path from the worktree", async () => {
    await openFiles();
    await waitForCount("#orca-files-tree .orca-file", 4);
    await stubClipboard();
    expect(await rightClickRow("a.rs")).toBe(true);
    await expect($('.menu[role="menu"]')).toBeDisplayed();
    expect(await textsOf('.menu[role="menu"] button')).toEqual(["パスのコピー", "相対パスをコピー", "ダウンロード", "差分を表示", "移動・名前の変更", "削除"]);
    expect(await count('.menu[role="menu"] button svg')).toBe(6);
    expect(await count('.menu[role="menu"] .pdot')).toBe(0);
    // One line, before the move and the delete, which is last and in red.
    expect(await textsOf('.menu[role="menu"] > *')).toEqual(["パスのコピー", "相対パスをコピー", "ダウンロード", "差分を表示", "", "移動・名前の変更", "削除"]);
    expect(await count('.menu[role="menu"] > [role="separator"]')).toBe(1);
    expect(await deleteItemIsRed()).toBe(true);
    await pickItem("パスのコピー");
    await browser.waitUntil(async () => (await copiedTexts()).length === 1, { timeoutMsg: "the path was never copied" });
    await expect($(".toast")).toHaveText(expect.stringContaining("パスをコピーしました"));
    await expect($(".menu")).not.toExist();
    expect(await rightClickRow("a.rs")).toBe(true);
    await pickItem("相対パスをコピー");
    await browser.waitUntil(async () => (await copiedTexts()).length === 2, { timeoutMsg: "the relative path was never copied" });
    expect(await copiedTexts()).toEqual(["/work/example-app/a.rs", "a.rs"]);
  });

  it("opens the same menu on a folder, and on a file in an open folder with its path from the worktree", async () => {
    await openFiles();
    await waitForCount("#orca-files-tree .orca-file", 4);
    await mock("orca_files_list", dirOf("src", [["lib", true], ["main.rs", false]]));
    await row("src").click();
    await waitForCount("#orca-files-tree .orca-file", 6);
    await stubClipboard();
    expect(await rightClickRow("src")).toBe(true);
    expect(await textsOf('.menu[role="menu"] button')).toEqual(["新規ファイル", "新規フォルダー", "パスのコピー", "相対パスをコピー", "移動・名前の変更", "削除"]);
    expect(await count('.menu[role="menu"] button svg')).toBe(6);
    expect(await count('.menu[role="menu"] .pdot')).toBe(0);
    // One line between the two items that make something and the two copies, and one before the move and the delete.
    expect(await textsOf('.menu[role="menu"] > *')).toEqual(["新規ファイル", "新規フォルダー", "", "パスのコピー", "相対パスをコピー", "", "移動・名前の変更", "削除"]);
    expect(await count('.menu[role="menu"] > [role="separator"]')).toBe(2);
    expect(await deleteItemIsRed()).toBe(true);
    await pickItem("パスのコピー");
    await browser.waitUntil(async () => (await copiedTexts()).length === 1, { timeoutMsg: "the path was never copied" });
    expect(await rightClickRow("src/main.rs")).toBe(true);
    await pickItem("相対パスをコピー");
    await browser.waitUntil(async () => (await copiedTexts()).length === 2, { timeoutMsg: "the relative path was never copied" });
    await expect(row("src")).toHaveAttribute("aria-expanded", "true");
    expect(await rightClickRow("src/main.rs")).toBe(true);
    await pickItem("パスのコピー");
    await browser.waitUntil(async () => (await copiedTexts()).length === 3, { timeoutMsg: "the path was never copied" });
    expect(await copiedTexts()).toEqual(["/work/example-app/src", "src/main.rs", "/work/example-app/src/main.rs"]);
  });

  // A-18: a new file or folder. The menu of a folder (and of the empty part of the tree, for the root) asks for a name in a field that is the first row of the folder; Rust checks the name and makes it.
  const treeOrder = () =>
    browser.execute(() => [...document.querySelectorAll("#orca-files-tree > *")].map((e) => (e.classList.contains("orca-file-new") ? "[field]" : ((e as HTMLElement).dataset.path ?? e.className))));
  const fieldFocused = () => browser.execute(() => document.activeElement?.classList.contains("orca-file-input") === true);
  // The field loses the keys inside the window. The window of an E2E run is never the front one, so the document is made to say it has the focus (a loss of the keys without it is the window going to the back, which commits nothing).
  const blurField = () =>
    browser.execute(() => {
      document.hasFocus = () => true;
      (document.activeElement as HTMLElement).blur();
    });
  // The right button on the empty part of the tree, at 20px from its left and half way down (below its four rows, and clear of the window's bottom, which would move the menu), as the page gets it.
  const rightClickEmpty = () =>
    browser.execute(
      (once) => {
        if (!window.__e2e_once__(once)) return null;
        const tree = document.getElementById("orca-files-tree")!;
        const r = tree.getBoundingClientRect();
        const [x, y] = [r.left + 20, r.top + r.height / 2];
        const event = new MouseEvent("contextmenu", { bubbles: true, cancelable: true, button: 2, clientX: x, clientY: y });
        tree.dispatchEvent(event);
        return { prevented: event.defaultPrevented, x, y };
      },
      onceId(),
    );
  // The folder src opened for a new file: the menu, the read of src, and the field as the first row in it.
  async function askNameInSrc(item = "新規ファイル") {
    await openFiles();
    await waitForCount("#orca-files-tree .orca-file", 4);
    const list = await mock("orca_files_list", dirOf("src", [["lib", true], ["main.rs", false]]));
    expect(await rightClickRow("src")).toBe(true);
    await pickItem(item);
    await waitForCalls(list);
    await waitForCount("#orca-files-tree .orca-file", 6);
    return list;
  }

  it("opens the folder with a field for the name as its first row, with the keys in it, when a new file is chosen from the menu of a folder", async () => {
    const list = await askNameInSrc();
    expect(await callsOf(list)).toEqual([{ path: "/work/example-app", dir: "src", ignored: false, environment: null }]);
    await expect(row("src")).toHaveAttribute("aria-expanded", "true");
    expect(await treeOrder()).toEqual(["src", "[field]", "src/lib", "src/main.rs", "target", "a.rs", "b.log"]);
    expect(await fieldFocused()).toBe(true);
    await expect($(".orca-file-input")).toHaveAttribute("aria-label", "新しいファイルの名前");
    expect(await browser.execute(() => document.querySelector<HTMLElement>(".orca-file-new")!.style.getPropertyValue("--depth"))).toBe("1");
    expect(await count(".orca-file-new .orca-file-ic svg")).toBe(1);
    expect(await count(".orca-file-new input[placeholder]")).toBe(0);
    await expect($(".menu")).not.toExist();
  });

  it("makes the file the name is typed for on Enter, with the folder and the trimmed name, reads the folder again and opens the file in the editor", async () => {
    await askNameInSrc();
    const create = await mock("orca_file_create", "src/new.rs");
    const list = await mock("orca_files_list", dirOf("src", [["lib", true], ["main.rs", false], ["new.rs", false]]));
    const read = await mock("orca_file_read", text("fn new() {}\n", "sig-n"));
    await browser.keys(" new.rs ");
    await browser.keys("Enter");
    expect(await waitForCalls(create)).toEqual([{ path: "/work/example-app", dir: "src", name: "new.rs", folder: false, environment: null }]);
    expect(await waitForCalls(list)).toEqual([{ path: "/work/example-app", dir: "src", ignored: false, environment: null }]);
    await waitForCount("#orca-files-tree .orca-file", 7);
    expect(await treeOrder()).toEqual(["src", "src/lib", "src/main.rs", "src/new.rs", "target", "a.rs", "b.log"]);
    expect(await waitForCalls(read)).toEqual([{ path: "/work/example-app", relative: "src/new.rs", environment: null }]);
    await waitForText("fn new() {}\n");
    await expect($(CARDS)).not.toExist();
  });

  it("makes a folder for the name typed after the new folder item, reads the folder again and opens nothing", async () => {
    await askNameInSrc("新規フォルダー");
    await expect($(".orca-file-input")).toHaveAttribute("aria-label", "新しいフォルダーの名前");
    const create = await mock("orca_file_create", "src/gen");
    const list = await mock("orca_files_list", dirOf("src", [["gen", true], ["lib", true], ["main.rs", false]]));
    const read = await mock("orca_file_read", text("x"));
    await browser.keys("gen");
    await browser.keys("Enter");
    expect(await waitForCalls(create)).toEqual([{ path: "/work/example-app", dir: "src", name: "gen", folder: true, environment: null }]);
    await waitForCalls(list);
    await waitForCount("#orca-files-tree .orca-file", 7);
    expect(await treeOrder()).toEqual(["src", "src/gen", "src/lib", "src/main.rs", "target", "a.rs", "b.log"]);
    await browser.pause(300);
    expect(await callsOf(read)).toEqual([]);
    await expect($(CONTENT)).not.toExist();
  });

  it("cancels on Escape and on a blank name, and calls nothing", async () => {
    await askNameInSrc();
    const create = await mock("orca_file_create", "src/x");
    await browser.keys("abc");
    await browser.keys("Escape");
    await waitForCount(".orca-file-new", 0);
    expect(await treeOrder()).toEqual(["src", "src/lib", "src/main.rs", "target", "a.rs", "b.log"]);
    expect(await rightClickRow("src")).toBe(true);
    await pickItem("新規ファイル");
    await waitForCount(".orca-file-new", 1);
    await browser.keys("   ");
    await browser.keys("Enter");
    await waitForCount(".orca-file-new", 0);
    await browser.pause(300);
    expect(await callsOf(create)).toEqual([]);
    await expect($(CARDS)).not.toExist();
  });

  it("makes the file when the field loses the keys after a name was typed, and cancels when it loses them with none typed", async () => {
    await askNameInSrc();
    const create = await mock("orca_file_create", "src/b.rs");
    await mock("orca_file_read", text("b"));
    await mock("orca_files_list", dirOf("src", [["b.rs", false]]));
    await browser.keys("b.rs");
    await blurField();
    expect(await waitForCalls(create)).toEqual([{ path: "/work/example-app", dir: "src", name: "b.rs", folder: false, environment: null }]);
    await waitForCount(".orca-file-new", 0);
    expect(await rightClickRow("src")).toBe(true);
    await pickItem("新規フォルダー");
    await waitForCount(".orca-file-new", 1);
    expect(await fieldFocused()).toBe(true);
    await blurField();
    await waitForCount(".orca-file-new", 0);
    await browser.pause(300);
    expect(await callsOf(create)).toHaveLength(1);
  });

  it("says the name is taken when Orca refuses it, makes nothing and takes the field away", async () => {
    await askNameInSrc();
    const create = await mock("orca_file_create", rejects("同じ名前があります"));
    const list = await mock("orca_files_list", dirOf("src", [["lib", true], ["main.rs", false]]));
    await browser.keys("main.rs");
    await browser.keys("Enter");
    await waitForCalls(create);
    await expect($(CARD)).toHaveText("同じ名前があります");
    await waitForCount(".orca-file-new", 0);
    expect(await treeOrder()).toEqual(["src", "src/lib", "src/main.rs", "target", "a.rs", "b.log"]);
    await browser.pause(300);
    expect(await callsOf(list)).toEqual([]);
    await expect($(CONTENT)).not.toExist();
  });

  it("opens a menu of the new file and the new folder at the pointer on the right button on the empty part of the tree, and asks for the name at the root", async () => {
    await openFiles();
    await waitForCount("#orca-files-tree .orca-file", 4);
    const click = await rightClickEmpty();
    expect(click?.prevented).toBe(true);
    await expect($('.menu[role="menu"]')).toBeDisplayed();
    expect(await textsOf('.menu[role="menu"] button')).toEqual(["新規ファイル", "新規フォルダー"]);
    expect(await count('.menu[role="menu"] [role="separator"]')).toBe(0);
    expect(await count('.menu[role="menu"] button svg')).toBe(2);
    const at = await browser.execute(() => {
      const r = document.querySelector(".menu")!.getBoundingClientRect();
      return { left: Math.round(r.left), top: Math.round(r.top) };
    });
    expect(at).toEqual({ left: Math.round(click!.x), top: Math.round(click!.y) });
    await pickItem("新規ファイル");
    await waitForCount(".orca-file-new", 1);
    expect(await treeOrder()).toEqual(["[field]", "src", "target", "a.rs", "b.log"]);
    expect(await browser.execute(() => document.querySelector<HTMLElement>(".orca-file-new")!.style.getPropertyValue("--depth"))).toBe("0");
    expect(await fieldFocused()).toBe(true);
    const create = await mock("orca_file_create", "top.txt");
    const list = await mock("orca_files_list", dirOf("", [["src", true], ["top.txt", false]]));
    await mock("orca_file_read", text("t"));
    await browser.keys("top.txt");
    await browser.keys("Enter");
    expect(await waitForCalls(create)).toEqual([{ path: "/work/example-app", dir: "", name: "top.txt", folder: false, environment: null }]);
    expect(await waitForCalls(list)).toEqual([{ path: "/work/example-app", dir: "", ignored: false, environment: null }]);
    await waitForCount("#orca-files-tree .orca-file", 2);
  });

  it("makes a folder at the root from the menu of the empty part, and does not open that menu on a row", async () => {
    await openFiles();
    await waitForCount("#orca-files-tree .orca-file", 4);
    expect(await rightClickRow("a.rs")).toBe(true);
    expect(await textsOf('.menu[role="menu"] button')).toEqual(["パスのコピー", "相対パスをコピー", "ダウンロード", "差分を表示", "移動・名前の変更", "削除"]);
    await browser.keys("Escape");
    await expect($(".menu")).not.toExist();
    await rightClickEmpty();
    await pickItem("新規フォルダー");
    await waitForCount(".orca-file-new", 1);
    await expect($(".orca-file-input")).toHaveAttribute("aria-label", "新しいフォルダーの名前");
    const create = await mock("orca_file_create", "docs");
    await mock("orca_files_list", dirOf("", [["docs", true], ["src", true]]));
    await browser.keys("docs");
    await browser.keys("Enter");
    expect(await waitForCalls(create)).toEqual([{ path: "/work/example-app", dir: "", name: "docs", folder: true, environment: null }]);
    await waitForCount("#orca-files-tree .orca-file", 2);
  });

  // A-18: the delete. 「削除」 asks first in a popup of the app, and only its red button deletes, for good.
  const confirmButtons = () => textsOf('.pop[role="alertdialog"] button');
  async function askDelete(path: string) {
    expect(await rightClickRow(path)).toBe(true);
    await pickItem("削除");
    await expect($('.pop[role="alertdialog"]')).toBeDisplayed();
  }
  const pressDelete = () => $('.pop[role="alertdialog"] .text-btn.danger').click();
  // What `orca_files_delete` answers: the entries that are gone ([path, is a folder]), and the message of the one that failed.
  const answered = (gone: [string, boolean][], error: string | null = null): OrcaDeleted => ({ deleted: gone.map(([relative, folder]) => ({ relative, folder })), error });
  const entry = (relative: string, folder = false) => ({ relative, folder });

  it("asks before deleting a file, with its name, a red 「削除」 and 「キャンセル」 that has the keys, and calls nothing until 「削除」 is pressed", async () => {
    await openFiles();
    await waitForCount("#orca-files-tree .orca-file", 4);
    const del = await mock("orca_files_delete", answered([]));
    await askDelete("a.rs");
    await expect($(".menu")).not.toExist();
    await expect($('.pop[role="alertdialog"] p')).toHaveText("a.rs を完全に削除します。元に戻せません。");
    expect(await confirmButtons()).toEqual(["削除", "キャンセル"]);
    expect(await browser.execute(() => document.activeElement?.textContent)).toBe("キャンセル");
    await browser.pause(200);
    expect(await callsOf(del)).toEqual([]);
  });

  it("calls nothing on 「キャンセル」, on Escape and on a press elsewhere", async () => {
    await openFiles();
    await waitForCount("#orca-files-tree .orca-file", 4);
    const del = await mock("orca_files_delete", answered([]));
    await askDelete("a.rs");
    await $('.pop[role="alertdialog"] .text-btn:not(.danger)').click();
    await expect($('.pop[role="alertdialog"]')).not.toExist();
    await askDelete("a.rs");
    await browser.keys("Escape");
    await expect($('.pop[role="alertdialog"]')).not.toExist();
    await askDelete("b.log");
    // WebDriver's element click sends no pointerdown, which is what closes the popup: the page's own press elsewhere.
    await browser.execute(
      (once) => {
        if (!window.__e2e_once__(once)) return;
        document.getElementById("orca-files-bar")!.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true, cancelable: true, button: 0, pointerId: 5, isPrimary: true }));
      },
      onceId(),
    );
    await expect($('.pop[role="alertdialog"]')).not.toExist();
    await browser.pause(200);
    expect(await callsOf(del)).toEqual([]);
    expect(await names()).toEqual(["src", "target", "a.rs", "b.log"]);
  });

  it("deletes a file for good on 「削除」 with the worktree, the path and no recursion, reads its folder again, closes its tab and says nothing", async () => {
    await openFiles();
    await openA();
    await expect($(CONTENT)).toBeDisplayed();
    expect(await tabTitles()).toEqual(["Write the docs", "a.rs"]);
    const del = await mock("orca_files_delete", answered([["a.rs", false]]));
    const list = await mock("orca_files_list", dirOf("", [["src", true], ["target", true], ["b.log", false]]));
    const write = await mock("orca_file_write", saved("sig-2"));
    await askDelete("a.rs");
    await pressDelete();
    expect(await waitForCalls(del)).toEqual([{ path: "/work/example-app", entries: [entry("a.rs")], environment: null }]);
    expect(await waitForCalls(list)).toEqual([{ path: "/work/example-app", dir: "", ignored: false, environment: null }]);
    await waitForCount("#orca-files-tree .orca-file", 3);
    expect(await names()).toEqual(["src", "target", "b.log"]);
    await expect($(CONTENT)).not.toExist();
    expect(await tabTitles()).toEqual(["Write the docs"]);
    await expect($('.pop[role="alertdialog"]')).not.toExist();
    await expect($(CARDS)).not.toExist();
    expect(await callsOf(write)).toEqual([]);
  });

  it("deletes a folder with everything in it (recursive), closes the tabs of the files under it only, and drops what was read of it", async () => {
    await openFiles();
    await mock("orca_files_list", dirOf("src", [["lib", true], ["main.rs", false]]));
    await row("src").click();
    await waitForCount("#orca-files-tree .orca-file", 6);
    await mock("orca_file_read", text("fn main() {}\n", "sig-m"));
    await doublePress("src/main.rs");
    await waitForText("fn main() {}\n");
    await mock("orca_file_read", text("a", "sig-a"));
    await doublePress("a.rs");
    await browser.waitUntil(async () => (await tabTitles()).length === 3, { timeoutMsg: "the second file never opened" });
    expect(await tabTitles()).toEqual(["Write the docs", "main.rs", "a.rs"]);
    const del = await mock("orca_files_delete", answered([["src", true]]));
    const list = await mock("orca_files_list", dirOf("", [["target", true], ["a.rs", false], ["b.log", false]]));
    await askDelete("src");
    await expect($('.pop[role="alertdialog"] p')).toHaveText("src を完全に削除します。元に戻せません。");
    await pressDelete();
    expect(await waitForCalls(del)).toEqual([{ path: "/work/example-app", entries: [entry("src", true)], environment: null }]);
    expect(await waitForCalls(list)).toEqual([{ path: "/work/example-app", dir: "", ignored: false, environment: null }]);
    await waitForCount("#orca-files-tree .orca-file", 3);
    expect(await names()).toEqual(["target", "a.rs", "b.log"]);
    expect(await tabTitles()).toEqual(["Write the docs", "a.rs"]);
    await expect($(CARDS)).not.toExist();
  });

  it("shows the message of a failed delete and changes nothing: the tree and the tab stay", async () => {
    await openFiles();
    await openA();
    const del = await mock("orca_files_delete", answered([], "Orca がエラーを返しました（forbidden）"));
    const list = await mock("orca_files_list", dirOf("", []));
    await askDelete("a.rs");
    await pressDelete();
    await waitForCalls(del);
    await expect($(CARD)).toHaveText("Orca がエラーを返しました（forbidden）");
    await browser.pause(300);
    expect(await callsOf(list)).toEqual([]);
    expect(await names()).toEqual(["src", "target", "a.rs", "b.log"]);
    expect(await tabTitles()).toEqual(["Write the docs", "a.rs"]);
  });

  // A-44: the git writes of the right button. Rust runs them (unit tests); here the screen is checked: the items on a row that differs from HEAD, the commands and their arguments, the confirmation of putting back, and the read again.
  const menuButtons = () => textsOf('.menu[role="menu"] button');
  const markedRoot = () => [change("src", "changed"), change("target", "new"), change("a.rs", "changed"), change("b.log", "new")];
  const git = (extra: Record<string, unknown> = {}) => openFiles({ orca_files_changes: markedRoot(), ...extra });
  const rootArgs = (paths: string[], environment: string | null = null) => ({ path: "/work/example-app", paths, environment });
  const pressedOnce = (label: string) => $(`.pop[role="alertdialog"] .text-btn${label === "元に戻す" ? ".danger" : ":not(.danger)"}`).click();

  it("adds 「ステージ」, 「ステージ解除」 and a red 「変更を元に戻す」 after a line to the menu of a file and of a folder that differ from HEAD (A-44)", async () => {
    await git();
    await waitForCount(".orca-file[data-change]", 4);
    expect(await rightClickRow("a.rs")).toBe(true);
    expect(await menuButtons()).toEqual(["パスのコピー", "相対パスをコピー", "ダウンロード", "差分を表示", "ステージ", "ステージ解除", "変更を元に戻す", "移動・名前の変更", "削除"]);
    expect(await textsOf('.menu[role="menu"] > *')).toEqual(["パスのコピー", "相対パスをコピー", "ダウンロード", "差分を表示", "", "ステージ", "ステージ解除", "変更を元に戻す", "", "移動・名前の変更", "削除"]);
    expect(await count('.menu[role="menu"] button svg')).toBe(9);
    expect(await count('.menu[role="menu"] button.danger')).toBe(2);
    expect(await textsOf('.menu[role="menu"] button.danger')).toEqual(["変更を元に戻す", "削除"]);
    expect(await deleteItemIsRed()).toBe(true);
    await browser.keys("Escape");
    expect(await rightClickRow("src")).toBe(true);
    expect(await menuButtons()).toEqual(["新規ファイル", "新規フォルダー", "パスのコピー", "相対パスをコピー", "ステージ", "ステージ解除", "変更を元に戻す", "移動・名前の変更", "削除"]);
    expect(await textsOf('.menu[role="menu"] > *')).toEqual(["新規ファイル", "新規フォルダー", "", "パスのコピー", "相対パスをコピー", "", "ステージ", "ステージ解除", "変更を元に戻す", "", "移動・名前の変更", "削除"]);
    expect(await count('.menu[role="menu"] button svg')).toBe(9);
    expect(await deleteItemIsRed()).toBe(true);
  });

  it("keeps the menu as it was on a row that does not differ from HEAD, and while git has not answered (A-44)", async () => {
    await openFiles({ orca_files_changes: [change("a.rs", "changed")] });
    await waitForCount(".orca-file[data-change]", 1);
    expect(await rightClickRow("b.log")).toBe(true);
    expect(await menuButtons()).toEqual(["パスのコピー", "相対パスをコピー", "ダウンロード", "差分を表示", "移動・名前の変更", "削除"]);
    await browser.keys("Escape");
    expect(await rightClickRow("target")).toBe(true);
    expect(await menuButtons()).toEqual(["新規ファイル", "新規フォルダー", "パスのコピー", "相対パスをコピー", "移動・名前の変更", "削除"]);
  });

  it("keeps several selected rows to the 「n 件を削除」 alone, whatever they differ in (A-44)", async () => {
    await git();
    await waitForCount(".orca-file[data-change]", 4);
    await row("a.rs").click();
    await press("b.log", { metaKey: true });
    expect(await rightClickRow("b.log")).toBe(true);
    expect(await menuButtons()).toEqual(["2 件を削除"]);
  });

  it("stages a file on 「ステージ」 with no question, and reads the files and their marks again (A-44)", async () => {
    await git();
    await waitForCount(".orca-file[data-change]", 4);
    const stage = await mock("orca_files_stage", null);
    const list = await mock("orca_files_list", root());
    const marks = await mock("orca_files_changes", [change("src", "changed"), change("target", "new"), change("b.log", "new")]);
    expect(await rightClickRow("a.rs")).toBe(true);
    await pickItem("ステージ");
    await expect($(".menu")).not.toExist();
    expect(await waitForCalls(stage)).toEqual([rootArgs(["a.rs"])]);
    expect(await waitForCalls(list)).toEqual([{ path: "/work/example-app", dir: "", ignored: false, environment: null }]);
    expect(await waitForCalls(marks)).toEqual([rootArgs(["src", "target", "a.rs", "b.log"])]);
    await waitForCount(".orca-file[data-change]", 3);
    expect((await gitLook("a.rs")).change).toBeNull();
    await expect($('.pop[role="alertdialog"]')).not.toExist();
    await expect($(CARDS)).not.toExist();
  });

  it("unstages a folder on 「ステージ解除」 with its path, calls neither of the other two, and reads again (A-44)", async () => {
    await git();
    await waitForCount(".orca-file[data-change]", 4);
    const unstage = await mock("orca_files_unstage", null);
    const stage = await mock("orca_files_stage", null);
    const revert = await mock("orca_files_revert", null);
    const list = await mock("orca_files_list", root());
    expect(await rightClickRow("src")).toBe(true);
    await pickItem("ステージ解除");
    expect(await waitForCalls(unstage)).toEqual([rootArgs(["src"])]);
    await waitForCalls(list);
    await browser.pause(200);
    expect(await callsOf(stage)).toEqual([]);
    expect(await callsOf(revert)).toEqual([]);
    await expect($('.pop[role="alertdialog"]')).not.toExist();
  });

  it("sends the path from the worktree of a file in an open folder, and the name of a saved environment (A-44)", async () => {
    await openOrca(orcaOverview(sample(), worktrees(), studio), { orca_terminal_read: ["$"], orca_files_list: root(), orca_files_ignored: rootIgnored, orca_files_changes: [change("src", "changed")] });
    await project("example-app").click();
    await filesToggle().click();
    await waitForCount("#orca-files-tree .orca-file", 4);
    await mock("orca_files_list", dirOf("src", [["main.rs", false]]));
    await mock("orca_files_changes", [change("src", "changed"), change("src/main.rs", "changed")]);
    await row("src").click();
    await waitForCount("#orca-files-tree .orca-file", 5);
    await waitForCount(".orca-file[data-change]", 2);
    const stage = await mock("orca_files_stage", null);
    expect(await rightClickRow("src/main.rs")).toBe(true);
    await pickItem("ステージ");
    expect(await waitForCalls(stage)).toEqual([rootArgs(["src/main.rs"], "Studio")]);
  });

  it("asks before putting back, with the words of what is lost, 「キャンセル」 that has the keys, and calls nothing until 「元に戻す」 is pressed (A-44)", async () => {
    await git();
    await waitForCount(".orca-file[data-change]", 4);
    const revert = await mock("orca_files_revert", null);
    const asked = async (path: string, words: string) => {
      expect(await rightClickRow(path)).toBe(true);
      await pickItem("変更を元に戻す");
      await expect($(".menu")).not.toExist();
      await expect($('.pop[role="alertdialog"]')).toBeDisplayed();
      await expect($('.pop[role="alertdialog"] p')).toHaveText(words);
      expect(await textsOf('.pop[role="alertdialog"] button')).toEqual(["元に戻す", "キャンセル"]);
      expect(await browser.execute(() => document.activeElement?.textContent)).toBe("キャンセル");
      expect(await textsOf('.pop[role="alertdialog"] h3')).toEqual(["変更を元に戻しますか？"]);
    };
    // A file that is changed is put back, a new one is deleted, and the words of a folder say that it may hold new files unless all of them are.
    await asked("a.rs", "a.rs の変更を捨てて、HEAD の状態に戻します。元に戻せません。");
    await pressedOnce("キャンセル");
    await expect($('.pop[role="alertdialog"]')).not.toExist();
    await asked("b.log", "b.log は新しいファイルです。元に戻すと完全に削除します。元に戻せません。");
    await browser.keys("Escape");
    await expect($('.pop[role="alertdialog"]')).not.toExist();
    await asked("src", "src の中の変更をすべて捨てて、HEAD の状態に戻します。新しいファイルは完全に削除します。元に戻せません。");
    await pressedOnce("キャンセル");
    await asked("target", "target の中の変更は、すべて新しいファイルです。元に戻すと完全に削除します。元に戻せません。");
    // A press elsewhere (the page's own, as WebDriver's click sends none).
    await browser.execute(
      (once) => {
        if (!window.__e2e_once__(once)) return;
        document.getElementById("orca-files-bar")!.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true, cancelable: true, button: 0, pointerId: 5, isPrimary: true }));
      },
      onceId(),
    );
    await expect($('.pop[role="alertdialog"]')).not.toExist();
    await browser.pause(200);
    expect(await callsOf(revert)).toEqual([]);
    expect(await names()).toEqual(["src", "target", "a.rs", "b.log"]);
  });

  it("puts back on 「元に戻す」 with the worktree and the path, then reads the files and their marks again: a new file that was put back is gone (A-44)", async () => {
    await git();
    await waitForCount(".orca-file[data-change]", 4);
    const revert = await mock("orca_files_revert", null);
    const list = await mock("orca_files_list", dirOf("", [["src", true], ["target", true], ["a.rs", false]]));
    const marks = await mock("orca_files_changes", [change("src", "changed"), change("target", "new"), change("a.rs", "changed")]);
    expect(await rightClickRow("b.log")).toBe(true);
    await pickItem("変更を元に戻す");
    await pressedOnce("元に戻す");
    expect(await waitForCalls(revert)).toEqual([rootArgs(["b.log"])]);
    expect(await waitForCalls(list)).toEqual([{ path: "/work/example-app", dir: "", ignored: false, environment: null }]);
    expect(await waitForCalls(marks)).toEqual([rootArgs(["src", "target", "a.rs"])]);
    await waitForCount("#orca-files-tree .orca-file", 3);
    expect(await names()).toEqual(["src", "target", "a.rs"]);
    await expect($('.pop[role="alertdialog"]')).not.toExist();
    await expect($(CARDS)).not.toExist();
    // A folder goes in one call with its own path.
    const second = await mock("orca_files_revert", null);
    expect(await rightClickRow("src")).toBe(true);
    await pickItem("変更を元に戻す");
    await pressedOnce("元に戻す");
    expect(await waitForCalls(second)).toEqual([rootArgs(["src"])]);
  });

  it("shows Orca's message when a write is refused, and reads the files again all the same (A-44)", async () => {
    await git();
    await waitForCount(".orca-file[data-change]", 4);
    const stage = await mock("orca_files_stage", rejects("Orca がエラーを返しました（locked）"));
    const list = await mock("orca_files_list", root());
    expect(await rightClickRow("a.rs")).toBe(true);
    await pickItem("ステージ");
    await waitForCalls(stage);
    await expect($(CARD)).toHaveText("Orca がエラーを返しました（locked）");
    await waitForCalls(list);
    const revert = await mock("orca_files_revert", rejects("Orca がエラーを返しました（merge）"));
    expect(await rightClickRow("a.rs")).toBe(true);
    await pickItem("変更を元に戻す");
    await pressedOnce("元に戻す");
    await waitForCalls(revert);
    // A card stays until it is closed (A-28), so the card of the first refusal is still under the new one.
    expect(await textsOf(CARD)).toEqual(["Orca がエラーを返しました（merge）", "Orca がエラーを返しました（locked）"]);
    expect(await names()).toEqual(["src", "target", "a.rs", "b.log"]);
  });

  // A-18: the selection. A press on a row selects it (⌘ adds it or takes it off, Shift selects from the row pressed before), the selected rows are drawn in the accent color, and the delete takes all of them.
  // A press as the page gets it, with ⌘ or Shift held (the WebDriver click holds none).
  const press = (path: string, keys: { metaKey?: boolean; shiftKey?: boolean } = {}) =>
    browser.execute(
      (p, held, once) => {
        if (!window.__e2e_once__(once)) return;
        document.querySelector(`.orca-file[data-path="${p}"]`)!.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true, ...held }));
      },
      path,
      keys,
      onceId(),
    );
  const selectedPaths = () => browser.execute(() => [...document.querySelectorAll<HTMLElement>('.orca-file[data-selected="true"]')].map((e) => e.dataset.path));
  // The color a CSS variable draws as (the variable --accent as a `color`, which is how the computed style reads it).
  const colorOf = (variable: string) =>
    browser.execute((name) => {
      const probe = document.createElement("span");
      probe.style.color = `var(${name})`;
      document.body.append(probe);
      const color = getComputedStyle(probe).color;
      probe.remove();
      return color;
    }, variable);
  const look = (path: string) =>
    browser.execute((p) => {
      const node = document.querySelector(`.orca-file[data-path="${p}"]`)!;
      return { background: getComputedStyle(node).backgroundColor, color: getComputedStyle(node).color, icon: getComputedStyle(node.querySelector(".orca-file-ic")!).color };
    }, path);
  const menuTexts = () => textsOf('.menu[role="menu"] button');
  const itemColors = () => browser.execute(() => [...document.querySelectorAll<HTMLElement>('.menu[role="menu"] button')].map((b) => getComputedStyle(b).color));

  it("selects a file on a single press and draws it in the accent color with white text, and the rows that are not selected are not", async () => {
    await openFiles();
    await waitForCount("#orca-files-tree .orca-file", 4);
    expect(await selectedPaths()).toEqual([]);
    const [accent, onAccent] = [await colorOf("--accent"), await colorOf("--on-accent")];
    await row("a.rs").click();
    expect(await selectedPaths()).toEqual(["a.rs"]);
    expect(await look("a.rs")).toEqual({ background: accent, color: onAccent, icon: onAccent });
    expect((await look("b.log")).background).not.toBe(accent);
    // A press on another row moves the selection, and nothing is read or opened by a single press.
    await row("b.log").click();
    expect(await selectedPaths()).toEqual(["b.log"]);
    await expect($(CONTENT)).not.toExist();
  });

  it("adds a row to the selection and takes it off with ⌘, and selects from the row pressed before to this one with Shift", async () => {
    await openFiles();
    await waitForCount("#orca-files-tree .orca-file", 4);
    await row("a.rs").click();
    await press("b.log", { metaKey: true });
    expect(await selectedPaths()).toEqual(["a.rs", "b.log"]);
    await press("a.rs", { metaKey: true });
    expect(await selectedPaths()).toEqual(["b.log"]);
    // ⌘ on a folder selects it without opening it.
    await press("src", { metaKey: true });
    expect(await selectedPaths()).toEqual(["src", "b.log"]);
    await expect(row("src")).toHaveAttribute("aria-expanded", "false");
    // Shift counts from the row pressed last without Shift: here the folder, down to b.log.
    await press("b.log", { shiftKey: true });
    expect(await selectedPaths()).toEqual(["src", "target", "a.rs", "b.log"]);
    await press("target", { shiftKey: true });
    expect(await selectedPaths()).toEqual(["src", "target"]);
    // A press with neither key selects that row alone.
    await row("a.rs").click();
    expect(await selectedPaths()).toEqual(["a.rs"]);
  });

  it("selects a folder on a press and opens it as before, but only selects it with ⌘ or Shift", async () => {
    await openFiles();
    await waitForCount("#orca-files-tree .orca-file", 4);
    await mock("orca_files_list", dirOf("src", [["lib", true], ["main.rs", false]]));
    await row("src").click();
    await expect(row("src")).toHaveAttribute("aria-expanded", "true");
    expect(await selectedPaths()).toEqual(["src"]);
    await waitForCount("#orca-files-tree .orca-file", 6);
    // A range can run through the rows of an open folder.
    await press("target", { shiftKey: true });
    expect(await selectedPaths()).toEqual(["src", "src/lib", "src/main.rs", "target"]);
    await expect(row("src")).toHaveAttribute("aria-expanded", "true");
    // Closing the folder leaves the rows under it out of the selection.
    await row("src").click();
    await expect(row("src")).toHaveAttribute("aria-expanded", "false");
    expect(await selectedPaths()).toEqual(["src"]);
  });

  it("opens a file on a double press as before, whatever is selected", async () => {
    await openFiles();
    await waitForCount("#orca-files-tree .orca-file", 4);
    await row("b.log").click();
    await openA();
    expect(await tabTitles()).toEqual(["Write the docs", "a.rs"]);
  });

  it("selects a row on the right button when it is not selected, and keeps the selection when it is; several selected rows have the red 「n 件を削除」 alone in the menu", async () => {
    await openFiles();
    await waitForCount("#orca-files-tree .orca-file", 4);
    await row("a.rs").click();
    await press("b.log", { metaKey: true });
    expect(await rightClickRow("b.log")).toBe(true);
    expect(await menuTexts()).toEqual(["2 件を削除"]);
    expect(await selectedPaths()).toEqual(["a.rs", "b.log"]);
    expect(await itemColors()).toEqual([await colorOf("--danger")]);
    await browser.keys("Escape");
    await expect($(".menu")).not.toExist();
    // A row that is not selected takes the selection from the others, and its menu is the usual one.
    expect(await rightClickRow("target")).toBe(true);
    expect(await selectedPaths()).toEqual(["target"]);
    expect(await menuTexts()).toEqual(["新規ファイル", "新規フォルダー", "パスのコピー", "相対パスをコピー", "移動・名前の変更", "削除"]);
  });

  it("asks once for the rows that are selected with their count, calls nothing until 「削除」, and sends them all in one call", async () => {
    await openFiles();
    await openA();
    const del = await mock("orca_files_delete", answered([["a.rs", false], ["b.log", false]]));
    const list = await mock("orca_files_list", dirOf("", [["src", true], ["target", true]]));
    await row("a.rs").click();
    await press("b.log", { metaKey: true });
    expect(await rightClickRow("b.log")).toBe(true);
    await pickItem("2 件を削除");
    await expect($(".menu")).not.toExist();
    await expect($('.pop[role="alertdialog"] p')).toHaveText("2 件を完全に削除します。元に戻せません。");
    expect(await confirmButtons()).toEqual(["削除", "キャンセル"]);
    expect(await browser.execute(() => document.activeElement?.textContent)).toBe("キャンセル");
    // 「キャンセル」 deletes nothing and keeps the selection.
    await $('.pop[role="alertdialog"] .text-btn:not(.danger)').click();
    await expect($('.pop[role="alertdialog"]')).not.toExist();
    await browser.pause(200);
    expect(await callsOf(del)).toEqual([]);
    expect(await selectedPaths()).toEqual(["a.rs", "b.log"]);
    expect(await rightClickRow("a.rs")).toBe(true);
    await pickItem("2 件を削除");
    await pressDelete();
    expect(await waitForCalls(del)).toEqual([{ path: "/work/example-app", entries: [entry("a.rs"), entry("b.log")], environment: null }]);
    expect(await waitForCalls(list)).toEqual([{ path: "/work/example-app", dir: "", ignored: false, environment: null }]);
    await waitForCount("#orca-files-tree .orca-file", 2);
    expect(await names()).toEqual(["src", "target"]);
    expect(await selectedPaths()).toEqual([]);
    // The tab of a deleted file closes, and nothing is said.
    expect(await tabTitles()).toEqual(["Write the docs"]);
    await expect($(CARDS)).not.toExist();
  });

  it("asks to delete the selected rows on the Delete key, and on the key that is called delete on a Mac, with the name of the row when it is one and the count when there are more", async () => {
    await openFiles();
    await waitForCount("#orca-files-tree .orca-file", 4);
    const del = await mock("orca_files_delete", answered([["a.rs", false]]));
    await mock("orca_files_list", dirOf("", [["src", true], ["target", true], ["b.log", false]]));
    // Nothing selected: the key does nothing.
    await browser.keys("Delete");
    await expect($('.pop[role="alertdialog"]')).not.toExist();
    await row("a.rs").click();
    await browser.keys("Delete");
    await expect($('.pop[role="alertdialog"] p')).toHaveText("a.rs を完全に削除します。元に戻せません。");
    await browser.keys("Escape");
    await expect($('.pop[role="alertdialog"]')).not.toExist();
    await press("b.log", { metaKey: true });
    await browser.keys("Backspace");
    await expect($('.pop[role="alertdialog"] p')).toHaveText("2 件を完全に削除します。元に戻せません。");
    await browser.pause(200);
    expect(await callsOf(del)).toEqual([]);
    await pressDelete();
    expect(await waitForCalls(del)).toEqual([{ path: "/work/example-app", entries: [entry("a.rs"), entry("b.log")], environment: null }]);
  });

  it("does not ask on the Delete key while a field of the tree has the keys", async () => {
    await openFiles();
    await waitForCount("#orca-files-tree .orca-file", 4);
    await row("a.rs").click();
    await rightClickEmpty();
    await pickItem("新規ファイル");
    await waitForCount(".orca-file-new", 1);
    await browser.keys("Delete");
    await browser.keys("Backspace");
    await expect($('.pop[role="alertdialog"]')).not.toExist();
  });

  it("sends a folder and the rows under it that are selected together, and draws what the answer says is gone: the folder alone", async () => {
    await openFiles();
    await mock("orca_files_list", dirOf("src", [["lib", true], ["main.rs", false]]));
    await row("src").click();
    await waitForCount("#orca-files-tree .orca-file", 6);
    const del = await mock("orca_files_delete", answered([["src", true]]));
    const list = await mock("orca_files_list", dirOf("", [["target", true], ["a.rs", false], ["b.log", false]]));
    await press("src/main.rs", { metaKey: true });
    expect(await selectedPaths()).toEqual(["src", "src/main.rs"]);
    await browser.keys("Delete");
    await expect($('.pop[role="alertdialog"] p')).toHaveText("2 件を完全に削除します。元に戻せません。");
    await pressDelete();
    expect(await waitForCalls(del)).toEqual([{ path: "/work/example-app", entries: [entry("src", true), entry("src/main.rs")], environment: null }]);
    // The folders the gone entries were in: the root, once.
    expect(await waitForCalls(list)).toEqual([{ path: "/work/example-app", dir: "", ignored: false, environment: null }]);
    await waitForCount("#orca-files-tree .orca-file", 3);
    expect(await names()).toEqual(["target", "a.rs", "b.log"]);
    expect(await selectedPaths()).toEqual([]);
  });

  it("reads each folder the deleted rows were in once, side by side, and shows the message of the entry that failed", async () => {
    await openFiles();
    await mock("orca_files_list", dirOf("src", [["lib", true], ["main.rs", false]]));
    await row("src").click();
    await waitForCount("#orca-files-tree .orca-file", 6);
    const del = await mock("orca_files_delete", answered([["src/main.rs", false], ["a.rs", false]], "Orca がエラーを返しました（forbidden）"));
    const list = await mock("orca_files_list", dirOf("src", [["lib", true]]));
    // The press that opened the folder selected it: ⌘ takes it off.
    await press("src", { metaKey: true });
    await press("src/main.rs", { metaKey: true });
    await press("a.rs", { metaKey: true });
    await press("b.log", { metaKey: true });
    expect(await selectedPaths()).toEqual(["src/main.rs", "a.rs", "b.log"]);
    await browser.keys("Delete");
    await pressDelete();
    expect(await waitForCalls(del)).toEqual([{ path: "/work/example-app", entries: [entry("src/main.rs"), entry("a.rs"), entry("b.log")], environment: null }]);
    await expect($(CARD)).toHaveText("Orca がエラーを返しました（forbidden）");
    const asked = (await waitForCalls(list, 2)) as { dir: string }[];
    expect(asked.map((c) => c.dir).sort()).toEqual(["", "src"]);
  });

  it("shows the message of a delete that Rust refused, and changes nothing: the selection and the tree stay", async () => {
    await openFiles();
    await waitForCount("#orca-files-tree .orca-file", 4);
    const del = await mock("orca_files_delete", rejects("ファイルの場所が正しくありません"));
    const list = await mock("orca_files_list", dirOf("", []));
    await row("a.rs").click();
    await press("b.log", { metaKey: true });
    await browser.keys("Delete");
    await pressDelete();
    await waitForCalls(del);
    await expect($(CARD)).toHaveText("ファイルの場所が正しくありません");
    await browser.pause(300);
    expect(await callsOf(list)).toEqual([]);
    expect(await names()).toEqual(["src", "target", "a.rs", "b.log"]);
    expect(await selectedPaths()).toEqual(["a.rs", "b.log"]);
  });

  // A-18: the move. 「移動・名前の変更」 turns the row into a field with its path from the worktree, and a row is dragged onto a folder or onto the empty part of the tree; Rust moves it.
  const HERE = "/work/example-app";
  async function askMove(path: string) {
    expect(await rightClickRow(path)).toBe(true);
    await pickItem("移動・名前の変更");
    await waitForCount(".orca-file-new", 1);
  }
  // The field of the path: its text, what is selected in it, its label and its placeholder.
  const moveField = () =>
    browser.execute(() => {
      const input = document.querySelector<HTMLInputElement>("#orca-files-tree .orca-file-input")!;
      return { value: input.value, selected: [input.selectionStart, input.selectionEnd], label: input.getAttribute("aria-label"), placeholder: input.placeholder, focused: document.activeElement === input };
    });
  // Types `value` as the whole text of the field (value, then input).
  const setField = (value: string) =>
    browser.execute(
      (v, once) => {
        if (!window.__e2e_once__(once)) return;
        const input = document.querySelector<HTMLInputElement>("#orca-files-tree .orca-file-input")!;
        input.value = v;
        input.dispatchEvent(new Event("input", { bubbles: true }));
      },
      value,
      onceId(),
    );
  // The pointer on the tree, as the page gets it (the tree listens for pointer events): for each step its kind and where it is, the row of a path (the press at its middle, a move or a release at four fifths of its width) or "empty", the part of the tree under its rows. The press goes to the row, the rest to the document.
  const pointer = (steps: ["pointerdown" | "pointermove" | "pointerup", string][]) =>
    browser.execute(
      (list, once) => {
        if (!window.__e2e_once__(once)) return;
        for (const [type, where] of list) {
          const tree = document.getElementById("orca-files-tree")!.getBoundingClientRect();
          const target = where === "empty" ? null : document.querySelector(`.orca-file[data-path="${where}"]`)!;
          const r = target?.getBoundingClientRect();
          const [x, y] = r ? [r.left + r.width * (type === "pointerdown" ? 0.5 : 0.8), r.top + r.height / 2] : [tree.left + 20, tree.bottom - 12];
          (type === "pointerdown" ? target! : document).dispatchEvent(new PointerEvent(type, { bubbles: true, cancelable: true, clientX: x, clientY: y, button: 0, buttons: type === "pointerup" ? 0 : 1, pointerId: 4, isPrimary: true }));
        }
      },
      steps,
      onceId(),
    );
  const dragRow = (from: string, to: string) =>
    pointer([
      ["pointerdown", from],
      ["pointermove", to],
      ["pointerup", to],
    ]);
  const dropMark = (path: string) => browser.execute((p) => (p === "" ? document.getElementById("orca-files-tree")! : document.querySelector<HTMLElement>(`.orca-file[data-path="${p}"]`)!).dataset.drop ?? null, path);
  async function openSrc() {
    await openFiles();
    await waitForCount("#orca-files-tree .orca-file", 4);
    await mock("orca_files_list", dirOf("src", [["lib", true], ["main.rs", false]]));
    await row("src").click();
    await waitForCount("#orca-files-tree .orca-file", 6);
  }

  it("turns the row into a field with its path from the worktree, the keys in it and the name selected, when the move is chosen from the menu", async () => {
    await openSrc();
    await askMove("src/main.rs");
    expect(await treeOrder()).toEqual(["src", "src/lib", "[field]", "target", "a.rs", "b.log"]);
    // The name without its extension is selected: `main` of `src/main.rs`.
    expect(await moveField()).toEqual({ value: "src/main.rs", selected: [4, 8], label: "移動先のパス", placeholder: "", focused: true });
    await browser.keys("Escape");
    await waitForCount(".orca-file-new", 0);
    // A folder's name is selected whole, and the folder stays open under the field.
    await askMove("src");
    expect(await treeOrder()).toEqual(["[field]", "src/lib", "src/main.rs", "target", "a.rs", "b.log"]);
    expect(await moveField()).toEqual({ value: "src", selected: [0, 3], label: "移動先のパス", placeholder: "", focused: true });
  });

  it("moves the entry to the path typed on Enter, with the worktree and both paths, and reads its folder again", async () => {
    await openSrc();
    const move = await mock("orca_file_move", null);
    const list = await mock("orca_files_list", dirOf("src", [["lib", true], ["renamed.rs", false]]));
    await askMove("src/main.rs");
    // The keys replace the selected name.
    await browser.keys("renamed");
    await browser.keys("Enter");
    expect(await waitForCalls(move)).toEqual([{ path: HERE, from: "src/main.rs", to: "src/renamed.rs", environment: null }]);
    expect(await waitForCalls(list)).toEqual([{ path: HERE, dir: "src", ignored: false, environment: null }]);
    await waitForCount(".orca-file-new", 0);
    await browser.waitUntil(async () => (await names()).includes("renamed.rs"), { timeoutMsg: "the folder was never drawn again" });
    expect(await treeOrder()).toEqual(["src", "src/lib", "src/renamed.rs", "target", "a.rs", "b.log"]);
    await expect($(CARDS)).not.toExist();
    await browser.pause(200);
    expect(await callsOf(list)).toHaveLength(1);
  });

  it("sends the trimmed path of another folder, and reads the folder it left and the nearest folder read of the one it went to", async () => {
    await openSrc();
    const move = await mock("orca_file_move", null);
    const list = await mock("orca_files_list", dirOf("src", [["lib", true], ["main.rs", false]]));
    await askMove("a.rs");
    await setField("  src/new/deep/a.rs ");
    await browser.keys("Enter");
    expect(await waitForCalls(move)).toEqual([{ path: HERE, from: "a.rs", to: "src/new/deep/a.rs", environment: null }]);
    // src/new and src/new/deep were never read: src is the nearest folder that was.
    expect((await waitForCalls(list, 2)).map((c) => (c as { dir: string }).dir)).toEqual(["", "src"]);
    await waitForCount(".orca-file-new", 0);
  });

  it("cancels the move on Escape, on a blank path, on the same path and when the field loses the keys unchanged, and calls nothing", async () => {
    await openFiles();
    await waitForCount("#orca-files-tree .orca-file", 4);
    const move = await mock("orca_file_move", null);
    await askMove("a.rs");
    await setField("c.rs");
    await browser.keys("Escape");
    await waitForCount(".orca-file-new", 0);
    await askMove("a.rs");
    await setField("   ");
    await browser.keys("Enter");
    await waitForCount(".orca-file-new", 0);
    await askMove("a.rs");
    await browser.keys("Enter");
    await waitForCount(".orca-file-new", 0);
    await askMove("a.rs");
    await blurField();
    await waitForCount(".orca-file-new", 0);
    await browser.pause(300);
    expect(await callsOf(move)).toEqual([]);
    expect(await names()).toEqual(["src", "target", "a.rs", "b.log"]);
  });

  it("moves when the field loses the keys after another path was typed", async () => {
    await openFiles();
    await waitForCount("#orca-files-tree .orca-file", 4);
    const move = await mock("orca_file_move", null);
    await askMove("a.rs");
    await setField("c.rs");
    await blurField();
    expect(await waitForCalls(move)).toEqual([{ path: HERE, from: "a.rs", to: "c.rs", environment: null }]);
    await waitForCount(".orca-file-new", 0);
  });

  it("keeps the field and moves nothing when it loses the keys because the window went to the back", async () => {
    await openFiles();
    await waitForCount("#orca-files-tree .orca-file", 4);
    const move = await mock("orca_file_move", null);
    await askMove("a.rs");
    await setField("c.rs");
    // The window is not the front one: the document says it has no focus.
    await browser.execute(() => {
      document.hasFocus = () => false;
      (document.activeElement as HTMLElement).blur();
    });
    await browser.pause(300);
    expect(await callsOf(move)).toEqual([]);
    await waitForCount(".orca-file-new", 1);
    expect((await moveField()).value).toBe("c.rs");
    await browser.execute(() => {
      delete (document as { hasFocus?: unknown }).hasFocus;
    });
  });

  it("keeps the field and asks nothing on Enter while a move by a drag is on its way, and moves on Enter after it", async () => {
    await openFiles();
    await waitForCount("#orca-files-tree .orca-file", 4);
    const move = await mock("orca_file_move", holds);
    await mock("orca_files_list", dirOf("", [["src", true], ["target", true], ["a.rs", false]]));
    await dragRow("b.log", "src");
    await waitForCalls(move);
    await askMove("a.rs");
    await setField("c.rs");
    await browser.keys("Enter");
    await browser.pause(300);
    expect(await callsOf(move)).toHaveLength(1);
    await waitForCount(".orca-file-new", 1);
    await release(move, null);
    await waitForCount("#orca-files-tree .orca-file", 2);
    expect((await moveField()).value).toBe("c.rs");
    await browser.keys("Enter");
    expect((await waitForCalls(move, 2))[1]).toEqual({ path: HERE, from: "a.rs", to: "c.rs", environment: null });
    await release(move, null);
    await waitForCount(".orca-file-new", 0);
  });

  it("says the name is taken when Orca refuses the place, moves nothing and takes the field away", async () => {
    await openFiles();
    await waitForCount("#orca-files-tree .orca-file", 4);
    const move = await mock("orca_file_move", rejects("同じ名前があります"));
    const list = await mock("orca_files_list", dirOf("", []));
    await askMove("a.rs");
    await setField("b.log");
    await browser.keys("Enter");
    await waitForCalls(move);
    await expect($(CARD)).toHaveText("同じ名前があります");
    await waitForCount(".orca-file-new", 0);
    await browser.pause(300);
    expect(await callsOf(list)).toEqual([]);
    expect(await names()).toEqual(["src", "target", "a.rs", "b.log"]);
  });

  it("moves a row dragged onto a folder into it, and reads the folder it left again", async () => {
    await openFiles();
    await waitForCount("#orca-files-tree .orca-file", 4);
    const move = await mock("orca_file_move", null);
    const list = await mock("orca_files_list", dirOf("", [["src", true], ["target", true], ["b.log", false]]));
    await dragRow("a.rs", "src");
    expect(await waitForCalls(move)).toEqual([{ path: HERE, from: "a.rs", to: "src/a.rs", environment: null }]);
    // src is closed and was never read, so the root is what is read.
    expect(await waitForCalls(list)).toEqual([{ path: HERE, dir: "", ignored: false, environment: null }]);
    await waitForCount("#orca-files-tree .orca-file", 3);
    expect(await names()).toEqual(["src", "target", "b.log"]);
    // The press that ended the drag opened no folder, and nothing of the drag is left.
    await expect(row("src")).toHaveAttribute("aria-expanded", "false");
    await expect($(".orca-file-drag")).not.toExist();
    expect(await dropMark("src")).toBeNull();
    await expect($(CARDS)).not.toExist();
  });

  it("marks the folder under a dragged row, shows the name at the pointer, and opens a closed folder the pointer rests on", async () => {
    await openFiles();
    await waitForCount("#orca-files-tree .orca-file", 4);
    const move = await mock("orca_file_move", null);
    const list = await mock("orca_files_list", dirOf("src", [["lib", true], ["main.rs", false]]));
    await pointer([
      ["pointerdown", "a.rs"],
      ["pointermove", "src"],
    ]);
    await expect($(".orca-file-drag")).toHaveText("a.rs");
    expect(await dropMark("src")).toBe("true");
    expect(await dropMark("target")).toBeNull();
    expect(await dropMark("")).toBeNull();
    // The pointer rests on src, which is closed: it opens, and is still the place of the drop.
    expect(await waitForCalls(list)).toEqual([{ path: HERE, dir: "src", ignored: false, environment: null }]);
    await expect(row("src")).toHaveAttribute("aria-expanded", "true");
    await waitForCount("#orca-files-tree .orca-file", 6);
    expect(await dropMark("src")).toBe("true");
    expect(await callsOf(move)).toEqual([]);
    // A folder inside it is a place too.
    await pointer([["pointermove", "src/lib"]]);
    expect(await dropMark("src/lib")).toBe("true");
    expect(await dropMark("src")).toBeNull();
    await pointer([["pointerup", "src/lib"]]);
    expect(await waitForCalls(move)).toEqual([{ path: HERE, from: "a.rs", to: "src/lib/a.rs", environment: null }]);
    await expect($(".orca-file-drag")).not.toExist();
    expect(await dropMark("src/lib")).toBeNull();
  });

  it("moves a row dragged onto the empty part of the tree to the root of the worktree, and reads both folders again", async () => {
    await openSrc();
    const move = await mock("orca_file_move", null);
    const list = await mock("orca_files_list", dirOf("src", [["lib", true]]));
    await pointer([
      ["pointerdown", "src/main.rs"],
      ["pointermove", "empty"],
    ]);
    expect(await dropMark("")).toBe("true");
    await pointer([["pointerup", "empty"]]);
    expect(await waitForCalls(move)).toEqual([{ path: HERE, from: "src/main.rs", to: "main.rs", environment: null }]);
    expect((await waitForCalls(list, 2)).map((c) => (c as { dir: string }).dir)).toEqual(["src", ""]);
    expect(await dropMark("")).toBeNull();
  });

  it("does nothing for a row dropped on the folder it is in, on itself, inside itself, on a file and outside the tree", async () => {
    await openSrc();
    const move = await mock("orca_file_move", null);
    // a.rs is in the root already, and src/main.rs in src.
    await pointer([
      ["pointerdown", "a.rs"],
      ["pointermove", "empty"],
    ]);
    await expect($(".orca-file-drag")).toHaveText("a.rs");
    expect(await dropMark("")).toBeNull();
    await pointer([["pointerup", "empty"]]);
    await dragRow("src/main.rs", "src");
    // A folder on itself and on a folder inside it.
    await dragRow("src", "src");
    await pointer([
      ["pointerdown", "src"],
      ["pointermove", "src/lib"],
    ]);
    expect(await dropMark("src/lib")).toBeNull();
    await pointer([["pointerup", "src/lib"]]);
    // A file's row is no place.
    await dragRow("a.rs", "b.log");
    // Escape ends a drag: the release after it moves nothing.
    await pointer([
      ["pointerdown", "a.rs"],
      ["pointermove", "src"],
    ]);
    expect(await dropMark("src")).toBe("true");
    await browser.keys("Escape");
    await expect($(".orca-file-drag")).not.toExist();
    expect(await dropMark("src")).toBeNull();
    await pointer([["pointerup", "src"]]);
    await browser.pause(300);
    expect(await callsOf(move)).toEqual([]);
    await expect($(".orca-file-drag")).not.toExist();
    expect(await names()).toEqual(["src", "lib", "main.rs", "target", "a.rs", "b.log"]);
  });

  it("gives the tab of a moved file its new path and title, keeps its typing, and saves it to the new path only after the move", async () => {
    await openFiles();
    await openA();
    const move = await mock("orca_file_move", holds);
    const write = await mock("orca_file_write", saved("sig-2"));
    await mock("orca_files_list", dirOf("", [["src", true], ["target", true], ["b.log", false], ["c.rs", false]]));
    await askMove("a.rs");
    await setField("c.rs");
    await browser.keys("Enter");
    await waitForCalls(move);
    // Typing while the move is on its way waits: nothing is saved to the path the file leaves.
    await type("// x\n");
    await browser.pause(400);
    expect(await callsOf(write)).toEqual([]);
    expect(await tabTitles()).toEqual(["Write the docs", "a.rs"]);
    await release(move, null);
    await browser.waitUntil(async () => (await tabTitles())[1] === "c.rs", { timeoutMsg: "the tab never took the new name" });
    await expect($(".orca-edit-path")).toHaveText("c.rs");
    await waitForText("fn main() {}\n// x\n");
    expect(await waitForCalls(write)).toEqual([{ path: HERE, relative: "c.rs", content: "fn main() {}\n// x\n", crlf: false, signature: "sig-1", environment: null }]);
    await expect(stateText()).toHaveText("保存しました");
    // The moved file is the one drawn as open.
    await expect(row("c.rs")).toHaveAttribute("data-open", "true");
  });

  it("gives the tabs of the files under a moved folder their new paths, and keeps the path of a tab when the move fails", async () => {
    await openSrc();
    await mock("orca_file_read", text("fn main() {}\n", "sig-m"));
    await doublePress("src/main.rs");
    await waitForText("fn main() {}\n");
    const move = await mock("orca_file_move", rejects("Orca がエラーを返しました（forbidden）"));
    await dragRow("src", "target");
    await waitForCalls(move);
    await expect($(CARD)).toHaveText("Orca がエラーを返しました（forbidden）");
    await expect($(".orca-edit-path")).toHaveText("src/main.rs");
    await mock("orca_file_move", null);
    await dragRow("src", "target");
    expect(await waitForCalls(move)).toEqual([{ path: HERE, from: "src", to: "target/src", environment: null }]);
    await expect($(".orca-edit-path")).toHaveText("target/src/main.rs");
    expect(await tabTitles()).toEqual(["Write the docs", "main.rs"]);
  });

  // A-22: the download of a file. Rust opens the save dialog and writes where it says; the page sends the worktree, the path from it and the target, and never a place to save.
  it("downloads a file from the menu with the worktree, its path and no place to save, and says the name of the file saved", async () => {
    await openFiles();
    await waitForCount("#orca-files-tree .orca-file", 4);
    const download = await mock("orca_file_download", "a.rs");
    expect(await rightClickRow("a.rs")).toBe(true);
    await pickItem("ダウンロード");
    expect(await waitForCalls(download)).toEqual([{ path: "/work/example-app", relative: "a.rs", environment: null }]);
    await expect($(".toast")).toHaveText(expect.stringContaining("a.rs をダウンロードしました"));
    await expect($(".menu")).not.toExist();
    await expect($(CARDS)).not.toExist();
  });

  it("sends the path from the worktree of a file in an open folder", async () => {
    await openFiles();
    await waitForCount("#orca-files-tree .orca-file", 4);
    await mock("orca_files_list", dirOf("src", [["lib", true], ["main.rs", false]]));
    await row("src").click();
    await waitForCount("#orca-files-tree .orca-file", 6);
    const download = await mock("orca_file_download", "main.rs");
    expect(await rightClickRow("src/main.rs")).toBe(true);
    await pickItem("ダウンロード");
    expect(await waitForCalls(download)).toEqual([{ path: "/work/example-app", relative: "src/main.rs", environment: null }]);
  });

  it("shows nothing when the save dialog is cancelled", async () => {
    await openFiles();
    await waitForCount("#orca-files-tree .orca-file", 4);
    const download = await mock("orca_file_download", null);
    expect(await rightClickRow("a.rs")).toBe(true);
    await pickItem("ダウンロード");
    await waitForCalls(download);
    await browser.pause(300);
    await expect($(".toast")).not.toBeDisplayed();
    await expect($(CARDS)).not.toExist();
  });

  it("shows the message of a download that failed, and no toast", async () => {
    await openFiles();
    await waitForCount("#orca-files-tree .orca-file", 4);
    const download = await mock("orca_file_download", rejects("この PC にファイルを書けません: Permission denied"));
    expect(await rightClickRow("a.rs")).toBe(true);
    await pickItem("ダウンロード");
    await waitForCalls(download);
    await expect($(CARD)).toHaveText("この PC にファイルを書けません: Permission denied");
    await expect($(".toast")).not.toBeDisplayed();
  });

  // A-31: an HTML file opened in the browser. Rust serves the worktree and opens the address; the page sends the worktree, the path from it and the target, and shows nothing when it works.
  const withPage = () =>
    dirOf("", [
      ["site.html", true],
      ["a.rs", false],
      ["INDEX.HTML", false],
      ["page.html", false],
    ]);

  it("has 「ブラウザで開く」 as the fifth item of the menu of a file whose name ends with .html, whatever the case, before the line, and not on another file or on a folder (A-31)", async () => {
    await openFiles({ orca_files_list: withPage() });
    await waitForCount("#orca-files-tree .orca-file", 4);
    expect(await rightClickRow("page.html")).toBe(true);
    expect(await textsOf('.menu[role="menu"] button')).toEqual(["パスのコピー", "相対パスをコピー", "ダウンロード", "差分を表示", "ブラウザで開く", "移動・名前の変更", "削除"]);
    expect(await count('.menu[role="menu"] button svg')).toBe(7);
    expect(await textsOf('.menu[role="menu"] > *')).toEqual(["パスのコピー", "相対パスをコピー", "ダウンロード", "差分を表示", "ブラウザで開く", "", "移動・名前の変更", "削除"]);
    await browser.keys("Escape");
    await expect($(".menu")).not.toExist();
    expect(await rightClickRow("INDEX.HTML")).toBe(true);
    expect((await textsOf('.menu[role="menu"] button'))[4]).toBe("ブラウザで開く");
    await browser.keys("Escape");
    await expect($(".menu")).not.toExist();
    expect(await rightClickRow("a.rs")).toBe(true);
    expect(await textsOf('.menu[role="menu"] button')).toEqual(["パスのコピー", "相対パスをコピー", "ダウンロード", "差分を表示", "移動・名前の変更", "削除"]);
    await browser.keys("Escape");
    await expect($(".menu")).not.toExist();
    // A folder whose name ends with .html is a folder.
    expect(await rightClickRow("site.html")).toBe(true);
    expect(await textsOf('.menu[role="menu"] button')).toEqual(["新規ファイル", "新規フォルダー", "パスのコピー", "相対パスをコピー", "移動・名前の変更", "削除"]);
  });

  it("has 「ブラウザで開く」 on a file whose name ends with .htm, whatever the case, and opens it in the browser, and not on .htmx (A-31)", async () => {
    await openFiles({ orca_files_list: dirOf("", [["old.htm", false], ["OLD.HTM", false], ["a.htmx", false], ["a.rs", false]]) });
    await waitForCount("#orca-files-tree .orca-file", 4);
    const open = await mock("orca_file_open_in_browser", null);
    expect(await rightClickRow("OLD.HTM")).toBe(true);
    expect((await textsOf('.menu[role="menu"] button'))[4]).toBe("ブラウザで開く");
    await browser.keys("Escape");
    await expect($(".menu")).not.toExist();
    expect(await rightClickRow("a.htmx")).toBe(true);
    expect(await textsOf('.menu[role="menu"] button')).not.toContain("ブラウザで開く");
    await browser.keys("Escape");
    await expect($(".menu")).not.toExist();
    expect(await rightClickRow("old.htm")).toBe(true);
    await pickItem("ブラウザで開く");
    expect(await waitForCalls(open)).toEqual([{ path: "/work/example-app", relative: "old.htm", environment: null }]);
    await expect($(".menu")).not.toExist();
  });

  it("opens an HTML file in the browser from the menu with the worktree, its path and the target, closes the menu and shows nothing (A-31)", async () => {
    await openFiles({ orca_files_list: withPage() });
    await waitForCount("#orca-files-tree .orca-file", 4);
    const open = await mock("orca_file_open_in_browser", null);
    expect(await rightClickRow("page.html")).toBe(true);
    await pickItem("ブラウザで開く");
    expect(await waitForCalls(open)).toEqual([{ path: "/work/example-app", relative: "page.html", environment: null }]);
    await expect($(".menu")).not.toExist();
    await browser.pause(300);
    await expect($(".toast")).not.toBeDisplayed();
    await expect($(CARDS)).not.toExist();
  });

  it("shows the message of an open in the browser that failed, and no toast (A-31)", async () => {
    await openFiles({ orca_files_list: withPage() });
    await waitForCount("#orca-files-tree .orca-file", 4);
    const open = await mock("orca_file_open_in_browser", rejects("ブラウザで開けません"));
    expect(await rightClickRow("page.html")).toBe(true);
    await pickItem("ブラウザで開く");
    await waitForCalls(open);
    await expect($(CARD)).toHaveText("ブラウザで開けません");
    await expect($(".toast")).not.toBeDisplayed();
  });

  // A-42: an HTML file opens in the preview, a frame that shows the address `orca_file_preview_url` returns. Rust makes the address and serves the file (unit tests): the mock answers a made-up one, and the spec checks what the page asks, draws and saves.
  const PREVIEW_URL = "http://127.0.0.1:12345/tok/page.html";
  const previewArgs = { path: "/work/example-app", relative: "page.html", environment: null };
  const html = (content: string) => text(content, "sig-1", "html");
  const frameOf = () =>
    browser.execute(() => {
      const frame = document.querySelector<HTMLIFrameElement>(".orca-edit-preview iframe");
      return frame === null ? null : { src: frame.getAttribute("src"), sandbox: frame.getAttribute("sandbox") };
    });
  // Opens page.html (or `name`) with `content`, with `orca_file_preview_url` answering the made-up address, and waits for the frame.
  async function openPage(content = "<h1>見出し</h1>\n", name = "page.html") {
    await openFiles({ orca_files_list: withPage() });
    await waitForCount("#orca-files-tree .orca-file", 4);
    const url = await mock("orca_file_preview_url", PREVIEW_URL);
    await mock("orca_file_read", html(content));
    await doublePress(name);
    await waitForCount(".orca-edit-preview iframe", 1);
    return url;
  }

  it("opens an HTML file in the preview, with the source and preview buttons and the frame of the address, its sandbox letting no top navigation through (A-42)", async () => {
    const url = await openPage();
    expect(await frameOf()).toEqual({ src: PREVIEW_URL, sandbox: "allow-scripts allow-same-origin" });
    expect(await callsOf(url)).toEqual([previewArgs]);
    await expect($(".orca-edit-preview")).toBeDisplayed();
    await expect($(".orca-edit-body")).not.toBeDisplayed();
    await expect(modeButton("プレビュー")).toHaveAttribute("aria-pressed", "true");
    await expect(modeButton("ソース")).toHaveAttribute("aria-pressed", "false");
    await expect(modeButton("リッチ")).not.toBeDisplayed();
    await expect(modeButton("再読み込み")).toBeDisplayed();
    // The text stays in the editor for the source.
    await waitForText("<h1>見出し</h1>\n");
  });

  it("opens a file whose name ends with .html in capitals in the preview too (A-42)", async () => {
    const url = await openPage("<p>a</p>", "INDEX.HTML");
    expect(await callsOf(url)).toEqual([{ ...previewArgs, relative: "INDEX.HTML" }]);
    await expect(modeButton("プレビュー")).toHaveAttribute("aria-pressed", "true");
  });

  it("switches an HTML file to its source and back to the preview with the buttons, and asks for the address again for the preview (A-42)", async () => {
    const url = await openPage();
    await modeButton("ソース").click();
    await expect($(".orca-edit-body")).toBeDisplayed();
    await expect($(".orca-edit-preview")).not.toBeDisplayed();
    await waitForText("<h1>見出し</h1>\n");
    await expect(modeButton("ソース")).toHaveAttribute("aria-pressed", "true");
    await expect(modeButton("プレビュー")).toHaveAttribute("aria-pressed", "false");
    await expect(modeButton("再読み込み")).not.toBeDisplayed();
    expect(await count(".orca-edit-preview iframe")).toBe(0);
    expect(await callsOf(url)).toEqual([previewArgs]);
    await modeButton("プレビュー").click();
    await waitForCount(".orca-edit-preview iframe", 1);
    expect(await callsOf(url)).toEqual([previewArgs, previewArgs]);
    await expect(modeButton("プレビュー")).toHaveAttribute("aria-pressed", "true");
    await expect(modeButton("再読み込み")).toBeDisplayed();
  });

  it("makes a new frame and asks for the address again with the reload button of the preview (A-42)", async () => {
    const url = await openPage();
    await browser.execute(() => {
      (document.querySelector(".orca-edit-preview iframe") as HTMLIFrameElement & { old?: boolean }).old = true;
    });
    await modeButton("再読み込み").click();
    await waitForCalls(url, 2);
    await browser.waitUntil(() => browser.execute(() => (document.querySelector(".orca-edit-preview iframe") as HTMLIFrameElement & { old?: boolean }).old !== true), { timeoutMsg: "the frame was not made again" });
    expect(await count(".orca-edit-preview iframe")).toBe(1);
    expect(await frameOf()).toEqual({ src: PREVIEW_URL, sandbox: "allow-scripts allow-same-origin" });
  });

  it("saves the typing that waits before it asks for the address of the preview (A-42)", async () => {
    const url = await openPage();
    await modeButton("ソース").click();
    const write = await mock("orca_file_write", holds);
    await mock(url, PREVIEW_URL);
    await type("<p>追記</p>\n");
    await modeButton("プレビュー").click();
    const [call] = (await waitForCalls(write)) as { content: string }[];
    expect(call.content).toBe("<h1>見出し</h1>\n<p>追記</p>\n");
    await browser.pause(300);
    expect(await callsOf(url)).toEqual([]);
    expect(await count(".orca-edit-preview iframe")).toBe(0);
    await release(write, saved("sig-2"));
    expect(await waitForCalls(url)).toEqual([previewArgs]);
    await waitForCount(".orca-edit-preview iframe", 1);
  });

  it("shows the message of an address that failed on a card and shows the source (A-42)", async () => {
    await openFiles({ orca_files_list: withPage() });
    await waitForCount("#orca-files-tree .orca-file", 4);
    await mock("orca_file_preview_url", rejects("プレビューを開けません"));
    await mock("orca_file_read", html("<h1>a</h1>\n"));
    await doublePress("page.html");
    await expect($(CARD)).toHaveText("プレビューを開けません");
    await expect($(CONTENT)).toBeDisplayed();
    await waitForText("<h1>a</h1>\n");
    await expect(modeButton("ソース")).toHaveAttribute("aria-pressed", "true");
    await expect(modeButton("再読み込み")).not.toBeDisplayed();
    expect(await count(".orca-edit-preview iframe")).toBe(0);
  });

  it("keeps the source when the save that comes first does not go through, and does not ask for the address (A-42)", async () => {
    const url = await openPage();
    await modeButton("ソース").click();
    const write = await mock("orca_file_write", { state: "changed", signature: "sig-1" } satisfies OrcaSaved);
    await type("<p>追記</p>\n");
    await waitForCalls(write);
    await expect(stateText()).toHaveText("ディスクのファイルが変わっています");
    // The record of the address is cleared, so that only a call after the failed save would show.
    await mock(url, PREVIEW_URL);
    await modeButton("プレビュー").click();
    await browser.waitUntil(() => $(".orca-edit-body").isDisplayed(), { timeoutMsg: "the source did not come back" });
    await expect($(".orca-edit-preview")).not.toBeDisplayed();
    await expect(modeButton("ソース")).toHaveAttribute("aria-pressed", "true");
    await expect(modeButton("プレビュー")).toHaveAttribute("aria-pressed", "false");
    await expect(modeButton("再読み込み")).not.toBeDisplayed();
    expect(await count(".orca-edit-preview iframe")).toBe(0);
    expect(await callsOf(url)).toEqual([]);
  });

  it("shows no preview button and no reload button for a file that is not HTML (A-42)", async () => {
    await openFiles();
    await openFileWith(rust("fn main() {}\n"));
    await expect(modeButton("プレビュー")).not.toBeDisplayed();
    await expect(modeButton("再読み込み")).not.toBeDisplayed();
    await expect($(".orca-edit-preview")).not.toBeDisplayed();
    expect(await count(".orca-edit-preview iframe")).toBe(0);
  });

  // A-24: the diff tab. Rust compares the two texts (`orca_file_diff`): the rows of both views and the blocks of changes; the page draws them and colors the text.
  const row_ = (kind: OrcaDiffRow["kind"], old: number | null, nw: number | null): OrcaDiffRow => ({ kind, old, new: nw });
  const diffOfA = (): OrcaFileDiff => ({
    oldLines: ["fn main() {", "    old();", "}", "/* a", "b */"],
    newLines: ["fn main() {", "    new();", "    more();", "}", "/* a", "b */", "// tail"],
    side: [row_("same", 1, 1), row_("changed", 2, 2), row_("added", null, 3), row_("same", 3, 4), row_("same", 4, 5), row_("same", 5, 6), row_("added", null, 7)],
    inline: [row_("same", 1, 1), row_("removed", 2, null), row_("added", null, 2), row_("added", null, 3), row_("same", 3, 4), row_("same", 4, 5), row_("same", 5, 6), row_("added", null, 7)],
    changes: [
      { side: 1, inline: 1 },
      { side: 6, inline: 7 },
    ],
    language: "rust",
    highlight: "rust",
  });
  // 200 rows, with a change at the second row and another at the 150th, so that the rows scroll.
  const many = (): OrcaFileDiff => {
    const lines = Array.from({ length: 200 }, (_, i) => `line ${i + 1}`);
    const side = lines.map((_, i) => row_(i === 1 || i === 149 ? "changed" : "same", i + 1, i + 1));
    return { oldLines: lines, newLines: lines.map((l, i) => (i === 1 || i === 149 ? `${l} new` : l)), side, inline: side.flatMap((r) => (r.kind === "changed" ? [row_("removed", r.old, null), row_("added", null, r.new)] : [r])), changes: [{ side: 1, inline: 1 }, { side: 149, inline: 150 }], language: "plaintext", highlight: null };
  };
  const diffRows = () => count(".orca-diff-rows .odf-row");
  const diffButton = (label: string) => $(`.orca-diff [aria-label="${label}"]`);
  const diffCell = (row: number, cell: string) => browser.execute((r, c) => document.querySelectorAll(".orca-diff-rows .odf-row")[r].querySelector(c)!.textContent, row, cell);
  async function openDiffOf(relative = "a.rs", value: unknown = diffOfA()) {
    await openFiles();
    await waitForCount("#orca-files-tree .orca-file", 4);
    const diff = await mock("orca_file_diff", value);
    expect(await rightClickRow(relative)).toBe(true);
    await pickItem("差分を表示");
    if ((value as { highlight?: string | null }).highlight) await waitForColors();
    return diff;
  }

  it("has the split and the window in the menu of the tab of a diff, and in that of a Claude session, with no copy of a path (A-17, A-46)", async () => {
    await openDiffOf();
    await rightClickTab("diff:1");
    await expect($('.menu[role="menu"]')).toBeDisplayed();
    expect(await textsOf('.menu[role="menu"] > *')).toEqual(["右に分割", "下に分割", "別ウィンドウで開く"]);
    await browser.keys("Escape");
    await expect($(".menu")).not.toExist();
    await rightClickTab(claude);
    await expect($('.menu[role="menu"]')).toBeDisplayed();
    expect(await textsOf('.menu[role="menu"] > *')).toEqual(["右に分割", "下に分割", "別ウィンドウで開く"]);
  });


  // A-46: a diff tab in a window of its own. The window reads the difference again from the conditions it is given; the tab stays in the memory of the screen, out of the panes.
  const diffWindow = popoutTab("diff:1", "", "a.rs", { label: "", content: { kind: "diff", path: "/work/example-app", relative: "a.rs", commit: null } });
  const away = async () => ((await callsOf("orca_panes")).at(-1) as { away: string[] }).away;
  const awayIs = (want: string[]) => browser.waitUntil(async () => JSON.stringify(await away()) === JSON.stringify(want), { timeoutMsg: `the tabs in a window never became ${want.join()}` });

  it("opens the diff of a file in a window with its worktree, its file and no commit, and the tab leaves the panes (A-46)", async () => {
    await openDiffOf();
    await rightClickTab("diff:1");
    await pickItem("別ウィンドウで開く");
    expect(await waitForCalls("orca_popout_open")).toEqual([{ tab: diffWindow }]);
    await awayIs(["diff:1"]);
    expect(await tabTitles()).toEqual(["Write the docs"]);
    await expect($(".orca-diff")).not.toBeDisplayed();
  });

  it("closes the diff, and ends its window, when the owner presses the red button of the window, and puts it back in its pane when the owner presses the button of the right end (A-46)", async () => {
    await openDiffOf();
    await rightClickTab("diff:1");
    await pickItem("別ウィンドウで開く");
    await awayIs(["diff:1"]);
    await sendPopout({ kind: "restore", tab: "diff:1" });
    expect(await waitForCalls("orca_popout_end")).toEqual([{ tab: "diff:1" }]);
    await awayIs([]);
    expect(await tabTitles()).toEqual(["Write the docs", "a.rs"]);
    await rightClickTab("diff:1");
    await pickItem("別ウィンドウで開く");
    await awayIs(["diff:1"]);
    await sendPopout({ kind: "close", tab: "diff:1" });
    await browser.waitUntil(async () => (await callsOf("orca_popout_end")).length >= 2, { timeoutMsg: "the window never ended" });
    expect(await callsOf("orca_popout_end")).toEqual([{ tab: "diff:1" }, { tab: "diff:1" }]);
    expect(await tabTitles()).toEqual(["Write the docs"]);
    await awayIs([]);
  });

  it("opens the diff of a file from the menu of its row with the worktree, its path and the target, as a tab that is selected (A-24)", async () => {
    const diff = await openDiffOf();
    expect(await waitForCalls(diff)).toEqual([{ path: "/work/example-app", relative: "a.rs", environment: null }]);
    await expect($(".menu")).not.toExist();
    await expect(tabOf("diff:1")).toBeDisplayed();
    expect(await tabTitles()).toEqual(["Write the docs", "a.rs"]);
    await expect(tabOf("diff:1").$(".orca-tab-btn")).toHaveAttribute("aria-selected", "true");
    await expect($(".orca-diff .orca-edit-path")).toHaveText("a.rs");
    await expect($(".orca-diff-count")).toHaveText("変更 2 件");
    expect(await diffRows()).toBe(7);
    await expect($(CARDS)).not.toExist();
  });

  it("draws HEAD on the left, the working tree on the right and the numbers between, with a blank where a side has no line (A-24)", async () => {
    await openDiffOf();
    await waitForCount(".orca-diff-rows .odf-row", 7);
    await expect($(".orca-diff-rows")).toHaveAttribute("data-view", "side");
    expect(await diffCell(1, ".old")).toBe("    old();");
    expect(await diffCell(1, ".new")).toBe("    new();");
    expect(await textsOf(".orca-diff-rows .odf-row:nth-child(2) .odf-num")).toEqual(["2", "2"]);
    expect(await textsOf(".orca-diff-rows .odf-row:nth-child(3) .odf-num")).toEqual(["", "3"]);
    expect(await diffCell(2, ".old")).toBe("");
    expect(await diffCell(2, ".new")).toBe("    more();");
    const kinds = await browser.execute(() => [...document.querySelectorAll<HTMLElement>(".orca-diff-rows .odf-row")].map((r) => r.dataset.kind));
    expect(kinds).toEqual(["same", "changed", "added", "same", "same", "same", "added"]);
    const colors = await browser.execute(() => {
      const bg = (row: number, cell: string) => getComputedStyle(document.querySelectorAll(".orca-diff-rows .odf-row")[row].querySelector(cell)!).backgroundColor;
      return { removed: bg(1, ".old"), added: bg(1, ".new"), blank: bg(2, ".old"), added2: bg(2, ".new"), same: bg(0, ".old") };
    });
    expect(colors.removed).toBe("rgb(255, 235, 233)");
    expect(colors.added).toBe("rgb(218, 251, 225)");
    expect(colors.added2).toBe(colors.added);
    expect(colors.blank).toBe("rgb(246, 248, 250)");
    expect(colors.same).toBe("rgba(0, 0, 0, 0)");
  });

  it("colors the text by the language, a token of several lines on each of its lines (A-24)", async () => {
    await openDiffOf();
    await waitForCount(".orca-diff-rows .odf-row", 7);
    expect(await textsOf(".orca-diff-rows .odf-row:nth-child(1) .old .hljs-keyword")).toEqual(["fn"]);
    expect(await textsOf(".orca-diff-rows .odf-row:nth-child(1) .new .hljs-keyword")).toEqual(["fn"]);
    // The block comment starts on one line and ends on the next: both are comments.
    expect(await textsOf(".orca-diff-rows .odf-row:nth-child(5) .old .hljs-comment")).toEqual(["/* a"]);
    expect(await textsOf(".orca-diff-rows .odf-row:nth-child(6) .old .hljs-comment")).toEqual(["b */"]);
    expect(await textsOf(".orca-diff-rows .odf-row:nth-child(7) .new .hljs-comment")).toEqual(["// tail"]);
  });

  it("draws the text plain and escaped for a language with no grammar (A-24)", async () => {
    const plain: OrcaFileDiff = { ...diffOfA(), oldLines: ["<b>x</b> &amp;"], newLines: ["<b>y</b>"], side: [row_("changed", 1, 1)], inline: [row_("removed", 1, null), row_("added", null, 1)], changes: [{ side: 0, inline: 0 }], language: "zig", highlight: null };
    await openDiffOf("a.rs", plain);
    await waitForCount(".orca-diff-rows .odf-row", 1);
    expect(await diffCell(0, ".old")).toBe("<b>x</b> &amp;");
    expect(await count(".orca-diff-rows b")).toBe(0);
    expect(await count(".orca-diff-rows [class^='hljs-']")).toBe(0);
  });

  it("switches to one column with the marks and two columns of numbers, and back, with the button of the tab (A-24)", async () => {
    await openDiffOf();
    await waitForCount(".orca-diff-rows .odf-row", 7);
    await expect(diffButton("1 列で表示")).toHaveAttribute("aria-pressed", "false");
    await diffButton("1 列で表示").click();
    await waitForCount(".orca-diff-rows .odf-row", 8);
    await expect($(".orca-diff-rows")).toHaveAttribute("data-view", "inline");
    await expect(diffButton("左右に並べて表示")).toHaveAttribute("aria-pressed", "true");
    expect(await textsOf(".orca-diff-rows .odf-mark")).toEqual(["", "−", "+", "+", "", "", "", "+"]);
    expect(await textsOf(".orca-diff-rows .odf-row:nth-child(2) .odf-num")).toEqual(["2", ""]);
    expect(await textsOf(".orca-diff-rows .odf-row:nth-child(3) .odf-num")).toEqual(["", "2"]);
    expect(await textsOf(".orca-diff-rows .odf-row:nth-child(2) .odf-code")).toEqual(["old();"]);
    expect(await textsOf(".orca-diff-rows .odf-row:nth-child(3) .odf-code")).toEqual(["new();"]);
    const colors = await browser.execute(() => {
      const bg = (row: number) => getComputedStyle(document.querySelectorAll(".orca-diff-rows .odf-row")[row].querySelector(".odf-code")!).backgroundColor;
      return [bg(1), bg(2), bg(0)];
    });
    expect(colors).toEqual(["rgb(255, 235, 233)", "rgb(218, 251, 225)", "rgba(0, 0, 0, 0)"]);
    expect(await count(".orca-diff-rows .odf-row:nth-child(2) .hljs-keyword, .orca-diff-rows .odf-row:nth-child(1) .hljs-keyword")).toBe(1);
    expect(await callsOf("orca_file_diff")).toHaveLength(1);
    await diffButton("左右に並べて表示").click();
    await waitForCount(".orca-diff-rows .odf-row", 7);
    await expect($(".orca-diff-rows")).toHaveAttribute("data-view", "side");
  });

  it("goes to the previous and the next block of changes, and counts them (A-24)", async () => {
    await openDiffOf("a.rs", many());
    await waitForCount(".orca-diff-rows .odf-row", 200);
    await expect($(".orca-diff-count")).toHaveText("変更 2 件");
    const view = () => browser.execute(() => {
      const box = document.querySelector(".orca-diff-rows")!.getBoundingClientRect();
      const r = document.querySelectorAll(".orca-diff-rows .odf-row")[149].getBoundingClientRect();
      return { top: document.querySelector(".orca-diff-rows")!.scrollTop, visible: r.top >= box.top && r.bottom <= box.bottom };
    });
    await expect(diffButton("前の変更")).toBeDisabled();
    await expect(diffButton("次の変更")).toBeEnabled();
    expect((await view()).visible).toBe(false);
    await diffButton("次の変更").click();
    await browser.waitUntil(async () => (await view()).visible, { timeoutMsg: "the second change never came into view" });
    await expect(diffButton("次の変更")).toBeDisabled();
    await expect(diffButton("前の変更")).toBeEnabled();
    await diffButton("前の変更").click();
    await browser.waitUntil(async () => !(await view()).visible, { timeoutMsg: "the first change never came back" });
    await expect(diffButton("前の変更")).toBeDisabled();
  });

  it("draws a tab that is out of the page in the view chosen when it is put back, at the block last moved to (A-24)", async () => {
    await openDiffOf("a.rs", many());
    await waitForCount(".orca-diff-rows .odf-row", 200);
    await diffButton("次の変更").click();
    await expect(diffButton("次の変更")).toBeDisabled();
    expect(await rightClickRow("b.log")).toBe(true);
    await pickItem("差分を表示");
    await expect(tabOf("diff:2")).toBeDisplayed();
    await waitForCount(".orca-diff-rows .odf-row", 200);
    await diffButton("1 列で表示").click();
    await waitForCount(".orca-diff-rows .odf-row", 202);
    await tabOf("diff:1").$(".orca-tab-btn").click();
    await expect($(".orca-diff-rows")).toHaveAttribute("data-view", "inline");
    await waitForCount(".orca-diff-rows .odf-row", 202);
    await expect(diffButton("左右に並べて表示")).toHaveAttribute("aria-pressed", "true");
    await expect(diffButton("次の変更")).toBeDisabled();
    // The second block (the 151st row of one column) is in view, not the pixel place of the other view.
    const visible = () => browser.execute(() => {
      const box = document.querySelector(".orca-diff-rows")!.getBoundingClientRect();
      const r = document.querySelectorAll(".orca-diff-rows .odf-row")[150].getBoundingClientRect();
      return r.top >= box.top && r.bottom <= box.bottom;
    });
    await browser.waitUntil(visible, { timeoutMsg: "the second change was not in view after the tab was put back" });
  });

  it("says there is no change for a file with none, and the buttons of the changes are off (A-24)", async () => {
    const none: OrcaFileDiff = { ...diffOfA(), oldLines: ["a"], newLines: ["a"], side: [row_("same", 1, 1)], inline: [row_("same", 1, 1)], changes: [] };
    await openDiffOf("a.rs", none);
    await expect($(".orca-diff-count")).toHaveText("変更はありません");
    await expect(diffButton("前の変更")).toBeDisabled();
    await expect(diffButton("次の変更")).toBeDisabled();
  });

  it("shows the reason Rust gives in place of the diff (A-24)", async () => {
    await openFiles();
    await waitForCount("#orca-files-tree .orca-file", 4);
    const diff = await mock("orca_file_diff", rejects("バイナリのファイルの差分は表示できません"));
    expect(await rightClickRow("a.rs")).toBe(true);
    await pickItem("差分を表示");
    await waitForCalls(diff);
    await expect($(".orca-diff .feed-empty")).toHaveText("バイナリのファイルの差分は表示できません");
    await expect($(".orca-diff-rows")).not.toBeDisplayed();
    await expect($(".orca-diff-count")).toHaveText("");
    await expect(diffButton("1 列で表示")).toBeDisabled();
    await expect(diffButton("次の変更")).toBeDisabled();
    await expect($(CARDS)).not.toExist();
    // The reload button reads again, and draws the diff when it can.
    await mock("orca_file_diff", diffOfA());
    await diffButton("読み直す").click();
    await waitForCount(".orca-diff-rows .odf-row", 7);
    await expect($(".orca-diff .feed-empty")).not.toBeDisplayed();
  });

  it("reads the diff again with the reload button, and selects the tab instead of opening a second one for the same file (A-24)", async () => {
    const diff = await openDiffOf();
    await waitForCount(".orca-diff-rows .odf-row", 7);
    await diffButton("読み直す").click();
    expect(await waitForCalls(diff, 2)).toHaveLength(2);
    await tabOf(claudeTab("example-app")).$(".orca-tab-btn").click();
    await expect($(".orca-diff")).not.toExist();
    expect(await rightClickRow("a.rs")).toBe(true);
    await pickItem("差分を表示");
    await browser.waitUntil(async () => (await callsOf("orca_file_diff")).length === 3, { timeoutMsg: "the diff was never read again" });
    await expect(tabOf("diff:1").$(".orca-tab-btn")).toHaveAttribute("aria-selected", "true");
    expect(await tabTitles()).toEqual(["Write the docs", "a.rs"]);
    await expect($(".orca-diff")).toBeDisplayed();
    expect(await diffRows()).toBe(7);
  });

  it("opens the diff of another file as another tab, and closes a diff tab without asking Rust (A-24)", async () => {
    await openDiffOf();
    await waitForCount(".orca-diff-rows .odf-row", 7);
    expect(await rightClickRow("b.log")).toBe(true);
    await pickItem("差分を表示");
    await expect(tabOf("diff:2")).toBeDisplayed();
    expect(await tabTitles()).toEqual(["Write the docs", "a.rs", "b.log"]);
    await expect($(".orca-diff .orca-edit-path")).toHaveText("b.log");
    await tabOf("diff:2").$(".orca-tab-close").click();
    await expect(tabOf("diff:2")).not.toExist();
    expect(await tabTitles()).toEqual(["Write the docs", "a.rs"]);
  });

  it("opens the diff of a file in an open folder with its path from the worktree (A-24)", async () => {
    await openFiles();
    await waitForCount("#orca-files-tree .orca-file", 4);
    await mock("orca_files_list", dirOf("src", [["lib", true], ["main.rs", false]]));
    await row("src").click();
    await waitForCount("#orca-files-tree .orca-file", 6);
    const diff = await mock("orca_file_diff", diffOfA());
    expect(await rightClickRow("src/main.rs")).toBe(true);
    await pickItem("差分を表示");
    expect(await waitForCalls(diff)).toEqual([{ path: "/work/example-app", relative: "src/main.rs", environment: null }]);
    expect(await tabTitles()).toEqual(["Write the docs", "main.rs"]);
  });

  it("closes the menu of a row with Escape and writes nothing", async () => {
    await openFiles();
    await waitForCount("#orca-files-tree .orca-file", 4);
    await stubClipboard();
    expect(await rightClickRow("b.log")).toBe(true);
    await expect($('.menu[role="menu"]')).toBeDisplayed();
    await browser.keys("Escape");
    await expect($(".menu")).not.toExist();
    expect(await copiedTexts()).toEqual([]);
  });

  // A-25: the branch of the heading. Rust reads the branches and switches (`orca_local_branches`, `orca_remote_branches`, `orca_switch_branch`); the page draws the list, asks for the remote ones by the text, and reads the tree and the list of Orca again after a switch.
  const local = (name: string, extra: Partial<OrcaLocalBranch> = {}): OrcaLocalBranch => ({ name, current: false, inUse: false, ...extra });
  const remote = (name: string): OrcaRemoteBranch => ({ name, localName: name.replace(/^origin\//, "") });
  // feat/a is checked out in the worktree, main in another one.
  const branchFixtures = (extra: Record<string, unknown> = {}) => ({
    orca_local_branches: [local("feat/a", { current: true }), local("main", { inUse: true }), local("feat/c")],
    orca_remote_branches: [remote("origin/feat/a"), remote("origin/feat/d")],
    orca_switch_branch: { branch: "feat/c", warning: null },
    ...extra,
  });
  const branchButton = () => $("#orca-files-title .orca-branch-btn");
  // The rows the filter leaves in view: it hides the others and keeps them in the page.
  const shownRows = (selector = ".orca-dest-pop .orca-branch-row") =>
    browser.execute((s) => [...document.querySelectorAll<HTMLElement>(s)].filter((e) => !e.hidden).map((e) => e.textContent?.trim() ?? ""), selector);
  const branchRows = () => shownRows();
  const branchPick = (kind: string, name: string) => $(`.orca-dest-pop .orca-branch-row[data-kind="${kind}"][data-name="${name}"]`);
  const branchStates = () => browser.execute(() => [...document.querySelectorAll<HTMLButtonElement>(".orca-dest-pop .orca-branch-row")].map((b) => [b.dataset.kind, b.dataset.name, b.getAttribute("aria-current"), b.disabled]));
  // The file pane open on example-app and the list of branches opened under the button of the heading.
  async function openBranches(fixtures: Record<string, unknown> = {}) {
    await openFiles(branchFixtures(fixtures));
    await waitForCount("#orca-files-tree .orca-file", 4);
    await branchButton().click();
    await expect($('.orca-dest-pop[role="dialog"]')).toBeDisplayed();
  }
  // What Orca lists once example-app is on feat/c.
  const onFeatC = () => orcaOverview([orcaRow("example-app", "feat/c", "Write the docs", { minutes: 2 }), ...sample().slice(1)], [orcaWorktree("example-app", "feat/c"), orcaWorktree("example-api", "main")]);

  it("makes the branch of the heading a button that opens the list right under it, with the local and the remote branches, the one the worktree is on marked and the one another worktree has disabled (A-25)", async () => {
    await openBranches();
    await expect($("#orca-files-title")).toHaveText("example-app ・ feat/a");
    await expect(branchButton()).toHaveText("feat/a");
    await expect(branchButton()).toHaveAttribute("aria-expanded", "true");
    expect(await callsOf("orca_local_branches")).toEqual([{ path: "/work/example-app", environment: null }]);
    expect(await waitForCalls("orca_remote_branches")).toEqual([{ path: "/work/example-app", repo: "proj_example-app", query: "", environment: null }]);
    await waitForCount(".orca-dest-pop .orca-branch-row", 5);
    expect(await textsOf(".orca-dest-pop .orca-dest-name")).toEqual(["ローカル", "リモート"]);
    expect(await branchRows()).toEqual(["feat/a", "main", "feat/c", "origin/feat/a", "origin/feat/d"]);
    expect(await branchStates()).toEqual([
      ["local", "feat/a", "true", false],
      ["local", "main", "false", true],
      ["local", "feat/c", "false", false],
      ["remote", "origin/feat/a", "false", false],
      ["remote", "origin/feat/d", "false", false],
    ]);
    expect(await count(".orca-dest-pop .orca-branch-mark")).toBe(1);
    expect(await count('.orca-dest-pop .orca-branch-row[data-name="feat/a"] .orca-branch-mark')).toBe(1);
    const look = await browser.execute(() => {
      const r = (selector: string) => document.querySelector(selector)!.getBoundingClientRect();
      const opacity = (name: string) => getComputedStyle(document.querySelector(`.orca-dest-pop .orca-branch-row[data-name="${name}"]`)!).opacity;
      return { under: r(".orca-dest-pop").top >= r(".orca-branch-btn").bottom, inFiles: r(".orca-dest-pop").top < r("#orca-files").bottom, used: opacity("main"), free: opacity("feat/c") };
    });
    expect(look).toEqual({ under: true, inFiles: true, used: "0.45", free: "1" });
    // The tree stays in view under the list.
    expect(await names()).toEqual(["src", "target", "a.rs", "b.log"]);
    expect(await callsOf("orca_switch_branch")).toEqual([]);
  });

  // Remote branches as Orca lists them: origin/r1 to origin/r{n}.
  const remotes = (n: number) => Array.from({ length: n }, (_, i) => remote(`origin/r${i + 1}`));
  const remoteShown = () => shownRows('.orca-dest-pop .orca-branch-row[data-kind="remote"]');
  const waitRemoteShown = (names: string[]) =>
    browser.waitUntil(async () => JSON.stringify(await remoteShown()) === JSON.stringify(names), { timeoutMsg: `the remote rows never became ${names.join(", ")}` });
  const moreButton = () => $(".orca-dest-more-btn");

  it("draws the headings as a sticky band with an icon and the count, and shows the first five remote branches with a button for the rest that opens and folds them (A-25)", async () => {
    await openBranches({ orca_remote_branches: remotes(7) });
    await waitForCount(".orca-dest-pop .orca-branch-row", 10);
    expect(await textsOf(".orca-dest-pop .orca-dest-name")).toEqual(["ローカル", "リモート"]);
    expect(await textsOf(".orca-dest-pop .orca-dest-count")).toEqual(["3", "7"]);
    expect(await count(".orca-dest-pop .orca-dest-sec .orca-dest-icon svg")).toBe(2);
    const band = await browser.execute(() => {
      const s = getComputedStyle(document.querySelector(".orca-dest-pop .orca-dest-sec")!);
      return { position: s.position, size: s.fontSize, weight: s.fontWeight };
    });
    expect(band).toEqual({ position: "sticky", size: "13px", weight: "700" });
    expect(await remoteShown()).toEqual(["origin/r1", "origin/r2", "origin/r3", "origin/r4", "origin/r5"]);
    await expect(moreButton()).toBeDisplayed();
    await expect(moreButton()).toHaveText("ほか 2 件を表示");
    await expect(moreButton()).toHaveAttribute("aria-expanded", "false");
    // The button is not a row of branches.
    expect(await count(".orca-dest-pop .orca-branch-row .orca-dest-more-btn")).toBe(0);
    await moreButton().click();
    await expect($('.orca-dest-pop[role="dialog"]')).toBeDisplayed();
    expect(await remoteShown()).toEqual(remotes(7).map((r) => r.name));
    await expect(moreButton()).toHaveText("たたむ");
    await expect(moreButton()).toHaveAttribute("aria-expanded", "true");
    await moreButton().click();
    expect(await remoteShown()).toEqual(["origin/r1", "origin/r2", "origin/r3", "origin/r4", "origin/r5"]);
    await expect(moreButton()).toHaveText("ほか 2 件を表示");
    await expect(moreButton()).toHaveAttribute("aria-expanded", "false");
    expect(await callsOf("orca_switch_branch")).toEqual([]);
  });

  it("shows every match with no button while the filter has text, counts the matches, and folds the remote branches again when the text is cleared (A-25)", async () => {
    await openBranches({ orca_remote_branches: remotes(7) });
    await waitForCount(".orca-dest-pop .orca-branch-row", 10);
    await moreButton().click();
    await waitRemoteShown(remotes(7).map((r) => r.name));
    const input = $('.orca-dest-pop input[aria-label="ブランチを絞り込む"]');
    await input.setValue("origin");
    await waitRemoteShown(remotes(7).map((r) => r.name));
    await expect(moreButton()).not.toBeDisplayed();
    expect(await textsOf(".orca-dest-pop .orca-dest-count")).toEqual(["0", "7"]);
    await input.setValue("r6");
    await waitRemoteShown(["origin/r6"]);
    await expect(moreButton()).not.toBeDisplayed();
    expect(await textsOf(".orca-dest-pop .orca-dest-count")).toEqual(["0", "1"]);
    await input.setValue("");
    await waitRemoteShown(["origin/r1", "origin/r2", "origin/r3", "origin/r4", "origin/r5"]);
    await expect(moreButton()).toBeDisplayed();
    await expect(moreButton()).toHaveText("ほか 2 件を表示");
    await expect(moreButton()).toHaveAttribute("aria-expanded", "false");
    expect(await textsOf(".orca-dest-pop .orca-dest-count")).toEqual(["3", "7"]);
  });

  it("shows five remote branches or fewer with no line and no button (A-25)", async () => {
    await openBranches({ orca_remote_branches: remotes(5) });
    await waitForCount(".orca-dest-pop .orca-branch-row", 8);
    expect(await remoteShown()).toEqual(remotes(5).map((r) => r.name));
    expect(await textsOf(".orca-dest-pop .orca-dest-count")).toEqual(["3", "5"]);
    await expect($(".orca-dest-more")).not.toBeDisplayed();
    await expect(moreButton()).not.toBeDisplayed();
  });

  it("narrows the local branches by the filter at once, and asks for the remote ones once after the typing stops (A-25)", async () => {
    await openBranches();
    await waitForCount(".orca-dest-pop .orca-branch-row", 5);
    const search = await mock("orca_remote_branches", [remote("origin/feat/d")]);
    await $('.orca-dest-pop input[aria-label="ブランチを絞り込む"]').setValue("feat");
    expect(await shownRows('.orca-dest-pop .orca-branch-row[data-kind="local"]')).toEqual(["feat/a", "feat/c"]);
    // The rows are hidden, not made again.
    expect(await count(".orca-dest-pop .orca-branch-row")).toBe(5);
    await browser.waitUntil(async () => (await callsOf(search)).length > 0, { timeoutMsg: "the remote branches were never asked for" });
    await browser.pause(500);
    expect(await callsOf(search)).toEqual([{ path: "/work/example-app", repo: "proj_example-app", query: "feat", environment: null }]);
    expect(await branchRows()).toEqual(["feat/a", "feat/c", "origin/feat/d"]);
    await $('.orca-dest-pop input[aria-label="ブランチを絞り込む"]').setValue("zzz");
    await waitForCount(".orca-dest-pop .empty:not([hidden])", 2);
    expect(await shownRows(".orca-dest-pop .empty")).toEqual(["該当するブランチがありません", "該当するブランチがありません"]);
    expect(await branchRows()).toEqual([]);
    await browser.waitUntil(async () => ((await callsOf(search)).at(-1) as { query: string } | undefined)?.query === "zzz", { timeoutMsg: "the new text was never asked for" });
  });

  it("asks for the remote branches of the last text once the one in flight is answered, and not while it is (A-25)", async () => {
    await openBranches();
    await waitForCount(".orca-dest-pop .orca-branch-row", 5);
    const search = await mock("orca_remote_branches", holds);
    const input = $('.orca-dest-pop input[aria-label="ブランチを絞り込む"]');
    await input.setValue("f");
    await waitForCalls(search);
    // Typed while the first is waiting: nothing more is sent until it is answered.
    await input.setValue("fe");
    await browser.pause(600);
    await input.setValue("fea");
    await browser.pause(600);
    expect((await callsOf(search)).map((c) => (c as { query: string }).query)).toEqual(["f"]);
    await release(search, [remote("origin/feat/d")]);
    expect(((await waitForCalls(search, 2)).at(-1) as { query: string }).query).toBe("fea");
    await release(search, [remote("origin/feat/d")]);
    await browser.waitUntil(async () => (await branchRows()).includes("origin/feat/d"), { timeoutMsg: "the answer was never drawn" });
    await browser.pause(300);
    expect(await callsOf(search)).toHaveLength(2);
  });

  it("switches to a local branch with the worktree, the kind and the name, then reads the tree and the list of Orca again and keeps the open files (A-25)", async () => {
    await openFiles(branchFixtures());
    await openA();
    await branchButton().click();
    await waitForCount(".orca-dest-pop .orca-branch-row", 5);
    const files = await mock("orca_files_list", root());
    const overview = await mock("orca_overview", onFeatC());
    await branchPick("local", "feat/c").click();
    expect(await waitForCalls("orca_switch_branch")).toEqual([{ path: "/work/example-app", kind: "local", name: "feat/c", environment: null }]);
    await expect($(".orca-dest-pop")).not.toExist();
    await waitForCalls(overview);
    expect(await waitForCalls(files)).toEqual([{ path: "/work/example-app", dir: "", ignored: false, environment: null }]);
    await expect($("#orca-files-title")).toHaveText("example-app ・ feat/c");
    await expect(branchButton()).toHaveText("feat/c");
    // The open file stays: its tab, and its text.
    expect(await tabTitles()).toEqual(["Write the docs", "a.rs"]);
    await expect(tabOf("file:1").$(".orca-tab-btn")).toHaveAttribute("aria-selected", "true");
    await waitForText("fn main() {}\n");
    await expect($(CARDS)).not.toExist();
  });

  it("makes the git branch the button when Orca's name of the worktree differs from it, and shows the new branch after a switch (A-25)", async () => {
    // A worktree made with a name keeps that name as `displayName` after a switch; the button follows the git branch.
    const named = (gitBranch: string) =>
      orcaOverview([orcaRow("example-app", "fix-login", "Write the docs", { minutes: 2 }), ...sample().slice(1)], [orcaWorktree("example-app", "fix-login", { gitBranch }), orcaWorktree("example-api", "main")]);
    await openFiles(branchFixtures(), named("feat/a"));
    await expect($("#orca-files-title")).toHaveText("example-app ・ fix-login ・ feat/a");
    await expect(branchButton()).toHaveText("feat/a");
    await branchButton().click();
    await waitForCount(".orca-dest-pop .orca-branch-row", 5);
    await mock("orca_overview", named("feat/c"));
    await branchPick("local", "feat/c").click();
    expect(await waitForCalls("orca_switch_branch")).toEqual([{ path: "/work/example-app", kind: "local", name: "feat/c", environment: null }]);
    await expect(branchButton()).toHaveText("feat/c");
    await expect($("#orca-files-title")).toHaveText("example-app ・ fix-login ・ feat/c");
  });

  it("leaves the heading as text for a worktree on no git branch (A-25)", async () => {
    await openFiles(branchFixtures(), orcaOverview(sample(), [orcaWorktree("example-app", "feat/a", { gitBranch: "" }), orcaWorktree("example-api", "main")]));
    await expect($("#orca-files-title")).toHaveText("example-app ・ feat/a");
    expect(await count("#orca-files-title button")).toBe(0);
    expect(await callsOf("orca_local_branches")).toEqual([]);
  });

  it("keeps the branch button in a narrow heading and cuts its text with an ellipsis, so that it can still be pressed (A-25)", async () => {
    const longBranch = "feat/a-very-long-branch-name-of-forty-characters";
    const named = orcaOverview(
      [orcaRow("example-app", "fix-login", "Write the docs", { minutes: 2 }), ...sample().slice(1)],
      [orcaWorktree("example-app", "fix-login", { gitBranch: longBranch }), orcaWorktree("example-api", "main")],
    );
    await openFiles(branchFixtures({ orca_local_branches: [local(longBranch, { current: true }), local("main", { inUse: true })] }), named);
    await expect(branchButton()).toHaveText(longBranch);
    await browser.execute(() => {
      document.getElementById("orca-files")!.style.width = "150px";
    });
    const look = await browser.execute(() => {
      const button = document.querySelector<HTMLElement>(".orca-branch-btn")!;
      const title = document.getElementById("orca-files-title")!.getBoundingClientRect();
      const r = button.getBoundingClientRect();
      return { shown: r.width > 0 && r.left >= title.left - 1 && r.right <= title.right + 1, cut: button.scrollWidth > button.clientWidth, ellipsis: getComputedStyle(button).textOverflow };
    });
    expect(look).toEqual({ shown: true, cut: true, ellipsis: "ellipsis" });
    await branchButton().click();
    await expect($('.orca-dest-pop[role="dialog"]')).toBeDisplayed();
    expect(await waitForCalls("orca_local_branches")).toEqual([{ path: "/work/example-app", environment: null }]);
  });

  // The git worktrees of example-app (`orca_git_worktrees`): its own folder, which Orca lists, and one under `.claude/worktrees/` that only git has.
  const gitWorktree = (path: string, gitBranch: string, gitOnly: boolean): OrcaGitWorktree => ({ path, name: path.split("/").at(-1) ?? "", gitBranch, gitOnly });
  const GIT_ONLY = "/work/example-app/.claude/worktrees/work";
  const gitWorktrees = () => [gitWorktree("/work/example-app", "feat/a", false), gitWorktree(GIT_ONLY, "feat/w", true)];
  const worktreeRows = () =>
    browser.execute(() =>
      [...document.querySelectorAll<HTMLElement>('.orca-dest-pop .orca-branch-row[data-kind="worktree"]')].map((b) => [
        b.dataset.name,
        b.querySelector(".orca-wt-branch")?.textContent ?? null,
        b.querySelector(".orca-wt-git")?.textContent ?? null,
        b.getAttribute("aria-current"),
        b.querySelector(".orca-branch-mark") !== null,
      ]),
    );
  const worktreePick = (name: string) => $(`.orca-dest-pop .orca-branch-row[data-kind="worktree"][data-name="${name}"]`);

  it("puts the git worktrees of the project at the top of the list, with the branch of each, the mark git on the one Orca's list lacks and the check on the one the pane shows (A-25)", async () => {
    await openBranches({ orca_git_worktrees: gitWorktrees() });
    await waitForCount(".orca-dest-pop .orca-branch-row", 7);
    expect(await callsOf("orca_git_worktrees")).toEqual([{ repo: "proj_example-app", environment: null }]);
    expect(await textsOf(".orca-dest-pop .orca-dest-name")).toEqual(["worktree", "ローカル", "リモート"]);
    expect(await textsOf(".orca-dest-pop .orca-dest-count")).toEqual(["2", "3", "2"]);
    expect(await worktreeRows()).toEqual([
      ["example-app", "feat/a", null, "true", true],
      ["work", "feat/w", "git", "false", false],
    ]);
    // The section is the first in the list, and the heading stays as it was.
    expect(await browser.execute(() => document.querySelector(".orca-dest-pop .orca-dest-section")?.querySelector(".orca-dest-name")?.textContent)).toBe("worktree");
    await expect($("#orca-files-title")).toHaveText("example-app ・ feat/a");
    // The filter narrows the worktrees by the folder and the branch.
    await $(".orca-dest-pop input").setValue("feat/w");
    await browser.waitUntil(async () => JSON.stringify(await shownRows('.orca-dest-pop .orca-branch-row[data-kind="worktree"]')) === JSON.stringify(["workfeat/wgit"]), { timeoutMsg: "the worktree rows were never narrowed" });
    expect(await callsOf("orca_switch_branch")).toEqual([]);
  });

  it("draws no worktree section when the project has none (A-25)", async () => {
    await openBranches();
    await waitForCount(".orca-dest-pop .orca-branch-row", 5);
    expect(await callsOf("orca_git_worktrees")).toEqual([{ repo: "proj_example-app", environment: null }]);
    expect(await textsOf(".orca-dest-pop .orca-dest-name")).toEqual(["ローカル", "リモート"]);
  });

  it("draws the branches at once and puts the worktree section in when its read is answered (A-25)", async () => {
    await openBranches({ orca_git_worktrees: holds });
    await waitForCount(".orca-dest-pop .orca-branch-row", 5);
    expect(await textsOf(".orca-dest-pop .orca-dest-name")).toEqual(["ローカル", "リモート"]);
    await waitForCalls("orca_git_worktrees");
    await release("orca_git_worktrees", gitWorktrees());
    await waitForCount(".orca-dest-pop .orca-branch-row", 7);
    expect(await textsOf(".orca-dest-pop .orca-dest-name")).toEqual(["worktree", "ローカル", "リモート"]);
  });

  it("asks for the worktrees only when the local branches have answered (A-25)", async () => {
    await openBranches({ orca_local_branches: holds, orca_git_worktrees: gitWorktrees() });
    await waitForCalls("orca_local_branches");
    await browser.pause(400);
    expect(await callsOf("orca_git_worktrees")).toEqual([]);
    await release("orca_local_branches", [local("feat/a", { current: true }), local("main", { inUse: true }), local("feat/c")]);
    await waitForCalls("orca_git_worktrees");
    await waitForCount(".orca-dest-pop .orca-branch-row", 7);
  });

  it("uses the worktrees read for the next list that opens while they are fresh, and asks again when they are not (A-25)", async () => {
    await openFiles({ ...branchFixtures({ orca_git_worktrees: gitWorktrees() }), ...timers({ orcaClock: 2500 }) });
    await waitForCount("#orca-files-tree .orca-file", 4);
    await branchButton().click();
    await waitForCount(".orca-dest-pop .orca-branch-row", 7);
    await browser.keys("Escape");
    await expect($(".orca-dest-pop")).not.toExist();
    await branchButton().click();
    await waitForCount(".orca-dest-pop .orca-branch-row", 7);
    expect(await callsOf("orca_git_worktrees")).toEqual([{ repo: "proj_example-app", environment: null }]);
    await browser.keys("Escape");
    await expect($(".orca-dest-pop")).not.toExist();
    await browser.pause(3000);
    await branchButton().click();
    await waitForCount(".orca-dest-pop .orca-branch-row", 7);
    expect(await waitForCalls("orca_git_worktrees", 2)).toHaveLength(2);
  });

  it("asks for the worktrees again after a switch of the branch (A-25)", async () => {
    await openBranches({ orca_git_worktrees: gitWorktrees() });
    await waitForCount(".orca-dest-pop .orca-branch-row", 7);
    await mock("orca_overview", onFeatC());
    await branchPick("local", "feat/c").click();
    await waitForCalls("orca_switch_branch");
    await expect(branchButton()).toHaveText("feat/c");
    await branchButton().click();
    await waitForCount(".orca-dest-pop .orca-branch-row", 7);
    expect(await waitForCalls("orca_git_worktrees", 2)).toHaveLength(2);
  });

  it("says why in the worktree section when the read failed, and keeps the branches (A-25)", async () => {
    await openBranches({ orca_git_worktrees: rejects("worktree の一覧を読めません") });
    await waitForCount(".orca-dest-pop .orca-branch-row", 5);
    expect(await textsOf(".orca-dest-pop .orca-dest-name")).toEqual(["worktree", "ローカル", "リモート"]);
    expect(await textsOf(".orca-dest-pop .empty.fail")).toEqual(["worktree の一覧を読めません"]);
  });

  it("shows the worktree picked in the file pane: its files are read with its path, and the heading is its own (A-25)", async () => {
    await openBranches({ orca_git_worktrees: gitWorktrees() });
    await waitForCount(".orca-dest-pop .orca-branch-row", 7);
    const files = await mock("orca_files_list", root());
    await worktreePick("work").click();
    await expect($(".orca-dest-pop")).not.toExist();
    expect(await waitForCalls(files)).toEqual([{ path: GIT_ONLY, dir: "", ignored: false, environment: null }]);
    await expect($("#orca-files-title")).toHaveText("example-app ・ work ・ feat/w");
    await expect(branchButton()).toHaveText("feat/w");
    // The tabs of the work pane stay, and nothing was switched.
    expect(await callsOf("orca_switch_branch")).toEqual([]);
    expect(await tabTitles()).toEqual(["Write the docs"]);
    // The list of the worktree that is shown has the check on it, and the branches are the ones of that worktree.
    // The first list read the branches of the worktree of the tab, and `mock` forgets that call: the calls counted are the ones of the list opened now.
    expect(await callsOf("orca_local_branches")).toEqual([{ path: "/work/example-app", environment: null }]);
    await mock("orca_local_branches", [local("feat/w", { current: true }), local("main")]);
    await branchButton().click();
    await waitForCount('.orca-dest-pop .orca-branch-row[data-kind="local"]', 2);
    expect(await callsOf("orca_local_branches")).toEqual([{ path: GIT_ONLY, environment: null }]);
    expect(await worktreeRows()).toEqual([
      ["example-app", "feat/a", null, "false", false],
      ["work", "feat/w", "git", "true", true],
    ]);
  });

  it("keeps the picked worktree for the files opened in it, and goes back to the worktree of the tab when another tab is selected (A-25)", async () => {
    await openBranches({ orca_git_worktrees: gitWorktrees() });
    await waitForCount(".orca-dest-pop .orca-branch-row", 7);
    await worktreePick("work").click();
    await expect($("#orca-files-title")).toHaveText("example-app ・ work ・ feat/w");
    await openA();
    // The file is read in the picked worktree, and its tab keeps the pane on it.
    expect(await callsOf("orca_file_read")).toEqual([{ path: GIT_ONLY, relative: "a.rs", environment: null }]);
    await expect($("#orca-files-title")).toHaveText("example-app ・ work ・ feat/w");
    await tabOf(claude).$(".orca-tab-btn").click();
    await expect($("#orca-files-title")).toHaveText("example-app ・ feat/a");
  });

  it("only closes the list when the worktree the pane shows is pressed (A-25)", async () => {
    await openBranches({ orca_git_worktrees: gitWorktrees() });
    await waitForCount(".orca-dest-pop .orca-branch-row", 7);
    const files = await mock("orca_files_list", root());
    await worktreePick("example-app").click();
    await expect($(".orca-dest-pop")).not.toExist();
    await browser.pause(300);
    expect(await callsOf(files)).toEqual([]);
    await expect($("#orca-files-title")).toHaveText("example-app ・ feat/a");
  });

  it("switches to a remote branch with its name as Orca lists it (A-25)", async () => {
    await openBranches();
    await waitForCount(".orca-dest-pop .orca-branch-row", 5);
    await mock("orca_overview", onFeatC());
    await branchPick("remote", "origin/feat/d").click();
    expect(await waitForCalls("orca_switch_branch")).toEqual([{ path: "/work/example-app", kind: "remote", name: "origin/feat/d", environment: null }]);
    await expect($(".orca-dest-pop")).not.toExist();
  });

  it("remembers the remote branch picked, with the project and the Orca, and a local branch not (A-25)", async () => {
    await openBranches();
    await waitForCount(".orca-dest-pop .orca-branch-row", 5);
    await mock("orca_overview", onFeatC());
    await branchPick("remote", "origin/feat/d").click();
    expect(await waitForCalls("orca_branch_used")).toEqual([{ repo: "proj_example-app", name: "origin/feat/d", environment: null }]);
    await waitForCalls("orca_switch_branch");
    await branchButton().click();
    await waitForCount(".orca-dest-pop .orca-branch-row", 5);
    const used = await mock("orca_branch_used", null);
    await branchPick("local", "feat/a").click();
    await branchButton().click();
    await waitForCount(".orca-dest-pop .orca-branch-row", 5);
    await branchPick("local", "feat/c").click();
    await waitForCalls("orca_switch_branch", 2);
    await browser.pause(300);
    expect(await callsOf(used)).toEqual([]);
  });

  it("switches and shows no error when remembering the remote branch picked fails (A-25)", async () => {
    await openBranches({ orca_branch_used: rejects("orca-branch-recent.json を書けません") });
    await waitForCount(".orca-dest-pop .orca-branch-row", 5);
    await mock("orca_overview", onFeatC());
    await branchPick("remote", "origin/feat/d").click();
    expect(await waitForCalls("orca_branch_used")).toHaveLength(1);
    expect(await waitForCalls("orca_switch_branch")).toEqual([{ path: "/work/example-app", kind: "remote", name: "origin/feat/d", environment: null }]);
    await expect($(".orca-dest-pop")).not.toExist();
    await expect($("#orca-files-title")).toHaveText("example-app ・ feat/c");
    await browser.pause(300);
    await expect($(CARDS)).not.toExist();
    // The notice element is always in the page and only hidden when nothing is said.
    await expect($(".toast")).not.toBeDisplayed();
  });

  it("only closes the list on the branch the worktree is on, and calls nothing on a branch in use (A-25)", async () => {
    await openBranches();
    await waitForCount(".orca-dest-pop .orca-branch-row", 5);
    await browser.execute((once) => {
      if (window.__e2e_once__(once)) document.querySelector<HTMLElement>('.orca-dest-pop .orca-branch-row[data-name="main"]')!.click();
    }, onceId());
    await expect($(".orca-dest-pop")).toBeDisplayed();
    await branchPick("local", "feat/a").click();
    await expect($(".orca-dest-pop")).not.toExist();
    await browser.pause(300);
    expect(await callsOf("orca_switch_branch")).toEqual([]);
    await expect($(CARDS)).not.toExist();
  });

  it("says a switch that worked with a warning in a notice and reads again (A-25)", async () => {
    await openBranches({ orca_switch_branch: { branch: "feat/c", warning: "post-checkout hook failed" } });
    await waitForCount(".orca-dest-pop .orca-branch-row", 5);
    const overview = await mock("orca_overview", onFeatC());
    await branchPick("local", "feat/c").click();
    await expect($(".toast")).toHaveText(expect.stringContaining("feat/c に切り替えました: post-checkout hook failed"));
    await waitForCalls(overview);
    await expect($(CARDS)).not.toExist();
    await expect($("#orca-files-title")).toHaveText("example-app ・ feat/c");
  });

  it("shows Orca's refusal on a card, and reads nothing again (A-25)", async () => {
    await openBranches({ orca_switch_branch: rejects("未コミットの変更があるため切り替えられません") });
    await waitForCount(".orca-dest-pop .orca-branch-row", 5);
    const overview = await mock("orca_overview", onFeatC());
    const files = await mock("orca_files_list", root());
    await branchPick("local", "feat/c").click();
    await expect($(CARD)).toHaveText("未コミットの変更があるため切り替えられません");
    await expect($(".orca-dest-pop")).not.toExist();
    await browser.pause(300);
    expect(await callsOf(overview)).toEqual([]);
    expect(await callsOf(files)).toEqual([]);
    await expect($("#orca-files-title")).toHaveText("example-app ・ feat/a");
  });

  it("shows the message of the branches that cannot be read in their section, and the other section stays (A-25)", async () => {
    await openBranches({ orca_local_branches: rejects("worktree が見つかりません") });
    await expect($(".orca-dest-pop .empty.fail")).toHaveText("worktree が見つかりません");
    await waitForCount(".orca-dest-pop .orca-branch-row", 2);
    expect(await branchRows()).toEqual(["origin/feat/a", "origin/feat/d"]);
  });

  // A-27: the history of the file pane. Rust reads the commits and the files of one (`orca_git_history`, `orca_commit_files`) and the diff of a file in a commit (`orca_commit_file_diff`); the page draws them, reads on at the end of the list and opens the diff tab.
  const commitId = (n: number) => `${n.toString(16).padStart(7, "0")}${"b".repeat(33)}`;
  const commitOf = (n: number, subject = `Commit ${n}`): OrcaCommit => ({ id: commitId(n), shortId: commitId(n).slice(0, 7), subject, author: "Alice Example", timeMs: Date.UTC(2024, 9, 17, 12, 0), parents: n > 1 ? [commitId(n - 1)] : [] });
  const page = (from: number, to: number, hasMore: boolean): OrcaCommitList => ({ commits: Array.from({ length: from - to + 1 }, (_, i) => commitOf(from - i)), hasMore, historyToken: "tok-1", historyChanged: false });
  const fileOf = (path: string, extra: Partial<OrcaCommitFile> = {}): OrcaCommitFile => ({ status: "modified", path, oldPath: null, added: 3, removed: 1, ...extra });
  const changedFiles = (files: OrcaCommitFile[], extra: Partial<OrcaCommitFiles> = {}): OrcaCommitFiles => ({ files, total: files.length, parentId: commitId(2), ...extra });
  const paneMode = (label: string) => $(`#orca-files-bar [aria-label="${label}"]`);
  const commitRows = () => count("#orca-history-list .orca-commit");
  const commitRow = (n: number) => $(`#orca-history-list .orca-commit[data-id="${commitId(n)}"]`);
  const historyFile = (path: string) => $(`#orca-history-files .orca-hfile[data-path="${path}"]`);
  const historyFixtures = (extra: Record<string, unknown> = {}) => ({ orca_git_history: page(3, 1, false), orca_commit_files: changedFiles([fileOf("src/a.rs"), fileOf("b.md", { status: "added", added: 10, removed: 0 })]), orca_commit_file_diff: diffOfA(), ...extra });
  async function openHistory(fixtures: Record<string, unknown> = {}) {
    await openFiles(historyFixtures(fixtures));
    await waitForCount("#orca-files-tree .orca-file", 4);
    await paneMode("履歴").click();
    await expect($("#orca-history")).toBeDisplayed();
  }
  const pressTwice = (selector: string) =>
    browser.execute(
      (q, once) => {
        if (!window.__e2e_once__(once)) return;
        document.querySelector(q)!.dispatchEvent(new MouseEvent("dblclick", { bubbles: true, cancelable: true }));
      },
      selector,
      onceId(),
    );

  it("has the buttons of the files, of the history, of the language server, of the database and of Jira in the top row, and shows the files at the start without reading the history (A-27, A-34)", async () => {
    await openFiles(historyFixtures());
    await waitForCount("#orca-files-tree .orca-file", 4);
    const bar = await browser.execute(() => [...document.querySelectorAll<HTMLElement>("#orca-files-bar > button")].map((b) => [b.getAttribute("aria-label"), b.getAttribute("aria-pressed"), b.querySelector("svg") !== null]));
    expect(bar).toEqual([["ファイル", "true", true], ["履歴", "false", true], ["言語サーバー", "false", true], ["データベース", "false", true], ["Jira", "false", true], ["ファイル欄", "true", true]]);
    await expect($("#orca-files-tree")).toBeDisplayed();
    await expect($("#orca-history")).not.toBeDisplayed();
    await expect($("#orca-database")).not.toBeDisplayed();
    expect(await callsOf("orca_git_history")).toEqual([]);
  });

  // A-43: the database part of the file pane. It draws the tree of the database screen (D-3) with the same commands, and reads nothing until it is shown.
  const direct = databaseProfile("p1", "Example direct");
  const tunnel = databaseProfile("p2", "Example tunnel", { script: "exec forward-port", dbHost: "db.internal.example.com" });
  const dbFixtures = (extra: Record<string, unknown> = {}) => ({ database_profiles: [direct, tunnel], database_connections: [], ...extra });
  const dbRow = (key: string) => $(`#orca-database [data-key="${key}"]`);
  const dbDot = (id: string) => $(`#orca-database [data-key="${id}"] .database-dot`);
  const dbNames = () => textsOf("#orca-database .database-btn");
  async function openDatabasePart(extra: Record<string, unknown> = {}) {
    await openFiles(dbFixtures(extra));
    await waitForCount("#orca-files-tree .orca-file", 4);
    await paneMode("データベース").click();
    await waitForCount("#orca-database .database-item", 2);
  }
  // The page's own right button on the row of `key` of the database part.
  const dbRightPress = (key: string) =>
    browser.execute(
      (k, once) => {
        if (!window.__e2e_once__(once)) return;
        const row = document.querySelector(`#orca-database [data-key="${k}"]`)!;
        const r = row.getBoundingClientRect();
        row.dispatchEvent(new MouseEvent("contextmenu", { bubbles: true, cancelable: true, button: 2, clientX: r.left + 40, clientY: r.top + r.height / 2 }));
      },
      key,
      onceId(),
    );

  it("shows the connections of the database screen in the fourth part, reads them when the part is shown, and hides the heading (A-43)", async () => {
    await openFiles(dbFixtures());
    await waitForCount("#orca-files-tree .orca-file", 4);
    expect(await callsOf("database_profiles")).toEqual([]);
    expect(await callsOf("database_connections")).toEqual([]);
    await paneMode("データベース").click();
    await waitForCount("#orca-database .database-item", 2);
    expect(await dbNames()).toEqual(["Example direct", "Example tunnel"]);
    await expect(paneMode("データベース")).toHaveAttribute("aria-pressed", "true");
    await expect(paneMode("ファイル")).toHaveAttribute("aria-pressed", "false");
    await expect($("#orca-database")).toBeDisplayed();
    await expect($("#orca-files-tree")).not.toBeDisplayed();
    await expect($("#orca-history")).not.toBeDisplayed();
    await expect($("#orca-files-head")).not.toBeDisplayed();
    expect(await callsOf("database_profiles")).toEqual([null]);
    expect(await callsOf("database_connections")).toEqual([null]);
    expect(await textsOf("#orca-database")).toEqual(["Example directExample tunnel"]);
    expect(await count("#orca-database [placeholder]")).toBe(0);
    await paneMode("ファイル").click();
    await expect($("#orca-database")).not.toBeDisplayed();
    await expect($("#orca-files-head")).toBeDisplayed();
    await expect($("#orca-files-tree")).toBeDisplayed();
    expect(await callsOf("database_profiles")).toHaveLength(1);
    await paneMode("データベース").click();
    await waitForCalls("database_profiles", 2);
    await expect($("#orca-database")).toBeDisplayed();
  });

  it("marks a connection that Rust holds open with a green dot and a closed row, and opens it with the press (A-43)", async () => {
    await openDatabasePart({ database_connections: ["p2"], database_connect: ["shop"] });
    await expect(dbDot("p2")).toHaveAttribute("data-state", "connected");
    await expect(dbDot("p1")).toHaveAttribute("data-state", "closed");
    await expect(dbRow("p2")).toHaveAttribute("aria-expanded", "false");
    expect(await count("#orca-database .database-children")).toBe(0);
    await dbRow("p2").click();
    expect(await waitForCalls("database_connect")).toEqual([{ id: "p2" }]);
    await waitForCount("#orca-database .database-children .database-btn", 1);
  });

  it("opens a connection and a database with the commands of D-3, and closes the rows with the next press (A-43)", async () => {
    await openDatabasePart({ database_connect: ["information_schema", "shop"], database_tables: [databaseTable("orders"), databaseTable("users")] });
    await dbRow("p1").click();
    expect(await waitForCalls("database_connect")).toEqual([{ id: "p1" }]);
    await waitForCount("#orca-database .database-children .database-btn", 2);
    expect(await dbNames()).toEqual(["Example direct", "information_schema", "shop", "Example tunnel"]);
    await expect(dbDot("p1")).toHaveAttribute("data-state", "connected");
    await expect(dbRow("p1")).toHaveAttribute("aria-expanded", "true");
    await expect(dbRow("p1")).toHaveAttribute("aria-pressed", "true");
    await dbRow("p1/d/shop").click();
    expect(await waitForCalls("database_tables")).toEqual([{ id: "p1", database: "shop" }]);
    await waitForCount("#orca-database [data-key^='p1/d/shop/t/']", 2);
    expect(await dbNames()).toEqual(["Example direct", "information_schema", "shop", "orders", "users", "Example tunnel"]);
    await dbRow("p1/d/shop").click();
    await expect(dbRow("p1/d/shop")).toHaveAttribute("aria-expanded", "false");
    expect(await count("#orca-database [data-key^='p1/d/shop/t/']")).toBe(0);
    await dbRow("p1").click();
    await expect(dbRow("p1")).toHaveAttribute("aria-expanded", "false");
    await expect(dbDot("p1")).toHaveAttribute("data-state", "connected");
    expect(await count("#orca-database .database-children")).toBe(0);
    await browser.pause(200);
    expect(await callsOf("database_connect")).toHaveLength(1);
    expect(await callsOf("database_tables")).toHaveLength(1);
  });

  it("shows the error of a connection that cannot be opened and opens it again at the next press (A-43)", async () => {
    await openDatabasePart({ database_connect: { __e2e_reject__: "接続できません" } });
    await dbRow("p1").click();
    await waitForCount("#orca-database .database-note.danger", 1);
    expect(await textsOf("#orca-database .database-note.danger")).toEqual(["接続できません"]);
    await expect(dbDot("p1")).toHaveAttribute("data-state", "closed");
    await mock("database_connect", ["shop"]);
    await dbRow("p1").click();
    await waitForCount("#orca-database .database-children .database-btn", 1);
    expect(await count("#orca-database .database-note.danger")).toBe(0);
  });

  it("clears the error of a connection and of a read of tables with the × at its right end, calls nothing, and reads again at the next press (A-43)", async () => {
    await openDatabasePart({ database_connect: { __e2e_reject__: "接続できません" }, database_disconnect: null });
    await dbRow("p1").click();
    await waitForCount("#orca-database .database-note.danger", 1);
    const clear = $("#orca-database .database-note.danger button.icon-btn");
    await expect(clear).toHaveAttribute("aria-label", "エラーを消す");
    expect(await clear.getText()).toBe("");
    await clear.click();
    await waitForCount("#orca-database .database-note.danger", 0);
    await expect(dbDot("p1")).toHaveAttribute("data-state", "closed");
    expect(await callsOf("database_connect")).toHaveLength(1);
    await mock("database_connect", ["shop"]);
    await mock("database_tables", { __e2e_reject__: "MySQL がエラーを返しました (1142): SELECT command denied" });
    // Rust still holds the session, so the failed read is not a lost connection (D-3).
    await mock("database_connections", ["p1"]);
    await dbRow("p1").click();
    await waitForCount("#orca-database .database-children .database-btn", 1);
    await dbRow("p1/d/shop").click();
    await waitForCount("#orca-database .database-note.danger", 1);
    await $("#orca-database .database-note.danger button.icon-btn").click();
    await waitForCount("#orca-database .database-note.danger", 0);
    await expect(dbDot("p1")).toHaveAttribute("data-state", "connected");
    expect(await callsOf("database_tables")).toHaveLength(1);
    expect(await callsOf("database_disconnect")).toHaveLength(0);
    await mock("database_tables", [databaseTable("orders")]);
    await dbRow("p1/d/shop").click();
    await waitForCount("#orca-database [data-key^='p1/d/shop/t/']", 1);
  });

  it("draws the last line of the script while a connection opens, and drops the line of a connection that is not opening (A-43)", async () => {
    await openDatabasePart({ database_connect: holds });
    await dbRow("p1").click();
    await waitForCalls("database_connect");
    await expect($("#orca-database .database-note")).toHaveText("接続中…");
    await emitEvent("database-script-output", { id: "p2", line: "of another connection" });
    await emitEvent("database-script-output", { id: "p1", line: "<b>forwarding</b> port 3307" });
    await expect($("#orca-database .database-note")).toHaveText("<b>forwarding</b> port 3307");
    expect(await count("#orca-database .database-note b")).toBe(0);
    await expect(dbDot("p1")).toHaveAttribute("data-state", "connecting");
    await release("database_connect", ["shop"]);
    await waitForCount("#orca-database .database-children .database-btn", 1);
    expect(await count("#orca-database .database-note")).toBe(0);
    await emitEvent("database-script-output", { id: "p1", line: "late" });
    await browser.pause(200);
    expect(await count("#orca-database .database-note")).toBe(0);
  });

  it("draws the last line of the script when a connection that this part holds open is opened again, in place of 読み込み中… (A-43)", async () => {
    await openDatabasePart({ database_connect: ["shop"] });
    await dbRow("p1").click();
    await waitForCount("#orca-database .database-children .database-btn", 1);
    await dbRow("p1").click();
    await waitForCount("#orca-database .database-children", 0);
    await mock("database_connect", holds);
    await dbRow("p1").click();
    await waitForCalls("database_connect");
    await expect($("#orca-database .database-note")).toHaveText("読み込み中…");
    await emitEvent("database-script-output", { id: "p1", line: "forwarding port 3307" });
    await expect($("#orca-database .database-note")).toHaveText("forwarding port 3307");
    // The line is put into the note in place: the tree is not made again for each line.
    await browser.execute(() => {
      (document.querySelector("#orca-database .database-note") as HTMLElement & { kept?: boolean }).kept = true;
    });
    await emitEvent("database-script-output", { id: "p1", line: "second" });
    await expect($("#orca-database .database-note")).toHaveText("second");
    expect(await browser.execute(() => (document.querySelector("#orca-database .database-note") as HTMLElement & { kept?: boolean }).kept === true)).toBe(true);
    await release("database_connect", ["shop"]);
    await waitForCount("#orca-database .database-children .database-btn", 1);
    expect(await count("#orca-database .database-note")).toBe(0);
  });

  it("has a menu on a connection with the disconnect only while it is open, and on a database with the new query and the close (A-43)", async () => {
    await openDatabasePart({ database_connect: ["shop"], database_tables: [databaseTable("orders")], database_disconnect: null });
    await dbRightPress("p1");
    await browser.pause(200);
    expect(await count(".menu")).toBe(0);
    await dbRow("p1").click();
    await waitForCount("#orca-database .database-children .database-btn", 1);
    await dbRow("p1/d/shop").click();
    await waitForCount("#orca-database [data-key='p1/d/shop/t/orders']", 1);
    await dbRightPress("p1/d/shop/t/orders");
    await browser.pause(200);
    expect(await count(".menu")).toBe(0);
    await dbRightPress("p1/d/shop");
    await expect($('.menu[role="menu"]')).toBeDisplayed();
    expect(await textsOf('.menu button[role="menuitem"]')).toEqual(["新規クエリ", "データベースを閉じる"]);
    await $('.menu button[role="menuitem"]:last-child').click();
    expect(await count("#orca-database [data-key^='p1/d/shop/t/']")).toBe(0);
    await expect(dbDot("p1")).toHaveAttribute("data-state", "connected");
    expect(await callsOf("database_disconnect")).toEqual([]);
    await dbRightPress("p1");
    expect(await textsOf('.menu button[role="menuitem"]')).toEqual(["切断"]);
    await $('.menu button[role="menuitem"]').click();
    expect(await waitForCalls("database_disconnect")).toEqual([{ id: "p1" }]);
    await expect(dbDot("p1")).toHaveAttribute("data-state", "closed");
    expect(await count("#orca-database .database-children")).toBe(0);
    await expect(dbRow("p1")).toHaveAttribute("aria-pressed", "true");
  });

  it("has the disconnect in the menu of a connection that is opening, and disconnects it, and draws nothing of the answer that comes after (A-43)", async () => {
    await openDatabasePart({ database_connect: holds, database_disconnect: null });
    await dbRow("p1").click();
    await waitForCalls("database_connect");
    await emitEvent("database-script-output", { id: "p1", line: "forwarding port 3307" });
    await expect($("#orca-database .database-note")).toHaveText("forwarding port 3307");
    await expect(dbDot("p1")).toHaveAttribute("data-state", "connecting");
    await dbRightPress("p1");
    expect(await textsOf('.menu button[role="menuitem"]')).toEqual(["切断"]);
    await $('.menu button[role="menuitem"]').click();
    expect(await waitForCalls("database_disconnect")).toEqual([{ id: "p1" }]);
    await expect(dbDot("p1")).toHaveAttribute("data-state", "closed");
    expect(await count("#orca-database .database-note")).toBe(0);
    // The answer of an opening that was already done.
    await release("database_connect", ["shop"]);
    await browser.pause(300);
    expect(await count("#orca-database .database-children")).toBe(0);
    await expect(dbDot("p1")).toHaveAttribute("data-state", "closed");
    // The answer of an opening that Rust stopped.
    await dbRow("p1").click();
    await waitForCalls("database_connect", 2);
    await dbRightPress("p1");
    await $('.menu button[role="menuitem"]').click();
    await waitForCalls("database_disconnect", 2);
    await release("database_connect", rejects("接続を切断しました"));
    await browser.pause(300);
    expect(await count("#orca-database .database-note")).toBe(0);
    await expect(dbDot("p1")).toHaveAttribute("data-state", "closed");
    // The next press opens it, and only its own answer is drawn.
    await mock("database_connect", ["shop"]);
    await dbRow("p1").click();
    await waitForCount("#orca-database .database-children .database-btn", 1);
    await expect(dbDot("p1")).toHaveAttribute("data-state", "connected");
  });

  // A-43: a table, and the SQL of a database, as tabs of the work pane. The tab draws the body of the database screen (D-4 to D-6) and calls its commands.
  const shopRecords = databaseRecords(["id", "name"], [[databaseCell("1", "number"), databaseCell("Alice")]], { summary: "1–1 行目", tsv: "id\tname\n1\tAlice" });
  const dbTabs = () => textsOf('.orca-tab[data-database="true"] .orca-tab-title');
  const dbTabId = () => browser.execute(() => [...document.querySelectorAll<HTMLElement>('.orca-tab[data-database="true"]')].map((t) => t.dataset.tab));
  const dbCells = () => browser.execute(() => [...document.querySelectorAll(".orca-database-tab .database-grid tbody tr")].map((tr) => [...tr.children].map((td) => td.textContent)));
  // The tree of the part open on the connection p1, its database shop and its two tables.
  async function openShop(extra: Record<string, unknown> = {}) {
    await openDatabasePart({ database_connect: ["shop"], database_tables: [databaseTable("orders"), databaseTable("users")], database_records: shopRecords, ...extra });
    await dbRow("p1").click();
    await waitForCount("#orca-database .database-children .database-btn", 1);
    await dbRow("p1/d/shop").click();
    await waitForCount("#orca-database [data-key^='p1/d/shop/t/']", 2);
  }
  const typeSql = (add: string) =>
    browser.execute(
      (t, once) => {
        if (!window.__e2e_once__(once)) return;
        const area = document.querySelector<HTMLTextAreaElement>(".orca-database-tab [data-key='sql-input']")!;
        area.value = t;
        area.dispatchEvent(new Event("input", { bubbles: true }));
      },
      add,
      onceId(),
    );

  it("opens a table of the database part as a tab named after the table and the connection, selected, with its records read (A-43)", async () => {
    await openShop();
    expect(await callsOf("database_records")).toEqual([]);
    await dbRow("p1/d/shop/t/orders").click();
    expect(await waitForCalls("database_records")).toEqual([{ id: "p1", database: "shop", table: "orders", page: 0, estimate: null }]);
    await waitForCount(".orca-database-tab .database-grid", 1);
    expect(await dbTabs()).toEqual(["orders · Example direct"]);
    await expect(selectedTab()).toHaveText("orders · Example direct");
    await expect($(".orca-database-tab .database-work-title")).toHaveText("shop.orders");
    expect(await textsOf(".orca-database-tab .database-tab")).toEqual(["レコード", "構造", "SQL"]);
    expect(await dbCells()).toEqual([["1", "Alice"]]);
    await expect($(".orca-database-tab .database-range")).toHaveText("1–1 行目");
    await expect(dbRow("p1/d/shop/t/orders")).toHaveAttribute("aria-pressed", "true");
    expect(await count("#orca-database [placeholder]")).toBe(0);
    // The records of this tab are read only: none of the buttons that write (D-10), and no field in a cell.
    expect(await count('.orca-database-tab [data-key="remove"], .orca-database-tab [data-key="apply"], .orca-database-tab [data-key="revert"]')).toBe(0);
    await $(".orca-database-tab .database-grid tbody tr:first-child td:nth-child(2)").doubleClick();
    expect(await count(".orca-database-tab .database-cell input")).toBe(0);
  });

  it("opens a table that is open already by selecting its tab and reading its first page again, and another table as another tab (A-43)", async () => {
    await openShop();
    await dbRow("p1/d/shop/t/orders").click();
    await waitForCalls("database_records");
    await waitForCount(".orca-database-tab .database-grid", 1);
    await dbRow("p1/d/shop/t/users").click();
    await waitForCalls("database_records", 2);
    await waitForCount(".orca-database-tab .database-grid", 1);
    expect(await dbTabs()).toEqual(["orders · Example direct", "users · Example direct"]);
    await expect($(".orca-database-tab .database-work-title")).toHaveText("shop.users");
    await dbRow("p1/d/shop/t/orders").click();
    await waitForCalls("database_records", 3);
    expect(await dbTabs()).toEqual(["orders · Example direct", "users · Example direct"]);
    await expect($(".orca-database-tab .database-work-title")).toHaveText("shop.orders");
    expect((await callsOf("database_records")).map((c) => (c as { table: string }).table)).toEqual(["orders", "users", "orders"]);
  });

  it("reads the structure at every press of 構造 and runs the SQL of the tab with the connection and database of the table, with no other call (A-43)", async () => {
    await openShop({ database_structure: databaseStructure([databaseColumn("id", "int")]), database_sql: databaseSqlResult(["n"], [[databaseCell("1", "number")]]) });
    await dbRow("p1/d/shop/t/orders").click();
    await waitForCount(".orca-database-tab .database-grid", 1);
    await $('.orca-database-tab [data-tab="structure"]').click();
    expect(await waitForCalls("database_structure")).toEqual([{ id: "p1", database: "shop", table: "orders" }]);
    await waitForCount(".orca-database-tab .database-structure", 1);
    await $('.orca-database-tab [data-tab="records"]').click();
    await $('.orca-database-tab [data-tab="structure"]').click();
    await waitForCalls("database_structure", 2);
    await $('.orca-database-tab [data-tab="sql"]').click();
    await typeSql("select 1");
    await $('.orca-database-tab [data-key="run"]').click();
    expect(await waitForCalls("database_sql")).toEqual([{ id: "p1", database: "shop", sql: "select 1" }]);
    await waitForCount(".orca-database-tab .database-grid", 1);
    expect(await callsOf("database_records")).toHaveLength(1);
  });

  it("closes the tab with its close button, calls nothing, and drops a read that ends after the tab was closed (A-43)", async () => {
    await openShop({ database_records: holds });
    await dbRow("p1/d/shop/t/orders").click();
    await waitForCalls("database_records");
    await expect($(".orca-database-tab")).toExist();
    await $('.orca-tab[data-database="true"] .orca-tab-close').click();
    await expect($('.orca-tab[data-database="true"]')).not.toExist();
    await expect($(".orca-database-tab")).not.toExist();
    expect(await tabTitles()).toEqual(["Write the docs"]);
    await release("database_records", shopRecords);
    await browser.pause(300);
    await expect($(".orca-database-tab")).not.toExist();
    expect(await count(CARDS)).toBe(0);
    expect(await callsOf("database_disconnect")).toEqual([]);
    expect(await callsOf("database_connect")).toHaveLength(1);
    await dbRow("p1/d/shop/t/orders").click();
    await waitForCalls("database_records", 2);
    expect(await dbTabs()).toEqual(["orders · Example direct"]);
  });

  it("closes the tabs of a connection that is disconnected, and keeps the connection's row (A-43)", async () => {
    await openShop({ database_disconnect: null });
    await dbRow("p1/d/shop/t/orders").click();
    await waitForCount(".orca-database-tab .database-grid", 1);
    await dbRightPress("p1");
    await $('.menu button[role="menuitem"]').click();
    expect(await waitForCalls("database_disconnect")).toEqual([{ id: "p1" }]);
    await expect($('.orca-tab[data-database="true"]')).not.toExist();
    await expect($(".orca-database-tab")).not.toExist();
    await expect(dbDot("p1")).toHaveAttribute("data-state", "closed");
  });

  it("opens the SQL of a database from its menu as a tab of its own, with no call and the field focused, and runs it (A-43)", async () => {
    await openShop({ database_sql: databaseSqlResult(["n"], [[databaseCell("1", "number")]]) });
    await dbRightPress("p1/d/shop");
    expect(await textsOf('.menu button[role="menuitem"]')).toEqual(["新規クエリ", "データベースを閉じる"]);
    await $('.menu button[role="menuitem"]:first-child').click();
    await waitForCount(".orca-database-tab [data-key='sql-input']", 1);
    expect(await dbTabs()).toEqual(["SQL · shop · Example direct"]);
    await expect($(".orca-database-tab .database-work-title")).toHaveText("shop");
    expect(await count(".orca-database-tab .database-tab")).toBe(0);
    expect(await browser.execute(() => (document.activeElement as HTMLElement | null)?.dataset.key)).toBe("sql-input");
    expect(await callsOf("database_sql")).toEqual([]);
    expect(await callsOf("database_records")).toEqual([]);
    await typeSql("select 1");
    await $('.orca-database-tab [data-key="run"]').click();
    expect(await waitForCalls("database_sql")).toEqual([{ id: "p1", database: "shop", sql: "select 1" }]);
    await waitForCount(".orca-database-tab .database-grid", 1);
    // A second new query is a second tab, with its own empty field.
    await dbRightPress("p1/d/shop");
    await $('.menu button[role="menuitem"]:first-child').click();
    await browser.waitUntil(async () => (await dbTabs()).length === 2, { timeoutMsg: "the second tab never opened" });
    expect(await count(".orca-database-tab .database-grid")).toBe(0);
    expect(await browser.execute(() => document.querySelector<HTMLTextAreaElement>(".orca-database-tab [data-key='sql-input']")!.value)).toBe("");
  });

  it("splits a database tab from the work pane like any tab (A-43, A-17)", async () => {
    await openShop();
    await dbRow("p1/d/shop/t/orders").click();
    await waitForCount(".orca-database-tab .database-grid", 1);
    const [id] = (await dbTabId()) as string[];
    await rightClickTab(id);
    expect(await textsOf('.menu[role="menu"] > *')).toEqual(["右に分割", "下に分割", "別ウィンドウで開く"]);
    await pickItem("右に分割");
    const asked = (await callsOf("orca_panes")).map((c) => (c as { op: { kind?: string; tab?: string; edge?: string } | null }).op);
    expect(asked).toContainEqual({ kind: "move", tab: id, pane: "p1", edge: "right" });
  });


  // A-46: a database tab in a window of its own, with the conditions to read it again (the table, its tab, the page of its records and the text of its SQL).
  it("opens a table in a window with its connection, database, table, tab and page, and the tab leaves the panes (A-46)", async () => {
    await openShop();
    await dbRow("p1/d/shop/t/orders").click();
    await waitForCount(".orca-database-tab .database-grid", 1);
    const [id] = (await dbTabId()) as string[];
    await rightClickTab(id);
    await pickItem("別ウィンドウで開く");
    expect(await waitForCalls("orca_popout_open")).toEqual([{ tab: popoutTab(id, "", "orders · Example direct", { label: "", content: { kind: "database", connection: "p1", name: "Example direct", database: "shop", table: "orders", tab: "records", page: 0, sql: "" } }) }]);
    await browser.waitUntil(async () => (await dbTabs()).length === 0, { timeoutMsg: "the tab never left the strip" });
    await expect($(".orca-database-tab")).not.toBeDisplayed();
  });

  it("opens the SQL of a database in a window with the text that was typed (A-46)", async () => {
    await openShop();
    await dbRightPress("p1/d/shop");
    await $('.menu button[role="menuitem"]:first-child').click();
    await waitForCount(".orca-database-tab [data-key='sql-input']", 1);
    await typeSql("select 1");
    const [id] = (await dbTabId()) as string[];
    await rightClickTab(id);
    await pickItem("別ウィンドウで開く");
    expect(await waitForCalls("orca_popout_open")).toEqual([{ tab: popoutTab(id, "", "SQL · shop · Example direct", { label: "", content: { kind: "database", connection: "p1", name: "Example direct", database: "shop", table: null, tab: "sql", page: 0, sql: "select 1" } }) }]);
  });

  it("closes the tabs of a connection that a window found lost, the window's too, as it does for a connection that its own tab found lost (A-46)", async () => {
    await openShop();
    await dbRow("p1/d/shop/t/orders").click();
    await waitForCount(".orca-database-tab .database-grid", 1);
    const [id] = (await dbTabId()) as string[];
    await rightClickTab(id);
    await pickItem("別ウィンドウで開く");
    await waitForCalls("orca_popout_open");
    const open = await mock("database_connections", []);
    await sendPopout({ kind: "lost", tab: id, connection: "p1", error: "接続が切れました" });
    await waitForCalls(open);
    expect(await waitForCalls("orca_popout_end")).toEqual([{ tab: id }]);
    await expect(dbRow("p1/d/shop")).not.toBeExisting();
  });

  it("reads the history and the files of a commit in the environment of the worktree's row, whatever target the screen holds (A-27)", async () => {
    const studioMac = onThisMachine(orcaOverview(sample(), worktrees(), studio), "example-app");
    await openFiles(historyFixtures(), studioMac);
    await waitForCount("#orca-files-tree .orca-file", 4);
    await paneMode("履歴").click();
    expect(await waitForCalls("orca_git_history")).toEqual([{ path: "/work/example-app", limit: 50, skip: 0, historyToken: null, environment: null }]);
    await waitForCount("#orca-history-list .orca-commit", 3);
    await commitRow(3).click();
    expect(await waitForCalls("orca_commit_files")).toEqual([{ path: "/work/example-app", commitId: commitId(3), environment: null }]);
  });

  it("switches to the history, which is read with the worktree and the first 50 commits, and back to the files, which are not read again (A-27)", async () => {
    await openHistory();
    await expect(paneMode("履歴")).toHaveAttribute("aria-pressed", "true");
    await expect(paneMode("ファイル")).toHaveAttribute("aria-pressed", "false");
    await expect($("#orca-files-tree")).not.toBeDisplayed();
    await expect($("#orca-files-title")).toHaveText("example-app ・ feat/a");
    expect(await waitForCalls("orca_git_history")).toEqual([{ path: "/work/example-app", limit: 50, skip: 0, historyToken: null, environment: null }]);
    const files = await mock("orca_files_list", root());
    const history = await mock("orca_git_history", page(3, 1, false));
    await paneMode("ファイル").click();
    await expect($("#orca-files-tree")).toBeDisplayed();
    await expect($("#orca-history")).not.toBeDisplayed();
    await paneMode("履歴").click();
    await waitForCount("#orca-history-list .orca-commit", 3);
    await browser.pause(200);
    expect(await callsOf(files)).toEqual([]);
    expect(await callsOf(history)).toEqual([]);
  });

  it("lists the commits in the order given with the subject, the short id and the time (A-27)", async () => {
    await openHistory();
    await waitForCount("#orca-history-list .orca-commit", 3);
    expect(await textsOf("#orca-history-list .orca-commit-subject")).toEqual(["Commit 3", "Commit 2", "Commit 1"]);
    expect(await textsOf("#orca-history-list .orca-commit-id")).toEqual(["0000003", "0000002", "0000001"]);
    expect(await textsOf("#orca-history-list .orca-commit-time")).toEqual(["2024/10/17", "2024/10/17", "2024/10/17"]);
    await expect($("#orca-history-files .orca-hfile")).not.toExist();
    await expect($(CARDS)).not.toExist();
  });

  it("reads the next commits at the end of the list with the number read so far as skip and the token of the first answer, and stops when there are no more (A-27)", async () => {
    await openFiles(historyFixtures({ orca_git_history: holds }));
    await waitForCount("#orca-files-tree .orca-file", 4);
    await paneMode("履歴").click();
    await waitForCalls("orca_git_history");
    await release("orca_git_history", page(120, 71, true));
    await waitForCount("#orca-history-list .orca-commit", 50);
    await browser.pause(300);
    expect(await callsOf("orca_git_history")).toHaveLength(1);
    const toEnd = () =>
      browser.execute(() => {
        const l = document.getElementById("orca-history-list")!;
        l.scrollTop = l.scrollHeight;
      });
    await toEnd();
    expect(await waitForCalls("orca_git_history", 2)).toEqual([
      { path: "/work/example-app", limit: 50, skip: 0, historyToken: null, environment: null },
      { path: "/work/example-app", limit: 50, skip: 50, historyToken: "tok-1", environment: null },
    ]);
    await release("orca_git_history", page(70, 21, true));
    await waitForCount("#orca-history-list .orca-commit", 100);
    await toEnd();
    await waitForCalls("orca_git_history", 3);
    await release("orca_git_history", page(20, 18, false));
    await waitForCount("#orca-history-list .orca-commit", 103);
    expect((await callsOf("orca_git_history"))[2]).toEqual({ path: "/work/example-app", limit: 50, skip: 100, historyToken: "tok-1", environment: null });
    await toEnd();
    await browser.pause(300);
    expect(await callsOf("orca_git_history")).toHaveLength(3);
  });

  it("adds the next commits under the rows there are, and a click draws no row of the list again (A-27)", async () => {
    await openHistory();
    await waitForCount("#orca-history-list .orca-commit", 3);
    const mark = () =>
      browser.execute(() => {
        for (const row of document.querySelectorAll("#orca-history-list .orca-commit")) (row as HTMLElement & { kept?: boolean }).kept = true;
      });
    const kept = () => browser.execute(() => [...document.querySelectorAll("#orca-history-list .orca-commit")].filter((row) => (row as HTMLElement & { kept?: boolean }).kept === true).length);
    await mark();
    await commitRow(3).click();
    await waitForCount("#orca-history-files .orca-hfile", 2);
    await historyFile("src/a.rs").click();
    await expect(historyFile("src/a.rs")).toHaveAttribute("aria-pressed", "true");
    await commitRow(2).click();
    await expect(commitRow(2)).toHaveAttribute("aria-pressed", "true");
    await expect(commitRow(3)).toHaveAttribute("aria-pressed", "false");
    expect(await kept()).toBe(3);
  });

  it("draws a commit that Orca gives twice once (A-27)", async () => {
    await openFiles(historyFixtures({ orca_git_history: holds }));
    await waitForCount("#orca-files-tree .orca-file", 4);
    await paneMode("履歴").click();
    await waitForCalls("orca_git_history");
    await release("orca_git_history", page(60, 11, true));
    await waitForCount("#orca-history-list .orca-commit", 50);
    await browser.execute(() => {
      const l = document.getElementById("orca-history-list")!;
      l.scrollTop = l.scrollHeight;
    });
    await waitForCalls("orca_git_history", 2);
    await release("orca_git_history", page(12, 8, false));
    await waitForCount("#orca-history-list .orca-commit", 53);
    expect(await count(`#orca-history-list .orca-commit[data-id="${commitId(11)}"]`)).toBe(1);
  });

  it("reads the list again from the start when Orca no longer holds the history it began (A-27)", async () => {
    await openFiles(historyFixtures({ orca_git_history: holds }));
    await waitForCount("#orca-files-tree .orca-file", 4);
    await paneMode("履歴").click();
    await waitForCalls("orca_git_history");
    await release("orca_git_history", page(60, 11, true));
    await waitForCount("#orca-history-list .orca-commit", 50);
    await browser.execute(() => {
      const l = document.getElementById("orca-history-list")!;
      l.scrollTop = l.scrollHeight;
    });
    await waitForCalls("orca_git_history", 2);
    await release("orca_git_history", { commits: [], hasMore: false, historyToken: "tok-1", historyChanged: true });
    await waitForCalls("orca_git_history", 3);
    expect((await callsOf("orca_git_history"))[2]).toEqual({ path: "/work/example-app", limit: 50, skip: 0, historyToken: null, environment: null });
    await release("orca_git_history", { ...page(5, 1, false), historyToken: "tok-2" });
    await waitForCount("#orca-history-list .orca-commit", 5);
  });

  it("reads the files of the commit pressed, with its full id, and draws their marks, names and counts (A-27)", async () => {
    const files = changedFiles([fileOf("src/a.rs"), fileOf("b.md", { status: "added", added: 10, removed: 0 }), fileOf("c.png", { status: "modified", added: null, removed: null }), fileOf("docs/new.md", { status: "renamed", oldPath: "old.md", added: 0, removed: 0 })], { total: 7 });
    await openHistory({ orca_commit_files: files });
    await waitForCount("#orca-history-list .orca-commit", 3);
    await commitRow(3).click();
    expect(await waitForCalls("orca_commit_files")).toEqual([{ path: "/work/example-app", commitId: commitId(3), environment: null }]);
    await waitForCount("#orca-history-files .orca-hfile", 4);
    await expect(commitRow(3)).toHaveAttribute("aria-pressed", "true");
    await expect(commitRow(2)).toHaveAttribute("aria-pressed", "false");
    const rows = await browser.execute(() =>
      [...document.querySelectorAll<HTMLElement>("#orca-history-files .orca-hfile")].map((r) => [r.dataset.status, r.querySelector(".orca-hfile-st")!.textContent, r.querySelector(".orca-hfile-name")!.textContent, r.querySelector(".orca-hfile-dir")!.textContent, r.querySelector(".orca-hfile-n")!.textContent, r.title]),
    );
    expect(rows).toEqual([
      ["modified", "M", "a.rs", "src", "+3−1", "src/a.rs"],
      ["added", "A", "b.md", "", "+10−0", "b.md"],
      ["modified", "M", "c.png", "", "", "c.png"],
      ["renamed", "R", "new.md", "docs", "+0−0", "old.md → docs/new.md"],
    ]);
    // More files than the list holds: the rest is counted.
    await expect($("#orca-history-files .orca-file-note")).toHaveText("ほか 3 件");
    await commitRow(2).click();
    await waitForCalls("orca_commit_files", 2);
    expect((await callsOf("orca_commit_files"))[1]).toEqual({ path: "/work/example-app", commitId: commitId(2), environment: null });
    await expect(commitRow(2)).toHaveAttribute("aria-pressed", "true");
  });

  it("drops the files that come for a commit that is not the chosen one any more (A-27)", async () => {
    await openHistory({ orca_commit_files: holds });
    await waitForCount("#orca-history-list .orca-commit", 3);
    await commitRow(3).click();
    await waitForCalls("orca_commit_files");
    await commitRow(2).click();
    await waitForCalls("orca_commit_files", 2);
    await release("orca_commit_files", changedFiles([fileOf("stale.rs")]));
    await browser.pause(200);
    await expect($("#orca-history-files .orca-hfile")).not.toExist();
    await release("orca_commit_files", changedFiles([fileOf("fresh.rs")]));
    await waitForCount("#orca-history-files .orca-hfile", 1);
    expect(await textsOf("#orca-history-files .orca-hfile-name")).toEqual(["fresh.rs"]);
  });

  it("opens the diff of a file of the commit as a tab on a double press, with the parent, the commit and the path, and the short id in the heading and the tab (A-27)", async () => {
    await openHistory();
    await waitForCount("#orca-history-list .orca-commit", 3);
    await commitRow(3).click();
    await waitForCount("#orca-history-files .orca-hfile", 2);
    // A single press only chooses the file.
    await historyFile("src/a.rs").click();
    await expect(historyFile("src/a.rs")).toHaveAttribute("aria-pressed", "true");
    expect(await callsOf("orca_commit_file_diff")).toEqual([]);
    await pressTwice('#orca-history-files .orca-hfile[data-path="src/a.rs"]');
    expect(await waitForCalls("orca_commit_file_diff")).toEqual([{ path: "/work/example-app", commitId: commitId(3), parentId: commitId(2), relative: "src/a.rs", oldRelative: null, environment: null }]);
    expect(await callsOf("orca_file_diff")).toEqual([]);
    await expect(tabOf("diff:1")).toBeDisplayed();
    expect(await tabTitles()).toEqual(["Write the docs", "a.rs 0000003"]);
    await expect(tabOf("diff:1").$(".orca-tab-btn")).toHaveAttribute("aria-selected", "true");
    await expect($(".orca-diff .orca-edit-path")).toHaveText("src/a.rs");
    await expect($(".orca-diff .orca-diff-commit")).toHaveText("0000003");
    await expect($(".orca-diff-count")).toHaveText("変更 2 件");
    await waitForCount(".orca-diff-rows .odf-row", 7);
    await expect($(CARDS)).not.toExist();
  });

  it("selects the diff tab that is open for the same file of the same commit and reads it again, and opens another tab for another commit (A-27)", async () => {
    await openHistory();
    await waitForCount("#orca-history-list .orca-commit", 3);
    await commitRow(3).click();
    await waitForCount("#orca-history-files .orca-hfile", 2);
    await pressTwice('#orca-history-files .orca-hfile[data-path="src/a.rs"]');
    await waitForCalls("orca_commit_file_diff");
    await pressTwice('#orca-history-files .orca-hfile[data-path="src/a.rs"]');
    await waitForCalls("orca_commit_file_diff", 2);
    expect(await tabTitles()).toEqual(["Write the docs", "a.rs 0000003"]);
    const calls = await callsOf("orca_commit_file_diff");
    expect(calls[1]).toEqual(calls[0]);
    await commitRow(2).click();
    await waitForCalls("orca_commit_files", 2);
    await waitForCount("#orca-history-files .orca-hfile", 2);
    await pressTwice('#orca-history-files .orca-hfile[data-path="src/a.rs"]');
    await waitForCalls("orca_commit_file_diff", 3);
    expect(await tabTitles()).toEqual(["Write the docs", "a.rs 0000003", "a.rs 0000002"]);
  });

  it("sends no parent for the first commit and the old path for a renamed file, and Enter opens the diff too (A-27)", async () => {
    const first = changedFiles([fileOf("docs/new.md", { status: "renamed", oldPath: "old.md" })], { parentId: null });
    await openHistory({ orca_commit_files: first });
    await waitForCount("#orca-history-list .orca-commit", 3);
    await commitRow(1).click();
    await waitForCount("#orca-history-files .orca-hfile", 1);
    await browser.execute((once) => {
      if (!window.__e2e_once__(once)) return;
      document.querySelector<HTMLElement>('#orca-history-files .orca-hfile[data-path="docs/new.md"]')!.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true, cancelable: true }));
    }, onceId());
    expect(await waitForCalls("orca_commit_file_diff")).toEqual([{ path: "/work/example-app", commitId: commitId(1), parentId: null, relative: "docs/new.md", oldRelative: "old.md", environment: null }]);
  });

  it("repeats the call of the commit when the diff tab is read again (A-27)", async () => {
    await openHistory();
    await waitForCount("#orca-history-list .orca-commit", 3);
    await commitRow(3).click();
    await waitForCount("#orca-history-files .orca-hfile", 2);
    await pressTwice('#orca-history-files .orca-hfile[data-path="b.md"]');
    await waitForCount(".orca-diff-rows .odf-row", 7);
    await diffButton("読み直す").click();
    await waitForCalls("orca_commit_file_diff", 2);
    const calls = await callsOf("orca_commit_file_diff");
    expect(calls[1]).toEqual({ path: "/work/example-app", commitId: commitId(3), parentId: commitId(2), relative: "b.md", oldRelative: null, environment: null });
    expect(await callsOf("orca_file_diff")).toEqual([]);
  });

  it("shows the reason in place of the rows when the diff of the commit cannot be read (A-27)", async () => {
    await openHistory({ orca_commit_file_diff: rejects("バイナリのファイルの差分は表示できません") });
    await waitForCount("#orca-history-list .orca-commit", 3);
    await commitRow(3).click();
    await waitForCount("#orca-history-files .orca-hfile", 2);
    await pressTwice('#orca-history-files .orca-hfile[data-path="b.md"]');
    await expect($(".orca-diff .orca-empty")).toHaveText("バイナリのファイルの差分は表示できません");
    await expect($(CARDS)).not.toExist();
  });

  it("shows the reason of a list that cannot be read, and the next return of the focus reads it again from the start (A-27)", async () => {
    await openHistory({ orca_git_history: rejects("Git の履歴を読めません") });
    await expect($("#orca-history-list .orca-file-note.fail")).toHaveText("Git の履歴を読めません");
    await expect($(CARDS)).not.toExist();
    await browser.pause(300);
    expect(await callsOf("orca_git_history")).toHaveLength(1);
    await mock("orca_git_history", page(3, 1, false));
    await focusBack();
    await waitForCount("#orca-history-list .orca-commit", 3);
    await expect($("#orca-history-list .orca-file-note")).not.toExist();
    expect(await callsOf("orca_git_history")).toEqual([{ path: "/work/example-app", limit: 50, skip: 0, historyToken: null, environment: null }]);
  });

  it("shows the reason of the files of a commit that cannot be read, and says so for a commit with no file (A-27)", async () => {
    await openHistory({ orca_commit_files: rejects("コミットのファイルを読めません") });
    await waitForCount("#orca-history-list .orca-commit", 3);
    await commitRow(3).click();
    await expect($("#orca-history-files .orca-file-note.fail")).toHaveText("コミットのファイルを読めません");
    await mock("orca_commit_files", changedFiles([]));
    await commitRow(2).click();
    await expect($("#orca-history-files .orca-file-note")).toHaveText("変更されたファイルはありません");
  });

  it("says so when the history has no commit (A-27)", async () => {
    await openHistory({ orca_git_history: { commits: [], hasMore: false, historyToken: null, historyChanged: false } });
    await expect($("#orca-history-list .orca-file-note")).toHaveText("コミットがありません");
  });

  it("reads the list again from the start when the focus comes back, and drops the chosen commit (A-27)", async () => {
    await openHistory();
    await waitForCount("#orca-history-list .orca-commit", 3);
    await commitRow(3).click();
    await waitForCount("#orca-history-files .orca-hfile", 2);
    await mock("orca_git_history", page(4, 1, false));
    await focusBack();
    await waitForCount("#orca-history-list .orca-commit", 4);
    expect(await callsOf("orca_git_history")).toEqual([{ path: "/work/example-app", limit: 50, skip: 0, historyToken: null, environment: null }]);
    await expect($("#orca-history-files .orca-hfile")).not.toExist();
    await expect($('#orca-history-list .orca-commit[aria-pressed="true"]')).not.toExist();
  });

  it("follows the worktree of the selected tab: the list is read again, and the choice of the history stays (A-27)", async () => {
    const value = orcaOverview(sample(), [orcaWorktree("example-app", "feat/a"), orcaWorktree("example-app", "feat/b", { path: "/work/example-app-b" })], {
      terminals: [orcaTerminal("example-app", "zsh", { path: "/work/example-app-b", branch: "feat/b" })],
    });
    await openFiles(historyFixtures(), value);
    await paneMode("履歴").click();
    await waitForCount("#orca-history-list .orca-commit", 3);
    await commitRow(3).click();
    await waitForCount("#orca-history-files .orca-hfile", 2);
    const history = await mock("orca_git_history", page(9, 7, false));
    await tabOf(zsh).$(".orca-tab-btn").click();
    await expect($("#orca-files-title")).toHaveText("example-app ・ feat/b");
    expect(await waitForCalls(history)).toEqual([{ path: "/work/example-app-b", limit: 50, skip: 0, historyToken: null, environment: null }]);
    await browser.waitUntil(async () => (await textsOf("#orca-history-list .orca-commit-subject")).join() === "Commit 9,Commit 8,Commit 7", { timeoutMsg: "the list of the other worktree never showed" });
    await expect($("#orca-history-files .orca-hfile")).not.toExist();
    await expect($("#orca-history")).toBeDisplayed();
    await expect(paneMode("履歴")).toHaveAttribute("aria-pressed", "true");
  });

  it("keeps the branch button of the heading in the history, and reads the list again from the start after a switch (A-27, A-25)", async () => {
    await openFiles(historyFixtures(branchFixtures()));
    await waitForCount("#orca-files-tree .orca-file", 4);
    await paneMode("履歴").click();
    await waitForCount("#orca-history-list .orca-commit", 3);
    await expect(branchButton()).toHaveText("feat/a");
    await branchButton().click();
    await waitForCount(".orca-dest-pop .orca-branch-row", 5);
    const history = await mock("orca_git_history", page(8, 6, false));
    await mock("orca_overview", onFeatC());
    await branchPick("local", "feat/c").click();
    expect(await waitForCalls(history)).toEqual([{ path: "/work/example-app", limit: 50, skip: 0, historyToken: null, environment: null }]);
    await browser.waitUntil(async () => (await textsOf("#orca-history-list .orca-commit-subject")).join() === "Commit 8,Commit 7,Commit 6", { timeoutMsg: "the new list never showed" });
    await expect(branchButton()).toHaveText("feat/c");
    await expect($("#orca-history")).toBeDisplayed();
  });

  it("keeps the choice and the list when the pane is hidden and shown again (A-27)", async () => {
    await openHistory();
    await waitForCount("#orca-history-list .orca-commit", 3);
    await $("#orca-files-toggle").click();
    await expect($("#orca-files")).not.toBeDisplayed();
    await filesToggle().click();
    await expect($("#orca-files")).toBeDisplayed();
    await expect($("#orca-history")).toBeDisplayed();
    await expect($("#orca-files-tree")).not.toBeDisplayed();
    await browser.pause(200);
    expect(await commitRows()).toBe(3);
    expect(await callsOf("orca_git_history")).toHaveLength(1);
  });

  // #601: the clock of the Orca screen (10 seconds; 1 second here) reads again what the file pane and the panes show, with no return of the focus. #600: the heading follows the branch of the list a saved environment streams.
  const marked = (selector: string) => browser.execute((q) => document.querySelector<HTMLElement>(q)?.dataset.kept ?? null, selector);
  const markNode = (selector: string) =>
    browser.execute((q) => {
      document.querySelector<HTMLElement>(q)!.dataset.kept = "1";
    }, selector);

  it("reads the tree and the file shown again by the clock: a folder that did not change is not drawn again, a file with no unsaved typing takes the text of the disk and keeps its caret, one with unsaved typing is left alone, and a read that fails shows nothing (A-18)", async () => {
    await openFiles({ ...timers({ orcaClock: 1000 }), editor_settings: { autosaveMs: 60000 } });
    await openA();
    // The same entries: the rows are the ones that were drawn.
    await markNode('.orca-file[data-path="a.rs"]');
    const same = await mock("orca_files_list", root());
    expect((await waitForCalls(same))[0]).toEqual({ path: "/work/example-app", dir: "", ignored: false, environment: null });
    await browser.pause(300);
    expect(await marked('.orca-file[data-path="a.rs"]')).toBe("1");
    // A file made outside the app shows with no return of the focus.
    await mock("orca_files_list", dirOf("", [["src", true], ["target", true], ["a.rs", false], ["b.log", false], ["new.rs", false]]));
    await browser.waitUntil(async () => (await names()).includes("new.rs"), { timeoutMsg: "the new file never showed" });
    // The text changed outside the app: it takes the place of the one shown, and the caret stays.
    await setCaret(3);
    const read = await mock("orca_file_read", text("fn main() {}\n// outside\n", "sig-2"));
    await waitForText("fn main() {}\n// outside\n");
    expect((await callsOf(read))[0]).toEqual({ path: "/work/example-app", relative: "a.rs", environment: null });
    expect(await caretOffset()).toBe(3);
    expect(await dirtyMarks()).toBe(0);
    // Typing that is not saved yet: the file is not read, and the text stays.
    await type("x");
    expect(await dirtyMarks()).toBe(1);
    const later = await mock("orca_file_read", text("other\n", "sig-3"));
    // A read of the tree that fails keeps the rows and says nothing.
    await mock("orca_files_list", rejects("Orca に接続できません"));
    await browser.pause(1200);
    expect(await callsOf(later)).toEqual([]);
    await waitForText("fn main() {}\n// outside\nx");
    expect(await count("#orca-files-tree .orca-file-note.fail")).toBe(0);
    expect(await names()).toContain("new.rs");
    await expect($(CARDS)).not.toExist();
  });

  it("reads the file shown again by the clock with the file pane hidden, in the rich view and in the source, and does not read the tree meanwhile (A-18, issue #1329)", async () => {
    await openFiles({ ...timers({ orcaClock: 1000 }), editor_settings: { autosaveMs: 60000 } });
    await openMarkdown("# 前\n\n本文\n");
    expect(await rich("h1")).toEqual(["前"]);
    await filesToggle().click();
    await expect($("#orca-files")).not.toBeDisplayed();
    const tree = await mock("orca_files_list", dirOf("", [["only-on-disk.rs", false]]));
    // The rich view follows the disk with no file pane.
    const next = "# 後\n\n本文\n";
    await mock("markdown_split", parts(next));
    await mock("markdown_patch", patched(next));
    const read = await mock("orca_file_read", text(next, "sig-2", "markdown"));
    await browser.waitUntil(async () => (await rich("h1")).join() === "後", { timeoutMsg: "the rich view never followed the disk" });
    expect((await callsOf(read))[0]).toEqual({ path: "/work/example-app", relative: "a.rs", environment: null });
    // The source follows it too.
    await modeButton("ソース").click();
    await expect(modeButton("ソース")).toHaveAttribute("aria-pressed", "true");
    await mock("orca_file_read", text("# 三\n", "sig-3", "markdown"));
    await waitForText("# 三\n");
    // Two more periods: the tree is not read while the pane is hidden.
    await browser.pause(2200);
    expect(await callsOf(tree)).toEqual([]);
    await expect($(CARDS)).not.toExist();
  });

  it("reads the diff shown and the history shown again by the clock: a diff that changed is drawn in place, the same commits are not drawn again, and a new commit comes to the top with the chosen commit kept (A-24, A-27)", async () => {
    await openFiles(historyFixtures(timers({ orcaClock: 1000 })));
    await waitForCount("#orca-files-tree .orca-file", 4);
    await mock("orca_file_diff", diffOfA());
    expect(await rightClickRow("a.rs")).toBe(true);
    await pickItem("差分を表示");
    await waitForCount(".orca-diff-rows .odf-row", 7);
    // The file changed outside the app: the rows follow with no press of the reload button.
    const diff = await mock("orca_file_diff", many());
    await waitForCount(".orca-diff-rows .odf-row", 200);
    expect((await callsOf(diff))[0]).toEqual({ path: "/work/example-app", relative: "a.rs", environment: null });
    await expect($(CARDS)).not.toExist();
    // The history: the same first commits keep the rows that were drawn.
    await paneMode("履歴").click();
    await waitForCount("#orca-history-list .orca-commit", 3);
    await commitRow(3).click();
    await waitForCount("#orca-history-files .orca-hfile", 2);
    await markNode(`#orca-history-list .orca-commit[data-id="${commitId(3)}"]`);
    const same = await mock("orca_git_history", page(3, 1, false));
    expect((await waitForCalls(same))[0]).toEqual({ path: "/work/example-app", limit: 50, skip: 0, historyToken: null, environment: null });
    await browser.pause(300);
    expect(await marked(`#orca-history-list .orca-commit[data-id="${commitId(3)}"]`)).toBe("1");
    // A commit made outside the app comes to the top, and the chosen commit stays chosen with its files.
    await mock("orca_git_history", page(4, 1, false));
    await waitForCount("#orca-history-list .orca-commit", 4);
    expect(await textsOf("#orca-history-list .orca-commit-subject")).toEqual(["Commit 4", "Commit 3", "Commit 2", "Commit 1"]);
    await expect(commitRow(3)).toHaveAttribute("aria-pressed", "true");
    expect(await count("#orca-history-files .orca-hfile")).toBe(2);
  });

  it("reads the tree and the file shown again at once when the list of Orca shows another branch for the worktree, with no switch from the app (A-25)", async () => {
    await openFiles(branchFixtures());
    await openA();
    const list = await mock("orca_files_list", dirOf("", [["a.rs", false], ["only-c.rs", false]]));
    const read = await mock("orca_file_read", text("fn c() {}\n", "sig-c"));
    // The branch was switched in a terminal: the next read of the list says so (showing the screen again reads it here).
    await mock("orca_overview", onFeatC());
    await showAgain();
    await expect(branchButton()).toHaveText("feat/c");
    expect(await waitForCalls(list)).toEqual([{ path: "/work/example-app", dir: "", ignored: false, environment: null }]);
    await browser.waitUntil(async () => (await names()).join() === "a.rs,only-c.rs", { timeoutMsg: "the tree of the new branch never showed" });
    await waitForText("fn c() {}\n");
    expect((await callsOf(read))[0]).toEqual({ path: "/work/example-app", relative: "a.rs", environment: null });
    expect(await callsOf("orca_switch_branch")).toEqual([]);
  });

  it("shows the new branch in the heading of a saved environment, whose list is streamed: after a switch from the app without a second read of the tree, and after a switch made outside it with the tree read again (A-25, A-12)", async () => {
    const studioOnly = { target: "Studio", environments: ["Studio"] };
    // What the stream sends once Rust has read the worktrees again: example-app on `gitBranch`.
    const listOn = (gitBranch: string) =>
      streamList([orcaRow("example-app", "feat/c", "Write the docs", { minutes: 2 }), ...sample().slice(1)], [orcaWorktree("example-app", "feat/c", { gitBranch }), orcaWorktree("example-api", "main")]);
    await openOrca(orcaOverview([], [], studioOnly), { orca_files_list: root(), orca_files_ignored: rootIgnored, ...branchFixtures() });
    await waitForCalls("orca_stream_open");
    await sendStream(streamList(sample(), worktrees()));
    await project("example-app").click();
    await expect(selectedTab()).toBeDisplayed();
    await filesToggle().click();
    await waitForCount("#orca-files-tree .orca-file", 4);
    await expect(branchButton()).toHaveText("feat/a");
    await branchButton().click();
    await waitForCount(".orca-dest-pop .orca-branch-row", 5);
    const files = await mock("orca_files_list", root());
    const overview = await mock("orca_overview", orcaOverview([], [], studioOnly));
    await branchPick("local", "feat/c").click();
    // Rust switches, and tells the stream to read the worktrees again (unit tests); the screen reads the tree once and asks for no list.
    expect(await waitForCalls("orca_switch_branch")).toEqual([{ path: "/work/example-app", kind: "local", name: "feat/c", environment: "Studio" }]);
    await waitForCalls(files);
    await sendStream(listOn("feat/c"));
    await expect(branchButton()).toHaveText("feat/c");
    await expect($("#orca-files-title")).toHaveText("example-app ・ feat/c");
    await browser.pause(300);
    expect(await callsOf(files)).toEqual([{ path: "/work/example-app", dir: "", ignored: false, environment: "Studio" }]);
    expect(await callsOf(overview)).toEqual([]);
    // A switch made outside the app comes with the next list of the stream: the heading follows, and the tree is read again.
    const again = await mock("orca_files_list", dirOf("", [["only-d.rs", false]]));
    await sendStream(listOn("feat/d"));
    await expect(branchButton()).toHaveText("feat/d");
    expect(await waitForCalls(again)).toEqual([{ path: "/work/example-app", dir: "", ignored: false, environment: "Studio" }]);
    await browser.waitUntil(async () => (await names()).join() === "only-d.rs", { timeoutMsg: "the tree of the new branch never showed" });
    expect(await callsOf("orca_switch_branch")).toHaveLength(1);
  });

  // A-12, A-18, A-24: where the list is streamed (a saved environment that is the target), the disk of the worktrees that the screen shows is watched (`orca_stream_files`), and a change that Orca tells is read again at once.
  describe("the watch of the disk", () => {
    const WORK = "/work/example-app";
    const channelCalls = (command: string) =>
      browser.execute((c) => ((window as unknown as { __e2e_calls__: Record<string, { channel?: unknown }[]> }).__e2e_calls__[c] ?? []).map((call) => ({ ...call, channel: !!call.channel })), command);
    const changed = (...paths: string[]) => sendFiles({ kind: "changed", paths, directories: [] });
    // The app with Studio as the target and its list streamed, the example-app project selected and the file pane open with its root read.
    async function openStreamed(fixtures: Record<string, unknown> = {}, rows = 4) {
      await openOrca(orcaOverview([], [], { target: "Studio", environments: ["Studio"] }), { orca_terminal_read: ["$"], orca_files_list: root(), orca_files_ignored: rootIgnored, editor_settings: { autosaveMs: 60000 }, ...fixtures });
      await waitForCalls("orca_stream_open");
      await sendStream(streamList(sample(), worktrees()));
      await project("example-app").click();
      await expect(selectedTab()).toBeDisplayed();
      await filesToggle().click();
      await waitForCount("#orca-files-tree .orca-file", rows);
    }

    it("watches the worktree of the tree and of the file shown once, lets it go when the screen is left, and again when no tab and no tree shows it (A-18, A-12)", async () => {
      await openStreamed();
      const [first] = await waitForCalls("orca_stream_files");
      expect(first).toMatchObject({ environment: "Studio", path: WORK });
      expect((await channelCalls("orca_stream_files"))[0].channel).toBe(true);
      await openA();
      // The same worktree is watched once, whatever shows it; the tree hidden, the file still shows it.
      await filesToggle().click();
      await expect($("#orca-files")).not.toBeDisplayed();
      await browser.pause(300);
      expect(await callsOf("orca_stream_files")).toHaveLength(1);
      expect(await callsOf("orca_stream_files_close")).toEqual([]);
      // The screen is left: nothing shows the worktree, and it is let go with the generation it was watched with.
      await $("#nav-mail").click();
      expect(await waitForCalls("orca_stream_files_close")).toEqual([{ environment: "Studio", path: WORK, generation: (first as { generation: number }).generation }]);
      await $("#nav-orca").click();
      const [, second] = await waitForCalls("orca_stream_files", 2);
      expect(second).toMatchObject({ environment: "Studio", path: WORK });
      expect((second as { generation: number }).generation).not.toBe((first as { generation: number }).generation);
      // The last tab that shows the worktree is closed.
      await tabOf("file:1").$(".orca-tab-close").click();
      expect(await waitForCalls("orca_stream_files_close", 2)).toHaveLength(2);
    });

    it("reads the file shown again at once for a change that names it or that no path of the worktree can be matched with, and by the clock only while the watch is not ready (A-18)", async () => {
      await openStreamed(timers({ orcaClock: 1000 }));
      await openA();
      await filesToggle().click();
      await expect($("#orca-files")).not.toBeDisplayed();
      await waitForCalls("orca_stream_files");
      // The watch is not ready: the clock reads the file.
      await mock("orca_file_read", text("by the clock\n", "sig-2"));
      await waitForText("by the clock\n");
      // Ready: everything shown is read once, and the clock reads no more.
      const read = await mock("orca_file_read", text("at ready\n", "sig-3"));
      await sendFiles({ kind: "ready" });
      await waitForText("at ready\n");
      expect((await callsOf(read))[0]).toEqual({ path: WORK, relative: "a.rs", environment: "Studio" });
      await browser.pause(300);
      const after = (await callsOf(read)).length;
      await browser.pause(2400);
      expect(await callsOf(read)).toHaveLength(after);
      // A change that names another file leaves it alone.
      await mock("orca_file_read", text("after a change\n", "sig-4"));
      await changed(`${WORK}/other.rs`);
      await browser.pause(500);
      await waitForText("at ready\n");
      // One that names it reads it at once (the clock is a second away at the longest, so the wait is no clock's).
      await changed(`${WORK}/other.rs`, `${WORK}/a.rs`);
      await waitForText("after a change\n");
      // A path that is not under the worktree (Orca named the real path of a link) cannot be matched: every file of the worktree is read.
      await mock("orca_file_read", text("by the real path\n", "sig-5"));
      await changed("/private/work/example-app/a.rs");
      await waitForText("by the real path\n");
      // A folder that is named (or a deleted path, which may have been one) reaches every file under it.
      await mock("orca_file_read", text("under a folder\n", "sig-6"));
      await sendFiles({ kind: "changed", paths: [`${WORK}/gone`], directories: [WORK] });
      await waitForText("under a folder\n");
      // The end of the watch gives the file back to the clock.
      await sendFiles({ kind: "ended", message: "" });
      await mock("orca_file_read", text("by the clock again\n", "sig-7"));
      await waitForText("by the clock again\n");
    });

    it("reads the diff shown at once for a change that names its file and not for another, and by the clock as well while the watch is ready (A-24)", async () => {
      await openStreamed(timers({ orcaClock: 1000 }));
      await mock("orca_file_diff", diffOfA());
      expect(await rightClickRow("a.rs")).toBe(true);
      await pickItem("差分を表示");
      await waitForCount(".orca-diff-rows .odf-row", 7);
      await waitForCalls("orca_stream_files");
      await sendFiles({ kind: "ready" });
      // A change that names another file leaves it alone, and one that names its file reads it at once.
      const diff = await mock("orca_file_diff", many());
      await changed(`${WORK}/b.log`);
      await browser.pause(500);
      expect(await callsOf(diff)).toEqual([]);
      await changed(`${WORK}/a.rs`);
      await waitForCount(".orca-diff-rows .odf-row", 200);
      expect((await callsOf(diff))[0]).toEqual({ path: WORK, relative: "a.rs", environment: "Studio" });
      // A commit moves HEAD and Orca says nothing: the clock reads the diff all the same.
      await mock("orca_file_diff", diffOfA());
      await waitForCount(".orca-diff-rows .odf-row", 7);
    });

    it("reads the tree again at once for a change, and by the clock only while the watch is not ready (A-18)", async () => {
      await openStreamed(timers({ orcaClock: 1000 }));
      await waitForCalls("orca_stream_files");
      // Not ready: the clock reads the tree.
      await mock("orca_files_list", dirOf("", [["by-clock.rs", false]]));
      await browser.waitUntil(async () => (await names()).join() === "by-clock.rs", { timeoutMsg: "the clock never read the tree" });
      await sendFiles({ kind: "ready" });
      await browser.pause(500);
      // Ready: the clock leaves the tree, and a change reads it.
      const tree = await mock("orca_files_list", dirOf("", [["by-watch.rs", false]]));
      await browser.pause(2400);
      expect(await callsOf(tree)).toEqual([]);
      expect(await names()).toEqual(["by-clock.rs"]);
      await changed(`${WORK}/by-watch.rs`);
      await browser.waitUntil(async () => (await names()).join() === "by-watch.rs", { timeoutMsg: "the change never read the tree" });
      expect((await callsOf(tree))[0]).toEqual({ path: WORK, dir: "", ignored: false, environment: "Studio" });
      await expect($(CARDS)).not.toExist();
    });

    it("reads of the tree only the folders that hold a path that changed or lie above it, not those in an ignored folder, and the changes of one second together (A-18)", async () => {
      await openStreamed();
      await waitForCalls("orca_stream_files");
      await sendFiles({ kind: "ready" });
      await browser.pause(500);
      // The folder src is open, and so is target, which the list marked as ignored.
      await mock("orca_files_list", dirOf("src", [["lib.rs", false]]));
      await row("src").click();
      await waitForCount("#orca-files-tree .orca-file", 5);
      await mock("orca_files_list", dirOf("target", [["debug", true, true]]));
      await row("target").click();
      await waitForCount("#orca-files-tree .orca-file", 6);
      const entries = dirOf("src", [["lib.rs", false], ["new.rs", false]]);
      const list = await mock("orca_files_list", entries);
      const folders = async () => (await callsOf(list)).map((call) => (call as { dir: string }).dir).sort();
      // A change in an ignored folder reads nothing, the folders above it either.
      await changed(`${WORK}/target/x.o`);
      await browser.pause(1300);
      expect(await callsOf(list)).toEqual([]);
      // A change in a folder that was never read reads the nearest folders above it that were read: here the root.
      await changed(`${WORK}/other/deep.rs`);
      await waitForCalls(list);
      await browser.pause(1300);
      expect(await folders()).toEqual([""]);
      // A change in a folder that was read reads that folder and the folders above it.
      await mock("orca_files_list", entries);
      await changed(`${WORK}/src/new.rs`);
      await waitForCalls(list, 2);
      expect(await folders()).toEqual(["", "src"]);
      // The changes that come in the next second wait and are read together, each folder once.
      await changed(`${WORK}/x.rs`);
      await changed(`${WORK}/src/y.rs`, `${WORK}/src/z.rs`);
      await browser.pause(250);
      expect(await folders()).toEqual(["", "src"]);
      await waitForCalls(list, 4);
      await browser.pause(300);
      expect(await folders()).toEqual(["", "", "src", "src"]);
    });

    it("reads the root for a file that changed in an open folder or in a folder never read, so that the row of the folder gets its mark (A-18, A-39)", async () => {
      await openStreamed();
      await waitForCalls("orca_stream_files");
      await sendFiles({ kind: "ready" });
      await browser.pause(500);
      const mark = () => browser.execute(() => document.querySelector<HTMLElement>('.orca-file[data-path="src"]')?.dataset.change ?? null);
      // The folder src is closed and was never read: a file deep in it changes, and the root is read, with the question of its marks.
      const list = await mock("orca_files_list", root());
      const asked = await mock("orca_files_changes", [change("src", "changed")]);
      await changed(`${WORK}/src/deep/x.rs`);
      await waitForCalls(list);
      await browser.waitUntil(async () => (await mark()) === "changed", { timeoutMsg: "the closed folder never got its mark" });
      expect(await callsOf(list)).toEqual([{ path: WORK, dir: "", ignored: false, environment: "Studio" }]);
      expect(((await callsOf(asked)) as { paths: string[] }[])[0].paths).toContain("src");
      // The folder src is open and read: a file in it changes, and src and the root are read, so the mark of src is asked again and goes.
      await mock("orca_files_list", dirOf("src", [["lib.rs", false]]));
      await row("src").click();
      await browser.pause(1300);
      const again = await mock("orca_files_list", holds);
      await mock("orca_files_changes", []);
      await changed(`${WORK}/src/lib.rs`);
      // The root is read first, alone, and then src.
      await waitForCalls(again);
      await release(again, root());
      await waitForCalls(again, 2);
      await release(again, dirOf("src", [["lib.rs", false]]));
      expect((await callsOf(again)).map((call) => (call as { dir: string }).dir)).toEqual(["", "src"]);
      await browser.waitUntil(async () => (await mark()) === null, { timeoutMsg: "the mark of the folder never went" });
    });

    it("reads by the clock a file under node_modules and the tree while a folder of node_modules is open, though the watch is ready (A-18)", async () => {
      await openStreamed({ ...timers({ orcaClock: 1000 }), orca_files_list: dirOf("", [["node_modules", true, true], ["a.rs", false]]), editor_settings: { autosaveMs: 60000 } }, 2);
      await waitForCalls("orca_stream_files");
      await mock("orca_files_list", dirOf("node_modules", [["x.js", false]]));
      await row("node_modules").click();
      await waitForCount("#orca-files-tree .orca-file", 3);
      await mock("orca_file_read", text("in node_modules\n", "sig-1"));
      await doublePress("node_modules/x.js");
      await waitForText("in node_modules\n");
      await sendFiles({ kind: "ready" });
      await browser.pause(300);
      // Orca watches nothing in it, so the clock reads the tree and the file all the same.
      const list = await mock("orca_files_list", dirOf("node_modules", [["x.js", false]]));
      await mock("orca_file_read", text("by the clock\n", "sig-2"));
      await waitForText("by the clock\n");
      await waitForCalls(list);
    });

    it("watches nothing where the list is not streamed, and reads the file by the clock (A-18)", async () => {
      await openFiles({ ...timers({ orcaClock: 1000 }), editor_settings: { autosaveMs: 60000 } });
      await openA();
      await mock("orca_file_read", text("by the clock\n", "sig-2"));
      await waitForText("by the clock\n");
      expect(await callsOf("orca_stream_files")).toEqual([]);
    });
  });
});

// A-47: files dropped on the file pane from outside. Rust puts them (unit tests); here the screen is checked: the folder under the pointer, the question about a name that is taken, the limits and the cards, the progress, and what is asked of Rust.
describe("orca: drop on the file pane (A-47)", () => {
  const HERE = "/work/example-app";
  const dirOf = (dir: string, entries: [string, boolean][]): OrcaDir => ({
    entries: entries.map(([name, isDirectory]) => ({ name, path: dir === "" ? name : `${dir}/${name}`, isDirectory, ignored: false, icon: null })),
    total: entries.length,
  });
  const rootEntries: [string, boolean][] = [["src", true], ["target", true], ["a.rs", false]];
  const srcEntries: [string, boolean][] = [["lib", true], ["main.rs", false]];
  const rows = "#orca-files-tree .orca-file";
  const row = (path: string) => $(`${rows}[data-path="${path}"]`);
  const names = () => textsOf("#orca-files-tree .orca-file-name");
  const empty: GivenFile = { name: "empty.txt", type: "text/plain", base64: "" };
  const named = (name: string): GivenFile => ({ name, type: "text/plain", base64: btoa(name) });

  // The app with the file pane open, the root read and src open.
  async function openTree() {
    await openOrca(orcaOverview(sample(), worktrees()), { orca_terminal_read: ["$"], orca_files_list: dirOf("", rootEntries), orca_files_ignored: [], orca_files_changes: [], editor_settings: { autosaveMs: 100 } });
    await project("example-app").click();
    await filesToggle().click();
    await waitForCount(rows, 3);
    await mock("orca_files_list", dirOf("src", srcEntries));
    await row("src").click();
    await waitForCount(rows, 5);
    await mock("orca_drop_taken", []);
    await mock("orca_drop_file", "src/notes.txt");
    await mock("orca_drop_dir", null);
  }

  // A folder of a drop: its name, and what it holds (files and folders), which the page reads through `createReader`, two entries to a batch.
  type GivenDir = { dir: string; children: (GivenFile | GivenDir)[] };
  const folder = (dir: string, ...children: (GivenFile | GivenDir)[]): GivenDir => ({ dir, children });
  // An event of a drag from outside on the row of `where` (a path, or "empty" for the part of the tree under the rows), with the files; `dirs` are folders that go with them (the entries of the transfer). Answers whether the page cancelled the event and the drop effect it set.
  const fireOn = (kind: "dragover" | "dragleave" | "drop", where: string, files: GivenFile[] = [note], dirs: GivenDir[] = []) =>
    browser.execute(
      (k, w, given, folders, once) => {
        if (!window.__e2e_once__(once)) return null;
        type Given = { name: string; type: string; base64: string; bytes?: number };
        type Dir = { dir: string; children: (Given | Dir)[] };
        const fileOf = (g: Given) => new File([g.bytes === undefined ? Uint8Array.from(atob(g.base64), (c) => c.charCodeAt(0)) : new Uint8Array(g.bytes)], g.name, { type: g.type });
        const list = given.map(fileOf);
        const event = new Event(k, { bubbles: true, cancelable: true });
        const make = (g: Given | Dir): unknown => {
          if (!("dir" in g)) return { name: g.name, isDirectory: false, file: (ok: (f: File) => void) => ok(fileOf(g)) };
          let at = 0;
          return { name: g.dir, isDirectory: true, createReader: () => ({ readEntries: (ok: (e: unknown[]) => void) => { ok(g.children.slice(at, at + 2).map(make)); at += 2; } }) };
        };
        const items = folders.length === 0 ? undefined : [...folders.map((f) => ({ kind: "file", webkitGetAsEntry: () => make(f as Dir) })), ...given.map((g) => ({ kind: "file", webkitGetAsEntry: () => make(g) }))];
        const transfer = { files: list, items, types: ["Files"], dropEffect: "none", getData: () => "" };
        Object.defineProperty(event, "dataTransfer", { value: transfer });
        const target = w === "empty" ? document.getElementById("orca-files-tree")! : document.querySelector(`.orca-file[data-path="${w}"]`)!;
        return { cancelled: !target.dispatchEvent(event), effect: transfer.dropEffect };
      },
      kind,
      where,
      files,
      dirs,
      onceId(),
    );
  const dropMark = () =>
    browser.execute(() => [...document.querySelectorAll<HTMLElement>("#orca-files-tree [data-drop], #orca-files-tree[data-drop]")].map((e) => e.dataset.path ?? "[tree]"));
  const drop = async (where: string, files?: GivenFile[], dirs?: GivenDir[]) => {
    await fireOn("dragover", where, files, dirs);
    await fireOn("drop", where, files, dirs);
  };
  // Waits until the drop that was on its way has ended: a drag over the tree is taken again (a drop that is made before is not taken).
  const idle = () => browser.waitUntil(async () => (await fireOn("dragover", "empty"))?.effect === "copy", { timeoutMsg: "the drop never ended" });
  const question = () => $(".orca-drop-pop");
  // Presses a button of the question; the next question, when the drop has one, comes in its place.
  const answer = (label: string) => question().$(`button=${label}`).click();

  it("marks the folder of the row under a dragged file, the folder that holds a file's row, and the tree for the empty part, and clears the mark when the drag leaves", async () => {
    await openTree();
    expect(await fireOn("dragover", "src")).toEqual({ cancelled: true, effect: "copy" });
    expect(await dropMark()).toEqual(["src"]);
    await fireOn("dragover", "src/main.rs");
    expect(await dropMark()).toEqual(["src"]);
    await fireOn("dragover", "a.rs");
    expect(await dropMark()).toEqual(["[tree]"]);
    await fireOn("dragover", "target");
    expect(await dropMark()).toEqual(["target"]);
    await fireOn("dragleave", "target");
    expect(await dropMark()).toEqual([]);
    expect(await callsOf("orca_drop_taken")).toEqual([]);
  });

  it("puts a file dropped on a folder's row in that folder, with no question when the name is free, and reads the folder again", async () => {
    await openTree();
    const list = await mock("orca_files_list", dirOf("src", [...srcEntries, ["notes.txt", false]]));
    await drop("src");
    expect(await waitForCalls("orca_drop_taken")).toEqual([{ path: HERE, dir: "src", names: ["notes.txt"], environment: null }]);
    expect(await waitForCalls("orca_drop_file")).toEqual([{ path: HERE, dir: "src", name: "notes.txt", data: note.base64, onTaken: "copy", environment: null }]);
    expect(await waitForCalls(list)).toEqual([{ path: HERE, dir: "src", ignored: false, environment: null }]);
    await waitForCount(rows, 6);
    expect(await names()).toEqual(["src", "lib", "main.rs", "notes.txt", "target", "a.rs"]);
    await expect(question()).not.toExist();
    await expect($(CARDS)).not.toExist();
    await expect($("#orca-drop")).not.toBeDisplayed();
    expect(await dropMark()).toEqual([]);
  });

  it("puts a file dropped on a file's row in the folder that holds it, and one dropped on the empty part in the worktree's own folder", async () => {
    await openTree();
    await drop("src/main.rs");
    expect((await waitForCalls("orca_drop_file"))[0]).toMatchObject({ dir: "src" });
    await idle();
    await mock("orca_files_list", dirOf("", rootEntries));
    await mock("orca_drop_taken", []);
    await mock("orca_drop_file", "notes.txt");
    await drop("empty");
    expect((await waitForCalls("orca_drop_file"))[0]).toMatchObject({ path: HERE, dir: "", name: "notes.txt" });
    expect(await callsOf("orca_drop_taken")).toEqual([{ path: HERE, dir: "", names: ["notes.txt"], environment: null }]);
  });

  it("puts a file of no bytes", async () => {
    await openTree();
    await drop("src", [empty, note]);
    expect(await waitForCalls("orca_drop_file", 2)).toEqual([
      { path: HERE, dir: "src", name: "empty.txt", data: "", onTaken: "copy", environment: null },
      { path: HERE, dir: "src", name: "notes.txt", data: note.base64, onTaken: "copy", environment: null },
    ]);
    await expect($(CARD)).not.toExist();
  });

  it("makes the folders of a dropped folder before its files go, and puts the files in the same layout (the batches of the reader, and an empty folder, are read through)", async () => {
    await openTree();
    const made = await mock("orca_drop_dir", holds);
    const tree = folder("photos", named("a.jpg"), folder("2026", named("b.jpg"), folder("empty")), named("c.jpg"));
    await drop("src", [note], [tree]);
    // The names the drop puts in the folder itself: the file, and the folder (so that one that is there is known). The folder is new, so nothing is asked of what is in it.
    expect(await waitForCalls("orca_drop_taken")).toEqual([{ path: HERE, dir: "src", names: ["notes.txt", "photos"], environment: null }]);
    // The folder that holds no other folder of the drop is made (the folders on the way with it), and no file goes before.
    expect(await waitForCalls(made)).toEqual([{ path: HERE, dir: "src/photos/2026/empty", environment: null }]);
    await browser.pause(300);
    expect(await callsOf("orca_drop_file")).toEqual([]);
    await release(made, null);
    expect((await waitForCalls("orca_drop_file", 4)).map((c) => [(c as { dir: string }).dir, (c as { name: string }).name])).toEqual([
      ["src/photos", "a.jpg"],
      ["src/photos/2026", "b.jpg"],
      ["src/photos", "c.jpg"],
      ["src", "notes.txt"],
    ]);
    await expect($(CARD)).not.toExist();
    await expect($("#orca-drop")).not.toBeDisplayed();
  });

  it("makes a folder of the drop that holds no file, and shows no file count for it", async () => {
    await openTree();
    const made = await mock("orca_drop_dir", holds);
    await drop("src", [], [folder("none", folder("deeper"))]);
    await waitForCalls(made);
    await expect($("#orca-drop")).toBeDisplayed();
    await expect($("#orca-drop-count")).toHaveText("0 / 0");
    await release(made, null);
    await expect($("#orca-drop")).not.toBeDisplayed();
    expect(await callsOf(made)).toEqual([{ path: HERE, dir: "src/none/deeper", environment: null }]);
    expect(await callsOf("orca_drop_file")).toEqual([]);
    await expect($(CARD)).not.toExist();
  });

  it("puts a dropped folder together with a folder of that name that is there, and asks only about the files of it whose names are taken, naming their folder", async () => {
    await openTree();
    const asked = await mock("orca_drop_taken", holds);
    await drop("src", [], [folder("lib", named("a.rs"), folder("inner", named("b.rs")))]);
    // The folder 'lib' is there: the files of each folder of the drop are asked after it, the ones of 'lib' itself first.
    expect(await waitForCalls(asked)).toEqual([{ path: HERE, dir: "src", names: ["lib"], environment: null }]);
    await release(asked, ["lib"]);
    await waitForCalls(asked, 2);
    await release(asked, ["a.rs"]);
    await waitForCalls(asked, 3);
    await release(asked, []);
    expect(await callsOf(asked)).toEqual([
      { path: HERE, dir: "src", names: ["lib"], environment: null },
      { path: HERE, dir: "src/lib", names: ["a.rs"], environment: null },
      { path: HERE, dir: "src/lib/inner", names: ["b.rs"], environment: null },
    ]);
    await expect(question()).toHaveText(expect.stringContaining("a.rs は src/lib/ にもうあります。"));
    await expect(question()).not.toHaveText(expect.stringContaining("残りの"));
    await answer("上書き");
    const calls = (await waitForCalls("orca_drop_file", 2)) as { dir: string; name: string; onTaken: string }[];
    expect(calls.map((c) => [c.dir, c.name, c.onTaken])).toEqual([["src/lib", "a.rs", "overwrite"], ["src/lib/inner", "b.rs", "copy"]]);
    expect(await callsOf("orca_drop_dir")).toEqual([{ path: HERE, dir: "src/lib/inner", environment: null }]);
  });

  it("counts the files inside a dropped folder against the limit, and puts nothing when they are over it", async () => {
    await openTree();
    await drop("src", [], [folder("many", ...Array.from({ length: 1001 }, (_, i) => named(`f${i}.txt`)))]);
    await expect($(CARD)).toHaveText("一度に置けるのは 1,000 ファイル、合計 200 MiB までです");
    await browser.pause(300);
    expect(await callsOf("orca_drop_taken")).toEqual([]);
    expect(await callsOf("orca_drop_dir")).toEqual([]);
    expect(await callsOf("orca_drop_file")).toEqual([]);
  });

  it("leaves a file over 20 MiB inside a dropped folder with a card, and puts the rest of the folder", async () => {
    await openTree();
    await drop("src", [], [folder("media", huge, note)]);
    await expect($(CARD)).toHaveText("big.bin は 20 MiB を超えるので置けません");
    expect((await waitForCalls("orca_drop_file")).map((c) => [(c as { dir: string }).dir, (c as { name: string }).name])).toEqual([["src/media", "notes.txt"]]);
    expect(await callsOf("orca_drop_dir")).toEqual([{ path: HERE, dir: "src/media", environment: null }]);
  });

  it("asks about each file whose name is taken, and puts it as it is answered: replace, another name, or leave it", async () => {
    await openTree();
    await mock("orca_drop_taken", ["a.txt", "b.txt", "c.txt"]);
    await drop("src", [named("a.txt"), named("b.txt"), named("c.txt"), named("d.txt")]);
    await expect(question()).toBeDisplayed();
    await expect(question()).toHaveText(expect.stringContaining("a.txt は src/ にもうあります。"));
    // The checkbox for the rest is there, with the number of the files that are taken after this one.
    await expect(question()).toHaveText(expect.stringContaining("残りの 2 件も同じにする"));
    expect(await textsOf(".orca-drop-pop button")).toEqual(["やめる", "別名で置く", "上書き"]);
    // Nothing goes before the last answer.
    expect(await callsOf("orca_drop_file")).toEqual([]);
    await answer("上書き");
    await expect(question()).toHaveText(expect.stringContaining("b.txt は src/ にもうあります。"));
    await expect(question()).toHaveText(expect.stringContaining("残りの 1 件も同じにする"));
    await answer("やめる");
    await expect(question()).toHaveText(expect.stringContaining("c.txt は src/ にもうあります。"));
    await expect(question()).not.toHaveText(expect.stringContaining("残りの"));
    await answer("別名で置く");
    const calls = (await waitForCalls("orca_drop_file", 3)) as { name: string; onTaken: string }[];
    expect(calls.map((c) => [c.name, c.onTaken])).toEqual([["a.txt", "overwrite"], ["c.txt", "copy"], ["d.txt", "copy"]]);
  });

  it("answers the rest of the files that are taken the same way when 'the rest the same' is checked, and still puts the files whose names are free", async () => {
    await openTree();
    await mock("orca_drop_taken", ["a.txt", "b.txt"]);
    await drop("src", [named("a.txt"), named("free.txt"), named("b.txt")]);
    await expect(question()).toHaveText(expect.stringContaining("残りの 1 件も同じにする"));
    await question().$("input[type=checkbox]").click();
    await answer("上書き");
    const calls = (await waitForCalls("orca_drop_file", 3)) as { name: string; onTaken: string }[];
    expect(calls.map((c) => [c.name, c.onTaken])).toEqual([["a.txt", "overwrite"], ["free.txt", "copy"], ["b.txt", "overwrite"]]);
    await expect(question()).not.toExist();
  });

  it("leaves the rest that are taken when 'leave it' is answered for all, and Escape leaves the file in question", async () => {
    await openTree();
    await mock("orca_drop_taken", ["a.txt", "b.txt"]);
    await drop("src", [named("a.txt"), named("free.txt"), named("b.txt")]);
    await question().$("input[type=checkbox]").click();
    await answer("やめる");
    expect((await waitForCalls("orca_drop_file")).map((c) => (c as { name: string }).name)).toEqual(["free.txt"]);
    await idle();
    await mock("orca_drop_file", "src/notes.txt");
    await mock("orca_drop_taken", ["a.txt"]);
    await drop("src", [named("a.txt")]);
    await expect(question()).toBeDisplayed();
    await browser.keys("Escape");
    await expect(question()).not.toExist();
    await browser.pause(300);
    expect(await callsOf("orca_drop_file")).toEqual([]);
  });

  it("names the worktree's own folder by the project in the question, and ends a question when the tree becomes another worktree's", async () => {
    await openTree();
    await mock("orca_files_list", dirOf("", rootEntries));
    await mock("orca_drop_taken", ["a.rs"]);
    await drop("empty", [named("a.rs")]);
    await expect(question()).toHaveText(expect.stringContaining("a.rs は example-app/ にもうあります。"));
    await project("example-api").click();
    await expect(question()).not.toExist();
    await browser.pause(300);
    expect(await callsOf("orca_drop_file")).toEqual([]);
  });

  it("shows the progress and a spinner on the folder's row while the files are put, takes no other drop meanwhile, and shows the rows as they are put", async () => {
    await openTree();
    const put = await mock("orca_drop_file", holds);
    const list = await mock("orca_files_list", dirOf("src", srcEntries));
    await drop("src", [named("one.txt"), named("two.txt")]);
    await waitForCalls(put);
    await expect($("#orca-drop")).toBeDisplayed();
    await expect($("#orca-drop-label")).toHaveText("src/ に置いています");
    await expect($("#orca-drop-count")).toHaveText("0 / 2");
    await expect($(`${rows}[data-path="src"] .spin`)).toExist();
    // Another drop is not taken: the cursor says so, and nothing is asked of Rust.
    expect(await fireOn("dragover", "target")).toEqual({ cancelled: true, effect: "none" });
    expect(await dropMark()).toEqual([]);
    await fireOn("drop", "target");
    await browser.pause(200);
    expect(await callsOf("orca_drop_taken")).toHaveLength(1);
    // The first file is put: its row appears at once, while the second is on its way.
    await mock("orca_files_list", dirOf("src", [...srcEntries, ["one.txt", false]]));
    await release(put, "src/one.txt");
    await expect($("#orca-drop-count")).toHaveText("1 / 2");
    await waitForCount(rows, 6);
    expect(await names()).toContain("one.txt");
    await waitForCalls(put, 2);
    await release(put, "src/two.txt");
    await expect($("#orca-drop")).not.toBeDisplayed();
    await expect($(`${rows}[data-path="src"] .spin`)).not.toExist();
    expect(await callsOf(list)).not.toEqual([]);
    // The next drop is taken again.
    await mock("orca_drop_file", "src/notes.txt");
    expect(await fireOn("dragover", "target")).toEqual({ cancelled: true, effect: "copy" });
  });

  it("puts nothing and says so on a card when a drop holds more than 1,000 files", async () => {
    await openTree();
    await drop("src", Array.from({ length: 1001 }, (_, i) => named(`f${i}.txt`)));
    await expect($(CARD)).toHaveText("一度に置けるのは 1,000 ファイル、合計 200 MiB までです");
    await browser.pause(300);
    expect(await callsOf("orca_drop_taken")).toEqual([]);
    expect(await callsOf("orca_drop_file")).toEqual([]);
  });

  it("leaves a file over 20 MiB with a card, and puts the others of the drop", async () => {
    await openTree();
    await drop("src", [huge, note]);
    await expect($(CARD)).toHaveText("big.bin は 20 MiB を超えるので置けません");
    expect(await waitForCalls("orca_drop_taken")).toEqual([{ path: HERE, dir: "src", names: ["notes.txt"], environment: null }]);
    expect((await waitForCalls("orca_drop_file")).map((c) => (c as { name: string }).name)).toEqual(["notes.txt"]);
  });

  it("shows the message of a file that Rust failed to put on a card, and stops there", async () => {
    await openTree();
    await mock("orca_drop_file", rejects("Orca がエラーを返しました（forbidden）"));
    await drop("src", [named("one.txt"), named("two.txt")]);
    await expect($(CARD)).toHaveText("Orca がエラーを返しました（forbidden）");
    await idle();
    expect(await callsOf("orca_drop_file")).toHaveLength(1);
    // A new drop is taken after the failure.
    await mock("orca_drop_file", "src/notes.txt");
    await drop("src");
    await waitForCalls("orca_drop_file");
  });

  it("shows the message of a worktree that takes no drop on a card, and puts nothing", async () => {
    await openTree();
    await mock("orca_drop_taken", rejects("SSH の接続先の worktree にはファイルを置けません"));
    await drop("src");
    await expect($(CARD)).toHaveText("SSH の接続先の worktree にはファイルを置けません");
    expect(await callsOf("orca_drop_file")).toEqual([]);
  });
});
