import type { HandoffSummary } from "../../ts/bindings/HandoffSummary";
import type { OrcaStarted } from "../../ts/bindings/OrcaStarted";
import { streamList as streamedList } from "../orca-support";
import { boot, callsOf, claudeReady, claudeSettings, composerLayout, count, fire, formationEntry, formationList, handoffSummary, heightOf, holds, huge, image, inbox, listedChild, mock, note, onceId, orcaOverview, orcaRow, orcaWorktree, PNG, rejects, release, slackLoad, sendStream, slackThread, slackTs, streamList, textsOf, threadMessage, timeline, timelineMessage, todoData, waitForCalls, waitForCard, waitForCount, CARDS, WARN_CARDS } from "../support";

// A finished agent has one stop time that every read of it repeats, as Orca's `updatedAt` does (A-6: a stopped row with a newer time is a new notice).
const DONE_AT = Date.now() - 18 * 60_000 - 5_000;
// A waiting, a working and a done agent (all have a terminal), and a working one with no terminal. The pane lists none of them (it hands over to a new session only), but the Orca screen does.
const sample = () => [
  orcaRow("example-api", "main", "Fix the parser", { group: "waiting", minutes: 5 }),
  orcaRow("example-app", "feat/a", "Write the docs", { minutes: 2 }),
  orcaRow("example-lib", "feature/x", "Opened the pull request.", { group: "done", atMs: DONE_AT }),
  orcaRow("example-web", "dev", "Update the page", { minutes: 11, handle: null, paneKey: null }),
];
const worktrees = () => [orcaWorktree("example-app", "feat/a"), orcaWorktree("example-api", "main")];
// What a launch answers, and the row the list then holds for that session.
const started: OrcaStarted = { paneKey: "tab_new:leaf_9", handle: "term_new" };
const newRow = () => orcaRow("example-app", "feat/a", "Fix the invoice", { minutes: 1, handle: "term_new", paneKey: "tab_new:leaf_9", path: "/work/example-app" });

const bootOrca = (fixtures: Record<string, unknown> = {}) =>
  boot({ inbox: inbox(), orca_overview: orcaOverview(sample(), worktrees()), claude_status: claudeReady, ...fixtures });

// ---- the three screens ----

const TODO = { pane: "#todo-handoff", button: "#todo-orca-open" };
const SLACK = { pane: "#st-orca", button: "#reply-tab-orca" };
type Screen = typeof TODO;

const rootTs = slackTs(60, 1);
const replyTs = slackTs(50, 2);
const newerTs = slackTs(30, 3);
// The Slack thread "#dev-billing" (two messages) open, with its Orca tab not selected yet. The feed lists "#ops" first, a second thread that the tests go to.
async function openSlack(fixtures: Record<string, unknown> = {}) {
  const messages = [timelineMessage(newerTs, "Carol Example", "ops", "Second thread root", { replyCount: 0, channel: "C2" }), timelineMessage(rootTs, "Alice Example", "dev-billing", "Please review the deploy notes.", { replyCount: 1 })];
  await bootOrca({ slack_load: slackLoad, slack_timeline: timeline(messages), claude_status: claudeReady, ...fixtures });
  await mock("slack_thread", slackThread([threadMessage(rootTs, "Alice Example", "Please review the deploy notes."), threadMessage(replyTs, "Bob Example", "Looks fine to me.")]));
  await $("#nav-slack").click();
  await waitForCount("#slack-feed .feed-row", 2);
  await (await $$("#slack-feed .feed-open"))[1].click();
  await waitForCount("#st-msgs .st-msg", 2);
}

// Back to the feed, and into the thread of the row `row` (0: "#ops", 1: "#dev-billing", the one the tests start in).
async function openThread(row: 0 | 1) {
  if (await $("#slack-thread").isDisplayed()) await $("#st-back").click();
  await (await $$("#slack-feed .feed-open"))[row].click();
  await waitForCount("#st-msgs .st-msg", 2);
}

async function openTodo(fixtures: Record<string, unknown> = {}) {
  await bootOrca({ todoist_load: todoData(), slack_load: slackLoad, claude_status: claudeReady, ...fixtures });
  await $("#nav-todo").click();
  await waitForCount("#todo-list li.task", 1);
  await $("#todo-list li.task").click();
  await expect($("#todo-detail")).toBeDisplayed();
}

// A hand-over moves to the Orca screen (A-9): this goes back to the screen of the item, where the pane shows the session.
async function backTo(screen: Screen) {
  await expect($("#orca")).toBeDisplayed();
  if (screen === SLACK) {
    // The thread stays open while another screen is shown, so the pane keeps its session.
    await $("#nav-slack").click();
    if (!(await $("#slack-thread").isDisplayed())) await openThread(1);
    await expect($("#slack-thread")).toBeDisplayed();
    return;
  }
  await $("#nav-todo").click();
  if (!(await $("#todo-detail").isDisplayed())) {
    await waitForCount("#todo-list li.task", 1);
    await $("#todo-list li.task").click();
  }
  await expect($("#todo-detail")).toBeDisplayed();
}

// The list of Orca is read when the pane opens: the project chip is enabled once the projects are in.
const listRead = (screen: Screen) => expect($(`${screen.pane} .ho-project`)).toBeEnabled();

// Opens the pane of the screen shown: the header button of the Todo, the Orca tab of the Slack thread. The list of Orca is read when it opens.
async function openPane(screen: Screen) {
  await $(screen.button).click();
  await expect($(screen.pane)).toBeDisplayed();
  await listRead(screen);
}

const field = (screen: Screen) => $(`${screen.pane} textarea`);
// The card of the session in the pane, and its button that opens the session on the Orca screen.
const sessionOpen = (screen: Screen) => $(`${screen.pane} .ho-session-open`);
// What the pane has of a terminal after a send: nothing (the session is on the Orca screen), and no note either.
const terminalParts = (screen: Screen) => count(`${screen.pane} .ho-term, ${screen.pane} .orca-term-box, ${screen.pane} .ho-note`);
// The arrow in the field of the instruction.
const sendButton = (screen: Screen) => $(`${screen.pane} .ho-form .chat-send`);
// The model and effort of the summary, in the frame of the field.
const selectOf = (screen: Screen, kind: "model" | "effort") => $(`${screen.pane} #handoff-model select[data-purpose="orcaHandoff"][data-kind="${kind}"]`);

// Picks the project named `name` in the menu of its chip: the worktree is then the project's own folder (default).
async function chooseProject(screen: Screen, name: string) {
  await $(`${screen.pane} .ho-project`).click();
  await $(`//div[@role="menu"]//button[normalize-space(.)="${name}"]`).click();
}

// Picks 新規作成 in the menu of the worktree chip.
async function chooseNewWorktree(screen: Screen) {
  await $(`${screen.pane} .ho-worktree`).click();
  await $('//div[@role="menu"]//button[normalize-space(.)="新規作成"]').click();
}

// The rows of the open menu as "{name} / {branch}" for a worktree (two lines) and the label alone for any other row, those the search leaves.
const menuRows = () =>
  browser.execute(() =>
    [...document.querySelectorAll(".menu [role=menuitem]")]
      .filter((b) => !(b as HTMLElement).hidden)
      .map((b) => [...b.querySelectorAll(".menu-main, .menu-sub")].map((e) => e.textContent).join(" / ") || (b.textContent?.trim() ?? "")),
  );
// The row of the worktree named `name` in the open menu.
const worktreeRow = (name: string) => $(`//div[@role="menu"]//button[.//span[@class="menu-main" and normalize-space(.)="${name}"]]`);

// What `claude_summarize_handoff` answers by default, and the arguments `orca_handoff` and `claude_summarize_handoff` are called with.
const POINTS = ["請求書の金額を直す", "テストを足す"];
type Handed = { destination: unknown; instruction: string; files: string[]; summary: string[]; context: { kind: string; title: string; body: string } | null; environment: string | null };
type Asked = { context: { kind: string; title: string; body: string }; instruction: string };

// Writes the instruction and makes Claude answer `summary` for the content when the button hands it over (the mock is returned, and its calls are the asks). The press of the button is the test's.
async function write(screen: Screen, text: string, summary: HandoffSummary = handoffSummary(POINTS)) {
  const ask = await mock("claude_summarize_handoff", summary);
  await field(screen).setValue(text);
  return ask;
}

describe("orca handoff", () => {
  it("opens from the Orca tab of the Slack thread, with its destinations, the card and the empty instruction", async () => {
    await openSlack();
    await expect($(SLACK.button)).toHaveAttribute("role", "tab");
    await expect($(SLACK.button)).toHaveAttribute("aria-selected", "false");
    await expect($(SLACK.pane)).not.toBeDisplayed();
    await $(SLACK.button).click();
    await expect($(SLACK.button)).toHaveAttribute("aria-selected", "true");
    await expect($(SLACK.pane)).toBeDisplayed();
    // The tab names the pane, so the form has no title row of its own.
    expect(await count(`${SLACK.pane} .ho-head:not([hidden])`)).toBe(0);
    await listRead(SLACK);
    // The chips of a new session run destination, project, worktree (no project chosen yet, so the worktree waits), and no running session is listed.
    expect(await textsOf(`${SLACK.pane} .ho-new button:not([hidden])`)).toEqual(["このマシン", "プロジェクトを選ぶ", "default"]);
    await expect($(`${SLACK.pane} .ho-project`)).toHaveAttribute("aria-label", "プロジェクト");
    await expect($(`${SLACK.pane} .ho-worktree`)).toBeDisabled();
    await expect($(`${SLACK.pane} .ho-name`)).not.toBeDisplayed();
    expect(await count(`${SLACK.pane} .ho-row, ${SLACK.pane} .ho-group, ${SLACK.pane} .ho-new-btn`)).toBe(0);
    // The card names the content: the channel, the senders and the number of messages, and has no button to read the text.
    expect(await textsOf(`${SLACK.pane} .ho-card-title`)).toEqual(["#dev-billing のスレッド"]);
    expect(await textsOf(`${SLACK.pane} .ho-card-meta`)).toEqual(["Alice Example ほか ・ 2 件"]);
    await expect($(`${SLACK.pane} [aria-label="渡す内容を外す"]`)).toBeDisplayed();
    expect(await count(`${SLACK.pane} .ho-card-toggle, ${SLACK.pane} .ho-card-body`)).toBe(0);
    await expect(field(SLACK)).toHaveAttribute("aria-label", "Orca への指示");
    await expect(sendButton(SLACK)).toHaveAttribute("aria-label", "Orca に渡す");
    await expect(sendButton(SLACK)).toBeDisabled();
    // The model and effort of the summary are in the frame of the field, and there is no note while Claude can be used.
    await expect(selectOf(SLACK, "model")).toBeDisplayed();
    await expect(selectOf(SLACK, "effort")).toBeDisplayed();
    await expect($(`${SLACK.pane} .chat-note`)).not.toBeDisplayed();
  });

  it("lays the form out from the top down, with the instruction in the frame of the composer: one line high, the selects at the left and the round arrow at the right", async () => {
    await openSlack();
    await openPane(SLACK);
    await expect(selectOf(SLACK, "model")).toBeDisplayed();
    const box = await browser.execute((pane) => {
      const rect = (selector: string) => {
        const r = document.querySelector(`${pane} ${selector}`)!.getBoundingClientRect();
        return { top: r.top, bottom: r.bottom, left: r.left, right: r.right };
      };
      return { chips: rect(".ho-new"), card: rect(".ho-card"), frame: rect(".composer") };
    }, SLACK.pane);
    // Chips, then the card, then the frame of the field.
    expect(box.chips.bottom).toBeLessThanOrEqual(box.card.top);
    expect(box.card.bottom).toBeLessThanOrEqual(box.frame.top);
    expect(await composerLayout("handoff")).toEqual({ framed: [true, true, true], modelBelowInput: true, sendRightOfModel: true, sendInsideFrame: true, sendRadius: "50%", placeholder: null });
    // The field starts as one line, not three.
    expect(await heightOf("#handoff-input")).toBe(20);
    // No button with words in the form (the summary and revise buttons are gone).
    expect(await textsOf(`${SLACK.pane} .ho-form button:not(.review-chip):not(.icon-btn)`)).toEqual([]);
  });

  it("grows the field with its lines, and goes back to one line when the text is short again", async () => {
    await openSlack();
    await openPane(SLACK);
    const type = (text: string) =>
      browser.execute((t) => {
        const input = document.querySelector<HTMLTextAreaElement>("#handoff-input")!;
        input.value = t;
        input.dispatchEvent(new Event("input", { bubbles: true }));
      }, text);
    await type("一行目\n二行目\n三行目");
    expect(await heightOf("#handoff-input")).toBe(60);
    await type("一行");
    expect(await heightOf("#handoff-input")).toBe(20);
  });

  it("saves the model with the purpose orcaHandoff and no effort, and the effort with both, and the hand-over still calls the same commands", async () => {
    await openSlack();
    await openPane(SLACK);
    await expect(selectOf(SLACK, "model")).toHaveValue("sonnet");
    await expect(selectOf(SLACK, "effort")).toHaveValue("medium");
    expect(await selectOf(SLACK, "model").$$("option").map((o) => o.getText())).toEqual(["Haiku", "Sonnet", "Opus"]);
    await expect(selectOf(SLACK, "model")).toHaveAttribute("aria-label", "モデル");
    // In the row of the frame under the field.
    expect(await browser.execute(() => document.querySelector("#handoff-form > .composer > .composer-foot")?.firstElementChild?.id)).toBe("handoff-model");
    const choose = (kind: "model" | "effort", value: string) =>
      browser.execute(
        (id, k, v) => {
          if (!window.__e2e_once__(id)) return;
          const select = document.querySelector<HTMLSelectElement>(`#handoff-model select[data-purpose="orcaHandoff"][data-kind="${k}"]`)!;
          select.value = v;
          select.dispatchEvent(new Event("change", { bubbles: true }));
        },
        onceId(),
        kind,
        value,
      );
    const save = await mock("claude_model_settings_save", { ...claudeSettings, orcaHandoff: { model: "opus", effort: "medium" } });
    await choose("model", "opus");
    expect(await waitForCalls(save)).toEqual([{ purpose: "orcaHandoff", model: "opus" }]);
    await expect(selectOf(SLACK, "model")).toHaveValue("opus");
    const saveEffort = await mock("claude_model_settings_save", { ...claudeSettings, orcaHandoff: { model: "opus", effort: "max" } });
    await choose("effort", "max");
    expect(await waitForCalls(saveEffort)).toEqual([{ purpose: "orcaHandoff", model: "opus", effort: "max" }]);
    await expect(selectOf(SLACK, "effort")).toHaveValue("max");
    // The send is the same as without the selects.
    const handoff = await mock("orca_handoff", started);
    await chooseProject(SLACK, "example-app");
    const ask = await write(SLACK, "請求書を直して");
    await sendButton(SLACK).click();
    const [call] = (await waitForCalls(handoff)) as Handed[];
    expect(call.instruction).toBe("請求書を直して");
    expect(call.summary).toEqual(POINTS);
    expect(((await waitForCalls(ask)) as Asked[])[0].instruction).toBe("請求書を直して");
  });

  it("draws the model and effort in the frame of every pane that is open, the Slack thread's and the Todo's alike", async () => {
    await openSlack({ todoist_load: todoData() });
    await openPane(SLACK);
    await $("#nav-todo").click();
    await waitForCount("#todo-list li.task", 1);
    await $("#todo-list li.task").click();
    await $(TODO.button).click();
    await listRead(TODO);
    for (const screen of [SLACK, TODO]) {
      await expect(selectOf(screen, "model")).toHaveValue("sonnet");
      await expect(selectOf(screen, "effort")).toHaveValue("medium");
    }
  });

  it("hands over with Cmd+Enter (Ctrl+Enter off macOS) as the arrow does, and not while the instruction is blank", async () => {
    await openSlack();
    const handoff = await mock("orca_handoff", started);
    await openPane(SLACK);
    await chooseProject(SLACK, "example-app");
    const ask = await write(SLACK, "");
    const press = (composing = false) =>
      browser.execute(
        (pane, c) => {
          const mac = /Mac/.test(navigator.platform);
          const key = new KeyboardEvent("keydown", { key: "Enter", metaKey: mac, ctrlKey: !mac, isComposing: c, bubbles: true, cancelable: true });
          document.querySelector(`${pane} textarea`)!.dispatchEvent(key);
        },
        SLACK.pane,
        composing,
      );
    // Blank: nothing is asked or handed over.
    await press();
    await browser.pause(200);
    expect(await callsOf(ask)).toHaveLength(0);
    expect(await callsOf(handoff)).toHaveLength(0);
    // The Enter that confirms an IME conversion sends nothing.
    await field(SLACK).setValue("確定");
    await press(true);
    await browser.pause(200);
    expect(await callsOf(handoff)).toHaveLength(0);
    await mock("orca_overview", orcaOverview([...sample(), newRow()], worktrees()));
    await press();
    const [call] = (await waitForCalls(handoff)) as Handed[];
    expect(call.instruction).toBe("確定");
    expect(call.summary).toEqual(POINTS);
  });

  it("lists the projects of the destination in the menu of the project chip, and the worktree menu offers the project's own folder and 新規作成", async () => {
    // The projects are those of the list, here the two that have a folder.
    const project = (name: string) => ({ key: `proj_${name}`, name, status: "idle" as const, sessions: 0, atMs: 0 });
    await openSlack({ orca_overview: orcaOverview(sample(), worktrees(), { projects: [project("example-app"), project("example-api")] }) });
    await openPane(SLACK);
    await $(`${SLACK.pane} .ho-project`).click();
    expect(await textsOf(".menu [role=menuitem]")).toEqual(["example-app", "example-api"]);
    await $('//div[@role="menu"]//button[normalize-space(.)="example-api"]').click();
    expect(await textsOf(`${SLACK.pane} .ho-project`)).toEqual(["example-api"]);
    // The branch is the one checked out in the project's folder now.
    await $(`${SLACK.pane} .ho-worktree`).click();
    expect(await menuRows()).toEqual(["default / main", "新規作成"]);
    await expect(worktreeRow("default")).toHaveAttribute("aria-current", "true");
    await $('//div[@role="menu"]//button[normalize-space(.)="新規作成"]').click();
    expect(await textsOf(`${SLACK.pane} .ho-worktree`)).toEqual(["新規作成"]);
    await expect($(`${SLACK.pane} .ho-fresh`)).toBeDisplayed();
    await expect($(`${SLACK.pane} .ho-name`)).toBeDisplayed();
    await expect($(`${SLACK.pane} .ho-name`)).toHaveAttribute("aria-label", "worktree の名前");
    expect(await browser.execute(() => (document.querySelector("#st-orca .ho-name") as HTMLInputElement).placeholder)).toBe("");
    // Back to the project's own folder hides the name again.
    await $(`${SLACK.pane} .ho-worktree`).click();
    await worktreeRow("default").click();
    await expect($(`${SLACK.pane} .ho-name`)).not.toBeDisplayed();
    await expect($(`${SLACK.pane} .ho-fresh`)).not.toBeDisplayed();
  });

  it("leaves the worktree of a formation's child out of the menu of the worktree chip, and offers the others (A-9, #947)", async () => {
    const list = [orcaWorktree("example-app", "feat/b", { path: "/work/example-app-b", branch: "fix-b" }), orcaWorktree("example-app", "feat/c", { path: "/work/example-app-c", branch: "child-c" }), ...worktrees()];
    const children = formationList([formationEntry("formation", { children: [listedChild("child-c", "working", { repo: "example-app", branch: "feat/c", path: "/work/example-app-c" })] })]);
    await openSlack({ orca_overview: orcaOverview(sample(), list), formation_list: children });
    await openPane(SLACK);
    await chooseProject(SLACK, "example-app");
    await $(`${SLACK.pane} .ho-worktree`).click();
    await browser.waitUntil(async () => (await menuRows()).length > 0);
    expect(await menuRows()).toEqual(["default / feat/a", "fix-b / feat/b", "新規作成"]);
  });

  it("keeps the folder of a child that works in a folder that was there in the menu of the worktree chip (A-9, #947)", async () => {
    const list = [orcaWorktree("example-app", "feat/b", { path: "/work/example-app-b", branch: "fix-b" }), ...worktrees()];
    const children = formationList([formationEntry("formation", { children: [listedChild("child-a", "working", { repo: "example-app", branch: "feat/a", path: "/work/example-app", created: false })] })]);
    await openSlack({ orca_overview: orcaOverview(sample(), list), formation_list: children });
    await openPane(SLACK);
    await chooseProject(SLACK, "example-app");
    await $(`${SLACK.pane} .ho-worktree`).click();
    await browser.waitUntil(async () => (await menuRows()).length > 0);
    expect(await menuRows()).toEqual(["default / feat/a", "fix-b / feat/b", "新規作成"]);
  });

  it("lists the worktrees of the project with the branch under the name, the own folder first and 新規作成 last, narrows them by name or branch, and hands over in the one chosen", async () => {
    const list = [orcaWorktree("example-app", "feat/b", { path: "/work/example-app-b", branch: "fix-b" }), ...worktrees()];
    await openSlack({ orca_overview: orcaOverview(sample(), list) });
    const handoff = await mock("orca_handoff", started);
    await openPane(SLACK);
    await chooseProject(SLACK, "example-app");
    expect(await textsOf(`${SLACK.pane} .ho-worktree`)).toEqual(["default ・ feat/a"]);
    await $(`${SLACK.pane} .ho-worktree`).click();
    expect(await menuRows()).toEqual(["default / feat/a", "fix-b / feat/b", "新規作成"]);
    await expect($(".menu .menu-search")).toHaveAttribute("aria-label", "worktree を検索");
    // The search holds the name or the branch, as the menu of the projects does.
    await $(".menu .menu-search").setValue("feat/");
    expect(await menuRows()).toEqual(["default / feat/a", "fix-b / feat/b"]);
    await $(".menu .menu-search").setValue("zzz");
    expect(await menuRows()).toEqual([]);
    await expect($(".menu .menu-empty")).toHaveText("一致する worktree がありません");
    await $(".menu .menu-search").setValue("fix");
    expect(await menuRows()).toEqual(["fix-b / feat/b"]);
    await worktreeRow("fix-b").click();
    expect(await textsOf(`${SLACK.pane} .ho-worktree`)).toEqual(["fix-b ・ feat/b"]);
    await expect($(`${SLACK.pane} .ho-fresh`)).not.toBeDisplayed();
    await $(`${SLACK.pane} .ho-worktree`).click();
    await expect(worktreeRow("fix-b")).toHaveAttribute("aria-current", "true");
    await browser.keys("Escape");
    await write(SLACK, "やって");
    await sendButton(SLACK).click();
    const [call] = (await waitForCalls(handoff)) as Handed[];
    expect(call.destination).toEqual({ kind: "new", path: "/work/example-app-b" });
  });

  it("clears the worktree chosen when the project changes", async () => {
    const list = [orcaWorktree("example-app", "feat/b", { path: "/work/example-app-b", branch: "fix-b" }), ...worktrees()];
    await openSlack({ orca_overview: orcaOverview(sample(), list) });
    await openPane(SLACK);
    await chooseProject(SLACK, "example-app");
    await $(`${SLACK.pane} .ho-worktree`).click();
    await worktreeRow("fix-b").click();
    expect(await textsOf(`${SLACK.pane} .ho-worktree`)).toEqual(["fix-b ・ feat/b"]);
    await chooseProject(SLACK, "example-api");
    expect(await textsOf(`${SLACK.pane} .ho-worktree`)).toEqual(["default ・ main"]);
    await chooseProject(SLACK, "example-app");
    expect(await textsOf(`${SLACK.pane} .ho-worktree`)).toEqual(["default ・ feat/a"]);
  });

  describe("the frame of a worktree to make", () => {
    const BRANCHES = [
      { name: "feat/a", current: true, inUse: false },
      { name: "main", current: false, inUse: true },
      { name: "feat/c", current: false, inUse: false },
    ];
    const REMOTES = [{ name: "origin/feat/d", localName: "feat/d" }];
    const dialogRows = () => textsOf(".orca-dest-pop .orca-branch-row");
    const branchRow = (name: string) => $(`.orca-dest-pop .orca-branch-row[data-name="${name}"]`);

    // The pane at 新規作成, with the branches the lists answer.
    async function openFresh() {
      await openSlack();
      await mock("orca_local_branches", BRANCHES);
      await mock("orca_remote_branches", REMOTES);
      await openPane(SLACK);
      await chooseProject(SLACK, "example-app");
      await chooseNewWorktree(SLACK);
    }

    it("shows the name, the ref and the branch under headings, with the defaults", async () => {
      await openFresh();
      expect(await textsOf(`${SLACK.pane} .ho-fresh .ho-field-title`)).toEqual(["名前", "作成元", "ブランチ"]);
      expect(await textsOf(`${SLACK.pane} .ho-base`)).toEqual(["既定"]);
      await expect($(`${SLACK.pane} .ho-base`)).toHaveAttribute("aria-label", "作成元");
      expect(await textsOf(`${SLACK.pane} .ho-seg button`)).toEqual(["新しいブランチ", "既存のブランチ"]);
      expect(await browser.execute(() => [...document.querySelectorAll("#st-orca .ho-seg button")].map((b) => b.getAttribute("aria-pressed")))).toEqual(["true", "false"]);
      await expect($(`${SLACK.pane} .ho-branch`)).toBeDisplayed();
      await expect($(`${SLACK.pane} .ho-branch`)).toHaveAttribute("aria-label", "ブランチの名前");
      expect(await browser.execute(() => (document.querySelector("#st-orca .ho-branch") as HTMLInputElement).placeholder)).toBe("");
      await expect($(`${SLACK.pane} .ho-existing`)).not.toBeDisplayed();
    });

    it("picks the ref to start from in the list of branches, 既定 first and none refused, and passes it with the name of the new branch to orca_worktree_create", async () => {
      await openFresh();
      const create = await mock("orca_worktree_create", "/work/example-app-fix-invoice");
      const handoff = await mock("orca_handoff", started);
      await $(`${SLACK.pane} .ho-base`).click();
      await waitForCount(".orca-dest-pop .orca-branch-row", 5);
      expect(await dialogRows()).toEqual(["既定", "feat/a", "main", "feat/c", "origin/feat/d"]);
      expect(await count(".orca-dest-pop .orca-branch-row:disabled")).toBe(0);
      expect(await callsOf("orca_local_branches")).toEqual([{ path: "/work/example-app", environment: null }]);
      expect(await callsOf("orca_remote_branches")).toEqual([{ path: "/work/example-app", repo: "proj_example-app", query: "", environment: null }]);
      await branchRow("origin/feat/d").click();
      expect(await textsOf(`${SLACK.pane} .ho-base`)).toEqual(["origin/feat/d"]);
      await $(`${SLACK.pane} .ho-name`).setValue("fix-invoice");
      await $(`${SLACK.pane} .ho-branch`).setValue(" feat/invoice ");
      await write(SLACK, "請求書を直して");
      await sendButton(SLACK).click();
      expect(await waitForCalls(create)).toEqual([{ project: "proj_example-app", name: "fix-invoice", branch: "feat/invoice", base: "origin/feat/d", environment: null }]);
      await waitForCalls(handoff);
    });

    it("remembers a remote branch picked as the ref or as the existing branch, and a local branch not (A-9, A-25)", async () => {
      await openFresh();
      const used = await mock("orca_branch_used", null);
      await $(`${SLACK.pane} .ho-base`).click();
      await waitForCount(".orca-dest-pop .orca-branch-row", 5);
      await branchRow("feat/c").click();
      await browser.pause(300);
      expect(await callsOf(used)).toEqual([]);
      await $(`${SLACK.pane} .ho-base`).click();
      await waitForCount(".orca-dest-pop .orca-branch-row", 5);
      await branchRow("origin/feat/d").click();
      expect(await waitForCalls(used)).toEqual([{ repo: "proj_example-app", name: "origin/feat/d", environment: null }]);
      await $(`${SLACK.pane} .ho-seg button:nth-of-type(2)`).click();
      await $(`${SLACK.pane} .ho-existing`).click();
      await waitForCount(".orca-dest-pop .orca-branch-row", 4);
      await branchRow("origin/feat/d").click();
      expect(await waitForCalls(used, 2)).toEqual([
        { repo: "proj_example-app", name: "origin/feat/d", environment: null },
        { repo: "proj_example-app", name: "origin/feat/d", environment: null },
      ]);
    });

    it("picks the ref and shows no error when remembering the remote branch fails (A-9)", async () => {
      await openFresh();
      await mock("orca_branch_used", rejects("orca-branch-recent.json を書けません"));
      await $(`${SLACK.pane} .ho-base`).click();
      await waitForCount(".orca-dest-pop .orca-branch-row", 5);
      await branchRow("origin/feat/d").click();
      await waitForCalls("orca_branch_used");
      expect(await textsOf(`${SLACK.pane} .ho-base`)).toEqual(["origin/feat/d"]);
      await expect($(CARDS)).not.toExist();
    });

    it("goes back to 既定 with the first row of the list", async () => {
      await openFresh();
      await $(`${SLACK.pane} .ho-base`).click();
      await waitForCount(".orca-dest-pop .orca-branch-row", 5);
      await branchRow("feat/c").click();
      expect(await textsOf(`${SLACK.pane} .ho-base`)).toEqual(["feat/c"]);
      await $(`${SLACK.pane} .ho-base`).click();
      await waitForCount(".orca-dest-pop .orca-branch-row", 5);
      await expect(branchRow("feat/c")).toHaveAttribute("aria-current", "true");
      await $$(".orca-dest-pop .orca-branch-row")[0].click();
      expect(await textsOf(`${SLACK.pane} .ho-base`)).toEqual(["既定"]);
    });

    it("folds the remote branches after the fifth in the list of the ref too, with the button for the rest", async () => {
      await openFresh();
      await mock("orca_remote_branches", Array.from({ length: 6 }, (_, i) => ({ name: `origin/r${i + 1}`, localName: `r${i + 1}` })));
      await $(`${SLACK.pane} .ho-base`).click();
      // 既定, the three local branches and the six remote ones (the rows after the fifth are only hidden).
      await waitForCount(".orca-dest-pop .orca-branch-row", 10);
      expect(await textsOf(".orca-dest-pop .orca-dest-name")).toEqual(["ローカル", "リモート"]);
      expect(await textsOf(".orca-dest-pop .orca-dest-count")).toEqual(["3", "6"]);
      expect(await browser.execute(() => [...document.querySelectorAll<HTMLElement>('.orca-dest-pop .orca-branch-row[data-kind="remote"]')].filter((b) => !b.hidden).length)).toBe(5);
      await expect($(".orca-dest-more-btn")).toHaveText("ほか 1 件を表示");
      await $(".orca-dest-more-btn").click();
      await expect($(".orca-dest-more-btn")).toHaveText("たたむ");
      await expect(branchRow("origin/r6")).toBeDisplayed();
    });

    it("leaves the name of the branch to Orca when its field is blank", async () => {
      await openFresh();
      const create = await mock("orca_worktree_create", "/work/example-app-x");
      await mock("orca_handoff", started);
      await $(`${SLACK.pane} .ho-name`).setValue("x");
      await $(`${SLACK.pane} .ho-branch`).setValue("   ");
      await write(SLACK, "やって");
      await sendButton(SLACK).click();
      expect(await waitForCalls(create)).toEqual([{ project: "proj_example-app", name: "x", branch: null, base: null, environment: null }]);
    });

    it("picks an existing branch with the ones another worktree has checked out and the branch of the project's own folder refused, disables the ref, and passes the local name of the branch with no ref", async () => {
      await openFresh();
      const create = await mock("orca_worktree_create", "/work/example-app-x");
      await mock("orca_handoff", started);
      await $(`${SLACK.pane} .ho-base`).click();
      await waitForCount(".orca-dest-pop .orca-branch-row", 5);
      await branchRow("feat/c").click();
      await $(`${SLACK.pane} .ho-seg button:nth-of-type(2)`).click();
      expect(await browser.execute(() => [...document.querySelectorAll("#st-orca .ho-seg button")].map((b) => b.getAttribute("aria-pressed")))).toEqual(["false", "true"]);
      await expect($(`${SLACK.pane} .ho-base`)).toBeDisabled();
      await expect($(`${SLACK.pane} .ho-branch`)).not.toBeDisplayed();
      await expect($(`${SLACK.pane} .ho-existing`)).toHaveText("ブランチを選ぶ");
      await expect($(`${SLACK.pane} .ho-existing`)).toHaveAttribute("aria-label", "既存のブランチ");
      await $(`${SLACK.pane} .ho-name`).setValue("x");
      await write(SLACK, "やって");
      // No branch is picked yet, so nothing is handed over.
      await expect(sendButton(SLACK)).toBeDisabled();
      await $(`${SLACK.pane} .ho-existing`).click();
      await waitForCount(".orca-dest-pop .orca-branch-row", 4);
      expect(await dialogRows()).toEqual(["feat/a", "main", "feat/c", "origin/feat/d"]);
      expect(await textsOf(".orca-dest-pop .orca-branch-row:disabled")).toEqual(["feat/a", "main"]);
      await expect(branchRow("feat/a")).toBeDisabled();
      await expect(branchRow("feat/c")).toBeEnabled();
      await branchRow("origin/feat/d").click();
      expect(await textsOf(`${SLACK.pane} .ho-existing`)).toEqual(["origin/feat/d"]);
      await expect(sendButton(SLACK)).toBeEnabled();
      await sendButton(SLACK).click();
      expect(await waitForCalls(create)).toEqual([{ project: "proj_example-app", name: "x", branch: "feat/d", base: null, environment: null }]);
    });

    it("keeps the choices of the frame while the other kind of branch is shown", async () => {
      await openFresh();
      await $(`${SLACK.pane} .ho-branch`).setValue("feat/new");
      await $(`${SLACK.pane} .ho-seg button:nth-of-type(2)`).click();
      await $(`${SLACK.pane} .ho-seg button:nth-of-type(1)`).click();
      await expect($(`${SLACK.pane} .ho-branch`)).toHaveValue("feat/new");
      await expect($(`${SLACK.pane} .ho-base`)).toBeEnabled();
    });
  });

  describe("the search field of the project menu", () => {
    const project = (name: string) => ({ key: `proj_${name}`, name, status: "idle" as const, sessions: 0, atMs: 0 });
    const NAMES = ["example-app", "Example-API", "my.service", "node(core)", "billing"];
    const search = () => $(".menu .menu-search");
    // The labels of the rows the menu draws now, and the one the keys are on.
    const rowsShown = () => browser.execute(() => [...document.querySelectorAll(".menu [role=menuitem]")].filter((b) => !(b as HTMLElement).hidden).map((b) => b.textContent?.trim() ?? ""));
    const cursorRow = () => browser.execute(() => [...document.querySelectorAll('.menu [data-cursor="true"]')].map((b) => b.textContent?.trim() ?? ""));

    async function openProjects(names = NAMES) {
      await openSlack({ orca_overview: orcaOverview(sample(), worktrees(), { projects: names.map(project) }) });
      await openPane(SLACK);
      // The click of the WebDriver gives the focus back to the chip after the handler ran (it sends no mousedown), so the chip is clicked from the page here to see where the menu puts the focus.
      await browser.execute(() => (document.querySelector("#st-orca .ho-project") as HTMLElement).click());
      await expect(search()).toBeDisplayed();
    }

    it("has a field named プロジェクトを検索 that takes the focus when the menu opens, with all the rows drawn and the first one under the keys", async () => {
      await openProjects();
      await expect(search()).toHaveAttribute("aria-label", "プロジェクトを検索");
      await expect(search()).toHaveAttribute("placeholder", "検索");
      expect(await browser.execute(() => document.activeElement === document.querySelector(".menu .menu-search"))).toBe(true);
      expect(await rowsShown()).toEqual(NAMES);
      expect(await cursorRow()).toEqual(["example-app"]);
      await expect($(".menu .menu-empty")).not.toBeDisplayed();
    });

    it("keeps the rows whose name holds the text, with case ignored and the text trimmed, and all of them when it is blank", async () => {
      await openProjects();
      await search().setValue("EXAMPLE");
      expect(await rowsShown()).toEqual(["example-app", "Example-API"]);
      await search().setValue("  api ");
      expect(await rowsShown()).toEqual(["Example-API"]);
      await search().setValue("   ");
      expect(await rowsShown()).toEqual(NAMES);
    });

    it("takes a character of a regular expression as itself", async () => {
      await openProjects();
      await search().setValue(".");
      expect(await rowsShown()).toEqual(["my.service"]);
      await search().setValue("(");
      expect(await rowsShown()).toEqual(["node(core)"]);
      await search().setValue("e.*");
      expect(await rowsShown()).toEqual([]);
    });

    it("says 一致するプロジェクトがありません, as a line and not a button, when no row matches", async () => {
      await openProjects();
      await search().setValue("zzz");
      expect(await rowsShown()).toEqual([]);
      await expect($(".menu .menu-empty")).toHaveText("一致するプロジェクトがありません");
      expect(await browser.execute(() => document.querySelector(".menu .menu-empty")!.tagName)).toBe("DIV");
      expect(await cursorRow()).toEqual([]);
      // Enter has no row to pick: the menu stays and nothing is chosen.
      await browser.keys("Enter");
      await expect(search()).toBeDisplayed();
      await search().setValue("billing");
      expect(await rowsShown()).toEqual(["billing"]);
      await expect($(".menu .menu-empty")).not.toBeDisplayed();
    });

    it("moves the cursor row with Down and Up along the rows shown, stops at the ends, and puts it on the first row again when the text changes", async () => {
      await openProjects();
      await browser.keys("ArrowUp");
      expect(await cursorRow()).toEqual(["example-app"]);
      await browser.keys("ArrowDown");
      expect(await cursorRow()).toEqual(["Example-API"]);
      for (let i = 0; i < 6; i++) await browser.keys("ArrowDown");
      expect(await cursorRow()).toEqual(["billing"]);
      await browser.keys("ArrowUp");
      expect(await cursorRow()).toEqual(["node(core)"]);
      await search().setValue("e");
      expect(await rowsShown()).toEqual(["example-app", "Example-API", "my.service", "node(core)"]);
      expect(await cursorRow()).toEqual(["example-app"]);
      await browser.keys("ArrowDown");
      await browser.keys("ArrowDown");
      expect(await cursorRow()).toEqual(["my.service"]);
    });

    it("picks the cursor row with Enter: the menu closes and the chip shows the project", async () => {
      await openProjects();
      await search().setValue("example");
      await browser.keys("ArrowDown");
      await browser.keys("Enter");
      await expect($(".menu")).not.toExist();
      expect(await textsOf(`${SLACK.pane} .ho-project`)).toEqual(["Example-API"]);
      // A click on a row still picks it.
      await $(`${SLACK.pane} .ho-project`).click();
      await $('//div[@role="menu"]//button[normalize-space(.)="billing"]').click();
      expect(await textsOf(`${SLACK.pane} .ho-project`)).toEqual(["billing"]);
    });

    it("closes with Escape", async () => {
      await openProjects();
      await search().setValue("ex");
      await browser.keys("Escape");
      await expect($(".menu")).not.toExist();
      expect(await browser.execute(() => document.querySelector("#st-orca .ho-project")!.hasAttribute("aria-expanded"))).toBe(false);
    });

    it("fits the window with the field in view, scrolls the rows inside the menu, and keeps its place while the rows shrink", async () => {
      await openProjects(Array.from({ length: 80 }, (_, i) => `example-project-${String(i).padStart(2, "0")}`));
      const geometry = () =>
        browser.execute(() => {
          const menu = document.querySelector(".menu")!.getBoundingClientRect();
          const field = document.querySelector(".menu .menu-search")!.getBoundingClientRect();
          const list = document.querySelector(".menu .menu-list") as HTMLElement;
          return { top: menu.top, left: menu.left, width: menu.width, bottom: menu.bottom, fieldTop: field.top, fieldBottom: field.bottom, scrolls: list.scrollHeight > list.clientHeight, inner: innerHeight };
        });
      const before = await geometry();
      expect(before.bottom).toBeLessThanOrEqual(before.inner);
      expect(before.scrolls).toBe(true);
      // Scroll the rows to the end: the field does not scroll away.
      await browser.execute(() => {
        const list = document.querySelector(".menu .menu-list") as HTMLElement;
        list.scrollTop = list.scrollHeight;
      });
      const scrolled = await geometry();
      expect(scrolled.fieldTop).toBe(before.fieldTop);
      expect(scrolled.fieldBottom).toBeLessThanOrEqual(scrolled.bottom);
      await search().setValue("project-7");
      expect(await rowsShown()).toHaveLength(10);
      const after = await geometry();
      expect(after.top).toBe(before.top);
      expect(after.left).toBe(before.left);
      expect(after.width).toBe(before.width);
      expect(after.scrolls).toBe(false);
    });

    it("is in the menu of the worktrees too, and not in the menu of the destination", async () => {
      await openSlack({ orca_overview: orcaOverview(sample(), worktrees(), { projects: NAMES.map(project), environments: ["Studio"] }) });
      await openPane(SLACK);
      await $(`${SLACK.pane} .ho-destination`).click();
      expect(await textsOf(".menu [role=menuitem]")).toEqual(["このマシン", "Studio"]);
      await expect($(".menu .menu-search")).not.toExist();
      await browser.keys("Escape");
      await chooseProject(SLACK, "example-app");
      await $(`${SLACK.pane} .ho-worktree`).click();
      expect(await menuRows()).toEqual(["default / feat/a", "新規作成"]);
      await expect($(".menu .menu-search")).toHaveAttribute("aria-label", "worktree を検索");
    });
  });

  it("hands over the instruction as written, with Claude's summary of the content and the content, as arguments of one command, and asks Claude only when the button is pressed", async () => {
    await openSlack();
    const handoff = await mock("orca_handoff", started);
    const create = await mock("orca_worktree_create", "/work/never");
    await openPane(SLACK);
    const ask = await write(SLACK, "原因を調べて");
    // The field takes the instruction only, and the button waits for a project.
    await expect(field(SLACK)).toHaveAttribute("aria-label", "Orca への指示");
    await expect(sendButton(SLACK)).toHaveAttribute("aria-label", "Orca に渡す");
    await expect(sendButton(SLACK)).toBeDisabled();
    await chooseProject(SLACK, "example-app");
    expect(await textsOf(`${SLACK.pane} .ho-project`)).toEqual(["example-app"]);
    expect(await textsOf(`${SLACK.pane} .ho-worktree`)).toEqual(["default ・ feat/a"]);
    await expect(sendButton(SLACK)).toBeEnabled();
    // Nothing is sent to Claude or to Orca before the press.
    expect(await callsOf(ask)).toHaveLength(0);
    expect(await callsOf(handoff)).toHaveLength(0);
    await mock("orca_overview", orcaOverview([...sample(), newRow()], worktrees()));
    await sendButton(SLACK).click();
    const [call] = (await waitForCalls(handoff)) as Handed[];
    expect(call.destination).toEqual({ kind: "new", path: "/work/example-app" });
    expect(call.instruction).toBe("原因を調べて");
    expect(call.summary).toEqual(POINTS);
    expect(call.files).toEqual([]);
    expect(call.environment).toBeNull();
    expect(call.context!.kind).toBe("slack");
    expect(call.context!.title).toBe("#dev-billing のスレッド");
    // Each message has its sender and its time.
    expect(call.context!.body).toContain("Alice Example  ");
    expect(call.context!.body).toContain("Please review the deploy notes.");
    expect(call.context!.body).toContain("Looks fine to me.");
    // The content goes as the card holds it; the instruction goes to Rust for the check of the length, and Claude is not sent it.
    const [asked] = (await callsOf(ask)) as Asked[];
    expect(asked).toEqual({ context: call.context, instruction: "原因を調べて" });
    // Nothing else was sent, and the Orca screen's own launch was not used.
    expect(await callsOf("orca_start")).toHaveLength(0);
    expect(await callsOf(handoff)).toHaveLength(1);
    expect(await callsOf(ask)).toHaveLength(1);
    // The folder of the project was used as it is: no worktree was made.
    expect(await callsOf(create)).toHaveLength(0);
  });

  it("stops the button while Claude cannot be used and the card is there, as the Slack thread does, and hands over the instruction alone once the card is taken off", async () => {
    await openSlack({ claude_status: { state: "missing" } });
    const handoff = await mock("orca_handoff", started);
    await openPane(SLACK);
    await chooseProject(SLACK, "example-app");
    await expect($(`${SLACK.pane} .chat-note`)).toHaveText("設定の Claude タブで接続すると、Claude に要約してもらえます");
    await field(SLACK).setValue("原因を調べて");
    await expect(field(SLACK)).toBeEnabled();
    await expect(sendButton(SLACK)).toBeDisabled();
    // With no content there is nothing for Claude to summarise.
    await $(`${SLACK.pane} [aria-label="渡す内容を外す"]`).click();
    await expect($(`${SLACK.pane} .chat-note`)).not.toBeDisplayed();
    await expect(sendButton(SLACK)).toBeEnabled();
    await sendButton(SLACK).click();
    expect(await waitForCalls(handoff)).toEqual([{ destination: { kind: "new", path: "/work/example-app" }, instruction: "原因を調べて", files: [], summary: [], context: null, environment: null }]);
  });

  it("shows the message of a failed summary above the card, makes and starts nothing, keeps the text, and lets the owner press again", async () => {
    await openSlack();
    const ask = await mock("claude_summarize_handoff", rejects("Claude が要約を返しませんでした"));
    const create = await mock("orca_worktree_create", "/work/example-app-x");
    const handoff = await mock("orca_handoff", started);
    await openPane(SLACK);
    await chooseProject(SLACK, "example-app");
    await chooseNewWorktree(SLACK);
    await $(`${SLACK.pane} .ho-name`).setValue("x");
    await field(SLACK).setValue("原因を調べて");
    await sendButton(SLACK).click();
    await waitForCalls(ask);
    await waitForCard("Claude が要約を返しませんでした");
    await expect(field(SLACK)).toHaveValue("原因を調べて");
    expect(await callsOf(create)).toHaveLength(0);
    expect(await callsOf(handoff)).toHaveLength(0);
    expect(await count(`${SLACK.pane} .ho-card`)).toBe(1);
    await expect(sendButton(SLACK)).toHaveAttribute("aria-label", "Orca に渡す");
    await expect(sendButton(SLACK)).toBeEnabled();
    // Pressing again with the same text works, and the message goes.
    await write(SLACK, "原因を調べて");
    await sendButton(SLACK).click();
    const [call] = (await waitForCalls(handoff)) as Handed[];
    expect(call.summary).toEqual(POINTS);
    expect(await callsOf(create)).toHaveLength(1);
  });

  it("keeps a hand-over on its way, and its result, with the item it was started for", async () => {
    await openSlack();
    const ask = await mock("claude_summarize_handoff", holds);
    const handoff = await mock("orca_handoff", started);
    await openPane(SLACK);
    await chooseProject(SLACK, "example-app");
    await field(SLACK).setValue("守る指示");
    await sendButton(SLACK).click();
    await waitForCalls(ask);
    await expect(field(SLACK)).toBeDisabled();
    await expect(sendButton(SLACK)).toBeDisabled();
    // Another thread: its pane is not waiting.
    await openThread(0);
    await listRead(SLACK);
    await expect(field(SLACK)).toBeEnabled();
    await release(ask, handoffSummary(POINTS));
    const [call] = (await waitForCalls(handoff)) as Handed[];
    expect(call.instruction).toBe("守る指示");
    expect(call.summary).toEqual(POINTS);
    await browser.pause(300);
    expect(await count(`${SLACK.pane} .ho-session-name`)).toBe(0);
    // The owner is on another thread: the Orca screen is not shown to them.
    await expect($("#orca")).not.toBeDisplayed();
    // Its own item shows the session when it is shown again.
    await openThread(1);
    await expect($(`${SLACK.pane} .ho-session-name`)).toBeDisplayed();
  });

  it("hands over nothing without an instruction, even with a project chosen and the Orca list read", async () => {
    await openSlack();
    const handoff = await mock("orca_handoff", started);
    await openPane(SLACK);
    await chooseProject(SLACK, "example-app");
    await expect(sendButton(SLACK)).toBeDisabled();
    await field(SLACK).setValue("   ");
    await expect(sendButton(SLACK)).toBeDisabled();
    expect(await callsOf(handoff)).toHaveLength(0);
  });

  it("makes the worktree named in the field with orca_worktree_create and starts the session in the path it answers", async () => {
    await openSlack();
    const create = await mock("orca_worktree_create", "/work/example-app-fix-invoice");
    const handoff = await mock("orca_handoff", started);
    await openPane(SLACK);
    await chooseProject(SLACK, "example-app");
    await chooseNewWorktree(SLACK);
    await $(`${SLACK.pane} .ho-name`).setValue("fix-invoice");
    await write(SLACK, "請求書を直して");
    await expect(sendButton(SLACK)).toBeEnabled();
    await mock("orca_overview", orcaOverview([...sample(), newRow()], worktrees()));
    await sendButton(SLACK).click();
    expect(await waitForCalls(create)).toEqual([{ project: "proj_example-app", name: "fix-invoice", branch: null, base: null, environment: null }]);
    const [call] = (await waitForCalls(handoff)) as Handed[];
    expect(call.destination).toEqual({ kind: "new", path: "/work/example-app-fix-invoice" });
    expect(call.instruction).toBe("請求書を直して");
    expect(call.summary).toEqual(POINTS);
    expect(call.environment).toBeNull();
    expect(await callsOf(create)).toHaveLength(1);
    expect(await callsOf(handoff)).toHaveLength(1);
    await backTo(SLACK);
    await expect($(`${SLACK.pane} .ho-session-name`)).toBeDisplayed();
  });

  it("makes the worktree in the destination chosen, and starts there", async () => {
    await openSlack({ orca_overview: orcaOverview(sample(), worktrees(), { environments: ["Lab"] }) });
    await mock("orca_destination", orcaOverview([], [orcaWorktree("example-lab", "main")], { target: "Lab", environments: ["Lab"], known: false }));
    const create = await mock("orca_worktree_create", "/lab/example-lab-b");
    const handoff = await mock("orca_handoff", started);
    await openPane(SLACK);
    await $(`${SLACK.pane} .ho-destination`).click();
    await $('//div[@role="menu"]//button[normalize-space(.)="Lab"]').click();
    await browser.waitUntil(async () => (await textsOf(`${SLACK.pane} .ho-project`))[0] === "プロジェクトを選ぶ", { timeoutMsg: "the lists of the destination were not read" });
    await chooseProject(SLACK, "example-lab");
    await chooseNewWorktree(SLACK);
    await $(`${SLACK.pane} .ho-name`).setValue("b");
    await write(SLACK, "やって");
    await sendButton(SLACK).click();
    expect(await waitForCalls(create)).toEqual([{ project: "proj_example-lab", name: "b", branch: null, base: null, environment: "Lab" }]);
    const [call] = (await waitForCalls(handoff)) as { destination: unknown; environment: string | null }[];
    expect(call.destination).toEqual({ kind: "new", path: "/lab/example-lab-b" });
    expect(call.environment).toBe("Lab");
  });

  it("starts nothing when the worktree cannot be made, keeps the instruction and the name, and shows the message of Rust", async () => {
    await openSlack();
    const create = await mock("orca_worktree_create", rejects("worktree の名前を入力してください"));
    const handoff = await mock("orca_handoff", started);
    await openPane(SLACK);
    await chooseProject(SLACK, "example-app");
    await chooseNewWorktree(SLACK);
    await write(SLACK, "やって");
    await sendButton(SLACK).click();
    await waitForCalls(create);
    await waitForCard("worktree の名前を入力してください");
    expect(await callsOf(handoff)).toHaveLength(0);
    // Still the form with the card and the instruction, and the button ready to try again.
    expect(await count(`${SLACK.pane} .ho-card`)).toBe(1);
    await expect(field(SLACK)).toHaveValue("やって");
    await expect(sendButton(SLACK)).toBeEnabled();
    // The next hand-over asks again (nothing was made), with the name written in the field.
    await $(`${SLACK.pane} .ho-name`).setValue("fix");
    await mock("orca_worktree_create", "/work/example-app-fix");
    await sendButton(SLACK).click();
    await waitForCalls(handoff);
  });

  it("does not make a second worktree or ask Claude again when the launch fails after one was made and the same send is tried again", async () => {
    await openSlack();
    const create = await mock("orca_worktree_create", "/work/example-app-fix");
    const handoff = await mock("orca_handoff", rejects("Orca が指示を受け付けませんでした"));
    await openPane(SLACK);
    await chooseProject(SLACK, "example-app");
    await chooseNewWorktree(SLACK);
    const ask = await write(SLACK, "やって");
    await $(`${SLACK.pane} .ho-name`).setValue("fix");
    await sendButton(SLACK).click();
    await waitForCalls(handoff);
    await waitForCard("Orca が指示を受け付けませんでした");
    const again = await mock("orca_handoff", started);
    await sendButton(SLACK).click();
    const [call] = (await waitForCalls(again)) as { destination: unknown; summary: string[] }[];
    expect(call.destination).toEqual({ kind: "new", path: "/work/example-app-fix" });
    expect(await callsOf(create)).toHaveLength(1);
    // The summary of the first send is used again: Claude is asked once.
    expect(call.summary).toEqual(POINTS);
    expect(await callsOf(ask)).toHaveLength(1);
  });

  it("keeps the chosen project in memory for the next handoff", async () => {
    await openSlack();
    const handoff = await mock("orca_handoff", started);
    await openPane(SLACK);
    await chooseProject(SLACK, "example-api");
    await write(SLACK, "この方針でお願い");
    await sendButton(SLACK).click();
    await waitForCalls(handoff);
    await backTo(SLACK);
    // The close icon of the session forgets it, and the form of the next item shows the worktree again.
    await $(`${SLACK.pane} [aria-label="閉じる"]`).click();
    await openThread(0);
    await listRead(SLACK);
    expect(await textsOf(`${SLACK.pane} .ho-project`)).toEqual(["example-api"]);
    expect(await textsOf(`${SLACK.pane} .ho-worktree`)).toEqual(["default ・ main"]);
  });

  it("hands over the instruction with no summary and no block when the card is taken off, and asks Claude nothing", async () => {
    await openSlack();
    const handoff = await mock("orca_handoff", started);
    await openPane(SLACK);
    await chooseProject(SLACK, "example-app");
    await $(`${SLACK.pane} [aria-label="渡す内容を外す"]`).click();
    expect(await count(`${SLACK.pane} .ho-card`)).toBe(0);
    const ask = await write(SLACK, "ただの指示");
    await sendButton(SLACK).click();
    expect(await waitForCalls(handoff)).toEqual([{ destination: { kind: "new", path: "/work/example-app" }, instruction: "ただの指示", files: [], summary: [], context: null, environment: null }]);
    expect(await callsOf(ask)).toHaveLength(0);
  });

  it("hands over the whole text of the thread, and the card has no way to read it", async () => {
    await openSlack();
    const handoff = await mock("orca_handoff", started);
    await openPane(SLACK);
    expect(await count(`${SLACK.pane} .ho-card`)).toBe(1);
    expect(await count(`${SLACK.pane} .ho-card-toggle, ${SLACK.pane} .ho-card-body`)).toBe(0);
    // A tick of the pane (every second) draws the card again with the same nodes.
    await browser.execute(() => ((document.querySelector("#st-orca .ho-card") as unknown as { __kept: boolean }).__kept = true));
    await browser.pause(2200);
    expect(await browser.execute(() => (document.querySelector("#st-orca .ho-card") as unknown as { __kept?: boolean }).__kept)).toBe(true);
    await chooseProject(SLACK, "example-app");
    await write(SLACK, "読んで");
    await sendButton(SLACK).click();
    const [call] = (await waitForCalls(handoff)) as { context: { body: string } }[];
    expect(call.context.body).toContain("Please review the deploy notes.");
    expect(call.context.body).toContain("Looks fine to me.");
  });

  it("keeps the instruction and the card and shows the message when the hand-over fails, and the button waits for a text", async () => {
    await openSlack();
    const handoff = await mock("orca_handoff", rejects("Orca が指示を受け付けませんでした"));
    await openPane(SLACK);
    await chooseProject(SLACK, "example-app");
    await field(SLACK).setValue("   ");
    await expect(sendButton(SLACK)).toBeDisabled();
    await write(SLACK, "やって");
    await sendButton(SLACK).click();
    await waitForCalls(handoff);
    await waitForCard("Orca が指示を受け付けませんでした");
    // Still the form: no session, the instruction and the card are there to try again.
    expect(await count(`${SLACK.pane} .ho-card`)).toBe(1);
    await expect(field(SLACK)).toHaveValue("やって");
    await expect(sendButton(SLACK)).toBeEnabled();
    expect(await callsOf(handoff)).toHaveLength(1);
  });

  it("shows the notice of the Orca screen on a card when the command is missing (a warning) or the read failed", async () => {
    await openSlack({ orca_overview: orcaOverview([], [], { state: "missing" }) });
    await $(SLACK.button).click();
    await waitForCard("orca コマンドが見つかりません");
    expect(await count(WARN_CARDS)).toBe(1);
    await write(SLACK, "やって");
    await expect(sendButton(SLACK)).toBeDisabled();
    await mock("orca_overview", orcaOverview([], [], { state: "failed", message: "接続できません" }));
    // Another tab and back: the pane reads the list again.
    await $("#reply-tab-claude").click();
    await $(SLACK.button).click();
    await waitForCard("読み込めませんでした: 接続できません");
    expect(await count(WARN_CARDS)).toBe(0);
  });

  it("shows the session after the send as a card: its header, its state, the button of the development screen and the close icon, with no terminal and no field", async () => {
    await openSlack();
    const handoff = await mock("orca_handoff", started);
    await openPane(SLACK);
    await chooseProject(SLACK, "example-app");
    await write(SLACK, "原因を調べて");
    await mock("orca_overview", orcaOverview([...sample(), newRow()], worktrees()));
    await sendButton(SLACK).click();
    await waitForCalls(handoff);
    await backTo(SLACK);
    await expect($(`${SLACK.pane} .ho-session-name`)).toHaveText("example-app ・ feat/a");
    await browser.waitUntil(async () => (await textsOf(`${SLACK.pane} .ho-session-state`))[0] === "作業中 ・ 1 分", { timeoutMsg: "the state of the session was not shown" });
    expect(await textsOf(`${SLACK.pane} .ho-session-open`)).toEqual(["開発画面で開く"]);
    await expect($(`${SLACK.pane} [aria-label="閉じる"]`)).toBeDisplayed();
    expect(await count(`${SLACK.pane} .ho-card`)).toBe(0);
    // No field of more instructions and no terminal: the session is on the Orca screen.
    expect(await count(`${SLACK.pane} textarea`)).toBe(0);
    expect(await terminalParts(SLACK)).toBe(0);
  });

  it("shows 終了 in place of the state when the session that was in the list is missing from a ready one, and reads the list no more for it", async () => {
    await openSlack();
    const handoff = await mock("orca_handoff", started);
    await openPane(SLACK);
    await chooseProject(SLACK, "example-app");
    await write(SLACK, "原因を調べて");
    await mock("orca_overview", orcaOverview([...sample(), newRow()], worktrees()));
    await sendButton(SLACK).click();
    await waitForCalls(handoff);
    await backTo(SLACK);
    await browser.waitUntil(async () => (await textsOf(`${SLACK.pane} .ho-session-state`))[0] === "作業中 ・ 1 分", { timeoutMsg: "the state of the session was not shown" });
    // The terminal is gone from Orca: the next read of the list lacks the row.
    await mock("orca_overview", orcaOverview(sample(), worktrees()));
    await browser.waitUntil(async () => (await textsOf(`${SLACK.pane} .ho-session-state`))[0] === "終了", { timeout: 25000, timeoutMsg: "the session was not shown as ended" });
    await expect(sessionOpen(SLACK)).toBeDisplayed();
    expect(await terminalParts(SLACK)).toBe(0);
  });

  it("shows the card of a session at the saved environment the Orca screen streams, handed to that environment", async () => {
    const studio = { target: "Studio", environments: ["Studio"] };
    await openSlack({ orca_overview: orcaOverview(sample(), worktrees(), studio) });
    await waitForCalls("orca_stream_open");
    await sendStream(streamList(sample(), worktrees()));
    const handoff = await mock("orca_handoff", started);
    await openPane(SLACK);
    await chooseProject(SLACK, "example-app");
    await write(SLACK, "やって");
    await sendButton(SLACK).click();
    const [call] = (await waitForCalls(handoff)) as { environment: string | null }[];
    expect(call.environment).toBe("Studio");
    await backTo(SLACK);
    await expect($(`${SLACK.pane} .ho-session-name`)).toBeDisplayed();
    await expect(sessionOpen(SLACK)).toBeDisplayed();
    expect(await terminalParts(SLACK)).toBe(0);
  });

  it("shows the card with the state being checked and its button when the launch gave neither a pane key nor a handle", async () => {
    await openSlack();
    await mock("orca_handoff", { paneKey: null, handle: null } satisfies OrcaStarted);
    await openPane(SLACK);
    await chooseProject(SLACK, "example-app");
    await write(SLACK, "始めて");
    await sendButton(SLACK).click();
    // Nothing names the session, so the Orca screen is shown with no tab selected.
    await backTo(SLACK);
    await expect($(`${SLACK.pane} .ho-session-name`)).toBeDisplayed();
    expect(await textsOf(`${SLACK.pane} .ho-session-state`)).toEqual(["確認中"]);
    await expect(sessionOpen(SLACK)).toBeDisplayed();
    expect(await terminalParts(SLACK)).toBe(0);
  });

  it("keeps the notice of a session that finishes while the pane shows it, until the Orca screen shows it", async () => {
    await openSlack();
    await mock("orca_handoff", started);
    await openPane(SLACK);
    await chooseProject(SLACK, "example-app");
    await write(SLACK, "原因を調べて");
    await mock("orca_overview", orcaOverview([...sample(), newRow()], worktrees()));
    await sendButton(SLACK).click();
    await backTo(SLACK);
    await expect($(`${SLACK.pane} .ho-session-name`)).toHaveText("example-app ・ feat/a");
    // The waiting agent of the sample is the one in the count.
    await expect($("#nav-orca .nav-count")).toHaveText("1");
    // The session finishes; the thread is opened again, which makes the pane read the list again, and the pane still shows the session.
    const overview = await mock("orca_overview", orcaOverview([...sample(), { ...newRow(), group: "done", status: "done" }], worktrees()));
    await openThread(1);
    await waitForCalls(overview);
    await expect($(`${SLACK.pane} .ho-session-name`)).toHaveText("example-app ・ feat/a");
    await expect($("#nav-orca .nav-count")).toHaveText("2");
  });

  it("shows the session again when the item is left and opened again, and the close icon forgets it", async () => {
    await openSlack();
    await mock("orca_handoff", started);
    await openPane(SLACK);
    await chooseProject(SLACK, "example-app");
    await write(SLACK, "原因を調べて");
    await mock("orca_overview", orcaOverview([...sample(), newRow()], worktrees()));
    await sendButton(SLACK).click();
    await backTo(SLACK);
    await expect($(`${SLACK.pane} .ho-session-name`)).toHaveText("example-app ・ feat/a");
    // Back to the list: the pane is gone.
    await $("#st-back").click();
    await expect($(SLACK.pane)).not.toBeDisplayed();
    // The same thread again: the pane is open on its session.
    await openThread(1);
    await expect($(SLACK.pane)).toBeDisplayed();
    await expect($(`${SLACK.pane} .ho-session-name`)).toHaveText("example-app ・ feat/a");
    // Another thread has no session: its pane shows the form.
    await openThread(0);
    await expect($(SLACK.pane)).toBeDisplayed();
    expect(await count(`${SLACK.pane} .ho-session-name`)).toBe(0);
    // The close icon of the session forgets it: the pane shows the form.
    await openThread(1);
    await expect($(`${SLACK.pane} .ho-session-name`)).toBeDisplayed();
    await $(`${SLACK.pane} [aria-label="閉じる"]`).click();
    await expect($(SLACK.pane)).toBeDisplayed();
    await listRead(SLACK);
    expect(await count(`${SLACK.pane} .ho-session-name`)).toBe(0);
  });

  it("moves to the Orca screen when the session starts, which selects its tab and shows its terminal, and the button of the card opens it again", async () => {
    await openSlack();
    await mock("orca_handoff", started);
    await openPane(SLACK);
    await chooseProject(SLACK, "example-app");
    await write(SLACK, "原因を調べて");
    await mock("orca_overview", orcaOverview([...sample(), newRow()], worktrees()));
    await mock("orca_terminal_read", ["$ claude"]);
    await sendButton(SLACK).click();
    // The screen is changed by the hand-over alone: the list was read when it was shown, and the tab of the session is selected once the list holds it.
    await expect($("#orca")).toBeDisplayed();
    await expect($('.orca-tabs [data-tab="claude:tab_new:leaf_9"] [role="tab"]')).toHaveAttribute("aria-selected", "true");
    await browser.waitUntil(async () => (await $(".orca-term .orca-term-box:not([hidden]) .xterm-rows").getText()).includes("claude"), { timeoutMsg: "the screen of the session never showed on the Orca screen" });
    // The thread is open again: the pane is the card of the session, with no terminal of its own.
    await backTo(SLACK);
    await expect($(`${SLACK.pane} .ho-session-name`)).toHaveText("example-app ・ feat/a");
    expect(await terminalParts(SLACK)).toBe(0);
    // The button of the card opens the session on the Orca screen again.
    await sessionOpen(SLACK).click();
    await expect($("#orca")).toBeDisplayed();
    await expect($('.orca-tabs [data-tab="claude:tab_new:leaf_9"] [role="tab"]')).toHaveAttribute("aria-selected", "true");
  });

  it("moves to the Orca screen at a saved environment that is the target, and selects the tab of the session when its stream lists it", async () => {
    const studio = { target: "Studio", environments: ["Studio"] };
    await openSlack({ orca_overview: orcaOverview(sample(), worktrees(), studio) });
    await waitForCalls("orca_stream_open");
    // Every item of the stream is put in the environment that streams it, as Rust does.
    await sendStream(streamedList(sample(), worktrees()));
    await mock("orca_handoff", started);
    await openPane(SLACK);
    await chooseProject(SLACK, "example-app");
    await write(SLACK, "やって");
    await sendButton(SLACK).click();
    await expect($("#orca")).toBeDisplayed();
    // The list that the stream gave has no such session yet: nothing is selected.
    expect(await count('.orca-tabs [data-tab="claude:tab_new:leaf_9"] [role="tab"]')).toBe(0);
    await sendStream(streamedList([...sample(), newRow()], worktrees()));
    await expect($('.orca-tabs [data-tab="claude:tab_new:leaf_9"] [role="tab"]')).toHaveAttribute("aria-selected", "true");
  });

  it("moves to the Orca screen and selects nothing when the session started in a saved environment that the screen does not list, even if this machine's list holds a row with the same pane key", async () => {
    await openSlack({ orca_overview: orcaOverview(sample(), worktrees(), { environments: ["Lab"] }) });
    await mock("orca_destination", orcaOverview([], [orcaWorktree("example-lab", "main")], { target: "Lab", environments: ["Lab"], known: false }));
    await mock("orca_handoff", started);
    await mock("orca_overview", orcaOverview([...sample(), newRow()], worktrees(), { environments: ["Lab"] }));
    await openPane(SLACK);
    await $(`${SLACK.pane} .ho-destination`).click();
    await $('//div[@role="menu"]//button[normalize-space(.)="Lab"]').click();
    await browser.waitUntil(async () => (await textsOf(`${SLACK.pane} .ho-destination`))[0] === "Lab", { timeoutMsg: "the destination was not shown" });
    await chooseProject(SLACK, "example-lab");
    await write(SLACK, "やって");
    await sendButton(SLACK).click();
    await expect($("#orca")).toBeDisplayed();
    await browser.pause(500);
    // The row with the same pane key is this machine's, not the session's: its tab may be drawn or not, but it is never the one selected.
    expect(await count('.orca-tabs [data-tab="claude:tab_new:leaf_9"] [role="tab"][aria-selected="true"]')).toBe(0);
  });

  it("opens from the icon in the row of tabs of a Todo, under the detail in the same scroll, with its content as the card", async () => {
    await openTodo();
    await expect($(TODO.button)).toHaveAttribute("aria-label", "Orca に渡す");
    await expect($(TODO.button)).toHaveAttribute("aria-pressed", "false");
    await expect($(TODO.pane)).not.toBeDisplayed();
    const handoff = await mock("orca_handoff", started);
    await openPane(TODO);
    await expect($(TODO.button)).toHaveAttribute("aria-pressed", "true");
    // The button is in the row of tabs at the left of 編集, the pane follows the detail of the selected tab inside #todo-pane of the right side, in view (T-10).
    const place = await browser.execute(() => {
      const rect = (s: string) => document.querySelector(s)!.getBoundingClientRect();
      const main = rect("#todo-pane");
      const pane = rect("#todo-handoff");
      return {
        inTools: document.querySelector("#todo-tools > #todo-orca-open") !== null,
        leftOfEdit: rect("#todo-orca-open").right <= rect("#todo-more").left,
        inPane: document.querySelector("#todo-side > #todo-pane > #todo-handoff") !== null,
        underDetail: pane.top >= rect("#todo-detail").bottom - 1,
        inView: pane.top >= main.top - 1 && pane.top < main.bottom,
      };
    });
    expect(place).toEqual({ inTools: true, leftOfEdit: true, inPane: true, underDetail: true, inView: true });
    expect(await count("#todo-claude, #todo-tool-claude")).toBe(0);
    // The pane goes with the task, so it has no close icon before a send; its title is its first row.
    expect(await textsOf(`${TODO.pane} .ho-title`)).toEqual(["Orca に渡す"]);
    await expect($(`${TODO.pane} .ho-head [aria-label="閉じる"]`)).not.toBeDisplayed();
    expect(await textsOf(`${TODO.pane} .ho-card-title`)).toEqual(["Write report"]);
    expect(await textsOf(`${TODO.pane} .ho-card-meta`)).toEqual(["説明なし ・ 今日"]);
    await chooseProject(TODO, "example-app");
    await write(TODO, "実装して");
    await mock("orca_overview", orcaOverview([...sample(), newRow()], worktrees()));
    await sendButton(TODO).click();
    const [call] = (await waitForCalls(handoff)) as Handed[];
    expect(call.destination).toEqual({ kind: "new", path: "/work/example-app" });
    expect(call.context!.kind).toBe("todo");
    expect(call.context!.title).toBe("Write report");
    expect(call.context!.body).toContain("タスク: Write report");
    expect(call.context!.body).toContain("プロジェクト: Work");
    // The Orca screen is shown, with the tab of the session selected.
    await expect($("#orca")).toBeDisplayed();
    await expect($('.orca-tabs [data-tab="claude:tab_new:leaf_9"] [role="tab"]')).toHaveAttribute("aria-selected", "true");
    await backTo(TODO);
    // After the send the pane is the card of the session: no terminal, and as high as its content.
    await expect($(`${TODO.pane} .ho-session-name`)).toBeDisplayed();
    expect(await terminalParts(TODO)).toBe(0);
    expect(await heightOf(TODO.pane)).toBeLessThan(200);
    // The tab is closed: the pane and the button are gone.
    await $("#todo-tabs .orca-tab-close").click();
    await expect($(TODO.pane)).not.toBeDisplayed();
    await expect($(TODO.button)).not.toBeDisplayed();
    // The same task again shows its session, with the button pressed.
    await $("#todo-list li.task").click();
    await expect($(`${TODO.pane} .ho-session-name`)).toBeDisplayed();
    await expect($(TODO.button)).toHaveAttribute("aria-pressed", "true");
  });

  it("makes the right pane of the Slack thread tabs, Claude first and selected, and Orca hands the thread over", async () => {
    await openSlack();
    const tabs = $("#reply-tabs");
    await expect(tabs).toHaveAttribute("role", "tablist");
    await expect(tabs).toHaveAttribute("aria-label", "Claude と Orca");
    expect(await textsOf("#reply-tabs [role=tab]")).toEqual(["Claude", "Orca"]);
    await expect($("#reply-tab-claude")).toHaveAttribute("aria-selected", "true");
    await expect($("#reply-tab-orca")).toHaveAttribute("aria-selected", "false");
    // The Claude tab is closed at first (S-7): the question, and no terminal.
    await expect($("#reply-claude-ask")).toBeDisplayed();
    await expect($("#reply-term")).not.toBeDisplayed();
    await expect($("#st-orca")).not.toBeDisplayed();
    const handoff = await mock("orca_handoff", started);
    await $("#reply-tab-orca").click();
    await expect($("#reply-tab-orca")).toHaveAttribute("aria-selected", "true");
    await expect($("#reply-tab-claude")).toHaveAttribute("aria-selected", "false");
    await expect($("#reply-claude-ask")).not.toBeDisplayed();
    await expect($("#reply-term")).not.toBeDisplayed();
    await expect($("#reply-restart")).not.toBeDisplayed();
    await listRead(SLACK);
    expect(await textsOf(`${SLACK.pane} .ho-card-title`)).toEqual(["#dev-billing のスレッド"]);
    expect(await textsOf(`${SLACK.pane} .ho-card-meta`)).toEqual(["Alice Example ほか ・ 2 件"]);
    await chooseProject(SLACK, "example-api");
    await write(SLACK, "返信案を作って");
    await sendButton(SLACK).click();
    const [call] = (await waitForCalls(handoff)) as { destination: unknown; context: { kind: string; title: string; body: string } }[];
    expect(call.destination).toEqual({ kind: "new", path: "/work/example-api" });
    expect(call.context.kind).toBe("slack");
    expect(call.context.title).toBe("#dev-billing のスレッド");
    // Each message has its sender and its time.
    expect(call.context.body).toContain("Alice Example  ");
    expect(call.context.body).toContain("Please review the deploy notes.");
    expect(call.context.body).toContain("Bob Example  ");
    expect(call.context.body).toContain("Looks fine to me.");
    await backTo(SLACK);
    await expect($(`${SLACK.pane} .ho-session-card`)).toBeDisplayed();
    // Back to Claude: its pane is as it was, closed.
    await $("#reply-tab-claude").click();
    await expect($("#reply-claude-ask")).toBeDisplayed();
    await expect($("#reply-term")).not.toBeDisplayed();
    await expect($("#st-orca")).not.toBeDisplayed();
    // The Orca tab again: the card of the session is shown.
    await $("#reply-tab-orca").click();
    await expect(sessionOpen(SLACK)).toBeDisplayed();
    await expect($(`${SLACK.pane} .ho-session-card`)).toBeDisplayed();
  });

  it("starts at the target the Orca screen holds, and sends to it", async () => {
    await openSlack({ orca_overview: orcaOverview(sample(), worktrees(), { target: "Studio", environments: ["Studio"] }) });
    const handoff = await mock("orca_handoff", started);
    const destination = await mock("orca_destination", orcaOverview([], []));
    await openPane(SLACK);
    expect(await textsOf(`${SLACK.pane} .ho-destination`)).toEqual(["Studio"]);
    await chooseProject(SLACK, "example-app");
    await write(SLACK, "やって");
    await sendButton(SLACK).click();
    const [call] = (await waitForCalls(handoff)) as { environment: string | null }[];
    expect(call.environment).toBe("Studio");
    // The list of the Orca screen is the destination's: nothing else is read.
    expect(await callsOf(destination)).toEqual([]);
  });

  it("names this machine as the destination, with nothing to choose when no environment is saved", async () => {
    await openSlack();
    await openPane(SLACK);
    expect(await textsOf(`${SLACK.pane} .ho-destination`)).toEqual(["このマシン"]);
    await expect($(`${SLACK.pane} .ho-destination`)).toBeDisabled();
  });

  it("reads the lists of the destination chosen, and hands over to it", async () => {
    await openSlack({ orca_overview: orcaOverview(sample(), worktrees(), { environments: ["Studio", "Lab"] }) });
    const destination = await mock("orca_destination", orcaOverview([], [orcaWorktree("example-lab", "main")], { target: "Lab", environments: ["Studio", "Lab"], known: false }));
    const handoff = await mock("orca_handoff", started);
    await openPane(SLACK);
    await chooseProject(SLACK, "example-app");
    expect(await textsOf(`${SLACK.pane} .ho-project`)).toEqual(["example-app"]);
    await $(`${SLACK.pane} .ho-destination`).click();
    expect(await textsOf(".menu [role=menuitem]")).toEqual(["このマシン", "Studio", "Lab"]);
    await $('//div[@role="menu"]//button[normalize-space(.)="Lab"]').click();
    expect(await waitForCalls(destination)).toEqual([{ environment: "Lab", force: true }]);
    // The projects are the destination's, and the one chosen for the old destination is dropped.
    await browser.waitUntil(async () => (await textsOf(`${SLACK.pane} .ho-destination`))[0] === "Lab", { timeoutMsg: "the destination was not shown" });
    await expect($(`${SLACK.pane} .ho-project`)).toBeEnabled();
    expect(await textsOf(`${SLACK.pane} .ho-project`)).toEqual(["プロジェクトを選ぶ"]);
    await chooseProject(SLACK, "example-lab");
    await write(SLACK, "やって");
    await sendButton(SLACK).click();
    const [call] = (await waitForCalls(handoff)) as { destination: unknown; environment: string | null }[];
    expect(call.destination).toEqual({ kind: "new", path: "/work/example-lab" });
    expect(call.environment).toBe("Lab");
    // The session is read at its own destination, and the choice is kept for the next handoff.
    await backTo(SLACK);
    await expect(sessionOpen(SLACK)).toBeDisplayed();
    expect((await callsOf(destination)).length).toBeGreaterThan(1);
    // The Orca screen streams no list of Lab, so no terminal of the session is streamed.
    expect(await callsOf("orca_stream_terminal")).toEqual([]);
  });

  it("changes back to this machine from the menu, which lists the destination read last", async () => {
    await openSlack({ orca_overview: orcaOverview(sample(), worktrees(), { target: "Studio", environments: ["Studio"] }) });
    const destination = await mock("orca_destination", orcaOverview([], worktrees(), { target: null, environments: ["Studio"], known: false }));
    await openPane(SLACK);
    await $(`${SLACK.pane} .ho-destination`).click();
    await $('//div[@role="menu"]//button[normalize-space(.)="このマシン"]').click();
    expect(await waitForCalls(destination)).toEqual([{ environment: null, force: true }]);
    await browser.waitUntil(async () => (await textsOf(`${SLACK.pane} .ho-destination`))[0] === "このマシン", { timeoutMsg: "the destination was not shown" });
  });

  it("shows the notice of the Orca screen on a card when the destination cannot be read, and sends nothing to it", async () => {
    await openSlack({ orca_overview: orcaOverview(sample(), worktrees(), { environments: ["Studio"] }) });
    await mock("orca_destination", orcaOverview([], [], { state: "failed", message: "接続できません", target: "Studio", environments: ["Studio"], known: false }));
    await openPane(SLACK);
    await $(`${SLACK.pane} .ho-destination`).click();
    await $('//div[@role="menu"]//button[normalize-space(.)="Studio"]').click();
    await waitForCard("読み込めませんでした: 接続できません");
    expect(await textsOf(`${SLACK.pane} .ho-project`)).toEqual(["プロジェクトがありません"]);
    await expect($(`${SLACK.pane} .ho-project`)).toBeDisabled();
    await write(SLACK, "やって");
    await expect(sendButton(SLACK)).toBeDisabled();
  });

  it("puts the instruction of a hand-over that failed at the summary back in its own item when the failure came on another, and its message is a card", async () => {
    await openSlack();
    const ask = await mock("claude_summarize_handoff", holds);
    await openPane(SLACK);
    await chooseProject(SLACK, "example-app");
    await field(SLACK).setValue("守る指示");
    await sendButton(SLACK).click();
    await waitForCalls(ask);
    // Another thread: its pane is not busy, and the failure arrives meanwhile.
    await openThread(0);
    await listRead(SLACK);
    await expect(field(SLACK)).toBeEnabled();
    await release(ask, rejects("失敗しました"));
    // The message is a card, whichever thread is shown; the other thread's field stays empty.
    await waitForCard("失敗しました");
    await expect(field(SLACK)).toHaveValue("");
    // Its own item has the text again.
    await openThread(1);
    await listRead(SLACK);
    await expect(field(SLACK)).toHaveValue("守る指示");
    await expect(field(SLACK)).toBeEnabled();
  });

  it("puts the instruction of a hand-over that failed on another item back in its own item, and its message is a card", async () => {
    await openSlack();
    await openPane(SLACK);
    await chooseProject(SLACK, "example-app");
    await write(SLACK, "守る指示");
    const handoff = await mock("orca_handoff", holds);
    await sendButton(SLACK).click();
    await waitForCalls(handoff);
    await openThread(0);
    await release(handoff, rejects("失敗しました"));
    await waitForCard("失敗しました");
    await openThread(1);
    await listRead(SLACK);
    await expect(field(SLACK)).toHaveValue("守る指示");
    await expect(sendButton(SLACK)).toBeEnabled();
  });

  it("keeps the Orca tab selected while another thread opens, and hands the new thread over once it is read", async () => {
    const olderTs = slackTs(60, 1);
    const newerTs = slackTs(30, 3);
    const messages = [timelineMessage(newerTs, "Carol Example", "ops", "Second thread root", { replyCount: 0, channel: "C2" }), timelineMessage(olderTs, "Alice Example", "dev-billing", "Please review the deploy notes.", { replyCount: 1 })];
    await bootOrca({ slack_load: slackLoad, slack_timeline: timeline(messages), claude_status: claudeReady });
    await mock("slack_thread", slackThread([threadMessage(olderTs, "Alice Example", "Please review the deploy notes.")]));
    await $("#nav-slack").click();
    await waitForCount("#slack-feed .feed-row", 2);
    await (await $$("#slack-feed .feed-open"))[1].click();
    await waitForCount("#st-msgs .st-msg", 1);
    await $("#reply-tab-orca").click();
    await listRead(SLACK);
    // Another thread, whose read is held: the tab is still Orca and the pane has no content yet.
    await $("#st-back").click();
    const read = await mock("slack_thread", holds);
    await (await $$("#slack-feed .feed-open"))[0].click();
    await expect($("#reply-tab-orca")).toHaveAttribute("aria-selected", "true");
    await expect($(SLACK.pane)).toBeDisplayed();
    await waitForCalls(read);
    expect(await count(`${SLACK.pane} .ho-card`)).toBe(0);
    await release(read, slackThread([threadMessage(newerTs, "Carol Example", "Second thread root")]));
    await waitForCount("#st-msgs .st-msg", 1);
    await waitForCount(`${SLACK.pane} .ho-card`, 1);
    expect(await textsOf(`${SLACK.pane} .ho-card-title`)).toEqual(["#ops のスレッド"]);
    const handoff = await mock("orca_handoff", started);
    await chooseProject(SLACK, "example-app");
    await write(SLACK, "返信案を作って");
    await sendButton(SLACK).click();
    const [call] = (await waitForCalls(handoff)) as { context: { body: string } }[];
    expect(call.context.body).toContain("Second thread root");
    expect(call.context.body).not.toContain("Please review the deploy notes.");
  });

  it("hands over the new content when the Todo detail is drawn again", async () => {
    await openTodo();
    await openPane(TODO);
    const data = todoData();
    data.tasks[0].content = "Write report v2";
    data.tasks[0].description = "Check the totals twice.";
    await mock("todoist_load", data);
    await browser.execute((id) => window.__e2e_once__(id) && document.dispatchEvent(new Event("visibilitychange")), onceId());
    await browser.waitUntil(async () => (await textsOf(`${TODO.pane} .ho-card-title`))[0] === "Write report v2", { timeoutMsg: "the card did not take the new task" });
    const handoff = await mock("orca_handoff", started);
    await chooseProject(TODO, "example-app");
    await write(TODO, "直して");
    await sendButton(TODO).click();
    const [call] = (await waitForCalls(handoff)) as { context: { title: string; body: string } }[];
    expect(call.context.title).toBe("Write report v2");
    expect(call.context.body).toContain("タスク: Write report v2");
    expect(call.context.body).toContain("Check the totals twice.");
  });
});

describe("orca handoff: attached files (A-10)", () => {
  const dropped = (repo: string, name = "shot.png") => `/work/${repo}/.orca/drops/${name}`;
  // What `orca_attach_file` answers for an image: the path with its blank, to be pasted as a bracketed paste.
  const attached = (repo: string, name = "shot.png") => ({ text: `${dropped(repo, name)} `, bracketed: true });
  // What it answers for any other file: the path in quotes with its blank.
  const attachedNote = (repo: string, name = "notes.txt") => ({ text: `'${dropped(repo, name)}' `, bracketed: false });
  const thumbs = () => count(`${SLACK.pane} .attachment`);
  const paste = (...files: Parameters<typeof fire>[2]) => fire("paste", `${SLACK.pane} textarea`, files);
  // The form takes the files (`.ho-main`); after a hand-over the pane has no terminal, and the terminal of the Orca screen takes them.
  const zone = `${SLACK.pane} .ho-main`;
  const drop = (...files: Parameters<typeof fire>[2]) => fire("drop", zone, files);

  it("takes a pasted image as a thumbnail with a button to remove it, and leaves a paste of text alone", async () => {
    await openSlack();
    await openPane(SLACK);
    await expect($(`${SLACK.pane} .attachments`)).not.toBeDisplayed();
    expect(await paste()).toBe(false);
    expect(await thumbs()).toBe(0);
    expect(await paste(image())).toBe(true);
    await waitForCount(`${SLACK.pane} .attachment`, 1);
    await expect($(`${SLACK.pane} .attachments`)).toBeDisplayed();
    await expect($(`${SLACK.pane} .attachment img`)).toHaveAttribute("alt", "shot.png");
    expect(await $(`${SLACK.pane} .attachment img`).getAttribute("src")).toMatch(/^data:image\/png;base64,/);
    await $(`${SLACK.pane} button[aria-label="shot.png を外す"]`).click();
    await waitForCount(`${SLACK.pane} .attachment`, 0);
    await expect($(`${SLACK.pane} .attachments`)).not.toBeDisplayed();
  });

  it("takes images dropped on the pane and cancels the dragover that carries a file", async () => {
    await openSlack();
    await openPane(SLACK);
    expect(await fire("dragover", zone, [image()])).toBe(true);
    expect(await fire("dragover", zone, [])).toBe(false);
    expect(await drop(image("a.png"), image("b.png"))).toBe(true);
    await waitForCount(`${SLACK.pane} .attachment`, 2);
    expect(await browser.execute((p) => [...document.querySelectorAll(`${p} .attachment img`)].map((i) => (i as HTMLImageElement).alt), SLACK.pane)).toEqual(["a.png", "b.png"]);
  });

  it("shows a file that is not an image by its name, takes it by paste and by drop, and removes it with its button", async () => {
    await openSlack();
    await openPane(SLACK);
    expect(await paste(note)).toBe(true);
    await waitForCount(`${SLACK.pane} .attachment`, 1);
    await expect($(`${SLACK.pane} .attachment .attachment-name`)).toHaveText("notes.txt");
    expect(await count(`${SLACK.pane} .attachment img`)).toBe(0);
    await drop(image("a.png"), { ...note, name: "<b>b</b>.txt" });
    await waitForCount(`${SLACK.pane} .attachment`, 3);
    expect(await textsOf(`${SLACK.pane} .attachment .attachment-name`)).toEqual(["notes.txt", "<b>b</b>.txt"]);
    expect(await count(`${SLACK.pane} .attachment .attachment-name b`)).toBe(0);
    expect(await count(`${SLACK.pane} .attachment img`)).toBe(1);
    await $(`${SLACK.pane} button[aria-label="notes.txt を外す"]`).click();
    await waitForCount(`${SLACK.pane} .attachment`, 2);
    expect(await textsOf(`${SLACK.pane} .attachment .attachment-name`)).toEqual(["<b>b</b>.txt"]);
  });

  it("puts a file that is not an image in the worktree of the chosen project and hands over its quoted path with the instruction", async () => {
    await openSlack();
    const attach = await mock("orca_attach_file", attachedNote("example-app"));
    const handoff = await mock("orca_handoff", started);
    await openPane(SLACK);
    await chooseProject(SLACK, "example-app");
    await write(SLACK, "これを読んで");
    await paste(note);
    await waitForCount(`${SLACK.pane} .attachment`, 1);
    await sendButton(SLACK).click();
    const [call] = (await waitForCalls(handoff)) as Handed[];
    expect(call.instruction).toBe("これを読んで");
    expect(call.files).toEqual([`'${dropped("example-app", "notes.txt")}' `]);
    expect(await callsOf(attach)).toEqual([{ path: "/work/example-app", name: "notes.txt", data: btoa("hello"), environment: null }]);
  });

  it("refuses a file over 20 MiB with the message when it is taken, keeping the text, without calling the command", async () => {
    await openSlack();
    const attach = await mock("orca_attach_file", attached("example-app"));
    const handoff = await mock("orca_handoff", started);
    await openPane(SLACK);
    await chooseProject(SLACK, "example-app");
    await field(SLACK).setValue("見て");
    await paste(huge);
    await waitForCard("ファイルは 20 MiB までです");
    await expect(field(SLACK)).toHaveValue("見て");
    expect(await thumbs()).toBe(0);
    expect(await callsOf(attach)).toEqual([]);
    expect(await callsOf(handoff)).toEqual([]);
  });

  it("does not take a file dropped outside the pane, and does not let the webview navigate to it", async () => {
    await openSlack();
    await openPane(SLACK);
    const before = await browser.execute(() => location.href);
    expect(await fire("dragover", "document", [image()])).toBe(true);
    expect(await fire("drop", "document", [image()])).toBe(true);
    expect(await fire("drop", "#st-msgs", [image()])).toBe(true);
    expect(await fire("drop", "document", [])).toBe(false);
    expect(await browser.execute(() => location.href)).toBe(before);
    expect(await thumbs()).toBe(0);
  });

  it("does not enable the button for an image alone: a hand-over needs the instruction", async () => {
    await openSlack();
    await openPane(SLACK);
    await chooseProject(SLACK, "example-app");
    await expect(sendButton(SLACK)).toBeDisabled();
    await paste(image());
    await waitForCount(`${SLACK.pane} .attachment`, 1);
    await expect(sendButton(SLACK)).toBeDisabled();
    await field(SLACK).setValue("見て");
    await expect(sendButton(SLACK)).toBeEnabled();
  });

  it("puts each image in the worktree of the chosen project and the target, then hands over the instruction with the paths", async () => {
    await openSlack({ orca_overview: orcaOverview(sample(), worktrees(), { target: "Studio", environments: ["Studio"] }) });
    const attach = await mock("orca_attach_file", attached("example-app"));
    const handoff = await mock("orca_handoff", started);
    await openPane(SLACK);
    await chooseProject(SLACK, "example-app");
    const ask = await write(SLACK, "この画面を直して");
    await paste(image("shot.png"));
    await waitForCount(`${SLACK.pane} .attachment`, 1);
    await sendButton(SLACK).click();
    const [call] = (await waitForCalls(handoff)) as Handed[];
    expect(call.destination).toEqual({ kind: "new", path: "/work/example-app" });
    expect(call.instruction).toBe("この画面を直して");
    expect(call.summary).toEqual(POINTS);
    // The files are not sent with the summary, and the instruction is there for the check of the length only.
    expect(Object.keys(((await callsOf(ask)) as Asked[])[0])).toEqual(["context", "instruction"]);
    expect(call.files).toEqual([`${dropped("example-app")} `]);
    expect(call.environment).toBe("Studio");
    expect(await callsOf(attach)).toEqual([{ path: "/work/example-app", name: "shot.png", data: PNG, environment: "Studio" }]);
  });

  it("puts an image in the worktree of the destination chosen in the pane, to that destination", async () => {
    await openSlack({ orca_overview: orcaOverview(sample(), worktrees(), { environments: ["Lab"] }) });
    await mock("orca_destination", orcaOverview([], [orcaWorktree("example-lab", "main")], { target: "Lab", environments: ["Lab"], known: false }));
    const attach = await mock("orca_attach_file", attached("example-lab"));
    const handoff = await mock("orca_handoff", started);
    await openPane(SLACK);
    await $(`${SLACK.pane} .ho-destination`).click();
    await $('//div[@role="menu"]//button[normalize-space(.)="Lab"]').click();
    await browser.waitUntil(async () => (await textsOf(`${SLACK.pane} .ho-destination`))[0] === "Lab", { timeoutMsg: "the destination was not shown" });
    await expect($(`${SLACK.pane} .ho-project`)).toBeEnabled();
    await chooseProject(SLACK, "example-lab");
    await write(SLACK, "見て");
    await paste(image("shot.png"));
    await waitForCount(`${SLACK.pane} .attachment`, 1);
    await sendButton(SLACK).click();
    const [call] = (await waitForCalls(handoff)) as Handed[];
    expect(call.files).toEqual([`${dropped("example-lab")} `]);
    expect(call.environment).toBe("Lab");
    expect(await callsOf(attach)).toEqual([{ path: "/work/example-lab", name: "shot.png", data: PNG, environment: "Lab" }]);
  });

  it("hands over the paths of the files, one on each line in order", async () => {
    await openSlack();
    const attach = await mock("orca_attach_file", attached("example-app", "first.png"));
    const handoff = await mock("orca_handoff", started);
    await openPane(SLACK);
    await chooseProject(SLACK, "example-app");
    await write(SLACK, "見て");
    await drop(image("first.png"), image("second.png"));
    await waitForCount(`${SLACK.pane} .attachment`, 2);
    await sendButton(SLACK).click();
    const [call] = (await waitForCalls(handoff)) as Handed[];
    expect(call.instruction).toBe("見て");
    expect(call.files).toEqual([`${dropped("example-app", "first.png")} `, `${dropped("example-app", "first.png")} `]);
    expect((await callsOf(attach)).map((c) => (c as { name: string }).name)).toEqual(["first.png", "second.png"]);
  });

  it("keeps the instruction and the images and hands over nothing when an image cannot be put, and does not put it again after a failed handoff", async () => {
    await openSlack();
    const attach = await mock("orca_attach_file", rejects("Orca がエラーを返しました（forbidden）"));
    const handoff = await mock("orca_handoff", started);
    await openPane(SLACK);
    await chooseProject(SLACK, "example-app");
    await write(SLACK, "見て");
    await paste(image());
    await waitForCount(`${SLACK.pane} .attachment`, 1);
    await sendButton(SLACK).click();
    await waitForCalls(attach);
    await waitForCard("Orca がエラーを返しました（forbidden）");
    await expect(field(SLACK)).toHaveValue("見て");
    expect(await thumbs()).toBe(1);
    expect(await callsOf(handoff)).toEqual([]);
    // The image goes this time, and the handoff fails: the next press does not put the image again.
    await mock("orca_attach_file", attached("example-app"));
    await mock("orca_handoff", rejects("Orca が指示を受け付けませんでした"));
    await sendButton(SLACK).click();
    await waitForCard("Orca が指示を受け付けませんでした");
    expect(await callsOf("orca_attach_file")).toHaveLength(1);
    const again = await mock("orca_handoff", started);
    await sendButton(SLACK).click();
    expect(await waitForCalls(again)).toHaveLength(1);
    expect(await callsOf("orca_attach_file")).toHaveLength(1);
  });

  it("keeps an image whose read was still running when the send began", async () => {
    await openSlack();
    await mock("orca_attach_file", attached("example-app"));
    const handoff = await mock("orca_handoff", holds);
    await openPane(SLACK);
    await chooseProject(SLACK, "example-app");
    await write(SLACK, "見て");
    await paste(image("first.png"));
    await waitForCount(`${SLACK.pane} .attachment`, 1);
    // The paste and the press happen in one turn of the page: the second image is read after the send has begun.
    await browser.execute(
      (pane, sendSelector, base64) => {
        const file = new File([Uint8Array.from(atob(base64), (c) => c.charCodeAt(0))], "second.png", { type: "image/png" });
        const event = new Event("paste", { bubbles: true, cancelable: true });
        Object.defineProperty(event, "clipboardData", { value: { files: [file], types: ["Files"], getData: () => "" } });
        document.querySelector(`${pane} textarea`)!.dispatchEvent(event);
        (document.querySelector(sendSelector) as HTMLElement).click();
      },
      SLACK.pane,
      `${SLACK.pane} .ho-form .chat-send`,
      PNG,
    );
    await waitForCalls(handoff);
    await release(handoff, started);
    await expect($(`${SLACK.pane} .ho-session-name`)).toExist();
    await backTo(SLACK);
    // The session shows no strip: the image waits with the item, and the form brings it back once the session is closed.
    expect(await count(`${SLACK.pane} .attachment`)).toBe(0);
    await $(`${SLACK.pane} [aria-label="閉じる"]`).click();
    await listRead(SLACK);
    expect(await browser.execute((p) => [...document.querySelectorAll(`${p} .attachment img`)].map((i) => (i as HTMLImageElement).alt), SLACK.pane)).toEqual(["second.png"]);
  });
});
