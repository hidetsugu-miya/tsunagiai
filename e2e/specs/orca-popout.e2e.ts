// A-46: the page of the window of a tab (`popout.html`, `ts/popout.ts`). Rust makes the window (`orca_popout_open`, which this spec calls through the app's own bridge, the fixtures of the page being cut off for it), and the page runs with the answers of its own fixtures:
// the commands the window sends are mocked, as in every spec. What the Orca screen does with a window is in `orca.e2e.ts`; the red button, the pin that keeps the window on top and the end of the main window are checked by hand (`tauri dev`), as WebDriver cannot press them.
import type { PopoutTab } from "../../ts/bindings/PopoutTab";
import { boot, callsOf, count, mock, popoutTab, rejects, sendPopoutTab, sendTerm, textsOf, timers, waitForCalls, CARD } from "../support";

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
