import { askScreen, boot, callsOf, claudeLoggedOut, claudeMissing, claudeReady, dueToday, emitEvent, holds, inbox, mock, onceId, orcaOverview, orcaRow, rejects, release, rowOf, setClock, slackLoad, slackTs, socketStatus, task, threadDetail, threadLoaded, timeline, timelineMessage, timers, today, todoData, waitForCalls, waitForCount, waitForText, weekOfToday, CARD } from "../support";

// The ids of what the sidebar's bottom group shows, top to bottom.
const bottomGroup = () =>
  browser.execute(() => [...document.querySelectorAll<HTMLElement>("#sidebar-bottom > *")].filter((e) => e.offsetParent !== null).map((e) => e.id));

describe("sidebar", () => {
  it("shows the Claude avatar while logged in, and its popup on a click", async () => {
    await boot({ inbox: inbox(), claude_status: claudeReady });
    const button = $("#claude-btn");
    await expect(button).toBeDisplayed();
    await expect(button).toHaveAttribute("aria-label", "Claude: claude@example.com");
    // The bottom group is Claude, settings, then the version last.
    expect(await bottomGroup()).toEqual(["claude-btn", "nav-settings", "app-version"]);
    await expect($("#add-account")).not.toExist();
    await button.click();
    const popup = $("#account-popup");
    await expect(popup).toBeDisplayed();
    await expect(popup).toHaveText(expect.stringContaining("claude@example.com"));
    await expect(popup).toHaveText(expect.stringContaining("Claude ・ Max プラン"));
    await expect(button).toHaveAttribute("aria-expanded", "true");
    // The tooltip would land on the popup, so the avatar shows none while it is open (the tooltip waits 300 ms).
    await $("#nav-mail").moveTo();
    await button.moveTo();
    await browser.pause(600);
    await expect($(".tooltip")).not.toBeDisplayed();
  });

  it("shows the running version from app_info under settings", async () => {
    await boot({ inbox: inbox(), claude_status: claudeReady });
    await expect($("#app-version")).toHaveText("v1.2.3");
    expect(await callsOf("app_info")).toHaveLength(1);
    const [settings, version] = await Promise.all([rectOf("#nav-settings"), rectOf("#app-version")]);
    expect(version.top).toBeGreaterThanOrEqual(settings.bottom);
  });

  it("starts the icons below the traffic lights, and is a place to drag the window by", async () => {
    await boot({ inbox: inbox(), claude_status: claudeReady });
    await expect($("#sidebar")).toHaveAttribute("data-tauri-drag-region");
    // The traffic lights sit at the top of the column (trafficLightPosition y 20, 14px high); the first icon starts under them.
    const top = await browser.execute(() => document.getElementById("nav-mail")!.getBoundingClientRect().top);
    expect(top).toBeGreaterThanOrEqual(40);
    // A press on an icon is not a drag.
    await expect($("#nav-mail")).not.toHaveAttribute("data-tauri-drag-region");
  });

  for (const [name, status] of [
    ["Claude Code is missing", claudeMissing],
    ["Claude is logged out", claudeLoggedOut],
  ] as const) {
    it(`hides the Claude avatar when ${name}`, async () => {
      await boot({ inbox: inbox(), claude_status: status });
      // The mock answers at once, so by the next script the sidebar has heard it.
      await waitForCalls("claude_status");
      await expect($("#claude-btn")).not.toBeDisplayed();
    });
  }

  const popup = () => $("#update-pop");
  const rectOf = (selector: string) =>
    browser.execute((s) => {
      const r = document.querySelector(s)!.getBoundingClientRect();
      return { top: r.top, bottom: r.bottom, left: r.left, right: r.right, width: r.width };
    }, selector);
  // Runs the settings card's "今すぐ確認" as the settings screen would, so the popup can be checked without leaving the screen.
  const recheck = () => browser.execute(() => document.getElementById("update-recheck")!.click());

  it("manual: shows the popup at the bottom right with the new version, and on a press replaces the app and restarts it", async () => {
    await boot({ inbox: inbox(), claude_status: claudeReady, update_mode: "manual", check_update: { version: "9.9.9", installed: false } });
    await popup().waitForDisplayed();
    await expect($("#update-pop-title")).toHaveText("v9.9.9 があります");
    await expect($("#update-pop-text")).toHaveText("入れ替えて再起動します");
    await expect($("#update-later")).toHaveText("あとで");
    await expect($("#update-go")).toHaveText("更新して再起動");
    // 320px wide, 24px from the right and bottom edges, and it takes no focus.
    const rect = await rectOf("#update-pop");
    expect({ width: rect.width, right: await browser.execute(() => innerWidth), bottom: await browser.execute(() => innerHeight) }).toEqual({ width: 320, right: rect.right + 24, bottom: rect.bottom + 24 });
    expect(await browser.execute(() => document.getElementById("update-pop")!.contains(document.activeElement))).toBe(false);
    await expect($("#nav-settings .nav-dot")).toBeDisplayed();
    await expect($("#nav-settings")).toHaveAttribute("aria-label", "設定（v9.9.9 があります）");
    // The sidebar has no update button any more: the bottom group is Claude, settings, then the version.
    expect(await bottomGroup()).toEqual(["claude-btn", "nav-settings", "app-version"]);
    expect(await callsOf("install_update")).toEqual([]);
    const install = await mock("install_update", null);
    const restart = await mock("restart_app", null);
    await $("#update-go").click();
    expect(await waitForCalls(restart)).toEqual([null]);
    expect(await callsOf(install)).toEqual([null]);
  });

  it("auto: replaces the app by itself, then the popup asks for a restart and the button restarts the app and nothing else", async () => {
    await boot({ inbox: inbox(), claude_status: claudeReady, update_mode: "auto", check_update: { version: "9.9.9", installed: false } });
    expect(await waitForCalls("install_update")).toEqual([null]);
    await popup().waitForDisplayed();
    await expect($("#update-pop-title")).toHaveText("新しい版の準備ができました");
    await expect($("#update-pop-text")).toHaveText("再起動すると v9.9.9 になります");
    await expect($("#update-go")).toHaveText("再起動");
    expect(await callsOf("restart_app")).toEqual([]);
    // From now on the backend says the app is replaced.
    const check = await mock("check_update", { version: "9.9.9", installed: true });
    const install = await mock("install_update", null);
    const restart = await mock("restart_app", null);
    await $("#update-go").click();
    expect(await waitForCalls(restart)).toEqual([null]);
    await waitForCalls(check);
    expect(await callsOf(install)).toEqual([]);
    await expect(popup()).toBeDisplayed();
    await expect($("#update-go")).toHaveText("再起動");
  });

  it("auto: while the restart waits, a version newer than the replaced one is replaced too, and the same version is not", async () => {
    await boot({ inbox: inbox(), claude_status: claudeReady, update_mode: "auto", check_update: { version: "9.9.9", installed: false } });
    expect(await waitForCalls("install_update")).toEqual([null]);
    await expect($("#update-pop-text")).toHaveText("再起動すると v9.9.9 になります");
    const same = await mock("check_update", { version: "9.9.9", installed: true });
    const install = await mock("install_update", null);
    await recheck();
    await waitForCalls(same);
    await browser.pause(300);
    expect(await callsOf(install)).toEqual([]);
    const newer = await mock("check_update", { version: "9.9.10", installed: false });
    await recheck();
    await waitForCalls(newer);
    expect(await waitForCalls(install)).toEqual([null]);
    await expect($("#update-pop-title")).toHaveText("新しい版の準備ができました");
    await expect($("#update-pop-text")).toHaveText("再起動すると v9.9.10 になります");
    await expect($("#update-go")).toHaveText("再起動");
  });

  it("waits while the update is on its way, and on a failure shows the error and keeps the popup", async () => {
    await boot({ inbox: inbox(), claude_status: claudeReady, update_mode: "manual", check_update: { version: "9.9.9", installed: false } });
    await popup().waitForDisplayed();
    const install = await mock("install_update", holds);
    const restart = await mock("restart_app", null);
    await $("#update-go").click();
    await waitForCalls(install);
    await expect($("#update-go")).toBeDisabled();
    await release(install, rejects("disk full"));
    await expect($(CARD)).toHaveText(expect.stringContaining("disk full"));
    await expect(popup()).toBeDisplayed();
    await expect($("#update-go")).toBeEnabled();
    expect(await callsOf(restart)).toEqual([]);
  });

  it("closes with あとで for that version only: the same version stays away, a newer one shows it, and the dot stays", async () => {
    await boot({ inbox: inbox(), claude_status: claudeReady, update_mode: "manual", check_update: { version: "9.9.9", installed: false } });
    await popup().waitForDisplayed();
    await $("#update-later").click();
    await expect(popup()).not.toBeDisplayed();
    await expect($("#nav-settings .nav-dot")).toBeDisplayed();
    await expect($("#settings-tab-update .tab-dot")).toExist();
    const same = await mock("check_update", { version: "9.9.9", installed: false });
    await recheck();
    await waitForCalls(same);
    await browser.pause(300);
    await expect(popup()).not.toBeDisplayed();
    const newer = await mock("check_update", { version: "9.9.10", installed: false });
    await recheck();
    await waitForCalls(newer);
    await popup().waitForDisplayed();
    await expect($("#update-pop-title")).toHaveText("v9.9.10 があります");
  });

  it("stacks a toast above the popup while it shows, and puts it back at the corner when the popup closes", async () => {
    await boot({ inbox: inbox(), claude_status: claudeReady, update_mode: "manual", check_update: { version: "9.9.9", installed: false } });
    await waitForCount("#unread-threads li", 2);
    await popup().waitForDisplayed();
    await mock("archive", true);
    const row = rowOf("unread-threads", "First unread");
    await row.moveTo();
    await row.$(".archive-row").click();
    await expect($(".toast")).toBeDisplayed();
    const toast = await rectOf(".toast");
    const pop = await rectOf("#update-pop");
    expect(toast.bottom).toBeLessThanOrEqual(pop.top);
    expect(toast.right).toBe(pop.right);
    await $("#update-later").click();
    expect(await browser.execute(() => getComputedStyle(document.querySelector(".toast")!).bottom)).toBe("24px");
  });

  it("keeps settings at the bottom edge with no account, no Claude and no update", async () => {
    await boot({ inbox: { ...inbox(), accounts: [], threads: [], historyIds: {} }, claude_status: claudeMissing });
    await waitForCalls("claude_status");
    expect(await bottomGroup()).toEqual(["nav-settings", "app-version"]);
    // The bottom group ends 16px above the window's bottom edge.
    expect(await browser.execute(() => Math.round(innerHeight - document.getElementById("app-version")!.getBoundingClientRect().bottom))).toBe(16);
  });

  // Waits until the last set_badge call is `args`.
  const waitForBadge = (args: { count: number; upcoming: number[] }) =>
    browser.waitUntil(async () => JSON.stringify((await callsOf("set_badge")).at(-1)) === JSON.stringify(args), {
      timeoutMsg: `set_badge was not called with ${JSON.stringify(args)}`,
    });

  it("sets the Dock badge to the unread threads plus the tasks that are due, and sends the moments of those still ahead", async () => {
    const todo = todoData();
    const someday = task("k6", "Someday", "p0", "upcoming");
    todo.tasks.push(task("k5", "Late bill", "p0", "overdue"), someday);
    // 2 unread threads, and "Write report" (today, no time) and "Late bill" (yesterday); "Someday" is due tomorrow 00:00.
    await boot({ inbox: inbox(), todoist_load: todo, claude_status: claudeReady });
    await waitForBadge({ count: 4, upcoming: [someday.dueAt!] });
  });

  it("counts a task from its due moment: a time ahead and tomorrow are not counted, a time that has come and a day with no time are, and no due date never is", async () => {
    const todo = todoData();
    const [morning, noon, tomorrow] = [dueToday(task("k5", "Morning", "p0", "today"), "08:00"), dueToday(task("k6", "Noon", "p0", "today"), "12:00"), task("k9", "Tomorrow", "p0", "upcoming")];
    todo.tasks.push(morning, noon, dueToday(task("k7", "All day", "p0", "today"), null), task("k8", "Yesterday", "p0", "overdue"), tomorrow);
    await boot({ inbox: inbox(), todoist_load: todo, claude_status: claudeReady });
    // A load that never answers: only the clock can move the count from here.
    const load = await mock("todoist_load", holds);
    await setClock(`${today}T07:59:00`);
    // 2 unread threads; "Write report", "All day" and "Yesterday" (00:00) have come; "Morning", "Noon" and "Tomorrow" are ahead.
    await waitForBadge({ count: 5, upcoming: [morning.dueAt!, noon.dueAt!, tomorrow.dueAt!] });
    await expect($("#nav-todo .nav-count")).toHaveText("3");
    await expect($("#nav-todo")).toHaveAttribute("aria-label", "Todo（期限到来 3 件）");
    // 08:00:30 is 08:00 to the minute, and 12:00 comes on the dot.
    await setClock(`${today}T08:00:30`);
    await waitForBadge({ count: 6, upcoming: [noon.dueAt!, tomorrow.dueAt!] });
    await expect($("#nav-todo .nav-count")).toHaveText("4");
    await setClock(`${today}T12:00:00`);
    await waitForBadge({ count: 7, upcoming: [tomorrow.dueAt!] });
    await expect($("#nav-todo .nav-count")).toHaveText("5");
    // A held load is not an answer: the count came from the remembered tasks.
    expect((await callsOf(load)).length).toBeLessThanOrEqual(1);
  });

  // An unread message of the Slack list, each in a channel of its own.
  const unreadSlack = (n: number) => Array.from({ length: n }, (_, i) => timelineMessage(slackTs(i + 1, i), `Person ${i}`, "dev", `unread ${i}`, { unread: true, channel: `C${i}` }));
  // What Orca answers with one session that waits for the user.
  const waitingOrca = () => orcaOverview([orcaRow("example-api", "main", "Task of example-api", { group: "waiting" })]);

  it("sets the Dock badge when only Slack has unread messages, and takes it off when they are read", async () => {
    await boot({ inbox: inbox([]), slack_load: slackLoad, slack_timeline: timeline(unreadSlack(2), { refreshSecs: 1 }), claude_status: claudeReady });
    await waitForBadge({ count: 2, upcoming: [] });
    await mock("slack_timeline", timeline([], { refreshSecs: 1 }));
    await waitForBadge({ count: 0, upcoming: [] });
  });

  it("sets the Dock badge when only Orca has a session that waits for the user", async () => {
    await boot({ inbox: inbox([]), orca_overview: waitingOrca(), claude_status: claudeReady });
    await expect($("#nav-orca .nav-count")).toHaveText("1");
    await waitForBadge({ count: 1, upcoming: [] });
  });

  it("sets the Dock badge to the sum of the unread threads, the tasks that are due, the unread Slack messages and the Orca sessions that wait", async () => {
    // 2 unread threads, "Write report" (today, no time), 3 unread Slack messages and 1 waiting session.
    await boot({ inbox: inbox(), todoist_load: todoData(), slack_load: slackLoad, slack_timeline: timeline(unreadSlack(3)), orca_overview: waitingOrca(), claude_status: claudeReady });
    await waitForBadge({ count: 7, upcoming: [] });
  });

  it("orders the sidebar as mail, calendar, Todo, Slack, Orca, the database, then the bottom group", async () => {
    await boot({ inbox: inbox(), slack_load: slackLoad, claude_status: claudeReady });
    await waitForCalls("claude_status");
    const ids = await browser.execute(() => [...document.querySelectorAll<HTMLElement>("#sidebar > *")].filter((e) => e.offsetParent !== null).map((e) => e.id));
    expect(ids).toEqual(["nav-mail", "nav-calendar", "nav-todo", "nav-slack", "nav-orca", "nav-database", "sidebar-bottom"]);
    await expect($("#nav-slack")).toHaveAttribute("aria-label", "Slack");
  });

  it("fills every svg of the page with its shape from the name in data-svg", async () => {
    await boot({ inbox: inbox(), claude_status: claudeReady });
    await expect($("#nav-mail svg")).toHaveAttribute("data-svg", "inbox");
    const empty = await browser.execute(() => [...document.querySelectorAll("svg[data-svg]")].filter((svg) => svg.childElementCount === 0 || !svg.getAttribute("viewBox")).map((svg) => svg.getAttribute("data-svg")));
    expect(empty).toEqual([]);
  });

  it("shows no update popup when this is the latest version", async () => {
    await boot({ inbox: inbox(), claude_status: claudeReady });
    await waitForCalls("check_update");
    await expect(popup()).not.toBeDisplayed();
    await expect($("#nav-settings .nav-dot")).not.toBeDisplayed();
    await expect($("#nav-settings")).toHaveAttribute("aria-label", "設定");
  });
});

// A-5, #676: the sidebar's order and the screens that are off come from `side_menu_settings`, and ⌘1 to ⌘6 count the shown icons from the top.
describe("sidebar: the saved order and the number keys (A-5)", () => {
  const menu = (...entries: [string, boolean][]) => ({ side_menu_settings: { items: entries.map(([screen, enabled]) => ({ screen, enabled })) } });
  // The ids of the sidebar's shown parts above the bottom group, top to bottom.
  const shownIds = () =>
    browser.execute(() => [...document.querySelectorAll<HTMLElement>("#sidebar > *")].filter((e) => e.offsetParent !== null && e.id !== "sidebar-bottom").map((e) => e.id));
  const current = () => browser.execute(() => document.querySelector("#sidebar [aria-current='page']")?.id);
  // The key is dispatched on the page as the window would give it; the listener is on the document, in the capture phase.
  const press = (key: string, init: KeyboardEventInit = { metaKey: true }) =>
    browser.execute((k, i, once) => window.__e2e_once__(once) && document.body.dispatchEvent(new KeyboardEvent("keydown", { key: k, bubbles: true, cancelable: true, ...i })), key, init, onceId());
  const tip = async (id: string) => {
    await browser.execute((i, once) => window.__e2e_once__(once) && document.getElementById(i)!.dispatchEvent(new MouseEvent("mouseover", { bubbles: true })), id, onceId());
    await expect($(".tooltip")).toBeDisplayed();
    const text = await $(".tooltip").getText();
    await browser.execute((i, once) => window.__e2e_once__(once) && document.getElementById(i)!.dispatchEvent(new MouseEvent("mouseout", { bubbles: true })), id, onceId());
    return text;
  };
  const reordered = menu(["slack", true], ["mail", true], ["database", true], ["calendar", false], ["todo", true], ["orca", false]);

  it("draws the saved order, and leaves out the screens that are off", async () => {
    await boot({ inbox: inbox(), slack_load: slackLoad, claude_status: claudeReady, ...reordered });
    await browser.waitUntil(async () => (await shownIds()).join() === "nav-slack,nav-mail,nav-database,nav-todo");
    expect(await browser.execute(() => [...document.querySelectorAll<HTMLElement>("#sidebar > *")].map((e) => e.id).filter((id) => id !== "account-popup"))).toEqual([
      "nav-slack", "nav-mail", "nav-database", "nav-calendar", "nav-todo", "nav-orca", "sidebar-bottom",
    ]);
    await expect($("#nav-calendar")).not.toBeDisplayed();
    await expect($("#nav-orca")).not.toBeDisplayed();
  });

  it("gives the tooltip of each shown icon its number, and the ones that are off none", async () => {
    await boot({ inbox: inbox(), claude_status: claudeReady, ...reordered });
    await browser.waitUntil(async () => (await shownIds()).join() === "nav-slack,nav-mail,nav-database,nav-todo");
    expect(await tip("nav-slack")).toBe("Slack ⌘1");
    // The count that the label carries stays in the tooltip, before the number.
    expect(await tip("nav-mail")).toBe("受信トレイ（未読 2 件） ⌘2");
    expect(await tip("nav-database")).toBe("データベース ⌘3");
    expect(await tip("nav-todo")).toBe("Todo ⌘4");
    expect(await browser.execute(() => document.getElementById("nav-orca")!.hasAttribute("data-shortcut"))).toBe(false);
    // The label is not changed, so what writes it (the counts) and what reads it are as they were.
    await expect($("#nav-slack")).toHaveAttribute("aria-label", "Slack");
  });

  it("numbers the icons ⌘1 to ⌘6 in the first order, and the tooltip of settings has none", async () => {
    await boot({ inbox: inbox(), claude_status: claudeReady });
    await browser.waitUntil(async () => (await browser.execute(() => document.getElementById("nav-database")!.dataset.shortcut)) === "⌘6");
    expect(await tip("nav-orca")).toBe("開発 ⌘5");
    expect(await tip("nav-settings")).toBe("設定");
  });

  it("switches to the screen at that place among the shown icons on ⌘ and a number", async () => {
    await boot({ inbox: inbox(), slack_load: slackLoad, claude_status: claudeReady, ...reordered });
    await browser.waitUntil(async () => (await shownIds()).join() === "nav-slack,nav-mail,nav-database,nav-todo");
    await press("1");
    await browser.waitUntil(async () => (await current()) === "nav-slack");
    await press("3");
    await browser.waitUntil(async () => (await current()) === "nav-database");
    await press("4");
    await browser.waitUntil(async () => (await current()) === "nav-todo");
    await press("2");
    await browser.waitUntil(async () => (await current()) === "nav-mail");
  });

  it("does nothing for a number past the shown icons, for a key without ⌘ and for ⌘ with another modifier", async () => {
    await boot({ inbox: inbox(), slack_load: slackLoad, claude_status: claudeReady, ...reordered });
    await browser.waitUntil(async () => (await shownIds()).join() === "nav-slack,nav-mail,nav-database,nav-todo");
    await press("5");
    await press("6");
    await press("1", {});
    await press("1", { metaKey: true, shiftKey: true });
    await press("1", { metaKey: true, altKey: true });
    await press("1", { metaKey: true, ctrlKey: true });
    // A press changes the screen within the same task, so none of the above moved it off the inbox, which is the second icon.
    expect(await current()).toBe("nav-mail");
    await press("3");
    await browser.waitUntil(async () => (await current()) === "nav-database");
  });

  it("does nothing for the calendar's number while the calendar is disabled for want of an account, and keeps the numbers of the others", async () => {
    await boot({ inbox: { ...inbox(), accounts: [] }, claude_status: claudeReady });
    await browser.waitUntil(async () => (await browser.execute(() => document.getElementById("nav-database")!.dataset.shortcut)) === "⌘6");
    await expect($("#nav-calendar")).toBeDisabled();
    await press("2");
    await press("3");
    await browser.waitUntil(async () => (await current()) === "nav-todo");
  });
});

// A-50, #680: a screen that is off in the menu reads nothing in the background. The reads are the commands of the screens' clocks and first reads; Rust's side (Slack's Socket Mode, the pushes of the development screen) is a unit test (`side_menu.rs`).
describe("sidebar: the reads of a screen that is off (A-50)", () => {
  const SCREENS = ["mail", "calendar", "todo", "slack", "orca", "database"];
  // The list with the screens named in `on` shown (the inbox is always shown).
  const list = (on: string[]) => ({ items: SCREENS.map((screen) => ({ screen, enabled: screen === "mail" || on.includes(screen) })) });
  const TICK = 300;
  // What each of the four screens reads in the background, and the commands that show it: the calendar's notice (C-8), Todo's count (T-5), Slack's list (S-5) and Orca's list and its stream (A-6, A-12).
  const reads = { calendar: ["calendar_week", "calendar_notices"], todo: ["todoist_cached", "todoist_load"], slack: ["slack_load"], orca: ["orca_overview", "orca_stream_open"] };
  const data = (extra: Record<string, unknown> = {}) => ({
    inbox: inbox(),
    claude_status: claudeReady,
    calendar_week: weekOfToday(),
    calendar_notices: [],
    todoist_load: todoData(),
    slack_load: slackLoad,
    orca_overview: orcaOverview([], []),
    orca_pairing_status: { paired: true },
    ...timers({ calendarNotice: TICK }),
    ...extra,
  });
  const callsOfAll = async (screens: (keyof typeof reads)[]) => Object.fromEntries(await Promise.all(screens.flatMap((s) => reads[s]).map(async (c) => [c, (await callsOf(c)).length])));
  const switchOf = (screen: string) => $(`#menu-items [data-screen="${screen}"] .switch`);
  // The settings screen on the メニュー tab. `saved` is what `side_menu_settings_set` answers to the next press.
  async function openMenu() {
    await $("#nav-settings").click();
    await $("#settings-tab-menu").click();
    await waitForCount("#menu-items .menu-row", 6);
  }
  const press = async (screen: string, saved: unknown) => {
    await mock("side_menu_settings_set", saved);
    await switchOf(screen).click();
    await waitForCalls("side_menu_settings_set");
  };
  const visibilityChange = () => browser.execute((once) => window.__e2e_once__(once) && document.dispatchEvent(new Event("visibilitychange")), onceId());

  it("calls none of the reads of the screens that are off at the start, and the inbox still loads", async () => {
    await boot(data({ side_menu_settings: list([]) }));
    await waitForCalls("side_menu_settings");
    await waitForCalls("inbox");
    // The notice's clock would have read by now.
    await browser.pause(TICK * 4);
    expect(await callsOfAll(["calendar", "todo", "slack", "orca"])).toEqual({ calendar_week: 0, calendar_notices: 0, todoist_cached: 0, todoist_load: 0, slack_load: 0, orca_overview: 0, orca_stream_open: 0 });
    await expect($("#nav-todo .nav-count")).not.toBeDisplayed();
  });

  it("reads each of them when every screen is on, as it did before the menu", async () => {
    await boot(data({ side_menu_settings: list(SCREENS) }));
    await waitForCalls("calendar_week");
    await waitForCalls("calendar_notices");
    await waitForCalls("todoist_cached");
    await waitForCalls("todoist_load");
    await waitForCalls("slack_load");
    await waitForCalls("orca_overview");
    await waitForCalls("orca_stream_open");
  });

  it("reads again when a screen is turned on in the メニュー tab, one screen at a time", async () => {
    await boot(data({ side_menu_settings: list([]) }));
    await waitForCalls("inbox");
    await openMenu();
    await press("todo", list(["todo"]));
    await waitForCalls("todoist_load");
    // The settings screen reads the workspaces itself (`slack_load`), so Slack's own read is told by the list.
    expect(await callsOfAll(["calendar", "orca"])).toEqual({ calendar_week: 0, calendar_notices: 0, orca_overview: 0, orca_stream_open: 0 });
    expect(await callsOf("slack_timeline")).toEqual([]);
    await press("slack", list(["todo", "slack"]));
    await waitForCalls("slack_timeline");
    expect(await callsOfAll(["calendar", "orca"])).toEqual({ calendar_week: 0, calendar_notices: 0, orca_overview: 0, orca_stream_open: 0 });
    await press("calendar", list(["todo", "slack", "calendar"]));
    await waitForCalls("calendar_week");
    await waitForCalls("calendar_notices");
    expect(await callsOfAll(["orca"])).toEqual({ orca_overview: 0, orca_stream_open: 0 });
    await press("orca", list(["todo", "slack", "calendar", "orca"]));
    await waitForCalls("orca_overview");
    await waitForCalls("orca_stream_open");
  });

  it("stops the notice's clock when the calendar is turned off, and takes the cards and the count away", async () => {
    const week = weekOfToday();
    await boot(data({ side_menu_settings: list(SCREENS), calendar_week: week }));
    await waitForCalls("calendar_notices", 2);
    await openMenu();
    await press("calendar", list(SCREENS.filter((s) => s !== "calendar")));
    await mock("calendar_notices", []);
    await mock("calendar_week", week);
    await browser.pause(TICK * 4);
    expect(await callsOfAll(["calendar"])).toEqual({ calendar_week: 0, calendar_notices: 0 });
    await expect($("#nav-calendar")).not.toBeDisplayed();
  });

  it("takes the Todo count out of the sidebar, the bell and the Dock badge when Todo is turned off, and reads no more", async () => {
    await boot(data({ side_menu_settings: list(SCREENS) }));
    // Two unread mails and the one task that is due.
    await waitForText("#nav-todo .nav-count", "1");
    await waitForText("#footer-bell .footer-count", "3");
    await openMenu();
    await press("todo", list(SCREENS.filter((s) => s !== "todo")));
    await expect($("#nav-todo .nav-count")).not.toBeDisplayed();
    await waitForText("#footer-bell .footer-count", "2");
    const badges = (await callsOf("set_badge")) as { count: number; upcoming: number[] }[];
    expect(badges[badges.length - 1]).toEqual({ count: 2, upcoming: [] });
    // The return of the window and the clocks read for the count while Todo is on; now they read nothing.
    await mock("todoist_load", todoData());
    await mock("todoist_cached", null);
    await visibilityChange();
    await browser.pause(300);
    expect(await callsOfAll(["todo"])).toEqual({ todoist_cached: 0, todoist_load: 0 });
    // Turned on again, it reads and counts again.
    await press("todo", list(SCREENS));
    await waitForCalls("todoist_load");
    await waitForText("#nav-todo .nav-count", "1");
    await waitForText("#footer-bell .footer-count", "3");
  });

  it("answers no event of Socket Mode and reads no list while Slack is off", async () => {
    await boot(data({ side_menu_settings: list(SCREENS) }));
    await waitForCalls("slack_load");
    const timelineCalls = await mock("slack_timeline", timeline([]));
    await emitEvent("slack-timeline-dirty");
    await waitForCalls(timelineCalls);
    await openMenu();
    await press("slack", list(SCREENS.filter((s) => s !== "slack")));
    const off = await mock("slack_timeline", timeline([]));
    await emitEvent("slack-timeline-dirty");
    await emitEvent("slack-socket-status", socketStatus("connected"));
    await browser.pause(500);
    expect(await callsOf(off)).toEqual([]);
    // Turned on again, the workspaces and the list are read again.
    const loaded = await mock("slack_load", slackLoad);
    await press("slack", list(SCREENS));
    await waitForCalls(loaded);
    await waitForCalls(off);
  });

  it("refuses a request to open a preview (A-45) while the development screen is off, and checks nothing in Rust", async () => {
    await boot(data({ side_menu_settings: list([]), orca_preview_check: null }));
    await waitForCalls("inbox");
    expect(await askScreen("write", "preview-open", { path: "/work/example-app", relative: "page.html" })).toEqual({ ok: false, error: "開発の画面がメニューで OFF になっています" });
    expect(await callsOf("orca_preview_check")).toEqual([]);
  });

  it("closes the connections of the development screen's streams when it is turned off", async () => {
    await boot(data({ side_menu_settings: list(SCREENS) }));
    await waitForCalls("orca_stream_open");
    await openMenu();
    expect(await callsOf("orca_stream_close")).toEqual([]);
    await press("orca", list(SCREENS.filter((s) => s !== "orca")));
    expect(await waitForCalls("orca_stream_close")).toEqual([{ environment: null }]);
    // Turned on again, the list is read and the stream is opened again.
    const overview = await mock("orca_overview", orcaOverview([], []));
    const open = await mock("orca_stream_open", null);
    await press("orca", list(SCREENS));
    await waitForCalls(overview);
    await waitForCalls(open);
  });
});

// A-23: only the screens with a list at the side (Todo, Orca) and the calendar's bar (C-1, C-4) have the button that closes it.
describe("sidebar: the button that closes a list (A-23)", () => {
  const shown = () => browser.execute(() => [...document.querySelectorAll<HTMLElement>(".list-toggle")].filter((b) => b.offsetParent !== null).length);

  it("shows none on the mail, Slack and settings screens, and one on the calendar, the panel's", async () => {
    await boot({ inbox: inbox(), calendar_week: weekOfToday(), todoist_load: todoData(), slack_load: slackLoad, claude_status: claudeReady });
    for (const nav of ["#nav-mail", "#nav-slack", "#nav-settings"]) {
      await $(nav).click();
      await expect($(nav)).toHaveAttribute("aria-current", "page");
      expect(await shown()).toBe(0);
    }
    await $("#nav-calendar").click();
    await expect($("#nav-calendar")).toHaveAttribute("aria-current", "page");
    await expect($("#cal-bar-toggle")).toBeDisplayed();
    expect(await shown()).toBe(1);
    // Todo has one, so the count above is not a count of nothing.
    await $("#nav-todo").click();
    await expect($("#projects-toggle")).toBeDisplayed();
    expect(await shown()).toBe(1);
  });
});

// The sidebar draws no icon of an account (A-5): the Claude avatar is the only one, and its popup closes with the screen.
describe("sidebar: no account icons", () => {
  const exists = (selector: string) => browser.execute((q) => document.querySelector(q) !== null, selector);
  const noTrays = async () => [await exists("#account-list"), await exists("#slack-workspace-list"), await exists("#sidebar .tray")];
  const messages = () => [timelineMessage(slackTs(5, 1), "Alice Example", "dev", "Please review the deploy notes.")];

  async function start(fixtures: Record<string, unknown> = {}) {
    await boot({ inbox: inbox(), slack_load: slackLoad, slack_timeline: timeline(messages()), claude_status: claudeReady, calendar_week: weekOfToday(), ...fixtures });
    await waitForCount("#unread-threads li", 2);
  }

  it("has no tray on the inbox, the calendar, Todo, Slack and the settings", async () => {
    await start();
    expect(await noTrays()).toEqual([false, false, false]);
    for (const [button, screen] of [["#nav-calendar", "#calendar"], ["#nav-todo", "#todo"], ["#nav-slack", "#slack-screen"], ["#nav-settings", "#settings"]]) {
      await $(button).click();
      await expect($(screen)).toBeDisplayed();
      expect(await noTrays()).toEqual([false, false, false]);
    }
  });

  it("keeps the sidebar beside the Slack post pane of a mail, with no tray", async () => {
    await start();
    await mock("thread", threadDetail("First unread", "Hello", false));
    await rowOf("unread-threads", "First unread").$(".subject").click();
    await threadLoaded();
    await $("#thread-slack").click();
    await expect($("#mail-slack")).toBeDisplayed();
    await expect($("#nav-mail")).toBeDisplayed();
    expect(await noTrays()).toEqual([false, false, false]);
  });

  it("opens the Claude popup beside its avatar, and closes it when the screen changes", async () => {
    await start();
    await $("#claude-btn").click();
    const popup = $("#account-popup");
    await expect(popup).toBeDisplayed();
    // The avatar is at the foot of the sidebar, so the popup is held inside the window, 8px from its bottom edge at the lowest.
    const [popupTop, popupBottom, sideRight, popupLeft, height] = await browser.execute(() => {
      const box = document.getElementById("account-popup")!.getBoundingClientRect();
      return [box.top, box.bottom, document.getElementById("sidebar")!.getBoundingClientRect().right, box.left, innerHeight];
    });
    expect(popupTop).toBeGreaterThanOrEqual(8);
    expect(popupBottom).toBeLessThanOrEqual(height - 8 + 1);
    expect(Math.round(popupLeft - sideRight)).toBe(8);
    await $("#nav-todo").click();
    await expect(popup).not.toBeDisplayed();
  });
});
