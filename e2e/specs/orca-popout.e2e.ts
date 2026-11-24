// A-46: the page of the window of a tab (`popout.html`, `ts/popout.ts`). Rust makes the window (`orca_popout_open`, which this spec calls through the app's own bridge, the fixtures of the page being cut off for it), and the page runs with the answers of its own fixtures:
// the commands the window sends are mocked, as in every spec. What the Orca screen does with a window is in `orca.e2e.ts`; the red button, the pin that keeps the window on top and the end of the main window are checked by hand (`tauri dev`), as WebDriver cannot press them.
import type { OrcaDiffRow } from "../../ts/bindings/OrcaDiffRow";
import type { OrcaFileDiff } from "../../ts/bindings/OrcaFileDiff";
import type { OrcaFileText } from "../../ts/bindings/OrcaFileText";
import type { OrcaSaved } from "../../ts/bindings/OrcaSaved";
import type { PopoutTab } from "../../ts/bindings/PopoutTab";
import { charBoxes, CONTENT, typeIn, waitForText } from "../orca-support";
import { boot, callsOf, copiedTexts, count, databaseCell, databaseColumn, databaseRecords, databaseSqlResult, databaseStructure, mock, onceId, popoutTab, rejects, sendPopoutClose, sendPopoutTab, sendTerm, stubClipboard, textsOf, timers, waitForCalls, waitForCount, CARD } from "../support";

type Bridge = { __TAURI_INTERNALS__: { invoke: (command: string, args: object) => Promise<unknown> }; __TAURI__: { core: { Channel: new () => object } } };

// Calls a command of Rust from the page that is shown, past the fixtures; a refusal is answered as {refused} (an `error` key would be read by the driver as its own failure).
const real = (command: string, args: object = {}) =>
  browser.execute(
    async (c, a) => {
      try {
        return await (window as unknown as Bridge).__TAURI_INTERNALS__.invoke(c, a);
      } catch (e) {
        return { refused: String(e) };
      }
    },
    command,
    args,
  );

const shell = popoutTab("orca:term_a", "term_a", "zsh");
const opened: string[] = [];

// The window of `tab`, made by Rust, with the page booted with `fixtures` (the sessionStorage of a window is its own, so each starts with none).
async function openWindow(tab: PopoutTab, fixtures: Record<string, unknown> = {}) {
  await browser.switchToWindow("main");
  const label = (await real("orca_popout_open", { tab })) as string;
  opened.push(tab.tab);
  await browser.waitUntil(async () => (await browser.getWindowHandles()).includes(label), { timeoutMsg: `the window ${label} never came` });
  await browser.switchToWindow(label);
  await browser.waitUntil(async () => (await browser.getUrl()).endsWith("/popout.html"), { timeoutMsg: `the window showed ${await browser.getUrl()}` });
  await boot({ orca_popout_attach: tab, ...fixtures });
  return label;
}

// The text drawn in the terminal of the page.
const screenText = () => $("#popout-term .orca-term-box:not([hidden]) .xterm-rows").getText();
const typeInTerminal = async (keys: string[]) => {
  await $("#popout-term .orca-term-box:not([hidden]) .xterm-screen").click();
  await browser.keys(keys);
};

describe("orca: the window of a tab (A-46)", () => {
  afterEach(async () => {
    // The windows of the spec end through Rust, so the next spec of the app finds the main window alone.
    await browser.switchToWindow("main");
    for (const tab of opened.splice(0)) await real("orca_popout_end", { tab });
    await browser.waitUntil(async () => (await browser.getWindowHandles()).length === 1, { timeoutMsg: "a window stayed" });
  });

  it("draws the icon and the name of the tab in a header that moves the window, with the pin and the button that puts the tab back, and no strip of tabs", async () => {
    await openWindow(shell);
    await expect($("#popout-name")).toHaveText("zsh");
    const icon = await browser.execute(() => {
      const i = document.querySelector<HTMLElement>("#popout-icon .orca-ic")!;
      return [i.dataset.status, i.getAttribute("aria-label")];
    });
    expect(icon).toEqual(["done", "起動中"]);
    expect(await browser.execute(() => document.getElementById("popout-head")!.getAttribute("data-tauri-drag-region"))).toBe("deep");
    await expect($("#popout-pin")).toHaveAttribute("aria-label", "最前面に固定");
    await expect($("#popout-pin")).toHaveAttribute("aria-pressed", "false");
    await expect($("#popout-restore")).toHaveAttribute("aria-label", "戻す");
    // The pin comes before the button at the right end.
    expect(await textsOf("#popout-head button")).toEqual(["", ""]);
    expect(await browser.execute(() => [...document.querySelectorAll("#popout-head button")].map((b) => b.id))).toEqual(["popout-pin", "popout-restore"]);
    expect(await count(".orca-tabs")).toBe(0);
  });

  it("shows the Claude session as a terminal, with the status of the list in its icon", async () => {
    const session = popoutTab("claude:p", "term_c", "Write the docs", { status: "working", label: "作業中", content: { kind: "claude", handle: "term_c", path: "/work/example-app", stream: false, ended: false } });
    await openWindow(session, { orca_terminal_read: ["$ claude", "> Write the docs"] });
    await expect($("#popout-name")).toHaveText("Write the docs");
    expect(await browser.execute(() => document.querySelector<HTMLElement>("#popout-icon .orca-ic")!.dataset.status)).toBe("working");
    expect((await waitForCalls("orca_terminal_read"))[0]).toEqual({ handle: "term_c" });
    await browser.waitUntil(async () => (await screenText()).includes("Write the docs"), { timeoutMsg: "the screen never showed" });
  });

  it("mirrors the terminal of this machine, and sends the keys typed to its handle", async () => {
    await openWindow(shell, { orca_terminal_read: ["$"] });
    expect((await waitForCalls("orca_terminal_read"))[0]).toEqual({ handle: "term_a" });
    const input = await mock("orca_terminal_input", null);
    await typeInTerminal(["c", "d"]);
    await browser.waitUntil(async () => (await callsOf(input)).map((c) => (c as { text: string }).text).join("") === "cd", { timeoutMsg: "the keys were not sent" });
    expect((await callsOf(input)).every((c) => (c as { handle: string }).handle === "term_a")).toBe(true);
  });

  it("streams the terminal of a saved environment, draws what it sends, and stops the stream when the tab is put back", async () => {
    const streamed = popoutTab("orca:term_a", "term_a", "zsh", { environment: "Studio", content: { kind: "terminal", handle: "term_a", path: "/work/example-app", stream: true, ended: false } });
    await openWindow(streamed);
    const [shown] = (await waitForCalls("orca_stream_terminal")) as { environment: string; handle: string; generation: number }[];
    expect(shown).toMatchObject({ environment: "Studio", handle: "term_a", generation: expect.any(Number) });
    expect(await callsOf("orca_terminal_read")).toEqual([]);
    await sendTerm({ kind: "snapshot", data: "$ claude\r\n> Write the docs", cols: 80, rows: 24 });
    await browser.waitUntil(async () => (await screenText()).includes("Write the docs"), { timeoutMsg: "the screen never showed" });
    await $("#popout-restore").click();
    expect(await waitForCalls("orca_popout_restore")).toEqual([null]);
    expect(await waitForCalls("orca_stream_terminal_close")).toEqual([{ environment: "Studio", handle: "term_a", generation: shown.generation }]);
  });

  it("pins the window and lets it go: the button says which, and the command is asked for each press", async () => {
    await openWindow(shell, { orca_terminal_read: ["$"] });
    const pin = await mock("orca_popout_pin", null);
    await $("#popout-pin").click();
    await expect($("#popout-pin")).toHaveAttribute("aria-pressed", "true");
    await $("#popout-pin").click();
    await expect($("#popout-pin")).toHaveAttribute("aria-pressed", "false");
    expect(await waitForCalls(pin, 2)).toEqual([{ pinned: true }, { pinned: false }]);
  });

  it("goes back to the button's old state, and shows the message, when the pin fails", async () => {
    await openWindow(shell, { orca_terminal_read: ["$"] });
    const pin = await mock("orca_popout_pin", rejects("固定できませんでした"));
    await $("#popout-pin").click();
    await waitForCalls(pin);
    await expect($(CARD)).toHaveText("固定できませんでした");
    await expect($("#popout-pin")).toHaveAttribute("aria-pressed", "false");
  });

  it("draws what the Orca screen says of the tab now, and follows the terminal to a stream when the screen's list streams", async () => {
    await openWindow(shell, { orca_terminal_read: ["$"], ...timers({ orcaMirror: 250 }) });
    await waitForCalls("orca_terminal_read");
    await sendPopoutTab({ ...shell, title: "zsh (api)", status: "working", label: "作業中", environment: "Studio", content: { kind: "terminal", handle: "term_a", path: "/work/example-app", stream: true, ended: false } });
    await expect($("#popout-name")).toHaveText("zsh (api)");
    expect(await browser.execute(() => document.querySelector<HTMLElement>("#popout-icon .orca-ic")!.dataset.status)).toBe("working");
    expect((await waitForCalls("orca_stream_terminal"))[0]).toMatchObject({ environment: "Studio", handle: "term_a" });
  });

  // A file (A-18, A-29): the editor of the Orca screen, opened here from the disk. The window of a file holds its text and its save.
  describe("a file", () => {
    const FILE = "file:7";
    const relative = "notes/memo.md";
    const memo = popoutTab(FILE, "", "memo.md", { label: "", content: { kind: "file", path: "/work/example-app", relative, server: null } });
    const text = (content: string, language = "plaintext"): OrcaFileText => ({ content, crlf: false, signature: "sig-1", language });
    const saved = (signature: string): OrcaSaved => ({ state: "saved", signature });
    const area = () => $(CONTENT);
    // A window of the file, with the text read and the autosave short.
    async function openFileWindow(tab: PopoutTab = memo, fixtures: Record<string, unknown> = {}, shown = "a note\n") {
      const label = await openWindow(tab, { orca_file_read: text("a note\n"), editor_settings: { autosaveMs: 100, autosaveMin: 100, autosaveMax: 3000, autosaveStep: 100 }, ...fixtures });
      await waitForText(shown);
      return label;
    }
    async function typeX() {
      await typeIn("x");
    }

    it("draws the file's icon and name in the header, and the editor under it with the text of the disk, in place of a terminal", async () => {
      await openFileWindow();
      await expect($("#popout-name")).toHaveText("memo.md");
      expect(await count("#popout-icon .orca-file-tab-ic")).toBe(1);
      await expect($(".orca-edit-path")).toHaveText(relative);
      expect(await waitForCalls("orca_file_read")).toEqual([{ path: "/work/example-app", relative, environment: null }]);
      await expect($("#popout-term")).not.toBeDisplayed();
      await expect($("#popout-file")).toBeDisplayed();
      expect(await count(".orca-term")).toBe(0);
    });

    it("reads the file of a saved environment with its target", async () => {
      await openFileWindow({ ...memo, environment: "Studio" });
      expect(await waitForCalls("orca_file_read")).toEqual([{ path: "/work/example-app", relative, environment: "Studio" }]);
    });

    it("shows a file outside the worktree with a lock, read only, through the server that gave it", async () => {
      const gem = popoutTab("file:8", "", "rails.rb", { label: "", content: { kind: "file", path: "/work/example-app", relative: "/usr/local/bundle/gems/rails.rb", server: "ruby" } });
      await openWindow(gem, { lsp_read_outside: { path: "/usr/local/bundle/gems/rails.rb", text: "module Rails\nend\n", language: "ruby" } });
      await waitForText("module Rails\nend\n");
      expect(await count("#popout-icon .orca-ic[aria-label='読み取り専用']")).toBe(1);
      await expect(area()).toHaveAttribute("aria-readonly", "true");
      expect(await waitForCalls("lsp_read_outside")).toEqual([{ environment: null, project: "proj_example-app", worktree: "/work/example-app", server: "ruby", path: "/usr/local/bundle/gems/rails.rb" }]);
    });

    it("saves the typing by itself, with the signature of the read", async () => {
      await openFileWindow();
      const write = await mock("orca_file_write", saved("sig-2"));
      await typeX();
      expect(await waitForCalls(write)).toEqual([{ path: "/work/example-app", relative, content: "a note\nx", crlf: false, signature: "sig-1", environment: null }]);
    });

    it("saves the typing and closes the file before it asks to put the tab back", async () => {
      await openFileWindow();
      const write = await mock("orca_file_write", saved("sig-2"));
      const restore = await mock("orca_popout_restore", null);
      await typeX();
      await $("#popout-restore").click();
      expect(await waitForCalls(restore)).toEqual([null]);
      expect(await callsOf(write)).toHaveLength(1);
      await expect(area()).not.toExist();
    });

    it("keeps the file in the window, and shows the message, when the save before putting the tab back fails", async () => {
      await openFileWindow();
      await mock("orca_file_write", rejects("保存できませんでした"));
      const restore = await mock("orca_popout_restore", null);
      await typeX();
      await $("#popout-restore").click();
      await expect($(CARD)).toHaveText("保存できませんでした");
      expect(await callsOf(restore)).toEqual([]);
      await waitForText("a note\nx");
    });

    it("keeps the file in the window when the save before putting the tab back is refused", async () => {
      await openFileWindow();
      await mock("orca_file_write", { state: "changed", signature: "sig-1" } satisfies OrcaSaved);
      const restore = await mock("orca_popout_restore", null);
      await typeX();
      await $("#popout-restore").click();
      await expect($(".orca-edit-state")).toHaveText("ディスクのファイルが変わっています");
      expect(await callsOf(restore)).toEqual([]);
      await waitForText("a note\nx");
    });

    it("opens the file here again, with the message, when the tab could not be put back", async () => {
      await openFileWindow();
      await mock("orca_popout_restore", rejects("戻せませんでした"));
      await $("#popout-restore").click();
      await expect($(CARD)).toHaveText("戻せませんでした");
      await waitForText("a note\n");
      expect(await callsOf("orca_file_read")).toHaveLength(2);
    });

    it("closes the file as the × of a pane does when Rust tells the page of the red button, and then asks for the close", async () => {
      await openFileWindow();
      const write = await mock("orca_file_write", saved("sig-2"));
      const close = await mock("orca_popout_close", null);
      await typeX();
      await sendPopoutClose();
      expect(await waitForCalls(close)).toEqual([null]);
      expect(await callsOf(write)).toHaveLength(1);
      await expect(area()).not.toExist();
    });

    it("keeps the window when the save of the red button fails, with the message", async () => {
      await openFileWindow();
      await mock("orca_file_write", rejects("保存できませんでした"));
      const close = await mock("orca_popout_close", null);
      await typeX();
      await sendPopoutClose();
      await expect($(CARD)).toHaveText("保存できませんでした");
      expect(await callsOf(close)).toEqual([]);
      await waitForText("a note\nx");
    });

    it("closes a file that a refused save left, as the × of a pane does (the heading said it)", async () => {
      await openFileWindow();
      await mock("orca_file_write", { state: "changed", signature: "sig-1" } satisfies OrcaSaved);
      const close = await mock("orca_popout_close", null);
      await typeX();
      await sendPopoutClose();
      expect(await waitForCalls(close)).toEqual([null]);
    });

    it("reads the disk again by the clock when nothing was typed", async () => {
      await openFileWindow(memo, timers({ orcaClock: 500 }));
      await mock("orca_file_read", { ...text("a note, changed\n"), signature: "sig-2" });
      await waitForText("a note, changed\n");
    });

    it("does not read the disk again by the clock while the window is hidden, and reads it once when it is seen again", async () => {
      await openFileWindow(memo, timers({ orcaClock: 500 }));
      const hide = (hidden: boolean) =>
        browser.execute((h) => {
          Object.defineProperty(document, "hidden", { get: () => h, configurable: true });
          if (!h) document.dispatchEvent(new Event("visibilitychange"));
        }, hidden);
      await hide(true);
      await mock("orca_file_read", { ...text("a note, changed\n"), signature: "sig-2" });
      await browser.pause(1200);
      expect(await callsOf("orca_file_read")).toEqual([]);
      await hide(false);
      await waitForText("a note, changed\n");
    });

    it("takes the font of the editor from the settings", async () => {
      await openFileWindow(memo, { font_settings: { app: { family: null, size: 14, ghostty: false }, mail: { family: null, size: 14, ghostty: false }, calendar: { family: null, size: 14, ghostty: false }, todoList: { family: null, size: 14, ghostty: false }, todoWork: { family: null, size: 14, ghostty: false }, slack: { family: null, size: 14, ghostty: false }, orcaList: { family: null, size: 14, ghostty: false }, orcaPane: { family: null, size: 14, ghostty: false }, orcaWork: { family: null, size: 13, ghostty: true }, editor: { family: "Menlo", size: 16, ghostty: false }, mono: { family: null, size: 14, ghostty: false } } });
      expect(await browser.execute(() => [document.documentElement.style.getPropertyValue("--editor-family"), document.documentElement.style.getPropertyValue("--editor-size")])).toEqual(['"Menlo", ui-monospace, Menlo, monospace', "16px"]);
    });

    it("asks for the definition of the name under the mouse with the Command key, from Rust, for the Orca screen to show", async () => {
      const source = "class A\n  def go\n    Rails.logger.info(x)\n  end\nend\n";
      const ruby = popoutTab(FILE, "", "a.rb", { label: "", content: { kind: "file", path: "/work/example-app", relative: "a.rb", server: null } });
      await openFileWindow(ruby, { orca_file_read: text(source, "ruby"), lsp_server_for: "ruby", lsp_word: "Rails" }, source);
      await waitForCalls("lsp_server_for");
      const asked = await mock("orca_popout_definition", null);
      // The server is found a moment after the text is shown: the press is made until the editor takes it.
      await browser.waitUntil(async () => {
        const [box] = await charBoxes(source.indexOf("Rails") + 2);
        if (box === null) return false;
        await browser.execute(
          (b, once) => {
            if (!window.__e2e_once__(once)) return;
            document.querySelector(".orca-edit-body .cm-content")!.dispatchEvent(new MouseEvent("contextmenu", { bubbles: true, cancelable: true, button: 2, metaKey: true, clientX: b!.left + b!.width / 2, clientY: b!.top + b!.height / 2 }));
          },
          box,
          onceId(),
        );
        return (await callsOf(asked)).length > 0;
      });
      // The question is the editor's own, with no tab: Rust knows the tab of the window.
      expect((await callsOf(asked))[0]).toEqual({ query: { target: null, project: "proj_example-app", path: "/work/example-app", server: "ruby", relative: "a.rb", text: source, line: 2, character: 6, word: "Rails" } });
    });
  });


  // A diff (A-24): the page of the window reads the difference again from the file of its worktree, and from the commit when it is the file of one (A-27).
  describe("a diff", () => {
    const diff: OrcaFileDiff = {
      oldLines: ["a", "b"],
      newLines: ["a", "c", "d"],
      side: [row("same", 1, 1), row("changed", 2, 2), row("added", null, 3)],
      inline: [row("same", 1, 1), row("removed", 2, null), row("added", null, 2), row("added", null, 3)],
      changes: [{ side: 1, inline: 1 }],
      language: "plaintext",
      highlight: null,
    };
    function row(kind: OrcaDiffRow["kind"], old: number | null, now: number | null): OrcaDiffRow {
      return { kind, old, new: now };
    }
    const work = popoutTab("diff:4", "", "a.rs", { label: "", content: { kind: "diff", path: "/work/example-app", relative: "a.rs", commit: null } });
    const rows = () => count(".orca-diff-rows .odf-row");

    it("draws the icon and the name of the tab in the header, and reads the difference from HEAD of the worktree and its target, in place of a terminal", async () => {
      await openWindow(work, { orca_file_diff: diff });
      await expect($("#popout-name")).toHaveText("a.rs");
      expect(await count("#popout-icon .orca-file-tab-ic svg")).toBe(1);
      expect(await waitForCalls("orca_file_diff")).toEqual([{ path: "/work/example-app", relative: "a.rs", environment: null }]);
      await browser.waitUntil(async () => (await rows()) === 3, { timeoutMsg: "the rows never drew" });
      await expect($("#popout-term")).not.toBeDisplayed();
      await expect($("#popout-file .orca-diff")).toBeDisplayed();
      expect(await count(".orca-term")).toBe(0);
    });

    it("reads the difference of a file of a commit with the commit, its parent and the old path, and of a saved environment with its target", async () => {
      const commit = { id: "abc123def", shortId: "abc123d", parentId: "p0", oldRelative: "old.rs" };
      await openWindow({ ...work, environment: "Studio", content: { kind: "diff", path: "/work/example-app", relative: "a.rs", commit } }, { orca_commit_file_diff: diff });
      expect(await waitForCalls("orca_commit_file_diff")).toEqual([{ path: "/work/example-app", commitId: "abc123def", parentId: "p0", relative: "a.rs", oldRelative: "old.rs", environment: "Studio" }]);
      await expect($(".orca-diff-commit")).toHaveText("abc123d");
      expect(await callsOf("orca_file_diff")).toEqual([]);
    });

    it("reads the difference from HEAD again by the clock, and draws the rows that came", async () => {
      await openWindow(work, { orca_file_diff: diff, ...timers({ orcaClock: 500 }) });
      await browser.waitUntil(async () => (await rows()) === 3, { timeoutMsg: "the rows never drew" });
      await mock("orca_file_diff", { ...diff, newLines: [...diff.newLines, "e"], side: [...diff.side, row("added", null, 4)] });
      await browser.waitUntil(async () => (await rows()) === 4, { timeoutMsg: "the rows were never read again" });
    });

    it("does not read the difference again when the screen gives the same tab with another name", async () => {
      await openWindow(work, { orca_file_diff: diff });
      await waitForCalls("orca_file_diff");
      await sendPopoutTab({ ...work, title: "b.rs" });
      await expect($("#popout-name")).toHaveText("b.rs");
      expect(await callsOf("orca_file_diff")).toHaveLength(1);
    });
  });

  // A definition (A-34): the page of the window asks the server again with the question of the tab, and what its open button asks goes to Rust, for the Orca screen to show.
  describe("a definition", () => {
    const query = { target: null, project: "proj_example-app", path: "/work/example-app", server: "ruby", relative: "a.rb", text: "Rails.logger\n", line: 0, character: 2, word: "Rails" };
    const asked = popoutTab("definition:1", "", "定義 ・ Rails", { label: "", content: { kind: "definition", ...query } });
    const answers = {
      lsp_definition: [{ path: "app/lib/rails_ext.rb", outside: false, line: 6, character: 2 }],
      lsp_places: [{ file: "rails_ext.rb", line: 7, place: "app/lib", outside: false, language: "ruby" }],
      orca_file_read: { content: "one\ntwo\nthree\nfour\nfive\nsix\nseven\neight\n", crlf: false, signature: "sig-1", language: "ruby" } satisfies OrcaFileText,
    };

    it("asks the server for the definition with the question of the tab, and draws its places", async () => {
      await openWindow(asked, answers);
      await expect($("#popout-name")).toHaveText("定義 ・ Rails");
      expect(await waitForCalls("lsp_definition")).toEqual([{ environment: null, worktree: "/work/example-app", server: "ruby", relative: "a.rb", text: "Rails.logger\n", line: 0, character: 2 }]);
      expect(await waitForCalls("lsp_places")).toEqual([{ locations: answers.lsp_definition }]);
      await waitForCount(".orca-definition .orca-def", 1);
      expect(await textsOf(".orca-definition-head > span")).toEqual(["Rails", "1 件"]);
      expect(await textsOf(".orca-definition .orca-def-file")).toEqual(["app/lib/rails_ext.rb:7"]);
      expect(await waitForCalls("orca_file_read")).toEqual([{ path: "/work/example-app", relative: "app/lib/rails_ext.rb", environment: null }]);
    });

    it("asks the server of a saved environment with its target", async () => {
      await openWindow({ ...asked, environment: "Studio", content: { kind: "definition", ...query, target: "Studio" } }, answers);
      expect((await waitForCalls("lsp_definition"))[0]).toMatchObject({ environment: "Studio" });
    });

    it("tells Rust the place of the row when its open button is pressed, and opens nothing here", async () => {
      await openWindow(asked, { ...answers, orca_popout_place: null });
      await waitForCount(".orca-definition .orca-def", 1);
      await $(".orca-definition .orca-def-open").click();
      expect(await waitForCalls("orca_popout_place")).toEqual([{ path: "app/lib/rails_ext.rb", outside: false, line: 6, character: 2 }]);
      expect(await count(".cm-content")).toBe(0);
    });

    it("asks again with the new question when the screen gives the tab with one", async () => {
      await openWindow(asked, answers);
      await waitForCount(".orca-definition .orca-def", 1);
      await sendPopoutTab({ ...asked, title: "定義 ・ Logger", content: { kind: "definition", ...query, word: "Logger", character: 8 } });
      await expect($("#popout-name")).toHaveText("定義 ・ Logger");
      await browser.waitUntil(async () => (await callsOf("lsp_definition")).length === 2, { timeoutMsg: "the server was never asked again" });
      expect((await callsOf("lsp_definition")).at(-1)).toMatchObject({ character: 8 });
      expect(await textsOf(".orca-definition-head > span")).toEqual(["Logger", "1 件"]);
    });
  });

  // A database tab (A-43): the page of the window reads the table of the connection again, at the page, in the tab and with the SQL it was given; a lost connection is told to Rust.
  describe("a database", () => {
    const content = { kind: "database" as const, connection: "p1", name: "Example direct", database: "shop", table: "orders" as string | null, tab: "records", page: 2, sql: "select 1" };
    const orders = popoutTab("database:2", "", "orders · Example direct", { label: "", content });
    const records = databaseRecords(["id", "name"], [[databaseCell("1", "number"), databaseCell("Alice")]], { summary: "1–1 行目", tsv: "id\tname\n1\tAlice" });
    const cells = () => browser.execute(() => [...document.querySelectorAll(".orca-database-tab .database-grid tbody tr")].map((tr) => [...tr.children].map((td) => td.textContent)));

    it("reads the page of the table that the tab had, and draws it with the tabs of the table", async () => {
      await openWindow(orders, { database_records: records });
      await expect($("#popout-name")).toHaveText("orders · Example direct");
      expect(await count("#popout-icon .orca-file-tab-ic svg")).toBe(1);
      expect(await waitForCalls("database_records")).toEqual([{ id: "p1", database: "shop", table: "orders", page: 2, estimate: null }]);
      await waitForCount(".orca-database-tab .database-grid", 1);
      expect(await cells()).toEqual([["1", "Alice"]]);
      expect(await textsOf(".orca-database-tab .database-tab")).toEqual(["レコード", "構造", "SQL"]);
    });

    it("reads the structure too when the tab of the table was the structure", async () => {
      await openWindow({ ...orders, content: { ...content, tab: "structure" } }, { database_records: records, database_structure: databaseStructure([databaseColumn("id", "int")]) });
      expect(await waitForCalls("database_structure")).toEqual([{ id: "p1", database: "shop", table: "orders" }]);
      await waitForCount(".orca-database-tab .database-grid", 1);
    });

    it("opens the SQL of a database with its text, reads nothing, and runs it on the connection and database of the tab", async () => {
      await openWindow({ ...orders, title: "SQL · shop · Example direct", content: { ...content, table: null, tab: "sql", page: 0 } }, { database_sql: databaseSqlResult(["n"], [[databaseCell("1", "number")]]) });
      await expect($(".orca-database-tab [data-key='sql-input']")).toHaveValue("select 1");
      expect(await callsOf("database_records")).toEqual([]);
      await $('.orca-database-tab [data-key="run"]').click();
      expect(await waitForCalls("database_sql")).toEqual([{ id: "p1", database: "shop", sql: "select 1" }]);
    });

    it("tells Rust which connection was lost, with Rust's words, when the read of the records fails", async () => {
      await openWindow(orders, { database_records: rejects("接続が切れました"), orca_popout_lost: null });
      expect(await waitForCalls("orca_popout_lost")).toEqual([{ connection: "p1", error: "接続が切れました" }]);
    });

    it("copies the list that is shown to the clipboard as Rust made its text, and shows no failure", async () => {
      await openWindow(orders, { database_records: records });
      await waitForCount(".orca-database-tab .database-grid", 1);
      await stubClipboard();
      await $(".orca-database-tab [data-key='copy']").click();
      await browser.waitUntil(async () => (await copiedTexts()).length === 1, { timeoutMsg: "the list was never copied" });
      expect(await copiedTexts()).toEqual(["id\tname\n1\tAlice"]);
      expect(await count(CARD)).toBe(0);
    });
  });

  it("shows the message when the tab cannot be taken from Rust", async () => {
    await openWindow(shell, { orca_popout_attach: rejects("このウィンドウにタブがありません") });
    await expect($(CARD)).toHaveText("このウィンドウにタブがありません");
  });

  it("is made by Rust for the tab it was asked for: the page that attaches gets the tab as it was given, the window can be pinned, and a tab that has its window is not given a second", async () => {
    const label = await openWindow(shell, { orca_terminal_read: ["$"] });
    const attached = await browser.execute(async () => {
      const w = window as unknown as Bridge;
      try {
        return await w.__TAURI_INTERNALS__.invoke("orca_popout_attach", { channel: new w.__TAURI__.core.Channel() });
      } catch (e) {
        return { refused: String(e) };
      }
    });
    expect(attached).toEqual(shell);
    expect(await real("orca_popout_pin", { pinned: true })).toBeNull();
    expect(await real("orca_popout_pin", { pinned: false })).toBeNull();
    // The commands of the screen are refused to a window made here: it cannot end, bring up, give or take the windows of the others.
    const refused = { refused: "本体の画面だけが使えます" };
    expect(await real("orca_popout_end", { tab: shell.tab })).toEqual(refused);
    expect(await real("orca_popout_focus", { tab: shell.tab })).toEqual(refused);
    expect(await real("orca_popout_update", { was: shell.tab, tab: shell })).toEqual(refused);
    expect(await real("orca_popout_open", { tab: popoutTab("orca:term_b", "term_b", "bash") })).toEqual(refused);
    const asked = await browser.execute(async () => {
      const w = window as unknown as Bridge;
      try {
        return await w.__TAURI_INTERNALS__.invoke("orca_popout_main", { channel: new w.__TAURI__.core.Channel() });
      } catch (e) {
        return { refused: String(e) };
      }
    });
    expect(asked).toEqual(refused);
    // A tab that has its window is given the same one, not a second.
    await browser.switchToWindow("main");
    expect(await real("orca_popout_open", { tab: shell })).toBe(label);
    expect(await browser.getWindowHandles()).toEqual(expect.arrayContaining(["main", label]));
    expect((await browser.getWindowHandles()).length).toBe(2);
  });
});
