import type { OrcaDir } from "../../ts/bindings/OrcaDir";
import type { OrcaFileText } from "../../ts/bindings/OrcaFileText";
import type { OrcaStarted } from "../../ts/bindings/OrcaStarted";
import type { PaneLayout } from "../../ts/bindings/PaneLayout";
import type { PaneNode } from "../../ts/bindings/PaneNode";
import { askScreen, boot, callsOf, claudeReady, chooseAppearance, chooseOption, chooseTheme, copiedTexts, count, fire, fontSettings, ghosttyImport, holds, huge, image, inbox, isoDate, logged, mock, note, onceId, orcaRow, orcaTerminal, orcaWorktree, PNG, rejects, release, sendStream, sendTerm, setClock, slackLoad, setDark, stubClipboard, terminalThemes, textsOf, timers, todoData, waitForCalls, waitForCount, CARD, CARDS } from "../support";
import { beside, claudeTab, filesToggle, onThisMachine, openOrca, orcaOverview, pickItem, project, sample, selectedTab, showAgain, streamList, studio, tabOf, tabTitles, worktrees } from "../orca-support";

// example-app with a second worktree, so that the plus asks which one (A-16); example-api keeps its one.
const twoWorktrees = () => [orcaWorktree("example-app", "feat/a"), orcaWorktree("example-app", "feat/b", { path: "/work/example-app-b" }), orcaWorktree("example-api", "main")];
// What `orca_start` answers for a session started in example-api, and its row once the list holds it (a pane that is not one of the sample's).
const reply: OrcaStarted = { paneKey: "tab_new:leaf_1", handle: "term_new" };
const startedRow = () => orcaRow("example-api", "main", "Write the docs", { paneKey: "tab_new:leaf_1", handle: "term_new" });
// What `orca_start` and `orca_terminal_create` answer when Orca's reply gave neither a pane key nor a handle.
const noPane: OrcaStarted = { paneKey: null, handle: null };
// What `orca_terminal_create` answers for a terminal made in example-api (it has a handle and no pane key), and the plain terminal once the list holds it.
const created: OrcaStarted = { paneKey: null, handle: "term_new_sh" };
const createdTerminal = () => orcaTerminal("example-api", "zsh", { handle: "term_new_sh" });
// The three items of the plus: the icons of the terminal and the scratchpad (found by their aria-label), and the row of Claude.
const CLAUDE = "Claude を起動";
const TERMINAL = "ターミナルを開く";
const SCRATCHPAD = "スクラッチパッド";
// The AI CLIs that `orca agent installed` lists for a place (A-16), and the row that each makes in the plus.
const claudeAgent = { id: "claude", name: "Claude", default: true };
const antigravity = { id: "antigravity", name: "Antigravity", default: false };
const codex = { id: "codex", name: "Codex", default: false };
const ANTIGRAVITY = "Antigravity を起動";
const CODEX = "Codex を起動";
// The names of the buttons of the open menu of the plus, in order (an icon button by its aria-label, a row by its text).
const menuItems = () => browser.execute(() => [...document.querySelectorAll('.menu[role="menu"] button')].map((b) => b.getAttribute("aria-label") ?? b.textContent));

const classOf = (selector: string) => browser.execute((s) => document.querySelector(s)!.className, selector);
// Whether the sidebar icon of Orca is marked as working (the yellow icon that fades; the fade itself is not tested).
const marked = () => browser.execute(() => document.getElementById("nav-orca")!.classList.contains("working"));
const pressed = (repo: string) => worktreeRow(repo).getAttribute("aria-pressed");
// The size the pane fits, which the keys typed in a shown terminal carry (A-12, "Keys").
const PANE = { cols: expect.any(Number), rows: expect.any(Number) };
// The window of an E2E run is never the front one, so the document is made to say it has the focus: a change of the pane takes the size of its terminal only then (A-12, "Size").
const focusWindow = () =>
  browser.execute(() => {
    document.hasFocus = () => true;
  });
// The text of the terminal shown (the terminals of the other tabs stay, hidden).
const screenText = () => $(".orca-term .orca-term-box:not([hidden]) .xterm-rows").getText();

// Selects the project of `repo` in the list pane (the plus starts in the selected one).
async function pickProject(repo: string) {
  await $(`#orca-list .orca-project[data-key="proj_${repo}"]`).click();
  await expect($(`#orca-list .orca-project[data-key="proj_${repo}"]`)).toHaveAttribute("aria-pressed", "true");
}

// The page's own press of the plus (the driver's click focuses the button after the page's handler ran, which no real press does). The press of an item of its menu is `pickItem` (`../orca-support`).
async function pressPlus(selector = ".orca-plus") {
  await browser.execute(
    (id, plus) => {
      if (window.__e2e_once__(id)) document.querySelector<HTMLElement>(plus)!.click();
    },
    onceId(),
    selector,
  );
  await expect($('.menu[role="menu"]')).toBeDisplayed();
}
// Selects the project of `repo`, then chooses `label` in the plus. The worktree dialog, when the project has none or several, is the caller's.
async function plus(repo: string, label: string) {
  await pickProject(repo);
  await pressPlus();
  await pickItem(label);
}
// The same, and picks the worktree at `path` in the dialog that a project with several asks with.
async function plusIn(repo: string, label: string, path: string) {
  await plus(repo, label);
  await expect($(".orca-dest-pop")).toBeDisplayed();
  await $(`.orca-dest-pop button[data-path="${path}"]`).click();
}

// The row of the worktree of `repo` under its project (the main one of the sample: `/work/{repo}`).
const worktreeRow = (repo: string) => $(`#orca-feed .orca-worktree[data-worktree="/work/${repo}"]`);

// Selects the project of `repo`, then its worktree (the newest session of it, the Claude agent).
async function select(repo: string) {
  await pickProject(repo);
  await worktreeRow(repo).click();
  await expect(worktreeRow(repo)).toHaveAttribute("aria-pressed", "true");
}

// fixtures.js makes the page report a shown window; a spec turns it hidden or shown and tells the page.
const setWindowHidden = (hidden: boolean) =>
  browser.execute(
    (id, h) => {
      if (!window.__e2e_once__(id)) return;
      Object.defineProperty(document, "hidden", { get: () => h, configurable: true });
      document.dispatchEvent(new Event("visibilitychange"));
    },
    onceId(),
    hidden,
  );

type Row = ReturnType<typeof orcaRow>;

// The count of the sidebar button: 0 is no number at all.
const expectCount = (n: number) => (n === 0 ? expect($("#nav-orca .nav-count")).not.toBeDisplayed() : expect($("#nav-orca .nav-count")).toHaveText(String(n)));

// Answers the next read with `rows`, shows the screen again, and waits until the list of projects shows the status of each, so a count checked after it is the one of that read.
async function reread(rows: Row[], extra: Partial<Parameters<typeof orcaOverview>[2]> = {}) {
  const read = orcaOverview(rows, worktrees(), extra);
  const overview = await mock("orca_overview", read);
  await showAgain();
  await waitForCalls(overview);
  // A project that is not running (the gray dot, no session) is left out under the link (A-8).
  const drawn = read.projects.filter((p) => p.status !== "idle" || p.sessions > 0).map((p) => p.key).sort();
  await browser.waitUntil(
    async () => JSON.stringify((await browser.execute(() => [...document.querySelectorAll<HTMLElement>("#orca-feed .orca-project")].map((r) => r.dataset.key))).sort()) === JSON.stringify(drawn),
    { timeoutMsg: "the list of projects did not draw the read" },
  );
}

const working = (repo: string, extra: Partial<Row> = {}) => orcaRow(repo, "main", `Task of ${repo}`, extra);
// What Orca says of a finished agent, and of one stopped with Esc (`state` done with `interrupted` true).
const finished = (repo: string, extra: Partial<Row> = {}) => working(repo, { group: "done", ...extra });
const stopped = (repo: string) => finished(repo, { status: "interrupted" });

// A drag of the divider (pointer events, as the divider listens for them) that ends with the pointer at `fraction` of #orca's width from its left edge.
const dragDivider = (fraction: number) =>
  browser.execute((f) => {
    const box = document.getElementById("orca")!.getBoundingClientRect();
    const at = (x: number): PointerEventInit => ({ bubbles: true, cancelable: true, pointerId: 7, button: 0, clientX: box.left + box.width * x, clientY: box.top + 80 });
    document.getElementById("orca-split")!.dispatchEvent(new PointerEvent("pointerdown", at(0.3)));
    document.dispatchEvent(new PointerEvent("pointermove", at(f)));
    document.dispatchEvent(new PointerEvent("pointerup", at(f)));
  }, fraction);

// The page's clock a little over the minute that a list of the AI CLIs is trusted (A-16): showing the screen again reads it then.
const aMinutePasses = () => {
  const later = new Date(Date.now() + 61_000);
  return setClock(`${isoDate(later)}T${later.toTimeString().slice(0, 8)}`);
};

describe("orca", () => {
  it("shows the count of what needs the user on the sidebar, and the projects in the list", async () => {
    await boot({ inbox: inbox(), orca_overview: orcaOverview(sample(), worktrees()) });
    // The count follows the first read, with the screen not shown: the waiting agent only, not the working ones and not the one done before the start.
    await expect($("#nav-orca .nav-count")).toHaveText("1");
    // The two working agents (the one with no pane too) are in the label and mark the icon, not in the count.
    await expect($("#nav-orca")).toHaveAttribute("aria-label", "開発（確認待ち 1 件、作業中 2 件）");
    expect(await marked()).toBe(true);
    await $("#nav-orca").click();
    await expect($("#orca")).toBeDisplayed();
    // The list holds the projects, and the work (the bell, A-8) is not shown until the bell is pressed.
    expect(await count("#orca-feed .orca-project")).toBe(4);
    await expect($("#orca-bell")).toExist();
    await expect($("#orca-bell")).toHaveAttribute("aria-pressed", "false");
    expect(await count("#orca-feed .orca-active")).toBe(0);
  });

  it("has no footer, no label of the target and no menu of it at the bottom of the list pane, whatever the read says", async () => {
    await openOrca(orcaOverview(sample(), worktrees(), studio));
    const absent = () => browser.execute(() => ({ gone: ["orca-foot", "orca-status", "orca-target"].filter((id) => document.getElementById(id) !== null), last: document.getElementById("orca-list")!.lastElementChild!.id }));
    // The last child is the region of the projects that are not running, pinned at the bottom (A-8): it is no footer, label or menu.
    expect(await absent()).toEqual({ gone: [], last: "orca-stopped" });
    await mock("orca_overview", orcaOverview([], [], { state: "failed", message: "Orca is not running", ...studio }));
    await showAgain();
    await expect($("#orca-notice")).toHaveText("Studio を読み込めませんでした: Orca is not running");
    expect(await absent()).toEqual({ gone: [], last: "orca-stopped" });
    await mock("orca_overview", orcaOverview([], [], { state: "missing" }));
    await showAgain();
    await expect($("#orca-notice")).toHaveText(expect.stringContaining("orca コマンドが見つかりません"));
    expect(await absent()).toEqual({ gone: [], last: "orca-stopped" });
  });

  it("makes the header of the list, the bar of a pane and the bar of the file pane a place to drag the window by", async () => {
    await openOrca();
    await expect($("#orca-header")).toHaveAttribute("data-tauri-drag-region");
    await expect($(".orca-tabbar")).toHaveAttribute("data-tauri-drag-region");
    await expect($("#orca-files-bar")).toHaveAttribute("data-tauri-drag-region");
    await expect($("#orca-list-toggle")).not.toHaveAttribute("data-tauri-drag-region");
  });

  it("counts nothing while the agents only work", async () => {
    await openOrca(orcaOverview([working("example-app"), working("example-api")], worktrees()));
    await expectCount(0);
    await expect($("#nav-orca")).toHaveAttribute("aria-label", "開発（作業中 2 件）");
    expect(await marked()).toBe(true);
  });

  it("marks the icon while an agent works, and clears it when none does", async () => {
    await openOrca(orcaOverview([working("example-app")], worktrees()));
    expect(await marked()).toBe(true);
    await expect($("#nav-orca")).toHaveAttribute("aria-label", "開発（作業中 1 件）");
    await reread([finished("example-app")]);
    expect(await marked()).toBe(false);
    await expect($("#nav-orca")).toHaveAttribute("aria-label", "開発（確認待ち 1 件）");
    await reread([working("example-app")]);
    expect(await marked()).toBe(true);
    await reread([]);
    expect(await marked()).toBe(false);
    await expect($("#nav-orca")).toHaveAttribute("aria-label", "開発");
  });

  it("does not mark the icon for agents that wait or have stopped", async () => {
    await openOrca(orcaOverview([working("example-app")], worktrees()));
    await reread([working("example-api", { group: "waiting" }), finished("example-lib"), stopped("example-web"), working("example-app", { status: "failed" })]);
    expect(await marked()).toBe(false);
    await expect($("#nav-orca")).toHaveAttribute("aria-label", "開発（確認待ち 4 件）");
  });

  it("clears the mark when a read fails or the command is missing", async () => {
    await openOrca(orcaOverview([working("example-app")], worktrees()));
    expect(await marked()).toBe(true);
    await mock("orca_overview", orcaOverview([], [], { state: "failed", message: "Orca is not running", environments: [] }));
    await showAgain();
    await expect($("#orca-notice")).toHaveText("読み込めませんでした: Orca is not running");
    expect(await marked()).toBe(false);
    await expect($("#nav-orca")).toHaveAttribute("aria-label", "開発");
    await mock("orca_overview", orcaOverview([working("example-app")], worktrees()));
    await showAgain();
    await browser.waitUntil(marked, { timeoutMsg: "the mark never came back" });
    await mock("orca_overview", orcaOverview([], [], { state: "missing" }));
    await showAgain();
    await expect($("#orca-notice")).toHaveText(expect.stringContaining("orca コマンドが見つかりません"));
    expect(await marked()).toBe(false);
    await expect($("#nav-orca")).toHaveAttribute("aria-label", "開発");
  });

  it("clears the mark when a read names another target, and marks again from the read of the new one", async () => {
    await openOrca(orcaOverview([working("example-app")], worktrees(), { target: "Studio", environments: ["Studio", "Lab"] }));
    expect(await marked()).toBe(true);
    const overview = await mock("orca_overview", orcaOverview([finished("lab-app")], [], { target: "Lab", environments: ["Studio", "Lab"] }));
    await showAgain();
    await waitForCalls(overview);
    expect(await marked()).toBe(false);
    await reread([working("lab-app")], { target: "Lab", environments: ["Studio", "Lab"] });
    expect(await marked()).toBe(true);
  });

  it("marks and clears the icon from the read for the count alone while another screen is shown", async () => {
    await openOrca(orcaOverview([finished("example-lib")], worktrees()));
    expect(await marked()).toBe(false);
    await $("#nav-mail").click();
    await expect($("#orca")).not.toBeDisplayed();
    // The clock reads the count alone once a minute on another screen: a minute later the next tick does.
    const started = await mock("orca_overview", orcaOverview([working("example-app")], worktrees()));
    const at = (ms: number) => {
      const later = new Date(Date.now() + ms);
      return setClock(`${isoDate(later)}T${later.toTimeString().slice(0, 8)}`);
    };
    await at(61_000);
    expect(await waitForCalls(started)).toEqual([{ scope: "badge", target: null }]);
    await browser.waitUntil(marked, { timeoutMsg: "the icon was never marked by the read for the count" });
    await expect($("#nav-orca")).toHaveAttribute("aria-label", "開発（作業中 1 件）");
    const ended = await mock("orca_overview", orcaOverview([finished("example-app")], worktrees()));
    await at(130_000);
    expect(await waitForCalls(ended)).toEqual([{ scope: "badge", target: null }]);
    await browser.waitUntil(async () => !(await marked()), { timeoutMsg: "the mark was never cleared by the read for the count" });
    await expect($("#nav-orca")).toHaveAttribute("aria-label", "開発（確認待ち 1 件）");
  });

  it("does not count what had finished before the start, or stopped with Esc", async () => {
    await openOrca(orcaOverview([working("example-app"), finished("example-lib"), stopped("example-web")], worktrees()));
    await expectCount(0);
    await reread([working("example-app"), finished("example-lib"), stopped("example-web")]);
    await expectCount(0);
  });

  it("counts an agent that goes from working to done", async () => {
    await openOrca(orcaOverview([working("example-app"), working("example-api")], worktrees()));
    await reread([finished("example-app"), working("example-api")]);
    await expectCount(1);
    await expect($("#nav-orca")).toHaveAttribute("aria-label", "開発（確認待ち 1 件、作業中 1 件）");
  });

  it("counts an agent that appears in a later read already done", async () => {
    await openOrca(orcaOverview([working("example-app")], worktrees()));
    await reread([working("example-app"), finished("example-lib")]);
    await expectCount(1);
  });

  it("counts an interrupted agent and a failed one", async () => {
    await openOrca(orcaOverview([working("example-app"), working("example-api")], worktrees()));
    await reread([stopped("example-app"), working("example-api", { status: "failed" })]);
    await expectCount(2);
  });

  it("counts a waiting agent and a stopped one together, and a waiting one with no pane", async () => {
    await openOrca(orcaOverview([working("example-app"), working("example-api", { group: "waiting" })], worktrees()));
    await expectCount(1);
    await reread([finished("example-app"), working("example-api", { group: "waiting" }), working("example-web", { group: "waiting", paneKey: null, handle: null })]);
    await expectCount(3);
  });

  it("gives an agent with no pane no notice when it stops", async () => {
    await openOrca(orcaOverview([working("example-app", { paneKey: null, handle: null })], worktrees()));
    await reread([finished("example-app", { paneKey: null, handle: null })]);
    await expectCount(0);
  });

  it("drops the notice when the session is opened on the screen", async () => {
    await openOrca(orcaOverview([working("example-app"), working("example-api")], worktrees()));
    await reread([finished("example-app"), finished("example-api")]);
    await expectCount(2);
    await select("example-app");
    await expectCount(1);
    // The session stays done, and is not noticed again by the next read.
    await reread([finished("example-app"), finished("example-api")]);
    await expectCount(1);
  });

  it("gives no notice to the session shown when it finishes", async () => {
    await openOrca(orcaOverview([working("example-app"), working("example-api")], worktrees()));
    await select("example-app");
    await reread([finished("example-app"), working("example-api")]);
    await expectCount(0);
  });

  it("keeps the notice of a session finished while the window is hidden, and drops it when the window shows", async () => {
    await openOrca(orcaOverview([working("example-app")], worktrees()));
    await select("example-app");
    await setWindowHidden(true);
    await reread([finished("example-app")]);
    await expectCount(1);
    await setWindowHidden(false);
    await expectCount(0);
  });

  it("drops the notice when the agent runs again, or leaves the list", async () => {
    await openOrca(orcaOverview([working("example-app"), working("example-api")], worktrees()));
    await reread([finished("example-app"), finished("example-api")]);
    await expectCount(2);
    await reread([working("example-app"), finished("example-api")]);
    await expectCount(1);
    await reread([working("example-app")]);
    await expectCount(0);
    // It stops again: a new notice.
    await reread([finished("example-app")]);
    await expectCount(1);
  });

  it("does not drop the notices when a read fails, and drops them when the command is missing", async () => {
    await openOrca(orcaOverview([working("example-app")], worktrees()));
    await reread([finished("example-app")]);
    await expectCount(1);
    await mock("orca_overview", orcaOverview([], [], { state: "failed", message: "Orca is not running", environments: [] }));
    await showAgain();
    await expect($("#orca-notice")).toHaveText("読み込めませんでした: Orca is not running");
    await expectCount(1);
    await mock("orca_overview", orcaOverview([], [], { state: "missing" }));
    await showAgain();
    await expect($("#orca-notice")).toHaveText(expect.stringContaining("orca コマンドが見つかりません"));
    await expectCount(0);
  });

  it("drops the notices when a read names another target, and takes the first read of the new target as the base", async () => {
    await openOrca(orcaOverview([working("example-app")], worktrees(), { target: "Studio", environments: ["Studio", "Lab"] }));
    await reread([finished("example-app")], { target: "Studio", environments: ["Studio", "Lab"] });
    await expectCount(1);
    const overview = await mock("orca_overview", orcaOverview([finished("lab-app")], [], { target: "Lab", environments: ["Studio", "Lab"] }));
    await showAgain();
    await waitForCalls(overview);
    await expect($("#orca-feed .spin")).not.toExist();
    await expectCount(0);
  });

  it("gives no new notice to a stopped agent that left the list for a read and comes back stopped", async () => {
    await openOrca(orcaOverview([working("example-app"), working("example-api")], worktrees()));
    await reread([finished("example-app"), working("example-api")]);
    await expectCount(1);
    // It leaves the list: its notice goes, and the app remembers that it was stopped.
    await reread([working("example-api")]);
    await expectCount(0);
    await reread([finished("example-app"), working("example-api")]);
    await expectCount(0);
    // A pane the app never saw stopped still has a notice when it first appears stopped.
    await reread([finished("example-app"), working("example-api"), finished("example-lib")]);
    await expectCount(1);
  });

  it("drops the notices when a read names another target than the one held, and takes that read as the base", async () => {
    const environments = ["Studio", "Lab"];
    await openOrca(orcaOverview([working("example-app")], worktrees(), { target: "Studio", environments }));
    await reread([finished("example-app")], { target: "Studio", environments });
    await expectCount(1);
    // The target changed without the card (for example the saved one was changed): the rows of the other target are only the base.
    await reread([finished("lab-app")], { target: "Lab", environments });
    await expectCount(0);
    await reread([finished("lab-app"), finished("lab-lib")], { target: "Lab", environments });
    await expectCount(1);
  });

  it("keeps the notice of a session that finished while another screen is shown, until the Orca screen shows it", async () => {
    await openOrca(orcaOverview([working("example-app"), working("example-api")], worktrees()), { todoist_load: todoData(), slack_load: slackLoad, claude_status: claudeReady });
    await select("example-app");
    await $("#nav-todo").click();
    await expect($("#orca")).not.toBeDisplayed();
    await waitForCount("#todo-list li.task", 1);
    await $("#todo-list li.task").click();
    await expect($("#todo-back")).toBeDisplayed();
    // The pane of the task reads the list when it opens, and that read finds the selected session done.
    const overview = await mock("orca_overview", orcaOverview([finished("example-app"), working("example-api")], worktrees()));
    await $("#todo-orca-open").click();
    await waitForCalls(overview);
    await expectCount(1);
    await $("#nav-orca").click();
    await expect($("#orca")).toBeDisplayed();
    await expectCount(0);
  });

  it("has the list on the left with a header of 32px level with the tab bar, the divider, and an empty work pane at the start", async () => {
    await openOrca();
    const box = await browser.execute(() => {
      const r = (selector: string) => document.querySelector(selector)!.getBoundingClientRect();
      return {
        listRight: r("#orca-list").right,
        splitLeft: r("#orca-split").left,
        splitRight: r("#orca-split").right,
        workLeft: r("#orca-work").left,
        share: r("#orca-list").width / r("#orca").width,
        header: r("#orca-header").height,
        tabs: r(".orca-tabbar").height,
        tabsRight: r(".orca-tabs").right,
        barRight: r(".orca-tabbar").right,
        plusLeft: r(".orca-plus").left,
        plusRight: r(".orca-plus").right,
        plusHeight: r(".orca-plus").height,
        headerTop: r("#orca-header").top,
        tabsTop: r(".orca-tabbar").top,
        buttons: [...document.querySelectorAll("#orca-header button")].map((b) => b.getBoundingClientRect().height),
      };
    });
    expect(box.listRight).toBeLessThanOrEqual(box.splitLeft + 1);
    expect(box.splitRight).toBeLessThanOrEqual(box.workLeft + 1);
    expect(box.share).toBeCloseTo(0.19, 2);
    expect(box.header).toBe(44);
    expect(box.tabs).toBe(44);
    expect(box.tabsTop).toBe(box.headerTop);
    expect(box.buttons).toEqual([28, 28, 28]);
    // No label, no 「新規」 and no reload button: the button of the list (A-23), the one that makes a formation (A-37) and the one that adds a project (A-38) are the only ones.
    expect(await count("#orca-heading")).toBe(0);
    expect(await count("#orca-new")).toBe(0);
    expect(await count("#orca-refresh")).toBe(0);
    const order = await browser.execute(() => [...document.querySelectorAll("#orca-header button")].map((b) => b.id));
    expect(order).toEqual(["orca-list-toggle", "formation-new", "orca-add"]);
    // The plus is in the tab bar, after the strip of tabs (the button that opens the list is before the strip, and hidden while the list is open); it is a menu button, and waits for a project.
    await expect($(".orca-plus")).toHaveAttribute("aria-label", "セッションを始める");
    await expect($(".orca-plus")).toHaveAttribute("aria-haspopup", "menu");
    await expect($(".orca-plus")).toBeDisabled();
    expect(box.plusHeight).toBe(28);
    expect(box.plusLeft).toBeGreaterThanOrEqual(box.tabsRight - 1);
    expect(box.plusRight).toBeLessThanOrEqual(box.barRight);
    const barOrder = await browser.execute(() => [...document.querySelector(".orca-tabbar")!.children].map((e) => e.className));
    expect(barOrder).toEqual(["icon-btn list-toggle", "orca-tabs", "icon-btn orca-plus", "icon-btn orca-files-toggle"]);
    // Nothing selected: no tab, no terminal, and a line that says what to do.
    expect(await count(".orca-tabs .orca-tab")).toBe(0);
    await expect($(".orca-term")).not.toBeDisplayed();
    await expect($(".orca-empty")).toHaveText("プロジェクトを選んでください");
    // No composer on this screen.
    expect(await count("#orca-input")).toBe(0);
  });

  it("selects a session with a click and shows its tab as a terminal, mirrored from this machine", async () => {
    await openOrca(orcaOverview(sample(), [...worktrees(), orcaWorktree("example-lib", "feature/x")]));
    const read = await mock("orca_terminal_read", ["$ claude", "> Write the docs"]);
    await select("example-app");
    expect(await pressed("example-app")).toBe("true");
    await expect(selectedTab()).toHaveText(expect.stringContaining("Write the docs"));
    await expect($(".orca-term")).toBeDisplayed();
    expect((await waitForCalls(read))[0]).toEqual({ handle: "term_example-app" });
    await browser.waitUntil(async () => (await screenText()).includes("Write the docs"), { timeoutMsg: "the screen of the session never showed" });
    // This machine has no stream.
    expect(await callsOf("orca_stream_terminal")).toEqual([]);
    // Another session takes the selection and its terminal.
    await mock("orca_terminal_read", ["$"]);
    await select("example-lib");
    expect(await pressed("example-app")).toBe("false");
    await expect(selectedTab()).toHaveText(expect.stringContaining("Opened the pull request."));
    expect((await waitForCalls("orca_terminal_read"))[0]).toEqual({ handle: "term_example-lib" });
  });

  it("says a session with no terminal has none, and reads nothing for it", async () => {
    await openOrca(orcaOverview([orcaRow("example-app", "feat/a", "Write the docs", { handle: null })], worktrees()));
    await select("example-app");
    await expect($(".orca-empty")).toHaveText("このセッションのターミナルはありません");
    await expect($(".orca-term")).not.toBeDisplayed();
    await browser.pause(1500);
    expect(await callsOf("orca_terminal_read")).toEqual([]);
  });

  it("is enabled by a selected project, and opens a menu of the icons of 「ターミナルを開く」 and 「スクラッチパッド」 above 「Claude を起動」", async () => {
    await openOrca();
    await expect($(".orca-plus")).toBeDisabled();
    await pickProject("example-api");
    await expect($(".orca-plus")).toBeEnabled();
    await pressPlus();
    expect(await browser.execute(() => [...document.querySelectorAll('.menu[role="menu"] button')].map((b) => b.getAttribute("aria-label") ?? b.textContent))).toEqual([TERMINAL, SCRATCHPAD, CLAUDE]);
    // The two icons only (no text) are in the row above the line, and Claude is the row under it.
    expect(await textsOf(".menu-icons button")).toEqual(["", ""]);
    expect(await count('.menu[role="menu"] > .menu-icons + [role="separator"] + button')).toBe(1);
    expect(await count('.menu-icons button[role="menuitem"]')).toBe(2);
    // Each item draws its own icon in place of the dot.
    expect(await count('.menu[role="menu"] button svg')).toBe(3);
    expect(await count('.menu[role="menu"] .pdot')).toBe(0);
    // Only the Claude icon is in the Claude color; the other two keep the color of the line.
    const colors = await browser.execute(() => {
      const probe = document.createElement("i");
      probe.style.color = "var(--claude)";
      document.body.append(probe);
      const claude = getComputedStyle(probe).color;
      probe.remove();
      return { claude, icons: [...document.querySelectorAll('.menu[role="menu"] button svg')].map((svg) => getComputedStyle(svg).color) };
    });
    expect(colors.icons[0]).not.toBe(colors.claude);
    expect(colors.icons[1]).not.toBe(colors.claude);
    expect(colors.icons[2]).toBe(colors.claude);
    await expect($(".orca-plus")).toHaveAttribute("aria-expanded", "true");
    // Escape closes it, and nothing was started.
    await browser.keys("Escape");
    await expect($(".menu")).not.toExist();
    expect(await callsOf("orca_start")).toHaveLength(0);
    expect(await callsOf("orca_terminal_create")).toHaveLength(0);
  });

  it("shows the name of an icon of the plus as a tooltip, and starts a terminal from the icon", async () => {
    await openOrca();
    await pickProject("example-api");
    await pressPlus();
    // The window has no pointer to put over the icon, so the mouseover that the tooltip listens for is dispatched, once.
    await browser.execute((once) => window.__e2e_once__(once) && document.querySelector('.menu-icons button[aria-label="スクラッチパッド"]')!.dispatchEvent(new MouseEvent("mouseover", { bubbles: true })), onceId());
    await expect($(".tooltip")).toBeDisplayed();
    await expect($(".tooltip")).toHaveText(SCRATCHPAD);
    const create = await mock("orca_terminal_create", created);
    await pickItem(TERMINAL);
    expect(await waitForCalls(create)).toEqual([{ path: "/work/example-api", environment: null }]);
    await expect($(".menu")).not.toExist();
  });

  it("lists the AI CLIs of the place under the line, Claude first with its color and the others with the general icon, and no line when nothing failed", async () => {
    await openOrca(orcaOverview(sample(), worktrees()), { orca_agents_installed: [antigravity, claudeAgent] });
    await pickProject("example-api");
    await pressPlus();
    expect(await menuItems()).toEqual([TERMINAL, SCRATCHPAD, CLAUDE, ANTIGRAVITY]);
    expect(await count('.menu[role="menu"] > .menu-icons + [role="separator"] + button')).toBe(1);
    expect(await count('.menu[role="menu"] button svg')).toBe(4);
    expect(await count('.menu[role="menu"] .pdot')).toBe(0);
    const colors = await browser.execute(() => {
      const probe = document.createElement("i");
      probe.style.color = "var(--claude)";
      document.body.append(probe);
      const claude = getComputedStyle(probe).color;
      probe.remove();
      return { claude, icons: [...document.querySelectorAll('.menu[role="menu"] button svg')].map((svg) => getComputedStyle(svg).color) };
    });
    expect(colors.icons[2]).toBe(colors.claude);
    expect(colors.icons[3]).not.toBe(colors.claude);
    expect(await count(".menu-empty")).toBe(0);
    expect(await callsOf("orca_agent_launch")).toHaveLength(0);
    expect(await callsOf("orca_start")).toHaveLength(0);
  });

  it("has no row of Claude when the place does not list it, and no row at all when it lists none", async () => {
    await openOrca(orcaOverview(sample(), worktrees()), { orca_agents_installed: [antigravity] });
    await pickProject("example-api");
    await pressPlus();
    expect(await menuItems()).toEqual([TERMINAL, SCRATCHPAD, ANTIGRAVITY]);
    await browser.keys("Escape");
    await mock("orca_agents_installed", []);
    await aMinutePasses();
    await showAgain();
    await waitForCalls("orca_agents_installed");
    await pickProject("example-api");
    await pressPlus();
    expect(await menuItems()).toEqual([TERMINAL, SCRATCHPAD]);
    // Nothing was listed and nothing failed: no line says so.
    expect(await count(".menu-empty")).toBe(0);
    expect(await count('.menu[role="menu"] [role="separator"]')).toBe(0);
  });

  it("starts another AI CLI with orca_agent_launch, once, in the one worktree, with the target the screen shows", async () => {
    await openOrca(orcaOverview(sample(), worktrees(), studio), { orca_agents_installed: [claudeAgent, antigravity] });
    const launch = await mock("orca_agent_launch", noPane);
    const start = await mock("orca_start", noPane);
    await plus("example-api", ANTIGRAVITY);
    expect(await waitForCalls(launch)).toEqual([{ path: "/work/example-api", agent: "antigravity", environment: "Studio" }]);
    expect(await callsOf(start)).toHaveLength(0);
    await expect($(".orca-dest-pop")).not.toExist();
    await expect($(".toast")).toHaveText("セッションを始めました。Orca の画面で開けます。");
    await expect($(".orca-plus")).toBeEnabled();
    expect(await callsOf(launch)).toHaveLength(1);
  });

  it("asks which worktree when the project has several before it starts another AI CLI", async () => {
    await openOrca(orcaOverview(sample(), twoWorktrees()), { orca_agents_installed: [antigravity] });
    const launch = await mock("orca_agent_launch", noPane);
    await plusIn("example-app", ANTIGRAVITY, "/work/example-app-b");
    expect(await waitForCalls(launch)).toEqual([{ path: "/work/example-app-b", agent: "antigravity", environment: null }]);
  });

  it("follows what another AI CLI started as a plain terminal, by its handle, and keeps the plus disabled meanwhile", async () => {
    await openOrca(orcaOverview(sample(), worktrees()), { orca_agents_installed: [antigravity] });
    const launch = await mock("orca_agent_launch", created);
    await mock("orca_overview", orcaOverview(sample(), worktrees()));
    await plus("example-api", ANTIGRAVITY);
    await waitForCalls(launch);
    await expect($(".toast")).toHaveText("セッションを始めました。一覧に現れるのを待っています…");
    await expect($(".orca-plus")).toBeDisabled();
    const read = await mock("orca_terminal_read", ["$ antigravity"]);
    await mock("orca_overview", orcaOverview(sample(), worktrees(), { terminals: [createdTerminal()] }));
    await showAgain();
    expect((await waitForCalls(read))[0]).toEqual({ handle: "term_new_sh" });
    await expect($('.orca-tabs [data-tab="orca:term_new_sh"] [role="tab"]')).toHaveAttribute("aria-selected", "true");
    await expect($(".toast")).not.toBeDisplayed();
    await expect($(".orca-plus")).toBeEnabled();
  });

  it("follows what another AI CLI started as a Claude row when the list holds it as one", async () => {
    await openOrca(orcaOverview(sample(), worktrees()), { orca_agents_installed: [antigravity] });
    const launch = await mock("orca_agent_launch", reply);
    await mock("orca_overview", orcaOverview(sample(), worktrees()));
    await plus("example-api", ANTIGRAVITY);
    await waitForCalls(launch);
    await expect($(".toast")).toHaveText("セッションを始めました。一覧に現れるのを待っています…");
    await mock("orca_overview", orcaOverview([...sample(), startedRow()], worktrees()));
    await showAgain();
    await expect($('.orca-tabs [data-tab="claude:tab_new:leaf_1"] [role="tab"]')).toHaveAttribute("aria-selected", "true");
    await expect($(".toast")).not.toBeDisplayed();
  });

  it("follows what another AI CLI started as a row of that AI, whose tab is a terminal tab of its handle", async () => {
    await openOrca(orcaOverview(sample(), worktrees()), { orca_agents_installed: [antigravity] });
    const launch = await mock("orca_agent_launch", reply);
    await mock("orca_overview", orcaOverview(sample(), worktrees()));
    await plus("example-api", ANTIGRAVITY);
    await waitForCalls(launch);
    await mock("orca_terminal_read", ["$ antigravity"]);
    await mock("orca_overview", orcaOverview([...sample(), { ...startedRow(), agent: "antigravity" }], worktrees()));
    await showAgain();
    await expect($('.orca-tabs [data-tab="orca:term_new"] [role="tab"]')).toHaveAttribute("aria-selected", "true");
    expect(await count('.orca-tabs [data-tab="claude:tab_new:leaf_1"]')).toBe(0);
    await expect($(".toast")).not.toBeDisplayed();
  });

  it("shows a row of another AI than Claude, or of no known AI, as a terminal tab and not as a Claude session", async () => {
    const rows = [orcaRow("example-app", "feat/a", "Write the docs", { agent: "codex" }), orcaRow("example-app", "feat/a", "Ask the cat", { agent: null, handle: "term_none", paneKey: "tab_none:leaf_1" })];
    await openOrca(orcaOverview(rows, worktrees()));
    await mock("orca_terminal_read", ["$ codex"]);
    await project("example-app").click();
    expect(await tabTitles()).toEqual(["Write the docs", "Ask the cat"]);
    await expect(tabOf("orca:term_example-app")).toBeDisplayed();
    await expect(tabOf("orca:term_none")).toBeDisplayed();
    expect(await count('.orca-tabs [data-tab^="claude:"]')).toBe(0);
  });

  it("shows the message on a card when starting another AI CLI fails, and can be pressed again", async () => {
    await openOrca(orcaOverview(sample(), worktrees()), { orca_agents_installed: [antigravity] });
    const launch = await mock("orca_agent_launch", rejects("Unknown TUI agent: antigravity"));
    await plus("example-app", ANTIGRAVITY);
    await waitForCalls(launch);
    await expect($(CARD)).toHaveText("Unknown TUI agent: antigravity");
    await expect($(".toast")).not.toBeDisplayed();
    await expect($(".orca-plus")).toBeEnabled();
    await expect($('#orca-feed .orca-project[data-key="proj_example-app"]')).toHaveAttribute("aria-pressed", "true");
    await mock("orca_agent_launch", noPane);
    await pressPlus();
    await pickItem(ANTIGRAVITY);
    expect(await waitForCalls(launch)).toEqual([{ path: "/work/example-app", agent: "antigravity", environment: null }]);
  });

  it("says in one line that the AI CLIs could not be read, with the reason on a card, and keeps the two icons and no row of an AI CLI", async () => {
    await openOrca(orcaOverview(sample(), worktrees()), { orca_agents_installed: rejects("orca agent installed: 読めません") });
    await expect($(CARD)).toHaveText("orca agent installed: 読めません");
    await pickProject("example-api");
    await pressPlus();
    expect(await menuItems()).toEqual([TERMINAL, SCRATCHPAD]);
    await expect($(".menu .menu-empty")).toHaveText("AI CLI を読み込めませんでした");
    expect(await count('.menu[role="menu"] > .menu-icons + [role="separator"] + .menu-empty')).toBe(1);
    // The icons work as always.
    const create = await mock("orca_terminal_create", noPane);
    await pickItem(TERMINAL);
    expect(await waitForCalls(create)).toEqual([{ path: "/work/example-api", environment: null }]);
  });

  it("reads the AI CLIs of this machine and of the saved environment that is the target, each once, and gives a project the list of its own place", async () => {
    // example-api is a project of Studio; example-app is on this machine.
    await openOrca(onThisMachine(orcaOverview(sample(), worktrees(), studio), "example-app"));
    const read = await mock("orca_agents_installed", holds);
    await aMinutePasses();
    await showAgain();
    // This machine's first, then the target's; the clock asks for no more.
    expect(await waitForCalls(read, 2)).toEqual([{ environment: null }, { environment: "Studio" }]);
    await release(read, [claudeAgent, antigravity]);
    await release(read, [claudeAgent, codex]);
    await pickProject("example-api");
    await pressPlus();
    expect(await menuItems()).toEqual([TERMINAL, SCRATCHPAD, CLAUDE, CODEX]);
    await browser.keys("Escape");
    await pickProject("example-app");
    await pressPlus();
    expect(await menuItems()).toEqual([TERMINAL, SCRATCHPAD, CLAUDE, ANTIGRAVITY]);
  });

  it("opens the menu of a place whose AI CLIs were never read only when the read ends", async () => {
    await openOrca(orcaOverview(sample(), worktrees()), { orca_agents_installed: holds });
    await waitForCalls("orca_agents_installed");
    await pickProject("example-api");
    await browser.execute((id) => window.__e2e_once__(id) && document.querySelector<HTMLElement>(".orca-plus")!.click(), onceId());
    await browser.pause(500);
    await expect($(".menu")).not.toExist();
    await release("orca_agents_installed", [antigravity]);
    await expect($('.menu[role="menu"]')).toBeDisplayed();
    expect(await menuItems()).toEqual([TERMINAL, SCRATCHPAD, ANTIGRAVITY]);
    // One read served the wait: the press did not ask again.
    expect(await callsOf("orca_agents_installed")).toHaveLength(1);
  });

  it("does not open the menu that waited when another project was selected meanwhile", async () => {
    await openOrca(orcaOverview(sample(), worktrees()), { orca_agents_installed: holds });
    await waitForCalls("orca_agents_installed");
    await pickProject("example-api");
    await browser.execute((id) => window.__e2e_once__(id) && document.querySelector<HTMLElement>(".orca-plus")!.click(), onceId());
    await pickProject("example-app");
    await release("orca_agents_installed", [antigravity]);
    await browser.pause(500);
    await expect($(".menu")).not.toExist();
  });

  it("reads the AI CLIs when the screen is shown, and neither by the clock nor while another screen is shown, nor again within a minute", async () => {
    await openOrca(orcaOverview(sample(), worktrees()), timers({ orcaClock: 1000 }));
    await waitForCalls("orca_agents_installed");
    // The clock reads the list a few times: no read of the AI CLIs comes with it.
    await browser.pause(2500);
    expect(await callsOf("orca_agents_installed")).toEqual([{ environment: null }]);
    await $("#nav-mail").click();
    await browser.pause(2500);
    expect(await callsOf("orca_agents_installed")).toHaveLength(1);
    // Shown again within the minute: the list that was read is trusted.
    await $("#nav-orca").click();
    await expect($("#orca")).toBeDisplayed();
    await browser.pause(500);
    expect(await callsOf("orca_agents_installed")).toHaveLength(1);
    // A minute later it is read again.
    await $("#nav-mail").click();
    await aMinutePasses();
    await $("#nav-orca").click();
    await expect($("#orca")).toBeDisplayed();
    expect(await waitForCalls("orca_agents_installed", 2)).toEqual([{ environment: null }, { environment: null }]);
  });

  it("reads again at once when the screen is shown after a list that could not be read", async () => {
    await openOrca(orcaOverview(sample(), worktrees()), { orca_agents_installed: rejects("orca agent installed: 読めません") });
    await waitForCalls("orca_agents_installed");
    await mock("orca_agents_installed", [antigravity]);
    await showAgain();
    await waitForCalls("orca_agents_installed");
    await pickProject("example-api");
    await pressPlus();
    expect(await menuItems()).toEqual([TERMINAL, SCRATCHPAD, ANTIGRAVITY]);
  });

  it("drops a read of the AI CLIs that ends after the screen was left, and reads again when the screen is shown", async () => {
    await openOrca(orcaOverview(sample(), worktrees()), { orca_agents_installed: holds });
    await waitForCalls("orca_agents_installed");
    await $("#nav-mail").click();
    await release("orca_agents_installed", rejects("読み込めません"));
    await browser.pause(300);
    // Nothing is shown for it: no card.
    expect(await count("#error-cards .error-card")).toBe(0);
    await $("#nav-orca").click();
    await expect($("#orca")).toBeDisplayed();
    await waitForCalls("orca_agents_installed", 2);
    await release("orca_agents_installed", [antigravity]);
    await pickProject("example-api");
    await pressPlus();
    expect(await menuItems()).toEqual([TERMINAL, SCRATCHPAD, ANTIGRAVITY]);
  });

  it("starts Claude at once in the one worktree of the selected project, with no prompt and the target the screen shows", async () => {
    await openOrca();
    const start = await mock("orca_start", noPane);
    const create = await mock("orca_terminal_create", noPane);
    await plus("example-api", CLAUDE);
    // One worktree: no dialog.
    expect(await waitForCalls(start)).toEqual([{ path: "/work/example-api", environment: null }]);
    await expect($(".orca-dest-pop")).not.toExist();
    expect(await callsOf(create)).toHaveLength(0);
    // Orca named neither its pane nor its terminal: nothing can be followed, and the plus starts another.
    await expect($(".toast")).toHaveText("セッションを始めました。Orca の画面で開けます。");
    await expect($(".orca-plus")).toBeEnabled();
    await expect($(".toast .spin")).not.toExist();
    await plus("example-app", CLAUDE);
    expect(await waitForCalls(start, 2)).toEqual([
      { path: "/work/example-api", environment: null },
      { path: "/work/example-app", environment: null },
    ]);
  });

  it("opens a terminal at once in the one worktree of the selected project, with the target the screen shows", async () => {
    await openOrca(orcaOverview(sample(), worktrees(), studio));
    const start = await mock("orca_start", noPane);
    const create = await mock("orca_terminal_create", noPane);
    await plus("example-api", TERMINAL);
    expect(await waitForCalls(create)).toEqual([{ path: "/work/example-api", environment: "Studio" }]);
    await expect($(".orca-dest-pop")).not.toExist();
    expect(await callsOf(start)).toHaveLength(0);
    await expect($(".toast")).toHaveText("セッションを始めました。Orca の画面で開けます。");
  });

  it("asks which worktree when the project has several, narrowed to that project's, and starts in the one picked", async () => {
    await openOrca(orcaOverview(sample(), twoWorktrees()));
    const start = await mock("orca_start", noPane);
    const create = await mock("orca_terminal_create", noPane);
    await plus("example-app", CLAUDE);
    const pop = $(".orca-dest-pop");
    await expect(pop).toBeDisplayed();
    // Only the worktrees of the selected project, not example-api's.
    expect(await textsOf(".orca-dest-pop button b")).toEqual(["example-app", "example-app"]);
    expect(await textsOf(".orca-dest-pop button span")).toEqual(["feat/a", "feat/b"]);
    expect(await callsOf(start)).toHaveLength(0);
    await $('.orca-dest-pop button[data-path="/work/example-app-b"]').click();
    await expect(pop).not.toExist();
    expect(await waitForCalls(start)).toEqual([{ path: "/work/example-app-b", environment: null }]);
    expect(await callsOf(create)).toHaveLength(0);
    // The same dialog serves the terminal.
    await plusIn("example-app", TERMINAL, "/work/example-app");
    expect(await waitForCalls(create)).toEqual([{ path: "/work/example-app", environment: null }]);
  });

  it("narrows the worktrees of the plus with a filter, in two-line rows", async () => {
    await openOrca(orcaOverview(sample(), twoWorktrees()));
    await plus("example-app", CLAUDE);
    const pop = $(".orca-dest-pop");
    await expect(pop).toHaveAttribute("role", "dialog");
    const filter = $('.orca-dest-pop input[aria-label="worktree を絞り込む"]');
    await expect(filter).toBeFocused();
    // A row has the repository on its first line and the branch on its second.
    expect(await textsOf(".orca-dest-pop button b")).toEqual(["example-app", "example-app"]);
    expect(await textsOf(".orca-dest-pop button span")).toEqual(["feat/a", "feat/b"]);
    // Case-insensitive, on `{repo} ・ {branch}`.
    await filter.setValue("B");
    expect(await textsOf(".orca-dest-pop button span")).toEqual(["feat/b"]);
    await filter.setValue("app ・ FEAT/A");
    expect(await textsOf(".orca-dest-pop button span")).toEqual(["feat/a"]);
    await filter.setValue("zzz");
    await expect(pop).toHaveText(expect.stringContaining("該当する worktree がありません"));
    expect(await textsOf(".orca-dest-pop button")).toEqual([]);
  });

  it("shows the message when a launch or a new terminal fails, keeps the selection, and can be pressed again", async () => {
    await openOrca();
    const start = await mock("orca_start", rejects("Worktree not found"));
    await plus("example-app", CLAUDE);
    await waitForCalls(start);
    await expect($(CARD)).toHaveText("Worktree not found");
    await expect($(".toast")).not.toBeDisplayed();
    await expect($(".orca-plus")).toBeEnabled();
    await expect($('#orca-feed .orca-project[data-key="proj_example-app"]')).toHaveAttribute("aria-pressed", "true");
    const create = await mock("orca_terminal_create", rejects("起動先の worktree が見つかりません。一覧を読み直してください"));
    await pressPlus();
    await pickItem(TERMINAL);
    await waitForCalls(create);
    // A text that differs makes a second card, put above the first.
    await expect($$(CARD)[0]).toHaveText("起動先の worktree が見つかりません。一覧を読み直してください");
    expect(await textsOf(CARD)).toEqual(["起動先の worktree が見つかりません。一覧を読み直してください", "Worktree not found"]);
    await expect($(".toast")).not.toBeDisplayed();
    await expect($(".orca-plus")).toBeEnabled();
  });

  it("disables the plus while a launch or a new terminal is on its way", async () => {
    await openOrca();
    const start = await mock("orca_start", holds);
    await plus("example-app", CLAUDE);
    await waitForCalls(start);
    await expect($(".orca-plus")).toBeDisabled();
    await release(start, noPane);
    await expect($(".orca-plus")).toBeEnabled();
    expect(await callsOf(start)).toHaveLength(1);
    const create = await mock("orca_terminal_create", holds);
    await pressPlus();
    await pickItem(TERMINAL);
    await waitForCalls(create);
    await expect($(".orca-plus")).toBeDisabled();
    await release(create, noPane);
    await expect($(".orca-plus")).toBeEnabled();
    expect(await callsOf(create)).toHaveLength(1);
  });

  it("follows the session it started: keeps the selection, waits for its row, starts no second one meanwhile, then selects its tab and shows its terminal", async () => {
    await openOrca();
    const start = await mock("orca_start", reply);
    // The read after the launch does not hold the session yet.
    await mock("orca_overview", orcaOverview(sample(), worktrees()));
    await plus("example-api", CLAUDE);
    await waitForCalls(start);
    await expect($(".toast")).toHaveText("セッションを始めました。一覧に現れるのを待っています…");
    await expect($(".toast .spin")).toBeDisplayed();
    await expect($(".orca-plus")).toBeDisabled();
    // The note is at the bottom right and no timer hides it: it is still there after the 4 seconds of a toast.
    await browser.pause(4500);
    await expect($(".toast")).toBeDisplayed();
    // The project stays selected while the session is waited for.
    await expect($('#orca-feed .orca-project[data-key="proj_example-api"]')).toHaveAttribute("aria-pressed", "true");
    // The row appears in a later read: its project and tab are selected, and its terminal shows.
    const read = await mock("orca_terminal_read", ["$"]);
    await mock("orca_overview", orcaOverview([...sample(), startedRow()], worktrees()));
    await showAgain();
    expect((await waitForCalls(read))[0]).toEqual({ handle: "term_new" });
    await expect($(".toast")).not.toBeDisplayed();
    await expect($('#orca-feed .orca-project[data-key="proj_example-api"]')).toHaveAttribute("aria-pressed", "true");
    await expect($('.orca-tabs [data-tab="claude:tab_new:leaf_1"] [role="tab"]')).toHaveAttribute("aria-selected", "true");
    await expect($(".orca-plus")).toBeEnabled();
    expect(await callsOf(start)).toHaveLength(1);
  });

  it("finds the row of the session it started by the handle when the launch gave no pane key", async () => {
    await openOrca();
    const start = await mock("orca_start", { paneKey: null, handle: "term_new" } satisfies OrcaStarted);
    await mock("orca_overview", orcaOverview(sample(), worktrees()));
    await plus("example-api", CLAUDE);
    await waitForCalls(start);
    await expect($(".toast")).toHaveText("セッションを始めました。一覧に現れるのを待っています…");
    await mock("orca_overview", orcaOverview([...sample(), startedRow()], worktrees()));
    await showAgain();
    await expect($('.orca-tabs [data-tab="claude:tab_new:leaf_1"] [role="tab"]')).toHaveAttribute("aria-selected", "true");
    await expect($(".toast")).not.toBeDisplayed();
  });

  it("follows the terminal it opened: waits for its tab, then selects it and mirrors it", async () => {
    await openOrca();
    const create = await mock("orca_terminal_create", created);
    await mock("orca_overview", orcaOverview(sample(), worktrees()));
    await plus("example-api", TERMINAL);
    expect(await waitForCalls(create)).toEqual([{ path: "/work/example-api", environment: null }]);
    await expect($(".toast")).toHaveText("セッションを始めました。一覧に現れるのを待っています…");
    await expect($(".orca-plus")).toBeDisabled();
    // The terminal appears in a later read: it is a plain terminal, so its tab is selected and its screen shows.
    const read = await mock("orca_terminal_read", ["$ pwd"]);
    await mock("orca_overview", orcaOverview(sample(), worktrees(), { terminals: [createdTerminal()] }));
    await showAgain();
    expect((await waitForCalls(read))[0]).toEqual({ handle: "term_new_sh" });
    await expect($(".toast")).not.toBeDisplayed();
    await expect($('#orca-feed .orca-project[data-key="proj_example-api"]')).toHaveAttribute("aria-pressed", "true");
    await expect($('.orca-tabs [data-tab="orca:term_new_sh"] [role="tab"]')).toHaveAttribute("aria-selected", "true");
    await expect($(".orca-plus")).toBeEnabled();
    expect(await callsOf(create)).toHaveLength(1);
  });

  it("selects the terminal it opened in a saved environment from the streamed list", async () => {
    await openOrca(orcaOverview(sample(), worktrees(), studio));
    await waitForCalls("orca_stream_open");
    await sendStream(streamList(sample(), worktrees()));
    const create = await mock("orca_terminal_create", created);
    await plus("example-api", TERMINAL);
    expect(await waitForCalls(create)).toEqual([{ path: "/work/example-api", environment: "Studio" }]);
    await expect($(".toast")).toHaveText("セッションを始めました。一覧に現れるのを待っています…");
    await sendStream(streamList(sample(), worktrees(), [createdTerminal()]));
    await expect($('.orca-tabs [data-tab="orca:term_new_sh"] [role="tab"]')).toHaveAttribute("aria-selected", "true");
    await expect($(".toast")).not.toBeDisplayed();
  });

  it("selects the terminal of a saved environment that the streamed list held before the reply came", async () => {
    await openOrca(orcaOverview(sample(), worktrees(), studio));
    await waitForCalls("orca_stream_open");
    await sendStream(streamList(sample(), worktrees()));
    const create = await mock("orca_terminal_create", holds);
    await plus("example-api", TERMINAL);
    await waitForCalls(create);
    // The list with the new terminal comes first, and no event comes after the reply.
    await sendStream(streamList(sample(), worktrees(), [createdTerminal()]));
    await release(create, created);
    await expect($('.orca-tabs [data-tab="orca:term_new_sh"] [role="tab"]')).toHaveAttribute("aria-selected", "true");
    await expect($(".toast")).not.toBeDisplayed();
    await expect($(".orca-plus")).toBeEnabled();
  });

  it("drops the wait for a terminal of a saved environment after 30 seconds, with no streamed list", async () => {
    await openOrca(orcaOverview(sample(), worktrees(), studio));
    await waitForCalls("orca_stream_open");
    await sendStream(streamList(sample(), worktrees()));
    const create = await mock("orca_terminal_create", created);
    await plus("example-api", TERMINAL);
    await waitForCalls(create);
    await expect($(".toast")).toBeDisplayed();
    await expect($(".orca-plus")).toBeDisabled();
    const later = new Date(Date.now() + 31_000);
    await setClock(`${isoDate(later)}T${later.toTimeString().slice(0, 8)}`);
    await expect($(".toast")).not.toBeDisplayed();
    await expect($(".orca-plus")).toBeEnabled();
  });

  it("keeps the note of the wait on another screen, and hides it when the wait ends there", async () => {
    await openOrca(orcaOverview(sample(), worktrees(), studio));
    await waitForCalls("orca_stream_open");
    await sendStream(streamList(sample(), worktrees()));
    const create = await mock("orca_terminal_create", created);
    await plus("example-api", TERMINAL);
    await waitForCalls(create);
    await $("#nav-mail").click();
    await expect($("#orca")).not.toBeDisplayed();
    await expect($(".toast")).toHaveText("セッションを始めました。一覧に現れるのを待っています…");
    const later = new Date(Date.now() + 31_000);
    await setClock(`${isoDate(later)}T${later.toTimeString().slice(0, 8)}`);
    await expect($(".toast")).not.toBeDisplayed();
  });

  it("drops the wait when the user selects another project", async () => {
    await openOrca();
    const start = await mock("orca_start", reply);
    await mock("orca_overview", orcaOverview(sample(), worktrees()));
    await plus("example-api", CLAUDE);
    await waitForCalls(start);
    await expect($(".toast")).toBeDisplayed();
    // Choosing a project drops the wait, and a row that appears later does not take the selection.
    await $('#orca-feed .orca-project[data-key="proj_example-app"]').click();
    await expect($(".toast")).not.toBeDisplayed();
    await expect($(".orca-plus")).toBeEnabled();
    await mock("orca_overview", orcaOverview([...sample(), startedRow()], worktrees()));
    await showAgain();
    await waitForCalls("orca_overview");
    await expect($('#orca-feed .orca-project[data-key="proj_example-app"]')).toHaveAttribute("aria-pressed", "true");
    await expect(selectedTab()).toHaveText(expect.stringContaining("Write the docs"));
  });

  it("does not follow a start when the user selected another project while it was on its way", async () => {
    await openOrca();
    const create = await mock("orca_terminal_create", holds);
    await plus("example-api", TERMINAL);
    await waitForCalls(create);
    await $('#orca-feed .orca-project[data-key="proj_example-app"]').click();
    await release(create, created);
    await expect($(".orca-plus")).toBeEnabled();
    await expect($(".toast")).not.toBeDisplayed();
    await mock("orca_overview", orcaOverview(sample(), worktrees(), { terminals: [createdTerminal()] }));
    await showAgain();
    await waitForCalls("orca_overview");
    await expect($('#orca-feed .orca-project[data-key="proj_example-app"]')).toHaveAttribute("aria-pressed", "true");
  });

  it("says the command is missing, and does not read again by the clock", async () => {
    // The base answer is the one with no orca command.
    await boot({ inbox: inbox(), ...timers({ orcaClock: 1000 }) });
    await $("#nav-orca").click();
    await expect($("#orca-notice")).toHaveText(expect.stringContaining("orca コマンドが見つかりません"));
    await expect($(".orca-plus")).toBeDisabled();
    // The start and showing the screen read; the clock (every 10 seconds on this screen, 1 second here) reads no more.
    const before = (await callsOf("orca_overview")).length;
    await browser.pause(1200);
    expect(await callsOf("orca_overview")).toHaveLength(before);
    // Showing the screen again looks again.
    await showAgain();
    await waitForCalls("orca_overview", before + 1);
  });

  it("shows a failed read as a notice with the message, and keeps the rows it had", async () => {
    await openOrca();
    expect(await count("#orca-feed .orca-project")).toBe(4);
    await mock("orca_overview", orcaOverview([], [], { state: "failed", message: "Orca is not running", environments: [] }));
    await showAgain();
    await expect($("#orca-notice")).toHaveText("読み込めませんでした: Orca is not running");
    expect(await count("#orca-feed .orca-project")).toBe(4);
  });

  it("draws the terminal with the WebGL renderer without an error, and goes back to the DOM renderer when the context is lost", async () => {
    await openOrca();
    // The E2E build keeps the DOM renderer for the other specs; this one turns WebGL on before the terminal is made.
    await browser.execute(() => {
      const w = window as unknown as { __e2e_webgl__: boolean; __webgl_errors__: string[] };
      w.__e2e_webgl__ = true;
      w.__webgl_errors__ = [];
      window.addEventListener("error", (e) => w.__webgl_errors__.push(e.message));
    });
    const errors = () => browser.execute(() => (window as unknown as { __webgl_errors__: string[] }).__webgl_errors__);
    await mock("orca_terminal_read", ["$ first frame"]);
    await select("example-app");
    const box = ".orca-term .orca-term-box:not([hidden])";
    await expect($(`${box} .xterm-screen canvas:not(.xterm-link-layer)`)).toExist();
    expect(await count(`${box} .xterm-rows`)).toBe(0);
    expect(await errors()).toEqual([]);
    // The GPU takes the context away: xterm.js draws with the DOM renderer again, and the screen is still there.
    await browser.execute((selector) => {
      document.querySelector<HTMLCanvasElement>(selector)!.getContext("webgl2")!.getExtension("WEBGL_lose_context")!.loseContext();
    }, `${box} .xterm-screen canvas:not(.xterm-link-layer)`);
    await browser.waitUntil(async () => (await count(`${box} .xterm-rows`)) === 1, { timeout: 10000, timeoutMsg: "the DOM renderer never came back" });
    await browser.waitUntil(async () => (await screenText()).includes("first frame"), { timeoutMsg: "the screen was lost with the context" });
    expect(await errors()).toEqual([]);
  });

  it("keeps the selection through a read in the background, and does not start the terminal again", async () => {
    await openOrca();
    await mock("orca_terminal_read", ["$ first frame"]);
    await select("example-app");
    await browser.waitUntil(async () => (await screenText()).includes("first frame"), { timeoutMsg: "the first frame never showed" });
    await browser.execute(() => document.querySelector(".orca-term .orca-term-box:not([hidden])")!.setAttribute("data-mark", "same"));
    // The clock reads again within 10 seconds (the first read of this screen was at its opening).
    const overview = await mock("orca_overview", orcaOverview([...sample(), orcaRow("example-new", "main", "Fresh", { minutes: 1 })], worktrees()));
    await waitForCalls(overview);
    await waitForCount("#orca-feed .orca-project", 5);
    expect(await pressed("example-app")).toBe("true");
    await expect($("#orca")).toBeDisplayed();
    await expect(selectedTab()).toHaveText(expect.stringContaining("Write the docs"));
    await expect($('.orca-term .orca-term-box[data-mark="same"]')).toBeDisplayed();
  });

  it("drops the tab of a session that is gone, with its terminal", async () => {
    await openOrca();
    await select("example-app");
    await expect($(".orca-term")).toBeDisplayed();
    await mock("orca_overview", orcaOverview([orcaRow("example-api", "main", "Fix the parser")], worktrees()));
    await showAgain();
    await browser.waitUntil(async () => (await count('#orca-feed .orca-worktree[data-worktree="/work/example-app"] .orca-worktree-agent')) === 0, { timeoutMsg: "the worktree of the gone session kept its AI icon" });
    // The project is still selected, with no session left in it.
    await expect($(".orca-empty")).toHaveText("セッションはありません");
    expect(await count(".orca-tabs .orca-tab")).toBe(0);
    await expect($(".orca-term")).not.toBeDisplayed();
    expect(await count(".orca-term .orca-term-box")).toBe(0);
  });

  it("reads everything when the screen is shown, and the clock only the agents of this machine", async () => {
    await openOrca();
    const scopes = async () => (await callsOf("orca_overview")).map((c) => (c as { scope: string }).scope);
    // The first read and showing the screen.
    expect(await scopes()).toEqual(["full", "full"]);
    // The clock, within 10 seconds on this screen.
    const overview = await mock("orca_overview", orcaOverview(sample(), worktrees()));
    expect(await waitForCalls(overview)).toEqual([{ scope: "screen", target: null }]);
    await showAgain();
    expect(await waitForCalls(overview, 2)).toEqual([
      { scope: "screen", target: null },
      { scope: "full", target: null },
    ]);
  });

  it("keeps the rows and says the failure when the environments cannot be read", async () => {
    await openOrca(orcaOverview(sample(), worktrees(), studio));
    await mock("orca_overview", orcaOverview([], [], { state: "failed", message: "Orca is busy", known: false }));
    await showAgain();
    await expect($("#orca-notice")).toHaveText("Studio を読み込めませんでした: Orca is busy");
    expect(await count("#orca-feed .orca-project")).toBe(4);
  });

  it("does not pick another target for a saved one that is gone", async () => {
    await openOrca(orcaOverview([], [], { state: "failed", message: "保存した接続先が見つかりません", target: "Gone", environments: ["Studio"] }));
    await expect($("#orca-notice")).toHaveText("Gone を読み込めませんでした: 保存した接続先が見つかりません");
    // A target that is not listed is not streamed.
    expect(await callsOf("orca_stream_open")).toEqual([]);
  });
});

// A-23: the list of projects is closed and opened by a button. Where the button is, what hides with the list, and the width the work pane takes.
describe("orca: closing the list (A-23)", () => {
  const rect = (selector: string) => browser.execute((q) => {
    const r = document.querySelector(q)!.getBoundingClientRect();
    return { left: r.left, right: r.right, width: r.width };
  }, selector);

  it("has the button first in the header of the list, open", async () => {
    await openOrca();
    const button = $("#orca-list-toggle");
    await expect(button).toBeDisplayed();
    await expect(button).toHaveAttribute("aria-label", "プロジェクト一覧");
    await expect(button).toHaveAttribute("aria-expanded", "true");
    expect(await classOf("#orca-list-toggle")).toContain("icon-btn");
    const [toggle, header] = await Promise.all(["#orca-list-toggle", "#orca-header"].map(rect));
    // At the left end of the header.
    expect(toggle.left - header.left).toBeLessThan(10);
    // The button of the tab strip is for the closed list only.
    await expect($(".orca-tabbar .list-toggle")).not.toBeDisplayed();
  });

  it("closes the list with its divider, widens the work pane, and opens the list again at the width it had", async () => {
    await openOrca();
    await dragDivider(0.4);
    const before = await rect("#orca-list");
    expect(before.width / (await rect("#orca")).width).toBeCloseTo(0.4, 2);
    const openLeft = (await rect("#orca-list-toggle")).left;
    await $("#orca-list-toggle").click();
    await expect($("#orca-list")).not.toBeDisplayed();
    await expect($("#orca-split")).not.toBeDisplayed();
    // The work pane takes the width up to the green column.
    const [screen, work] = await Promise.all(["#orca", "#orca-work"].map(rect));
    expect(work.left).toBeCloseTo(screen.left, 0);
    // The button is now at the left end of the tab strip of the pane at the left edge.
    const closed = $(".orca-tabbar .list-toggle");
    await expect(closed).toBeDisplayed();
    await expect(closed).toHaveAttribute("aria-expanded", "false");
    await expect(closed).toHaveAttribute("aria-label", "プロジェクト一覧");
    const [button, tabs, bar] = await Promise.all([".orca-tabbar .list-toggle", ".orca-tabs", ".orca-tabbar"].map(rect));
    expect(button.left).toBeGreaterThanOrEqual(bar.left);
    expect(button.right).toBeLessThanOrEqual(tabs.left + 1);
    // The button is at the same x as it was in the header of the open list (both start just right of the green column).
    expect(Math.abs(button.left - openLeft)).toBeLessThanOrEqual(1);
    expect(await browser.execute(() => document.querySelector(".orca-tabbar")!.firstElementChild!.classList.contains("list-toggle"))).toBe(true);
    await expect(closed).not.toHaveAttribute("data-tauri-drag-region");
    // The green column stays.
    await expect($("#sidebar")).toBeDisplayed();
    await closed.click();
    await expect($("#orca-list")).toBeDisplayed();
    await expect($("#orca-split")).toBeDisplayed();
    await expect($("#orca-list-toggle")).toHaveAttribute("aria-expanded", "true");
    await expect($(".orca-tabbar .list-toggle")).not.toBeDisplayed();
    expect((await rect("#orca-list")).width).toBeCloseTo(before.width, 0);
    await expect($("#orca-split")).toHaveAttribute("aria-valuenow", "40");
  });

  it("keeps the list closed while the screen is left and shown again, and opens it again when the app starts", async () => {
    await openOrca();
    await $("#orca-list-toggle").click();
    await expect($("#orca-list")).not.toBeDisplayed();
    await $("#nav-mail").click();
    await $("#nav-orca").click();
    await expect($("#orca")).toBeDisplayed();
    await expect($("#orca-list")).not.toBeDisplayed();
    // Nothing is saved: a start gives the open list.
    await openOrca();
    await expect($("#orca-list")).toBeDisplayed();
    await expect($("#orca-list-toggle")).toHaveAttribute("aria-expanded", "true");
  });

  it("gives the focus to the button that is shown after a press", async () => {
    await openOrca();
    await $("#orca-list-toggle").click();
    await browser.execute(() => document.querySelector<HTMLElement>(".orca-tabbar .list-toggle")!.focus());
    // The harness's synthesized Enter does not run the default action of a button (the keydown and keyup come, the keypress does not), so the focused button is clicked, as the keyboard would.
    await browser.execute(() => (document.activeElement as HTMLElement).click());
    await expect($("#orca-list")).toBeDisplayed();
    expect(await browser.execute(() => document.activeElement?.id)).toBe("orca-list-toggle");
    await browser.execute(() => (document.activeElement as HTMLElement).click());
    await expect($("#orca-list")).not.toBeDisplayed();
    expect(await browser.execute(() => document.activeElement?.classList.contains("list-toggle"))).toBe(true);
    // The focus is on the button that is shown, not on the one the press hid.
    expect(await browser.execute(() => (document.activeElement as HTMLElement).offsetParent !== null)).toBe(true);
  });
});

describe("orca: the divider", () => {
  // The list pane's share of #orca.
  const share = () => browser.execute(() => document.getElementById("orca-list")!.getBoundingClientRect().width / document.getElementById("orca")!.getBoundingClientRect().width);
  const drag = dragDivider;
  const press = (key: string) =>
    browser.execute(
      (id, k) => window.__e2e_once__(id) && document.getElementById("orca-split")!.dispatchEvent(new KeyboardEvent("keydown", { key: k, bubbles: true, cancelable: true })),
      onceId(),
      key,
    );

  it("is a vertical separator that starts at 19%", async () => {
    await openOrca();
    const split = $("#orca-split");
    await expect(split).toHaveAttribute("role", "separator");
    await expect(split).toHaveAttribute("aria-orientation", "vertical");
    await expect(split).toHaveAttribute("tabindex", "0");
    await expect(split).toHaveAttribute("aria-valuemin", "15");
    await expect(split).toHaveAttribute("aria-valuemax", "50");
    await expect(split).toHaveAttribute("aria-valuenow", "19");
    expect(await share()).toBeCloseTo(0.19, 2);
  });

  it("sets the list width by dragging, and keeps it between 15% and 50% however far it is dragged", async () => {
    await openOrca();
    await drag(0.4);
    expect(await share()).toBeCloseTo(0.4, 2);
    await expect($("#orca-split")).toHaveAttribute("aria-valuenow", "40");
    await drag(0.95);
    expect(await share()).toBeCloseTo(0.5, 2);
    await expect($("#orca-split")).toHaveAttribute("aria-valuenow", "50");
    await drag(0.01);
    expect(await share()).toBeCloseTo(0.15, 2);
    await expect($("#orca-split")).toHaveAttribute("aria-valuenow", "15");
  });

  it("is moved with the arrow keys inside the same range, and keeps its width when the screen is left and opened again", async () => {
    await openOrca();
    await press("ArrowRight");
    await press("ArrowRight");
    expect(await share()).toBeCloseTo(0.23, 2);
    for (let i = 0; i < 20; i++) await press("ArrowRight");
    expect(await share()).toBeCloseTo(0.5, 2);
    for (let i = 0; i < 30; i++) await press("ArrowLeft");
    expect(await share()).toBeCloseTo(0.15, 2);
    await press("ArrowRight");
    const widened = await share();
    await $("#nav-mail").click();
    await $("#nav-orca").click();
    await expect($("#orca")).toBeDisplayed();
    expect(await share()).toBeCloseTo(widened, 2);
  });
});

describe("orca: projects", () => {
  const withTerminals = () =>
    orcaOverview(sample(), [...worktrees(), orcaWorktree("example-idle", "main")], {
      terminals: [orcaTerminal("example-app", "zsh")],
    });
  const projectNames = () => textsOf("#orca-list .orca-project-name");
  const projectStatuses = () => browser.execute(() => [...document.querySelectorAll<HTMLElement>("#orca-list .orca-project .orca-ic")].map((i) => i.dataset.status));

  it("starts with the projects: the name only, no status icon and no number of sessions", async () => {
    await openOrca(withTerminals());
    // The working projects come first (example-app, example-web), then the rest as the read lists them; example-idle (nothing) is under the link.
    expect(await projectNames()).toEqual(["example-app", "example-web", "example-api", "example-lib"]);
    // The status is on the rows of the worktrees, not on the project's row (A-8).
    expect(await projectStatuses()).toEqual([]);
    // The number of sessions is not drawn on the row.
    expect(await count("#orca-feed .orca-n")).toBe(0);
    expect(await textsOf("#orca-feed .orca-project")).toEqual(["example-app", "example-web", "example-api", "example-lib"]);
  });

  it("puts the stopped projects (a session, not working) under the working ones and above those with no session, each group in the order of the read", async () => {
    const overview = withTerminals();
    const byName = (name: string) => overview.projects.find((p) => p.name === name)!;
    // The read lists a project with no session before the stopped ones (example-api waits, example-lib is done), and the working one last.
    await openOrca({ ...overview, projects: [byName("example-idle"), byName("example-api"), byName("example-lib"), byName("example-app"), byName("example-web")] });
    // The one with no session is under the link, last.
    await stoppedLink().click();
    expect(await projectNames()).toEqual(["example-app", "example-web", "example-api", "example-lib", "example-idle"]);
  });

  // The link under the running projects (A-8): the projects whose icon is the gray dot, with no session and no terminal, are left out until it is pressed.
  const stoppedLink = () => $("#orca-list .orca-stopped-toggle");
  const listed = () => browser.execute(() => [...document.querySelectorAll("#orca-list .orca-project-name, #orca-list .orca-stopped-toggle")].map((n) => n.textContent));

  it("leaves out the projects that are not running, and draws under the running ones a link with their number", async () => {
    await openOrca(withTerminals());
    expect(await projectNames()).toEqual(["example-app", "example-web", "example-api", "example-lib"]);
    expect(await listed()).toEqual(["example-app", "example-web", "example-api", "example-lib", "起動していない 1 件"]);
    await expect(stoppedLink()).toHaveAttribute("aria-expanded", "false");
    await expect($("#orca-list .orca-project[data-key=\"proj_example-idle\"]")).not.toExist();
  });

  it("opens the projects that are not running under the link, which then hides them, and keeps it through a read", async () => {
    await openOrca(withTerminals(), timers({ orcaClock: 1000 }));
    await stoppedLink().click();
    await expect(stoppedLink()).toHaveAttribute("aria-expanded", "true");
    expect(await listed()).toEqual(["example-app", "example-web", "example-api", "example-lib", "起動していないものを隠す", "example-idle"]);
    // A read of the clock draws the list again, and it stays open.
    const overview = await mock("orca_overview", withTerminals());
    await waitForCalls(overview);
    await browser.pause(300);
    expect(await listed()).toEqual(["example-app", "example-web", "example-api", "example-lib", "起動していないものを隠す", "example-idle"]);
    await stoppedLink().click();
    expect(await listed()).toEqual(["example-app", "example-web", "example-api", "example-lib", "起動していない 1 件"]);
  });

  const boxes = () =>
    browser.execute(() => {
      const r = (id: string) => {
        const { top, bottom, height } = document.getElementById(id)!.getBoundingClientRect();
        return { top, bottom, height };
      };
      const region = document.getElementById("orca-stopped-feed")!;
      return { list: r("orca-list"), feed: r("orca-feed"), bar: r("orca-stopped-bar"), stopped: r("orca-stopped"), region: r("orca-stopped-feed"), scrolls: region.scrollHeight > region.clientHeight };
    });

  it("fixes the link at the bottom of the list, under the running projects, and opens the others under it while the running ones stay in view (A-8)", async () => {
    await openOrca(withTerminals());
    const closed = await boxes();
    expect(closed.stopped.bottom).toBeLessThanOrEqual(closed.list.bottom);
    expect(closed.stopped.bottom).toBeGreaterThan(closed.list.bottom - 12);
    expect(closed.bar.top).toBeGreaterThanOrEqual(closed.feed.bottom - 1);
    await stoppedLink().click();
    await expect($("#orca-stopped-feed")).toBeDisplayed();
    const open = await boxes();
    // The link stays at the bottom of the list, the opened projects are under it, and the running ones are still above.
    expect(open.stopped.bottom).toBeGreaterThan(open.list.bottom - 12);
    expect(open.bar.top).toBeGreaterThanOrEqual(open.feed.bottom - 1);
    expect(open.region.top).toBeGreaterThanOrEqual(open.bar.bottom - 1);
    expect(await projectNames()).toEqual(["example-app", "example-web", "example-api", "example-lib", "example-idle"]);
    await expect(project("example-app")).toBeDisplayed();
    expect(await count("#orca-feed .orca-project")).toBe(4);
    expect(await count("#orca-stopped-feed .orca-project")).toBe(1);
  });

  it("limits the opened region to half the height of the list, and scrolls it by itself", async () => {
    const idle = Array.from({ length: 40 }, (_, i) => orcaWorktree(`example-idle-${String(i).padStart(2, "0")}`, "main"));
    await openOrca(orcaOverview(sample(), [...worktrees(), ...idle]));
    await expect(stoppedLink()).toHaveText("起動していない 40 件");
    await stoppedLink().click();
    const open = await boxes();
    expect(open.stopped.height).toBeLessThanOrEqual(open.list.height / 2 + 1);
    expect(open.scrolls).toBe(true);
    expect(open.feed.height).toBeGreaterThan(0);
    // The scroll is the region's own: the running list does not move with it.
    const moved = await browser.execute(() => {
      const region = document.getElementById("orca-stopped-feed")!;
      const feed = document.getElementById("orca-feed")!;
      region.scrollTop = 120;
      return { region: region.scrollTop, feed: feed.scrollTop };
    });
    expect(moved.region).toBeGreaterThan(0);
    expect(moved.feed).toBe(0);
    await stoppedLink().click();
    await expect($("#orca-stopped-feed")).not.toBeDisplayed();
  });

  it("draws no link when every project is running, and only the link when none is", async () => {
    await openOrca(orcaOverview(sample(), worktrees()));
    await expect(stoppedLink()).not.toExist();
    await openOrca(orcaOverview([], [orcaWorktree("example-idle", "main"), orcaWorktree("example-rest", "main")]));
    expect(await listed()).toEqual(["起動していない 2 件"]);
    await expect($("#orca-feed")).not.toHaveText(expect.stringContaining("プロジェクトがありません"));
  });

  it("keeps the selected project in the list even when it is not running", async () => {
    await openOrca(withTerminals());
    await stoppedLink().click();
    await project("example-idle").click();
    await expect(project("example-idle")).toHaveAttribute("aria-pressed", "true");
    // The selected project is a row of the list and none is left out, so there is no link.
    expect(await listed()).toEqual(["example-app", "example-web", "example-api", "example-lib", "example-idle"]);
    // Another selection leaves it out again, with the link open as it was.
    await project("example-lib").click();
    expect(await listed()).toEqual(["example-app", "example-web", "example-api", "example-lib", "起動していないものを隠す", "example-idle"]);
  });

  it("puts an icon at the left of each of the headings 「フォーメーション」 and 「プロジェクト」, and a line above the row of 「プロジェクト」", async () => {
    await openOrca(withTerminals());
    expect(await count("#orca-formations .orca-list-head svg")).toBe(1);
    expect(await count("#orca-projects-head .orca-list-head svg")).toBe(1);
    const look = await browser.execute(() => {
      const projects = getComputedStyle(document.getElementById("orca-projects")!);
      const icon = document.querySelector("#orca-projects-head .orca-list-head svg")!.getBoundingClientRect();
      const head = document.querySelector("#orca-projects-head .orca-list-head")!.getBoundingClientRect();
      return { line: projects.borderTopWidth, style: projects.borderTopStyle, iconLeft: icon.left, headLeft: head.left, iconWidth: icon.width };
    });
    expect(look.line).toBe("1px");
    expect(look.style).toBe("solid");
    expect(look.iconWidth).toBeGreaterThan(0);
    expect(look.iconLeft).toBeLessThan(look.headLeft + 40);
  });

  it("does not draw the list again when only the time of activity of a project moved", async () => {
    await openOrca(withTerminals(), timers({ orcaClock: 1000 }));
    await browser.execute(() => document.querySelector("#orca-feed .orca-project")!.setAttribute("data-marker", "kept"));
    // The clock reads it (every second here).
    const overview = await mock("orca_overview", { ...withTerminals(), projects: withTerminals().projects.map((p) => ({ ...p, atMs: 99_000 })) });
    await waitForCalls(overview);
    await browser.pause(500);
    await expect($('#orca-feed .orca-project[data-marker="kept"]')).toExist();
  });

  it("says so when there is no project", async () => {
    await openOrca(orcaOverview([]));
    await expect($("#orca-feed")).toHaveText(expect.stringContaining("プロジェクトがありません"));
  });

  it("draws the icon of each status of Orca", async () => {
    const statuses = ["question", "working", "monitoring", "failed", "interrupted", "done"] as const;
    await openOrca(
      orcaOverview(
        statuses.map((status, i) => orcaRow(`example-${status}`, "main", `Task ${i}`, { status, group: status === "question" ? "waiting" : status === "done" ? "done" : "working" })),
        statuses.map((status) => orcaWorktree(`example-${status}`, "main", { status })),
      ),
    );
    // The icon is the status of the worktree under its project; the working one comes first, the rest as the read lists them.
    const icons = await browser.execute(() => [...document.querySelectorAll<HTMLElement>("#orca-feed .orca-worktree .orca-ic")].map((i) => [i.dataset.status, i.getAttribute("aria-label")]));
    expect(icons).toEqual([
      ["working", "作業中"],
      ["question", "入力待ち"],
      ["monitoring", "監視中"],
      ["failed", "失敗"],
      ["interrupted", "中断"],
      ["done", "完了"],
    ]);
    // The ring turns.
    const ring = await browser.execute(() => getComputedStyle(document.querySelector("#orca-feed .orca-mark.working")!).animationName);
    expect(ring).toBe("spin");
  });

  it("shows the sessions of a selected project as tabs of one line, selects the first, and goes back to the one last selected", async () => {
    await openOrca(withTerminals());
    const read = await mock("orca_terminal_read", ["$ ls"]);
    await project("example-app").click();
    await expect(project("example-app")).toHaveAttribute("aria-pressed", "true");
    // The Claude session first, then the shell of Orca; a tab has its title only.
    expect(await tabTitles()).toEqual(["Write the docs", "zsh"]);
    expect(await count(".orca-tabs .orca-tab-sub")).toBe(0);
    await expect(selectedTab()).toHaveText(expect.stringContaining("Write the docs"));
    expect(await browser.execute(() => [...document.querySelectorAll<HTMLElement>(".orca-tabs .orca-ic")].map((i) => [i.dataset.status, i.getAttribute("aria-label")]))).toEqual([
      ["working", "作業中"],
      ["done", "起動中"],
    ]);
    // A Claude session is a terminal too.
    await expect($(".orca-term")).toBeDisplayed();
    expect((await waitForCalls(read))[0]).toEqual({ handle: "term_example-app" });
    await tabOf("orca:term_example-app_zsh").$(".orca-tab-btn").click();
    await expect($(".orca-term")).toBeDisplayed();
    await project("example-api").click();
    await expect(selectedTab()).toHaveText(expect.stringContaining("Fix the parser"));
    await project("example-app").click();
    await expect(selectedTab()).toHaveText(expect.stringContaining("zsh"));
  });

  // Where the last tab, the plus and the bar end, and whether the strip of tabs scrolls.
  const edges = () =>
    browser.execute(() => {
      const r = (selector: string) => document.querySelector(selector)!.getBoundingClientRect();
      const lastTab = [...document.querySelectorAll(".orca-tabs .orca-tab")].pop()!.getBoundingClientRect();
      const tabs = document.querySelector(".orca-tabs")!;
      // The right end of the room of the strip and the plus: the button of the file pane (A-18) when the bar has it, else the bar's edge.
      const toggle = document.querySelector(".orca-tabbar .orca-files-toggle:not([hidden])");
      return { lastRight: lastTab.right, plusLeft: r(".orca-plus").left, plusRight: r(".orca-plus").right, barRight: toggle ? toggle.getBoundingClientRect().left : r(".orca-tabbar").right, scrolls: tabs.scrollWidth > tabs.clientWidth };
    });

  it("puts the plus right after the last tab", async () => {
    await openOrca(orcaOverview(sample(), worktrees(), { terminals: [orcaTerminal("example-app", "zsh")] }));
    await project("example-app").click();
    await expect(selectedTab()).toBeDisplayed();
    const one = await edges();
    expect(one.scrolls).toBe(false);
    expect(one.plusLeft - one.lastRight).toBeLessThanOrEqual(8);
    expect(one.plusLeft).toBeGreaterThanOrEqual(one.lastRight);
  });

  it("keeps the plus in view at the right end of the bar when the tabs overflow", async () => {
    await openOrca(orcaOverview(sample(), worktrees(), { terminals: Array.from({ length: 30 }, (_, i) => orcaTerminal("example-app", `terminal-with-a-long-name-${i}`)) }));
    await project("example-app").click();
    await expect(selectedTab()).toBeDisplayed();
    const many = await edges();
    expect(many.scrolls).toBe(true);
    expect(many.plusRight).toBeLessThanOrEqual(many.barRight);
    expect(many.barRight - many.plusRight).toBeLessThanOrEqual(8);
    await expect($(".orca-plus")).toBeDisplayed();
  });

  it("says a project has no session, with the tab strip empty", async () => {
    await openOrca(withTerminals());
    await $("#orca-list .orca-stopped-toggle").click();
    await project("example-idle").click();
    await expect($(".orca-empty")).toBeDisplayed();
    await expect($(".orca-empty")).toHaveText("セッションはありません");
    await expect($(".orca-tabs")).toBeDisplayed();
    expect(await count(".orca-tabs .orca-tab")).toBe(0);
    await expect($(".orca-term")).not.toBeDisplayed();
  });

  it("selects the project and the tab of a session row, and keeps the order of the tabs through a read", async () => {
    await openOrca(withTerminals());
    await select("example-app");
    expect(await tabTitles()).toEqual(["Write the docs", "zsh"]);
    await expect(project("example-app")).toHaveAttribute("aria-pressed", "true");
    // A read that lists the new terminal before the old one does not move the tabs: they stay in the order they were first seen.
    await mock("orca_overview", orcaOverview(sample(), worktrees(), { terminals: [orcaTerminal("example-app", "bash"), orcaTerminal("example-app", "zsh")] }));
    await showAgain();
    await browser.waitUntil(async () => (await tabTitles()).length === 3, { timeoutMsg: "the new terminal never became a tab" });
    expect(await tabTitles()).toEqual(["Write the docs", "zsh", "bash"]);
    await expect(selectedTab()).toHaveText(expect.stringContaining("Write the docs"));
  });

  describe("the bell and the work (A-8)", () => {
    const THIS = "このマシン";
    const bell = () => $("#orca-bell");
    const tabId = (repo: string) => claudeTab(repo);
    // The rows of the work: the tab id, the title, the time, the latest message (null: none), the project and the branch.
    const works = () =>
      browser.execute(() =>
        [...document.querySelectorAll<HTMLElement>("#orca-feed .orca-active")].map((r) => [
          r.dataset.session,
          r.querySelector(".orca-active-title")?.textContent ?? null,
          r.querySelector(".orca-active-time")!.textContent,
          r.querySelector(".orca-active-latest")?.textContent ?? null,
          r.querySelector(".orca-active-project")!.textContent,
          r.querySelector(".orca-active-branch")!.textContent,
        ]),
      );
    const pressedWorks = () => browser.execute(() => [...document.querySelectorAll<HTMLElement>("#orca-feed .orca-active")].filter((r) => r.getAttribute("aria-pressed") === "true").map((r) => r.dataset.session));
    const expectPressed = (want: string[]) => browser.waitUntil(async () => JSON.stringify(await pressedWorks()) === JSON.stringify(want), { timeoutMsg: `the marked rows never became ${want.join()}` });
    const activeOf = (repo: string) => $(`#orca-feed .orca-active[data-session="${tabId(repo)}"]`);
    // Sessions in several projects, a Codex one among them, with the times 3, 8, 40 and 90 minutes ago, and one whose time is unknown; the rows that have no tab are left out.
    const read = () =>
      orcaOverview(
        [
          orcaRow("example-lib", "fix/y", "Run the tests", { group: "done", minutes: 40, agent: "codex" }),
          orcaRow("example-db", "main", "Check the data", { group: "done", status: "failed", minutes: 90 }),
          orcaRow("example-app", "main", "Write the docs", { minutes: 3, latest: "Reading the page", subagents: 2, shell: "ls" }),
          orcaRow("example-web", "dev", "No time yet", { atMs: 0 }),
          orcaRow("example-api", "feat/x", "Fix the parser", { group: "waiting", minutes: 8, latest: "どちらにしますか？" }),
          orcaRow("example-no", "dev", "No tab", { paneKey: null, handle: null }),
          orcaRow("example-term", "dev", "Other AI with no terminal", { agent: "antigravity", handle: null }),
        ],
        [orcaWorktree("example-app", "main", { gitBranch: "feat/a" }), orcaWorktree("example-notes", "develop")],
      );
    const openWork = async (value = read(), fixtures: Record<string, unknown> = {}) => {
      await openOrca(value, fixtures);
      await bell().click();
      await expect(bell()).toHaveAttribute("aria-pressed", "true");
    };

    it("draws the bell with the number of the sidebar button, and switches the list to the work and back, kept through a read", async () => {
      await openOrca(read());
      await expect(bell()).toHaveAttribute("aria-pressed", "false");
      await expect(bell()).toHaveAttribute("aria-label", "作業中（確認待ち 1 件）");
      await expect($("#orca-bell-count")).toHaveText("1");
      await expect($("#nav-orca .nav-count")).toHaveText("1");
      await expect($("#orca-projects-title")).toHaveText("プロジェクト");
      // The bell is right of the heading and left of the magnifier.
      expect(await browser.execute(() => [...document.querySelectorAll("#orca-projects-head > *")].map((e) => e.id || e.className.split(" ")[0]))).toEqual(["orca-list-head", "orca-bell", "orca-search-open"]);
      await expect($("#orca-stopped")).toBeDisplayed();
      expect(await count("#orca-feed .orca-active")).toBe(0);
      await bell().click();
      await expect(bell()).toHaveAttribute("aria-pressed", "true");
      await expect($("#orca-projects-title")).toHaveText("作業中");
      // The link of the projects that are not running goes with the projects.
      await expect($("#orca-stopped")).not.toBeDisplayed();
      expect(await count("#orca-feed .orca-project")).toBe(0);
      expect(await count("#orca-feed .orca-active")).toBe(5);
      // A read keeps the switch.
      await showAgain();
      await expect(bell()).toHaveAttribute("aria-pressed", "true");
      expect(await count("#orca-feed .orca-active")).toBe(5);
      await bell().click();
      await expect(bell()).toHaveAttribute("aria-pressed", "false");
      await expect($("#orca-projects-title")).toHaveText("プロジェクト");
      await expect($("#orca-stopped")).toBeDisplayed();
      expect(await count("#orca-feed .orca-active")).toBe(0);
    });

    it("draws no number on the bell when nothing needs the user", async () => {
      await openOrca(orcaOverview([orcaRow("example-app", "main", "Write the docs")], [orcaWorktree("example-app", "main")]));
      await expect($("#orca-bell-count")).not.toBeDisplayed();
      await expect(bell()).toHaveAttribute("aria-label", "作業中");
    });

    it("lists the sessions of every project, the newest change first, in three lines each, with no card and no mark of subagents or a shell", async () => {
      await openWork();
      expect(await works()).toEqual([
        [tabId("example-app"), "Write the docs", "3 分", "Reading the page", "example-app", "feat/a"],
        [tabId("example-api"), "Fix the parser", "8 分", "どちらにしますか？", "example-api", "feat/x"],
        ["orca:term_example-lib", "Run the tests", "40 分前", null, "example-lib", "fix/y"],
        [tabId("example-db"), "Check the data", "1 時間前", null, "example-db", "main"],
        // A session whose time is unknown goes last, with no time.
        [tabId("example-web"), "No time yet", "", null, "example-web", "dev"],
      ]);
      expect(await browser.execute(() => [...document.querySelectorAll<HTMLElement>("#orca-feed .orca-active .orca-ic")].map((i) => i.dataset.status))).toEqual(["working", "question", "done", "failed", "working"]);
      // The lines of a row: the head (icon, title, pencil and time), the latest message, and the foot (AI, project, branch); no latest line when there is none.
      expect(await browser.execute(() => [...document.querySelectorAll("#orca-feed .orca-active")].map((r) => [...r.children].map((c) => c.className.split(" ")[0])))).toEqual([
        ["orca-active-head", "orca-active-latest", "orca-active-foot"],
        ["orca-active-head", "orca-active-latest", "orca-active-foot"],
        ["orca-active-head", "orca-active-foot"],
        ["orca-active-head", "orca-active-foot"],
        ["orca-active-head", "orca-active-foot"],
      ]);
      expect(await browser.execute(() => [...document.querySelectorAll("#orca-feed .orca-active-foot .orca-worktree-agent")].map((a) => a.getAttribute("aria-label")))).toEqual(["Claude", "Claude", "codex", "Claude", "Claude"]);
      expect(await count("#orca-feed .orca-works-toggle, #orca-feed .orca-tag, #orca-feed .orca-card")).toBe(0);
      // One step in from the heading, and a row is no card: no border, no ground.
      const look = await browser.execute(() => {
        const rows = document.querySelector<HTMLElement>("#orca-feed .orca-actives")!;
        const row = getComputedStyle(document.querySelector("#orca-feed .orca-active")!);
        return { indent: getComputedStyle(rows).marginLeft, border: row.borderTopWidth, ground: row.backgroundColor, shadow: row.boxShadow };
      });
      expect(look).toEqual({ indent: "14px", border: "0px", ground: "rgba(0, 0, 0, 0)", shadow: "none" });
    });

    it("draws the lines as text, cut with an ellipsis", async () => {
      await openWork(orcaOverview([orcaRow("example-app", "main", "長い題名".repeat(40), { latest: `<b>bold</b> ${"長い発言".repeat(40)}` })], [orcaWorktree("example-app", "main")]));
      const look = await browser.execute(() => {
        const r = (s: string) => document.querySelector<HTMLElement>(`#orca-feed .orca-active ${s}`)!;
        const row = document.querySelector("#orca-feed .orca-active")!.getBoundingClientRect();
        const cut = (e: HTMLElement) => ({ overflow: getComputedStyle(e).textOverflow, clipped: e.scrollWidth > e.clientWidth, within: e.getBoundingClientRect().right <= row.right });
        return { title: cut(r(".orca-active-title")), latest: cut(r(".orca-active-latest")), markup: r(".orca-active-latest").querySelectorAll("b").length };
      });
      expect(look).toEqual({ title: { overflow: "ellipsis", clipped: true, within: true }, latest: { overflow: "ellipsis", clipped: true, within: true }, markup: 0 });
    });

    it("says there is no session when none has a tab", async () => {
      await openWork(orcaOverview([], [orcaWorktree("example-app", "main")]));
      await expect($("#orca-feed .feed-empty")).toHaveText("作業中のセッションがありません");
    });

    it("selects the project and the tab of a row when it is pressed, and marks the row of the selected tab", async () => {
      await openWork();
      await mock("orca_terminal_read", ["$ claude"]);
      expect(await pressedWorks()).toEqual([]);
      await activeOf("example-api").click();
      await expect(selectedTab()).toHaveText(expect.stringContaining("Fix the parser"));
      await expectPressed([tabId("example-api")]);
      await activeOf("example-app").click();
      await expect(selectedTab()).toHaveText(expect.stringContaining("Write the docs"));
      await expectPressed([tabId("example-app")]);
      // The projects show the same selection when the bell is pressed again.
      await bell().click();
      await expect(project("example-app")).toHaveAttribute("aria-pressed", "true");
    });

    it("draws the projects while a search text is typed, whatever the bell says, and the work again when it is cleared", async () => {
      await openWork();
      await $("#orca-search-open").click();
      await $("#orca-search-input").setValue("example-a");
      await browser.waitUntil(async () => (await count("#orca-feed .orca-project")) > 0, { timeoutMsg: "the projects were not drawn" });
      expect(await count("#orca-feed .orca-active")).toBe(0);
      expect(await textsOf("#orca-feed .orca-project-name")).toEqual(["example-app", "example-api"]);
      // The bell is still pressed.
      await expect(bell()).toHaveAttribute("aria-pressed", "true");
      await $("#orca-search-clear").click();
      await browser.waitUntil(async () => (await count("#orca-feed .orca-active")) === 5, { timeoutMsg: "the work did not come back" });
      expect(await count("#orca-feed .orca-project")).toBe(0);
    });

    it("draws the time of a row again when the clock passes a minute, with no press", async () => {
      await openWork(read(), timers({ orcaClock: 1000 }));
      expect((await works())[0][2]).toBe("3 分");
      await aMinutePasses();
      await browser.waitUntil(async () => (await works())[0][2] === "4 分", { timeoutMsg: "the time did not move" });
    });

    it("opens the modal of A-40 by a right click on a row of a project that is not the selected one", async () => {
      await openWork();
      await mock("orca_terminal_read", ["$ claude"]);
      const cancelled = await browser.execute((tab) => {
        const event = new MouseEvent("contextmenu", { bubbles: true, cancelable: true, button: 2 });
        document.querySelector(`#orca-feed .orca-active[data-session="${tab}"]`)!.dispatchEvent(event);
        return event.defaultPrevented;
      }, tabId("example-api"));
      expect(cancelled).toBe(true);
      await expect($("#orca-peek")).toBeDisplayed();
      await expect($("#orca-peek-project")).toHaveText("example-api");
      await expect($("#orca-peek-title")).toHaveText("どちらにしますか？");
    });

    describe("the title of a row (A-8)", () => {
      const key = "tab_example-app:leaf_1";
      const titles = () => orcaOverview([orcaRow("example-app", "feat/a", "Write the docs"), orcaRow("example-api", "main", "Fix the parser", { group: "waiting" })], worktrees());
      const titleText = () => textsOf(`#orca-feed .orca-active[data-session="${tabId("example-app")}"] .orca-active-title`);
      const field = ".orca-active-title-input";
      // The page's own press of the pencil: it shows while the pointer is on the row, which the driver's pointer does not keep.
      const pencil = () => browser.execute((tab) => document.querySelector<HTMLElement>(`#orca-feed .orca-active[data-session="${tab}"] .orca-active-edit`)!.click(), tabId("example-app"));
      const fieldState = () =>
        browser.execute((selector) => {
          const input = document.querySelector<HTMLInputElement>(selector);
          return input === null ? null : { value: input.value, selected: [input.selectionStart, input.selectionEnd], focused: document.activeElement === input };
        }, field);
      const opened = () => browser.waitUntil(async () => (await fieldState()) !== null, { timeoutMsg: "the field did not open" });

      it("draws the title right of the icon, and the time at the right end of the first line", async () => {
        await openWork(titles());
        const look = await browser.execute((tab) => {
          const head = document.querySelector(`#orca-feed .orca-active[data-session="${tab}"] .orca-active-head`)!;
          const r = (e: Element) => e.getBoundingClientRect();
          const title = r(head.querySelector(".orca-active-title")!);
          const time = r(head.querySelector(".orca-active-time")!);
          return { parts: [...head.children].map((c) => c.className.split(" ")[0]), title: head.querySelector(".orca-active-title")!.textContent, sameLine: Math.abs(title.top - time.top) < 8, timeRight: time.right <= r(head).right, after: time.left >= title.right };
        }, tabId("example-app"));
        expect(look).toEqual({ parts: ["orca-ic", "orca-active-title", "orca-active-edit", "orca-active-time"], title: "Write the docs", sameLine: true, timeRight: true, after: true });
      });

      // :hover and :focus never match in the E2E window (the window is hidden): the hidden state is the computed style, and the rule that shows the pencil is read from the stylesheet to say that the pointer or the focus in the row lifts it.
      it("hides the pencil until the pointer or the focus is in the row, and draws no text of help", async () => {
        await openWork(titles());
        expect(await browser.execute((tab) => getComputedStyle(document.querySelector(`#orca-feed .orca-active[data-session="${tab}"] .orca-active-edit`)!).visibility, tabId("example-app"))).toBe("hidden");
        const showing = await browser.execute(() => {
          for (const sheet of document.styleSheets)
            for (const rule of sheet.cssRules)
              if (rule instanceof CSSStyleRule && rule.selectorText.includes(".orca-active-edit") && rule.style.visibility === "visible") return rule.selectorText;
          return null;
        });
        expect(showing).toContain(".orca-active:hover");
        expect(showing).toContain(".orca-active:focus-within");
        expect(await browser.execute(() => [document.querySelector("#orca-feed .orca-active-edit")!.getAttribute("aria-label"), document.querySelector("#orca-feed .orca-active-edit")!.hasAttribute("title")])).toEqual(["題名を変える", false]);
      });

      it("turns the title into a field with the title in it, selected, and saves it with Enter: it is fixed, with a pin, in the row and the tab", async () => {
        await openWork(titles());
        const set = await mock("orca_title_set", { [THIS]: { [key]: "My title" } });
        await pencil();
        await opened();
        expect(await fieldState()).toEqual({ value: "Write the docs", selected: [0, "Write the docs".length], focused: true });
        // The pencil and the field do not select the session.
        expect(await pressedWorks()).toEqual([]);
        await $(field).setValue("My title");
        await browser.keys("Enter");
        expect(await waitForCalls(set)).toEqual([{ target: THIS, key, title: "My title" }]);
        await browser.waitUntil(async () => (await count(field)) === 0, { timeoutMsg: "the field did not close" });
        expect(await titleText()).toEqual(["My title"]);
        expect(await textsOf("#orca-feed .orca-active-pin")).toEqual(["📌"]);
        await activeOf("example-app").click();
        expect(await tabTitles()).toEqual(["My title"]);
      });

      it("draws a title that was fixed before, with a pin, in the row and the tab, in place of the automatic one", async () => {
        await openWork(titles(), { orca_titles: { [THIS]: { [key]: "Mine" } } });
        expect(await titleText()).toEqual(["Mine"]);
        expect(await count("#orca-feed .orca-active-pin")).toBe(1);
        await activeOf("example-app").click();
        expect(await tabTitles()).toEqual(["Mine"]);
      });

      it("gives the automatic title back, and takes the pin off, when an empty text is saved", async () => {
        await openWork(titles(), { orca_titles: { [THIS]: { [key]: "Mine" } } });
        const set = await mock("orca_title_set", {});
        await pencil();
        await opened();
        expect((await fieldState())?.value).toBe("Mine");
        await $(field).setValue("");
        await browser.keys("Enter");
        expect(await waitForCalls(set)).toEqual([{ target: THIS, key, title: "" }]);
        await browser.waitUntil(async () => (await titleText())[0] === "Write the docs", { timeoutMsg: "the automatic title did not come back" });
        expect(await count("#orca-feed .orca-active-pin")).toBe(0);
      });

      it("types the title of a terminal of another AI under its handle", async () => {
        await openWork(orcaOverview([orcaRow("example-app", "feat/a", "Write the docs", { agent: "codex" })], worktrees()));
        const set = await mock("orca_title_set", {});
        await browser.execute(() => document.querySelector<HTMLElement>("#orca-feed .orca-active-edit")!.click());
        await opened();
        await $(field).setValue("Codex work");
        await browser.keys("Enter");
        expect(await waitForCalls(set)).toEqual([{ target: THIS, key: "term_example-app", title: "Codex work" }]);
      });

      it("cancels with Escape and when the focus leaves the field, and saves nothing", async () => {
        await openWork(titles());
        const set = await mock("orca_title_set", {});
        await pencil();
        await opened();
        await $(field).setValue("Typed");
        await browser.keys("Escape");
        await browser.waitUntil(async () => (await count(field)) === 0, { timeoutMsg: "Escape did not close the field" });
        expect(await titleText()).toEqual(["Write the docs"]);
        await pencil();
        await opened();
        await browser.execute((selector) => document.querySelector<HTMLInputElement>(selector)!.blur(), field);
        await browser.waitUntil(async () => (await count(field)) === 0, { timeoutMsg: "the focus leaving did not close the field" });
        expect(await titleText()).toEqual(["Write the docs"]);
        expect(await callsOf(set)).toEqual([]);
      });

      it("shows a failed save on a card and closes the field", async () => {
        await openWork(titles());
        await mock("orca_title_set", rejects("disk full"));
        await pencil();
        await opened();
        await $(field).setValue("Mine");
        await browser.keys("Enter");
        await browser.waitUntil(async () => (await count(field)) === 0, { timeoutMsg: "the field did not close" });
        expect(await titleText()).toEqual(["Write the docs"]);
        await expect($(CARD)).toBeDisplayed();
      });

      it("keeps the keys and the presses of the field from the row", async () => {
        await openWork(titles());
        await pencil();
        await opened();
        await $(field).click();
        await $(field).setValue("a b");
        expect(await pressedWorks()).toEqual([]);
        expect((await fieldState())?.value).toBe("a b");
      });

      // The list is read again by the clock: leaving the screen would take the focus from the field, which cancels it.
      it("moves the very field into the new row when the list is drawn again, with what was typed, its selection and its focus", async () => {
        await openWork(titles(), timers({ orcaClock: 1000 }));
        await pencil();
        await opened();
        await $(field).setValue("a b c");
        // A mark on the element tells a new element from the same one.
        await browser.execute((selector) => {
          const input = document.querySelector<HTMLInputElement>(selector)!;
          input.dataset.mark = "kept";
          input.setSelectionRange(1, 3);
        }, field);
        const kept = () =>
          browser.execute((selector) => {
            const input = document.querySelector<HTMLInputElement>(selector);
            return input === null ? null : { mark: input.dataset.mark ?? null, value: input.value, selected: [input.selectionStart, input.selectionEnd], focused: document.activeElement === input };
          }, field);
        const before = { mark: "kept", value: "a b c", selected: [1, 3], focused: true };
        expect(await kept()).toEqual(before);
        // A read that changes the row (a new latest message) draws the list again.
        await mock("orca_overview", orcaOverview([orcaRow("example-app", "feat/a", "Write the docs", { latest: "next" }), orcaRow("example-api", "main", "Fix the parser", { group: "waiting" })], worktrees()));
        await browser.waitUntil(async () => (await count("#orca-feed .orca-active-latest")) === 1, { timeoutMsg: "the row was not drawn again" });
        expect(await kept()).toEqual(before);
        expect(await count(field)).toBe(1);
        // The field still saves and cancels as before: Escape closes it with nothing saved.
        await browser.keys("Escape");
        await browser.waitUntil(async () => (await count(field)) === 0, { timeoutMsg: "Escape did not close the moved field" });
        expect(await callsOf("orca_title_set")).toEqual([]);
      });

      it("takes out the titles of the sessions that the list, read well, no longer holds with one call for the place, and leaves the others", async () => {
        const held = { [THIS]: { [key]: "Mine", "tab_gone:leaf_1": "Old", "tab_gone:leaf_2": "Older" } };
        await openWork(titles(), { orca_titles: held, orca_titles_forget: { [THIS]: { [key]: "Mine" } } });
        expect(await waitForCalls("orca_titles_forget")).toEqual([{ target: THIS, keys: ["tab_gone:leaf_1", "tab_gone:leaf_2"] }]);
        expect(await callsOf("orca_title_set")).toEqual([]);
        expect(await titleText()).toEqual(["Mine"]);
      });

      // The app starts and openOrca shows the screen: the taking out is tried at the start and again when the screen is shown (which clears what failed), so the calls up to then are one or two; what the test holds is that the clock's reads add none and that showing the screen again does.
      it("does not send a taking out that failed again at the next read, and sends it again when the screen is shown again", async () => {
        const held = { [THIS]: { [key]: "Mine", "tab_gone:leaf_1": "Old" } };
        const sent = { target: THIS, keys: ["tab_gone:leaf_1"] };
        await openWork(titles(), { orca_titles: held, orca_titles_forget: rejects("disk full"), ...timers({ orcaClock: 1000 }) });
        await waitForCalls("orca_titles_forget");
        await browser.pause(800);
        const shown = await callsOf("orca_titles_forget");
        expect(shown.length).toBeLessThanOrEqual(2);
        for (const call of shown) expect(call).toEqual(sent);
        // Reads of the list go on (the clock, 1.2 periods of 1 second twice), and none sends it again.
        await browser.pause(2400);
        expect(await callsOf("orca_titles_forget")).toHaveLength(shown.length);
        expect(await titleText()).toEqual(["Mine"]);
        await showAgain();
        expect(await waitForCalls("orca_titles_forget", shown.length + 1)).toHaveLength(shown.length + 1);
      });

      it("takes out no title while the read of the list failed", async () => {
        await openOrca(orcaOverview([], [], { state: "failed", message: "Orca is not running", environments: [] }), { orca_titles: { [THIS]: { [key]: "Mine" } } });
        await waitForCalls("orca_titles");
        await browser.pause(500);
        expect(await callsOf("orca_titles_forget")).toEqual([]);
        expect(await callsOf("orca_title_set")).toEqual([]);
      });
    });
  });

  describe("the worktrees under a project (A-8)", () => {
    // The rows of the worktrees in the list: path, branch, the status of its icon and the label of its AI icon (null: none).
    const worktreeRows = () =>
      browser.execute(() =>
        [...document.querySelectorAll<HTMLElement>("#orca-feed .orca-worktree")].map((r) => [r.dataset.worktree, r.querySelector(".orca-worktree-branch")!.textContent, r.querySelector<HTMLElement>(".orca-ic")!.dataset.status, r.querySelector(".orca-worktree-agent")?.getAttribute("aria-label") ?? null]),
      );
    const rowAt = (path: string) => $(`#orca-feed .orca-worktree[data-worktree="${path}"]`);
    const pressedRows = () => browser.execute(() => [...document.querySelectorAll<HTMLElement>("#orca-feed .orca-worktree")].filter((r) => r.getAttribute("aria-pressed") === "true").map((r) => r.dataset.worktree));
    // A project with three worktrees, listed with the second one first: the repository's own folder (a Claude session at work), a worktree with a Codex session that ended, a detached one with no session, and an archived one.
    const three = () =>
      orcaOverview(
        [
          orcaRow("example-app", "main", "Write the docs", { path: "/work/example-app" }),
          orcaRow("example-app", "feat/b", "Fix the parser", { group: "done", minutes: 30, agent: "codex", path: "/work/example-app-b", paneKey: "tab_b:leaf_1", handle: "term_b" }),
        ],
        [
          orcaWorktree("example-app", "feat/b", { path: "/work/example-app-b", status: "done" }),
          orcaWorktree("example-app", "wt-c", { path: "/work/example-app-c", gitBranch: "" }),
          orcaWorktree("example-app", "old", { path: "/work/example-app-old", archived: true }),
          orcaWorktree("example-app", "main", { status: "working" }),
        ],
      );

    it("draws a row for each worktree under its project, the repository's own folder first, with the status icon, the branch and the AI icon of the newest session, and no arrow", async () => {
      await openOrca(three());
      expect(await worktreeRows()).toEqual([
        ["/work/example-app", "main", "working", "Claude"],
        ["/work/example-app-b", "feat/b", "done", "codex"],
        // A worktree on no branch is named as Orca names it, and one with no session has no AI icon.
        ["/work/example-app-c", "wt-c", "idle", null],
      ]);
      // The rows are under their project's row, which has no icon, and there is no arrow and no row of a session.
      expect(await browser.execute(() => [...document.querySelectorAll("#orca-feed .orca-proj")].map((p) => [...p.children].map((c) => c.className.split(" ")[0])))).toEqual([["orca-project", "orca-worktree", "orca-worktree", "orca-worktree"]]);
      expect(await count("#orca-feed .orca-project .orca-ic")).toBe(0);
      expect(await count("#orca-feed .orca-arrow, #orca-feed .orca-session, #orca-feed .orca-works-toggle")).toBe(0);
    });

    it("draws the mark of Claude in its color and the general mark for every other AI, and the label AI when Orca names none", async () => {
      await openOrca(
        orcaOverview(
          [
            orcaRow("example-app", "main", "Write the docs"),
            orcaRow("example-app", "b", "Other", { agent: "antigravity", path: "/work/b", paneKey: "tab_b:leaf_1", handle: "term_b" }),
            orcaRow("example-app", "c", "Nameless", { agent: null, path: "/work/c", paneKey: "tab_c:leaf_1", handle: "term_c" }),
          ],
          [orcaWorktree("example-app", "main"), orcaWorktree("example-app", "b", { path: "/work/b" }), orcaWorktree("example-app", "c", { path: "/work/c" })],
        ),
      );
      expect(await worktreeRows()).toEqual([
        ["/work/example-app", "main", "idle", "Claude"],
        ["/work/b", "b", "idle", "antigravity"],
        ["/work/c", "c", "idle", "AI"],
      ]);
      expect(await browser.execute(() => [...document.querySelectorAll<HTMLElement>("#orca-feed .orca-worktree-agent")].map((a) => [a.className, a.querySelectorAll("svg").length, a.getAttribute("role")]))).toEqual([
        ["orca-worktree-agent claude", 1, "img"],
        ["orca-worktree-agent", 1, "img"],
        ["orca-worktree-agent", 1, "img"],
      ]);
    });

    it("takes the AI of the newest session of the worktree, and none for a row with no tab", async () => {
      // The newer row is Codex's, the older Claude's, in the same worktree; the newest one with no pane has no tab, so it is passed over.
      await openOrca(
        orcaOverview(
          [
            orcaRow("example-app", "main", "Not a tab", { agent: "antigravity", paneKey: null, handle: null }),
            orcaRow("example-app", "main", "Newer", { agent: "codex", paneKey: "tab_x:leaf_1", handle: "term_x" }),
            orcaRow("example-app", "main", "Older", { minutes: 40 }),
          ],
          [orcaWorktree("example-app", "main")],
        ),
      );
      expect(await worktreeRows()).toEqual([["/work/example-app", "main", "idle", "codex"]]);
    });

    it("cuts a long branch name with an ellipsis inside the row", async () => {
      const longBranch = `feat/${"very-long-branch-name-".repeat(8)}end`;
      await openOrca(orcaOverview([orcaRow("example-app", "main", "Write the docs")], [orcaWorktree("example-app", "main", { gitBranch: longBranch })]));
      const look = await browser.execute(() => {
        const row = document.querySelector("#orca-feed .orca-worktree")!;
        const branch = row.querySelector<HTMLElement>(".orca-worktree-branch")!;
        const style = getComputedStyle(branch);
        return { text: branch.textContent, overflow: style.textOverflow, minWidth: style.minWidth, clipped: branch.scrollWidth > branch.clientWidth, branchRight: branch.getBoundingClientRect().right, rowRight: row.getBoundingClientRect().right };
      });
      expect(look.text).toBe(longBranch);
      expect(look).toMatchObject({ overflow: "ellipsis", minWidth: "0px", clipped: true });
      expect(look.branchRight).toBeLessThanOrEqual(look.rowRight);
    });

    it("selects the project and the tab of the newest session when a row is pressed, and only the project for a worktree with no session", async () => {
      await openOrca(three());
      await mock("orca_terminal_read", ["$ codex"]);
      await rowAt("/work/example-app-b").click();
      await expect(project("example-app")).toHaveAttribute("aria-pressed", "true");
      await expect(selectedTab()).toHaveText(expect.stringContaining("Fix the parser"));
      expect(await pressedRows()).toEqual(["/work/example-app-b"]);
      // The heading of the project has no ground while its worktree is the selected row.
      expect(await browser.execute(() => getComputedStyle(document.querySelector("#orca-feed .orca-project")!).backgroundColor)).toBe("rgba(0, 0, 0, 0)");
      // A worktree with no session selects its project, and the tab selected stays (so does the row of its worktree).
      await rowAt("/work/example-app-c").click();
      await expect(selectedTab()).toHaveText(expect.stringContaining("Fix the parser"));
      expect(await pressedRows()).toEqual(["/work/example-app-b"]);
      // The Claude session of the repository's own folder.
      await rowAt("/work/example-app").click();
      await expect(selectedTab()).toHaveText(expect.stringContaining("Write the docs"));
      expect(await pressedRows()).toEqual(["/work/example-app"]);
    });

    it("selects a project that has no session by its worktree's row, and says it has none", async () => {
      await openOrca(orcaOverview([], [orcaWorktree("example-lib", "main")]));
      // A project with no session is not running, so its rows are under the link (A-8).
      await $("#orca-stopped .orca-stopped-toggle").click();
      const row = $('#orca-stopped-feed .orca-worktree[data-worktree="/work/example-lib"]');
      await expect(row).toHaveAttribute("aria-pressed", "false");
      await row.click();
      await expect(project("example-lib")).toHaveAttribute("aria-pressed", "true");
      await expect($(".orca-empty")).toHaveText("セッションはありません");
      expect(await pressedRows()).toEqual([]);
    });

    it("marks the row of the worktree that the selected tab is in, and moves the mark when a tab of another worktree is pressed", async () => {
      await openOrca(
        orcaOverview([orcaRow("example-app", "main", "Write the docs")], [orcaWorktree("example-app", "main"), orcaWorktree("example-app", "feat/b", { path: "/work/example-app-b" })], {
          terminals: [orcaTerminal("example-app", "zsh", { path: "/work/example-app-b" })],
        }),
      );
      await mock("orca_terminal_read", ["$ ls"]);
      await rowAt("/work/example-app").click();
      expect(await pressedRows()).toEqual(["/work/example-app"]);
      await tabOf("orca:term_example-app_zsh").$(".orca-tab-btn").click();
      await expect(selectedTab()).toHaveText(expect.stringContaining("zsh"));
      await browser.waitUntil(async () => (await pressedRows()).join() === "/work/example-app-b", { timeoutMsg: "the selected row did not follow the tab" });
      await tabOf(claudeTab("example-app")).$(".orca-tab-btn").click();
      await browser.waitUntil(async () => (await pressedRows()).join() === "/work/example-app", { timeoutMsg: "the selected row did not follow the tab" });
    });

    it("draws the rows of the projects that are not running under their link and in a search, as the others", async () => {
      await openOrca(orcaOverview([orcaRow("example-app", "main", "Write the docs")], [orcaWorktree("example-app", "main"), orcaWorktree("example-notes", "develop"), orcaWorktree("example-notes", "feat/n", { path: "/work/example-notes-n" })]));
      expect(await worktreeRows()).toEqual([["/work/example-app", "main", "idle", "Claude"]]);
      await $("#orca-stopped .orca-stopped-toggle").click();
      expect(await browser.execute(() => [...document.querySelectorAll("#orca-stopped-feed .orca-worktree")].map((r) => r.querySelector(".orca-worktree-branch")!.textContent))).toEqual(["develop", "feat/n"]);
    });

    describe("the working projects", () => {
      // A read as Orca lists it: the projects in the order given (the newest activity first), each working unless it is in `done` or `waiting`.
      const read = (order: string[], done: string[] = [], waiting: string[] = []) =>
        orcaOverview(
          order.map((repo) => orcaRow(repo, "main", `Task of ${repo}`, done.includes(repo) ? { group: "done" } : waiting.includes(repo) ? { group: "waiting" } : {})),
          order.map((repo) => orcaWorktree(repo, "main")),
        );
      const names = () => projectNames();
      const reread = async (value: ReturnType<typeof read>) => {
        const overview = await mock("orca_overview", value);
        await showAgain();
        await waitForCalls(overview);
      };
      const expectNames = (want: string[]) => browser.waitUntil(async () => (await names()).join() === want.join(), { timeoutMsg: `the order never became ${want.join()}` });

      it("keeps the order of the working projects through reads that reorder them, puts one that starts at the front, and sends one that stops below", async () => {
        await openOrca(read(["w-a", "w-b", "w-q"], [], ["w-q"]));
        // The project that only waits for the user is not in the working group: it stays below.
        expect(await names()).toEqual(["w-a", "w-b", "w-q"]);
        // Orca lists the newest activity first, and it moves with the work: the order shown does not.
        await reread(read(["w-q", "w-b", "w-a"], [], ["w-q"]));
        await browser.pause(300);
        expect(await names()).toEqual(["w-a", "w-b", "w-q"]);
        // A project that starts to work goes in front of the others.
        await reread(read(["w-c", "w-b", "w-a", "w-q"], [], ["w-q"]));
        await expectNames(["w-c", "w-a", "w-b", "w-q"]);
        // One that stops goes below the working ones, and a project that only waits stays below them.
        await reread(read(["w-c", "w-b", "w-a", "w-q"], ["w-a"], ["w-q"]));
        await expectNames(["w-c", "w-b", "w-a", "w-q"]);
        // Starting again, it goes in front.
        await reread(read(["w-a", "w-c", "w-b", "w-q"], [], ["w-q"]));
        await expectNames(["w-a", "w-c", "w-b", "w-q"]);
        // The ones below keep the order of the read.
        await reread(read(["w-a", "w-c", "w-b", "w-q"], ["w-a", "w-b", "w-c"], ["w-q"]));
        await expectNames(["w-a", "w-c", "w-b", "w-q"]);
        await reread(read(["w-b", "w-c", "w-a", "w-q"], ["w-a", "w-b", "w-c"], ["w-q"]));
        await expectNames(["w-b", "w-c", "w-a", "w-q"]);
      });

      // A read of agents given one by one: `[repo, leaf, group]`, a project for each repo in the order of first appearance.
      const agents = (list: [string, string, "working" | "waiting" | "done"][]) => {
        const repos = [...new Set(list.map(([repo]) => repo))];
        return orcaOverview(
          list.map(([repo, leaf, group]) => orcaRow(repo, "main", `Task of ${repo} ${leaf}`, { group, paneKey: `tab_${repo}:${leaf}`, handle: `term_${repo}_${leaf}` })),
          repos.map((repo) => orcaWorktree(repo, "main")),
        );
      };

      it("keeps a project with a working session and a waiting one in the working group, through a question and its answer", async () => {
        await openOrca(agents([["w-q", "leaf_1", "waiting"], ["w-m", "leaf_1", "working"], ["w-m", "leaf_2", "waiting"], ["w-a", "leaf_1", "working"]]));
        // The status of w-m is the question (it outranks working), but a session of it works: it is in the group. Only w-q, which just waits, is below.
        expect(await names()).toEqual(["w-m", "w-a", "w-q"]);
        // The read lists the projects in another order, and the second session of w-m is answered: nothing moves.
        await reread(agents([["w-a", "leaf_1", "working"], ["w-q", "leaf_1", "waiting"], ["w-m", "leaf_1", "working"], ["w-m", "leaf_2", "working"]]));
        await browser.pause(300);
        expect(await names()).toEqual(["w-m", "w-a", "w-q"]);
        // It asks again: nothing moves.
        await reread(agents([["w-m", "leaf_2", "waiting"], ["w-q", "leaf_1", "waiting"], ["w-m", "leaf_1", "working"], ["w-a", "leaf_1", "working"]]));
        await browser.pause(300);
        expect(await names()).toEqual(["w-m", "w-a", "w-q"]);
      });

      it("puts a project whose icon works with no working Claude row in the working group, and back among the others when it stops", async () => {
        // w-x works by its icon (another agent, or a worktree's status) but has only a plain terminal; w-y is idle with one.
        const read = (xStatus: "working" | "done") => {
          const base = orcaOverview([], [orcaWorktree("w-y", "main"), orcaWorktree("w-x", "main")], { terminals: [orcaTerminal("w-y", "zsh"), orcaTerminal("w-x", "zsh")] });
          return { ...base, projects: base.projects.map((p) => (p.key === "proj_w-x" ? { ...p, status: xStatus } : p)) };
        };
        await openOrca(read("working"));
        expect(await names()).toEqual(["w-x", "w-y"]);
        await reread(read("done"));
        await expectNames(["w-y", "w-x"]);
        await reread(read("working"));
        await expectNames(["w-x", "w-y"]);
      });
    });
  });
  it("closes a session in Orca with its handle and the target, reads the list, and keeps the selection when another tab is closed", async () => {
    await openOrca(withTerminals());
    await project("example-app").click();
    const close = await mock("orca_close", null);
    const overview = await mock("orca_overview", withTerminals());
    // The plain terminal's close button is beside its tab: it does not select it.
    await tabOf("orca:term_example-app_zsh").$(".orca-tab-close").click();
    expect(await waitForCalls(close)).toEqual([{ handle: "term_example-app_zsh", environment: null }]);
    await expect(selectedTab()).toHaveText(expect.stringContaining("Write the docs"));
    // The list is read at once, and the tab leaves when the read no longer holds it.
    await waitForCalls(overview);
    await tabOf(claudeTab("example-app")).$(".orca-tab-close").click();
    expect(await waitForCalls(close, 2)).toEqual([
      { handle: "term_example-app_zsh", environment: null },
      { handle: "term_example-app", environment: null },
    ]);
    await mock("orca_overview", orcaOverview(sample().slice(1), worktrees()));
    await showAgain();
    await expect($(".orca-empty")).toHaveText("セッションはありません");
    expect(await tabTitles()).toEqual([]);
  });

  it("drops the tab of a terminal that Orca closed, and selects the next one", async () => {
    await openOrca(withTerminals());
    await project("example-app").click();
    await tabOf("orca:term_example-app_zsh").$(".orca-tab-btn").click();
    await expect(selectedTab()).toHaveText(expect.stringContaining("zsh"));
    await mock("orca_overview", orcaOverview(sample(), worktrees()));
    await showAgain();
    await browser.waitUntil(async () => (await tabTitles()).length === 1, { timeoutMsg: "the tab of the closed terminal stayed" });
    await expect(selectedTab()).toHaveText(expect.stringContaining("Write the docs"));
  });

  it("keeps the tab and shows the message when Orca cannot close it", async () => {
    await openOrca(withTerminals());
    await project("example-app").click();
    const close = await mock("orca_close", rejects("Orca が時間内に応答しませんでした"));
    const overview = await mock("orca_overview", withTerminals());
    await tabOf("orca:term_example-app_zsh").$(".orca-tab-close").click();
    await waitForCalls(close);
    // The list is read again after the failure.
    await waitForCalls(overview);
    await expect($(CARDS)).toBeDisplayed();
    await expect($(CARD)).toHaveText("Orca が時間内に応答しませんでした");
    expect(await tabTitles()).toHaveLength(2);
    // The button works again.
    await expect(tabOf("orca:term_example-app_zsh").$(".orca-tab-close")).toBeEnabled();
  });

  it("cannot close a Claude session that has no terminal", async () => {
    await openOrca(orcaOverview([orcaRow("example-app", "feat/a", "Write the docs", { handle: null })], worktrees()));
    await project("example-app").click();
    await expect(tabOf(claudeTab("example-app")).$(".orca-tab-close")).toBeDisabled();
  });

  describe("a terminal of this machine", () => {
    const zsh = "orca:term_example-app_zsh";

    it("mirrors the screen of the terminal once a second while its tab shows, and draws each frame again", async () => {
      await openOrca(withTerminals());
      await project("example-app").click();
      const read = await mock("orca_terminal_read", ["$ ls", "file-a  file-b"]);
      await tabOf(zsh).$(".orca-tab-btn").click();
      expect((await waitForCalls(read))[0]).toEqual({ handle: "term_example-app_zsh" });
      await browser.waitUntil(async () => (await screenText()).includes("file-b"), { timeoutMsg: "the first frame never showed" });
      await mock("orca_terminal_read", ["$ pwd", "/work/example-app"]);
      await browser.waitUntil(async () => (await screenText()).includes("/work/example-app"), { timeoutMsg: "the next frame never showed" });
      expect(await screenText()).not.toContain("file-b");
    });

    it("writes no clipboard for an OSC 52 request in a frame", async () => {
      await openOrca(withTerminals());
      await project("example-app").click();
      await stubClipboard();
      await mock("orca_terminal_read", [`\x1b]52;c;${Buffer.from("from a frame").toString("base64")}\x07$ ls`]);
      await tabOf(zsh).$(".orca-tab-btn").click();
      await browser.waitUntil(async () => (await screenText()).includes("$ ls"), { timeoutMsg: "the frame never showed" });
      await browser.pause(500);
      expect(await copiedTexts()).toEqual([]);
    });

    it("fits the terminal inside the pane, its last row included", async () => {
      await openOrca(withTerminals());
      await mock("orca_terminal_read", Array.from({ length: 200 }, (_, i) => `line ${i}`));
      await project("example-app").click();
      await tabOf(zsh).$(".orca-tab-btn").click();
      await browser.waitUntil(async () => (await screenText()).includes("line 199"), { timeoutMsg: "the last line never showed" });
      const box = await browser.execute(() => {
        const r = (s: string) => document.querySelector(s)!.getBoundingClientRect();
        const rows = [...document.querySelectorAll(".orca-term .orca-term-box:not([hidden]) .xterm-rows > div")];
        return { pane: r(".orca-term").bottom, screen: r(".orca-term .orca-term-box:not([hidden]) .xterm-screen").bottom, last: rows.at(-1)!.getBoundingClientRect().bottom };
      });
      expect(box.screen).toBeLessThanOrEqual(box.pane + 1);
      expect(box.last).toBeLessThanOrEqual(box.pane + 1);
    });

    it("stops reading while another tab shows", async () => {
      await openOrca(orcaOverview(sample(), worktrees(), { terminals: [orcaTerminal("example-app", "zsh")] }), timers({ orcaMirror: 250 }));
      await project("example-app").click();
      const read = await mock("orca_terminal_read", ["$"]);
      await tabOf(zsh).$(".orca-tab-btn").click();
      await waitForCalls(read);
      await project("example-api").click();
      await mock("orca_terminal_read", ["$"]);
      await browser.pause(300);
      // Only the terminal shown is read.
      expect((await callsOf("orca_terminal_read")).every((c) => (c as { handle: string }).handle === "term_example-api")).toBe(true);
    });

    it("stops reading while the window is hidden, and reads at once and goes on when it is shown", async () => {
      await openOrca(withTerminals(), timers({ orcaMirror: 250 }));
      await project("example-app").click();
      await tabOf(zsh).$(".orca-tab-btn").click();
      await waitForCalls("orca_terminal_read");
      await setWindowHidden(true);
      await mock("orca_terminal_read", ["$"]);
      await browser.pause(300);
      expect(await callsOf("orca_terminal_read")).toEqual([]);
      await setWindowHidden(false);
      expect((await waitForCalls("orca_terminal_read"))[0]).toEqual({ handle: "term_example-app_zsh" });
      await waitForCalls("orca_terminal_read", 2);
    });

    it("sends the typed keys as they are, to the terminal shown", async () => {
      await openOrca(withTerminals());
      await mock("orca_terminal_read", ["$"]);
      const input = await mock("orca_terminal_input", null);
      await project("example-app").click();
      await tabOf(zsh).$(".orca-tab-btn").click();
      await $(".orca-term .orca-term-box:not([hidden]) .xterm-screen").click();
      await browser.keys(["c", "d"]);
      await browser.waitUntil(async () => (await callsOf(input)).map((c) => (c as { text: string }).text).join("") === "cd", { timeoutMsg: "the keys were not sent" });
      expect((await callsOf(input)).every((c) => (c as { handle: string }).handle === "term_example-app_zsh")).toBe(true);
    });

    it("shows the message when the keys cannot be sent", async () => {
      await openOrca(withTerminals());
      await mock("orca_terminal_read", ["$"]);
      const input = await mock("orca_terminal_input", rejects("宛先のターミナルは終了したか、見つかりません。一覧を読み直してください"));
      await project("example-app").click();
      await tabOf(zsh).$(".orca-tab-btn").click();
      await $(".orca-term .orca-term-box:not([hidden]) .xterm-screen").click();
      await browser.keys(["l"]);
      await waitForCalls(input);
      await expect($(CARD)).toHaveText("宛先のターミナルは終了したか、見つかりません。一覧を読み直してください");
    });

    const iconOf = (id: string) => browser.execute((tab) => {
      const icon = document.querySelector<HTMLElement>(`.orca-tabs [data-tab="${tab}"] .orca-ic`);
      return icon === null ? null : [icon.dataset.status, icon.getAttribute("aria-label")];
    }, id);
    const endedList = () => orcaOverview(sample(), [...worktrees(), orcaWorktree("example-idle", "main")], { terminals: [orcaTerminal("example-app", "zsh", { ended: true })] });

    it("draws a terminal that Orca says ended as ended: a gray mark and 「終了」, one line, no read and no key", async () => {
      await openOrca(endedList());
      const read = await mock("orca_terminal_read", ["$"]);
      const input = await mock("orca_terminal_input", null);
      await project("example-app").click();
      expect(await iconOf(zsh)).toEqual(["interrupted", "終了"]);
      await tabOf(zsh).$(".orca-tab-btn").click();
      await browser.waitUntil(async () => (await screenText()).includes("ターミナルは終了しました"), { timeoutMsg: "the line of the end never showed" });
      await $(".orca-term .orca-term-box:not([hidden]) .xterm-screen").click();
      await browser.keys(["c", "d"]);
      await browser.pause(1500);
      // The project's first tab is the session `sample()` has (its own handle), which is mirrored until the zsh tab is chosen: only the ended terminal's handle must never be read.
      expect((await callsOf(read)).filter((c) => (c as { handle: string }).handle === "term_example-app_zsh")).toEqual([]);
      expect(await callsOf(input)).toEqual([]);
      expect(await count(CARD)).toBe(0);
      expect((await screenText()).split("ターミナルは終了しました").length).toBe(2);
    });

    it("takes the refusal of its keys as its end, with no card", async () => {
      await openOrca(withTerminals());
      await mock("orca_terminal_read", ["$"]);
      const input = await mock("orca_terminal_input", rejects("Orca がエラーを返しました（terminal_not_writable）"));
      await project("example-app").click();
      await tabOf(zsh).$(".orca-tab-btn").click();
      await $(".orca-term .orca-term-box:not([hidden]) .xterm-screen").click();
      await browser.keys(["l"]);
      await waitForCalls(input);
      await browser.waitUntil(async () => JSON.stringify(await iconOf(zsh)) === JSON.stringify(["interrupted", "終了"]), { timeoutMsg: "the tab never showed the end" });
      expect(await count(CARD)).toBe(0);
      await browser.keys(["m"]);
      await browser.pause(500);
      expect((await callsOf(input)).length).toBe(1);
    });
  });
});

describe("orca: a saved environment's stream", () => {
  const studioOnly = { target: "Studio", environments: ["Studio"] };
  // The calls of a command that takes a channel, with the channel (which cannot cross the driver as it is) as `true`.
  const channelCalls = (command: string) =>
    browser.execute((c) => ((window as unknown as { __e2e_calls__: Record<string, { channel?: unknown }[]> }).__e2e_calls__[c] ?? []).map((call) => ({ ...call, channel: !!call.channel })), command);
  // The Orca screen with Studio as the target, its list streamed once.
  async function openStudio(rows = sample(), terminals: ReturnType<typeof orcaTerminal>[] = []) {
    await openOrca(orcaOverview([], [], studioOnly));
    await waitForCalls("orca_stream_open");
    await sendStream(streamList(rows, worktrees(), terminals));
  }
  const viewportOf = (call: unknown) => (call as { viewport: { cols: number; rows: number } }).viewport;

  it("opens the stream of the saved environment, draws each list it sends, and reads nothing by the clock", async () => {
    await openOrca(orcaOverview([], [], studioOnly), timers({ orcaClock: 1000 }));
    expect(await channelCalls("orca_stream_open")).toEqual([{ environment: "Studio", channel: true }]);
    await sendStream(streamList(sample(), worktrees()));
    await waitForCount("#orca-feed .orca-project", 4);
    // The row that waits, and the finished one: the first read of Studio (at startup) had no rows, so it first appeared in a later read already stopped.
    await expect($("#nav-orca .nav-count")).toHaveText("2");
    // The next list replaces it.
    await sendStream(streamList([working("example-app"), finished("example-api")], worktrees()));
    await waitForCount("#orca-feed .orca-project", 2);
    // The clock reads this screen every 10 seconds (1 second here); a streamed list is not read.
    const overview = await mock("orca_overview", orcaOverview([], [], studioOnly));
    await browser.pause(1200);
    expect(await callsOf(overview)).toEqual([]);
  });

  it("says a lost connection, keeps the rows, and is live again with the next list", async () => {
    await openStudio();
    await sendStream({ kind: "status", live: false, message: "Studio is unreachable" });
    await expect($("#orca-notice")).toHaveText("Studio を読み込めませんでした: Studio is unreachable");
    expect(await count("#orca-feed .orca-project")).toBe(4);
    await sendStream(streamList(sample(), worktrees()));
    await browser.waitUntil(async () => (await textsOf("#orca-notice")).join() === "", { timeoutMsg: "the notice never went" });
  });

  it("streams the terminal of the selected tab at the pane's size, draws what it sends, and sends the keys typed", async () => {
    await openStudio();
    await project("example-app").click();
    const [call] = await waitForCalls("orca_stream_terminal");
    expect(call).toMatchObject({ handle: "term_example-app" });
    expect(viewportOf(call).cols).toBeGreaterThan(20);
    expect(viewportOf(call).rows).toBeGreaterThan(8);
    expect((await channelCalls("orca_stream_terminal"))[0].channel).toBe(true);
    // No mirror for a streamed terminal.
    expect(await callsOf("orca_terminal_read")).toEqual([]);
    await sendTerm({ kind: "snapshot", data: "$ claude\r\n> Write the docs", cols: 80, rows: 24 });
    await browser.waitUntil(async () => (await screenText()).includes("Write the docs"), { timeoutMsg: "the screen never showed" });
    await sendTerm({ kind: "output", data: "\r\nDone." });
    await browser.waitUntil(async () => (await screenText()).includes("Done."), { timeoutMsg: "the output never showed" });
    const input = await mock("orca_stream_input", null);
    await $(".orca-term .orca-term-box:not([hidden]) .xterm-screen").click();
    // A digit: the driver gives a letter the keyCode of its character, and xterm.js reads the keyCode of p to z as a function key (y is F10).
    await browser.keys(["1", "Enter"]);
    await browser.waitUntil(async () => (await callsOf(input)).map((c) => (c as { text: string }).text).join("") === "1\r", { timeoutMsg: "the keys were not sent" });
    expect((await callsOf(input)).every((c) => (c as { handle: string }).handle === "term_example-app")).toBe(true);
  });

  it("sends the keys not sent yet to the terminal they were typed in when another tab shows", async () => {
    await openStudio(sample(), [orcaTerminal("example-app", "zsh")]);
    await project("example-app").click();
    await waitForCalls("orca_stream_terminal");
    const input = await mock("orca_stream_input", holds);
    await $(".orca-term .orca-term-box:not([hidden]) .xterm-screen").click();
    await browser.keys(["1"]);
    await waitForCalls(input);
    // Typed while the first send is on its way: they wait for it.
    await browser.keys(["2", "Enter"]);
    await browser.pause(300);
    expect(await callsOf(input)).toHaveLength(1);
    await tabOf("orca:term_example-app_zsh").$(".orca-tab-btn").click();
    await waitForCalls("orca_stream_terminal", 2);
    await release(input, null);
    await browser.waitUntil(async () => (await callsOf(input)).length === 2, { timeoutMsg: "the keys typed before the tab changed were not sent" });
    // All of them go to the terminal they were typed in, not to the one now shown.
    expect(await callsOf(input)).toEqual([
      { environment: "Studio", handle: "term_example-app", text: "1", viewport: PANE },
      // The terminal is not shown any more: its keys name no size.
      { environment: "Studio", handle: "term_example-app", text: "2\r", viewport: null },
    ]);
    await release(input, null);
  });

  it("shows the message when the keys cannot be sent", async () => {
    await openStudio();
    await project("example-app").click();
    await waitForCalls("orca_stream_terminal");
    const input = await mock("orca_stream_input", rejects("接続先につながっていません"));
    await $(".orca-term .orca-term-box:not([hidden]) .xterm-screen").click();
    await browser.keys(["y"]);
    await waitForCalls(input);
    await expect($(CARD)).toHaveText("接続先につながっていません");
  });

  // The OSC 52 request of a program (the ESC ] 52 ; target ; base64 BEL), as Claude Code makes it for what its mouse selection covers.
  const osc52 = (text: string, target = "c") => `\x1b]52;${target};${Buffer.from(text).toString("base64")}\x07`;
  // The streamed terminal of example-app shown, with the clipboard stubbed.
  async function openCopy() {
    await openStudio();
    await project("example-app").click();
    await waitForCalls("orca_stream_terminal");
    await stubClipboard();
  }
  // Waits until the output after the requests (the screen draws in order, so the earlier ones have been handled) has been parsed.
  const sendMark = async (mark: string) => {
    await sendTerm({ kind: "output", data: `\r\n${mark}` });
    await browser.waitUntil(async () => (await screenText()).includes(mark), { timeoutMsg: `${mark} never showed` });
  };

  it("writes the clipboard with the text of an OSC 52 request from the output, for the target c and for none", async () => {
    await openCopy();
    await sendTerm({ kind: "output", data: osc52("Cooked for 1m 56s\n二行目") });
    await browser.waitUntil(async () => (await copiedTexts()).length === 1, { timeoutMsg: "the clipboard was never written" });
    await sendTerm({ kind: "output", data: osc52("no target", "") });
    await browser.waitUntil(async () => (await copiedTexts()).length === 2, { timeoutMsg: "the request with no target was never written" });
    expect(await copiedTexts()).toEqual(["Cooked for 1m 56s\n二行目", "no target"]);
  });

  it("writes nothing for an OSC 52 request that comes with a snapshot, and writes the next one from the output", async () => {
    await openCopy();
    await sendTerm({ kind: "snapshot", data: `${osc52("from the snapshot")}snapshot screen`, cols: 80, rows: 24 });
    await browser.waitUntil(async () => (await screenText()).includes("snapshot screen"), { timeoutMsg: "the snapshot never showed" });
    await sendTerm({ kind: "output", data: osc52("from the output") });
    await browser.waitUntil(async () => (await copiedTexts()).length > 0, { timeoutMsg: "the clipboard was never written" });
    await sendMark("done");
    expect(await copiedTexts()).toEqual(["from the output"]);
  });

  it("writes nothing for a request that is a read, has another target, an empty or a too long text, or text that is not base64", async () => {
    await openCopy();
    const limit = 128 * 1024;
    const requests = [
      "\x1b]52;c;?\x07",
      osc52("primary", "p"),
      "\x1b]52;c;\x07",
      "\x1b]52;c;!!not base64!!\x07",
      "\x1b]52;c;QUJD=RA==\x07",
      "\x1b]52;c\x07",
      `\x1b]52;c;${"QUJD".repeat(limit / 4 + 1)}\x07`,
    ];
    for (const data of requests) await sendTerm({ kind: "output", data });
    // One that is just inside the limit is written, so the refusals above are not a copy that never works.
    await sendTerm({ kind: "output", data: `\x1b]52;c;${"QUJD".repeat(limit / 4)}\x07` });
    await browser.waitUntil(async () => (await copiedTexts()).length > 0, { timeoutMsg: "the clipboard was never written" });
    await sendMark("done");
    expect(await copiedTexts()).toEqual(["ABC".repeat(limit / 4)]);
  });

  // The clipboard refuses every write (as WKWebView may for a write outside a user action); the number of writes tried is `refusals()`.
  const refuseClipboard = () =>
    browser.execute(() => {
      const w = window as unknown as { __e2e_refused__: number };
      w.__e2e_refused__ = 0;
      Object.defineProperty(navigator, "clipboard", {
        configurable: true,
        value: {
          writeText: async () => {
            w.__e2e_refused__++;
            throw new Error("denied");
          },
        },
      });
    });
  const refusals = () => browser.execute(() => (window as unknown as { __e2e_refused__: number }).__e2e_refused__);
  // A copy event on the terminal shown, as ⌘C makes it (the event holds a stand-in for the clipboard): what was put in it, and whether the page took the copy.
  const copyEvent = () =>
    browser.execute(() => {
      const data: Record<string, string> = {};
      const event = new Event("copy", { bubbles: true, cancelable: true });
      Object.defineProperty(event, "clipboardData", {
        value: {
          setData: (type: string, value: string) => {
            data[type] = value;
          },
        },
      });
      document.querySelector(".orca-term-box:not([hidden]) .xterm-helper-textarea")!.dispatchEvent(event);
      return { data, taken: event.defaultPrevented };
    });

  it("writes only the last of the OSC 52 requests of one chunk, and leaves the next copy event to xterm.js once the clipboard took it", async () => {
    await openCopy();
    await sendTerm({ kind: "output", data: osc52("first") + osc52("last") });
    await browser.waitUntil(async () => (await copiedTexts()).length > 0, { timeoutMsg: "the clipboard was never written" });
    await sendMark("done");
    expect(await copiedTexts()).toEqual(["last"]);
    expect(await copyEvent()).toEqual({ data: {}, taken: false });
  });

  it("holds the text of an OSC 52 request that the clipboard refused, with no message, and gives it to the next copy event only", async () => {
    await openCopy();
    await refuseClipboard();
    await sendTerm({ kind: "output", data: osc52("first") + osc52("held text") });
    await browser.waitUntil(async () => (await refusals()) > 0, { timeoutMsg: "the write was never tried" });
    await sendMark("done");
    expect(await refusals()).toBe(1);
    await expect($(CARDS)).not.toExist();
    expect(await copyEvent()).toEqual({ data: { "text/plain": "held text" }, taken: true });
    expect(await copyEvent()).toEqual({ data: {}, taken: false });
  });

  it("keeps the held text through a mouse mode and the alternate screen, which Claude Code sends often", async () => {
    await openCopy();
    await refuseClipboard();
    await sendTerm({ kind: "output", data: osc52("held text") });
    await browser.waitUntil(async () => (await refusals()) > 0, { timeoutMsg: "the write was never tried" });
    await sendTerm({ kind: "output", data: "\x1b[?1003h\x1b[?1049h" });
    await sendMark("done");
    expect(await copyEvent()).toEqual({ data: { "text/plain": "held text" }, taken: true });
  });

  it("drops the held text when a snapshot draws the screen again", async () => {
    await openCopy();
    await refuseClipboard();
    await sendTerm({ kind: "output", data: osc52("held text") });
    await browser.waitUntil(async () => (await refusals()) > 0, { timeoutMsg: "the write was never tried" });
    await sendTerm({ kind: "snapshot", data: "snapshot screen", cols: 80, rows: 24 });
    await browser.waitUntil(async () => (await screenText()).includes("snapshot screen"), { timeoutMsg: "the snapshot never showed" });
    expect(await copyEvent()).toEqual({ data: {}, taken: false });
  });

  // The terminal of example-app shown and its pane's size (what it subscribed with), with the pane's rows drawn.
  async function openSized() {
    await openStudio();
    await project("example-app").click();
    const [call] = await waitForCalls("orca_stream_terminal");
    // Showing the pane makes the terminal fit it once more: the ResizeObserver tells (a frame later), and the fit waits FIT_DELAY_MS (50 ms) of ts/orca-terminal.ts. Let that fit pass, or it moves the size a snapshot draws.
    await browser.pause(300);
    return viewportOf(call);
  }
  const rowsDrawn = () => browser.execute(() => document.querySelectorAll(".orca-term .orca-term-box:not([hidden]) .xterm-rows > div").length);
  const drawnRows = async (rows: number) => browser.waitUntil(async () => (await rowsDrawn()) === rows, { timeoutMsg: `the terminal never drew ${rows} rows` });

  it("fits the pane after a snapshot, and claims the pane's size when Orca had another", async () => {
    const pane = await openSized();
    const claim = await mock("orca_stream_viewport", null);
    await sendTerm({ kind: "snapshot", data: "from the snapshot", cols: pane.cols + 7, rows: pane.rows + 3 });
    await browser.waitUntil(async () => (await screenText()).includes("from the snapshot"), { timeoutMsg: "the screen never showed" });
    await drawnRows(pane.rows);
    expect(await waitForCalls(claim)).toMatchObject([{ environment: "Studio", handle: "term_example-app", viewport: pane }]);
    // A snapshot at the pane's size claims nothing.
    await sendTerm({ kind: "snapshot", data: "same size", cols: pane.cols, rows: pane.rows });
    await browser.waitUntil(async () => (await screenText()).includes("same size"), { timeoutMsg: "the screen never showed" });
    await browser.pause(300);
    expect(await callsOf(claim)).toHaveLength(1);
  });

  it("gives the terminal the size of another desktop's window, or of a phone, and does not fit it to the pane", async () => {
    const pane = await openSized();
    const claim = await mock("orca_stream_viewport", null);
    await sendTerm({ kind: "size", mode: "remote-desktop-fit", cols: 90, rows: pane.rows + 5 });
    await drawnRows(pane.rows + 5);
    await sendTerm({ kind: "size", mode: "mobile-fit", cols: 40, rows: pane.rows + 2 });
    await drawnRows(pane.rows + 2);
    await browser.pause(300);
    expect(await callsOf(claim)).toEqual([]);
  });

  it("fits the pane on desktop-fit, with sizes of 0 too, and claims the pane's size when Orca has another", async () => {
    const pane = await openSized();
    const claim = await mock("orca_stream_viewport", null);
    await sendTerm({ kind: "size", mode: "remote-desktop-fit", cols: 90, rows: pane.rows + 5 });
    await drawnRows(pane.rows + 5);
    await sendTerm({ kind: "size", mode: "desktop-fit", cols: 0, rows: 0 });
    await drawnRows(pane.rows);
    expect(await waitForCalls(claim)).toMatchObject([{ environment: "Studio", handle: "term_example-app", viewport: pane }]);
    // Orca has the pane's size now: nothing to claim (a size that is not the pane's is claimed once more, after a second).
    await sendTerm({ kind: "size", mode: "desktop-fit", cols: pane.cols, rows: pane.rows });
    await browser.pause(300);
    expect(await callsOf(claim)).toHaveLength(1);
  });

  it("takes the size back when the pane changes while another desktop holds it, and never from a phone", async () => {
    const pane = await openSized();
    await focusWindow();
    await sendTerm({ kind: "size", mode: "remote-desktop-fit", cols: 90, rows: pane.rows + 5 });
    await drawnRows(pane.rows + 5);
    const claim = await mock("orca_stream_viewport", null);
    // The list narrows to 15%, so the terminal widens: the pane's size is claimed.
    await dragDivider(0.15);
    const [sent] = await waitForCalls(claim);
    expect(viewportOf(sent).cols).toBeGreaterThan(pane.cols);
    await drawnRows(viewportOf(sent).rows);
    await browser.pause(300);
    const claimed = (await callsOf(claim)).length;
    // A phone holds it: the pane changes, and the terminal stays at the phone's size.
    await sendTerm({ kind: "size", mode: "mobile-fit", cols: 40, rows: pane.rows + 2 });
    await drawnRows(pane.rows + 2);
    await dragDivider(0.3);
    await browser.pause(400);
    expect(await callsOf(claim)).toHaveLength(claimed);
    expect(await rowsDrawn()).toBe(pane.rows + 2);
  });

  it("sends the new size when the pane changes", async () => {
    await openStudio();
    await project("example-app").click();
    const [call] = await waitForCalls("orca_stream_terminal");
    await focusWindow();
    const viewport = await mock("orca_stream_viewport", null);
    // The list narrows to 15%, so the terminal widens.
    await dragDivider(0.15);
    const [sent] = await waitForCalls(viewport);
    expect(viewportOf(sent).cols).toBeGreaterThan(viewportOf(call).cols);
    expect(viewportOf(sent).rows).toBe(viewportOf(call).rows);
  });

  it("ends the stream of the tab left and subscribes the other, and ends the stream of the terminal when another screen or a hidden window shows", async () => {
    await openStudio(sample(), [orcaTerminal("example-app", "zsh")]);
    await project("example-app").click();
    await waitForCalls("orca_stream_terminal");
    const close = await mock("orca_stream_terminal_close", null);
    const subscribe = await mock("orca_stream_terminal", null);
    // Another tab: its terminal is subscribed, and the one left is closed by its handle (a close names its terminal, so it ends no other stream).
    await tabOf("orca:term_example-app_zsh").$(".orca-tab-btn").click();
    expect(await waitForCalls(subscribe)).toMatchObject([{ handle: "term_example-app_zsh" }]);
    expect(await waitForCalls(close)).toEqual([{ environment: "Studio", handle: "term_example-app", generation: expect.any(Number) }]);
    // Another screen.
    await $("#nav-mail").click();
    await waitForCalls(close, 2);
    expect((await callsOf(close))[1]).toEqual({ environment: "Studio", handle: "term_example-app_zsh", generation: expect.any(Number) });
    // Back on the screen the stream starts again, and a hidden window ends it. Showing the screen reads the list once with the CLI, which holds what the stream sent.
    await mock("orca_overview", orcaOverview(sample(), worktrees(), { ...studioOnly, terminals: [orcaTerminal("example-app", "zsh")] }));
    await $("#nav-orca").click();
    await waitForCalls(subscribe, 2);
    await setWindowHidden(true);
    await waitForCalls(close, 3);
    await setWindowHidden(false);
    await waitForCalls(subscribe, 3);
  });

  it("ends the stream of the tab that leaves the list and subscribes the next tab", async () => {
    await openStudio();
    await project("example-app").click();
    await waitForCalls("orca_stream_terminal");
    const close = await mock("orca_stream_terminal_close", null);
    const subscribe = await mock("orca_stream_terminal", null);
    // The Claude row of the tab shown goes and the project keeps a shell: the tab and its terminal are dropped, with a close of its stream, and the shell is subscribed.
    await sendStream(streamList(sample().slice(1), worktrees(), [orcaTerminal("example-app", "zsh")]));
    expect(await waitForCalls(subscribe)).toMatchObject([{ handle: "term_example-app_zsh" }]);
    expect(await waitForCalls(close)).toEqual([{ environment: "Studio", handle: "term_example-app", generation: expect.any(Number) }]);
  });

  it("ends the stream of the terminal when the tab shown leaves the list and no tab is left to show", async () => {
    await openStudio();
    await project("example-app").click();
    await waitForCalls("orca_stream_terminal");
    const close = await mock("orca_stream_terminal_close", null);
    await sendStream(streamList(sample().slice(1), worktrees()));
    expect(await waitForCalls(close)).toEqual([{ environment: "Studio", handle: "term_example-app", generation: expect.any(Number) }]);
  });

  it("closes a session in Orca and leaves the tab to the next list, with no read", async () => {
    await openStudio();
    await project("example-app").click();
    const close = await mock("orca_close", null);
    const overview = await mock("orca_overview", orcaOverview([], [], studioOnly));
    await tabOf(claudeTab("example-app")).$(".orca-tab-close").click();
    expect(await waitForCalls(close)).toEqual([{ handle: "term_example-app", environment: "Studio" }]);
    await browser.pause(1500);
    expect(await callsOf(overview)).toEqual([]);
    await sendStream(streamList(sample().slice(1), worktrees()));
    await expect($(".orca-empty")).toHaveText("セッションはありません");
  });

  it("ends the stream of the list when a read names this machine as the target", async () => {
    await openStudio();
    const close = await mock("orca_stream_close", null);
    await mock("orca_overview", orcaOverview(sample(), worktrees(), { environments: ["Studio"] }));
    await showAgain();
    await waitForCalls(close);
    // An event of the old stream is not drawn.
    await sendStream(streamList([], worktrees()));
    await browser.pause(300);
    expect(await count("#orca-feed .orca-project")).toBe(4);
  });
});

// The terminal of the Claude session of example-app (this machine's mirror), shown with the given fixtures; the answer of the command that takes its keys is the returned name.
async function openTerminal(fixtures: Record<string, unknown> = {}) {
  await openOrca(orcaOverview(sample(), worktrees()), fixtures);
  await mock("orca_terminal_read", ["$ ls"]);
  const input = await mock("orca_terminal_input", null);
  await project("example-app").click();
  await browser.waitUntil(async () => (await screenText()).includes("$ ls"), { timeoutMsg: "the screen never showed" });
  return input;
}

// What xterm.js draws the terminal with (the only one made), and the pane around it.
const look = () =>
  browser.execute(() => {
    const rows = document.querySelector(".orca-term-box .xterm-rows")!;
    const style = getComputedStyle(rows);
    const span = rows.querySelector("span");
    return {
      size: style.fontSize,
      family: style.fontFamily,
      color: style.color,
      weight: span ? getComputedStyle(span).fontWeight : null,
      pane: getComputedStyle(document.querySelector(".orca-term")!).backgroundColor,
    };
  });

// A-12: this machine's Orca streams its list and its terminals once the owner has paired the app with it; without a pairing, or while its stream cannot connect, the list is read by the clock and the terminals are mirrors.
describe("orca: this machine's stream once it is paired (A-12)", () => {
  const pairing = { orca_pairing_status: { paired: true } };
  const channelCalls = (command: string) =>
    browser.execute((c) => ((window as unknown as { __e2e_calls__: Record<string, { channel?: unknown }[]> }).__e2e_calls__[c] ?? []).map((call) => ({ ...call, channel: !!call.channel })), command);
  // The Orca screen of this machine with its list streamed once; `fixtures` is added to the paired one.
  async function openPaired(fixtures: Record<string, unknown> = {}) {
    await openOrca(orcaOverview([], []), { ...pairing, ...fixtures });
    await waitForCalls("orca_stream_open");
    await sendStream(streamList(sample(), worktrees(), [], null));
    await waitForCount("#orca-feed .orca-project", 4);
  }

  it("opens the stream of this machine, draws each list it sends, and reads nothing by the clock", async () => {
    await openOrca(orcaOverview([], []), { ...pairing, ...timers({ orcaClock: 1000 }) });
    await waitForCalls("orca_stream_open");
    expect(await channelCalls("orca_stream_open")).toEqual([{ environment: null, channel: true }]);
    await sendStream(streamList(sample(), worktrees(), [], null));
    await waitForCount("#orca-feed .orca-project", 4);
    await sendStream(streamList([working("example-app")], worktrees(), [], null));
    await waitForCount("#orca-feed .orca-project", 1);
    const overview = await mock("orca_overview", orcaOverview([], []));
    await browser.pause(1200);
    expect(await callsOf(overview)).toEqual([]);
  });

  it("opens no stream without a pairing, and reads the list by the clock", async () => {
    await openOrca(orcaOverview(sample(), worktrees()), timers({ orcaClock: 1000 }));
    await waitForCalls("orca_pairing_status");
    const overview = await mock("orca_overview", orcaOverview(sample(), worktrees()));
    await waitForCalls(overview);
    expect(await callsOf("orca_stream_open")).toEqual([]);
  });

  it("streams the terminal of the selected tab and reads none of it through the CLI", async () => {
    await openPaired();
    await project("example-app").click();
    const [call] = await waitForCalls("orca_stream_terminal");
    expect(call).toMatchObject({ handle: "term_example-app" });
    expect(await callsOf("orca_terminal_read")).toEqual([]);
    await sendTerm({ kind: "snapshot", data: "\x1b[31m$ claude\x1b[0m\r\n> Write the docs", cols: 80, rows: 24 });
    await browser.waitUntil(async () => (await $(".orca-term .orca-term-box:not([hidden]) .xterm-rows").getText()).includes("Write the docs"), { timeoutMsg: "the screen never showed" });
    const input = await mock("orca_stream_input", null);
    await $(".orca-term .orca-term-box:not([hidden]) .xterm-screen").click();
    await browser.keys(["1", "Enter"]);
    await browser.waitUntil(async () => (await callsOf(input)).map((c) => (c as { text: string }).text).join("") === "1\r", { timeoutMsg: "the keys were not sent" });
  });

  it("shows a terminal that ended before it was subscribed as ended, with no failure and no mirror", async () => {
    await openPaired(timers({ orcaMirror: 500 }));
    await project("example-app").click();
    await waitForCalls("orca_stream_terminal");
    await sendTerm({ kind: "ended", message: "" });
    await browser.waitUntil(async () => (await $(".orca-term .orca-term-box:not([hidden]) .xterm-rows").getText()).includes("ターミナルとのつながりが終わりました"), { timeoutMsg: "the end never showed" });
    await browser.pause(700);
    expect(await callsOf("orca_terminal_read")).toEqual([]);
    await expect($(CARD)).not.toExist();
    await expect($("#orca-notice")).toHaveText("");
    expect(await callsOf("orca_stream_open")).toHaveLength(1);
  });

  it("falls back to the clock and the mirror, with no failure said, while the stream is lost, and streams again with its next list", async () => {
    await openPaired(timers({ orcaClock: 1000 }));
    await project("example-app").click();
    await waitForCalls("orca_stream_terminal");
    const read = await mock("orca_terminal_read", ["$ pwd", "/work/example-app"]);
    const overview = await mock("orca_overview", orcaOverview(sample(), worktrees()));
    await sendStream({ kind: "status", live: false, message: "接続先につながっていません" });
    await waitForCalls(overview);
    await waitForCalls(read);
    await browser.waitUntil(async () => (await $(".orca-term .orca-term-box:not([hidden]) .xterm-rows").getText()).includes("/work/example-app"), { timeoutMsg: "the mirror never showed" });
    await expect($("#orca-notice")).toHaveText("");
    expect(await count("#orca-feed .orca-project")).toBe(4);
    await sendStream(streamList(sample(), worktrees(), [], null));
    await waitForCalls("orca_stream_terminal", 2);
  });

  it("falls back the same way when the stream cannot be opened", async () => {
    await openOrca(orcaOverview(sample(), worktrees()), { ...pairing, orca_stream_open: rejects("このマシンの Orca とペアリングしていません"), ...timers({ orcaClock: 1000 }) });
    await waitForCalls("orca_stream_open");
    const overview = await mock("orca_overview", orcaOverview(sample(), worktrees()));
    await waitForCalls(overview);
    await expect($("#orca-notice")).toHaveText("");
    await project("example-app").click();
    const read = await mock("orca_terminal_read", ["$ ls"]);
    await waitForCalls(read);
    expect(await callsOf("orca_stream_terminal")).toEqual([]);
  });

  it("starts the stream when a pairing is saved in the settings, and ends it when it is revoked", async () => {
    await openOrca(orcaOverview(sample(), worktrees()));
    await waitForCalls("orca_pairing_status");
    expect(await callsOf("orca_stream_open")).toEqual([]);
    await $("#nav-settings").click();
    await $("#settings-tab-orca").click();
    await mock("orca_pairing_save", { paired: true });
    await mock("orca_pairing_status", { paired: true });
    await $("#orca-pairing-link").setValue("orca://pair?code=example");
    await $("#orca-pairing-save").click();
    await waitForCalls("orca_pairing_save");
    await waitForCalls("orca_stream_open");
    expect(await channelCalls("orca_stream_open")).toEqual([{ environment: null, channel: true }]);
    await mock("orca_pairing_revoke", { paired: false });
    await mock("orca_pairing_status", { paired: false });
    await $('#orca-pairing-items [aria-label="ペアリングを取り消す"]').click();
    await waitForCalls("orca_stream_close");
  });
});

describe("orca: Ghostty's settings in the terminals (A-13)", () => {
  const colors = { background: "#112233", foreground: "#ddeeff", cursor: null, cursorAccent: null, selectionBackground: null, selectionForeground: null, palette: [{ index: 1, color: "#ff0000" }] };
  // Imported settings with a font, colors for both appearances (so the system's does not matter) and two keys.
  const saved = ghosttyImport({
    settings: {
      fontFamilies: ["Example Mono"],
      fontSize: 15,
      fontThicken: true,
      light: colors,
      dark: colors,
      keybinds: [
        { key: "Delete", shift: false, ctrl: false, alt: false, meta: false, text: "\x08" },
        { key: "Enter", shift: false, ctrl: true, alt: false, meta: false, text: "\n" },
      ],
    },
  });

  // A keydown on the terminal shown, as the key event xterm.js listens for.
  const press = (init: KeyboardEventInit) =>
    browser.execute(
      (id, i) => {
        if (!window.__e2e_once__(id)) return;
        document.querySelector(".orca-term-box:not([hidden]) .xterm-helper-textarea")!.dispatchEvent(new KeyboardEvent("keydown", { bubbles: true, cancelable: true, ...i }));
      },
      onceId(),
      init,
    );

  it("keeps the app's own font until something is imported", async () => {
    await openTerminal();
    const own = await look();
    expect(own.size).toBe("13px");
    expect(own.family).not.toContain("Example Mono");
    expect(own.weight).toBe("400");
  });

  it("draws the terminal with the font of the import saved before", async () => {
    await openTerminal({ ghostty_saved: saved });
    expect(await look()).toMatchObject({ size: "15px", weight: "500" });
    expect((await look()).family).toContain("Example Mono");
  });

  it("draws the terminals again with an import made in the settings, with no restart", async () => {
    await openTerminal();
    await $("#nav-settings").click();
    await $("#settings-tab-orca").click();
    const imported = await mock("ghostty_import", saved);
    await $("#ghostty-import").click();
    await waitForCalls(imported);
    await $("#nav-orca").click();
    await browser.waitUntil(async () => (await look()).size === "15px", { timeoutMsg: "the terminal never took the font" });
    expect((await look()).family).toContain("Example Mono");
  });

  it("sends the text of a key of the import in place of the key", async () => {
    const input = await openTerminal({ ghostty_saved: saved });
    await press({ key: "Delete" });
    expect(await waitForCalls(input)).toEqual([{ handle: "term_example-app", text: "\x08" }]);
    await press({ key: "Enter", ctrlKey: true });
    await waitForCalls(input, 2);
    expect(await callsOf(input)).toEqual([
      { handle: "term_example-app", text: "\x08" },
      { handle: "term_example-app", text: "\n" },
    ]);
  });

  it("sends a newline for Shift+Enter, with or without an import", async () => {
    const input = await openTerminal();
    await press({ key: "Enter", shiftKey: true });
    expect(await waitForCalls(input)).toEqual([{ handle: "term_example-app", text: "\x1b\r" }]);
  });

  it("matches an Alt key by its physical key, since Option makes another character on macOS", async () => {
    const altB = { key: "b", shift: false, ctrl: false, alt: true, meta: false, text: "\x1bb" };
    const input = await openTerminal({ ghostty_saved: ghosttyImport({ settings: { ...saved.settings, keybinds: [altB] } }) });
    // Option+B makes ∫ on a US keyboard; the physical key is KeyB.
    await press({ key: "∫", code: "KeyB", altKey: true });
    expect(await waitForCalls(input)).toEqual([{ handle: "term_example-app", text: "\x1bb" }]);
  });

  it("lets a key of the import for Shift+Enter take the place of the newline", async () => {
    const shiftEnter = { key: "Enter", shift: true, ctrl: false, alt: false, meta: false, text: "\n" };
    const input = await openTerminal({ ghostty_saved: ghosttyImport({ settings: { ...saved.settings, keybinds: [shiftEnter] } }) });
    await press({ key: "Enter", shiftKey: true });
    expect(await waitForCalls(input)).toEqual([{ handle: "term_example-app", text: "\n" }]);
  });
});

// A-20: the fonts chosen in the settings. The terminals take the family and the size of the choice in place of Ghostty's, until the choice follows Ghostty again.
describe("orca: the fonts of the screens (A-20)", () => {
  const imported = ghosttyImport({ settings: { fontFamilies: ["Example Mono"], fontSize: 15, fontThicken: true, light: null, dark: null, keybinds: [] } });
  const menlo = fontSettings({ orcaWork: { family: "Menlo", size: 18, ghostty: false } });

  it("draws the terminal with the family and size chosen, with the app's own after them and no thickening", async () => {
    await openTerminal({ ghostty_saved: imported, font_settings: menlo });
    await browser.waitUntil(async () => (await look()).size === "18px", { timeoutMsg: "the terminal never took the size" });
    const chosen = await look();
    expect(chosen.family).toContain("Menlo");
    expect(chosen.family).not.toContain("Example Mono");
    expect(chosen.weight).toBe("400");
  });

  it("keeps Ghostty's font while the choice follows it, whatever family and size the choice holds", async () => {
    await openTerminal({ ghostty_saved: imported, font_settings: fontSettings({ orcaWork: { family: "Menlo", size: 18, ghostty: true } }) });
    expect(await look()).toMatchObject({ size: "15px", weight: "500" });
    expect((await look()).family).toContain("Example Mono");
  });

  it("draws the terminals again with a font chosen in the settings, with no restart, and with Ghostty's again when it is chosen", async () => {
    await openTerminal({ ghostty_saved: imported });
    expect((await look()).size).toBe("15px");
    await $("#nav-settings").click();
    await $("#settings-tab-font").click();
    const set = await mock("font_settings_set", menlo);
    await chooseOption("font-orca-work-family", "family:Menlo");
    await waitForCalls(set);
    await $("#nav-orca").click();
    await browser.waitUntil(async () => (await look()).size === "18px", { timeoutMsg: "the terminal never took the font" });
    expect((await look()).family).toContain("Menlo");
    await $("#nav-settings").click();
    const back = await mock("font_settings_set", fontSettings({ orcaWork: { family: "Menlo", size: 18, ghostty: true } }));
    await chooseOption("font-orca-work-family", "ghostty");
    await waitForCalls(back);
    await $("#nav-orca").click();
    await browser.waitUntil(async () => (await look()).size === "15px", { timeoutMsg: "the terminal never took Ghostty's font again" });
    expect((await look()).family).toContain("Example Mono");
  });

  it("draws the project list with its own family and size, and the work space of the terminals apart", async () => {
    await openOrca(orcaOverview(sample(), worktrees()), { font_settings: fontSettings({ orcaList: { family: "Menlo", size: 21, ghostty: false } }) });
    const listSize = () => browser.execute(() => getComputedStyle(document.getElementById("orca-list")!).fontSize);
    await browser.waitUntil(async () => (await listSize()) === "21px", { timeoutMsg: "the list never took the size" });
    expect(await browser.execute(() => getComputedStyle(document.getElementById("orca-work")!).fontSize)).toBe("14px");
    expect(await browser.execute(() => getComputedStyle(document.getElementById("orca-list")!).fontFamily)).toContain("Menlo");
  });

  // The family and the size (in pixels) the page draws the element `id` with.
  const drawn = (id: string) =>
    browser.execute((i) => {
      const style = getComputedStyle(document.getElementById(i)!);
      return { size: style.fontSize, family: style.fontFamily };
    }, id);
  const rootVar = (name: string) => browser.execute((n) => document.documentElement.style.getPropertyValue(n), name);

  it("draws the chat and the file pane with the family and size chosen for the pane, apart from the project list and the terminals", async () => {
    await openOrca(orcaOverview(sample(), worktrees()), { font_settings: fontSettings({ orcaPane: { family: "Menlo", size: 21, ghostty: false } }) });
    await browser.waitUntil(async () => (await drawn("orca-work")).size === "21px", { timeoutMsg: "the work pane never took the size" });
    expect((await drawn("orca-work")).family).toContain("Menlo");
    expect(await drawn("orca-files")).toEqual(await drawn("orca-work"));
    // The heading of the file pane is 12px of its own: 12 * 21 / 14.
    expect((await drawn("orca-files-title")).size).toBe("18px");
    expect(await drawn("orca-list")).toMatchObject({ size: "14px" });
    expect((await drawn("orca-list")).family).not.toContain("Menlo");
  });

  it("puts no variable on the root for the work pane while none is chosen", async () => {
    await openOrca(orcaOverview(sample(), worktrees()));
    expect((await drawn("orca-work")).size).toBe("14px");
    expect((await drawn("orca-files")).size).toBe("14px");
    expect(await rootVar("--ff-orca-pane")).toBe("");
    expect(await rootVar("--fs-orca-pane")).toBe("");
  });

  it("draws the work pane with the family of the whole app when none is chosen for it, and not its size", async () => {
    await openOrca(orcaOverview(sample(), worktrees()), { font_settings: fontSettings({ app: { family: "Menlo", size: 20, ghostty: false } }) });
    await browser.waitUntil(async () => (await drawn("orca-work")).family.includes("Menlo"), { timeoutMsg: "the work pane never took the family of the app" });
    // The size of the whole app does not reach a place.
    expect((await drawn("orca-work")).size).toBe("14px");
    expect((await drawn("orca-list")).family).toContain("Menlo");
  });
});

describe("orca: the terminal colors (A-14, A-15)", () => {
  // The light theme is on a cream ground, the dark one on a dark violet.
  const light = { pane: "rgb(253, 246, 227)", color: "rgb(101, 123, 131)" };
  const dark = { pane: "rgb(40, 42, 54)", color: "rgb(248, 248, 242)" };
  const chosen = terminalThemes({ light: "One Light", dark: "Dracula" });
  const colorsNow = async () => {
    const { pane, color } = await look();
    return { pane, color };
  };

  it("draws the terminal with the theme of the system's appearance, and with the other one when it changes", async () => {
    await openTerminal({ terminal_themes: chosen });
    await setDark(false);
    await browser.waitUntil(async () => (await look()).pane === light.pane, { timeoutMsg: "the terminal never took the light theme" });
    expect(await colorsNow()).toEqual(light);
    await setDark(true);
    await browser.waitUntil(async () => (await look()).pane === dark.pane, { timeoutMsg: "the terminal never took the dark theme" });
    expect(await colorsNow()).toEqual(dark);
    await setDark(false);
    await browser.waitUntil(async () => (await look()).pane === light.pane, { timeoutMsg: "the terminal never went back to the light theme" });
    expect(await colorsNow()).toEqual(light);
  });

  it("prefers the theme to the colors of the Ghostty import, and keeps the import's font", async () => {
    const colors = { background: "#112233", foreground: "#ddeeff", cursor: null, cursorAccent: null, selectionBackground: null, selectionForeground: null, palette: [] };
    const imported = ghosttyImport({ settings: { fontFamilies: ["Example Mono"], fontSize: 15, fontThicken: false, light: colors, dark: colors, keybinds: [] } });
    await openTerminal({ terminal_themes: chosen, ghostty_saved: imported });
    await setDark(true);
    await browser.waitUntil(async () => (await look()).pane === dark.pane, { timeoutMsg: "the terminal never took the dark theme" });
    expect(await colorsNow()).toEqual(dark);
    expect((await look()).size).toBe("15px");
  });

  it("draws the colors of the Ghostty import while no theme could be read", async () => {
    const colors = { background: "#112233", foreground: "#ddeeff", cursor: null, cursorAccent: null, selectionBackground: null, selectionForeground: null, palette: [] };
    const imported = ghosttyImport({ settings: { fontFamilies: [], fontSize: null, fontThicken: false, light: colors, dark: colors, keybinds: [] } });
    await openTerminal({ terminal_themes: rejects("テーマを読めません"), ghostty_saved: imported });
    expect(await colorsNow()).toEqual({ pane: "rgb(17, 34, 51)", color: "rgb(221, 238, 255)" });
  });

  it("draws the terminals again with a theme chosen in the settings, with no restart", async () => {
    await openTerminal({ terminal_themes: chosen });
    await setDark(true);
    await browser.waitUntil(async () => (await look()).pane === dark.pane, { timeoutMsg: "the terminal never took the dark theme" });
    await $("#nav-settings").click();
    await $("#settings-tab-orca").click();
    const set = await mock("terminal_theme_set", { light: "One Light", dark: "Ghostty Default Style Dark", appearance: "system" });
    await chooseTheme("dark", "Ghostty Default Style Dark");
    expect(await waitForCalls(set)).toEqual([{ selection: { light: "One Light", dark: "Ghostty Default Style Dark", appearance: "system" } }]);
    await $("#nav-orca").click();
    await browser.waitUntil(async () => (await look()).pane === "rgb(16, 32, 58)", { timeoutMsg: "the terminal never took the chosen theme" });
    // The theme of the other appearance is unchanged.
    await setDark(false);
    await browser.waitUntil(async () => (await look()).pane === light.pane, { timeoutMsg: "the terminal never took the light theme" });
  });

  it("draws the light theme whatever the system's appearance is when the appearance is fixed to light", async () => {
    await openTerminal({ terminal_themes: terminalThemes({ light: "One Light", dark: "Dracula", appearance: "light" }) });
    await setDark(true);
    await browser.waitUntil(async () => (await look()).pane === light.pane, { timeoutMsg: "the terminal never took the light theme" });
    expect(await colorsNow()).toEqual(light);
    // A change of the system's appearance does not move it, and the pane keeps its ground.
    await setDark(false);
    await setDark(true);
    expect(await colorsNow()).toEqual(light);
  });

  it("draws the dark theme whatever the system's appearance is when the appearance is fixed to dark", async () => {
    await openTerminal({ terminal_themes: terminalThemes({ light: "One Light", dark: "Dracula", appearance: "dark" }) });
    await setDark(false);
    await browser.waitUntil(async () => (await look()).pane === dark.pane, { timeoutMsg: "the terminal never took the dark theme" });
    expect(await colorsNow()).toEqual(dark);
    await setDark(true);
    await setDark(false);
    expect(await colorsNow()).toEqual(dark);
  });

  it("draws the terminals again at once when the appearance is chosen in the settings, and follows the system again with 'system'", async () => {
    await openTerminal({ terminal_themes: chosen });
    await setDark(true);
    await browser.waitUntil(async () => (await look()).pane === dark.pane, { timeoutMsg: "the terminal never took the dark theme" });
    await $("#nav-settings").click();
    await $("#settings-tab-orca").click();
    const set = await mock("terminal_theme_set", { light: "One Light", dark: "Dracula", appearance: "light" });
    await chooseAppearance("light");
    expect(await waitForCalls(set)).toEqual([{ selection: { light: "One Light", dark: "Dracula", appearance: "light" } }]);
    await $("#nav-orca").click();
    await browser.waitUntil(async () => (await look()).pane === light.pane, { timeoutMsg: "the terminal never took the fixed light theme" });
    await mock("terminal_theme_set", { light: "One Light", dark: "Dracula", appearance: "system" });
    await $("#nav-settings").click();
    await chooseAppearance("system");
    await $("#nav-orca").click();
    await browser.waitUntil(async () => (await look()).pane === dark.pane, { timeoutMsg: "the terminal never followed the system again" });
  });
});

describe("orca: files on a terminal (A-10)", () => {
  const dropped = (repo: string, name = "shot.png") => `/work/${repo}/.orca/drops/${name}`;
  // What `orca_attach_file` answers for an image: the path with its blank, to be pasted as a bracketed paste.
  const attached = (repo: string, name = "shot.png") => ({ text: `${dropped(repo, name)} `, bracketed: true });
  // What it answers for any other file: the path in quotes with its blank, to be typed as it is.
  const attachedNote = (repo: string, name = "notes.txt") => ({ text: `'${dropped(repo, name)}' `, bracketed: false });
  const NOTE = btoa("hello");
  const shown = ".orca-term-box:not([hidden]) .xterm-helper-textarea";
  const area = ".orca-term";
  const inputs = (command: string) => callsOf(command).then((calls) => calls.map((c) => (c as { text: string }).text));

  // The screen with the terminal of the project example-app shown: the mirror of this machine, else the stream of Studio.
  async function openMirror() {
    await openOrca(orcaOverview(sample(), worktrees(), { terminals: [orcaTerminal("example-app", "zsh")] }));
    await mock("orca_terminal_read", ["$"]);
    await project("example-app").click();
    await tabOf("orca:term_example-app_zsh").$(".orca-tab-btn").click();
    await waitForCalls("orca_terminal_read");
  }
  async function openStream() {
    await openOrca(orcaOverview([], [], { target: "Studio", environments: ["Studio"] }));
    await waitForCalls("orca_stream_open");
    await sendStream(streamList(sample(), worktrees(), [orcaTerminal("example-app", "zsh")]));
    await project("example-app").click();
    await tabOf("orca:term_example-app_zsh").$(".orca-tab-btn").click();
    await waitForCalls("orca_stream_terminal");
  }

  it("puts a pasted image in the worktree of a terminal of this machine and types its path there", async () => {
    await openMirror();
    const attach = await mock("orca_attach_file", attached("example-app"));
    const input = await mock("orca_terminal_input", null);
    expect(await fire("paste", shown, [image()])).toBe(true);
    expect(await waitForCalls(attach)).toEqual([{ path: "/work/example-app", name: "shot.png", data: PNG, environment: null }]);
    expect(await waitForCalls(input)).toEqual([{ handle: "term_example-app_zsh", text: `${dropped("example-app")} ` }]);
  });

  it("puts a pasted file that is not an image in the worktree and types its quoted path as it is", async () => {
    await openMirror();
    const attach = await mock("orca_attach_file", attachedNote("example-app"));
    const input = await mock("orca_terminal_input", null);
    expect(await fire("paste", shown, [note])).toBe(true);
    expect(await waitForCalls(attach)).toEqual([{ path: "/work/example-app", name: "notes.txt", data: NOTE, environment: null }]);
    expect(await waitForCalls(input)).toEqual([{ handle: "term_example-app_zsh", text: `'${dropped("example-app", "notes.txt")}' ` }]);
  });

  it("leaves a paste with no file to the terminal", async () => {
    await openMirror();
    const attach = await mock("orca_attach_file", attached("example-app"));
    await fire("paste", shown, []);
    await browser.pause(300);
    expect(await callsOf(attach)).toEqual([]);
  });

  it("takes images dropped on the terminal, cancels a dragover that carries a file, and types the paths in order on one line", async () => {
    await openMirror();
    const attach = await mock("orca_attach_file", attached("example-app", "first.png"));
    const input = await mock("orca_terminal_input", null);
    expect(await fire("dragover", area, [image()])).toBe(true);
    expect(await fire("dragover", area, [])).toBe(false);
    expect(await fire("drop", area, [image("first.png"), image("second.png")])).toBe(true);
    expect((await waitForCalls(attach, 2)).map((c) => (c as { name: string }).name)).toEqual(["first.png", "second.png"]);
    await waitForCalls(input);
    expect(await inputs(input)).toEqual([`${dropped("example-app", "first.png")} ${dropped("example-app", "first.png")} `]);
  });

  it("puts a dropped file that is not an image in the worktree and types its quoted path as it is", async () => {
    await openMirror();
    const attach = await mock("orca_attach_file", attachedNote("example-app"));
    const input = await mock("orca_terminal_input", null);
    expect(await fire("dragover", area, [note])).toBe(true);
    expect(await fire("drop", area, [note])).toBe(true);
    expect(await waitForCalls(attach)).toEqual([{ path: "/work/example-app", name: "notes.txt", data: NOTE, environment: null }]);
    expect(await waitForCalls(input)).toEqual([{ handle: "term_example-app_zsh", text: `'${dropped("example-app", "notes.txt")}' ` }]);
  });

  it("refuses a file over 20 MiB with the message, without reading it or calling the command, and types nothing", async () => {
    await openMirror();
    const attach = await mock("orca_attach_file", attachedNote("example-app"));
    const input = await mock("orca_terminal_input", null);
    await fire("drop", area, [huge]);
    await expect($(CARD)).toHaveText("ファイルは 20 MiB までです");
    expect(await callsOf(attach)).toEqual([]);
    expect(await callsOf(input)).toEqual([]);
  });

  it("shows the message of a file that cannot be put and types nothing", async () => {
    await openMirror();
    const attach = await mock("orca_attach_file", rejects("SSH の接続先の worktree にはファイルを添付できません"));
    const input = await mock("orca_terminal_input", null);
    await fire("paste", shown, [image()]);
    await waitForCalls(attach);
    await expect($(CARD)).toHaveText("SSH の接続先の worktree にはファイルを添付できません");
    expect(await callsOf(input)).toEqual([]);
  });

  it("does not take a file dropped anywhere else, and does not let the webview navigate to it", async () => {
    await openMirror();
    const attach = await mock("orca_attach_file", attached("example-app"));
    const before = await browser.execute(() => location.href);
    expect(await fire("dragover", "document", [image()])).toBe(true);
    expect(await fire("drop", "document", [image()])).toBe(true);
    expect(await fire("drop", "#orca-feed", [image()])).toBe(true);
    // A drag that holds no file is not touched.
    expect(await fire("drop", "document", [])).toBe(false);
    expect(await browser.execute(() => location.href)).toBe(before);
    expect(await callsOf(attach)).toEqual([]);
  });

  it("puts the image in the worktree of the Claude session shown, with the target", async () => {
    await openOrca(orcaOverview([], [], { target: "Studio", environments: ["Studio"] }));
    await waitForCalls("orca_stream_open");
    await sendStream(streamList(sample(), worktrees()));
    await project("example-api").click();
    await waitForCalls("orca_stream_terminal");
    const attach = await mock("orca_attach_file", attached("example-api"));
    const input = await mock("orca_stream_input", null);
    await fire("paste", shown, [image()]);
    expect(await waitForCalls(attach)).toEqual([{ path: "/work/example-api", name: "shot.png", data: PNG, environment: "Studio" }]);
    expect(await waitForCalls(input)).toEqual([{ environment: "Studio", handle: "term_example-api", text: `${dropped("example-api")} `, viewport: PANE }]);
  });

  it("types the path in the terminal streamed from a saved environment, to its handle", async () => {
    await openStream();
    const attach = await mock("orca_attach_file", attached("example-app"));
    const input = await mock("orca_stream_input", null);
    await fire("drop", area, [image()]);
    expect(await waitForCalls(attach)).toEqual([{ path: "/work/example-app", name: "shot.png", data: PNG, environment: "Studio" }]);
    expect(await waitForCalls(input)).toEqual([{ environment: "Studio", handle: "term_example-app_zsh", text: `${dropped("example-app")} `, viewport: PANE }]);
  });

  it("types the text of a file whose answer is not bracketed as it is, and pastes a bracketed one, in a terminal that asked for the bracketed paste", async () => {
    await openStream();
    await sendTerm({ kind: "output", data: "\x1b[?2004h" });
    const attach = await mock("orca_attach_file", attachedNote("example-app"));
    const input = await mock("orca_stream_input", null);
    await fire("paste", shown, [note]);
    await waitForCalls(attach);
    expect(await inputs(input)).toEqual([`'${dropped("example-app", "notes.txt")}' `]);
    await mock("orca_attach_file", attached("example-app"));
    await fire("paste", shown, [image()]);
    await browser.waitUntil(async () => (await inputs(input)).length === 2, { timeoutMsg: "the bracketed paste never went" });
    expect((await inputs(input))[1]).toBe(`\x1b[200~${dropped("example-app")} \x1b[201~`);
  });

  it("does not type the path in another terminal when the tab changed while the image went", async () => {
    await openStream();
    const attach = await mock("orca_attach_file", holds);
    const input = await mock("orca_stream_input", null);
    await fire("paste", shown, [image()]);
    await waitForCalls(attach);
    await project("example-api").click();
    await waitForCalls("orca_stream_terminal", 2);
    await release(attach, attached("example-app"));
    await browser.pause(500);
    expect(await callsOf(input)).toEqual([]);
  });
});

describe("orca: links in a terminal (A-8, A-12)", () => {
  const lines = ["$ open", "docs: https://example.com/docs。続きを読む", "see (https://example.org/a)."];
  // A link that a program sets with OSC 8, named by one word (the DOM renderer draws a space as U+00A0).
  const osc8 = (uri: string, word: string) => `\x1b]8;;${uri}\x1b\\${word}\x1b]8;;\x1b\\`;
  const WORKTREE = "/work/example-app";
  const FILE_URI = `file://${WORKTREE}/tmp/page.html`;
  const PREVIEW_URL = "http://127.0.0.1:12345/tok/tmp/page.html";
  // What the editor reads and the preview asks for when a file of the worktree is opened as a tab.
  const text: OrcaFileText = { content: "fn main() {}\n", crlf: false, signature: "sig-1", language: "rust", highlight: null };
  const opened = { orca_files_list: { entries: [], total: 0 }, orca_files_ignored: [], orca_file_read: text, orca_file_preview_url: PREVIEW_URL };
  const shownBox = ".orca-term .orca-term-box:not([hidden])";

  // The centre of `needle` on the screen of the terminal shown (the text of a row is drawn in the DOM).
  const aim = (needle: string) =>
    browser.execute(
      (selector, text) => {
        const walker = document.createTreeWalker(document.querySelector(`${selector} .xterm-rows`)!, NodeFilter.SHOW_TEXT);
        for (let node = walker.nextNode(); node; node = walker.nextNode()) {
          const at = node.textContent!.indexOf(text);
          if (at < 0) continue;
          const range = document.createRange();
          range.setStart(node, at);
          range.setEnd(node, at + text.length);
          const box = range.getBoundingClientRect();
          return { x: box.left + box.width / 2, y: box.top + box.height / 2 };
        }
        throw new Error(`no "${text}" on the screen`);
      },
      shownBox,
      needle,
    );
  const mouse = (type: "mousemove" | "mousedown" | "mouseup", at: { x: number; y: number }, init: MouseEventInit) =>
    browser.execute(
      (selector, t, point, extra) => {
        document.querySelector(`${selector} .xterm-screen`)!.dispatchEvent(new MouseEvent(t, { clientX: point.x, clientY: point.y, button: 0, bubbles: true, cancelable: true, ...extra }));
      },
      shownBox,
      type,
      at,
      init,
    );
  // A click on `needle` with the modifiers in `init`: the pointer comes first, so xterm.js finds the link under it.
  async function clickOn(needle: string, init: MouseEventInit = {}) {
    const at = await aim(needle);
    await mouse("mousemove", at, init);
    await browser.pause(100);
    await mouse("mousedown", at, init);
    await mouse("mouseup", at, init);
  }
  const titleOf = () => browser.execute((selector) => document.querySelector(selector)!.getAttribute("title") ?? "", shownBox);

  async function openMirror() {
    await openOrca(orcaOverview(sample(), worktrees()));
    await mock("orca_terminal_read", lines);
    await project("example-app").click();
    await browser.waitUntil(async () => (await screenText()).includes("example.org"), { timeoutMsg: "the screen never showed" });
  }
  // The mirror of this machine's example-app, with `text` for its screen.
  async function openMirrorWith(text: string[], shows: string) {
    await openOrca(orcaOverview(sample(), worktrees()), opened);
    await mock("orca_terminal_read", text);
    await project("example-app").click();
    await browser.waitUntil(async () => (await screenText()).includes(shows), { timeoutMsg: "the screen never showed" });
  }
  // `shows` is a word of `text` that the screen has once it is drawn (not a phrase: the DOM renderer draws a space as U+00A0).
  async function openStream(text: string, shows: string) {
    await openOrca(orcaOverview([], [], { target: "Studio", environments: ["Studio"] }), opened);
    await waitForCalls("orca_stream_open");
    await sendStream(streamList(sample(), worktrees()));
    await project("example-app").click();
    await waitForCalls("orca_stream_terminal");
    // Showing the pane makes the terminal fit it once more (the ResizeObserver, then FIT_DELAY_MS of ts/orca-terminal.ts). Let that fit pass, or it moves the text under the pointer.
    await browser.pause(300);
    await sendTerm({ kind: "snapshot", data: text, cols: 80, rows: 24 });
    await browser.waitUntil(async () => (await screenText()).includes(shows), { timeoutMsg: "the screen never showed" });
  }

  it("opens the URL of a link ⌘+clicked in the mirror of this machine, cut where the Japanese sentence goes on and before the closing bracket", async () => {
    await openMirror();
    const open = await mock("orca_open_url", null);
    await clickOn("example.com", { metaKey: true });
    expect(await waitForCalls(open)).toEqual([{ url: "https://example.com/docs" }]);
    await clickOn("example.org", { metaKey: true });
    expect(await waitForCalls(open, 2)).toEqual([{ url: "https://example.com/docs" }, { url: "https://example.org/a" }]);
  });

  it("opens nothing for a click without ⌘, with Ctrl or Alt held, or with another button", async () => {
    await openMirror();
    const open = await mock("orca_open_url", null);
    await clickOn("example.com");
    await clickOn("example.com", { metaKey: true, ctrlKey: true });
    await clickOn("example.com", { metaKey: true, altKey: true });
    await clickOn("example.com", { metaKey: true, button: 2 });
    await browser.pause(300);
    expect(await callsOf(open)).toEqual([]);
    // The same click with ⌘ alone opens it, so the clicks above did reach the link.
    await clickOn("example.com", { metaKey: true });
    expect(await waitForCalls(open)).toEqual([{ url: "https://example.com/docs" }]);
  });

  it("shows the URL as the title while the pointer is over a link, and takes it away when the pointer leaves", async () => {
    await openMirror();
    await mock("orca_open_url", null);
    await mouse("mousemove", await aim("example.com"), {});
    await browser.waitUntil(async () => (await titleOf()) === "https://example.com/docs", { timeoutMsg: "the title never showed the URL" });
    await mouse("mousemove", await aim("$ open"), {});
    await browser.waitUntil(async () => (await titleOf()) === "", { timeoutMsg: "the title stayed" });
  });

  it("opens the URL of a link ⌘+clicked in the terminal streamed from a saved environment", async () => {
    await openStream("$ claude\r\ndocs: https://example.com/docs", "example.com");
    const open = await mock("orca_open_url", null);
    await clickOn("example.com");
    await browser.pause(300);
    expect(await callsOf(open)).toEqual([]);
    await clickOn("example.com", { metaKey: true });
    expect(await waitForCalls(open)).toEqual([{ url: "https://example.com/docs" }]);
  });

  it("opens a link that a program set with OSC 8 the same way, and shows the message when Rust refuses its URL", async () => {
    await openStream(`$ cat\r\n${osc8("ftp://example.com/hosts", "hosts")}`, "hosts");
    const open = await mock("orca_open_url", rejects("開けるのは http か https の URL だけです"));
    const relative = await mock("orca_link_relative", "unused");
    await clickOn("hosts", { metaKey: true });
    expect(await waitForCalls(open)).toEqual([{ url: "ftp://example.com/hosts" }]);
    await expect($(CARD)).toHaveText("開けるのは http か https の URL だけです");
    expect(await callsOf(relative)).toEqual([]);
  });

  it("opens an HTML file of this machine in the browser when its file: link is ⌘+clicked, and nothing without ⌘", async () => {
    await openMirrorWith(["$ open", osc8(FILE_URI, "pagelink")], "pagelink");
    const relative = await mock("orca_link_relative", "tmp/page.html");
    const browserOpen = await mock("orca_file_open_in_browser", null);
    const open = await mock("orca_open_url", null);
    await clickOn("pagelink");
    await browser.pause(300);
    expect(await callsOf(relative)).toEqual([]);
    await clickOn("pagelink", { metaKey: true });
    expect(await waitForCalls(browserOpen)).toEqual([{ path: WORKTREE, relative: "tmp/page.html", environment: null }]);
    expect(await callsOf(relative)).toEqual([{ uri: FILE_URI, path: WORKTREE }]);
    expect(await callsOf(open)).toEqual([]);
    expect(await callsOf("orca_file_preview_url")).toEqual([]);
  });

  it("opens a file that is not HTML as an editor tab of the project, on this machine", async () => {
    await openMirrorWith(["$ open", osc8(`file://${WORKTREE}/src/main.rs`, "mainlink")], "mainlink");
    await mock("orca_link_relative", "src/main.rs");
    const browserOpen = await mock("orca_file_open_in_browser", null);
    await clickOn("mainlink", { metaKey: true });
    expect(await waitForCalls("orca_file_read")).toEqual([{ path: WORKTREE, relative: "src/main.rs", environment: null }]);
    await browser.waitUntil(async () => (await tabTitles()).includes("main.rs"), { timeoutMsg: "the editor tab never opened" });
    expect(await callsOf(browserOpen)).toEqual([]);
  });

  it("opens an HTML file of a saved environment as a preview tab, and not in the browser", async () => {
    await openStream(`$ cat\r\n${osc8(FILE_URI, "pagelink")}`, "pagelink");
    const relative = await mock("orca_link_relative", "tmp/page.html");
    const browserOpen = await mock("orca_file_open_in_browser", null);
    await clickOn("pagelink", { metaKey: true });
    expect(await waitForCalls(relative)).toEqual([{ uri: FILE_URI, path: WORKTREE }]);
    await waitForCount(".orca-edit-preview iframe", 1);
    expect(await callsOf("orca_file_preview_url")).toEqual([{ path: WORKTREE, relative: "tmp/page.html", environment: "Studio" }]);
    expect(await tabTitles()).toContain("page.html");
    expect(await callsOf(browserOpen)).toEqual([]);
  });

  it("opens a file that is not HTML of a saved environment as an editor tab", async () => {
    await openStream(`$ cat\r\n${osc8(`file://${WORKTREE}/src/main.rs`, "mainlink")}`, "mainlink");
    await mock("orca_link_relative", "src/main.rs");
    await clickOn("mainlink", { metaKey: true });
    expect(await waitForCalls("orca_file_read")).toEqual([{ path: WORKTREE, relative: "src/main.rs", environment: "Studio" }]);
    await browser.waitUntil(async () => (await tabTitles()).includes("main.rs"), { timeoutMsg: "the editor tab never opened" });
    expect(await callsOf("orca_file_preview_url")).toEqual([]);
  });

  it("opens nothing for a file: link that Rust says is outside the worktree, and shows its message", async () => {
    await openStream(`$ cat\r\n${osc8("file:///etc/hosts", "hosts")}`, "hosts");
    const relative = await mock("orca_link_relative", rejects("開けるのはワークツリーの中のファイルだけです"));
    const browserOpen = await mock("orca_file_open_in_browser", null);
    const open = await mock("orca_open_url", null);
    await clickOn("hosts", { metaKey: true });
    expect(await waitForCalls(relative)).toEqual([{ uri: "file:///etc/hosts", path: WORKTREE }]);
    await expect($(CARD)).toHaveText("開けるのはワークツリーの中のファイルだけです");
    expect(await callsOf(browserOpen)).toEqual([]);
    expect(await callsOf(open)).toEqual([]);
    expect(await callsOf("orca_file_read")).toEqual([]);
    expect(await tabTitles()).not.toContain("hosts");
  });
});

// A-17: the work pane split into panes. Rust decides what an operation does to the layout (unit tests); here the screen is checked: what it asks of `orca_panes`, and how it draws the layout the answer holds.
describe("orca: split panes (A-17)", () => {
  const claude = claudeTab("example-app");
  const zsh = "orca:term_example-app_zsh";
  const bash = "orca:term_example-app_bash";
  const apiTab = claudeTab("example-api");
  const pane = (id: string, tabs: string[], selected = tabs[0]): PaneNode => ({ kind: "pane", id, tabs, selected });
  // A split whose nodes share its size equally, unless `sizes` says otherwise.
  const split = (direction: "row" | "column", children: PaneNode[], sizes = children.map(() => 1 / children.length)): PaneNode => ({ kind: "split", direction, children, sizes });
  const row = (...children: PaneNode[]) => split("row", children);
  const column = (...children: PaneNode[]) => split("column", children);
  const layout = (root: PaneNode, focus: string): PaneLayout => ({ root, focus });
  // The Orca handle of each tab that has a terminal.
  const handles = { [claude]: "term_example-app", [zsh]: "term_example-app_zsh", [bash]: "term_example-app_bash" };
  // example-app has its Claude session and two shells, in that order.
  const overview = () => orcaOverview(sample(), worktrees(), { terminals: [orcaTerminal("example-app", "zsh"), orcaTerminal("example-app", "bash")] });
  // Claude and bash on the left, zsh on the right.
  const saved = () => layout(row(pane("p1", [claude, bash]), pane("p2", [zsh])), "p1");
  const paneTabs = (id: string) => textsOf(`.orca-pane[data-pane="${id}"] .orca-tab-title`);
  const moves = async () => (await callsOf("orca_panes")).filter((c) => (c as { op: { kind: string } | null }).op?.kind === "move");

  // The right button on the tab, as the page gets it.
  const rightClick = (tab: string) =>
    browser.execute(
      (id, once) => {
        if (!window.__e2e_once__(once)) return;
        document.querySelector(`[data-tab="${id}"]`)!.dispatchEvent(new MouseEvent("contextmenu", { bubbles: true, cancelable: true, button: 2 }));
      },
      tab,
      onceId(),
    );

  // The pointer's press on the terminal of a pane, as the page gets it (the driver's click on a terminal sends no pointer event).
  const pressPane = (id: string) =>
    browser.execute(
      (paneId, once) => {
        if (!window.__e2e_once__(once)) return;
        document.querySelector(`.orca-pane[data-pane="${paneId}"] .orca-term .xterm-screen`)!.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true, cancelable: true, button: 0, pointerId: 5, isPrimary: true }));
      },
      id,
      onceId(),
    );

  // The pointer's press on a tab, its move to a point of the pane `to`, and (unless `hold`) its release. `at` is the share of the pane's body from its left and from its top; a negative top is its tab strip.
  const drag = (tab: string, to: string, at: [number, number], hold = false) =>
    browser.execute(
      (id, once, paneId, [fx, fy], stay) => {
        if (!window.__e2e_once__(once)) return;
        const fire = (target: EventTarget, type: string, x: number, y: number) =>
          target.dispatchEvent(new PointerEvent(type, { bubbles: true, cancelable: true, clientX: x, clientY: y, button: 0, buttons: type === "pointerup" ? 0 : 1, pointerId: 3, isPrimary: true }));
        const button = document.querySelector(`[data-tab="${id}"] .orca-tab-btn`)!.getBoundingClientRect();
        const target = document.querySelector(`.orca-pane[data-pane="${paneId}"]`)!;
        const box = target.getBoundingClientRect();
        const bar = target.querySelector(".orca-tabbar")!.getBoundingClientRect();
        const x = box.left + box.width * fx;
        const y = fy < 0 ? bar.top + bar.height / 2 : bar.bottom + (box.bottom - bar.bottom) * fy;
        fire(document.querySelector(`[data-tab="${id}"] .orca-tab-btn`)!, "pointerdown", button.left + 5, button.top + 5);
        fire(document, "pointermove", x, y);
        if (!stay) fire(document, "pointerup", x, y);
      },
      tab,
      onceId(),
      to,
      at,
      hold,
    );

  // The project of example-app selected, with the layout that `orca_panes` answers from the start.
  const leaves = (node: PaneNode | null): number => (node === null ? 0 : node.kind === "pane" ? 1 : node.children.reduce((n, c) => n + leaves(c), 0));
  async function openSplit(value = overview(), answer: PaneLayout = saved(), fixtures: Record<string, unknown> = {}) {
    await openOrca(value, { orca_panes: answer, orca_terminal_read: ["$"], ...fixtures });
    await project("example-app").click();
    await waitForCount(".orca-pane", leaves(answer.root));
  }
  // The layout Rust answers once `focus` is pressed, or `selected` is chosen in the left pane (the answer of a press agrees with the screen, which showed it at once).
  const focusedOn = (focus: string, selected = claude) => layout(row(pane("p1", [claude, bash], selected), pane("p2", [zsh])), focus);

  it("asks Rust for the layout of the project with its tabs, and draws the panes it answers, each with its tab strip and its plus", async () => {
    await openSplit();
    const [first] = await callsOf("orca_panes");
    expect(first).toEqual({ environment: null, project: "proj_example-app", tabs: [claude, zsh, bash], handles, was: {}, op: null });
    expect(await paneTabs("p1")).toEqual(["Write the docs", "bash"]);
    expect(await paneTabs("p2")).toEqual(["zsh"]);
    expect(await count(".orca-plus")).toBe(2);
    expect(await count(".orca-tabs")).toBe(2);
    expect(await browser.execute(() => document.querySelector(".orca-split-node")!.getAttribute("data-direction"))).toBe("row");
    // The two panes lie side by side, with the first on the left.
    const [left, right] = await browser.execute(() => [...document.querySelectorAll(".orca-pane")].map((e) => e.getBoundingClientRect().left));
    expect(left).toBeLessThan(right);
    await expect($('.orca-pane[data-pane="p1"] [aria-selected="true"]')).toHaveText(expect.stringContaining("Write the docs"));
  });

  it("draws a column split with its panes one above the other, and a split in a split", async () => {
    await openSplit(overview(), layout(column(pane("p1", [claude, bash]), row(pane("p2", [zsh]), pane("p3", [apiTab]))), "p1"));
    expect(await browser.execute(() => [...document.querySelectorAll(".orca-split-node")].map((e) => e.getAttribute("data-direction")))).toEqual(["column", "row"]);
    const [top, bottom] = await browser.execute(() => ["p1", "p2"].map((id) => document.querySelector(`.orca-pane[data-pane="${id}"]`)!.getBoundingClientRect().top));
    expect(top).toBeLessThan(bottom);
  });

  // The pointer on the divider `index` (in the order of the document), as the page gets it: for each step its kind, with the pointer `by` from where it was pressed (a share of the size the two nodes beside the divider have together, along the split). The press goes to the divider, the rest to the document.
  const onDivider = (index: number, by: number, steps: ("pointerdown" | "pointermove" | "pointerup" | "pointercancel")[]) =>
    browser.execute(
      (i, once, share, types) => {
        if (!window.__e2e_once__(once)) return;
        const bar = document.querySelectorAll<HTMLElement>(".orca-divider")[i];
        const along = bar.parentElement!.dataset.direction === "row";
        const a = bar.previousElementSibling!.getBoundingClientRect();
        const b = bar.nextElementSibling!.getBoundingClientRect();
        const box = bar.getBoundingClientRect();
        const far = (along ? a.width + b.width : a.height + b.height) * share;
        for (const type of types) {
          const d = type === "pointerdown" ? 0 : far;
          const init = { bubbles: true, cancelable: true, clientX: box.left + box.width / 2 + (along ? d : 0), clientY: box.top + box.height / 2 + (along ? 0 : d), button: 0, buttons: type === "pointerup" ? 0 : 1, pointerId: 9, isPrimary: true };
          (type === "pointerdown" ? bar : document).dispatchEvent(new PointerEvent(type, init));
        }
      },
      index,
      onceId(),
      by,
      steps,
    );
  // The width and the height of each pane, in the order of their ids.
  const sizesOf = (...ids: string[]) =>
    browser.execute((names) => names.map((id) => document.querySelector(`.orca-pane[data-pane="${id}"]`)!.getBoundingClientRect()).map((r) => [r.width, r.height] as [number, number]), ids);
  const three = (sizes?: number[]) => layout(split("row", [pane("p1", [claude]), pane("p2", [zsh]), pane("p3", [bash])], sizes), "p1");

  it("gives each pane of a split its share of the size, with a divider between two panes", async () => {
    await openSplit(overview(), three([0.5, 0.2, 0.3]));
    expect(await count(".orca-divider")).toBe(2);
    for (const divider of await $$(".orca-divider")) {
      await expect(divider).toHaveAttribute("role", "separator");
      await expect(divider).toHaveAttribute("aria-orientation", "vertical");
    }
    const [[a], [b], [c]] = await sizesOf("p1", "p2", "p3");
    expect(a / (a + b + c)).toBeCloseTo(0.5, 2);
    expect(b / (a + b + c)).toBeCloseTo(0.2, 2);
    expect(c / (a + b + c)).toBeCloseTo(0.3, 2);
  });

  it("changes the two panes beside a dragged divider and no other, asks for the ratio at the release, and draws the sizes of the answer", async () => {
    await openSplit(overview(), three());
    const [[a], [b], [c]] = await sizesOf("p1", "p2", "p3");
    // The pointer goes right by a quarter of what the first two panes have: the first has three quarters of it while the divider is held.
    await onDivider(0, 0.25, ["pointerdown", "pointermove"]);
    await browser.waitUntil(async () => (await sizesOf("p1"))[0][0] > a + 1, { timeoutMsg: "the pane never followed the pointer" });
    const [[held], [next], [other]] = await sizesOf("p1", "p2", "p3");
    expect(held / (a + b)).toBeCloseTo(0.75, 2);
    expect(held + next).toBeCloseTo(a + b, 0);
    expect(other).toBeCloseTo(c, 0);
    expect((await callsOf("orca_panes")).filter((call) => (call as { op: unknown }).op !== null)).toEqual([]);
    const panes = await mock("orca_panes", three([0.5, 1 / 6, 1 / 3]));
    await onDivider(0, 0.25, ["pointerup"]);
    const [call] = (await waitForCalls(panes)) as { op: { share: number } }[];
    expect(call).toMatchObject({ environment: null, project: "proj_example-app", tabs: [claude, zsh, bash], handles, was: handles, op: { kind: "resize", before: "p1", after: "p2" } });
    expect(call.op.share).toBeCloseTo(0.75, 2);
    await browser.waitUntil(
      async () => {
        const [[first], [second], [third]] = await sizesOf("p1", "p2", "p3");
        return Math.abs(first / (first + second + third) - 0.5) < 0.01;
      },
      { timeoutMsg: "the answer's sizes never drew" },
    );
  });

  it("leaves a pane its least share under a dragged divider, puts the sizes back at a cancel, and moves the divider of a column up and down", async () => {
    await openSplit(overview(), layout(column(pane("p1", [claude, bash]), pane("p2", [zsh])), "p1"));
    await expect($(".orca-divider")).toHaveAttribute("aria-orientation", "horizontal");
    const [[, a], [, b]] = await sizesOf("p1", "p2");
    // Far past the top: the first pane keeps a tenth of the split.
    await onDivider(0, -0.9, ["pointerdown", "pointermove"]);
    await browser.waitUntil(async () => (await sizesOf("p1"))[0][1] < a - 1, { timeoutMsg: "the pane never followed the pointer" });
    expect((await sizesOf("p1"))[0][1] / (a + b)).toBeCloseTo(0.1, 2);
    await onDivider(0, -0.9, ["pointercancel"]);
    await browser.waitUntil(async () => Math.abs((await sizesOf("p1"))[0][1] - a) < 1, { timeoutMsg: "the sizes never came back" });
    const panes = await mock("orca_panes", layout(split("column", [pane("p1", [claude, bash]), pane("p2", [zsh])], [0.1, 0.9]), "p1"));
    await onDivider(0, -0.9, ["pointerdown", "pointermove", "pointerup"]);
    const [call] = (await waitForCalls(panes)) as { op: { share: number } }[];
    expect(call).toMatchObject({ op: { kind: "resize", before: "p1", after: "p2" } });
    expect(call.op.share).toBeCloseTo(0.1, 5);
  });

  it("splits by the right-click menu of a tab: 「右に分割」 and 「下に分割」 ask for the tab at the right and at the bottom of its pane", async () => {
    await openOrca(overview(), { orca_terminal_read: ["$"] });
    await project("example-app").click();
    await waitForCalls("orca_panes");
    const panes = await mock("orca_panes", layout(row(pane("p1", [claude, bash]), pane("p2", [zsh])), "p2"));
    await rightClick(zsh);
    await expect($('.menu[role="menu"]')).toBeDisplayed();
    expect(await textsOf('.menu[role="menu"] button')).toEqual(["右に分割", "下に分割"]);
    // A line icon on each row and no colored dot; the terminal has no copy of a path.
    expect(await count('.menu[role="menu"] button svg')).toBe(2);
    expect(await count('.menu[role="menu"] .pdot')).toBe(0);
    expect(await count('.menu[role="menu"] > [role="separator"]')).toBe(0);
    await pickItem("右に分割");
    expect(await waitForCalls(panes)).toEqual([{ environment: null, project: "proj_example-app", tabs: [claude, zsh, bash], handles, was: handles, op: { kind: "move", tab: zsh, pane: "p1", edge: "right" } }]);
    await waitForCount(".orca-pane", 2);
    expect(await paneTabs("p2")).toEqual(["zsh"]);
    // Below: the next answer is a column.
    const below = await mock("orca_panes", layout(column(pane("p1", [claude, zsh]), pane("p2", [bash])), "p2"));
    await rightClick(bash);
    await pickItem("下に分割");
    expect(await waitForCalls(below)).toEqual([{ environment: null, project: "proj_example-app", tabs: [claude, zsh, bash], handles, was: handles, op: { kind: "move", tab: bash, pane: "p1", edge: "bottom" } }]);
    await browser.waitUntil(async () => (await browser.execute(() => document.querySelector(".orca-split-node")?.getAttribute("data-direction"))) === "column", { timeoutMsg: "the column never drew" });
  });

  it("puts the button that opens the list (A-23) in the strip of the pane at the left edge only: the first pane of a row, the top pane of a column", async () => {
    await openSplit();
    await $("#orca-list-toggle").click();
    await expect($('.orca-pane[data-pane="p1"] .list-toggle')).toBeDisplayed();
    await expect($('.orca-pane[data-pane="p2"] .list-toggle')).not.toBeDisplayed();
    await $('.orca-pane[data-pane="p1"] .list-toggle').click();
    await expect($("#orca-list")).toBeDisplayed();
    await expect($('.orca-pane[data-pane="p1"] .list-toggle')).not.toBeDisplayed();
    await openSplit(overview(), layout(column(pane("p1", [claude, bash]), row(pane("p2", [zsh]), pane("p3", [apiTab]))), "p1"));
    await $("#orca-list-toggle").click();
    await expect($('.orca-pane[data-pane="p1"] .list-toggle')).toBeDisplayed();
    await expect($('.orca-pane[data-pane="p2"] .list-toggle')).not.toBeDisplayed();
    await expect($('.orca-pane[data-pane="p3"] .list-toggle')).not.toBeDisplayed();
  });

  it("has no menu on a tab that is alone in its pane", async () => {
    await openSplit();
    await rightClick(zsh);
    await browser.pause(300);
    expect(await count(".menu")).toBe(0);
  });

  it("splits by dragging a tab to an edge of another pane, joins it by dragging it to the strip or the middle, and asks nothing for a drop that changes nothing", async () => {
    await openSplit();
    // The hint shows while the tab is over a place that takes it, and goes with Escape, which leaves the tab where it was.
    await drag(bash, "p2", [0.5, 0.95], true);
    await expect($(".orca-drop")).toBeDisplayed();
    await browser.execute(() => document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true })));
    await waitForCount(".orca-drop", 0);
    expect(await moves()).toEqual([]);
    // The bottom edge of the other pane, its left edge, its strip, and its middle.
    for (const [at, edge] of [[[0.5, 0.95], "bottom"], [[0.03, 0.5], "left"], [[0.5, 0.5], "center"], [[0.5, -1], "center"], [[0.97, 0.5], "right"], [[0.5, 0.03], "top"]] as [[number, number], string][]) {
      const before = (await moves()).length;
      await drag(bash, "p2", at);
      await browser.waitUntil(async () => (await moves()).length === before + 1, { timeoutMsg: `no move for ${edge}` });
      expect((await moves()).at(-1)).toEqual({ environment: null, project: "proj_example-app", tabs: [claude, zsh, bash], handles, was: handles, op: { kind: "move", tab: bash, pane: "p2", edge } });
    }
    expect(await count(".orca-drop")).toBe(0);
    // The edge of its own pane, which has another tab, splits it; its own strip or middle, and the edge of a pane it is alone in, change nothing.
    const before = (await moves()).length;
    await drag(bash, "p1", [0.97, 0.5]);
    await browser.waitUntil(async () => (await moves()).length === before + 1, { timeoutMsg: "no move on its own pane" });
    expect((await moves()).at(-1)).toMatchObject({ op: { tab: bash, pane: "p1", edge: "right" } });
    await drag(bash, "p1", [0.5, 0.5]);
    await drag(bash, "p1", [0.5, -1]);
    await drag(zsh, "p2", [0.97, 0.5]);
    await drag(zsh, "p2", [0.5, 0.5]);
    await browser.pause(300);
    expect((await moves()).length).toBe(before + 1);
    // A press that does not move selects the tab as a click does, and a drag does not.
    expect(await count(".orca-drop")).toBe(0);
  });

  it("does not select the tab that was dragged", async () => {
    await openSplit();
    const panes = await mock("orca_panes", saved());
    await drag(bash, "p2", [0.5, 0.5]);
    await browser.pause(300);
    expect((await callsOf(panes)).filter((c) => (c as { op: { kind: string } | null }).op?.kind === "select")).toEqual([]);
  });

  it("makes the iframe of an HTML preview take no pointer while a tab or a divider is dragged, and again when the drag ends", async () => {
    const page: OrcaFileText = { content: "<h1>見出し</h1>\n", crlf: false, signature: "sig-1", language: "html", highlight: null };
    const preview = "file:1";
    await openSplit(overview(), layout(row(pane("p1", [claude, bash, preview], preview), pane("p2", [zsh])), "p1"), {
      orca_files_list: { entries: [], total: 0 },
      orca_files_ignored: [],
      orca_file_read: page,
      orca_file_preview_url: "http://127.0.0.1:12345/tok/page.html",
      orca_preview_check: null,
    });
    expect(await askScreen("write", "preview-open", { path: "/work/example-app", relative: "page.html" })).toEqual({ ok: true });
    await waitForCount(".orca-edit-preview iframe", 1);
    const pointer = () => browser.execute(() => getComputedStyle(document.querySelector(".orca-edit-preview iframe")!).pointerEvents);
    expect(await pointer()).toBe("auto");
    // A tab held over another pane: the page in the frame is of another origin, so a release over it would never reach this document.
    await drag(preview, "p2", [0.5, 0.5], true);
    await expect($(".orca-drop")).toBeDisplayed();
    expect(await pointer()).toBe("none");
    await browser.execute(() => document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true })));
    await waitForCount(".orca-drop", 0);
    expect(await pointer()).toBe("auto");
    // A divider held, and its cancel.
    await onDivider(0, 0.1, ["pointerdown", "pointermove"]);
    expect(await pointer()).toBe("none");
    await onDivider(0, 0.1, ["pointercancel"]);
    expect(await pointer()).toBe("auto");
    // A divider released.
    await onDivider(0, 0.1, ["pointerdown", "pointermove", "pointerup"]);
    expect(await pointer()).toBe("auto");
  });

  it("selects a tab of a pane by pressing it, and gives a pane the focus by pressing it", async () => {
    await openSplit();
    const panes = await mock("orca_panes", focusedOn("p1", bash));
    await tabOf(bash).$(".orca-tab-btn").click();
    expect(await waitForCalls(panes)).toMatchObject([{ op: { kind: "select", tab: bash } }]);
    // The terminal of the other pane: pressing it gives its pane the focus.
    await mock("orca_panes", focusedOn("p2", bash));
    await pressPane("p2");
    await browser.waitUntil(async () => (await callsOf("orca_panes")).some((c) => (c as { op: { kind: string } | null }).op?.kind === "focus"), { timeoutMsg: "no focus" });
    expect((await callsOf("orca_panes")).at(-1)).toMatchObject({ op: { kind: "focus", pane: "p2" } });
  });

  it("draws the focused pane's bar marked, and the selected tab of each pane", async () => {
    await openSplit(overview(), layout(row(pane("p1", [claude, bash], bash), pane("p2", [zsh])), "p2"));
    expect(await browser.execute(() => document.querySelector(".orca-pane[data-focused='true']")!.getAttribute("data-pane"))).toBe("p2");
    await expect($('.orca-pane[data-pane="p1"] [aria-selected="true"]')).toHaveText(expect.stringContaining("bash"));
    await expect($('.orca-pane[data-pane="p2"] [aria-selected="true"]')).toHaveText(expect.stringContaining("zsh"));
  });

  it("mirrors the terminal selected in each pane, each in its own pane", async () => {
    await openSplit();
    await browser.waitUntil(async () => new Set((await callsOf("orca_terminal_read")).map((c) => (c as { handle: string }).handle)).size === 2, { timeoutMsg: "the two terminals were not both read" });
    expect(new Set((await callsOf("orca_terminal_read")).map((c) => (c as { handle: string }).handle))).toEqual(new Set(["term_example-app", "term_example-app_zsh"]));
    expect(await count(".orca-term:not([hidden])")).toBe(2);
    expect(await count(".orca-pane[data-pane='p1'] .orca-term .orca-term-box:not([hidden])")).toBe(1);
    expect(await count(".orca-pane[data-pane='p2'] .orca-term .orca-term-box:not([hidden])")).toBe(1);
    // The terminal of a tab that is not selected waits, and another tab of the pane shows its own.
    await mock("orca_panes", focusedOn("p1", bash));
    await tabOf(bash).$(".orca-tab-btn").click();
    await browser.waitUntil(async () => (await callsOf("orca_terminal_read")).some((c) => (c as { handle: string }).handle === "term_example-app_bash"), { timeoutMsg: "bash was never read" });
  });

  it("sends the keys typed in a pane to the terminal of that pane", async () => {
    await openSplit();
    const input = await mock("orca_terminal_input", null);
    await mock("orca_panes", focusedOn("p2"));
    await pressPane("p2");
    await browser.keys(["c", "d"]);
    await browser.waitUntil(async () => (await callsOf(input)).map((c) => (c as { text: string }).text).join("") === "cd", { timeoutMsg: "the keys were not sent" });
    expect((await callsOf(input)).every((c) => (c as { handle: string }).handle === "term_example-app_zsh")).toBe(true);
  });

  it("asks again, with the tabs now listed, when a tab leaves, and draws the layout without its pane", async () => {
    await openSplit(overview(), saved(), timers({ orcaMirror: 250, orcaClock: 1000 }));
    // The shell of the second pane is closed in Orca: the list no longer has it (the clock reads it, every second here), and Rust answers a layout of one pane.
    const panes = await mock("orca_panes", layout(pane("p1", [claude, bash]), "p1"));
    await mock("orca_overview", orcaOverview(sample(), worktrees(), { terminals: [orcaTerminal("example-app", "bash")] }));
    expect(await waitForCalls(panes)).toEqual([{ environment: null, project: "proj_example-app", tabs: [claude, bash], handles: { [claude]: handles[claude], [bash]: handles[bash] }, was: handles, op: null }]);
    await waitForCount(".orca-pane", 1);
    expect(await count(".orca-split-node")).toBe(0);
    expect(await paneTabs("p1")).toEqual(["Write the docs", "bash"]);
    // The terminal of the pane that closed is no longer read.
    await mock("orca_terminal_read", ["$"]);
    await browser.pause(300);
    expect((await callsOf("orca_terminal_read")).every((c) => (c as { handle: string }).handle !== "term_example-app_zsh")).toBe(true);
  });

  it("keeps the split, the place and the selection of a terminal, and its screen, when Claude starts in a plain terminal and when it ends there again", async () => {
    // The clock reads the list every second here.
    await openSplit(overview(), saved(), timers({ orcaClock: 1000 }));
    // The shell of the right pane is mirrored; its screen is marked, to tell it from one made again.
    await browser.waitUntil(async () => (await count(".orca-pane[data-pane='p2'] .orca-term .orca-term-box:not([hidden])")) === 1, { timeoutMsg: "the right pane showed no terminal" });
    await browser.execute(() => document.querySelector(".orca-pane[data-pane='p2'] .orca-term .orca-term-box")!.setAttribute("data-mark", "same"));
    // `claude` runs in it: Orca lists the terminal as a Claude session under the same handle, and Rust answers the layout with the tab of the pane replaced.
    const zshClaude = "claude:tab_example-app_zsh:leaf_1";
    const started = await mock("orca_panes", layout(row(pane("p1", [claude, bash]), pane("p2", [zshClaude])), "p2"));
    const sessions = [...sample(), orcaRow("example-app", "feat/a", "Run the tests", { paneKey: "tab_example-app_zsh:leaf_1", handle: "term_example-app_zsh" })];
    await mock("orca_overview", orcaOverview(sessions, worktrees(), { terminals: [orcaTerminal("example-app", "bash")] }));
    expect(await waitForCalls(started)).toEqual([
      { environment: null, project: "proj_example-app", tabs: [claude, zshClaude, bash], handles: { [claude]: handles[claude], [zshClaude]: handles[zsh], [bash]: handles[bash] }, was: handles, op: null },
    ]);
    await browser.waitUntil(async () => (await paneTabs("p2")).join() === "Run the tests", { timeoutMsg: "the right pane did not draw the Claude tab" });
    expect(await count(".orca-pane")).toBe(2);
    expect(await paneTabs("p1")).toEqual(["Write the docs", "bash"]);
    await expect($('.orca-pane[data-pane="p2"] [aria-selected="true"]')).toHaveText(expect.stringContaining("Run the tests"));
    await expect($('.orca-pane[data-pane="p2"] .orca-term .orca-term-box[data-mark="same"]')).toBeDisplayed();
    // Claude ends and the shell is back: the terminal is a plain one again, in the same pane.
    const ended = await mock("orca_panes", saved());
    await mock("orca_overview", overview());
    expect(await waitForCalls(ended)).toEqual([
      { environment: null, project: "proj_example-app", tabs: [claude, zsh, bash], handles, was: { [claude]: handles[claude], [zshClaude]: handles[zsh], [bash]: handles[bash] }, op: null },
    ]);
    await browser.waitUntil(async () => (await paneTabs("p2")).join() === "zsh", { timeoutMsg: "the right pane did not draw the plain tab" });
    expect(await count(".orca-pane")).toBe(2);
    await expect($('.orca-pane[data-pane="p2"] .orca-term .orca-term-box[data-mark="same"]')).toBeDisplayed();
  });

  it("keeps the terminal of a pane shown, and its screen, while Rust's answer to a read where the terminal changed kind has not come", async () => {
    // The clock reads the list every second here.
    await openSplit(overview(), saved(), timers({ orcaClock: 1000 }));
    await browser.waitUntil(async () => (await count(".orca-pane[data-pane='p2'] .orca-term .orca-term-box:not([hidden])")) === 1, { timeoutMsg: "the right pane showed no terminal" });
    await browser.execute(() => document.querySelector(".orca-pane[data-pane='p2'] .orca-term .orca-term-box")!.setAttribute("data-mark", "same"));
    // `claude` runs in the shell, and the answer still holds the old tab id (the layout of the read before).
    const old = await mock("orca_panes", saved());
    const sessions = [...sample(), orcaRow("example-app", "feat/a", "Run the tests", { paneKey: "tab_example-app_zsh:leaf_1", handle: "term_example-app_zsh" })];
    await mock("orca_overview", orcaOverview(sessions, worktrees(), { terminals: [orcaTerminal("example-app", "bash")] }));
    await waitForCalls(old);
    await browser.waitUntil(async () => (await paneTabs("p2")).join() === "Run the tests", { timeoutMsg: "the right pane did not draw the Claude tab" });
    await expect($('.orca-pane[data-pane="p2"] [aria-selected="true"]')).toHaveText(expect.stringContaining("Run the tests"));
    await expect($('.orca-pane[data-pane="p2"] .orca-term .orca-term-box[data-mark="same"]')).toBeDisplayed();
  });

  it("gives the plus of a pane the focus first and starts the session in the project", async () => {
    await openSplit();
    const panes = await mock("orca_panes", saved());
    const create = await mock("orca_terminal_create", { paneKey: null, handle: "term_new" });
    await pressPlus('.orca-pane[data-pane="p2"] .orca-plus');
    await pickItem("ターミナルを開く");
    expect(await waitForCalls(create)).toEqual([{ path: "/work/example-app", environment: null }]);
    expect(await callsOf(panes)).toMatchObject([{ op: { kind: "focus", pane: "p2" } }]);
  });

  it("keeps working with one pane of all the tabs when Rust cannot answer, and shows the message", async () => {
    await openOrca(overview(), { orca_panes: rejects("orca-panes.json を書けません"), orca_terminal_read: ["$"] });
    await project("example-app").click();
    await expect($(CARD)).toHaveText("orca-panes.json を書けません");
    await waitForCount(".orca-pane", 1);
    expect(await paneTabs("p1")).toEqual(["Write the docs", "zsh", "bash"]);
  });

  describe("on a saved environment", () => {
    const studioOnly = { target: "Studio", environments: ["Studio"] };
    const viewportOf = (call: unknown) => (call as { viewport: { cols: number; rows: number } }).viewport;
    async function openStudioSplit() {
      await openOrca(orcaOverview([], [], studioOnly));
      await waitForCalls("orca_stream_open");
      await mock("orca_panes", saved());
      await sendStream(streamList(sample(), worktrees(), [orcaTerminal("example-app", "zsh"), orcaTerminal("example-app", "bash")]));
      await project("example-app").click();
      await waitForCount(".orca-pane", 2);
    }

    it("streams the terminal of each pane at its pane's size, and draws each one's events in its own pane", async () => {
      await openStudioSplit();
      const calls = await waitForCalls("orca_stream_terminal", 2);
      expect(calls.map((c) => (c as { handle: string }).handle).sort()).toEqual(["term_example-app", "term_example-app_zsh"]);
      for (const call of calls) {
        expect(viewportOf(call).cols).toBeGreaterThan(20);
        expect(viewportOf(call).rows).toBeGreaterThan(8);
      }
      const nth = (handle: string) => calls.findIndex((c) => (c as { handle: string }).handle === handle);
      await sendTerm({ kind: "snapshot", data: "left screen", cols: 80, rows: 24 }, nth("term_example-app"));
      await sendTerm({ kind: "snapshot", data: "right screen", cols: 80, rows: 24 }, nth("term_example-app_zsh"));
      await browser.waitUntil(async () => (await $('.orca-pane[data-pane="p1"] .xterm-rows').getText()).includes("left screen"), { timeoutMsg: "the left screen never showed" });
      await browser.waitUntil(async () => (await $('.orca-pane[data-pane="p2"] .xterm-rows').getText()).includes("right screen"), { timeoutMsg: "the right screen never showed" });
      expect(await $('.orca-pane[data-pane="p1"] .xterm-rows').getText()).not.toContain("right screen");
      // The keys go to the terminal of the pane they were typed in.
      const input = await mock("orca_stream_input", null);
      await mock("orca_panes", focusedOn("p2"));
      await pressPane("p2");
      await browser.keys(["1"]);
      await browser.waitUntil(async () => (await callsOf(input)).map((c) => (c as { text: string }).text).join("") === "1", { timeoutMsg: "the keys were not sent" });
      expect(await callsOf(input)).toEqual([{ environment: "Studio", handle: "term_example-app_zsh", text: "1", viewport: PANE }]);
    });

    it("ends the stream of a terminal that leaves its pane's view, and no other", async () => {
      await openStudioSplit();
      await waitForCalls("orca_stream_terminal", 2);
      const close = await mock("orca_stream_terminal_close", null);
      await mock("orca_panes", focusedOn("p1", bash));
      // Another tab in the left pane: its terminal is subscribed and the one it replaces is closed by its handle; the right pane's stream stays.
      await tabOf(bash).$(".orca-tab-btn").click();
      expect(await waitForCalls(close)).toEqual([{ environment: "Studio", handle: "term_example-app", generation: expect.any(Number) }]);
      await browser.pause(500);
      expect(await callsOf(close)).toEqual([{ environment: "Studio", handle: "term_example-app", generation: expect.any(Number) }]);
    });

    it("puts a new tab in one pane with all the tabs when a later call for the layout fails, and shows the message", async () => {
      await openStudioSplit();
      await mock("orca_panes", rejects("orca-panes.json を書けません"));
      await sendStream(streamList(sample(), worktrees(), [orcaTerminal("example-app", "zsh"), orcaTerminal("example-app", "bash"), orcaTerminal("example-app", "fish")]));
      await expect($(CARD)).toHaveText("orca-panes.json を書けません");
      await waitForCount(".orca-pane", 1);
      expect(await paneTabs("p1")).toEqual(["Write the docs", "zsh", "bash", "fish"]);
    });

    it("sends the new size of the pane whose width changed", async () => {
      await openStudioSplit();
      const calls = await waitForCalls("orca_stream_terminal", 2);
      await focusWindow();
      const viewport = await mock("orca_stream_viewport", null);
      // The list narrows from 19% to 15%, so the panes widen.
      await dragDivider(0.15);
      const sent = await waitForCalls(viewport, 2);
      expect(sent.map((c) => (c as { handle: string }).handle).sort()).toEqual(["term_example-app", "term_example-app_zsh"]);
      expect(viewportOf(sent[0]).cols).toBeGreaterThan(viewportOf(calls[0]).cols);
    });
  });
});

describe("orca: search the list (A-19)", () => {
  // example-app, example-web, example-api, example-lib and example-idle as projects (the working ones, example-app and example-web, come first).
  const overview = () =>
    orcaOverview(sample(), [...worktrees(), orcaWorktree("example-idle", "main")], {
      terminals: [orcaTerminal("example-app", "zsh")],
    });
  const ALL = ["example-app", "example-web", "example-api", "example-lib", "example-idle"];
  // What the list draws while nothing is typed: example-idle is not running, so it is left out under the link (A-8).
  const RUNNING = ALL.slice(0, 4);
  const input = () => $("#orca-search-input");
  const names = () => textsOf("#orca-list .orca-project-name");
  const focusedId = () => browser.execute(() => document.activeElement?.id ?? "");
  // The name of each row and the letters of it in bold.
  const bolds = () =>
    browser.execute(() => [...document.querySelectorAll("#orca-feed .orca-project")].map((r) => [r.querySelector(".orca-project-name")!.textContent, [...r.querySelectorAll("b")].map((b) => b.textContent)]));
  const cursorOn = () => browser.execute(() => [...document.querySelectorAll<HTMLElement>("#orca-feed .orca-project")].filter((r) => r.dataset.cursor === "true").map((r) => r.dataset.key));
  // The page's own press of the magnifier (the driver's click focuses a button after the page's handler ran, which takes the focus off the field it opened).
  const openField = () => browser.execute(() => document.getElementById("orca-search-open")!.click());
  const search = async (text: string) => {
    if (!(await input().isDisplayed())) await openField();
    await input().setValue(text);
    // The list is narrowed when every row it draws holds the text (in bold), however many rows that leaves; a blank text draws all of them, none in bold.
    const needle = text.trim().toLowerCase();
    await browser.waitUntil(
      () =>
        browser.execute(
          (needle: string, all: number) => {
            const rows = [...document.querySelectorAll("#orca-feed .orca-project")];
            if (needle === "") return rows.length === all && rows.every((r) => r.querySelector("b") === null);
            return rows.every((r) => r.querySelector(".orca-project-name")!.textContent!.toLowerCase().includes(needle) && r.querySelector("b") !== null);
          },
          needle,
          RUNNING.length,
        ),
      { timeoutMsg: "the list never changed with the search" },
    );
  };
  // Cmd+J as the page gets it, from the element that has the focus.
  const cmdJ = (init: KeyboardEventInit = { metaKey: true }) =>
    browser.execute((i) => (document.activeElement ?? document.body).dispatchEvent(new KeyboardEvent("keydown", { key: "j", bubbles: true, cancelable: true, ...i })), init);

  const rectOf = (selector: string) =>
    browser.execute((s: string) => {
      const r = document.querySelector(s)!.getBoundingClientRect();
      return { top: r.top, bottom: r.bottom, right: r.right, left: r.left };
    }, selector);

  it("shows the magnifier at the right end of the heading's row and no field until it is pressed", async () => {
    await openOrca(overview());
    await expect($("#orca-search")).not.toBeDisplayed();
    await expect($("#orca-projects-head .orca-list-head")).toHaveText("プロジェクト");
    await expect($("#orca-search-open")).toBeDisplayed();
    await expect($("#orca-search-open")).toHaveAttribute("aria-label", "検索");
    const head = await rectOf("#orca-projects-head");
    const button = await rectOf("#orca-search-open");
    expect(button.right).toBeGreaterThan(head.right - 12);
    expect(button.top).toBeGreaterThanOrEqual(head.top);
    expect(button.bottom).toBeLessThanOrEqual(head.bottom);
  });

  it("turns the heading's row into the field when the magnifier is pressed, with the focus in it and the list not moved", async () => {
    await openOrca(overview());
    const before = { head: await rectOf("#orca-projects-head"), feed: await rectOf("#orca-feed") };
    await openField();
    await expect($("#orca-search")).toBeDisplayed();
    await expect($("#orca-projects-head")).not.toBeDisplayed();
    await expect($("#orca-search-open")).not.toBeDisplayed();
    expect(await focusedId()).toBe("orca-search-input");
    await expect(input()).toHaveAttribute("aria-label", "プロジェクトを検索");
    await expect(input()).toHaveAttribute("placeholder", "検索");
    // The field is in the row of the heading, and the list stays where it was.
    const field = await rectOf("#orca-search");
    expect(field.top).toBeGreaterThanOrEqual(before.head.top - 1);
    expect(field.bottom).toBeLessThanOrEqual(before.head.bottom + 1);
    expect((await rectOf("#orca-feed")).top).toBe(before.feed.top);
    expect(await names()).toEqual(RUNNING);
  });

  it("finds a project that is not running with no link drawn, and brings the list back as it was when the text is cleared", async () => {
    await openOrca(overview());
    const link = $("#orca-list .orca-stopped-toggle");
    await expect(link).toHaveText("起動していない 1 件");
    await search("idle");
    expect(await names()).toEqual(["example-idle"]);
    await expect(link).not.toExist();
    // Every project that holds the text is listed, those that are not running among them, whether the link was open or not.
    await search("example");
    expect(await names()).toEqual(ALL);
    await expect(link).not.toExist();
    await browser.execute(() => document.getElementById("orca-search-clear")!.click());
    expect(await names()).toEqual(RUNNING);
    await expect(link).toHaveText("起動していない 1 件");
    // Opened before the search, opened after it.
    await link.click();
    await expect(link).toHaveText("起動していないものを隠す");
    await search("idle");
    expect(await names()).toEqual(["example-idle"]);
    await expect(link).not.toExist();
    await browser.execute(() => document.getElementById("orca-search-clear")!.click());
    expect(await names()).toEqual(ALL);
    await expect(link).toHaveText("起動していないものを隠す");
  });

  it("has the clear button only while something is typed", async () => {
    await openOrca(overview());
    await openField();
    await expect($("#orca-search-clear")).not.toBeDisplayed();
    await search("app");
    await expect($("#orca-search-clear")).toBeDisplayed();
    expect(await names()).toEqual(["example-app"]);
  });

  it("narrows the list to the rows whose name holds the text, case ignored, in the order of the list", async () => {
    await openOrca(overview());
    expect(await names()).toEqual(RUNNING);
    await search("E-A");
    expect(await names()).toEqual(["example-app", "example-api"]);
    // The text is trimmed, and a blank text is no search.
    await search("  app ");
    expect(await names()).toEqual(["example-app"]);
    await search("   ");
    expect(await names()).toEqual(RUNNING);
  });

  it("makes the letters that match bold, at every place in the name", async () => {
    await openOrca(overview());
    await search("AP");
    expect(await bolds()).toEqual([
      ["example-app", ["ap"]],
      ["example-api", ["ap"]],
    ]);
    await search("p");
    expect((await bolds())[0]).toEqual(["example-app", ["p", "p", "p"]]);
    expect(await browser.execute(() => getComputedStyle(document.querySelector("#orca-feed .orca-project-name b")!).fontWeight)).toBe("800");
  });

  it("matches a character that a regular expression takes as its own as itself, and says so when nothing matches", async () => {
    await openOrca(overview());
    for (const text of [".", "(", "zzz"]) {
      await search(text);
      await expect($("#orca-feed")).toHaveText("一致するプロジェクトがありません");
      expect(await count("#orca-feed .orca-project")).toBe(0);
    }
    await $("#orca-search-clear").click();
    expect(await names()).toEqual(RUNNING);
  });

  it("does not say the projects are missing while the search finds none of those there are", async () => {
    await openOrca(orcaOverview([]));
    await expect($("#orca-feed")).toHaveText(expect.stringContaining("プロジェクトがありません"));
    await search("zzz");
    await expect($("#orca-feed")).toHaveText("一致するプロジェクトがありません");
  });

  it("drops the row of a selected project that does not match with its worktrees, and keeps the tabs", async () => {
    await openOrca(overview());
    await mock("orca_terminal_read", ["$ ls"]);
    await project("example-app").click();
    await expect(project("example-app")).toHaveAttribute("aria-pressed", "true");
    const branches = () => textsOf("#orca-feed .orca-worktree .orca-worktree-branch");
    expect(await branches()).toEqual(["feat/a", "main"]);
    await search("api");
    expect(await names()).toEqual(["example-api"]);
    expect(await branches()).toEqual(["main"]);
    await expect($('#orca-feed .orca-worktree[data-worktree="/work/example-app"]')).not.toExist();
    expect(await tabTitles()).toEqual(["Write the docs", "zsh"]);
    // The sessions are not searched: "zsh" finds no row.
    await search("zsh");
    await expect($("#orca-feed")).toHaveText("一致するプロジェクトがありません");
    await $("#orca-search-clear").click();
    await expect(project("example-app")).toHaveAttribute("aria-pressed", "true");
    expect(await branches()).toEqual(["feat/a", "main"]);
  });

  it("puts the line on the first row, and moves it with Down and Up to the ends", async () => {
    await openOrca(overview());
    await search("e-a");
    expect(await cursorOn()).toEqual(["proj_example-app"]);
    await browser.keys("ArrowDown");
    expect(await cursorOn()).toEqual(["proj_example-api"]);
    await browser.keys("ArrowDown");
    expect(await cursorOn()).toEqual(["proj_example-api"]);
    await browser.keys("ArrowUp");
    expect(await cursorOn()).toEqual(["proj_example-app"]);
    await browser.keys("ArrowUp");
    expect(await cursorOn()).toEqual(["proj_example-app"]);
    // A change of the text puts it on the first row again.
    await browser.keys("ArrowDown");
    await search("ex");
    expect(await cursorOn()).toEqual(["proj_example-app"]);
  });

  it("has no line while nothing is typed, and Down does nothing", async () => {
    await openOrca(overview());
    await openField();
    await browser.keys("ArrowDown");
    expect(await cursorOn()).toEqual([]);
  });

  it("selects the row with Enter as pressing it does, and keeps the text and the narrowed list", async () => {
    await openOrca(overview());
    await mock("orca_terminal_read", ["$ ls"]);
    await search("e-a");
    await browser.keys(["ArrowDown", "Enter"]);
    await expect(project("example-api")).toHaveAttribute("aria-pressed", "true");
    await expect(selectedTab()).toHaveText(expect.stringContaining("Fix the parser"));
    await expect(input()).toHaveValue("e-a");
    expect(await names()).toEqual(["example-app", "example-api"]);
  });

  it("selects nothing with Enter when no row matches", async () => {
    await openOrca(overview());
    await search("zzz");
    await browser.keys("Enter");
    expect(await count('#orca-feed .orca-project[aria-pressed="true"]')).toBe(0);
  });

  it("clears the text and leaves the field with Escape", async () => {
    await openOrca(overview());
    await search("app");
    await browser.keys("Escape");
    expect(await names()).toEqual(RUNNING);
    expect(await focusedId()).not.toBe("orca-search-input");
    // The field is closed and the heading's row is back; the next opening shows no text.
    await expect($("#orca-search")).not.toBeDisplayed();
    await expect($("#orca-projects-head")).toBeDisplayed();
    await openField();
    await expect(input()).toHaveValue("");
    await expect($("#orca-search-clear")).not.toBeDisplayed();
  });

  it("closes the field when the focus leaves it with no text, and keeps it open while text is left", async () => {
    await openOrca(overview());
    await openField();
    await browser.execute(() => (document.activeElement as HTMLElement).blur());
    await expect($("#orca-search")).not.toBeDisplayed();
    await expect($("#orca-projects-head")).toBeDisplayed();
    await search("app");
    await browser.execute(() => (document.activeElement as HTMLElement).blur());
    await browser.pause(150);
    await expect($("#orca-search")).toBeDisplayed();
    await expect(input()).toHaveValue("app");
    expect(await names()).toEqual(["example-app"]);
    // Cleared by the button, the field keeps the focus and so stays open.
    await browser.execute(() => document.getElementById("orca-search-clear")!.click());
    await browser.pause(150);
    await expect($("#orca-search")).toBeDisplayed();
  });

  it("clears the text with the clear button and keeps the focus in the field", async () => {
    await openOrca(overview());
    await search("app");
    // The page's own press (the driver's click focuses the button after the page's handler ran, which no real press does).
    await browser.execute(() => document.getElementById("orca-search-clear")!.click());
    await expect(input()).toHaveValue("");
    expect(await names()).toEqual(RUNNING);
    expect(await focusedId()).toBe("orca-search-input");
  });

  it("moves the focus to the field with Cmd+J, with the text selected", async () => {
    await openOrca(overview());
    await search("app");
    await browser.execute(() => (document.activeElement as HTMLElement).blur());
    expect(await focusedId()).not.toBe("orca-search-input");
    await cmdJ();
    expect(await focusedId()).toBe("orca-search-input");
    expect(await browser.execute(() => [(document.activeElement as HTMLInputElement).selectionStart, (document.activeElement as HTMLInputElement).selectionEnd])).toEqual([0, 3]);
  });

  it("opens the closed field with Cmd+J and gives it the focus", async () => {
    await openOrca(overview());
    await expect($("#orca-search")).not.toBeDisplayed();
    await cmdJ();
    await expect($("#orca-search")).toBeDisplayed();
    await expect($("#orca-projects-head")).not.toBeDisplayed();
    expect(await focusedId()).toBe("orca-search-input");
  });

  it("opens a closed list (A-23) with Cmd+J before it takes the field", async () => {
    await openOrca(overview());
    await $("#orca-list-toggle").click();
    await expect($("#orca-list")).not.toBeDisplayed();
    await cmdJ();
    await expect($("#orca-list")).toBeDisplayed();
    await expect($("#orca-search")).toBeDisplayed();
    expect(await focusedId()).toBe("orca-search-input");
  });

  it("takes Cmd+J from a terminal that has the focus", async () => {
    await openOrca(overview());
    await mock("orca_terminal_read", ["$ ls"]);
    await project("example-app").click();
    await expect($(".orca-term")).toBeDisplayed();
    await browser.execute(() => document.querySelector<HTMLElement>(".orca-term-box:not([hidden]) .xterm-helper-textarea")!.focus());
    await cmdJ();
    expect(await focusedId()).toBe("orca-search-input");
    expect(await names()).toEqual(RUNNING);
  });

  it("does not take J without Cmd, with Shift or with Alt, nor Cmd+J on another screen", async () => {
    await openOrca(overview());
    await cmdJ({ ctrlKey: true });
    await cmdJ({ metaKey: true, shiftKey: true });
    await cmdJ({ metaKey: true, altKey: true });
    expect(await focusedId()).not.toBe("orca-search-input");
    await $("#nav-mail").click();
    await cmdJ();
    expect(await focusedId()).not.toBe("orca-search-input");
  });

  it("keeps the text through a read in the background, and narrows the rows that came", async () => {
    // The clock reads the list every second here.
    await openOrca(overview(), timers({ orcaClock: 1000 }));
    await search("app");
    await mock("orca_overview", orcaOverview(sample(), [...worktrees(), orcaWorktree("example-apple", "main")]));
    await browser.waitUntil(async () => (await names()).length === 2, { timeoutMsg: "the new project never matched" });
    expect(await names()).toEqual(["example-app", "example-apple"]);
    await expect(input()).toHaveValue("app");
  });
});

// A-29: the scratchpad of the work pane's plus. Rust makes the file (and answers the existing one when the name is taken, unit tests); here the screen is checked: the item, the popover, what it asks of Rust, and what opens.
describe("orca: scratchpad (A-29)", () => {
  const MADE = { relative: ".orca/scratchpad/memo.md", existed: false };
  const fileText = (content: string): OrcaFileText => ({ content, crlf: false, signature: "sig-s", language: "plaintext", highlight: null });
  const pop = () => $('.orca-scratch-pop[role="dialog"]');
  const field = () => $('.orca-scratch-pop input[aria-label="ファイル名"]');
  const primary = () => $(".orca-scratch-actions .text-btn.primary");
  // Chooses the scratchpad in the plus of `repo`; with one worktree the popover opens at once.
  async function ask(repo = "example-app") {
    await plus(repo, SCRATCHPAD);
    await expect(pop()).toBeDisplayed();
  }
  const selection = () =>
    browser.execute(() => {
      const input = document.querySelector<HTMLInputElement>(".orca-scratch-pop input")!;
      return [input.selectionStart, input.selectionEnd, input.value];
    });

  it("is the second icon of the plus, with a line icon, and is enabled for a project's row", async () => {
    await openOrca();
    await pickProject("example-app");
    await pressPlus();
    expect(await browser.execute(() => [...document.querySelectorAll('.menu[role="menu"] button')].map((b) => b.getAttribute("aria-label") ?? b.textContent))).toEqual([TERMINAL, SCRATCHPAD, CLAUDE]);
    expect(await count('.menu-icons button[aria-label="スクラッチパッド"] svg')).toBe(1);
    expect(await count('.menu[role="menu"] button:disabled')).toBe(0);
  });

  it("opens a popover under the plus with the fixed folder, the name memo.md with memo selected, and the keys in it", async () => {
    await openOrca();
    await ask();
    await expect($('.menu[role="menu"]')).not.toExist();
    await expect($(".orca-scratch-prefix")).toHaveText(".orca/scratchpad/");
    expect(await selection()).toEqual([0, 4, "memo.md"]);
    await expect(field()).toBeFocused();
    expect(await textsOf(".orca-scratch-actions button")).toEqual(["やめる", "作って開く"]);
    expect(await count(".orca-scratch-pop input[placeholder]")).toBe(0);
    // It is under the plus, inside the window.
    const where = await browser.execute(() => {
      const p = document.querySelector(".orca-scratch-pop")!.getBoundingClientRect();
      const b = document.querySelector(".orca-plus")!.getBoundingClientRect();
      return { belowPlus: p.top >= b.bottom, inside: p.right <= innerWidth && p.left >= 0 };
    });
    expect(where).toEqual({ belowPlus: true, inside: true });
    // Nothing is made until the user asks.
    expect(await callsOf("orca_scratchpad_create")).toHaveLength(0);
  });

  it("makes the file on Enter with the name typed in place of memo, and opens it in the editor", async () => {
    await openOrca();
    const create = await mock("orca_scratchpad_create", { relative: ".orca/scratchpad/notes.md", existed: false });
    const read = await mock("orca_file_read", fileText("a note\n"));
    await ask();
    await browser.keys("notes");
    await browser.keys("Enter");
    expect(await waitForCalls(create)).toEqual([{ path: "/work/example-app", name: "notes.md", environment: null }]);
    expect(await waitForCalls(read)).toEqual([{ path: "/work/example-app", relative: ".orca/scratchpad/notes.md", environment: null }]);
    await expect($(".orca-edit-area")).toHaveValue("a note\n", { trim: false });
    await expect(pop()).not.toExist();
    await expect(selectedTab()).toHaveText(expect.stringContaining("notes.md"));
    await expect($(CARDS)).not.toExist();
  });

  it("makes the file with the target the screen shows when the button 「作って開く」 is pressed", async () => {
    await openOrca(orcaOverview(sample(), worktrees(), studio));
    const create = await mock("orca_scratchpad_create", MADE);
    await mock("orca_file_read", fileText(""));
    await ask();
    await primary().click();
    expect(await waitForCalls(create)).toEqual([{ path: "/work/example-app", name: "memo.md", environment: "Studio" }]);
    await expect(pop()).not.toExist();
    await expect($(".orca-edit-area")).toBeDisplayed();
  });

  it("opens the file that is there already when the name is taken, with no error", async () => {
    await openOrca();
    const create = await mock("orca_scratchpad_create", { ...MADE, existed: true });
    const read = await mock("orca_file_read", fileText("old memo\n"));
    await ask();
    await browser.keys("Enter");
    await waitForCalls(create);
    expect(await waitForCalls(read)).toEqual([{ path: "/work/example-app", relative: ".orca/scratchpad/memo.md", environment: null }]);
    await expect($(".orca-edit-area")).toHaveValue("old memo\n", { trim: false });
    await expect(pop()).not.toExist();
    await expect($(CARDS)).not.toExist();
  });

  it("closes on Escape, on 「やめる」 and on a press outside, and makes nothing", async () => {
    await openOrca();
    const create = await mock("orca_scratchpad_create", MADE);
    await ask();
    await browser.keys("Escape");
    await expect(pop()).not.toExist();
    await ask();
    await $(".orca-scratch-actions .text-btn:not(.primary)").click();
    await expect(pop()).not.toExist();
    await ask();
    // WebDriver's element click sends no pointerdown, which is what closes a popup: the page's own press elsewhere.
    await browser.execute(
      (once) => {
        if (!window.__e2e_once__(once)) return;
        document.getElementById("orca-header")!.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true, cancelable: true, button: 0, pointerId: 5, isPrimary: true }));
      },
      onceId(),
    );
    await expect(pop()).not.toExist();
    await browser.pause(200);
    expect(await callsOf(create)).toEqual([]);
    await expect($(".orca-edit-area")).not.toExist();
  });

  it("does nothing for a blank name and keeps the popover open", async () => {
    await openOrca();
    const create = await mock("orca_scratchpad_create", MADE);
    await ask();
    await field().setValue("   ");
    await browser.keys("Enter");
    await primary().click();
    await browser.pause(300);
    expect(await callsOf(create)).toEqual([]);
    await expect(pop()).toBeDisplayed();
  });

  it("shows the message when the file cannot be made, and keeps the popover open with the text so that it can be pressed again", async () => {
    await openOrca();
    const create = await mock("orca_scratchpad_create", rejects("名前が正しくありません"));
    await mock("orca_file_read", fileText("x"));
    await ask();
    await field().setValue("a/b.md");
    await browser.keys("Enter");
    await waitForCalls(create);
    await expect($(CARD)).toHaveText("名前が正しくありません");
    await expect(pop()).toBeDisplayed();
    await expect(field()).toHaveValue("a/b.md");
    await expect(primary()).toBeEnabled();
    await expect($(".orca-edit-area")).not.toExist();
    await mock("orca_scratchpad_create", { relative: ".orca/scratchpad/b.md", existed: false });
    await field().setValue("b.md");
    await browser.keys("Enter");
    await expect($(".orca-edit-area")).toBeDisplayed();
    await expect(pop()).not.toExist();
  });

  it("asks which worktree when the project has several, then opens the popover for the one picked", async () => {
    await openOrca(orcaOverview(sample(), twoWorktrees()));
    const create = await mock("orca_scratchpad_create", MADE);
    await mock("orca_file_read", fileText(""));
    await plusIn("example-app", SCRATCHPAD, "/work/example-app-b");
    await expect(pop()).toBeDisplayed();
    await expect($(".orca-dest-pop")).not.toExist();
    expect(await callsOf(create)).toEqual([]);
    await browser.keys("Enter");
    expect(await waitForCalls(create)).toEqual([{ path: "/work/example-app-b", name: "memo.md", environment: null }]);
  });

  it("reads again the folders of the file pane that hold the new file when the pane shows that worktree", async () => {
    const entries = (...names: string[]): OrcaDir => ({ entries: names.map((name) => ({ name, path: name, isDirectory: true, ignored: false, icon: null })), total: names.length });
    await openOrca(orcaOverview(sample(), worktrees()), { orca_files_list: entries("src"), orca_files_ignored: [] });
    await pickProject("example-app");
    await filesToggle().click();
    await waitForCount("#orca-files-tree .orca-file", 1);
    const list = await mock("orca_files_list", entries(".orca", "src"));
    await mock("orca_scratchpad_create", MADE);
    await mock("orca_file_read", fileText(""));
    await ask();
    await browser.keys("Enter");
    expect(await waitForCalls(list)).toEqual([{ path: "/work/example-app", dir: "", ignored: false, environment: null }]);
    await waitForCount("#orca-files-tree .orca-file", 2);
  });
});

// The list of a saved environment can hold items of this machine too (#336): an operation on a row, a tab or a worktree goes to the place of that row (the name of its saved environment, null for this machine), whatever target the screen holds.
describe("orca: an operation goes to the place of its row", () => {
  const studioOnly = { target: "Studio", environments: ["Studio"] };
  // example-app is the saved environment Studio's, example-api this machine's. Each has a Claude session and a shell.
  const mixed = (extra: Parameters<typeof orcaOverview>[2] = {}) =>
    onThisMachine(
      orcaOverview(
        [orcaRow("example-app", "feat/a", "Studio task"), orcaRow("example-api", "main", "Mac task")],
        [orcaWorktree("example-app", "feat/a"), orcaWorktree("example-api", "main")],
        { ...studioOnly, terminals: [orcaTerminal("example-app", "zsh"), orcaTerminal("example-api", "zsh")], ...extra },
      ),
      "example-api",
    );
  const shown = ".orca-term-box:not([hidden]) .xterm-helper-textarea";

  it("closes a terminal in the environment of its row, and with null when the row is this machine's", async () => {
    await openOrca(mixed());
    const close = await mock("orca_close", null);
    await project("example-app").click();
    await tabOf("orca:term_example-app_zsh").$(".orca-tab-close").click();
    await project("example-api").click();
    await tabOf("orca:term_example-api_zsh").$(".orca-tab-close").click();
    expect(await waitForCalls(close, 2)).toEqual([
      { handle: "term_example-app_zsh", environment: "Studio" },
      { handle: "term_example-api_zsh", environment: null },
    ]);
  });

  it("starts Claude and a terminal in the environment of the worktree's row, and with null when it is this machine's", async () => {
    await openOrca(mixed());
    const start = await mock("orca_start", noPane);
    const create = await mock("orca_terminal_create", noPane);
    // The plus is enabled again once a start was answered.
    const startIn = async (repo: string, label: string, command: string, calls: number) => {
      await plus(repo, label);
      await waitForCalls(command, calls);
      await expect($(".orca-plus")).toBeEnabled();
    };
    await startIn("example-app", CLAUDE, start, 1);
    await startIn("example-api", TERMINAL, create, 1);
    await startIn("example-api", CLAUDE, start, 2);
    await startIn("example-app", TERMINAL, create, 2);
    expect(await waitForCalls(start, 2)).toEqual([
      { path: "/work/example-app", environment: "Studio" },
      { path: "/work/example-api", environment: null },
    ]);
    expect(await waitForCalls(create, 2)).toEqual([
      { path: "/work/example-api", environment: null },
      { path: "/work/example-app", environment: "Studio" },
    ]);
  });

  it("asks for the layout of each project under the place of its row", async () => {
    await openOrca(mixed());
    await project("example-app").click();
    await project("example-api").click();
    await waitForCalls("orca_panes", 2);
    const calls = (await callsOf("orca_panes")) as { project: string; environment: string | null }[];
    expect([...new Set(calls.map((c) => `${c.project} ${c.environment}`))].sort()).toEqual(["proj_example-api null", "proj_example-app Studio"]);
  });

  it("reads the files of a worktree in the environment of its row, and with null when it is this machine's", async () => {
    await openOrca(mixed(), { orca_files_list: { entries: [], total: 0 }, orca_files_ignored: [] });
    await pickProject("example-app");
    await filesToggle().click();
    await pickProject("example-api");
    await waitForCalls("orca_files_list", 2);
    const calls = (await callsOf("orca_files_list")) as { path: string; environment: string | null }[];
    expect(calls.map((c) => [c.path, c.environment])).toEqual([
      ["/work/example-app", "Studio"],
      ["/work/example-api", null],
    ]);
  });

  describe("on a terminal mirrored", () => {
    // The environment of the list is not one that is saved, so no terminal is streamed: each is read and typed into through the place of its row (this machine's has none to name).
    const mirrored = () => mixed({ environments: [] });
    const type = async (repo: string) => {
      await project(repo).click();
      await tabOf(`orca:term_${repo}_zsh`).$(".orca-tab-btn").click();
      await $(".orca-term .orca-term-box:not([hidden]) .xterm-screen").click();
      // Not a letter from p to {, whose key code xterm.js reads as a function key (the driver gives "x" the code 120, which it sends as F9).
      await browser.keys(["c"]);
    };

    it("reads the screen and types the keys through the environment of its row", async () => {
      await openOrca(mirrored(), { orca_terminal_read: ["$"] });
      const input = await mock("orca_terminal_input", null);
      await type("example-app");
      await type("example-api");
      expect(await waitForCalls(input, 2)).toEqual([
        { handle: "term_example-app_zsh", text: "c", environment: "Studio" },
        { handle: "term_example-api_zsh", text: "c" },
      ]);
      const reads = (await callsOf("orca_terminal_read")) as { handle: string; environment?: string }[];
      expect(reads.filter((r) => r.handle === "term_example-app_zsh").every((r) => r.environment === "Studio")).toBe(true);
      expect(reads.filter((r) => r.handle === "term_example-api_zsh").every((r) => !("environment" in r))).toBe(true);
    });
  });

  it("puts a pasted image in the worktree of the row's environment, and with null when it is this machine's", async () => {
    await openOrca(mixed(), { orca_terminal_read: ["$"] });
    await waitForCalls("orca_stream_open");
    const attach = await mock("orca_attach_file", { text: "/work/example/.orca/drops/shot.png ", bracketed: true });
    await mock("orca_stream_input", null);
    await mock("orca_terminal_input", null);
    await project("example-app").click();
    await waitForCalls("orca_stream_terminal");
    expect(await fire("paste", shown, [image()])).toBe(true);
    await project("example-api").click();
    await waitForCalls("orca_terminal_read");
    expect(await fire("paste", shown, [image()])).toBe(true);
    expect(await waitForCalls(attach, 2)).toEqual([
      { path: "/work/example-app", name: "shot.png", data: PNG, environment: "Studio" },
      { path: "/work/example-api", name: "shot.png", data: PNG, environment: null },
    ]);
  });
});

// A saved environment as the target lists this machine's projects with its own (A-33): one list, the name of the saved environment on the rows that are its, none on this machine's.
describe("orca: this machine and a saved environment in one list (A-33)", () => {
  const studioOnly = { target: "Studio", environments: ["Studio"] };
  // Studio's projects and this machine's, all finished so that the order is the newest activity first: studio-1, mac-1, studio-2, mac-2 (Studio's and this machine's alternate).
  const studioRows = () => [finished("studio-1"), finished("studio-2")];
  const studioTrees = () => [orcaWorktree("studio-1", "main"), orcaWorktree("studio-2", "main")];
  const macRows = () => [finished("mac-1"), finished("mac-2")];
  const macTrees = () => [orcaWorktree("mac-1", "main"), orcaWorktree("mac-2", "main")];
  const activity = <T extends { name: string; atMs: number }>(projects: T[], at: Record<string, number>): T[] => projects.map((p) => ({ ...p, atMs: at[p.name] ?? p.atMs }));
  const ACTIVITY = { "studio-1": 4000, "mac-1": 3000, "studio-2": 2000, "mac-2": 1000 };
  const mac = (rows = macRows(), trees = macTrees()) => {
    const local = beside(rows, trees);
    return { ...local, projects: activity(local.projects, ACTIVITY) };
  };
  // The read of Studio as the target, with this machine's beside it.
  const mixed = (extra: Parameters<typeof orcaOverview>[2] = {}) => {
    const read = orcaOverview(studioRows(), studioTrees(), { ...studioOnly, local: mac(), ...extra });
    return { ...read, projects: activity(read.projects, ACTIVITY) };
  };
  // The name of each project row of the list and the chip it carries (null: none), in the order drawn.
  const chips = () =>
    browser.execute(() =>
      [...document.querySelectorAll<HTMLElement>("#orca-feed .orca-project")].map((row) => [row.querySelector(".orca-project-name")!.textContent, row.querySelector(".orca-env")?.textContent ?? null]),
    );
  const failedRead = (message: string) => orcaOverview([], [], { state: "failed", message, known: false });

  it("draws the projects of both in one list, newest first, with the name of Studio on the rows of Studio and none on this machine's", async () => {
    await openOrca(mixed());
    await waitForCount("#orca-feed .orca-project", 4);
    expect(await chips()).toEqual([
      ["studio-1", "Studio"],
      ["mac-1", null],
      ["studio-2", "Studio"],
      ["mac-2", null],
    ]);
  });

  it("puts the chip at the right end of the project row, after the name, and draws no number of sessions on any row", async () => {
    await openOrca(mixed());
    await waitForCount("#orca-feed .orca-project", 4);
    const box = await browser.execute(() => {
      const row = document.querySelector<HTMLElement>('#orca-feed .orca-project[data-key="proj_studio-1"]') ?? [...document.querySelectorAll<HTMLElement>("#orca-feed .orca-project")].find((r) => r.querySelector(".orca-env"))!;
      const r = (e: Element) => e.getBoundingClientRect();
      const chip = row.querySelector(".orca-env")!;
      return { chipLeft: r(chip).left, chipRight: r(chip).right, nameRight: r(row.querySelector(".orca-project-name")!).right, rowRight: r(row).right, padding: parseFloat(getComputedStyle(row).paddingRight) };
    });
    expect(box.chipLeft).toBeGreaterThanOrEqual(box.nameRight);
    expect(box.chipRight).toBeLessThanOrEqual(box.rowRight);
    // It is the last thing on the row: the free room of the row is left of it.
    expect(box.rowRight - box.padding - box.chipRight).toBeLessThan(2);
    expect(await count("#orca-feed .orca-n")).toBe(0);
  });

  it("puts no chip on the worktree rows of Studio or of this machine, and on no tab", async () => {
    await openOrca(mixed());
    await waitForCount("#orca-feed .orca-worktree", 4);
    const worktrees = await browser.execute(() => [...document.querySelectorAll<HTMLElement>("#orca-feed .orca-worktree")].map((row) => [row.dataset.worktree, row.querySelector(".orca-env")?.textContent ?? null]));
    expect(worktrees).toEqual([
      ["/work/studio-1", null],
      ["/work/mac-1", null],
      ["/work/studio-2", null],
      ["/work/mac-2", null],
    ]);
    await project("studio-1").click();
    expect(await count(".orca-tabs .orca-env")).toBe(0);
  });

  it("shows no chip when this machine is the target", async () => {
    await openOrca(orcaOverview(sample(), worktrees()));
    await waitForCount("#orca-feed .orca-project", 4);
    expect(await count("#orca-feed .orca-env")).toBe(0);
  });

  it("counts only the sessions of the target: a session of this machine that waits does not reach the button", async () => {
    await openOrca(mixed({ local: beside([orcaRow("mac-1", "main", "Mac task", { group: "waiting" })], [orcaWorktree("mac-1", "main")]) }));
    await waitForCount("#orca-feed .orca-project", 3);
    await expectCount(0);
    await sendStream(streamList([finished("studio-1"), orcaRow("studio-2", "main", "Studio task", { group: "waiting" })], studioTrees()));
    await expectCount(1);
  });

  it("marks the icon for a session of this machine that works, and counts it nowhere else (#1266)", async () => {
    await openOrca(mixed({ local: beside([working("mac-1"), orcaRow("mac-2", "main", "Mac task", { group: "waiting" })], macTrees()) }));
    await waitForCount("#orca-feed .orca-project", 4);
    expect(await marked()).toBe(true);
    await expectCount(0);
    await expect($("#nav-orca")).toHaveAttribute("aria-label", "開発（作業中 1 件）");
    await sendStream(streamList([working("studio-1"), finished("studio-2")], studioTrees()));
    await expect($("#nav-orca")).toHaveAttribute("aria-label", "開発（作業中 2 件）");
    await sendStream(streamList([finished("studio-1"), finished("studio-2")], studioTrees()));
    await expect($("#nav-orca")).toHaveAttribute("aria-label", "開発（確認待ち 1 件、作業中 1 件）");
    await expectCount(1);
    expect(await marked()).toBe(true);
  });

  it("starts Claude in a project of this machine and follows the session when the read of this machine holds it", async () => {
    await openOrca(mixed(), timers({ orcaClock: 60_000 }));
    await waitForCalls("orca_stream_open");
    const start = await mock("orca_start", reply);
    const destination = await mock("orca_destination", orcaOverview([...macRows(), orcaRow("mac-1", "main", "New session", { paneKey: "tab_new:leaf_1", handle: "term_new" })], macTrees(), { known: false }));
    await plus("mac-1", CLAUDE);
    expect(await waitForCalls(start)).toEqual([{ path: "/work/mac-1", environment: null }]);
    // The streamed target says nothing of it: the list of this machine is read at once, and the tab is selected when it holds it.
    expect(await waitForCalls(destination)).toEqual([{ environment: null, force: false }]);
    await expect(selectedTab()).toHaveText(expect.stringContaining("New session"));
    await expect($(".toast")).not.toBeDisplayed();
  });

  describe("while the target is streamed", () => {
    it("reads this machine's list every period, and not the target's, and shows what it finds", async () => {
      await openOrca(mixed(), timers({ orcaClock: 1000 }));
      await waitForCalls("orca_stream_open");
      await waitForCount("#orca-feed .orca-project", 4);
      const overview = await mock("orca_overview", mixed());
      const destination = await mock("orca_destination", orcaOverview([...macRows(), finished("mac-3")], [...macTrees(), orcaWorktree("mac-3", "main")], { known: false }));
      await waitForCalls(destination);
      await waitForCount("#orca-feed .orca-project", 5);
      expect(((await callsOf(destination)) as { environment: string | null; force: boolean }[])[0]).toEqual({ environment: null, force: false });
      expect(await callsOf(overview)).toEqual([]);
      expect((await chips()).filter(([, chip]) => chip === null).map(([name]) => name).sort()).toEqual(["mac-1", "mac-2", "mac-3"]);
    });

    it("keeps this machine's projects and says its failure in a line that names it, and the target's too", async () => {
      await openOrca(mixed(), timers({ orcaClock: 1000 }));
      await waitForCalls("orca_stream_open");
      await waitForCount("#orca-feed .orca-project", 4);
      const destination = await mock("orca_destination", failedRead("Orca is busy"));
      await waitForCalls(destination);
      await browser.pause(300);
      expect((await chips()).map(([name]) => name)).toEqual(["studio-1", "mac-1", "studio-2", "mac-2"]);
      expect(await textsOf("#orca-notice > div")).toEqual(["このマシン を読み込めませんでした: Orca is busy"]);
      expect(await count("#orca-notice > .pending.fail")).toBe(1);
      // The target's list goes on: a list of the stream replaces Studio's rows and leaves this machine's.
      await sendStream(streamList([finished("studio-1")], [orcaWorktree("studio-1", "main")]));
      await waitForCount("#orca-feed .orca-project", 3);
      expect((await chips()).map(([name]) => name).sort()).toEqual(["mac-1", "mac-2", "studio-1"]);
    });

    it("keeps Studio's projects beside this machine's when the connection is lost, and says it in the notice", async () => {
      await openOrca(mixed());
      await waitForCalls("orca_stream_open");
      await sendStream({ kind: "status", live: false, message: "Studio is unreachable" });
      await expect($("#orca-notice")).toHaveText("Studio を読み込めませんでした: Studio is unreachable");
      expect(await count("#orca-feed .orca-project")).toBe(4);
      expect((await chips()).filter(([, chip]) => chip === "Studio")).toHaveLength(2);
    });
  });

  it("shows this machine's projects alone when the first read of Studio fails, with the failure said as before", async () => {
    await openOrca(orcaOverview([], [], { state: "failed", message: "Studio is unreachable", ...studioOnly, local: mac() }));
    await waitForCount("#orca-feed .orca-project", 2);
    expect(await chips()).toEqual([
      ["mac-1", null],
      ["mac-2", null],
    ]);
    await expect($("#orca-notice")).toHaveText("Studio を読み込めませんでした: Studio is unreachable");
  });

  it("shows Studio's projects alone when the first read of this machine fails", async () => {
    await openOrca(mixed({ local: { ...beside([], []), state: "failed", message: "Orca is busy" } }));
    await waitForCount("#orca-feed .orca-project", 2);
    expect(await chips()).toEqual([
      ["studio-1", "Studio"],
      ["studio-2", "Studio"],
    ]);
    expect(await textsOf("#orca-notice > div")).toEqual(["このマシン を読み込めませんでした: Orca is busy"]);
  });

  it("says both reads in two lines, this machine's first, and keeps the rows that were read", async () => {
    await openOrca(mixed({ local: { ...beside([], []), state: "failed", message: "Orca is busy" } }));
    await waitForCalls("orca_stream_open");
    await sendStream({ kind: "status", live: false, message: "Studio is unreachable" });
    await browser.waitUntil(async () => (await textsOf("#orca-notice > div")).length === 2, { timeoutMsg: "the second line never came" });
    expect(await textsOf("#orca-notice > div")).toEqual(["このマシン を読み込めませんでした: Orca is busy", "Studio を読み込めませんでした: Studio is unreachable"]);
    expect(await count("#orca-notice > .pending.fail")).toBe(2);
    expect(await count("#orca-feed .orca-project")).toBe(2);
  });

  it("drops the line of a place when it is read well again, and leaves the other's", async () => {
    await openOrca(mixed({ local: { ...beside([], []), state: "failed", message: "Orca is busy" } }), timers({ orcaClock: 1000 }));
    await waitForCalls("orca_stream_open");
    // The clock reads this machine, and its read keeps failing until the mock below.
    await mock("orca_destination", failedRead("Orca is busy"));
    await sendStream({ kind: "status", live: false, message: "Studio is unreachable" });
    await browser.waitUntil(async () => (await textsOf("#orca-notice > div")).length === 2, { timeoutMsg: "the second line never came" });
    // This machine is read by the clock: the line of Studio stays.
    await mock("orca_destination", orcaOverview(macRows(), macTrees(), { known: false }));
    await browser.waitUntil(async () => (await textsOf("#orca-notice > div")).length === 1, { timeoutMsg: "the line of this machine never went" });
    expect(await textsOf("#orca-notice > div")).toEqual(["Studio を読み込めませんでした: Studio is unreachable"]);
    await waitForCount("#orca-feed .orca-project", 4);
    // A list of the stream is Studio's read well: no line is left.
    await sendStream(streamList(studioRows(), studioTrees()));
    await browser.waitUntil(async () => (await textsOf("#orca-notice > div")).length === 0, { timeoutMsg: "the line of Studio never went" });
  });

  // A-12, A-33: this machine's Orca is paired, so it has a stream of its own beside the target's.
  describe("while this machine is paired too", () => {
    const pairing = { orca_pairing_status: { paired: true } };
    const channelCalls = (command: string) =>
      browser.execute((c) => ((window as unknown as { __e2e_calls__: Record<string, { environment: string | null; channel?: unknown }[]> }).__e2e_calls__[c] ?? []).map((call) => ({ ...call, channel: !!call.channel })), command);
    // The number of the call of `orca_stream_open` that is the stream of `environment` (null: this machine's), so that an event goes to the stream of its place.
    async function streamOf(environment: string | null) {
      await waitForCalls("orca_stream_open", 2);
      return (await channelCalls("orca_stream_open")).findIndex((call) => call.environment === environment);
    }
    // The screen with Studio as the target and this machine paired, and the list of each place streamed once.
    async function openBoth(fixtures: Record<string, unknown> = {}) {
      await openOrca(mixed(), { ...pairing, ...fixtures });
      await sendStream(streamList(studioRows(), studioTrees()), await streamOf("Studio"));
      await sendStream(streamList(macRows(), macTrees(), [], null), await streamOf(null));
      await waitForCount("#orca-feed .orca-project", 4);
    }
    // The lines of the log that say the loss of the stream of this machine.
    const lost = async () => (await logged()).filter((l) => l.level === "error" && l.source === "orca" && l.message.startsWith("このマシンの Orca のストリームが落ちました")).map((l) => l.message);

    it("opens the stream of Studio and the stream of this machine, side by side", async () => {
      await openOrca(mixed(), pairing);
      await waitForCalls("orca_stream_open", 2);
      expect(await channelCalls("orca_stream_open")).toEqual(expect.arrayContaining([{ environment: "Studio", channel: true }, { environment: null, channel: true }]));
      expect(await callsOf("orca_stream_open")).toHaveLength(2);
    });

    it("draws each list from the stream of its place, and reads this machine's by the clock no more", async () => {
      await openOrca(mixed(), { ...pairing, ...timers({ orcaClock: 1000 }) });
      await sendStream(streamList(studioRows(), studioTrees()), await streamOf("Studio"));
      await sendStream(streamList([...macRows(), finished("mac-3")], [...macTrees(), orcaWorktree("mac-3", "main")], [], null), await streamOf(null));
      await waitForCount("#orca-feed .orca-project", 5);
      expect((await chips()).filter(([, chip]) => chip === null).map(([name]) => name).sort()).toEqual(["mac-1", "mac-2", "mac-3"]);
      const destination = await mock("orca_destination", orcaOverview(macRows(), macTrees(), { known: false }));
      const overview = await mock("orca_overview", mixed());
      await browser.pause(1200);
      expect(await callsOf(destination)).toEqual([]);
      expect(await callsOf(overview)).toEqual([]);
    });

    it("streams the terminal of a tab of this machine from its stream and that of a tab of Studio from Studio's, with the keys and the size to the same one", async () => {
      await openBoth();
      await project("mac-1").click();
      expect(await waitForCalls("orca_stream_terminal")).toMatchObject([{ environment: null, handle: "term_mac-1" }]);
      await project("studio-1").click();
      expect(await waitForCalls("orca_stream_terminal", 2)).toMatchObject([{ environment: null }, { environment: "Studio", handle: "term_studio-1" }]);
      expect(await callsOf("orca_terminal_read")).toEqual([]);
      const input = await mock("orca_stream_input", null);
      await project("mac-1").click();
      await waitForCalls("orca_stream_terminal", 3);
      await $(".orca-term .orca-term-box:not([hidden]) .xterm-screen").click();
      await browser.keys(["1"]);
      expect(await waitForCalls(input)).toEqual([{ environment: null, handle: "term_mac-1", text: "1", viewport: PANE }]);
      await focusWindow();
      const viewport = await mock("orca_stream_viewport", null);
      await dragDivider(0.15);
      const sent = await waitForCalls(viewport);
      expect(sent.every((c) => (c as { environment: string | null; handle: string }).environment === null && (c as { handle: string }).handle === "term_mac-1")).toBe(true);
    });

    it("says the loss of this machine's stream in the log, reads its list by the clock and mirrors its terminals, leaves Studio's stream, and streams again with the next list", async () => {
      await openBoth(timers({ orcaClock: 1000 }));
      await project("mac-1").click();
      await waitForCalls("orca_stream_terminal");
      const destination = await mock("orca_destination", orcaOverview([...macRows(), finished("mac-3")], [...macTrees(), orcaWorktree("mac-3", "main")], { known: false }));
      const read = await mock("orca_terminal_read", ["$ pwd", "/work/mac-1"]);
      const overview = await mock("orca_overview", mixed());
      await sendStream({ kind: "status", live: false, message: "接続先につながっていません" }, await streamOf(null));
      await waitForCalls(destination);
      await waitForCount("#orca-feed .orca-project", 5);
      expect(await waitForCalls(read)).toMatchObject([{ handle: "term_mac-1" }]);
      expect(await lost()).toEqual(["このマシンの Orca のストリームが落ちました: 接続先につながっていません"]);
      // No notice and no card: the stream of this machine is no failure of the list, and Studio's list is not read by the clock.
      await expect($("#orca-notice")).toHaveText("");
      expect(await callsOf(overview)).toEqual([]);
      expect(await callsOf("orca_stream_close")).toEqual([]);
      await sendStream(streamList(macRows(), macTrees(), [], null), await streamOf(null));
      await waitForCalls("orca_stream_terminal", 2);
      expect(await callsOf("orca_stream_open")).toHaveLength(2);
    });

    it("does not say the loss of the stream of this machine twice for one drop", async () => {
      await openBoth();
      const here = await streamOf(null);
      await sendStream({ kind: "status", live: false, message: "a" }, here);
      await sendStream({ kind: "status", live: false, message: "b" }, here);
      await browser.waitUntil(async () => (await lost()).length > 0, { timeoutMsg: "the loss was never logged" });
      await browser.pause(300);
      expect(await lost()).toEqual(["このマシンの Orca のストリームが落ちました: a"]);
    });

    it("ends only the stream of this machine when the pairing is revoked, mirrors its terminals again and leaves Studio's stream", async () => {
      await openBoth();
      await project("mac-1").click();
      await waitForCalls("orca_stream_terminal");
      await $("#nav-settings").click();
      await $("#settings-tab-orca").click();
      await mock("orca_pairing_revoke", { paired: false });
      await mock("orca_pairing_status", { paired: false });
      await $('#orca-pairing-items [aria-label="ペアリングを取り消す"]').click();
      expect(await waitForCalls("orca_stream_close")).toEqual([{ environment: null }]);
      const read = await mock("orca_terminal_read", ["$ ls"]);
      await $("#nav-orca").click();
      expect(await waitForCalls(read)).toMatchObject([{ handle: "term_mac-1" }]);
      // Studio's list and its stream stay: its tab streams from Studio.
      await project("studio-1").click();
      expect(await waitForCalls("orca_stream_terminal", 2)).toMatchObject([{ environment: null }, { environment: "Studio", handle: "term_studio-1" }]);
      expect(await callsOf("orca_stream_close")).toHaveLength(1);
    });
  });

  it("drops this machine's projects when a read names it as the target", async () => {
    await openOrca(mixed({ environments: ["Studio", "Lab"] }));
    await waitForCount("#orca-feed .orca-project", 4);
    await mock("orca_overview", orcaOverview(macRows(), macTrees(), { environments: ["Studio", "Lab"] }));
    await showAgain();
    await waitForCount("#orca-feed .orca-project", 2);
    expect(await count("#orca-feed .orca-env")).toBe(0);
  });
});

// A-38: the button of the list's header that adds a project. Rust opens the folder dialog and adds the folder (`orca_project_add_here`, unit tests); here the screen is checked: the button, the popup and its select, what it asks of Rust, and the list read again, and for a saved environment the dialog that picks its folder (`orca_browse_dir`, `orca_project_add`).
describe("orca: add a project (A-38)", () => {
  const HERE = "orca_project_add_here";
  const add = () => $("#orca-add");
  const pop = () => $('.orca-add-pop[role="dialog"]');
  const pick = () => $(".orca-add-pop .orca-add-pick");
  // The page's own press of the button (the driver's click focuses the button after the page's handler ran, which no real press does).
  async function press() {
    await browser.execute(
      (id) => {
        if (window.__e2e_once__(id)) document.getElementById("orca-add")!.click();
      },
      onceId(),
    );
    await expect(pop()).toBeDisplayed();
  }
  // Chooses the place `label` in the select, as a user does.
  const choosePlace = (label: string) =>
    browser.execute(
      (id, text) => {
        if (!window.__e2e_once__(id)) return;
        const select = document.querySelector<HTMLSelectElement>(".orca-add-pop select")!;
        select.selectedIndex = [...select.options].findIndex((o) => o.textContent === text);
        select.dispatchEvent(new Event("change", { bubbles: true }));
      },
      onceId(),
      label,
    );
  // The list the screen reads again after a folder was added: one more project than the sample.
  const withNew = () => orcaOverview(sample(), [...worktrees(), orcaWorktree("example-new", "main")]);

  it("has the button in the header after the button of the list, with a label, and opens the popup under it", async () => {
    await openOrca();
    await expect(add()).toHaveAttribute("aria-label", "プロジェクトを追加");
    await expect(add()).toHaveAttribute("aria-haspopup", "dialog");
    expect(await count("#orca-add svg")).toBe(1);
    expect(await count("#orca-header #orca-add")).toBe(1);
    await expect(pop()).not.toExist();
    await press();
    await expect(pop()).toHaveAttribute("aria-label", "プロジェクトを追加");
    await expect(add()).toHaveAttribute("aria-expanded", "true");
    const where = await browser.execute(() => {
      const p = document.querySelector(".orca-add-pop")!.getBoundingClientRect();
      const b = document.getElementById("orca-add")!.getBoundingClientRect();
      return { belowButton: p.top >= b.bottom, inside: p.right <= innerWidth && p.left >= 0 };
    });
    expect(where).toEqual({ belowButton: true, inside: true });
    // The select and the folder button are all it has, and nothing is asked of Rust yet.
    expect(await count(".orca-add-pop select")).toBe(1);
    expect(await textsOf(".orca-add-pop button")).toEqual(["フォルダを選ぶ…"]);
    expect(await count(".orca-add-pop [placeholder]")).toBe(0);
    expect(await callsOf(HERE)).toEqual([]);
  });

  it("lists this Mac first, then the target when it is a saved environment, and starts on this Mac", async () => {
    await openOrca(orcaOverview(sample(), worktrees(), studio));
    await press();
    // Lab is saved too, but the list reads only this Mac and the target, so a project added to Lab would not show.
    expect(await textsOf(".orca-add-pop select option")).toEqual(["この Mac", "Studio"]);
    await expect($(".orca-add-pop select")).toHaveAttribute("aria-label", "場所");
    expect(await browser.execute(() => document.querySelector<HTMLSelectElement>(".orca-add-pop select")!.selectedIndex)).toBe(0);
  });

  it("has only this Mac when no environment is saved", async () => {
    await openOrca();
    await press();
    expect(await textsOf(".orca-add-pop select option")).toEqual(["この Mac"]);
  });

  it("has only this Mac when this Mac is the target, although environments are saved", async () => {
    await openOrca(orcaOverview(sample(), worktrees(), { environments: ["Studio", "Lab"] }));
    await press();
    expect(await textsOf(".orca-add-pop select option")).toEqual(["この Mac"]);
  });

  it("asks Rust to pick and add a folder of this Mac, and reads the list again", async () => {
    await openOrca();
    await waitForCount("#orca-feed .orca-project", 4);
    const here = await mock(HERE, true);
    const read = await mock("orca_overview", withNew());
    await press();
    await pick().click();
    // The page gives no path and no environment: Rust opens the dialog.
    expect(await waitForCalls(here)).toEqual([null]);
    expect(await callsOf(here)).toHaveLength(1);
    await expect(pop()).not.toExist();
    expect((await waitForCalls(read))[0]).toMatchObject({ scope: "full" });
    // The new project has no session, so it is under the link (A-8).
    await expect($("#orca-list .orca-stopped-toggle")).toHaveText("起動していない 1 件");
    await expect($(CARDS)).not.toExist();
  });

  it("reads nothing again when the folder dialog is cancelled", async () => {
    await openOrca();
    const here = await mock(HERE, false);
    const read = await mock("orca_overview", withNew());
    await press();
    await pick().click();
    await waitForCalls(here);
    await expect(pop()).not.toExist();
    await browser.pause(300);
    expect(await callsOf(read)).toEqual([]);
    expect(await count("#orca-feed .orca-project")).toBe(4);
    await expect($(CARDS)).not.toExist();
  });

  it("shows the failure of the add on a card and does not read the list again", async () => {
    await openOrca();
    await waitForCount("#orca-feed .orca-project", 4);
    const here = await mock(HERE, rejects("Orca が時間内に応答しませんでした"));
    const read = await mock("orca_overview", withNew());
    await press();
    await pick().click();
    await waitForCalls(here);
    await expect($(CARD)).toHaveText("Orca が時間内に応答しませんでした");
    await browser.pause(300);
    expect(await callsOf(read)).toEqual([]);
    expect(await count("#orca-feed .orca-project")).toBe(4);
  });

  // The dialog of a saved environment's folder (`ts/orca-browse.ts`), over the folders that `e2e/fixtures.js` lists: / > home > dev (.config, Documents, workspace) > workspace (api, app, web), and /srv with none.
  const BROWSE = "orca_browse_dir";
  const ADD = "orca_project_add";
  const dialog = () => $('.orca-browse[role="dialog"]');
  const filter = () => $(".orca-browse-filter");
  const rows = () => textsOf(".orca-browse-row .orca-browse-name");
  const trail = () => textsOf(".orca-browse-trail .orca-browse-crumb, .orca-browse-trail .orca-browse-here");
  const pathText = async () => (await textsOf(".orca-browse-path"))[0];
  const rowOf = (name: string) => $(`//div[contains(@class,"orca-browse-list")]//button[.//span[@class="orca-browse-name"][. = "${name}"]]`);
  const crumbOf = (name: string) => $(`//div[contains(@class,"orca-browse-trail")]//button[. = "${name}"]`);
  const pickFolder = () => $(".orca-browse-buttons .text-btn.primary");
  const waitForRows = (names: string[]) => browser.waitUntil(async () => JSON.stringify(await rows()) === JSON.stringify(names), { timeoutMsg: `the rows never were ${names.join(", ")}` });
  const waitForPath = (path: string) => browser.waitUntil(async () => (await pathText()) === path, { timeoutMsg: `the path never was ${path}` });
  const cursorOn = () => browser.execute(() => document.querySelector('.orca-browse-row[data-cursor="true"] .orca-browse-name')?.textContent ?? null);
  // The page's own press of 「フォルダを選ぶ…」 for the saved environment Studio, and the dialog with the home folder read.
  async function openDialog() {
    await press();
    await choosePlace("Studio");
    await pick().click();
    await expect(dialog()).toBeDisplayed();
    await waitForRows([".config", "Documents", "workspace"]);
  }
  const openOnStudio = () => openOrca(orcaOverview(sample(), worktrees(), studio));

  it("opens the dialog for a saved environment, with its home folder read, and calls neither command of this Mac", async () => {
    await openOnStudio();
    const here = await mock(HERE, true);
    const added = await mock(ADD, null);
    await openDialog();
    await expect(pop()).not.toExist();
    await expect(dialog()).toHaveAttribute("aria-label", "Studio のフォルダを選ぶ");
    await expect(dialog()).toHaveAttribute("aria-modal", "true");
    expect(await textsOf(".orca-browse-head h2")).toEqual(["Studio のフォルダを選ぶ"]);
    // The home folder is asked for with an empty path, in the environment chosen.
    expect(await callsOf(BROWSE)).toEqual([{ environment: "Studio", path: "" }]);
    expect(await trail()).toEqual(["/", "home", "dev"]);
    expect(await textsOf(".orca-browse-trail .orca-browse-here")).toEqual(["dev"]);
    expect(await pathText()).toBe("/home/dev");
    expect(await textsOf(".orca-browse-buttons button")).toEqual(["キャンセル", "フォルダを選ぶ"]);
    await expect($('.orca-browse [aria-label="上のフォルダ"]')).toBeEnabled();
    await expect($('.orca-browse [aria-label="ホーム"]')).toBeEnabled();
    await expect(filter()).toHaveAttribute("aria-label", "フォルダを絞り込む");
    await expect(filter()).toBeFocused();
    // No help text: no placeholder, and no line but the folders.
    expect(await count(".orca-browse [placeholder]")).toBe(0);
    expect(await count(".orca-browse-note")).toBe(0);
    await browser.pause(300);
    expect(await callsOf(here)).toEqual([]);
    expect(await callsOf(added)).toEqual([]);
    await expect($(CARDS)).not.toExist();
  });

  it("goes into a folder on a press of its row, and back by up, the trail and home", async () => {
    await openOnStudio();
    await openDialog();
    await rowOf("workspace").click();
    await waitForRows(["api", "app", "web"]);
    expect(await callsOf(BROWSE)).toEqual([
      { environment: "Studio", path: "" },
      { environment: "Studio", path: "/home/dev/workspace" },
    ]);
    expect(await trail()).toEqual(["/", "home", "dev", "workspace"]);
    expect(await pathText()).toBe("/home/dev/workspace");
    await $('.orca-browse [aria-label="上のフォルダ"]').click();
    await waitForRows([".config", "Documents", "workspace"]);
    expect((await callsOf(BROWSE)).at(-1)).toEqual({ environment: "Studio", path: "/home/dev" });
    expect(await pathText()).toBe("/home/dev");
    await crumbOf("home").click();
    await waitForRows(["dev"]);
    expect((await callsOf(BROWSE)).at(-1)).toEqual({ environment: "Studio", path: "/home" });
    expect(await trail()).toEqual(["/", "home"]);
    await crumbOf("/").click();
    await waitForRows(["home", "srv"]);
    expect((await callsOf(BROWSE)).at(-1)).toEqual({ environment: "Studio", path: "/" });
    // The root has no folder above it.
    await expect($('.orca-browse [aria-label="上のフォルダ"]')).toBeDisabled();
    expect(await trail()).toEqual(["/"]);
    expect(await pathText()).toBe("/");
    await $('.orca-browse [aria-label="ホーム"]').click();
    await waitForRows([".config", "Documents", "workspace"]);
    expect((await callsOf(BROWSE)).at(-1)).toEqual({ environment: "Studio", path: "" });
    expect(await pathText()).toBe("/home/dev");
  });

  it("narrows the folders by the name typed, and goes to a path that starts with a slash", async () => {
    await openOnStudio();
    await openDialog();
    await filter().setValue("DOC");
    await waitForRows(["Documents"]);
    await filter().setValue("xyz");
    await waitForRows([]);
    await expect($(".orca-browse-note")).toHaveText("フォルダがありません");
    // A name that has a special character of a pattern matches itself.
    await filter().setValue(".con");
    await waitForRows([".config"]);
    // A text that starts with a slash narrows nothing, and Enter goes there.
    await filter().setValue("/srv");
    await waitForRows([".config", "Documents", "workspace"]);
    expect(await callsOf(BROWSE)).toHaveLength(1);
    await browser.keys("Enter");
    await waitForPath("/srv");
    expect((await callsOf(BROWSE)).at(-1)).toEqual({ environment: "Studio", path: "/srv" });
    expect(await trail()).toEqual(["/", "srv"]);
    expect(await rows()).toEqual([]);
    expect(await $(".orca-browse-filter").getValue()).toBe("");
  });

  it("keeps the folder shown and says so when the path typed cannot be read", async () => {
    await openOnStudio();
    await openDialog();
    await filter().setValue("/nowhere");
    await browser.keys("Enter");
    await expect($(".orca-browse-note")).toHaveText("Orca のフォルダの一覧を読めません");
    expect((await callsOf(BROWSE)).at(-1)).toEqual({ environment: "Studio", path: "/nowhere" });
    // The folder shown stays in the trail, so the way back is there; nothing can be added until a folder is read.
    expect(await trail()).toEqual(["/", "home", "dev"]);
    expect(await rows()).toEqual([]);
    expect(await pathText()).toBe("");
    await expect(pickFolder()).toBeDisabled();
    await expect($('.orca-browse [aria-label="上のフォルダ"]')).toBeEnabled();
    await crumbOf("home").click();
    await waitForRows(["dev"]);
    expect(await count(".orca-browse-note")).toBe(0);
    await expect(pickFolder()).toBeEnabled();
    expect(await pathText()).toBe("/home");
  });

  it("shows the words of a failed first read, with nothing to add", async () => {
    await openOnStudio();
    await mock(BROWSE, rejects("Orca のフォルダの一覧を読めません"));
    await press();
    await choosePlace("Studio");
    await pick().click();
    await expect(dialog()).toBeDisplayed();
    await expect($(".orca-browse-note")).toHaveText("Orca のフォルダの一覧を読めません");
    expect(await count(".orca-browse-row")).toBe(0);
    expect(await trail()).toEqual([]);
    expect(await pathText()).toBe("");
    await expect(pickFolder()).toBeDisabled();
    await expect($('.orca-browse [aria-label="上のフォルダ"]')).toBeDisabled();
    // Home is the way out: its answer fills the dialog.
    await mock(BROWSE, { resolvedPath: "/home/dev", folders: ["workspace"] });
    await $('.orca-browse [aria-label="ホーム"]').click();
    await waitForRows(["workspace"]);
    await expect(pickFolder()).toBeEnabled();
    expect(await pathText()).toBe("/home/dev");
  });

  it("draws a folder name as text, and a name with a special character keeps its row", async () => {
    await openOnStudio();
    await mock(BROWSE, { resolvedPath: "/home/dev", folders: ["<b>bold</b>", "a b"] });
    await press();
    await choosePlace("Studio");
    await pick().click();
    await waitForRows(["<b>bold</b>", "a b"]);
    expect(await count(".orca-browse-list b")).toBe(0);
  });

  it("marks a row with the arrow keys, which the path follows, and goes into it with Enter", async () => {
    await openOnStudio();
    await openDialog();
    expect(await cursorOn()).toBeNull();
    await browser.keys("ArrowDown");
    expect(await cursorOn()).toBe(".config");
    expect(await pathText()).toBe("/home/dev/.config");
    await browser.keys(["ArrowDown", "ArrowDown", "ArrowDown"]);
    expect(await cursorOn()).toBe("workspace");
    await browser.keys("ArrowUp");
    expect(await cursorOn()).toBe("Documents");
    expect(await pathText()).toBe("/home/dev/Documents");
    // Typing puts the keys on no row, so the path is the folder shown again.
    await filter().setValue("w");
    expect(await cursorOn()).toBeNull();
    expect(await pathText()).toBe("/home/dev");
    await browser.keys("ArrowUp");
    expect(await cursorOn()).toBe("workspace");
    await browser.keys("Enter");
    await waitForRows(["api", "app", "web"]);
    expect((await callsOf(BROWSE)).at(-1)).toEqual({ environment: "Studio", path: "/home/dev/workspace" });
    expect(await cursorOn()).toBeNull();
    expect(await pathText()).toBe("/home/dev/workspace");
  });

  it("adds the folder shown as a project of the environment, and reads the list again", async () => {
    await openOnStudio();
    await openDialog();
    await rowOf("workspace").click();
    await waitForRows(["api", "app", "web"]);
    const added = await mock(ADD, null);
    const read = await mock("orca_overview", orcaOverview(sample(), [...worktrees(), orcaWorktree("example-new", "main")], studio));
    await pickFolder().click();
    expect(await waitForCalls(added)).toEqual([{ path: "/home/dev/workspace", environment: "Studio" }]);
    await expect(dialog()).not.toExist();
    expect((await waitForCalls(read))[0]).toMatchObject({ scope: "full" });
    await expect($(CARDS)).not.toExist();
  });

  it("adds the folder the keys are on, in place of the one shown", async () => {
    await openOnStudio();
    await openDialog();
    const added = await mock(ADD, null);
    await browser.keys("ArrowDown");
    await pickFolder().click();
    expect(await waitForCalls(added)).toEqual([{ path: "/home/dev/.config", environment: "Studio" }]);
    expect(await callsOf(added)).toHaveLength(1);
    await expect(dialog()).not.toExist();
  });

  it("shows the failure of the add on a card, and reads the list no more", async () => {
    await openOnStudio();
    await openDialog();
    const added = await mock(ADD, rejects("そのフォルダは追加できません"));
    const read = await mock("orca_overview", orcaOverview(sample(), [...worktrees(), orcaWorktree("example-new", "main")], studio));
    await pickFolder().click();
    await waitForCalls(added);
    await expect($(CARD)).toHaveText("そのフォルダは追加できません");
    await expect(dialog()).not.toExist();
    await browser.pause(300);
    expect(await callsOf(read)).toEqual([]);
  });

  it("closes the dialog with キャンセル, the cross, Escape and a press outside, adds nothing, and gives the focus back", async () => {
    await openOnStudio();
    const added = await mock(ADD, null);
    // キャンセル, the cross, Escape and a press on the dimmed part.
    const ways: (() => Promise<unknown>)[] = [
      () => $(".orca-browse-buttons .text-btn:not(.primary)").click(),
      () => $('.orca-browse-head [aria-label="閉じる"]').click(),
      () => browser.keys("Escape"),
      () =>
        browser.execute(() => {
          document.querySelector(".orca-browse-scrim")!.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true }));
        }),
    ];
    for (const close of ways) {
      await openDialog();
      // The screen behind takes no press while the dialog is open.
      expect(await browser.execute(() => (document.getElementById("content") as HTMLElement).inert)).toBe(true);
      await close();
      await expect(dialog()).not.toExist();
      expect(await browser.execute(() => (document.getElementById("content") as HTMLElement).inert)).toBe(false);
      expect(await browser.execute(() => document.activeElement?.id)).toBe("orca-add");
    }
    expect(await callsOf(added)).toEqual([]);
    await expect($(CARDS)).not.toExist();
  });

  it("closes on Escape and adds nothing", async () => {
    await openOrca();
    const here = await mock(HERE, true);
    await press();
    await browser.keys("Escape");
    await expect(pop()).not.toExist();
    expect(await callsOf(here)).toEqual([]);
  });
});

describe("orca: Claude Code opens an HTML preview (A-45)", () => {
  const request = { path: "/work/example-app", relative: "docs/page.html" };
  const PREVIEW_URL = "http://127.0.0.1:12345/tok/docs/page.html";
  const page: OrcaFileText = { content: "<h1>見出し</h1>\n", crlf: false, signature: "sig-1", language: "html", highlight: null };
  const checkArgs = { ...request, environment: null };
  // The screen open with the answers of the file that is opened and of the check that Rust makes again.
  const ready = () => openOrca(orcaOverview(sample(), worktrees()), { orca_files_list: { entries: [], total: 0 }, orca_files_ignored: [], orca_file_read: page, orca_file_preview_url: PREVIEW_URL, orca_preview_check: null });
  const read = () => callsOf("orca_file_read");

  it("opens the file as a preview tab of the project that has the worktree and selects it, after the check of Rust again", async () => {
    await ready();
    await pickProject("example-app");
    const answer = await askScreen("write", "preview-open", request);
    expect(answer).toEqual({ ok: true });
    expect(await callsOf("orca_preview_check")).toEqual([checkArgs]);
    await waitForCount(".orca-edit-preview iframe", 1);
    expect(await tabTitles()).toContain("page.html");
    await expect(selectedTab()).toHaveText(expect.stringContaining("page.html"));
    expect(await callsOf("orca_file_preview_url")).toEqual([checkArgs]);
    await expect($(".orca-edit-preview")).toBeDisplayed();
  });

  it("takes the environment of a request as it is for the check, and does not open a worktree that the list lacks", async () => {
    await ready();
    await pickProject("example-app");
    const answer = await askScreen("write", "preview-open", { ...request, environment: "Studio" });
    // The screen answers once the check has passed; the worktree that the list lacks is a card after it.
    expect(answer).toEqual({ ok: true });
    await expect($(CARD)).toHaveText("そのフォルダは、一覧のプロジェクトにありません");
    expect(await callsOf("orca_preview_check")).toEqual([{ ...checkArgs, environment: "Studio" }]);
    expect(await tabTitles()).not.toContain("page.html");
    expect(await read()).toEqual([]);
  });

  it("opens nothing for a worktree that is not in the list, after it read the list once more", async () => {
    await ready();
    await pickProject("example-app");
    const overview = await mock("orca_overview", orcaOverview(sample(), worktrees()));
    const answer = await askScreen("write", "preview-open", { path: "/work/elsewhere", relative: "page.html" });
    expect(answer).toEqual({ ok: true });
    await expect($(CARD)).toHaveText("そのフォルダは、一覧のプロジェクトにありません");
    expect(await callsOf(overview)).toHaveLength(1);
    expect(await tabTitles()).not.toContain("page.html");
    expect(await read()).toEqual([]);
  });

  it("answers once the check has passed, while the read of the list for a worktree it lacks is still waiting, and opens the tab after it", async () => {
    await ready();
    await pickProject("example-app");
    const made = orcaWorktree("example-app", "feat/b", { path: "/work/example-app-b" });
    const overview = await mock("orca_overview", holds);
    const answer = await askScreen("write", "preview-open", { path: "/work/example-app-b", relative: "page.html" });
    expect(answer).toEqual({ ok: true });
    expect(await callsOf(overview)).toHaveLength(1);
    expect(await callsOf("orca_file_read")).toEqual([]);
    await release(overview, orcaOverview(sample(), [...worktrees(), made]));
    await waitForCount(".orca-edit-preview iframe", 1);
    expect(await tabTitles()).toContain("page.html");
  });

  it("opens nothing when the check of Rust refuses, and the answer holds its reason", async () => {
    await ready();
    await pickProject("example-app");
    await mock("orca_preview_check", rejects("HTML のファイルだけをプレビューで開けます"));
    const answer = await askScreen("write", "preview-open", { path: "/work/example-app", relative: "notes.md" });
    expect(answer).toEqual({ ok: false, error: "HTML のファイルだけをプレビューで開けます" });
    expect(await tabTitles()).not.toContain("notes.md");
    expect(await read()).toEqual([]);
    expect(await callsOf("orca_file_preview_url")).toEqual([]);
  });

  it("only puts the tab in a project that is not selected, and does not select the project or the tab", async () => {
    await ready();
    await pickProject("example-api");
    const answer = await askScreen("write", "preview-open", request);
    expect(answer).toEqual({ ok: true });
    await expect($('#orca-feed .orca-project[data-key="proj_example-api"]')).toHaveAttribute("aria-pressed", "true");
    expect(await tabTitles()).not.toContain("page.html");
    await pickProject("example-app");
    expect(await tabTitles()).toContain("page.html");
  });

  it("opens the tab while the screen is not shown, and has it ready when the screen is shown again", async () => {
    await ready();
    await pickProject("example-app");
    await $("#nav-mail").click();
    await expect($("#orca")).not.toBeDisplayed();
    expect(await askScreen("write", "preview-open", request)).toEqual({ ok: true });
    await expect($("#orca")).not.toBeDisplayed();
    await $("#nav-orca").click();
    await expect($("#orca")).toBeDisplayed();
    await waitForCount(".orca-edit-preview iframe", 1);
    expect(await tabTitles()).toContain("page.html");
  });

  it("refuses a write of a field that the screen does not have", async () => {
    await ready();
    expect(await askScreen("write", "preview-open", { path: "/work/example-app", relative: "page.html", other: "x" })).toMatchObject({ ok: false });
  });
});
