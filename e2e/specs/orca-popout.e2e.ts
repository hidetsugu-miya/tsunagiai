// A-46: the page of the window of a tab (`popout.html`, `ts/popout.ts`). Rust makes the window (`orca_popout_open`, which this spec calls through the app's own bridge, the fixtures of the page being cut off for it), and the page runs with the answers of its own fixtures:
// the commands the window sends are mocked, as in every spec. What the Orca screen does with a window is in `orca.e2e.ts`; the red button, the pin that keeps the window on top and the end of the main window are checked by hand (`tauri dev`), as WebDriver cannot press them.
import type { OrcaFileText } from "../../ts/bindings/OrcaFileText";
import type { OrcaSaved } from "../../ts/bindings/OrcaSaved";
import type { PopoutTab } from "../../ts/bindings/PopoutTab";
import { boot, callsOf, count, mock, onceId, popoutTab, rejects, sendPopoutClose, sendPopoutTab, sendTerm, textsOf, timers, waitForCalls, CARD } from "../support";

type Bridge = { __TAURI_INTERNALS__: { invoke: (command: string, args: object) => Promise<unknown> }; __TAURI__: { core: { Channel: new () => object } } };

// Calls a command of Rust from the page that is shown, past the fixtures; a refusal is answered as {error}.
const real = (command: string, args: object = {}) =>
  browser.execute(
    async (c, a) => {
      try {
        return await (window as unknown as Bridge).__TAURI_INTERNALS__.invoke(c, a);
      } catch (e) {
        return { error: String(e) };
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
    const text = (content: string, language = "plaintext"): OrcaFileText => ({ content, crlf: false, signature: "sig-1", language, highlight: null });
    const saved = (signature: string): OrcaSaved => ({ state: "saved", signature });
    const area = () => $(".orca-edit-area");
    // A window of the file, with the text read and the autosave short.
    async function openFileWindow(tab: PopoutTab = memo, fixtures: Record<string, unknown> = {}, shown = "a note\n") {
      const label = await openWindow(tab, { orca_file_read: text("a note\n"), editor_settings: { autosaveMs: 100, autosaveMin: 100, autosaveMax: 3000, autosaveStep: 100 }, ...fixtures });
      await expect(area()).toHaveValue(shown, { trim: false });
      return label;
    }
    async function typeX() {
      await area().click();
      await browser.keys("x");
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
      await openWindow(gem, { lsp_read_outside: { path: "/usr/local/bundle/gems/rails.rb", text: "module Rails\nend\n", language: "ruby", highlight: null } });
      await expect(area()).toHaveValue("module Rails\nend\n", { trim: false });
      expect(await count("#popout-icon .orca-ic[aria-label='読み取り専用']")).toBe(1);
      expect(await area().getAttribute("readonly")).not.toBeNull();
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
      await expect(area()).toHaveValue("a note\nx", { trim: false });
    });

    it("keeps the file in the window when the save before putting the tab back is refused", async () => {
      await openFileWindow();
      await mock("orca_file_write", { state: "changed", signature: "sig-1" } satisfies OrcaSaved);
      const restore = await mock("orca_popout_restore", null);
      await typeX();
      await $("#popout-restore").click();
      await expect($(".orca-edit-state")).toHaveText("ディスクのファイルが変わっています");
      expect(await callsOf(restore)).toEqual([]);
      await expect(area()).toHaveValue("a note\nx", { trim: false });
    });

    it("opens the file here again, with the message, when the tab could not be put back", async () => {
      await openFileWindow();
      await mock("orca_popout_restore", rejects("戻せませんでした"));
      await $("#popout-restore").click();
      await expect($(CARD)).toHaveText("戻せませんでした");
      await expect(area()).toHaveValue("a note\n", { trim: false });
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
      await expect(area()).toHaveValue("a note\nx", { trim: false });
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
      await expect(area()).toHaveValue("a note, changed\n", { trim: false });
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
        await browser.execute(
          (offset, once) => {
            if (!window.__e2e_once__(once)) return;
            const walker = document.createTreeWalker(document.querySelector(".orca-edit-hl code")!, NodeFilter.SHOW_TEXT);
            let left = offset;
            for (let node = walker.nextNode() as Text | null; node !== null; node = walker.nextNode() as Text | null) {
              if (left >= node.length) {
                left -= node.length;
                continue;
              }
              const range = document.createRange();
              range.setStart(node, left);
              range.setEnd(node, left + 1);
              const box = range.getBoundingClientRect();
              document.querySelector(".orca-edit-area")!.dispatchEvent(new MouseEvent("contextmenu", { bubbles: true, cancelable: true, button: 2, metaKey: true, clientX: box.left + box.width / 2, clientY: box.top + box.height / 2 }));
              return;
            }
          },
          source.indexOf("Rails") + 2,
          onceId(),
        );
        return (await callsOf(asked)).length > 0;
      });
      // The question is the editor's own, with no tab: Rust knows the tab of the window.
      expect((await callsOf(asked))[0]).toEqual({ query: { target: null, project: "proj_example-app", path: "/work/example-app", server: "ruby", relative: "a.rb", text: source, line: 2, character: 6, word: "Rails" } });
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
        return { error: String(e) };
      }
    });
    expect(attached).toEqual(shell);
    expect(await real("orca_popout_pin", { pinned: true })).toBeNull();
    expect(await real("orca_popout_pin", { pinned: false })).toBeNull();
    // A tab that has its window is given the same one, not a second.
    await browser.switchToWindow("main");
    expect(await real("orca_popout_open", { tab: shell })).toBe(label);
    expect(await browser.getWindowHandles()).toEqual(expect.arrayContaining(["main", label]));
    expect((await browser.getWindowHandles()).length).toBe(2);
  });
});
