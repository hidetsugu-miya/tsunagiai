import type { NotionAccount } from "../../ts/bindings/NotionAccount";
import type { SentryConnection } from "../../ts/bindings/SentryConnection";
import { account, boot, copiedTexts, logLine, skill, stubClipboard, checked, chooseAppearance, chooseOption, fontSettings, formationConsent, chooseTheme, ghosttyImport, hiddenChannel, claudeKeyReady, claudeLoggedOut, claudeMissing, claudeReady, claudeSettings, connection, count, emitEvent, holds, inbox, mock, rejects, onceId, release, sendClaudeCode, slackLoad, socketStatus, workspace, terminalThemes, textsOf, timeline, todoData, todoPrompt, waitForCalls, waitForCount, waitForText, weekOfToday, callsOf, CARD, CARDS, waitForLog } from "../support";

type Tab = "google" | "calendar" | "todoist" | "slack" | "notion" | "claude" | "skill" | "plugins" | "orca" | "menu" | "font" | "update" | "log";

// Presses a tab of the settings screen.
const openTab = (tab: Tab) => $(`#settings-tab-${tab}`).click();

// The app with one Slack workspace whose token `slack_check` judges as given, and the settings screen open on `tab` (it opens on Google).
async function openSettings(missingScopes: string[], claude: unknown = claudeMissing, tab: Tab = "google") {
  await boot({ inbox: inbox(), slack_load: slackLoad, slack_check: checked(missingScopes), claude_status: claude });
  await $("#nav-settings").click();
  await expect($("#settings")).toBeDisplayed();
  if (tab !== "google") await openTab(tab);
}

const TABS: [Tab, string][] = [["google", "Google"], ["calendar", "カレンダー"], ["todoist", "Todoist"], ["slack", "Slack"], ["notion", "Notion"], ["claude", "Claude"], ["skill", "スキル"], ["plugins", "Plugins"], ["orca", "開発"], ["menu", "メニュー"], ["font", "フォント"], ["update", "アップデート"], ["log", "ログ"]];

const unlinkButton = () => $('button[aria-label="Example Team の接続を解除"]');

describe("settings: Google", () => {
  const meta = () => $("#google-accounts .item-meta");

  it("lists each account with its avatar, state and unread count, and the button to unlink it", async () => {
    await openSettings([]);
    await expect($("#google-accounts .item-name")).toHaveText(account);
    await waitForText("#google-accounts .item-meta", "未読 2");
    await expect($("#google-accounts .status.ok")).toHaveText("ログイン中");
    await expect(meta()).not.toHaveElementClass("warn");
    await expect($("#google-accounts .avatar")).toHaveText("M");
    await expect($("#google-accounts .icon-btn")).toHaveAttribute("aria-label", `${account} の接続を解除`);
    await expect($("#google-accounts .text-btn")).not.toExist();
  });

  it("removes the account after the confirmation, and the login screen shows when it was the last one", async () => {
    await openSettings([]);
    const remove = await mock("remove_account", null);
    await $(`button[aria-label="${account} の接続を解除"]`).click();
    const dialog = $('[role="alertdialog"]');
    await expect(dialog).toHaveText(expect.stringContaining(`${account} をつなぎAIから削除します。Gmail のメールは消えません。`));
    await dialog.$("button=キャンセル").click();
    await expect(dialog).not.toBeDisplayed();
    expect(await callsOf("remove_account")).toEqual([]);
    await mock("inbox", { ...inbox(), accounts: [], threads: [], historyIds: {} });
    await $(`button[aria-label="${account} の接続を解除"]`).click();
    await $('[role="alertdialog"]').$("button=解除").click();
    expect(await waitForCalls(remove)).toEqual([{ account }]);
    // No account is left, so the inbox's load shows the login screen, as it does on any screen.
    await expect($("#login")).toBeDisplayed();
    expect(await count("#google-accounts .item")).toBe(0);
  });

  it("shows a card and keeps the row when the removal fails", async () => {
    await openSettings([]);
    await mock("remove_account", rejects("取り消せません"));
    await $(`button[aria-label="${account} の接続を解除"]`).click();
    await $('[role="alertdialog"]').$("button=解除").click();
    await expect($(CARD)).toHaveText(expect.stringContaining("取り消せません"));
    await expect($("#google-accounts .item-name")).toHaveText(account);
    await expect($(`button[aria-label="${account} の接続を解除"]`)).toBeEnabled();
  });

  it("makes the heading and the tabs a place to drag the window by, and the tabs stay pressable", async () => {
    await openSettings([]);
    await expect($("#settings-head")).toHaveAttribute("data-tauri-drag-region", "deep");
    await openTab("calendar");
    await expect($("#settings-tab-calendar")).toHaveAttribute("aria-selected", "true");
  });

  it("warns on an account that needs a login", async () => {
    await boot({ inbox: { ...inbox(), needsLogin: [account] }, slack_load: slackLoad, slack_check: checked([]), claude_status: claudeMissing });
    await $("#nav-settings").click();
    await waitForText("#google-accounts .item-meta", "再ログインが必要です · 未読");
    await expect($("#google-accounts .status.warn")).toHaveText("要再ログイン");
    await expect(meta()).toHaveElementClass("warn");
    const login = await mock("login", account);
    await $("#google-accounts .item .text-btn").click();
    expect(await waitForCalls(login)).toEqual([{ loginHint: account }]);
  });

  it("shows an empty note with no account", async () => {
    await boot({ inbox: { ...inbox(), accounts: [], threads: [], historyIds: {} }, slack_load: slackLoad, slack_check: checked([]), claude_status: claudeMissing });
    await $("#nav-settings").click();
    await expect($("#google-accounts .card-empty")).toHaveText("アカウントはまだありません");
  });

  it("calls login with no hint from アカウントを追加", async () => {
    await openSettings([]);
    const login = await mock("login", account);
    await $("#google-add").click();
    expect(await waitForCalls(login)).toEqual([{ loginHint: null }]);
  });
});

describe("settings: calendar", () => {
  const dayButton = (label: string) => $("#calendar-items").$(`button=${label}`);
  const openCalendarSettings = async (fixtures: Record<string, unknown> = {}) => {
    await boot({ inbox: inbox(), slack_load: slackLoad, slack_check: checked([]), calendar_week: weekOfToday(), ...fixtures });
    await $("#nav-settings").click();
    await openTab("calendar");
    await expect($("#calendar-items .item-name")).toHaveText("週の始まり");
  };

  it("lists Sunday to Saturday and marks the saved first day", async () => {
    await openCalendarSettings({ calendar_first_day: 3 });
    expect(await textsOf("#calendar-items .text-btn")).toEqual(["日", "月", "火", "水", "木", "金", "土"]);
    await expect(dayButton("水")).toHaveAttribute("aria-pressed", "true");
    await expect(dayButton("日")).toHaveAttribute("aria-pressed", "false");
    // The card follows the Google card.
    expect(await browser.execute(() => document.querySelector("#google-accounts")?.closest(".card")?.nextElementSibling?.contains(document.getElementById("calendar-items")))).toBe(true);
  });

  it("saves the chosen day with set_calendar_first_day, and the next calendar view asks for weeks with it", async () => {
    await openCalendarSettings();
    await expect(dayButton("日")).toHaveAttribute("aria-pressed", "true");
    const save = await mock("set_calendar_first_day", null);
    await dayButton("月").click();
    expect(await waitForCalls(save)).toEqual([{ firstDay: 1 }]);
    await expect(dayButton("月")).toHaveAttribute("aria-pressed", "true");
    await expect(dayButton("日")).toHaveAttribute("aria-pressed", "false");
    const week = await mock("calendar_week", weekOfToday(1));
    await $("#nav-calendar").click();
    const calls = (await waitForCalls(week)) as { firstDay: number; refresh: boolean }[];
    expect(calls.every((c) => c.firstDay === 1)).toBe(true);
    // Only the weeks are dropped: the calendar lists are not asked for again.
    expect(calls.every((c) => !c.refresh)).toBe(true);
  });

  it("ignores another day pressed while a day is being saved", async () => {
    await openCalendarSettings();
    const save = await mock("set_calendar_first_day", holds);
    await dayButton("月").click();
    await waitForCalls(save);
    await dayButton("火").click();
    await release(save, null);
    await expect(dayButton("月")).toHaveAttribute("aria-pressed", "true");
    expect(await callsOf(save)).toEqual([{ firstDay: 1 }]);
  });

  it("keeps the selection and shows the error on a card when the day cannot be saved", async () => {
    await openCalendarSettings();
    await mock("set_calendar_first_day", rejects("保存できません"));
    await dayButton("火").click();
    await expect($(CARD)).toHaveText(expect.stringContaining("保存できません"));
    await expect(dayButton("日")).toHaveAttribute("aria-pressed", "true");
    await expect(dayButton("火")).toHaveAttribute("aria-pressed", "false");
  });
});

describe("settings: Todoist", () => {
  const unlink = () => $('button[aria-label="Todoist の接続を解除"]');
  const openTodoistSettings = async (fixtures: Record<string, unknown> = {}) => {
    await boot({ inbox: inbox(), slack_load: slackLoad, slack_check: checked([]), claude_status: claudeMissing, ...fixtures });
    await $("#nav-settings").click();
    await expect($("#settings")).toBeDisplayed();
    await openTab("todoist");
  };

  it("shows the card between カレンダー and Slack, connected with a button to unlink", async () => {
    await openTodoistSettings({ todoist_connected: true });
    await expect($("#todoist-items .item-name")).toHaveText("Todoist");
    await expect($("#todoist-items .status")).toHaveText("接続済み");
    await expect($("#todoist-items .status")).toHaveElementClass("ok");
    await expect(unlink()).toExist();
    expect(
      await browser.execute(() => {
        const card = document.getElementById("todoist-items")!.closest(".card")!;
        return [card.previousElementSibling!.contains(document.getElementById("calendar-items")), card.nextElementSibling!.contains(document.getElementById("slack-workspaces"))];
      }),
    ).toEqual([true, true]);
  });

  it("says 未接続 and where to enter the token, with no button, when there is no token", async () => {
    await openTodoistSettings({ todoist_connected: false });
    await expect($("#todoist-items .status")).toHaveText("未接続");
    await expect($("#todoist-items .status")).toHaveElementClass("off");
    await expect($("#todoist-items .item-meta")).toHaveText("Todo 画面でトークンを入力します");
    await expect($("#todoist-items button")).not.toExist();
  });

  it("asks before disconnecting: キャンセル sends nothing, 解除 calls todoist_disconnect, the row becomes 未接続 and the Todo count goes", async () => {
    await openTodoistSettings({ todoist_connected: true, todoist_load: todoData() });
    await waitForText("#nav-todo .nav-count", "1");
    const disconnect = await mock("todoist_disconnect", null);
    // With no token, Todoist has nothing to load.
    await mock("todoist_load", null);

    await unlink().click();
    const dialog = $('[role="alertdialog"]');
    await expect(dialog).toBeDisplayed();
    await expect(dialog).toHaveText(expect.stringContaining("Todoist のタスクは残ります"));
    await dialog.$("button=キャンセル").click();
    await expect(dialog).not.toExist();
    expect(await callsOf(disconnect)).toHaveLength(0);

    await unlink().click();
    await $('[role="alertdialog"]').$("button=解除").click();
    expect(await waitForCalls(disconnect)).toEqual([null]);
    await expect($("#todoist-items .status")).toHaveText("未接続");
    await expect($("#todoist-items button")).not.toExist();
    await expect($("#nav-todo .nav-count")).not.toBeDisplayed();
  });

  it("shows the error and keeps the row when the token cannot be removed", async () => {
    await openTodoistSettings({ todoist_connected: true });
    await mock("todoist_disconnect", rejects("資格情報を消せません"));
    await unlink().click();
    await $('[role="alertdialog"]').$("button=解除").click();
    await expect($(CARD)).toHaveText(expect.stringContaining("資格情報を消せません"));
    await expect($("#todoist-items .status")).toHaveText("接続済み");
  });
});

describe("settings: Slack", () => {
  it("asks Slack about the tokens only when the Slack tab is shown", async () => {
    await openSettings([]);
    await browser.waitUntil(async () => (await textsOf("#slack-workspaces .status")).join() === "確認中", { timeoutMsg: "the workspace row was not drawn" });
    expect(await callsOf("slack_check")).toHaveLength(0);
    await openTab("slack");
    expect(await waitForCalls("slack_check")).toEqual([{ teamId: "T1" }]);
    await expect($("#slack-workspaces .status")).toHaveText("接続済み");
  });

  it("flags a token without read scopes and lists only the missing ones in the pane", async () => {
    await openSettings(["im:history", "mpim:history"], claudeMissing, "slack");
    const status = $("#slack-workspaces .status");
    await expect(status).toHaveText("権限が不足");
    await status.click();
    const pane = $('.pane[aria-modal="true"]');
    await expect(pane).toBeDisplayed();
    await expect(pane).toHaveText(expect.stringContaining("im:history、mpim:history がありません"));
    const scopes = await $$(".pane .scopes code").map((code) => code.getText());
    expect(scopes).toEqual(["im:history", "mpim:history"]);
  });

  it("says which optional scopes the token lacks without calling the workspace short of permission", async () => {
    await boot({ inbox: inbox(), slack_load: slackLoad, slack_check: checked([], ["users:read", "files:read"]), claude_status: claudeMissing });
    await $("#nav-settings").click();
    await openTab("slack");
    const status = $("#slack-workspaces .status");
    await expect(status).toHaveText("接続済み");
    await expect(status).toHaveElementClass("ok");
    await expect($("#slack-workspaces .item-meta")).not.toHaveElementClass("warn");
    await expect($("#slack-workspaces .item-meta")).toHaveText(expect.stringContaining("users:read（送信者の名前とアイコン）、files:read（添付画像）はありません"));
    // Nothing to fix in a pane: the label is no button.
    await expect($("#slack-workspaces button.status")).not.toExist();
  });

  it("lists the optional scopes (users:read, files:read, channels:write, groups:write, emoji:read, reactions:write, usergroups:read) with the other scopes in the setup hint", async () => {
    await openSettings([], claudeMissing, "slack");
    await $("#slack-help").click();
    const scopes = await $$('[role="dialog"][aria-label="Slack の接続方法"] .scopes code').map((code) => code.getText());
    expect(scopes).toEqual(["chat:write", "channels:read", "groups:read", "channels:history", "groups:history", "im:history", "mpim:history", "users:read", "files:read", "channels:write", "groups:write", "emoji:read", "reactions:write", "usergroups:read"]);
    // The sentence on the optional scopes names it as well, outside the list.
    const named = await $$('[role="dialog"][aria-label="Slack の接続方法"] code').map((code) => code.getText());
    expect(named.filter((name) => name === "usergroups:read")).toHaveLength(2);
    expect(named.filter((name) => name === "emoji:read")).toHaveLength(2);
    expect(named.filter((name) => name === "reactions:write")).toHaveLength(2);
  });

  it("asks before disconnecting: キャンセル sends nothing, 解除 calls slack_remove_workspace", async () => {
    await openSettings([], claudeMissing, "slack");
    const remove = await mock("slack_remove_workspace", []);
    await expect($("#slack-workspaces .status")).toHaveText("接続済み");

    await unlinkButton().click();
    const dialog = $('[role="alertdialog"]');
    await expect(dialog).toBeDisplayed();
    await dialog.$("button=キャンセル").click();
    await expect(dialog).not.toExist();
    expect(await callsOf(remove)).toHaveLength(0);

    await unlinkButton().click();
    await $('[role="alertdialog"]').$("button=解除").click();
    await waitForCalls(remove);
    expect(await callsOf(remove)).toEqual([{ teamId: "T1" }]);
    await expect($("#slack-workspaces")).toHaveText(expect.stringContaining("ワークスペースはまだありません"));
  });
});

describe("settings: Notion (N-1)", () => {
  const ok: NotionAccount = { workspaceId: "w1", workspaceName: "Example Workspace", userName: "Example User", userEmail: "user@example.com", reconnect: false };
  const lapsed: NotionAccount = { workspaceId: "w2", workspaceName: "Second Space", userName: null, userEmail: "second@example.com", reconnect: true };
  const openNotion = async (list: NotionAccount[]) => {
    await boot({ inbox: inbox(), slack_load: slackLoad, slack_check: checked([]), claude_status: claudeMissing, notion_accounts: list });
    await $("#nav-settings").click();
    await expect($("#settings")).toBeDisplayed();
    await openTab("notion");
    await waitForCalls("notion_accounts");
  };
  const unlinkOf = (name: string) => $(`button[aria-label="${name} の接続を解除"]`);

  it("reads the workspaces only when the tab is shown, and draws each with its name, user, state and unlink", async () => {
    await boot({ inbox: inbox(), slack_load: slackLoad, slack_check: checked([]), claude_status: claudeMissing, notion_accounts: [ok, lapsed] });
    await $("#nav-settings").click();
    expect(await callsOf("notion_accounts")).toHaveLength(0);
    await openTab("notion");
    await waitForCalls("notion_accounts");
    await waitForText("#notion-accounts .item-name", "Second Space");
    expect(await textsOf("#notion-accounts .item-name")).toEqual(["Example Workspace", "Second Space"]);
    expect(await textsOf("#notion-accounts .item-meta")).toEqual(["Example User ・ user@example.com", "second@example.com"]);
    expect(await textsOf("#notion-accounts .status")).toEqual(["使える", "再連携が要る"]);
    await expect($$("#notion-accounts .status")[0]).toHaveElementClass("ok");
    await expect($$("#notion-accounts .status")[1]).toHaveElementClass("warn");
    await expect(unlinkOf("Example Workspace")).toExist();
    await expect(unlinkOf("Second Space")).toExist();
    await expect($$("#notion-accounts .avatar")[0]).toHaveText("EW");
  });

  it("has a header row, the rows and an add row", async () => {
    await openNotion([ok]);
    await expect($("#settings-panel-notion .card-head .logo.notion")).toHaveText("N");
    await expect($("#settings-panel-notion .card-head h2")).toHaveText(expect.stringContaining("Notion"));
    await expect($("#notion-help")).toExist();
    await expect($("#settings-panel-notion .card-add #notion-add")).toHaveText("追加");
  });

  it("says so when no workspace is connected", async () => {
    await openNotion([]);
    await expect($("#notion-accounts .card-empty")).toHaveText("ワークスペースはまだありません");
  });

  it("calls notion_connect from 追加, keeps the button off while the consent is open, and reads the list again", async () => {
    await openNotion([]);
    const connect = await mock("notion_connect", holds);
    await $("#notion-add").click();
    await waitForCalls(connect);
    await expect($("#notion-add")).toBeDisabled();
    await mock("notion_accounts", [ok]);
    await release(connect, ok);
    await waitForText("#notion-accounts .item-name", "Example Workspace");
    await expect($("#notion-add")).toBeEnabled();
  });

  it("lists a second workspace beside the first", async () => {
    await openNotion([ok]);
    const connect = await mock("notion_connect", lapsed);
    await mock("notion_accounts", [ok, lapsed]);
    await $("#notion-add").click();
    expect(await waitForCalls(connect)).toEqual([null]);
    await waitForText("#notion-accounts .item-name", "Second Space");
    expect(await textsOf("#notion-accounts .item-name")).toEqual(["Example Workspace", "Second Space"]);
  });

  it("shows the failure of a connection on a card and leaves the list as it was", async () => {
    await openNotion([ok]);
    await mock("notion_connect", rejects("ログインがタイムアウトしました"));
    await $("#notion-add").click();
    await expect($(CARD)).toHaveText(expect.stringContaining("ログインがタイムアウトしました"));
    expect(await textsOf("#notion-accounts .item-name")).toEqual(["Example Workspace"]);
    await expect($("#notion-add")).toBeEnabled();
  });

  it("asks before unlinking: キャンセル sends nothing, 解除 calls notion_disconnect with the workspace and draws the rest", async () => {
    await openNotion([ok, lapsed]);
    const remove = await mock("notion_disconnect", null);
    await unlinkOf("Example Workspace").click();
    const dialog = $('[role="alertdialog"]');
    await expect(dialog).toBeDisplayed();
    await dialog.$("button=キャンセル").click();
    await expect(dialog).not.toExist();
    expect(await callsOf(remove)).toHaveLength(0);

    await unlinkOf("Example Workspace").click();
    await $('[role="alertdialog"]').$("button=解除").click();
    expect(await waitForCalls(remove)).toEqual([{ workspaceId: "w1" }]);
    await browser.waitUntil(async () => (await textsOf("#notion-accounts .item-name")).join() === "Second Space", { timeoutMsg: "the unlinked workspace stayed" });
  });

  it("keeps the row and shows the failure on a card when the workspace cannot be unlinked", async () => {
    await openNotion([ok]);
    await mock("notion_disconnect", rejects("取り消せません"));
    await unlinkOf("Example Workspace").click();
    await $('[role="alertdialog"]').$("button=解除").click();
    await expect($(CARD)).toHaveText(expect.stringContaining("取り消せません"));
    expect(await textsOf("#notion-accounts .item-name")).toEqual(["Example Workspace"]);
  });

  it("writes a failed read of the list to the log and draws no row", async () => {
    await boot({ inbox: inbox(), slack_load: slackLoad, slack_check: checked([]), claude_status: claudeMissing, notion_accounts: rejects("読めません") });
    await $("#nav-settings").click();
    await openTab("notion");
    const line = await waitForLog("読めません");
    expect(line).toMatchObject({ level: "error", source: "notion-settings" });
    await expect($("#notion-accounts .item")).not.toExist();
  });

  it("opens the hint with the steps from ?", async () => {
    await openNotion([]);
    await $("#notion-help").click();
    await expect($('[role="dialog"][aria-label="Notion のワークスペースの追加"]')).toBeDisplayed();
  });
});

describe("settings: Slack リアルタイム更新", () => {
  // The workspace's row of the card, and the label of its state.
  const label = () => $("#slack-socket-items .status");
  const tokenField = () => $("#slack-socket-token");

  it("shows 未登録 for a workspace with no App-Level Token, with no button to delete one", async () => {
    await openSettings([], claudeMissing, "slack");
    await expect($("#slack-socket-items .item-name")).toHaveText("Example Team");
    await expect(label()).toHaveText("未登録");
    await expect(label()).toHaveElementClass("off");
    await expect($("#slack-socket-items .item-meta")).toHaveText("未登録の間は、2 分ごとに読み直します");
    await expect($("#slack-socket-items button")).not.toExist();
    // The field takes the token without showing it.
    await expect(tokenField()).toHaveAttribute("type", "password");
    expect(await textsOf("#slack-socket-team option")).toEqual(["Example Team"]);
  });

  it("registers a token for the workspace chosen, empties the field, and follows the states Rust sends", async () => {
    await openSettings([], claudeMissing, "slack");
    const set = await mock("slack_app_token_set", [socketStatus("connecting")]);
    await tokenField().setValue("xapp-1-A0123-4567-abcdef");
    await $("#slack-socket-form button").click();
    expect(await waitForCalls(set)).toEqual([{ teamId: "T1", token: "xapp-1-A0123-4567-abcdef" }]);
    await expect(label()).toHaveText("接続中");
    await expect(tokenField()).toHaveValue("");

    await emitEvent("slack-socket-status", socketStatus("connected"));
    await browser.waitUntil(async () => (await label().getText()) === "つながっている", { timeoutMsg: "the state did not follow the event" });
    await expect(label()).toHaveElementClass("ok");
    await expect($("#slack-socket-items .item-meta")).toHaveText("新着をすぐに一覧へ出します。読み直しは 5 分ごとです");

    await emitEvent("slack-socket-status", socketStatus("reconnecting"));
    await browser.waitUntil(async () => (await label().getText()) === "つなぎ直し中", { timeoutMsg: "the state did not follow the event" });
    await expect(label()).toHaveElementClass("warn");
  });

  it("shows the state a connection had before the page listened", async () => {
    await boot({ inbox: inbox(), slack_load: slackLoad, slack_check: checked([]), claude_status: claudeMissing, slack_socket_status: [socketStatus("connected")] });
    await $("#nav-settings").click();
    await openTab("slack");
    await expect(label()).toHaveText("つながっている");
  });

  it("shows why a token was refused, and stays 未登録", async () => {
    await openSettings([], claudeMissing, "slack");
    await mock("slack_app_token_set", rejects("App-Level Token は xapp- で始まります"));
    await tokenField().setValue("xoxp-1-2-3");
    await $("#slack-socket-form button").click();
    await expect($(CARD)).toHaveText(expect.stringContaining("App-Level Token は xapp- で始まります"));
    await expect(label()).toHaveText("未登録");
    await expect(tokenField()).toHaveValue("");
  });

  it("asks before deleting a token: キャンセル sends nothing, 解除 calls slack_app_token_remove", async () => {
    await boot({ inbox: inbox(), slack_load: slackLoad, slack_check: checked([]), claude_status: claudeMissing, slack_socket_status: [socketStatus("connected")] });
    await $("#nav-settings").click();
    await openTab("slack");
    const gone = await mock("slack_app_token_remove", []);
    await expect(label()).toHaveText("つながっている");
    const unlink = () => $('button[aria-label="Example Team の App-Level Token を削除"]');

    await unlink().click();
    const dialog = $('[role="alertdialog"]');
    await expect(dialog).toBeDisplayed();
    await dialog.$("button=キャンセル").click();
    await expect(dialog).not.toExist();
    expect(await callsOf(gone)).toHaveLength(0);

    await unlink().click();
    await $('[role="alertdialog"]').$("button=解除").click();
    expect(await waitForCalls(gone)).toEqual([{ teamId: "T1" }]);
    await expect(label()).toHaveText("未登録");
    await expect(unlink()).not.toExist();
  });

  it("lists the events to subscribe to and the scope of the token in the setup hint", async () => {
    await openSettings([], claudeMissing, "slack");
    await $("#slack-socket-help").click();
    const hint = $('[role="dialog"][aria-label="リアルタイム更新の設定方法"]');
    await expect(hint).toBeDisplayed();
    expect(await hint.$$("code").map((code) => code.getText())).toEqual(["message.channels", "message.groups", "connections:write", "xapp-"]);
  });
});

describe("settings: Slack の Sentry", () => {
  const second = { ...workspace, teamId: "T2", team: "Second Team" };
  const two = { workspaces: [workspace, second] };
  const kept = (teamId: string, tail: string): SentryConnection => ({ teamId, tail });
  const names = () => textsOf("#sentry-items .item-name");
  const tokenField = () => $("#sentry-token");
  const addButton = () => $("#sentry-form button");
  const unlink = (team: string) => $(`button[aria-label="${team} の Sentry のトークンを削除"]`);
  const openSentry = async (fixtures: Record<string, unknown> = {}) => {
    await boot({ inbox: inbox(), slack_load: slackLoad, slack_check: checked([]), claude_status: claudeMissing, ...fixtures });
    await $("#nav-settings").click();
    await openTab("slack");
  };

  it("shows the card after the others of the tab, with the workspace to add and a password field, and no row for none", async () => {
    await openSentry();
    await expect($("#sentry-items .card-empty")).toHaveText("接続はまだありません");
    await expect($("#sentry-items .item")).not.toExist();
    expect(await textsOf("#sentry-team option")).toEqual(["Example Team"]);
    await expect(tokenField()).toHaveAttribute("type", "password");
    await expect(tokenField()).toHaveAttribute("placeholder", "Personal Token");
    await expect($("#settings-panel-slack .card:last-child .card-head h2")).toHaveText(expect.stringContaining("Sentry"));
    await expect($("#settings-panel-slack .card:last-child #sentry-items")).toExist();
  });

  it("lists the workspaces that have a token with the tail of it, and offers the others to add", async () => {
    await openSentry({ slack_load: two, sentry_connections: [kept("T2", "a3f9")] });
    await browser.waitUntil(async () => (await names()).join() === "Second Team", { timeoutMsg: "the row of the connection was not drawn" });
    await expect($("#sentry-items .item-meta")).toHaveText("…a3f9");
    await expect($("#sentry-items .status")).toHaveText("接続済み");
    await expect($("#sentry-items .status")).toHaveElementClass("ok");
    expect(await textsOf("#sentry-team option")).toEqual(["Example Team"]);
  });

  it("saves the token for the workspace chosen, empties the field and draws the row Rust answers", async () => {
    await openSentry({ slack_load: two });
    const save = await mock("sentry_save", [kept("T2", "9z8y")]);
    await chooseOption("sentry-team", "T2");
    await tokenField().setValue("sntryu_0123456789z8y");
    await addButton().click();
    expect(await waitForCalls(save)).toEqual([{ teamId: "T2", token: "sntryu_0123456789z8y" }]);
    await expect(tokenField()).toHaveValue("");
    await browser.waitUntil(async () => (await names()).join() === "Second Team", { timeoutMsg: "the row was not drawn" });
    await expect($("#sentry-items .item-meta")).toHaveText("…9z8y");
    expect(await textsOf("#sentry-team option")).toEqual(["Example Team"]);
  });

  it("turns the add row off when every workspace has a token", async () => {
    await openSentry({ sentry_connections: [kept("T1", "a3f9")] });
    await browser.waitUntil(async () => (await names()).join() === "Example Team", { timeoutMsg: "the row was not drawn" });
    await expect(tokenField()).toBeDisabled();
    await expect(addButton()).toBeDisabled();
    await expect($("#sentry-team")).toBeDisabled();
  });

  it("shows why the token was refused on a card, draws no row, and empties the field", async () => {
    await openSentry();
    await mock("sentry_save", rejects("トークンが正しくありません"));
    await tokenField().setValue("sntryu_wrong");
    await addButton().click();
    await expect($(CARD)).toHaveText(expect.stringContaining("トークンが正しくありません"));
    await expect($("#sentry-items .item")).not.toExist();
    await expect(tokenField()).toHaveValue("");
  });

  it("asks before deleting: キャンセル sends nothing, 解除 calls sentry_delete and draws what Rust answers", async () => {
    await openSentry({ sentry_connections: [kept("T1", "a3f9")] });
    const gone = await mock("sentry_delete", []);
    await expect(unlink("Example Team")).toExist();

    await unlink("Example Team").click();
    const dialog = $('[role="alertdialog"]');
    await expect(dialog).toBeDisplayed();
    await dialog.$("button=キャンセル").click();
    await expect(dialog).not.toExist();
    expect(await callsOf(gone)).toHaveLength(0);

    await unlink("Example Team").click();
    await $('[role="alertdialog"]').$("button=解除").click();
    expect(await waitForCalls(gone)).toEqual([{ teamId: "T1" }]);
    await expect($("#sentry-items .item")).not.toExist();
    expect(await textsOf("#sentry-team option")).toEqual(["Example Team"]);
  });

  it("keeps the row and shows the failure on a card when the token cannot be deleted", async () => {
    await openSentry({ sentry_connections: [kept("T1", "a3f9")] });
    await mock("sentry_delete", rejects("資格情報の削除に失敗"));
    await expect(unlink("Example Team")).toExist();
    await unlink("Example Team").click();
    await $('[role="alertdialog"]').$("button=解除").click();
    await expect($(CARD)).toHaveText(expect.stringContaining("資格情報の削除に失敗"));
    expect(await names()).toEqual(["Example Team"]);
  });

  it("takes the row off when its Slack workspace is disconnected", async () => {
    await openSentry({ sentry_connections: [kept("T1", "a3f9")] });
    await expect(unlink("Example Team")).toExist();
    await mock("slack_remove_workspace", []);
    await unlinkButton().click();
    await $('[role="alertdialog"]').$("button=解除").click();
    await expect($("#sentry-items .item")).not.toExist();
    await expect($("#sentry-items .card-empty")).toHaveText("ワークスペースはまだありません");
    expect(await textsOf("#sentry-team option")).toEqual([]);
  });

  it("writes a failed read of the connections to the log and draws no row", async () => {
    await boot({ inbox: inbox(), slack_load: slackLoad, slack_check: checked([]), claude_status: claudeMissing, sentry_connections: rejects("読めません") });
    await $("#nav-settings").click();
    await openTab("slack");
    const line = await waitForLog("読めません");
    expect(line).toMatchObject({ level: "error", source: "sentry-settings" });
    await expect($("#sentry-items .item")).not.toExist();
  });

  it("lists the scopes and the page of the token in the setup hint", async () => {
    await openSentry();
    await $("#sentry-help").click();
    const hint = $('[role="dialog"][aria-label="Sentry の設定方法"]');
    await expect(hint).toBeDisplayed();
    const named = await hint.$$("code").map((code) => code.getText());
    for (const scope of ["event:write", "org:read", "member:read", "team:read", "project:read"]) expect(named).toContain(scope);
    await expect(hint.$("a")).toHaveAttribute("href", "https://sentry.io/settings/account/api/auth-tokens/");
  });
});

describe("settings: Claude", () => {
  const row = (n: number) => $(`#claude-items .item:nth-child(${n})`);

  for (const [state, status, meta, label] of [
    ["ready", claudeReady, "claude@example.com ・ Max プラン ・ Claude Code 2.0.0", "ログイン中"],
    ["loggedOut", claudeLoggedOut, "ログインしていません。ターミナルで claude auth login を実行してください", "未ログイン"],
    ["missing", claudeMissing, "Claude Code が見つかりません", "未導入"],
  ] as const) {
    it(`shows the subscription row first, with its ${state} state`, async () => {
      await openSettings([], status, "claude");
      await expect(row(1).$(".item-name")).toHaveText("サブスクリプション");
      await expect(row(1).$(".item-meta")).toHaveText(expect.stringContaining(meta));
      await expect(row(1).$(".status")).toHaveText(label);
    });
  }

  it("keeps the 3 cards of the tab in one tab panel: connection, model and effort, prompt", async () => {
    await openSettings([], claudeReady, "claude");
    await expect($("#settings-panel-claude")).toHaveAttribute("role", "tabpanel");
    expect(await textsOf("#settings-panel-claude > .card .card-head h2")).toEqual(["Claude", "モデルと effort", "プロンプト"]);
    await expect($("#settings-panel-claude > .card:nth-child(1) #claude-items")).toExist();
    await expect($("#settings-panel-claude > .card:nth-child(2) #claude-models")).toExist();
    await expect($("#settings-panel-claude > .card:nth-child(3) #claude-prompt")).toExist();
    await expect($("#claude-recheck")).toBeDisplayed();
    await expect($("#claude-help")).toBeDisplayed();
  });

  it("lists the subscription and the API key as 2 radio rows, the method in use checked, and no key form while no row asks for it", async () => {
    await openSettings([], claudeReady, "claude");
    await expect($("#claude-items")).toHaveAttribute("role", "radiogroup");
    expect(await count("#claude-items .item")).toBe(2);
    await expect(row(1).$('input[type="radio"]')).toBeSelected();
    await expect(row(2).$('input[type="radio"]')).not.toBeSelected();
    await expect(row(2).$(".item-name")).toHaveText("API キー");
    await expect(row(2).$(".item-meta")).toHaveText("呼び出しごとに課金されます");
    await expect(row(2).$(".status")).toHaveText("未登録");
    await expect($("#claude-key")).not.toBeDisplayed();
  });

  it("asks only claude_status at start, and claude_connection once the Claude tab is first shown", async () => {
    await openSettings([], claudeReady);
    expect(await callsOf("claude_status")).toHaveLength(1);
    expect(await callsOf("claude_connection")).toEqual([]);
    await openTab("claude");
    await expect(row(1).$(".status")).toHaveText("ログイン中");
    expect(await callsOf("claude_connection")).toHaveLength(1);
    await openTab("slack");
    await openTab("claude");
    expect(await callsOf("claude_connection")).toHaveLength(1);
    expect(await callsOf("claude_status")).toHaveLength(1);
  });

  it("redraws the rows and the usable state with one claude_connection when the check ↻ is pressed", async () => {
    await openSettings([], claudeReady, "claude");
    const status = await mock("claude_status", claudeReady);
    const card = await mock("claude_connection", connection("subscription", claudeLoggedOut, { state: "none" }));
    await $("#claude-recheck").click();
    await waitForCalls(card);
    await expect(row(1).$(".status")).toHaveText("未ログイン");
    await expect($("#claude-btn")).not.toBeDisplayed();
    expect(await callsOf(card)).toHaveLength(1);
    expect(await callsOf(status)).toEqual([]);
  });

  it("keeps the model selects and the prompt row as they were when only the connection is redrawn", async () => {
    await openSettings([], claudeReady, "claude");
    await waitForCount("#claude-models select", 6);
    await browser.waitUntil(async () => (await textsOf("#claude-prompt .status"))[0] !== "確認中");
    const marks = () => browser.execute(() => {
      const w = window as unknown as { __marks__?: Element[] };
      const now = [document.querySelector("#claude-models select"), document.querySelector("#claude-prompt .item")] as Element[];
      w.__marks__ ??= now;
      return now.every((e, i) => e === w.__marks__![i]);
    });
    expect(await marks()).toBe(true);
    const card = await mock("claude_connection", connection("subscription", claudeLoggedOut, { state: "none" }));
    await $("#claude-recheck").click();
    await waitForCalls(card);
    await expect(row(1).$(".status")).toHaveText("未ログイン");
    expect(await marks()).toBe(true);
  });

  it("shows Claude as failed when claude_status fails at start", async () => {
    await boot({ inbox: inbox(), slack_load: slackLoad, slack_check: checked([]), claude_status: rejects("状態を読めません"), claude_connection: connection("subscription", claudeMissing, { state: "none" }) });
    await expect($("#claude-btn")).not.toBeDisplayed();
  });
});

describe("settings: Claude API key", () => {
  const row = (n: number) => $(`#claude-items .item:nth-child(${n})`);
  const radio = (n: number) => row(n).$('input[type="radio"]');
  const key = "sk-ant-api03-example";
  const keyReady = { state: "ready", workspaceId: "wrkspc_01" } as const;
  // The app with the key stored (and the subscription in use unless `method` says otherwise), settings open on the Claude tab.
  async function withKey(method: "subscription" | "apiKey", apiKey: Parameters<typeof connection>[2] = keyReady) {
    const usable = method === "apiKey" ? claudeKeyReady : claudeReady;
    await boot({ inbox: inbox(), slack_load: slackLoad, slack_check: checked([]), claude_status: usable, claude_connection: connection(method, claudeReady, apiKey) });
    await $("#nav-settings").click();
    await openTab("claude");
  }
  const types = (text: string) => browser.execute((t) => {
    const input = document.getElementById("claude-key-input") as HTMLInputElement;
    input.value = t;
  }, text);

  it("shows the stored key with its workspace and the billing note, and the buttons that paste it again and delete it", async () => {
    await withKey("subscription");
    await expect(row(2).$(".item-meta")).toHaveText("ワークスペース wrkspc_01 ・ 呼び出しごとに課金されます");
    await expect(row(2).$(".status")).toHaveText("確認済み");
    await expect(row(2).$(".text-btn")).toHaveText("貼り直す");
    await expect(row(2).$('button[aria-label="API キーの接続を解除"]')).toBeDisplayed();
    await expect(row(1).$('input[type="radio"]')).toBeSelected();
  });

  it("shows the API key row as in use with no email in the usable state", async () => {
    await withKey("apiKey");
    await expect(row(2).$('input[type="radio"]')).toBeSelected();
    await expect(row(1).$('input[type="radio"]')).not.toBeSelected();
    await expect(row(1).$(".status")).toHaveText("ログイン中");
    await expect($("#claude-btn")).toHaveAttribute("aria-label", "Claude: API キー");
  });

  it("tells a key Anthropic refuses from one it could not ask about, and keeps the buttons", async () => {
    await withKey("apiKey", { state: "rejected", message: "キーが使えません。Console で確かめて、貼り直してください" });
    await expect(row(2).$(".status")).toHaveText("使えません");
    await expect(row(2).$(".item-meta")).toHaveElementClass("warn");
    await expect(row(2).$(".text-btn")).toBeDisplayed();
    await withKey("apiKey", { state: "unverified", message: "キーを確認できません: Anthropic に接続できません" });
    await expect(row(2).$(".status")).toHaveText("確認できません");
    await expect(row(2).$(".item-meta")).toHaveText(expect.stringContaining("Anthropic に接続できません"));
  });

  it("only opens the key field when the radio of the API key row is pressed with no key stored: no method change, no logout", async () => {
    await openSettings([], claudeReady, "claude");
    await mock("claude_method_set", null);
    await mock("claude_key_save", { logoutError: null });
    await radio(2).click();
    await expect($("#claude-key")).toBeDisplayed();
    await expect($("#claude-key-input")).toHaveAttribute("type", "password");
    await expect($("#claude-key-input")).toBeFocused();
    expect(await callsOf("claude_method_set")).toEqual([]);
    expect(await callsOf("claude_key_save")).toEqual([]);
    await expect(row(1).$('input[type="radio"]')).toBeSelected();
    // The press checked the radio of the row; the redraw sets it back to the method really in use.
    await expect(radio(2)).not.toBeSelected();
  });

  it("only opens the key field when the radio of a refused key is pressed: no method change, no logout", async () => {
    await withKey("subscription", { state: "rejected", message: "キーが使えません。Console で確かめて、貼り直してください" });
    await mock("claude_method_set", null);
    await radio(2).click();
    await expect($("#claude-key")).toBeDisplayed();
    await expect($("#claude-key-input")).toBeFocused();
    expect(await callsOf("claude_method_set")).toEqual([]);
    await expect(row(1).$('input[type="radio"]')).toBeSelected();
    await expect(radio(2)).not.toBeSelected();
  });

  it("does not switch when the text of a row is clicked or double-clicked, nor when an arrow key is pressed on a radio", async () => {
    await withKey("subscription");
    await mock("claude_method_set", null);
    await mock("claude_key_delete", null);
    await row(2).$(".item-name").click();
    await row(2).$(".item-name").doubleClick();
    await row(2).$(".item-meta").doubleClick();
    await radio(1).click();
    await browser.keys("ArrowDown");
    await browser.pause(300);
    expect(await callsOf("claude_method_set")).toEqual([]);
    expect(await callsOf("claude_key_delete")).toEqual([]);
    await expect(radio(1)).toBeSelected();
    await expect(radio(2)).not.toBeSelected();
  });

  it("disables the radios, the row buttons and ↻ while a change of the method is on its way", async () => {
    await withKey("subscription");
    const set = await mock("claude_method_set", holds);
    await mock("claude_connection", connection("apiKey", claudeLoggedOut, keyReady));
    await radio(2).click();
    await waitForCalls(set);
    await expect(radio(1)).toBeDisabled();
    await expect(radio(2)).toBeDisabled();
    await expect(row(2).$(".text-btn")).toBeDisabled();
    await expect(row(2).$('button[aria-label="API キーの接続を解除"]')).toBeDisabled();
    await expect($("#claude-recheck")).toBeDisabled();
    await release(set, null);
    await expect(radio(1)).not.toBeDisabled();
    await expect(radio(2)).not.toBeDisabled();
    await expect(row(2).$(".text-btn")).not.toBeDisabled();
    await expect($("#claude-recheck")).not.toBeDisabled();
  });

  it("disables ↻ and the key field's button while the states are being read", async () => {
    await openSettings([], claudeReady, "claude");
    await radio(2).click();
    await expect($("#claude-key")).toBeDisplayed();
    await expect($("#claude-key button")).not.toBeDisabled();
    const card = await mock("claude_connection", holds);
    await $("#claude-recheck").click();
    await waitForCalls(card);
    await expect($("#claude-recheck")).toBeDisabled();
    await expect($("#claude-key button")).toBeDisabled();
    await release(card, connection("subscription", claudeReady, { state: "none" }));
    await expect($("#claude-recheck")).not.toBeDisabled();
    await expect($("#claude-key button")).not.toBeDisabled();
  });

  it("shows one failed row with the error and no radio when claude_connection itself fails, and nothing can be pressed", async () => {
    await withKey("subscription");
    await mock("claude_method_set", null);
    const card = await mock("claude_connection", rejects("接続の確認に失敗しました"));
    await $("#claude-recheck").click();
    await waitForCalls(card);
    await waitForLog("接続の確認に失敗しました");
    expect(await count("#claude-items .item")).toBe(1);
    expect(await count('#claude-items input[type="radio"]')).toBe(0);
    await expect(row(1).$(".status")).toHaveText("確認できません");
    await expect(row(1).$(".item-meta")).toHaveText(expect.stringContaining("接続の確認に失敗しました"));
    // The usable state could not be read either: Claude counts as failed.
    await expect($("#claude-btn")).not.toBeDisplayed();
    await row(1).click();
    expect(await callsOf("claude_method_set")).toEqual([]);
  });

  it("registers the key with claude_key_save, empties the field as soon as it is read, and shows the key in use after the states are asked again", async () => {
    await openSettings([], claudeReady, "claude");
    await radio(2).click();
    const save = await mock("claude_key_save", { logoutError: null });
    const card = await mock("claude_connection", connection("apiKey", claudeLoggedOut, keyReady));
    await types(`  ${key}  `);
    await $("#claude-key button").click();
    expect(await waitForCalls(save)).toEqual([{ key: `  ${key}  `, switch: true }]);
    await waitForCalls(card);
    await expect($("#claude-key-input")).toHaveValue("");
    await expect($("#claude-key")).not.toBeDisplayed();
    await expect(row(2).$('input[type="radio"]')).toBeSelected();
    await expect(row(2).$(".status")).toHaveText("確認済み");
    await expect(row(1).$(".status")).toHaveText("未ログイン");
    await expect($("#claude-btn")).toHaveAttribute("aria-label", "Claude: API キー");
  });

  it("refuses a key that is not usable: the error is shown, the field is emptied and stays open, and the states stay as they were", async () => {
    await openSettings([], claudeReady, "claude");
    await radio(2).click();
    await mock("claude_key_save", rejects("Admin キー（sk-ant-admin…）は使えません。通常の API キーを貼ってください"));
    await types("sk-ant-admin01-example");
    await $("#claude-key button").click();
    await expect($(CARD)).toHaveText(expect.stringContaining("Admin キー"));
    await expect($("#claude-key-input")).toHaveValue("");
    await expect($("#claude-key")).toBeDisplayed();
    await expect(row(2).$(".status")).toHaveText("未登録");
    await expect(row(1).$('input[type="radio"]')).toBeSelected();
    await expect($("#claude-btn")).toBeDisplayed();
  });

  it("closes the key field when the key was kept but Claude Code could not be logged out, and shows that text as the error", async () => {
    await openSettings([], claudeReady, "claude");
    await radio(2).click();
    await mock("claude_key_save", { logoutError: "Claude Code のログアウトを確認できませんでした。ターミナルで claude auth logout を実行してください" });
    await mock("claude_connection", connection("apiKey", claudeReady, keyReady));
    await types(key);
    await $("#claude-key button").click();
    await expect($(CARD)).toHaveText(expect.stringContaining("claude auth logout"));
    await expect($("#claude-key")).not.toBeDisplayed();
    await expect(row(2).$('input[type="radio"]')).toBeSelected();
  });

  it("ignores a second send while the first is on its way, and keeps the typed key", async () => {
    await openSettings([], claudeReady, "claude");
    await radio(2).click();
    const save = await mock("claude_key_save", holds);
    await mock("claude_connection", connection("apiKey", claudeLoggedOut, keyReady));
    await types(key);
    await $("#claude-key button").click();
    await waitForCalls(save);
    await expect($("#claude-key button")).toBeDisabled();
    await types("sk-ant-api03-second");
    await browser.execute(
      (id) => {
        if (!window.__e2e_once__(id)) return;
        (document.getElementById("claude-key") as HTMLFormElement).requestSubmit();
      },
      onceId(),
    );
    await expect($("#claude-key-input")).toHaveValue("sk-ant-api03-second");
    expect(await callsOf(save)).toHaveLength(1);
    await release(save, { logoutError: null });
    await expect($("#claude-key")).not.toBeDisplayed();
  });

  it("pastes the key again with 貼り直す: only the key is sent to be replaced (switch false), the method stays and the field closes", async () => {
    await withKey("subscription");
    await row(2).$(".text-btn").click();
    const save = await mock("claude_key_save", { logoutError: null });
    const method = await mock("claude_method_set", null);
    await mock("claude_connection", connection("subscription", claudeReady, { state: "ready", workspaceId: "wrkspc_02" }));
    await types(key);
    await $("#claude-key button").click();
    expect(await waitForCalls(save)).toEqual([{ key, switch: false }]);
    await expect($("#claude-key")).not.toBeDisplayed();
    await expect($("#claude-key-input")).toHaveValue("");
    await expect(row(2).$(".item-meta")).toHaveText(expect.stringContaining("wrkspc_02"));
    await expect(radio(1)).toBeSelected();
    expect(await callsOf(method)).toEqual([]);
  });

  it("closes the field of 貼り直す and shows the logout that could not be confirmed, while the key is in use", async () => {
    await withKey("apiKey");
    await row(2).$(".text-btn").click();
    await mock("claude_key_save", { logoutError: "Claude Code のログアウトを確認できませんでした。ターミナルで claude auth logout を実行してください" });
    await mock("claude_connection", connection("apiKey", claudeReady, keyReady));
    await types(key);
    await $("#claude-key button").click();
    await expect($(CARD)).toHaveText(expect.stringContaining("claude auth logout"));
    await expect($("#claude-key")).not.toBeDisplayed();
    await expect(radio(2)).toBeSelected();
  });

  it("sends switch true when the field was opened by the radio of a refused key, and false when it was opened by 貼り直す", async () => {
    await withKey("subscription", { state: "rejected", message: "キーが使えません。Console で確かめて、貼り直してください" });
    const save = await mock("claude_key_save", rejects("このキーは使えません。Console で確かめて、貼り直してください"));
    await radio(2).click();
    await types(key);
    await $("#claude-key button").click();
    expect(await waitForCalls(save)).toEqual([{ key, switch: true }]);
    // The field stays open after a refusal; closing it and opening it again with 貼り直す changes what a save does.
    await row(2).$(".text-btn").click();
    await row(2).$(".text-btn").click();
    await expect($("#claude-key")).toBeDisplayed();
    await types(key);
    await $("#claude-key button").click();
    expect(await waitForCalls(save, 2)).toEqual([{ key, switch: true }, { key, switch: false }]);
  });

  it("switches to the stored key with claude_method_set when its radio is pressed", async () => {
    await withKey("subscription");
    const set = await mock("claude_method_set", null);
    await mock("claude_connection", connection("apiKey", claudeLoggedOut, keyReady));
    await radio(2).click();
    expect(await waitForCalls(set)).toEqual([{ method: "apiKey" }]);
    await expect(row(2).$('input[type="radio"]')).toBeSelected();
    await expect(row(1).$(".status")).toHaveText("未ログイン");
    await expect($("#claude-key")).not.toBeDisplayed();
  });

  it("shows the error and leaves the method as it was when the switch fails", async () => {
    await withKey("subscription");
    await mock("claude_method_set", rejects("資格情報の読み取りに失敗: x"));
    await radio(2).click();
    await expect($(CARD)).toHaveText(expect.stringContaining("資格情報の読み取りに失敗"));
    await expect(row(1).$('input[type="radio"]')).toBeSelected();
  });

  it("goes back to the subscription with claude_method_set, and keeps the key", async () => {
    await withKey("apiKey");
    const set = await mock("claude_method_set", null);
    await mock("claude_key_delete", null);
    await mock("claude_connection", connection("subscription", claudeReady, keyReady));
    await radio(1).click();
    expect(await waitForCalls(set)).toEqual([{ method: "subscription" }]);
    await expect(row(1).$('input[type="radio"]')).toBeSelected();
    await expect(row(2).$(".status")).toHaveText("確認済み");
    expect(await callsOf("claude_key_delete")).toEqual([]);
  });

  it("calls nothing when the radio of the method in use is pressed", async () => {
    await withKey("subscription");
    await mock("claude_method_set", null);
    await radio(1).click();
    await expect(row(1).$('input[type="radio"]')).toBeSelected();
    expect(await callsOf("claude_method_set")).toEqual([]);
  });

  it("opens the key field with 貼り直す without calling anything, and closes it with the same button", async () => {
    await withKey("subscription");
    await mock("claude_method_set", null);
    await row(2).$(".text-btn").click();
    await expect($("#claude-key")).toBeDisplayed();
    await expect(row(1).$('input[type="radio"]')).toBeSelected();
    expect(await callsOf("claude_method_set")).toEqual([]);
    await row(2).$(".text-btn").click();
    await expect($("#claude-key")).not.toBeDisplayed();
  });

  it("deletes the key with claude_key_delete only after the confirmation, and shows it as not registered", async () => {
    await withKey("apiKey");
    const del = await mock("claude_key_delete", null);
    await mock("claude_connection", connection("subscription", claudeLoggedOut, { state: "none" }));
    await row(2).$('button[aria-label="API キーの接続を解除"]').click();
    await expect($('[role="alertdialog"]')).toHaveText(expect.stringContaining("Claude Code はログアウトされたまま"));
    expect(await callsOf("claude_key_delete")).toEqual([]);
    await $('[role="alertdialog"]').$("button=解除").click();
    expect(await waitForCalls(del)).toEqual([null]);
    await expect(row(2).$(".status")).toHaveText("未登録");
    await expect(row(1).$('input[type="radio"]')).toBeSelected();
    await expect(row(1).$(".status")).toHaveText("未ログイン");
    await expect($("#claude-btn")).not.toBeDisplayed();
  });

  it("deletes nothing when the confirmation is cancelled", async () => {
    await withKey("subscription");
    await mock("claude_key_delete", null);
    await row(2).$('button[aria-label="API キーの接続を解除"]').click();
    await $('[role="alertdialog"]').$("button=キャンセル").click();
    expect(await callsOf("claude_key_delete")).toEqual([]);
    await expect(row(2).$(".status")).toHaveText("確認済み");
  });

  it("says in the ? hint how to get a key and that switching logs Claude Code out", async () => {
    await openSettings([], claudeReady, "claude");
    await $("#claude-help").click();
    const hint = $('[role="dialog"][aria-label="Claude の使い方"]');
    await expect(hint).toHaveText(expect.stringContaining("Console"));
    await expect(hint).toHaveText(expect.stringContaining("ワークスペースに限定したキー"));
    await expect(hint).toHaveText(expect.stringContaining("資格情報の保管場所"));
    await expect(hint).toHaveText(expect.stringContaining("Claude Code はログアウトされる"));
  });

  it("shows API キー instead of the email in the Claude popup of the side menu while the key is in use", async () => {
    await withKey("apiKey");
    await $("#claude-btn").click();
    const popup = $("#account-popup");
    await expect(popup).toHaveText(expect.stringContaining("API キー"));
    await expect(popup).not.toHaveText(expect.stringContaining("claude@example.com"));
    await expect(popup.$(".status")).toHaveText("使用中");
  });

  it("hides the Claude avatar while the key is refused", async () => {
    await boot({ inbox: inbox(), slack_load: slackLoad, slack_check: checked([]), claude_status: { state: "failed", message: "キーが使えません" }, claude_connection: connection("apiKey", claudeReady, { state: "rejected", message: "キーが使えません" }) });
    await expect($("#claude-btn")).not.toBeDisplayed();
  });
});

describe("settings: Claude model and effort", () => {
  type Purpose = keyof typeof claudeSettings;
  const PURPOSES: [Purpose, string, string][] = [
    ["slackSummary", "Slack の要約", "Slack のメッセージから Todo を作るとき"],
    ["mailSummary", "メールの要約", "メール詳細の AI 要約"],
    ["orcaHandoff", "Orca に渡す要約", "Orca に渡すペインで、渡す内容を要約するとき"],
  ];
  const selectOf = (purpose: Purpose, kind: "model" | "effort") => $(`#claude-models select[data-purpose="${purpose}"][data-kind="${kind}"]`);
  // Sets a select as the user does (value, then change); the real WebView's select popup is not driven.
  const choose = (purpose: Purpose, kind: "model" | "effort", value: string) =>
    browser.execute(
      (id, p, k, v) => {
        if (!window.__e2e_once__(id)) return;
        const select = document.querySelector<HTMLSelectElement>(`#claude-models select[data-purpose="${p}"][data-kind="${k}"]`)!;
        select.value = v;
        select.dispatchEvent(new Event("change", { bubbles: true }));
      },
      onceId(),
      purpose,
      kind,
      value,
    );
  const optionTexts = (select: ChainablePromiseElement) => select.$$("option").map((o) => o.getText());
  const drawnSelects = () => browser.execute(() => document.querySelectorAll("#claude-models select").length);

  for (const [state, status] of [["ready", claudeReady], ["loggedOut", claudeLoggedOut], ["missing", claudeMissing]] as const) {
    it(`has its own card with the defaults selected for the three purposes, while Claude is ${state}`, async () => {
      await openSettings([], status, "claude");
      await expect($("#claude-models")).toBeDisplayed();
      await expect($("#claude-prompt .item-name")).toHaveText("Todo の要約プロンプト");
      expect(await drawnSelects()).toBe(6);
      for (const [purpose] of PURPOSES) {
        await expect(selectOf(purpose, "model")).toHaveValue("sonnet");
        await expect(selectOf(purpose, "effort")).toHaveValue("medium");
      }
    });
  }

  it("names the three purposes in order, each with where it is used, and labels its selects", async () => {
    await openSettings([], claudeReady, "claude");
    const whos = await textsOf("#claude-models .model-grid .who");
    expect(whos).toEqual(PURPOSES.map(([, name, meta]) => `${name}${meta}`));
    for (const [purpose, name] of PURPOSES) {
      await expect(selectOf(purpose, "model")).toHaveAttribute("aria-label", `${name}のモデル`);
      await expect(selectOf(purpose, "effort")).toHaveAttribute("aria-label", `${name}の effort`);
    }
  });

  it("offers the three models and the five efforts for each purpose, with no Fable and no default marks", async () => {
    await openSettings([], claudeReady, "claude");
    for (const [purpose] of PURPOSES) {
      expect(await optionTexts(selectOf(purpose, "model"))).toEqual(["Haiku", "Sonnet", "Opus"]);
      expect(await optionTexts(selectOf(purpose, "effort"))).toEqual(["low", "medium", "high", "xhigh", "max"]);
    }
  });

  it("heads the columns 用途, モデル and effort, and says once that the default is Sonnet and medium", async () => {
    await openSettings([], claudeReady, "claude");
    expect(await textsOf("#claude-models .model-grid .th")).toEqual(["用途", "モデル", "effort"]);
    await expect($("#claude-models .model-note")).toHaveText("次の呼び出しから使います。デフォルトは Sonnet と medium");
  });

  it("does not wrap the description of a purpose onto a second line", async () => {
    await openSettings([], claudeReady, "claude");
    const wrapped = await browser.execute(() =>
      [...document.querySelectorAll<HTMLElement>("#claude-models .model-grid .who .item-meta")].map((e) => e.getBoundingClientRect().height > 20),
    );
    expect(wrapped).toEqual([false, false, false]);
  });

  it("shows the saved model and effort of each purpose", async () => {
    await boot({
      inbox: inbox(),
      slack_load: slackLoad,
      slack_check: checked([]),
      claude_model_settings: {
        slackSummary: { model: "opus", effort: "xhigh" },
        mailSummary: { model: "haiku", effort: "low" },
        orcaHandoff: { model: "opus", effort: "low" },
      },
    });
    await $("#nav-settings").click();
    await openTab("claude");
    await expect(selectOf("slackSummary", "model")).toHaveValue("opus");
    await expect(selectOf("slackSummary", "effort")).toHaveValue("xhigh");
    await expect(selectOf("mailSummary", "model")).toHaveValue("haiku");
    await expect(selectOf("mailSummary", "effort")).toHaveValue("low");
    await expect(selectOf("orcaHandoff", "model")).toHaveValue("opus");
    await expect(selectOf("orcaHandoff", "effort")).toHaveValue("low");
  });

  for (const [purpose, name] of PURPOSES) {
    it(`saves ${name} with claude_model_settings_save: a model alone without an effort, and an effort with its model, and leaves the other purposes alone`, async () => {
      await openSettings([], claudeReady, "claude");
      const save = await mock("claude_model_settings_save", { ...claudeSettings, [purpose]: { model: "opus", effort: "medium" } });
      await choose(purpose, "model", "opus");
      expect(await waitForCalls(save)).toEqual([{ purpose, model: "opus" }]);
      await expect(selectOf(purpose, "model")).toHaveValue("opus");
      const saveEffort = await mock("claude_model_settings_save", { ...claudeSettings, [purpose]: { model: "opus", effort: "max" } });
      await choose(purpose, "effort", "max");
      expect(await waitForCalls(saveEffort)).toEqual([{ purpose, model: "opus", effort: "max" }]);
      await expect(selectOf(purpose, "effort")).toHaveValue("max");
      for (const [other] of PURPOSES.filter(([p]) => p !== purpose)) {
        await expect(selectOf(other, "model")).toHaveValue("sonnet");
        await expect(selectOf(other, "effort")).toHaveValue("medium");
      }
    });
  }

  it("draws the effort Rust saved for the model after a change of the model", async () => {
    await openSettings([], claudeReady, "claude");
    for (const [model, effort] of [["sonnet", "high"], ["opus", "medium"], ["haiku", "medium"]] as const) {
      const save = await mock("claude_model_settings_save", { ...claudeSettings, mailSummary: { model, effort } });
      await choose("mailSummary", "model", model);
      expect(await waitForCalls(save)).toEqual([{ purpose: "mailSummary", model }]);
      await expect(selectOf("mailSummary", "model")).toHaveValue(model);
      await expect(selectOf("mailSummary", "effort")).toHaveValue(effort);
      await expect(selectOf("mailSummary", "effort")).toHaveAttribute("data-effort", effort);
    }
    // The other purposes keep their own effort.
    await expect(selectOf("orcaHandoff", "effort")).toHaveValue("medium");
  });

  it("puts the selection back and shows the error when it cannot be saved", async () => {
    await openSettings([], claudeReady, "claude");
    await mock("claude_model_settings_save", rejects("モデルが不正です: x"));
    await choose("mailSummary", "model", "haiku");
    await expect($(CARD)).toHaveText(expect.stringContaining("モデルが不正です"));
    await expect(selectOf("mailSummary", "model")).toHaveValue("sonnet");
  });

  it("writes the error to the log, with no card and no selects, when the settings cannot be read", async () => {
    await boot({ inbox: inbox(), slack_load: slackLoad, slack_check: checked([]) });
    await mock("claude_model_settings", rejects("設定を読めません"));
    await $("#nav-settings").click();
    await openTab("claude");
    await waitForLog("設定を読めません");
    await expect($("#claude-prompt .item-name")).toHaveText("Todo の要約プロンプト");
    expect(await drawnSelects()).toBe(0);
  });

  it("disables every select while a save is on its way", async () => {
    await openSettings([], claudeReady, "claude");
    const save = await mock("claude_model_settings_save", holds);
    await choose("slackSummary", "model", "opus");
    await waitForCalls(save);
    for (const [purpose] of PURPOSES) {
      await expect(selectOf(purpose, "model")).toBeDisabled();
      await expect(selectOf(purpose, "effort")).toBeDisabled();
    }
    await release(save, { ...claudeSettings, slackSummary: { model: "opus", effort: "medium" } });
    await expect(selectOf("slackSummary", "model")).toBeEnabled();
    await expect(selectOf("slackSummary", "model")).toHaveValue("opus");
    await expect(selectOf("orcaHandoff", "effort")).toBeEnabled();
  });

  describe("effort colors", () => {
    const background = (purpose: Purpose) => selectOf(purpose, "effort").getCSSProperty("background-color");
    const colorOf = (purpose: Purpose) => selectOf(purpose, "effort").getCSSProperty("color");

    it("marks each effort select with its value in data-effort, and follows a change, a save and a failed save", async () => {
      await boot({
        inbox: inbox(),
        slack_load: slackLoad,
        slack_check: checked([]),
        claude_model_settings: {
          slackSummary: { model: "sonnet", effort: "low" },
          mailSummary: { model: "sonnet", effort: "medium" },
          orcaHandoff: { model: "sonnet", effort: "xhigh" },
        },
      });
      await $("#nav-settings").click();
      await openTab("claude");
      await expect(selectOf("slackSummary", "effort")).toHaveAttribute("data-effort", "low");
      await expect(selectOf("mailSummary", "effort")).toHaveAttribute("data-effort", "medium");
      await expect(selectOf("orcaHandoff", "effort")).toHaveAttribute("data-effort", "xhigh");
      // The model selects carry none.
      await expect(selectOf("slackSummary", "model")).not.toHaveAttribute("data-effort");
      // A change is followed at once, while the save is still on its way.
      const save = await mock("claude_model_settings_save", holds);
      await choose("slackSummary", "effort", "max");
      await waitForCalls(save);
      await expect(selectOf("slackSummary", "effort")).toHaveAttribute("data-effort", "max");
      await release(save, { ...claudeSettings, slackSummary: { model: "sonnet", effort: "max" } });
      await expect(selectOf("slackSummary", "effort")).toHaveAttribute("data-effort", "max");
      // A failed save puts the value, and its mark, back.
      await mock("claude_model_settings_save", rejects("effort が不正です"));
      await choose("slackSummary", "effort", "low");
      await expect($(CARD)).toHaveText(expect.stringContaining("effort が不正です"));
      await expect(selectOf("slackSummary", "effort")).toHaveValue("max");
      await expect(selectOf("slackSummary", "effort")).toHaveAttribute("data-effort", "max");
    });

    it("gives each effort its own colors: the same background and text for equal values, and different ones for different values", async () => {
      await boot({
        inbox: inbox(),
        slack_load: slackLoad,
        slack_check: checked([]),
        claude_model_settings: {
          slackSummary: { model: "sonnet", effort: "low" },
          mailSummary: { model: "sonnet", effort: "medium" },
          orcaHandoff: { model: "sonnet", effort: "high" },
        },
      });
      await $("#nav-settings").click();
      await openTab("claude");
      const seen = new Set<string>();
      for (const [purpose] of PURPOSES) {
        const bg = (await background(purpose)).value;
        const fg = (await colorOf(purpose)).value;
        expect(bg).not.toBe(fg);
        seen.add(`${bg}/${fg}`);
      }
      expect(seen.size).toBe(3);
      // xhigh differs from the three above.
      const save = await mock("claude_model_settings_save", { ...claudeSettings, orcaHandoff: { model: "sonnet", effort: "xhigh" } });
      await choose("orcaHandoff", "effort", "xhigh");
      await waitForCalls(save);
      seen.add(`${(await background("orcaHandoff")).value}/${(await colorOf("orcaHandoff")).value}`);
      expect(seen.size).toBe(4);
    });
  });

  it("says in the ? hint that each of the three Claude calls has its own setting", async () => {
    await openSettings([], claudeReady, "claude");
    await $("#claude-help").click();
    await expect($('[role="dialog"][aria-label="Claude の使い方"] .foot')).toHaveText(
      expect.stringContaining("Slack の要約、メールの要約、Orca に渡す要約のそれぞれに選べます"),
    );
  });
});

describe("settings: Todo prompt", () => {
  const row = () => $("#claude-prompt .item");

  for (const [state, status] of [["ready", claudeReady], ["loggedOut", claudeLoggedOut], ["missing", claudeMissing]] as const) {
    it(`has its row in the prompt card while Claude is ${state}`, async () => {
      await openSettings([], status, "claude");
      await expect(row().$(".item-name")).toHaveText("Todo の要約プロンプト");
      await expect(row().$(".status")).toHaveText("デフォルト");
      await expect(row().$(".status")).toHaveElementClass("off");
      await expect(row().$(".text-btn")).toHaveText("確認・編集");
    });
  }

  it("says 編集済み when the instructions were edited", async () => {
    await boot({ inbox: inbox(), slack_load: slackLoad, slack_check: checked([]), claude_status: claudeReady, claude_todo_prompt: { ...todoPrompt, body: "My body", edited: true } });
    await $("#nav-settings").click();
    await openTab("claude");
    await expect(row().$(".status")).toHaveText("編集済み");
    await expect(row().$(".status")).toHaveElementClass("ok");
  });

  it("opens the prompt screen with 確認・編集 and shows the saved instructions there", async () => {
    await openSettings([], claudeReady, "claude");
    await expect($("#claude-items .item:nth-child(1) .item-meta")).toHaveText(expect.stringContaining("claude@example.com"));
    await expect(row().$(".status")).toHaveText("デフォルト");
    await row().$(".text-btn").click();
    await expect($("#prompt")).toBeDisplayed();
    await expect($("#settings")).not.toBeDisplayed();
    await expect($("#prompt-body")).toHaveValue(todoPrompt.body);
  });
});

describe("settings: update", () => {
  const openUpdate = async (fixtures: Record<string, unknown> = {}) => {
    await boot({ inbox: inbox(), ...fixtures });
    await $("#nav-settings").click();
    await expect($("#settings")).toBeDisplayed();
    await openTab("update");
  };
  const status = () => $("#update-items .status");
  const modeButton = (label: string) => $("#update-items").$(`button=${label}`);

  it("shows the running version from app_info and that this is the latest", async () => {
    await openUpdate({ app_info: { version: "0.15.0", updatable: true } });
    await expect($("#update-items .item-name")).toHaveText("v0.15.0");
    await expect(status()).toHaveText("最新");
  });

  it("says a newer version is out while the mode is manual, and replaced once the mode is auto", async () => {
    await openUpdate({ update_mode: "manual", check_update: { version: "9.9.9", installed: false } });
    await expect(status()).toHaveText("v9.9.9 があります");
    expect(await callsOf("install_update")).toEqual([]);
    await openUpdate({ update_mode: "auto", check_update: { version: "9.9.9", installed: false } });
    await expect(status()).toHaveText("再起動で v9.9.9 になります");
  });

  it("shows the version and 対応していません without checking where the app cannot update itself", async () => {
    await openUpdate({ app_info: { version: "0.15.0", updatable: false } });
    await expect($("#update-items .item-name")).toHaveText("v0.15.0");
    await expect(status()).toHaveText("対応していません");
    await expect($("#update-recheck")).toBeDisabled();
    expect(await callsOf("check_update")).toEqual([]);
  });

  it("saves the mode with set_update_mode, and marks the chosen one", async () => {
    await openUpdate({ update_mode: "manual" });
    await expect(modeButton("手動")).toHaveAttribute("aria-pressed", "true");
    await expect(modeButton("自動")).toHaveAttribute("aria-pressed", "false");
    const save = await mock("set_update_mode", null);
    await modeButton("自動").click();
    expect(await waitForCalls(save)).toEqual([{ mode: "auto" }]);
    await expect(modeButton("自動")).toHaveAttribute("aria-pressed", "true");
    await modeButton("手動").click();
    expect(await waitForCalls(save, 2)).toEqual([{ mode: "auto" }, { mode: "manual" }]);
    await expect(modeButton("手動")).toHaveAttribute("aria-pressed", "true");
  });

  it("replaces a newer version found earlier as soon as the mode becomes auto", async () => {
    await openUpdate({ update_mode: "manual", check_update: { version: "9.9.9", installed: false } });
    await expect(status()).toHaveText("v9.9.9 があります");
    const install = await mock("install_update", null);
    await modeButton("自動").click();
    expect(await waitForCalls(install)).toEqual([null]);
    await expect(status()).toHaveText("再起動で v9.9.9 になります");
  });

  it("checks again on 今すぐ確認, and redraws the card and the popup", async () => {
    await openUpdate();
    await expect(status()).toHaveText("最新");
    await expect($("#update-pop")).not.toBeDisplayed();
    await expect($("#update-items").$("button=更新して再起動")).not.toExist();
    const check = await mock("check_update", { version: "9.9.9", installed: false });
    await $("#update-recheck").click();
    expect(await waitForCalls(check)).toEqual([null]);
    await expect(status()).toHaveText("v9.9.9 があります");
    await expect($("#update-pop-title")).toHaveText("v9.9.9 があります");
  });

  it("has the same button as the popup in the card, which waits while it works, and still shows after あとで", async () => {
    await openUpdate({ update_mode: "manual", check_update: { version: "9.9.9", installed: false } });
    await expect(status()).toHaveText("v9.9.9 があります");
    await $("#update-later").click();
    await expect($("#update-pop")).not.toBeDisplayed();
    const button = $("#update-items").$("button=更新して再起動");
    await expect(button).toHaveElementClass("primary");
    const install = await mock("install_update", holds);
    const restart = await mock("restart_app", null);
    await button.click();
    await waitForCalls(install);
    await expect($("#update-items").$("button=更新して再起動")).toBeDisabled();
    await release(install, null);
    expect(await waitForCalls(restart)).toEqual([null]);
    expect(await callsOf(install)).toEqual([null]);
  });

  it("names the button 再起動 in the card once the app is replaced", async () => {
    await openUpdate({ update_mode: "auto", check_update: { version: "9.9.9", installed: false } });
    await expect(status()).toHaveText("再起動で v9.9.9 になります");
    const restart = await mock("restart_app", null);
    await $("#update-items").$("button=再起動").click();
    expect(await waitForCalls(restart)).toEqual([null]);
  });
});

describe("settings: Ghostty (the Orca tab)", () => {
  // The app with `fixtures` added, and the settings screen open on the Orca tab.
  async function openOrcaTab(fixtures: Record<string, unknown> = {}) {
    await boot({ inbox: inbox(), slack_load: slackLoad, slack_check: checked([]), claude_status: claudeMissing, ...fixtures });
    await $("#nav-settings").click();
    await openTab("orca");
    await expect($("#settings-panel-orca")).toBeDisplayed();
  }

  const status = () => $("#ghostty-items .status");

  it("says nothing has been imported yet, and asks nothing of Ghostty by itself", async () => {
    await openOrcaTab();
    await expect(status()).toHaveText("未取り込み");
    await expect($("#ghostty-items .item-meta")).toHaveText("まだ取り込んでいません");
    await expect($("#ghostty-import")).toBeEnabled();
    expect(await callsOf("ghostty_import")).toEqual([]);
  });

  it("imports with the button, and lists the files read, the entries taken and the entries left with the reason", async () => {
    await openOrcaTab();
    const imported = await mock(
      "ghostty_import",
      ghosttyImport({
        imported: ["font-size = 14", "theme = light:Paper,dark:Dracula", "keybind = delete=text:\\x08"],
        skipped: [
          { entry: "window-width = 100", reason: "対応していません" },
          { entry: "theme = Nope", reason: "テーマ Nope が見つかりません" },
        ],
        files: ["~/.config/ghostty/config", "~/Library/Application Support/com.mitchellh.ghostty/config.ghostty"],
      }),
    );
    await $("#ghostty-import").click();
    expect(await waitForCalls(imported)).toEqual([null]);
    await expect(status()).toHaveText("取り込み済み");
    await expect($("#ghostty-items .item-meta")).toHaveText("読んだファイル: ~/.config/ghostty/config、~/Library/Application Support/com.mitchellh.ghostty/config.ghostty");
    await expect($("#ghostty-imported h3")).toHaveText("取り込んだ項目（3）");
    expect(await textsOf("#ghostty-imported li code")).toEqual(["font-size = 14", "theme = light:Paper,dark:Dracula", "keybind = delete=text:\\x08"]);
    await expect($("#ghostty-skipped h3")).toHaveText("取り込めなかった項目（2）");
    expect(await textsOf("#ghostty-skipped li code")).toEqual(["window-width = 100", "theme = Nope"]);
    expect(await textsOf("#ghostty-skipped .ghostty-reason")).toEqual(["対応していません", "テーマ Nope が見つかりません"]);
    await expect($("#ghostty-import")).toBeEnabled();
  });

  it("shows the import saved before, without reading the config again", async () => {
    await openOrcaTab({ ghostty_saved: ghosttyImport({ imported: ["font-size = 14"], skipped: [] }) });
    await expect(status()).toHaveText("取り込み済み");
    await expect($("#ghostty-imported h3")).toHaveText("取り込んだ項目（1）");
    await expect($("#ghostty-skipped h3")).toHaveText("取り込めなかった項目（0）");
    expect(await count("#ghostty-skipped li")).toBe(0);
    expect(await callsOf("ghostty_import")).toEqual([]);
  });

  it("shows the message when the config cannot be read, and keeps the import it had", async () => {
    await openOrcaTab({ ghostty_saved: ghosttyImport({ imported: ["font-size = 14"] }) });
    await mock("ghostty_import", rejects("Ghostty の設定ファイルが見つかりません。探した場所: ~/.config/ghostty/config.ghostty"));
    await $("#ghostty-import").click();
    await expect($(CARD)).toHaveText("Ghostty の設定ファイルが見つかりません。探した場所: ~/.config/ghostty/config.ghostty");
    await expect(status()).toHaveText("取り込み済み");
    await expect($("#ghostty-imported h3")).toHaveText("取り込んだ項目（1）");
    await expect($("#ghostty-import")).toBeEnabled();
  });
});

// A-37 (#893): the PCs that the owner agreed to put tsunagiai-mcp on, in the Orca tab.
describe("settings: the PCs with the server of the orchestration (the Orca tab)", () => {
  async function openOrcaTab(fixtures: Record<string, unknown> = {}) {
    await boot({ inbox: inbox(), slack_load: slackLoad, slack_check: checked([]), claude_status: claudeMissing, ...fixtures });
    await $("#nav-settings").click();
    await openTab("orca");
    await expect($("#settings-panel-orca")).toBeDisplayed();
  }

  const names = () => textsOf("#formation-consent-items .item-name");
  const revokeButton = (environment: string) => $(`#formation-consent-items button[aria-label="${environment} の同意を取り消す"]`);

  it("says that no PC has the server when none was agreed, and reads the consents once the tab is shown", async () => {
    await openOrcaTab();
    await expect($("#formation-consent-items .card-empty")).toHaveText("サーバーを置いた PC はありません");
    expect(await callsOf("formation_consents")).toEqual([null]);
    expect(await callsOf("formation_consent_revoke")).toEqual([]);
  });

  it("lists each PC with the version of its server, its state and a button that takes the consent back", async () => {
    await openOrcaTab({ formation_consents: [formationConsent("box", "0.83.0"), formationConsent("mac-studio", "0.84.0")] });
    await browser.waitUntil(async () => (await names()).length === 2);
    expect(await names()).toEqual(["box", "mac-studio"]);
    expect(await textsOf("#formation-consent-items .item-meta")).toEqual(["tsunagiai-mcp 0.83.0", "tsunagiai-mcp 0.84.0"]);
    expect(await textsOf("#formation-consent-items .status")).toEqual(["置き済み", "置き済み"]);
    expect(await textsOf("#formation-consent-items .text-btn")).toEqual(["取り消す", "取り消す"]);
    await expect($("#formation-consent-help")).toHaveAttribute("aria-label", "サーバーを置いた PC の説明");
  });

  it("takes the consent of that PC back with the environment's name, and draws the consents that are left", async () => {
    await openOrcaTab({ formation_consents: [formationConsent("box"), formationConsent("mac-studio")] });
    await browser.waitUntil(async () => (await names()).length === 2);
    const revoke = await mock("formation_consent_revoke", [formationConsent("mac-studio")]);
    await revokeButton("box").click();
    expect(await waitForCalls(revoke)).toEqual([{ environment: "box" }]);
    await browser.waitUntil(async () => (await names()).join() === "mac-studio");
    await expect($(CARDS)).not.toExist();
  });

  it("keeps the button off while the PC is being cleared, and draws nothing new until the answer", async () => {
    await openOrcaTab({ formation_consents: [formationConsent("box")] });
    await browser.waitUntil(async () => (await names()).length === 1);
    const revoke = await mock("formation_consent_revoke", holds);
    await revokeButton("box").click();
    await waitForCalls(revoke);
    await expect(revokeButton("box")).toBeDisabled();
    await release(revoke, []);
    await expect($("#formation-consent-items .card-empty")).toHaveText("サーバーを置いた PC はありません");
    expect(await callsOf(revoke)).toHaveLength(1);
  });

  it("shows the words of a refusal on a card, and keeps the PC listed with its button on", async () => {
    await openOrcaTab({ formation_consents: [formationConsent("mac-studio")] });
    await browser.waitUntil(async () => (await names()).length === 1);
    const reason = "環境「mac-studio」には、フォーメーション（won-1）が残っています。削除してから取り消してください";
    await mock("formation_consent_revoke", rejects(reason));
    await revokeButton("mac-studio").click();
    await expect($(CARD)).toHaveText(reason);
    expect(await names()).toEqual(["mac-studio"]);
    await expect(revokeButton("mac-studio")).toBeEnabled();
  });

  it("writes the words to the log, with no card, when the consents cannot be read", async () => {
    await openOrcaTab({ formation_consents: rejects("formation-remote.json を読めません") });
    await waitForLog("formation-remote.json を読めません");
  });
});

describe("settings: the 開発 tab (the tab `orca`) has no card of the target (A-6)", () => {
  it("has the cards of the terminal colors, the editor, Ghostty's settings, the PCs with the server and this machine's Orca, and none of the target", async () => {
    await boot({ inbox: inbox(), slack_load: slackLoad, slack_check: checked([]), claude_status: claudeMissing });
    await $("#nav-settings").click();
    await openTab("orca");
    await expect($("#settings-panel-orca")).toBeDisplayed();
    expect(await textsOf("#settings-panel-orca > .card h2")).toEqual(["ターミナルの配色", "エディタ", "Ghostty の設定", "サーバーを置いた PC", "このマシンの Orca"]);
    expect(await count("#orca-target-items, #orca-target-help")).toBe(0);
  });
});

// A-12: the card 「このマシンの Orca」 of the 開発 tab: the pairing link that Orca makes for "This computer".
describe("settings: the pairing of this machine's Orca (the 開発 tab, A-12)", () => {
  async function openPairing(fixtures: Record<string, unknown> = {}) {
    await boot({ inbox: inbox(), slack_load: slackLoad, slack_check: checked([]), claude_status: claudeMissing, ...fixtures });
    await $("#nav-settings").click();
    await openTab("orca");
    await waitForCalls("orca_pairing_status");
  }
  const LINK = "orca://pair?code=example";

  it("reads whether a pairing is kept each time the tab is shown, and asks Orca nothing", async () => {
    await boot({ inbox: inbox(), slack_load: slackLoad, slack_check: checked([]), claude_status: claudeMissing, orca_pairing_status: { paired: true } });
    await $("#nav-settings").click();
    await openTab("orca");
    await waitForCalls("orca_pairing_status");
    await expect($("#orca-pairing-items .status.ok")).toHaveText("ペアリング済み");
    await $("#settings-tab-google").click();
    await openTab("orca");
    await waitForCalls("orca_pairing_status", 2);
  });

  it("has a header row with the hint, the state row and a password field with the save button", async () => {
    await openPairing();
    await expect($("#orca-pairing-help")).toHaveAttribute("aria-label", "このマシンの Orca の説明");
    await expect($("#orca-pairing-items .item-name")).toHaveText("このマシンの Orca");
    await expect($("#orca-pairing-items .status.off")).toHaveText("未設定");
    expect(await count("#orca-pairing-items .text-btn")).toBe(0);
    await expect($("#orca-pairing-link")).toHaveAttribute("type", "password");
    await expect($("#orca-pairing-link")).toHaveAttribute("aria-label", "ペアリングリンク");
    expect(await textsOf("#orca-pairing-form .text-btn")).toEqual(["保存"]);
  });

  it("calls orca_pairing_save with the link from 保存, empties the field at once and shows the pairing", async () => {
    await openPairing();
    const save = await mock("orca_pairing_save", holds);
    await $("#orca-pairing-link").setValue(LINK);
    await $("#orca-pairing-save").click();
    expect(await waitForCalls(save)).toEqual([{ link: LINK }]);
    await expect($("#orca-pairing-link")).toHaveValue("");
    await expect($("#orca-pairing-save")).toBeDisabled();
    await release(save, { paired: true });
    await expect($("#orca-pairing-items .status.ok")).toHaveText("ペアリング済み");
    await expect($("#orca-pairing-save")).toBeEnabled();
    await expect($(CARDS)).not.toExist();
  });

  it("saves nothing for an empty field", async () => {
    await openPairing();
    const save = await mock("orca_pairing_save", { paired: true });
    await $("#orca-pairing-link").setValue("  ");
    await $("#orca-pairing-save").click();
    await browser.pause(300);
    expect(await callsOf(save)).toEqual([]);
  });

  it("shows the words of a refused link on a card and stays unset", async () => {
    await openPairing();
    const reason = "ペアリングリンクの形が正しくありません";
    await mock("orca_pairing_save", rejects(reason));
    await $("#orca-pairing-link").setValue("not a link");
    await $("#orca-pairing-save").click();
    await expect($(CARD)).toHaveText(reason);
    await expect($("#orca-pairing-items .status.off")).toHaveText("未設定");
    await expect($("#orca-pairing-link")).toHaveValue("");
  });

  it("revokes the pairing from 取り消す and goes back to 未設定", async () => {
    await openPairing({ orca_pairing_status: { paired: true } });
    const revoke = await mock("orca_pairing_revoke", { paired: false });
    await $('#orca-pairing-items [aria-label="ペアリングを取り消す"]').click();
    expect(await waitForCalls(revoke)).toEqual([null]);
    await expect($("#orca-pairing-items .status.off")).toHaveText("未設定");
    expect(await count("#orca-pairing-items .text-btn")).toBe(0);
  });

  it("writes the words to the log, with no card, when the pairing cannot be read", async () => {
    await openPairing({ orca_pairing_status: rejects("キーチェーンを読めません") });
    await waitForLog("キーチェーンを読めません");
    await expect($(CARDS)).not.toExist();
  });

  it("opens a hint that says the link is made for This computer, and that the token stays out of the screen", async () => {
    await openPairing();
    await $("#orca-pairing-help").click();
    await expect($("#orca-pairing-help")).toHaveAttribute("aria-expanded", "true");
    await expect($('[role="dialog"][aria-label="このマシンの Orca"]')).toHaveText(expect.stringContaining("This computer"));
    await expect($('[role="dialog"][aria-label="このマシンの Orca"]')).toHaveText(expect.stringContaining("トークンは OS の資格情報の保管場所"));
  });
});

describe("settings: terminal colors (the Orca tab, A-14, A-15)", () => {
  // The app with `fixtures` added, and the settings screen open on the Orca tab.
  async function openOrcaTab(fixtures: Record<string, unknown> = {}) {
    await boot({ inbox: inbox(), slack_load: slackLoad, slack_check: checked([]), claude_status: claudeMissing, ...fixtures });
    await $("#nav-settings").click();
    await openTab("orca");
    await expect($("#settings-panel-orca")).toBeDisplayed();
  }

  const names = (id: string) => textsOf(`#${id} option`);
  // The background, the text color and the number of colors of the swatch in the row of `slot`.
  const swatch = (slot: "light" | "dark") =>
    browser.execute(
      (s) => {
        const box = document.getElementById(`terminal-theme-${s}`)!.parentElement!.querySelector<HTMLElement>(".theme-swatch")!;
        return { theme: box.dataset.theme, background: getComputedStyle(box).backgroundColor, color: getComputedStyle(box).color, dots: box.querySelectorAll(".theme-dots i").length, red: getComputedStyle(box.querySelectorAll<HTMLElement>(".theme-dots i")[1]!).backgroundColor };
      },
      slot,
    );

  it("puts the card of the colors above the card of Ghostty, with a row for the light and one for the dark appearance", async () => {
    await openOrcaTab({ terminal_themes: terminalThemes() });
    expect(await textsOf("#settings-panel-orca > .card h2")).toEqual(["ターミナルの配色", "エディタ", "Ghostty の設定", "サーバーを置いた PC", "このマシンの Orca"]);
    expect(await textsOf("#terminal-theme-items .item-name")).toEqual(["外観", "ライト", "ダーク"]);
    expect(await textsOf("#terminal-theme-items .item-meta")).toEqual(["ターミナルが使うテーマ", "ライトの外観で使うテーマ", "ダークの外観で使うテーマ"]);
  });

  it("offers every theme in each row and shows the chosen one with its swatch", async () => {
    await openOrcaTab({ terminal_themes: terminalThemes({ light: "One Light", dark: "Dracula" }) });
    const all = ["Ghostty Default Style Dark", "Builtin Tango Light", "Dracula", "One Light"];
    expect(await names("terminal-theme-light")).toEqual(all);
    expect(await names("terminal-theme-dark")).toEqual(all);
    await expect($("#terminal-theme-light")).toHaveValue("One Light");
    await expect($("#terminal-theme-dark")).toHaveValue("Dracula");
    expect(await swatch("light")).toEqual({ theme: "One Light", background: "rgb(253, 246, 227)", color: "rgb(101, 123, 131)", dots: 16, red: "rgb(220, 50, 47)" });
    expect(await swatch("dark")).toEqual({ theme: "Dracula", background: "rgb(40, 42, 54)", color: "rgb(248, 248, 242)", dots: 16, red: "rgb(255, 85, 85)" });
  });

  it("saves the theme chosen for one appearance with the other as it is, and draws its swatch", async () => {
    await openOrcaTab({ terminal_themes: terminalThemes({ light: "One Light", dark: "Dracula" }) });
    const set = await mock("terminal_theme_set", { light: "One Light", dark: "Ghostty Default Style Dark", appearance: "system" });
    await chooseTheme("dark", "Ghostty Default Style Dark");
    expect(await waitForCalls(set)).toEqual([{ selection: { light: "One Light", dark: "Ghostty Default Style Dark", appearance: "system" } }]);
    await browser.waitUntil(async () => (await swatch("dark")).theme === "Ghostty Default Style Dark", { timeoutMsg: "the swatch never changed" });
    expect((await swatch("dark")).background).toBe("rgb(16, 32, 58)");
    expect((await swatch("light")).theme).toBe("One Light");
    await expect($("#terminal-theme-dark")).toHaveValue("Ghostty Default Style Dark");
    await expect($("#terminal-theme-dark")).toBeEnabled();
    await expect($(CARDS)).not.toExist();
  });

  it("offers system, light and dark for the appearance, with the system's as the default", async () => {
    await openOrcaTab({ terminal_themes: terminalThemes() });
    expect(await names("terminal-theme-appearance")).toEqual(["システムに合わせる", "ライト", "ダーク"]);
    await expect($("#terminal-theme-appearance")).toHaveValue("system");
    await expect($("#terminal-theme-appearance")).toHaveAttribute("aria-label", "ターミナルの外観");
  });

  it("shows the saved appearance", async () => {
    await openOrcaTab({ terminal_themes: terminalThemes({ appearance: "dark" }) });
    await expect($("#terminal-theme-appearance")).toHaveValue("dark");
  });

  it("saves the appearance chosen with both themes as they are", async () => {
    await openOrcaTab({ terminal_themes: terminalThemes({ light: "One Light", dark: "Dracula" }) });
    const set = await mock("terminal_theme_set", { light: "One Light", dark: "Dracula", appearance: "light" });
    await chooseAppearance("light");
    expect(await waitForCalls(set)).toEqual([{ selection: { light: "One Light", dark: "Dracula", appearance: "light" } }]);
    await expect($("#terminal-theme-appearance")).toHaveValue("light");
    await expect($("#terminal-theme-appearance")).toBeEnabled();
    await expect($(CARDS)).not.toExist();
  });

  it("keeps the appearance when a theme is chosen", async () => {
    await openOrcaTab({ terminal_themes: terminalThemes({ appearance: "dark" }) });
    const set = await mock("terminal_theme_set", { light: "Dracula", dark: "Ghostty Default Style Dark", appearance: "dark" });
    await chooseTheme("light", "Dracula");
    expect(await waitForCalls(set)).toEqual([{ selection: { light: "Dracula", dark: "Ghostty Default Style Dark", appearance: "dark" } }]);
  });

  it("shows the message of a failed save of the appearance and puts the saved one back", async () => {
    await openOrcaTab({ terminal_themes: terminalThemes() });
    await mock("terminal_theme_set", rejects("保存できません"));
    await chooseAppearance("dark");
    await expect($(CARD)).toHaveText("保存できません");
    await expect($("#terminal-theme-appearance")).toHaveValue("system");
    await expect($("#terminal-theme-appearance")).toBeEnabled();
  });

  it("shows the message of a failed save and puts the chosen theme back", async () => {
    await openOrcaTab({ terminal_themes: terminalThemes({ light: "One Light", dark: "Dracula" }) });
    await mock("terminal_theme_set", rejects("テーマ Nope は選べません"));
    await chooseTheme("light", "Dracula");
    await expect($(CARD)).toHaveText("テーマ Nope は選べません");
    await expect($("#terminal-theme-light")).toHaveValue("One Light");
    await expect($("#terminal-theme-light")).toBeEnabled();
    expect((await swatch("light")).theme).toBe("One Light");
  });

  it("asks for the themes at startup and by itself saves nothing", async () => {
    await openOrcaTab({ terminal_themes: terminalThemes() });
    expect(await callsOf("terminal_themes")).toEqual([null]);
    expect(await callsOf("terminal_theme_set")).toEqual([]);
  });

  it("writes the message of a failed read to the log, and draws no rows", async () => {
    await openOrcaTab({ terminal_themes: rejects("テーマを読めません") });
    await waitForLog("テーマを読めません");
    expect(await count("#terminal-theme-items .item")).toBe(0);
  });
});

// A-18: the editor card, between the card of the colors and the card of Ghostty. Rust brings the value into 100 to 3000 ms in steps of 100 (unit tests); here the field shows what Rust answers, and sends what was typed.
describe("settings: editor (the Orca tab, A-18)", () => {
  async function openOrcaTab(fixtures: Record<string, unknown> = {}) {
    await boot({ inbox: inbox(), slack_load: slackLoad, slack_check: checked([]), claude_status: claudeMissing, ...fixtures });
    await $("#nav-settings").click();
    await openTab("orca");
    await expect($("#settings-panel-orca")).toBeDisplayed();
  }

  // Types `text` into the field and commits it, as the user does (value, then change).
  const typeMs = (text: string) =>
    browser.execute(
      (id, t) => {
        if (!window.__e2e_once__(id)) return;
        const input = document.getElementById("editor-autosave") as HTMLInputElement;
        input.value = t;
        input.dispatchEvent(new Event("change", { bubbles: true }));
      },
      onceId(),
      text,
    );

  it("has a card above Ghostty's with the time before the automatic save, 1000 ms to start with", async () => {
    await openOrcaTab();
    expect(await textsOf("#editor-items .item-name")).toEqual(["自動保存までの時間"]);
    await expect($("#editor-autosave")).toHaveValue("1000");
    await expect($("#editor-autosave")).toHaveAttribute("min", "100");
    await expect($("#editor-autosave")).toHaveAttribute("max", "3000");
    await expect($("#editor-autosave")).toHaveAttribute("step", "100");
    expect(await textsOf("#editor-items .item-meta")).toEqual(["ms"]);
    expect(await callsOf("editor_settings")).toEqual([null]);
    expect(await callsOf("editor_settings_set")).toEqual([]);
  });

  it("shows the time that was saved", async () => {
    await openOrcaTab({ editor_settings: { autosaveMs: 2500, autosaveMin: 100, autosaveMax: 3000, autosaveStep: 100 } });
    await expect($("#editor-autosave")).toHaveValue("2500");
  });

  it("sends the number typed and shows the value Rust answers", async () => {
    await openOrcaTab();
    const set = await mock("editor_settings_set", { autosaveMs: 100, autosaveMin: 100, autosaveMax: 3000, autosaveStep: 100 });
    await typeMs("50");
    expect(await waitForCalls(set)).toEqual([{ autosaveMs: 50 }]);
    await expect($("#editor-autosave")).toHaveValue("100");
    await expect($("#editor-autosave")).toBeEnabled();
    await expect($(CARDS)).not.toExist();
  });

  it("sends nothing for what is not a number, and shows the time held", async () => {
    await openOrcaTab();
    const set = await mock("editor_settings_set", { autosaveMs: 100, autosaveMin: 100, autosaveMax: 3000, autosaveStep: 100 });
    await typeMs("");
    await expect($("#editor-autosave")).toHaveValue("1000");
    expect(await callsOf(set)).toEqual([]);
  });

  it("shows the message of a failed save and puts the time held back", async () => {
    await openOrcaTab();
    await mock("editor_settings_set", rejects("editor-settings.json を書けません"));
    await typeMs("300");
    await expect($(CARD)).toHaveText("editor-settings.json を書けません");
    await expect($("#editor-autosave")).toHaveValue("1000");
    await expect($("#editor-autosave")).toBeEnabled();
  });

  it("opens a hint with the range from the ? of the card", async () => {
    await openOrcaTab();
    await $("#editor-help").click();
    await expect($('.pop[aria-label="エディタ"]')).toBeDisplayed();
    await expect($("#editor-help")).toHaveAttribute("aria-expanded", "true");
  });

  it("writes the message of a failed read to the log, and leaves the field empty", async () => {
    await openOrcaTab({ editor_settings: rejects("editor-settings.json を読めません") });
    await waitForLog("editor-settings.json を読めません");
    await expect($("#editor-autosave")).toHaveValue("");
    await expect($("#editor-autosave")).toBeDisabled();
  });
});

// A-20: the Font tab. Rust brings every value into its range and checks the family against the Mac's (unit tests); here the selects show what Rust answers, send what was chosen, and the screens take the choice at once.
describe("settings: fonts (the Font tab, A-20)", () => {
  async function openFontTab(fixtures: Record<string, unknown> = {}) {
    await boot({ inbox: inbox(), slack_load: slackLoad, slack_check: checked([]), claude_status: claudeMissing, ...fixtures });
    await $("#nav-settings").click();
    await openTab("font");
    await expect($("#settings-panel-font")).toBeDisplayed();
  }

  // The computed font of the root of a screen: the size and the first family.
  const fontOf = (selector: string) =>
    browser.execute((s) => {
      const style = getComputedStyle(document.querySelector(s)!);
      return { size: style.fontSize, family: style.fontFamily };
    }, selector);
  const rootVar = (name: string) => browser.execute((n) => document.documentElement.style.getPropertyValue(n), name);
  // The family (quotes left out) of the element `selector` finds in `html`, made for the check: a screen that draws it is not open.
  const familyOfNew = (html: string, selector: string) =>
    browser.execute(
      (h, sel) => {
        const holder = document.createElement("div");
        holder.innerHTML = h;
        document.body.append(holder);
        const family = getComputedStyle(holder.querySelector(sel)!).fontFamily;
        holder.remove();
        return family.replace(/"/g, "");
      },
      html,
      selector,
    );
  // The body of a text mail (`.plain`: the mail screen's family, else Gmail's, M-2), and the code in a popup.
  const plainFamily = () => familyOfNew('<div class="plain">text</div>', ".plain");
  const codeFamily = () => familyOfNew('<div class="pop"><code>x</code></div>', "code");
  const options = (id: string) => browser.execute((i) => [...(document.getElementById(i) as HTMLSelectElement).options].map((o) => o.textContent), id);
  const selectedText = (id: string) => browser.execute((i) => (document.getElementById(i) as HTMLSelectElement).selectedOptions[0]!.textContent, id);

  it("has a card with a row for each place, in the order of the screens", async () => {
    await openFontTab();
    expect(await textsOf("#font-items .item-name")).toEqual(["アプリ全体", "メール", "カレンダー", "Todo", "Todo", "Slack", "Orca", "Orca", "Orca", "Orca", "等幅の文字"]);
    expect(await textsOf("#font-items .item-meta")).toEqual([
      "設定、メニュー、ポップアップ",
      "画面全体",
      "画面全体",
      "プロジェクト一覧",
      "作業スペース",
      "画面全体",
      "プロジェクト一覧",
      "作業スペース（チャットとファイル）",
      "作業スペース（ターミナル）",
      "エディタ",
      "書体のみ",
    ]);
    // A family and a size for every row, but the monospace text: it has a family only.
    expect(await count("#font-items select")).toBe(21);
    expect(await count("#font-mono-size")).toBe(0);
    expect(await count("#font-mono-family")).toBe(1);
    expect(await callsOf("font_settings")).toEqual([null]);
    expect(await callsOf("font_families")).toEqual([null]);
    expect(await callsOf("font_settings_set")).toEqual([]);
  });

  it("offers the families of this Mac after the system's, and Ghostty's only for the work space of Orca", async () => {
    await openFontTab();
    expect(await options("font-mail-family")).toEqual(["システム標準", "Hiragino Sans", "Menlo", "Times New Roman"]);
    expect(await options("font-orca-work-family")).toEqual(["システム標準", "Ghostty の設定に従う", "Hiragino Sans", "Menlo", "Times New Roman"]);
    expect(await options("font-editor-family")).toEqual(["システム標準", "Hiragino Sans", "Menlo", "Times New Roman"]);
    for (const id of ["font-app-family", "font-orca-pane-family", "font-mono-family"]) expect(await options(id)).toEqual(["システム標準", "Hiragino Sans", "Menlo", "Times New Roman"]);
  });

  it("offers the sizes 8 to 32 px, and the half size the editor has", async () => {
    await openFontTab();
    const sizes = await options("font-mail-size");
    expect(sizes.length).toBe(25);
    expect([sizes[0], sizes[6], sizes[24]]).toEqual(["8 px", "14 px", "32 px"]);
    expect(await options("font-editor-size")).toContain("12.5 px");
    expect(await selectedText("font-editor-size")).toBe("12.5 px");
    expect(await selectedText("font-mail-size")).toBe("14 px");
  });

  it("shows the saved choice: the families, the sizes, and the terminals following Ghostty with no size to choose", async () => {
    await openFontTab({ font_settings: fontSettings({ mail: { family: "Menlo", size: 16, ghostty: false } }) });
    expect(await selectedText("font-mail-family")).toBe("Menlo");
    expect(await selectedText("font-mail-size")).toBe("16 px");
    expect(await selectedText("font-orca-work-family")).toBe("Ghostty の設定に従う");
    await expect($("#font-orca-work-size")).toBeDisabled();
    await expect($("#font-mail-size")).toBeEnabled();
  });

  it("keeps a saved family this Mac lacks in the select, and says so", async () => {
    await openFontTab({ font_settings: fontSettings({ slack: { family: "Gone Sans", size: 14, ghostty: false } }) });
    expect(await selectedText("font-slack-family")).toBe("Gone Sans（この Mac にありません）");
  });

  it("applies the saved choice at the start, before the settings are opened", async () => {
    await boot({ inbox: inbox(), slack_load: slackLoad, slack_check: checked([]), claude_status: claudeMissing, font_settings: fontSettings({ calendar: { family: "Menlo", size: 21, ghostty: false } }) });
    await browser.waitUntil(async () => (await fontOf("#calendar")).size === "21px", { timeoutMsg: "the calendar never took the size" });
    expect((await fontOf("#calendar")).family).toContain("Menlo");
    expect(await rootVar("--ff-calendar")).toBe('"Menlo", var(--ff-base)');
    expect(await rootVar("--fs-calendar")).toBe("1.5");
  });

  it("draws a plain button of the screen with the family and size chosen too", async () => {
    await boot({ inbox: inbox(), slack_load: slackLoad, slack_check: checked([]), claude_status: claudeMissing, font_settings: fontSettings({ calendar: { family: "Menlo", size: 21, ghostty: false } }) });
    // 11px of its own, times 21 / 14.
    await browser.waitUntil(async () => (await fontOf("#cal-today")).size === "16.5px", { timeoutMsg: "the button never took the size" });
    expect((await fontOf("#cal-today")).family).toContain("Menlo");
  });

  it("saves the size of a place whose family this Mac has lost, with the family it holds", async () => {
    await openFontTab({ font_settings: fontSettings({ slack: { family: "Gone Sans", size: 14, ghostty: false } }) });
    const set = await mock("font_settings_set", fontSettings({ slack: { family: "Gone Sans", size: 18, ghostty: false } }));
    await chooseOption("font-slack-size", "18");
    expect(await waitForCalls(set)).toEqual([{ area: "slack", family: "Gone Sans", size: 18, ghostty: false }]);
    expect(await selectedText("font-slack-family")).toBe("Gone Sans（この Mac にありません）");
  });

  it("sends the family chosen and draws the screen with it at once", async () => {
    await openFontTab();
    const set = await mock("font_settings_set", fontSettings({ mail: { family: "Hiragino Sans", size: 14, ghostty: false } }));
    await chooseOption("font-mail-family", "family:Hiragino Sans");
    expect(await waitForCalls(set)).toEqual([{ area: "mail", family: "Hiragino Sans", size: 14, ghostty: false }]);
    await browser.waitUntil(async () => (await fontOf("#mail-area")).family.includes("Hiragino Sans"), { timeoutMsg: "the mail never took the family" });
    expect((await fontOf("#inbox-header")).family).toContain("Hiragino Sans");
    // The body of a text mail takes the family chosen for the mail screen in place of Gmail's.
    expect(await plainFamily()).toContain("Hiragino Sans");
    expect(await plainFamily()).not.toContain("Arial");
    // The other screens keep the system's.
    expect((await fontOf("#calendar")).family).not.toContain("Hiragino Sans");
    expect(await selectedText("font-mail-family")).toBe("Hiragino Sans");
    await expect($(CARDS)).not.toExist();
    await expect($("#font-mail-family")).toBeEnabled();
  });

  it("sends the size chosen and draws the screen with it at once, text that sets its own size in the same ratio", async () => {
    await openFontTab();
    const set = await mock("font_settings_set", fontSettings({ calendar: { family: null, size: 21, ghostty: false } }));
    const before = await browser.execute(() => parseFloat(getComputedStyle(document.getElementById("cal-title")!).fontSize));
    await chooseOption("font-calendar-size", "21");
    expect(await waitForCalls(set)).toEqual([{ area: "calendar", family: null, size: 21, ghostty: false }]);
    await browser.waitUntil(async () => (await fontOf("#calendar")).size === "21px", { timeoutMsg: "the calendar never took the size" });
    // #cal-title is 20px of its own: 20 * 21 / 14.
    expect(before).toBe(20);
    expect(await browser.execute(() => getComputedStyle(document.getElementById("cal-title")!).fontSize)).toBe("30px");
    expect((await fontOf("#mail-area")).size).toBe("14px");
  });

  it("chooses the list and the work space of Todo apart", async () => {
    await openFontTab();
    const set = await mock("font_settings_set", fontSettings({ todoList: { family: "Menlo", size: 18, ghostty: false } }));
    await chooseOption("font-todo-list-size", "18");
    expect(await waitForCalls(set)).toEqual([{ area: "todoList", family: null, size: 18, ghostty: false }]);
    await browser.waitUntil(async () => (await fontOf("#projects")).size === "18px", { timeoutMsg: "the list never took the size" });
    expect((await fontOf("#todo-body")).size).toBe("14px");
    expect(await rootVar("--fs-todo-work")).toBe("");
  });

  it("gives the screens of Todo, Slack and Orca their own variables", async () => {
    await openFontTab();
    const answers = [
      ["todoWork", { family: "Menlo", size: 16, ghostty: false }, "#todo-body", "font-todo-work-size", "16"],
      ["slack", { family: "Menlo", size: 15, ghostty: false }, "#slack-list", "font-slack-size", "15"],
      ["orcaList", { family: "Menlo", size: 17, ghostty: false }, "#orca-list", "font-orca-list-size", "17"],
    ] as const;
    for (const [area, pick, selector, id, size] of answers) {
      const set = await mock("font_settings_set", fontSettings({ [area]: pick }));
      await chooseOption(id, size);
      await waitForCalls(set);
      await browser.waitUntil(async () => (await fontOf(selector)).size === `${size}px`, { timeoutMsg: `${selector} never took the size` });
    }
  });

  it("goes back to the system's font and size", async () => {
    await openFontTab({ font_settings: fontSettings({ mail: { family: "Menlo", size: 20, ghostty: false } }) });
    await browser.waitUntil(async () => (await fontOf("#mail-area")).size === "20px");
    const set = await mock("font_settings_set", fontSettings());
    await chooseOption("font-mail-family", "own");
    expect(await waitForCalls(set)).toEqual([{ area: "mail", family: null, size: 20, ghostty: false }]);
    await browser.waitUntil(async () => (await fontOf("#mail-area")).family.includes("Menlo") === false);
    expect(await rootVar("--ff-mail")).toBe("");
    expect(await rootVar("--fs-mail")).toBe("");
    expect((await fontOf("#mail-area")).size).toBe("14px");
    expect(await plainFamily()).toBe("Arial, Helvetica, sans-serif");
  });

  it("stops following Ghostty when a family is chosen for the terminals, and follows again when Ghostty is chosen", async () => {
    await openFontTab();
    const set = await mock("font_settings_set", fontSettings({ orcaWork: { family: "Menlo", size: 13, ghostty: false } }));
    await chooseOption("font-orca-work-family", "family:Menlo");
    expect(await waitForCalls(set)).toEqual([{ area: "orcaWork", family: "Menlo", size: 13, ghostty: false }]);
    await expect($("#font-orca-work-size")).toBeEnabled();
    const again = await mock("font_settings_set", fontSettings({ orcaWork: { family: "Menlo", size: 13, ghostty: true } }));
    await chooseOption("font-orca-work-family", "ghostty");
    expect(await waitForCalls(again)).toEqual([{ area: "orcaWork", family: "Menlo", size: 13, ghostty: true }]);
    await expect($("#font-orca-work-size")).toBeDisabled();
    expect(await selectedText("font-orca-work-family")).toBe("Ghostty の設定に従う");
  });

  it("gives the editor its variables, apart from the terminals", async () => {
    await openFontTab();
    const set = await mock("font_settings_set", fontSettings({ editor: { family: "Menlo", size: 16, ghostty: false } }));
    await chooseOption("font-editor-size", "16");
    expect(await waitForCalls(set)).toEqual([{ area: "editor", family: null, size: 16, ghostty: false }]);
    await browser.waitUntil(async () => (await rootVar("--editor-size")) === "16px");
    expect(await rootVar("--editor-family")).toBe('"Menlo", ui-monospace, Menlo, monospace');
  });

  it("puts no variable on the root while the app, the pane of Orca and the monospace text have their first values", async () => {
    await openFontTab();
    for (const name of ["--ff-app", "--fs-app", "--ff-orca-pane", "--fs-orca-pane", "--ff-mono"]) expect(await rootVar(name)).toBe("");
    expect((await fontOf("body")).size).toBe("14px");
    expect((await fontOf("#orca-work")).size).toBe("14px");
    expect((await fontOf("#orca-files")).size).toBe("14px");
    // The first family of the app, and the monospace stack as it was.
    expect((await fontOf("body")).family.replace(/"/g, "")).toBe("-apple-system, sans-serif");
    expect(await plainFamily()).toBe("Arial, Helvetica, sans-serif");
    expect(await selectedText("font-app-family")).toBe("システム標準");
    expect(await selectedText("font-app-size")).toBe("14 px");
    expect(await selectedText("font-orca-pane-size")).toBe("14 px");
  });

  it("sends the family chosen for the whole app, and draws the places at the system's family with it too", async () => {
    await openFontTab({ font_settings: fontSettings({ mail: { family: "Hiragino Sans", size: 16, ghostty: false } }) });
    const set = await mock("font_settings_set", fontSettings({ app: { family: "Menlo", size: 14, ghostty: false }, mail: { family: "Hiragino Sans", size: 16, ghostty: false } }));
    await chooseOption("font-app-family", "family:Menlo");
    expect(await waitForCalls(set)).toEqual([{ area: "app", family: "Menlo", size: 14, ghostty: false }]);
    await browser.waitUntil(async () => (await fontOf("body")).family.includes("Menlo"), { timeoutMsg: "the app never took the family" });
    expect(await rootVar("--ff-app")).toBe('"Menlo", -apple-system, sans-serif');
    // A place at the system's family follows it; a place with a family of its own keeps it.
    expect((await fontOf("#calendar")).family).toContain("Menlo");
    expect((await fontOf("#orca-list")).family).toContain("Menlo");
    expect((await fontOf("#orca-work")).family).toContain("Menlo");
    expect((await fontOf("#mail-area")).family).toContain("Hiragino Sans");
    expect(await selectedText("font-app-family")).toBe("Menlo");
  });

  it("sends the size chosen for the whole app, and draws only the parts outside the places with it", async () => {
    await openFontTab({ font_settings: fontSettings({ slack: { family: null, size: 16, ghostty: false } }) });
    const set = await mock("font_settings_set", fontSettings({ app: { family: null, size: 21, ghostty: false }, slack: { family: null, size: 16, ghostty: false } }));
    await chooseOption("font-app-size", "21");
    expect(await waitForCalls(set)).toEqual([{ area: "app", family: null, size: 21, ghostty: false }]);
    await browser.waitUntil(async () => (await fontOf("body")).size === "21px", { timeoutMsg: "the app never took the size" });
    expect(await rootVar("--fs-app")).toBe("1.5");
    // The hint of a row (12px of its own) is outside the places: 12 * 21 / 14.
    expect(await browser.execute(() => getComputedStyle(document.querySelector("#font-items .item-meta")!).fontSize)).toBe("18px");
    // The places keep their own sizes: the first 14 px, and the one chosen.
    for (const selector of ["#mail-area", "#calendar", "#projects", "#todo-body", "#orca-list", "#orca-work", "#orca-files"]) expect((await fontOf(selector)).size).toBe("14px");
    expect((await fontOf("#slack-list")).size).toBe("16px");
  });

  it("keeps the settings inside the window at the largest size of the whole app", async () => {
    await openFontTab({ font_settings: fontSettings({ app: { family: null, size: 32, ghostty: false } }) });
    await browser.waitUntil(async () => (await fontOf("body")).size === "32px", { timeoutMsg: "the app never took the size" });
    const overflow = await browser.execute(() => {
      const settings = document.getElementById("settings")!;
      return settings.scrollWidth - settings.clientWidth;
    });
    expect(overflow).toBeLessThanOrEqual(0);
    await expect($("#font-app-size")).toBeDisplayed();
    await expect($("#font-mono-family")).toBeDisplayed();
  });

  it("sends the family and size chosen for the chat and the files of the work pane of Orca, and draws them at once", async () => {
    await openFontTab();
    const set = await mock("font_settings_set", fontSettings({ orcaPane: { family: "Menlo", size: 21, ghostty: false } }));
    await chooseOption("font-orca-pane-family", "family:Menlo");
    expect(await waitForCalls(set)).toEqual([{ area: "orcaPane", family: "Menlo", size: 14, ghostty: false }]);
    await browser.waitUntil(async () => (await fontOf("#orca-work")).size === "21px", { timeoutMsg: "the pane never took the size" });
    expect(await rootVar("--ff-orca-pane")).toBe('"Menlo", var(--ff-base)');
    expect(await rootVar("--fs-orca-pane")).toBe("1.5");
    for (const selector of ["#orca-work", "#orca-files"]) {
      expect((await fontOf(selector)).family).toContain("Menlo");
      expect((await fontOf(selector)).size).toBe("21px");
    }
    // The list of projects keeps its own.
    expect((await fontOf("#orca-list")).size).toBe("14px");
    expect((await fontOf("#orca-list")).family).not.toContain("Menlo");
    // The file pane's heading is 12px of its own: 12 * 21 / 14.
    expect(await browser.execute(() => getComputedStyle(document.getElementById("orca-files-title")!).fontSize)).toBe("18px");
  });

  it("sends the family of the monospace text with no size that counts, and puts it in front of the stacks", async () => {
    await openFontTab();
    const set = await mock("font_settings_set", fontSettings({ mono: { family: "Menlo", size: 14, ghostty: false } }));
    await chooseOption("font-mono-family", "family:Menlo");
    expect(await waitForCalls(set)).toEqual([{ area: "mono", family: "Menlo", size: 14, ghostty: false }]);
    await browser.waitUntil(async () => (await rootVar("--ff-mono")) !== "", { timeoutMsg: "the monospace never took the family" });
    expect(await rootVar("--ff-mono")).toBe('"Menlo",');
    // The text of a mail is not a monospace stack: it keeps Gmail's family.
    expect(await plainFamily()).toBe("Arial, Helvetica, sans-serif");
    expect(await codeFamily()).toBe("Menlo, ui-monospace, monospace");
    // Nothing else takes it, and no size is set for it.
    expect(await rootVar("--fs-mono")).toBe("");
    expect((await fontOf("body")).family).not.toContain("Menlo");
    expect(await count("#font-mono-size")).toBe(0);
    await expect($("#font-mono-family")).toBeEnabled();
    expect(await selectedText("font-mono-family")).toBe("Menlo");
  });

  it("goes back to the monospace stacks as they were when the system's is chosen", async () => {
    await openFontTab({ font_settings: fontSettings({ mono: { family: "Menlo", size: 14, ghostty: false } }) });
    await browser.waitUntil(async () => (await rootVar("--ff-mono")) === '"Menlo",');
    const set = await mock("font_settings_set", fontSettings());
    await chooseOption("font-mono-family", "own");
    expect(await waitForCalls(set)).toEqual([{ area: "mono", family: null, size: 14, ghostty: false }]);
    await browser.waitUntil(async () => (await rootVar("--ff-mono")) === "", { timeoutMsg: "the monospace never went back" });
    expect(await plainFamily()).toBe("Arial, Helvetica, sans-serif");
    expect(await codeFamily()).toBe("ui-monospace, monospace");
  });

  it("applies the saved choice of the new places at the start", async () => {
    await boot({
      inbox: inbox(),
      slack_load: slackLoad,
      slack_check: checked([]),
      claude_status: claudeMissing,
      font_settings: fontSettings({ app: { family: "Menlo", size: 18, ghostty: false }, orcaPane: { family: null, size: 16, ghostty: false }, mono: { family: "Hiragino Sans", size: 14, ghostty: false } }),
    });
    await browser.waitUntil(async () => (await fontOf("body")).size === "18px", { timeoutMsg: "the app never took the size" });
    expect((await fontOf("body")).family).toContain("Menlo");
    expect((await fontOf("#orca-work")).size).toBe("16px");
    expect(await rootVar("--ff-mono")).toBe('"Hiragino Sans",');
    expect(await rootVar("--ff-orca-pane")).toBe("");
  });

  it("shows the message of a failed save and puts the choice held back", async () => {
    await openFontTab();
    await mock("font_settings_set", rejects("font-settings.json を書けません"));
    await chooseOption("font-slack-size", "20");
    await expect($(CARD)).toHaveText("font-settings.json を書けません");
    expect(await selectedText("font-slack-size")).toBe("14 px");
    await expect($("#font-slack-size")).toBeEnabled();
    expect((await fontOf("#slack-list")).size).toBe("14px");
  });

  it("writes the message of a failed read to the log, and draws no row", async () => {
    await openFontTab({ font_settings: rejects("font-settings.json を読めません") });
    await waitForLog("font-settings.json を読めません");
    expect(await count("#font-items .item")).toBe(0);
  });

  it("writes the message of a failed list of families to the log, with the system's alone to choose", async () => {
    await openFontTab({ font_families: rejects("書体の一覧を読めません") });
    await waitForLog("書体の一覧を読めません");
    expect(await options("font-mail-family")).toEqual(["システム標準"]);
  });

  it("opens a hint from the ? of the card", async () => {
    await openFontTab();
    await $("#font-help").click();
    await expect($('.pop[aria-label="フォント"]')).toBeDisplayed();
    await expect($("#font-help")).toHaveAttribute("aria-expanded", "true");
  });
});

describe("settings: menu (the メニュー tab, A-50)", () => {
  type Entry = [string, boolean];
  const list = (...entries: Entry[]) => ({ items: entries.map(([screen, enabled]) => ({ screen, enabled })) });
  const FIRST: Entry[] = [["mail", true], ["calendar", true], ["todo", true], ["slack", true], ["orca", true], ["database", true]];
  // Slack, the inbox, the database and Todo are on, the calendar and 開発 are off.
  const SAVED: Entry[] = [["slack", true], ["mail", true], ["database", true], ["calendar", false], ["todo", true], ["orca", false]];

  async function openMenuTab(fixtures: Record<string, unknown> = {}) {
    await boot({ inbox: inbox(), slack_load: slackLoad, slack_check: checked([]), claude_status: claudeMissing, ...fixtures });
    await $("#nav-settings").click();
    await openTab("menu");
    await expect($("#settings-panel-menu")).toBeDisplayed();
  }

  // What each row shows, top to bottom: the screen, the name, the key, the switch (null when there is none), and whether the row is dimmed.
  const rows = () =>
    browser.execute(() =>
      [...document.querySelectorAll<HTMLElement>("#menu-items .menu-row")].map((r) => ({
        screen: r.dataset.screen,
        name: r.querySelector(".item-name")!.textContent,
        key: r.querySelector(".menu-key")!.textContent,
        on: r.querySelector(".switch")?.getAttribute("aria-checked") ?? null,
        dimmed: r.classList.contains("menu-row-off"),
      })),
    );
  const order = async () => (await rows()).map((r) => r.screen);
  // The sidebar's shown buttons above the bottom group, top to bottom, with the key each carries.
  const sidebar = () =>
    browser.execute(() =>
      [...document.querySelectorAll<HTMLElement>("#sidebar > .nav-item")].filter((e) => e.offsetParent !== null).map((e) => [e.id, e.dataset.shortcut]),
    );
  // The pointer on the grip of the row `from`, as the page gets it (WebDriver's click sends no pointerdown): it presses, moves to the top (before) or the bottom (after) of the row `to`, and is released when `release`.
  const drag = (from: string, to: string, place: "before" | "after", release = true) =>
    browser.execute(
      (a, b, p, up, once) => {
        if (!window.__e2e_once__(once)) return;
        const rowOf = (s: string) => document.querySelector<HTMLElement>(`#menu-items [data-screen="${s}"]`)!;
        const grip = rowOf(a).querySelector<HTMLElement>(".menu-grip")!;
        const g = grip.getBoundingClientRect();
        const x = g.left + g.width / 2;
        const init = (y: number, buttons: number) => ({ bubbles: true, cancelable: true, clientX: x, clientY: y, button: 0, buttons, pointerId: 6, isPrimary: true });
        grip.dispatchEvent(new PointerEvent("pointerdown", init(g.top + g.height / 2, 1)));
        const t = rowOf(b).getBoundingClientRect();
        const y = p === "before" ? t.top + 2 : t.bottom - 2;
        document.dispatchEvent(new PointerEvent("pointermove", init(y, 1)));
        if (up) document.dispatchEvent(new PointerEvent("pointerup", init(y, 0)));
      },
      from,
      to,
      place,
      release,
      onceId(),
    );
  const sw = (screen: string) => $(`#menu-items [data-screen="${screen}"] .switch`);

  it("draws a row for each screen in the saved order, with its key, and the switch of each but the inbox", async () => {
    await openMenuTab({ side_menu_settings: list(...SAVED) });
    await waitForCount("#menu-items .menu-row", 6);
    expect(await rows()).toEqual([
      { screen: "slack", name: "Slack", key: "⌘1", on: "true", dimmed: false },
      { screen: "mail", name: "受信トレイ", key: "⌘2", on: null, dimmed: false },
      { screen: "database", name: "データベース", key: "⌘3", on: "true", dimmed: false },
      { screen: "calendar", name: "カレンダー", key: "—", on: "false", dimmed: true },
      { screen: "todo", name: "Todo", key: "⌘4", on: "true", dimmed: false },
      { screen: "orca", name: "開発", key: "—", on: "false", dimmed: true },
    ]);
    // The inbox has no switch, and says it is always shown.
    await expect($('#menu-items [data-screen="mail"] .menu-always')).toHaveText("常に表示");
    expect(await count("#menu-items .switch")).toBe(5);
    expect(await count("#menu-items .menu-icon svg")).toBe(6);
    expect(await callsOf("side_menu_settings_set")).toEqual([]);
  });

  it("saves the whole list in the new order when a row is dragged, and the sidebar and the keys follow", async () => {
    await openMenuTab();
    await waitForCount("#menu-items .menu-row", 6);
    const saved = list(["slack", true], ["mail", true], ["calendar", true], ["todo", true], ["orca", true], ["database", true]);
    const set = await mock("side_menu_settings_set", saved);
    await drag("slack", "mail", "before");
    expect(await waitForCalls(set)).toEqual([{ items: saved.items }]);
    await browser.waitUntil(async () => (await order()).join() === "slack,mail,calendar,todo,orca,database");
    expect((await rows()).map((r) => r.key)).toEqual(["⌘1", "⌘2", "⌘3", "⌘4", "⌘5", "⌘6"]);
    expect(await sidebar()).toEqual([["nav-slack", "⌘1"], ["nav-mail", "⌘2"], ["nav-calendar", "⌘3"], ["nav-todo", "⌘4"], ["nav-orca", "⌘5"], ["nav-database", "⌘6"]]);
  });

  it("drags a row to the end of the list, and keeps each row's switch as it was", async () => {
    await openMenuTab({ side_menu_settings: list(...SAVED) });
    await waitForCount("#menu-items .menu-row", 6);
    const saved = list(["mail", true], ["database", true], ["calendar", false], ["todo", true], ["orca", false], ["slack", true]);
    const set = await mock("side_menu_settings_set", saved);
    await drag("slack", "orca", "after");
    expect(await waitForCalls(set)).toEqual([{ items: saved.items }]);
    await browser.waitUntil(async () => (await sidebar()).map(([id]) => id).join() === "nav-mail,nav-database,nav-todo,nav-slack");
    expect((await rows()).map((r) => r.key)).toEqual(["⌘1", "⌘2", "—", "⌘3", "—", "⌘4"]);
  });

  it("saves nothing for a drop where the row was, and for an Escape", async () => {
    await openMenuTab();
    await waitForCount("#menu-items .menu-row", 6);
    const set = await mock("side_menu_settings_set", list(...FIRST));
    // Released on its own row: the order is the same.
    await drag("todo", "todo", "before");
    // Moved, then Escape: the rows are as saved.
    await drag("todo", "mail", "before", false);
    await browser.waitUntil(async () => (await order())[0] === "todo");
    await browser.execute((once) => window.__e2e_once__(once) && document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true })), onceId());
    await browser.waitUntil(async () => (await order()).join() === "mail,calendar,todo,slack,orca,database");
    // The pointer released after that goes nowhere.
    await browser.execute((once) => window.__e2e_once__(once) && document.dispatchEvent(new PointerEvent("pointerup", { bubbles: true, pointerId: 6 })), onceId());
    expect(await callsOf(set)).toEqual([]);
    expect(await order()).toEqual(["mail", "calendar", "todo", "slack", "orca", "database"]);
  });

  it("saves the list with the screen off when its switch is pressed, and the sidebar drops it and renumbers the keys", async () => {
    await openMenuTab();
    await waitForCount("#menu-items .menu-row", 6);
    const saved = list(["mail", true], ["calendar", false], ["todo", true], ["slack", true], ["orca", true], ["database", true]);
    const set = await mock("side_menu_settings_set", saved);
    await sw("calendar").click();
    expect(await waitForCalls(set)).toEqual([{ items: saved.items }]);
    await browser.waitUntil(async () => (await rows())[1]!.dimmed);
    expect((await rows()).map((r) => [r.key, r.on])).toEqual([["⌘1", null], ["—", "false"], ["⌘2", "true"], ["⌘3", "true"], ["⌘4", "true"], ["⌘5", "true"]]);
    await expect($("#nav-calendar")).not.toBeDisplayed();
    expect(await sidebar()).toEqual([["nav-mail", "⌘1"], ["nav-todo", "⌘2"], ["nav-slack", "⌘3"], ["nav-orca", "⌘4"], ["nav-database", "⌘5"]]);
    await expect(sw("calendar")).toBeEnabled();
  });

  it("saves the list with the screen on when the switch of an off screen is pressed", async () => {
    await openMenuTab({ side_menu_settings: list(...SAVED) });
    await waitForCount("#menu-items .menu-row", 6);
    const saved = list(["slack", true], ["mail", true], ["database", true], ["calendar", true], ["todo", true], ["orca", false]);
    const set = await mock("side_menu_settings_set", saved);
    await sw("calendar").click();
    expect(await waitForCalls(set)).toEqual([{ items: saved.items }]);
    await browser.waitUntil(async () => (await rows())[3]!.key === "⌘4");
    await expect($("#nav-calendar")).toBeDisplayed();
    expect((await rows()).map((r) => r.key)).toEqual(["⌘1", "⌘2", "⌘3", "⌘4", "⌘5", "—"]);
    expect(await sidebar()).toEqual([["nav-slack", "⌘1"], ["nav-mail", "⌘2"], ["nav-database", "⌘3"], ["nav-calendar", "⌘4"], ["nav-todo", "⌘5"]]);
  });

  it("shows the message of a failed save of a switch, and puts the rows and the sidebar back as saved", async () => {
    await openMenuTab();
    await waitForCount("#menu-items .menu-row", 6);
    const set = await mock("side_menu_settings_set", rejects("side-menu.json を書けません"));
    await sw("todo").click();
    await waitForCalls(set);
    await expect($(CARD)).toHaveText("side-menu.json を書けません");
    await browser.waitUntil(async () => (await rows())[2]!.on === "true");
    expect((await rows()).map((r) => [r.dimmed, r.key])).toEqual([[false, "⌘1"], [false, "⌘2"], [false, "⌘3"], [false, "⌘4"], [false, "⌘5"], [false, "⌘6"]]);
    await expect($("#nav-todo")).toBeDisplayed();
    await expect(sw("todo")).toBeEnabled();
  });

  it("shows the message of a failed save of a drag, and puts the rows back in the saved order", async () => {
    await openMenuTab();
    await waitForCount("#menu-items .menu-row", 6);
    const set = await mock("side_menu_settings_set", rejects("side-menu.json を書けません"));
    await drag("database", "mail", "before");
    await waitForCalls(set);
    await expect($(CARD)).toHaveText("side-menu.json を書けません");
    await browser.waitUntil(async () => (await order()).join() === "mail,calendar,todo,slack,orca,database");
    expect((await sidebar()).map(([id]) => id)).toEqual(["nav-mail", "nav-calendar", "nav-todo", "nav-slack", "nav-orca", "nav-database"]);
  });

  it("writes the message of a failed read to the log, and draws no row", async () => {
    await openMenuTab({ side_menu_settings: rejects("side-menu.json を読めません") });
    await waitForLog("side-menu.json を読めません");
    expect(await count("#menu-items .menu-row")).toBe(0);
  });

  it("opens a hint from the ? of the card", async () => {
    await openMenuTab();
    await $("#menu-help").click();
    await expect($('.pop[aria-label="メニュー"]')).toBeDisplayed();
    await expect($("#menu-help")).toHaveAttribute("aria-expanded", "true");
  });
});

describe("settings: tabs", () => {
  const tab = (name: Tab) => $(`#settings-tab-${name}`);
  const panel = (name: Tab) => $(`#settings-panel-${name}`);
  const selected = () => browser.execute(() => [...document.querySelectorAll('#settings-tabs [role="tab"]')].filter((t) => t.getAttribute("aria-selected") === "true").map((t) => t.id));
  // Left or right pressed on the selected tab, as the key event the app listens for.
  const pressArrow = (key: "ArrowLeft" | "ArrowRight") =>
    browser.execute(
      (id, k) => {
        if (!window.__e2e_once__(id)) return;
        const current = document.querySelector('#settings-tabs [role="tab"][aria-selected="true"]')!;
        current.dispatchEvent(new KeyboardEvent("keydown", { key: k, bubbles: true, cancelable: true }));
      },
      onceId(),
      key,
    );

  it("has the twelve tabs in order, in a tablist, each controlling the card it names", async () => {
    await openSettings([]);
    await expect($("#settings-tabs")).toHaveAttribute("role", "tablist");
    expect(await textsOf('#settings-tabs [role="tab"]')).toEqual(TABS.map(([, label]) => label));
    for (const [name] of TABS) {
      await expect(tab(name)).toHaveAttribute("aria-controls", `settings-panel-${name}`);
      await expect(panel(name)).toHaveAttribute("role", "tabpanel");
      await expect(panel(name)).toHaveAttribute("aria-labelledby", `settings-tab-${name}`);
    }
  });

  it("opens on Google from the side menu and hides the other cards", async () => {
    await openSettings([]);
    expect(await selected()).toEqual(["settings-tab-google"]);
    await expect(panel("google")).toBeDisplayed();
    for (const [name] of TABS.filter(([n]) => n !== "google")) await expect(panel(name)).not.toBeDisplayed();
  });

  it("shows only the card of the pressed tab", async () => {
    await openSettings([]);
    // One script reads every card, so a press costs two WebDriver commands and not one lookup for each of the twelve cards (the lookups timed out under load).
    const shown = () =>
      browser.execute(() =>
        [...document.querySelectorAll('[role="tabpanel"][id^="settings-panel-"]')]
          .filter((p) => !(p as HTMLElement).hidden && getComputedStyle(p).display !== "none")
          .map((p) => p.id),
      );
    for (const [name] of TABS) {
      await openTab(name);
      expect(await selected()).toEqual([`settings-tab-${name}`]);
      expect(await shown()).toEqual([`settings-panel-${name}`]);
    }
  });

  it("moves to the next tab with the right arrow and the previous one with the left, from the last to the first and back", async () => {
    await openSettings([]);
    await pressArrow("ArrowRight");
    expect(await selected()).toEqual(["settings-tab-calendar"]);
    await expect(panel("calendar")).toBeDisplayed();
    await expect(panel("google")).not.toBeDisplayed();
    await pressArrow("ArrowLeft");
    await pressArrow("ArrowLeft");
    expect(await selected()).toEqual(["settings-tab-log"]);
    await expect(panel("log")).toBeDisplayed();
    await pressArrow("ArrowRight");
    expect(await selected()).toEqual(["settings-tab-google"]);
  });

  it("moves the focus to the neighbour tab along with the arrow key", async () => {
    await openSettings([]);
    const focused = () => browser.execute(() => document.activeElement?.id);
    await pressArrow("ArrowRight");
    expect(await focused()).toBe("settings-tab-calendar");
    await pressArrow("ArrowLeft");
    await pressArrow("ArrowLeft");
    expect(await focused()).toBe("settings-tab-log");
  });

  it("opens the Claude tab from 設定を開く in the Claude popup", async () => {
    await boot({ inbox: inbox(), slack_load: slackLoad, slack_check: checked([]), claude_status: claudeReady });
    await $("#claude-btn").click();
    await $("#account-popup").$("button=設定を開く").click();
    await expect($("#settings")).toBeDisplayed();
    expect(await selected()).toEqual(["settings-tab-claude"]);
    await expect(panel("claude")).toBeDisplayed();
  });

  it("keeps a failure card when another tab is pressed", async () => {
    await boot({ inbox: inbox(), slack_load: slackLoad, slack_check: checked([]), claude_status: claudeMissing, todoist_connected: true });
    await $("#nav-settings").click();
    await openTab("todoist");
    await mock("todoist_disconnect", rejects("資格情報を消せません"));
    await $('button[aria-label="Todoist の接続を解除"]').click();
    await $('[role="alertdialog"]').$("button=解除").click();
    await expect($(CARDS)).toBeDisplayed();
    await openTab("slack");
    await expect($(CARDS)).toBeDisplayed();
  });

  it("opens on Google again when the settings are left and entered from the side menu", async () => {
    await openSettings([], claudeReady, "claude");
    await $("#nav-mail").click();
    await $("#nav-settings").click();
    expect(await selected()).toEqual(["settings-tab-google"]);
  });

  it("closes an open ? hint when a tab is pressed", async () => {
    await openSettings([], claudeReady, "claude");
    await $("#claude-help").click();
    await expect($('[role="dialog"][aria-label="Claude の使い方"]')).toBeDisplayed();
    await openTab("slack");
    await expect($('[role="dialog"][aria-label="Claude の使い方"]')).not.toExist();
  });

  it("keeps the heading and the tabs in view while a long card scrolls under them, and shows a card from its top when its tab is pressed again", async () => {
    const workspaces = Array.from({ length: 24 }, (_, i) => ({ teamId: `T${i}`, team: `Team ${i}`, user: "alice", url: `https://team-${i}.slack.com/` }));
    await boot({ inbox: inbox(), slack_load: { workspaces }, slack_check: checked([]), claude_status: claudeMissing });
    await $("#nav-settings").click();
    await openTab("slack");
    await waitForCount("#slack-workspaces .item", workspaces.length);
    const scrolled = await browser.execute(() => {
      const settings = document.getElementById("settings")!;
      settings.scrollTop = 400;
      return settings.scrollTop;
    });
    expect(scrolled).toBeGreaterThan(0);
    const edges = () =>
      browser.execute(() => {
        const settings = document.getElementById("settings")!.getBoundingClientRect();
        const head = document.getElementById("settings-head")!.getBoundingClientRect();
        const tabs = document.getElementById("settings-tabs")!.getBoundingClientRect();
        return { headTop: Math.round(head.top - settings.top), tabsInside: tabs.top >= settings.top && tabs.bottom <= settings.top + head.height };
      });
    expect(await edges()).toEqual({ headTop: 0, tabsInside: true });
    await expect($("#settings h1")).toBeDisplayed();
    await expect(tab("slack")).toBeDisplayed();
    await openTab("slack");
    expect(await browser.execute(() => document.getElementById("settings")!.scrollTop)).toBe(0);
  });

  it("puts the dot on the update tab only while a newer version is out", async () => {
    await boot({ inbox: inbox(), update_mode: "manual", check_update: { version: "9.9.9", installed: false } });
    await $("#nav-settings").click();
    await waitForText("#update-items .status", "v9.9.9 があります");
    await expect($("#settings-tab-update .tab-dot")).toBeDisplayed();
    expect(await browser.execute(() => document.querySelectorAll("#settings-tabs .tab-dot:not([hidden])").length)).toBe(1);
    await boot({ inbox: inbox() });
    await $("#nav-settings").click();
    await waitForCalls("check_update");
    await waitForText("#update-items .status", "最新");
    await expect($("#settings-tab-update .tab-dot")).not.toBeDisplayed();
  });
});

describe("settings: Slack channels kept off the list", () => {
  const rows = () => textsOf("#slack-hidden .item");

  it("lists them after the connection card with a dot in the workspace's color, #channel, the workspace name and a count, and the channel's ID when its name is not known", async () => {
    await boot({ inbox: inbox(), slack_load: slackLoad, slack_check: checked([]), slack_hidden_list: [hiddenChannel("C0123ABCD", "general"), hiddenChannel("C9ZZ", "C9ZZ")], claude_status: claudeMissing });
    await $("#nav-settings").click();
    await openTab("slack");
    await waitForCount("#slack-hidden .item", 2);
    await expect($("#settings-panel-slack .card:nth-of-type(2) h2")).toHaveText("一覧に出さないチャンネル");
    await expect($("#slack-hidden-count")).toHaveText("2 件");
    expect(await rows()).toEqual(["#generalExample Team戻す", "C9ZZExample Team戻す"]);
    const dots = await browser.execute(() => [...document.querySelectorAll<HTMLElement>("#slack-hidden .hidden-dot")].map((d) => d.style.background));
    expect(dots.every((d) => d !== "")).toBe(true);
    await expect($('button[aria-label="#general を一覧に戻す"]')).toExist();
    await expect($('button[aria-label="C9ZZ を一覧に戻す"]')).toExist();
  });

  it("puts a channel back with 戻す: slack_unhide_channel is called with its IDs and the card is read again", async () => {
    await boot({ inbox: inbox(), slack_load: slackLoad, slack_check: checked([]), slack_hidden_list: [hiddenChannel("C0123ABCD", "general"), hiddenChannel("C2", "random")], claude_status: claudeMissing });
    await $("#nav-settings").click();
    await openTab("slack");
    await waitForCount("#slack-hidden .item", 2);
    const unhide = await mock("slack_unhide_channel", true);
    await mock("slack_hidden_list", [hiddenChannel("C2", "random")]);
    await mock("slack_timeline", timeline([]));
    await $('button[aria-label="#general を一覧に戻す"]').click();
    expect(await waitForCalls(unhide)).toEqual([{ teamId: "T1", channel: "C0123ABCD" }]);
    // The Slack list is made again from Rust's cache, with no read of Slack.
    expect(await waitForCalls("slack_timeline")).toEqual([{ cached: true }]);
    await browser.pause(300);
    expect(await callsOf("slack_timeline")).toEqual([{ cached: true }]);
    await waitForCount("#slack-hidden .item", 1);
    await expect($("#slack-hidden-count")).toHaveText("1 件");
  });

  it("says there are none, with a count of 0", async () => {
    await openSettings([], claudeMissing, "slack");
    await expect($("#slack-hidden .card-empty")).toHaveText("一覧に出さないチャンネルはありません");
    await expect($("#slack-hidden-count")).toHaveText("0 件");
  });
});

describe("settings: skills (the スキル tab, A-32)", () => {
  const rows = () => textsOf("#skill-list .skill-row");
  const row = (n: number) => $(`#skill-list .skill-row:nth-child(${n})`);
  const screenBox = (screen: string) => $(`#skill-screens input[data-screen="${screen}"]`);
  const dialog = '.pop[role="alertdialog"]';

  // The app with the skills `list` and the スキル tab open.
  async function openSkills(list = [skill("alpha"), skill("beta", { screens: ["slack-thread"] })], fixtures: Record<string, unknown> = {}) {
    await boot({ inbox: inbox(), slack_load: slackLoad, slack_check: checked([]), claude_status: claudeMissing, skill_list: list, ...fixtures });
    await $("#nav-settings").click();
    await openTab("skill");
  }

  it("reads the skills only when the tab is shown, and again each time it is shown", async () => {
    await boot({ inbox: inbox(), slack_load: slackLoad, slack_check: checked([]), claude_status: claudeMissing, skill_list: [skill("alpha")] });
    await $("#nav-settings").click();
    await openTab("claude");
    await browser.pause(300);
    expect(await callsOf("skill_list")).toEqual([]);
    await openTab("skill");
    await waitForCalls("skill_list");
    await openTab("google");
    await openTab("skill");
    expect((await waitForCalls("skill_list", 2)).length).toBe(2);
  });

  it("lists the skills with the display name and the name, and keeps the form hidden until one is pressed", async () => {
    await openSkills();
    await waitForCount("#skill-list .skill-row", 2);
    expect(await rows()).toEqual(["Skill alphaalpha", "Skill betabeta"]);
    await expect($("#skill-form")).not.toBeDisplayed();
    await expect($("#skill-new")).toHaveText("新しいスキル");
    expect(await browser.execute(() => document.querySelectorAll("#skill-list [aria-current='true']").length)).toBe(0);
  });

  it("says there are none when no skill is saved", async () => {
    await openSkills([]);
    await expect($("#skill-list .skill-empty")).toHaveText("スキルはまだありません");
    await expect($("#skill-form")).not.toBeDisplayed();
  });

  it("writes a failed read to the log", async () => {
    await openSkills([], { skill_list: rejects("スキルを読めません") });
    await waitForLog("スキルを読めません");
    await expect($(CARDS)).not.toExist();
  });

  it("fills the form from the pressed skill, with its name read-only and 削除 shown, and no placeholder", async () => {
    await openSkills([skill("alpha"), skill("beta", { displayName: "ベータ", screens: ["slack-thread"], description: "説明です", instructions: "指示です\n二行目" })]);
    await waitForCount("#skill-list .skill-row", 2);
    await row(2).click();
    await expect($("#skill-form")).toBeDisplayed();
    await expect(row(2)).toHaveAttribute("aria-current", "true");
    await expect(row(1)).toHaveAttribute("aria-current", "false");
    await expect($("#skill-name")).toHaveValue("beta");
    await expect($("#skill-name")).toHaveAttribute("readonly");
    await expect($("#skill-display-name")).toHaveValue("ベータ");
    await expect(screenBox("slack-paste")).not.toBeSelected();
    await expect(screenBox("slack-thread")).toBeSelected();
    expect(await textsOf("#skill-screens label")).toEqual(["Slack に貼る文章の校正", "Slack のスレッドの相談"]);
    await expect($("#skill-description")).toHaveValue("説明です");
    await expect($("#skill-instructions")).toHaveValue("指示です\n二行目");
    await expect($("#skill-delete")).toBeDisplayed();
    expect(await browser.execute(() => [...document.querySelectorAll("#skill-form input, #skill-form textarea")].filter((e) => e.hasAttribute("placeholder")).length)).toBe(0);
    expect(await callsOf("skill_get")).toEqual([]);
  });

  it("empties the form for 新しいスキル, with the name editable, the focus on it and no 削除", async () => {
    await openSkills();
    await waitForCount("#skill-list .skill-row", 2);
    await row(1).click();
    // The page's own press: the driver's click focuses the button after the page's handler ran, which no real press does.
    await browser.execute((id) => {
      if (!window.__e2e_once__(id)) return;
      document.getElementById("skill-new")!.click();
    }, onceId());
    await expect($("#skill-form")).toBeDisplayed();
    await expect($("#skill-new")).toHaveAttribute("aria-pressed", "true");
    await expect(row(1)).toHaveAttribute("aria-current", "false");
    await expect($("#skill-name")).toHaveValue("");
    await expect($("#skill-name")).not.toHaveAttribute("readonly");
    await expect($("#skill-display-name")).toHaveValue("");
    await expect(screenBox("slack-thread")).not.toBeSelected();
    await expect($("#skill-description")).toHaveValue("");
    await expect($("#skill-instructions")).toHaveValue("");
    await expect($("#skill-delete")).not.toBeDisplayed();
    expect(await browser.execute(() => document.activeElement?.id)).toBe("skill-name");
  });

  it("saves a new skill: skill_save gets the fields, the form takes the saved skill and the list is read again", async () => {
    await openSkills([skill("alpha")]);
    await waitForCount("#skill-list .skill-row", 1);
    const saved = skill("gamma", { displayName: "ガンマ", screens: ["slack-paste", "slack-thread"], description: "説明", instructions: "指示" });
    const save = await mock("skill_save", saved);
    await mock("skill_list", [skill("alpha"), saved]);
    await $("#skill-new").click();
    await $("#skill-name").setValue("gamma");
    await $("#skill-display-name").setValue("ガンマ");
    await screenBox("slack-thread").click();
    await screenBox("slack-paste").click();
    await $("#skill-description").setValue("説明");
    await $("#skill-instructions").setValue("指示");
    await $("#skill-save").click();
    // The screens go in the order of the check boxes, not of the presses.
    expect(await waitForCalls(save)).toEqual([{ skill: { name: "gamma", displayName: "ガンマ", screens: ["slack-paste", "slack-thread"], description: "説明", instructions: "指示" }, create: true }]);
    await waitForCount("#skill-list .skill-row", 2);
    expect(await rows()).toEqual(["Skill alphaalpha", "ガンマgamma"]);
    await expect(row(2)).toHaveAttribute("aria-current", "true");
    await expect($("#skill-name")).toHaveAttribute("readonly");
    await expect($("#skill-delete")).toBeDisplayed();
    await expect($("#skill-new")).toHaveAttribute("aria-pressed", "false");
    await expect($(CARDS)).not.toExist();
  });

  it("saves a changed skill under its own name, and the form shows the answer as Rust saved it", async () => {
    await openSkills([skill("alpha")]);
    await waitForCount("#skill-list .skill-row", 1);
    await row(1).click();
    const save = await mock("skill_save", skill("alpha", { displayName: "新しい表示名", instructions: "Trimmed." }));
    await mock("skill_list", [skill("alpha", { displayName: "新しい表示名", instructions: "Trimmed." })]);
    await $("#skill-display-name").setValue("新しい表示名");
    await $("#skill-instructions").setValue("  Trimmed.  ");
    await $("#skill-save").click();
    expect(await waitForCalls(save)).toEqual([{ skill: { name: "alpha", displayName: "新しい表示名", screens: [], description: "About alpha", instructions: "  Trimmed.  " }, create: false }]);
    await waitForText("#skill-list .skill-row", "新しい表示名");
    await expect($("#skill-instructions")).toHaveValue("Trimmed.");
  });

  it("sends nothing for a new skill whose name is a saved skill's, and says so", async () => {
    await openSkills([skill("alpha")]);
    await waitForCount("#skill-list .skill-row", 1);
    const save = await mock("skill_save", skill("alpha"));
    await $("#skill-new").click();
    await $("#skill-name").setValue("alpha");
    await $("#skill-display-name").setValue("Again");
    await $("#skill-instructions").setValue("Do.");
    await $("#skill-save").click();
    await expect($(CARD)).toHaveText("スキル「alpha」はもうあります");
    await browser.pause(300);
    expect(await callsOf(save)).toEqual([]);
    await expect($("#skill-display-name")).toHaveValue("Again");
  });

  it("sends a new skill with create even when the list was not read, and shows the refusal of Rust", async () => {
    await openSkills([], { skill_list: rejects("スキルを読めません") });
    await waitForLog("スキルを読めません");
    const save = await mock("skill_save", rejects("スキル「alpha」はもうあります"));
    await $("#skill-new").click();
    await $("#skill-name").setValue("alpha");
    await $("#skill-display-name").setValue("Again");
    await $("#skill-instructions").setValue("Do.");
    await $("#skill-save").click();
    expect(await waitForCalls(save)).toEqual([{ skill: { name: "alpha", displayName: "Again", screens: [], description: "", instructions: "Do." }, create: true }]);
    await expect($(CARD)).toHaveText("スキル「alpha」はもうあります");
    await expect($("#skill-display-name")).toHaveValue("Again");
  });

  it("shows a failed save on a card and keeps what was typed", async () => {
    await openSkills([skill("alpha")]);
    await waitForCount("#skill-list .skill-row", 1);
    await mock("skill_save", rejects("表示名を入れてください"));
    await $("#skill-new").click();
    await $("#skill-name").setValue("delta");
    await $("#skill-instructions").setValue("Typed.");
    await $("#skill-save").click();
    await expect($(CARD)).toHaveText("表示名を入れてください");
    await expect($("#skill-name")).toHaveValue("delta");
    await expect($("#skill-instructions")).toHaveValue("Typed.");
    await expect($("#skill-name")).not.toHaveAttribute("readonly");
    expect(await rows()).toEqual(["Skill alphaalpha"]);
  });

  it("ignores a second press of 保存 while a save is on its way", async () => {
    await openSkills([skill("alpha")]);
    await waitForCount("#skill-list .skill-row", 1);
    await row(1).click();
    const save = await mock("skill_save", holds);
    await $("#skill-save").click();
    await waitForCalls(save);
    await $("#skill-save").click();
    await browser.pause(300);
    expect((await callsOf(save)).length).toBe(1);
    await release(save, skill("alpha"));
  });

  it("deletes after the confirmation: skill_delete gets the name, the form closes and the list is read again", async () => {
    await openSkills();
    await waitForCount("#skill-list .skill-row", 2);
    await row(1).click();
    const del = await mock("skill_delete", null);
    await mock("skill_list", [skill("beta", { screens: ["slack-thread"] })]);
    await $("#skill-delete").click();
    await expect($(`${dialog} p`)).toHaveText("Skill alpha を完全に削除します。元に戻せません。");
    expect(await callsOf(del)).toEqual([]);
    await $(`${dialog} .text-btn.danger`).click();
    expect(await waitForCalls(del)).toEqual([{ name: "alpha" }]);
    await waitForCount("#skill-list .skill-row", 1);
    expect(await rows()).toEqual(["Skill betabeta"]);
    await expect($("#skill-form")).not.toBeDisplayed();
  });

  it("keeps the skill when the confirmation is cancelled", async () => {
    await openSkills();
    await waitForCount("#skill-list .skill-row", 2);
    await row(1).click();
    const del = await mock("skill_delete", null);
    await $("#skill-delete").click();
    await $(`${dialog} .text-btn:not(.danger)`).click();
    await expect($(dialog)).not.toExist();
    expect(await callsOf(del)).toEqual([]);
    await expect($("#skill-form")).toBeDisplayed();
    expect(await rows()).toEqual(["Skill alphaalpha", "Skill betabeta"]);
  });

  it("shows a failed delete on a card and keeps the form and the list", async () => {
    await openSkills();
    await waitForCount("#skill-list .skill-row", 2);
    await row(1).click();
    await mock("skill_delete", rejects("スキル「alpha」を消せません"));
    await $("#skill-delete").click();
    await $(`${dialog} .text-btn.danger`).click();
    await expect($(CARD)).toHaveText("スキル「alpha」を消せません");
    await expect($("#skill-form")).toBeDisplayed();
    expect(await rows()).toEqual(["Skill alphaalpha", "Skill betabeta"]);
  });

  // The pane of Claude Code at the right of the form (A-32, A-36, #345): `skill_list`, `skill_get` and `skill_save` of tsunagiai-mcp, and `changed` `skills`.
  const term = "#skill-term";
  const changed = (what: string) => emitEvent("screen-bridge-changed", what);

  it("has the terminal and やり直す at the right of the form, with none of the conversation and no help text", async () => {
    await openSkills();
    await expect($(`${term}.claude-code-pane`)).toBeDisplayed();
    await expect($("#skill-restart")).toHaveText("やり直す");
    await expect($("#skill-restart")).toBeEnabled();
    expect(await browser.execute(() => document.querySelector("#skill-chat .chat-head")!.lastElementChild!.id)).toBe("skill-restart");
    // The pane follows the form in the card.
    expect(await browser.execute(() => document.getElementById("skill-form")!.nextElementSibling!.id)).toBe("skill-chat");
    // Only the head (with the one button) and the terminal: no log, request field, model select or note (the terminal's own hidden field is xterm's).
    expect(await browser.execute(() => [...document.getElementById("skill-chat")!.children].map((e) => e.id || e.className))).toEqual(["chat-head", "skill-term"]);
    expect(await count("#skill-chat .chat-head > :not(svg):not(#skill-restart)")).toBe(0);
  });

  it("starts Claude Code only once the tab is shown, with the tools of tsunagiai-mcp only and a first instruction that names the tools and holds no skill", async () => {
    await boot({ inbox: inbox(), slack_load: slackLoad, slack_check: checked([]), claude_status: claudeMissing, skill_list: [skill("alpha")] });
    await $("#nav-settings").click();
    await openTab("claude");
    await browser.pause(300);
    expect(await callsOf("claude_code_start")).toEqual([]);
    await openTab("skill");
    const [start] = await waitForCalls("claude_code_start");
    expect(start).toMatchObject({ id: "skill-claude", builtinTools: false, permissionMode: "manual", skill: null });
    const { prompt, viewport } = start as { prompt: string; viewport: { cols: number; rows: number } };
    for (const word of ["スキル", "skill_list", "skill_get", "skill_save", "create", "従わない"]) expect(prompt).toContain(word);
    expect(prompt).not.toContain("Do alpha.");
    expect(viewport.cols).toBeGreaterThan(20);
    expect(viewport.rows).toBeGreaterThan(5);
    for (const command of ["claude_chat_thread", "orca_stream_terminal", "orca_terminal_read"]) expect(await callsOf(command)).toEqual([]);
  });

  it("hides the terminal while another tab is shown and starts nothing again when the tab is shown again", async () => {
    await openSkills();
    await waitForCalls("claude_code_start");
    const close = await mock("claude_code_close", null);
    await openTab("google");
    await expect($(term)).not.toBeDisplayed();
    await openTab("skill");
    await expect($(`${term}.claude-code-pane`)).toBeDisplayed();
    await browser.pause(500);
    expect((await callsOf("claude_code_start")).length).toBe(1);
    expect(await callsOf(close)).toEqual([]);
  });

  it("ends the process and starts a new one with やり直す", async () => {
    await openSkills();
    await waitForCalls("claude_code_start");
    const close = await mock("claude_code_close", null);
    await $("#skill-restart").click();
    expect(await waitForCalls(close)).toEqual([{ id: "skill-claude", launch: 1 }]);
    expect(await waitForCalls("claude_code_start", 2)).toHaveLength(2);
    await expect($("#skill-restart")).toBeEnabled();
  });

  it("fills the form again with the skill that Claude Code saved, and reads the list again", async () => {
    await openSkills([skill("alpha"), skill("beta")]);
    await waitForCount("#skill-list .skill-row", 2);
    await row(1).click();
    await expect($("#skill-instructions")).toHaveValue("Do alpha.");
    const list = await mock("skill_list", [skill("alpha", { displayName: "新しい表示名", instructions: "Rewritten." }), skill("beta")]);
    await changed("skills");
    await waitForCalls(list);
    await expect($("#skill-instructions")).toHaveValue("Rewritten.");
    await expect($("#skill-display-name")).toHaveValue("新しい表示名");
    await expect($("#skill-name")).toHaveAttribute("readonly");
    await expect(row(1)).toHaveAttribute("aria-current", "true");
    expect(await rows()).toEqual(["新しい表示名alpha", "Skill betabeta"]);
  });

  it("lists a skill that Claude Code made, and keeps what was typed when the skill shown did not change", async () => {
    await openSkills([skill("alpha")]);
    await waitForCount("#skill-list .skill-row", 1);
    await row(1).click();
    await $("#skill-instructions").setValue("Typed by hand");
    const list = await mock("skill_list", [skill("alpha"), skill("gamma")]);
    await changed("skills");
    await waitForCalls(list);
    await waitForCount("#skill-list .skill-row", 2);
    await expect($("#skill-instructions")).toHaveValue("Typed by hand");
  });

  it("reads nothing for another kind of change, and nothing while the tab is not shown until it is", async () => {
    await openSkills();
    await waitForCount("#skill-list .skill-row", 2);
    const list = await mock("skill_list", [skill("alpha", { instructions: "Rewritten." }), skill("beta")]);
    await changed("todo");
    await openTab("google");
    await changed("skills");
    await browser.pause(300);
    expect(await callsOf(list)).toEqual([]);
    await openTab("skill");
    await waitForCalls(list);
  });
});

describe("settings: log (the ログ tab, A-3, A-28)", () => {
  // The lines the table shows: the cells of each row.
  const cells = () => browser.execute(() => [...document.querySelectorAll("#log-body tbody tr")].map((tr) => [...tr.children].map((c) => c.textContent?.trim() ?? "")));
  const pressed = () => browser.execute(() => [...document.querySelectorAll(".log-filters button")].filter((b) => b.getAttribute("aria-pressed") === "true").map((b) => b.textContent));
  const lines = [
    logLine("2026-11-14T13:00:55.000Z", "error", "メール", "アーカイブできませんでした: Gmail が 500 を返しました"),
    logLine("2026-11-14T13:00:41.000Z", "warn", "Orca 端末", "入力したターミナルは表示されていないため、送りませんでした"),
    logLine("2026-11-14T12:58:10.000Z", "warn", "Slack", "一覧を読めませんでした。2 分後に読み直します"),
    logLine("2026-11-14T12:52:03.000Z", "info", "Orca", "接続先につながりました"),
  ];

  // The app with the log `read` answers and the ログ tab open.
  async function openLog(read: unknown = lines, fixtures: Record<string, unknown> = {}) {
    await boot({ inbox: inbox(), slack_load: slackLoad, slack_check: checked([]), claude_status: claudeMissing, log_read: read, ...fixtures });
    await $("#nav-settings").click();
    await openTab("log");
  }

  it("reads the log only when the tab is shown, and again each time it is shown", async () => {
    await boot({ inbox: inbox(), slack_load: slackLoad, slack_check: checked([]), claude_status: claudeMissing, log_read: lines });
    await $("#nav-settings").click();
    await browser.pause(300);
    expect(await callsOf("log_read")).toEqual([]);
    await openTab("log");
    await waitForCalls("log_read");
    await openTab("google");
    await openTab("log");
    expect((await waitForCalls("log_read", 2)).length).toBe(2);
  });

  it("puts the tab after アップデート and draws the lines in the order Rust answered, under 時刻, 重さ, 場所 and 内容", async () => {
    await openLog();
    await waitForCount("#log-body tbody tr", 4);
    expect(await textsOf("#log-body thead th")).toEqual(["時刻", "重さ", "場所", "内容"]);
    const rows = await cells();
    expect(rows.map((r) => r.slice(1))).toEqual([
      ["エラー", "メール", "アーカイブできませんでした: Gmail が 500 を返しました"],
      ["警告", "Orca 端末", "入力したターミナルは表示されていないため、送りませんでした"],
      ["警告", "Slack", "一覧を読めませんでした。2 分後に読み直します"],
      ["情報", "Orca", "接続先につながりました"],
    ]);
    expect(rows.map((r) => r[0]!.slice(-2))).toEqual(["55", "41", "10", "03"]);
    for (const r of rows) expect(r[0]).toMatch(/^\d\d\/\d\d \d\d:\d\d:\d\d$/);
    expect(await browser.execute(() => [...document.querySelectorAll("#log-body tbody tr")].map((tr) => tr.className))).toEqual(["log-row error", "log-row warn", "log-row warn", "log-row info"]);
  });

  it("shows every line to start with, and only the errors or only the warnings with エラー and 警告, and every line again with すべて", async () => {
    await openLog();
    await waitForCount("#log-body tbody tr", 4);
    expect(await pressed()).toEqual(["すべて"]);
    await $("#log-filter-error").click();
    expect(await pressed()).toEqual(["エラー"]);
    expect((await cells()).map((r) => r[1])).toEqual(["エラー"]);
    await $("#log-filter-warn").click();
    expect(await pressed()).toEqual(["警告"]);
    expect((await cells()).map((r) => r[2])).toEqual(["Orca 端末", "Slack"]);
    await $("#log-filter-all").click();
    expect(await pressed()).toEqual(["すべて"]);
    await waitForCount("#log-body tbody tr", 4);
  });

  it("says there is no log, and has nothing to copy, when no line is shown", async () => {
    await openLog([]);
    await expect($("#log-body .card-empty")).toHaveText("ログはありません");
    await expect($("#log-body table")).not.toExist();
    await expect($("#log-copy")).toBeDisabled();
    await openLog([lines[3]]);
    await waitForCount("#log-body tbody tr", 1);
    await expect($("#log-copy")).toBeEnabled();
    await $("#log-filter-error").click();
    await expect($("#log-body .card-empty")).toHaveText("ログはありません");
    await expect($("#log-copy")).toBeDisabled();
  });

  it("copies the lines that are shown, one a line, with the time as the file holds it, and not the others", async () => {
    await openLog();
    await waitForCount("#log-body tbody tr", 4);
    await stubClipboard();
    await $("#log-filter-warn").click();
    await $("#log-copy").click();
    await browser.waitUntil(async () => (await copiedTexts()).length === 1, { timeoutMsg: "the clipboard was never written" });
    expect(await copiedTexts()).toEqual([
      "2026-11-14T13:00:41.000Z\t警告\tOrca 端末\t入力したターミナルは表示されていないため、送りませんでした\n2026-11-14T12:58:10.000Z\t警告\tSlack\t一覧を読めませんでした。2 分後に読み直します",
    ]);
    await $("#log-filter-all").click();
    await $("#log-copy").click();
    await browser.waitUntil(async () => (await copiedTexts()).length === 2, { timeoutMsg: "the clipboard was never written" });
    expect(((await copiedTexts())[1] as string).split("\n").length).toBe(4);
  });

  it("opens the folder with フォルダを開く", async () => {
    await openLog();
    await mock("log_open_folder", null);
    await $("#log-open-folder").click();
    expect((await waitForCalls("log_open_folder")).length).toBe(1);
    await expect($(CARDS)).not.toExist();
  });

  it("shows the message when the folder cannot be opened", async () => {
    await openLog();
    await mock("log_open_folder", rejects("/example/config を開けません"));
    await $("#log-open-folder").click();
    await expect($(CARD)).toHaveText("/example/config を開けません");
  });

  it("writes the message to the log when the log cannot be read, and shows no table", async () => {
    await openLog(rejects("app-log.jsonl を読めません"));
    await waitForLog("app-log.jsonl を読めません");
    await expect($("#log-body table")).not.toExist();
  });

  it("draws the log read again when the tab is shown again", async () => {
    await openLog();
    await waitForCount("#log-body tbody tr", 4);
    await mock("log_read", [lines[0]]);
    await openTab("google");
    await openTab("log");
    await waitForCount("#log-body tbody tr", 1);
  });
});

describe("settings: plugins (the Plugins tab, A-51)", () => {
  // A plugin as `plugins_list` answers it.
  const plugin = (folder: string, skills: string[] = [], name = folder) => ({ folder, name, skills });
  const rows = () => textsOf("#plugin-list .plugin-row");
  const row = (n: number) => $(`#plugin-list .plugin-item:nth-child(${n}) .plugin-row`);
  const tabs = () => textsOf("#plugin-tabs .orca-tab-title");
  const term = "#plugin-term";

  // The app with the plugins `list` and the Plugins tab open.
  async function openPlugins(list = [plugin("alpha", ["review", "design"]), plugin("beta", [], "client-b")], fixtures: Record<string, unknown> = {}) {
    await boot({ inbox: inbox(), slack_load: slackLoad, slack_check: checked([]), claude_status: claudeMissing, plugins_list: list, ...fixtures });
    await $("#nav-settings").click();
    await openTab("plugins");
  }

  it("reads the plugins only when the tab is shown, and again each time it is shown", async () => {
    await boot({ inbox: inbox(), slack_load: slackLoad, slack_check: checked([]), claude_status: claudeMissing, plugins_list: [plugin("alpha")] });
    await $("#nav-settings").click();
    await openTab("claude");
    await browser.pause(300);
    expect(await callsOf("plugins_list")).toEqual([]);
    await openTab("plugins");
    await waitForCalls("plugins_list");
    await openTab("google");
    await openTab("plugins");
    expect((await waitForCalls("plugins_list", 2)).length).toBe(2);
  });

  it("lists each plugin by its name with its skills as plugin:skill under it, and starts no pane until one is pressed", async () => {
    await openPlugins();
    await waitForCount("#plugin-list .plugin-row", 2);
    expect(await rows()).toEqual(["alpha", "client-b"]);
    expect(await textsOf("#plugin-list .plugin-skill")).toEqual(["alpha:review", "alpha:design"]);
    expect(await count("#plugin-list [aria-current='true']")).toBe(0);
    expect(await tabs()).toEqual([]);
    await expect($("#plugin-tab-add")).toBeDisabled();
    await expect($("#plugin-files")).toExist();
    await browser.pause(300);
    expect(await callsOf("claude_code_start")).toEqual([]);
  });

  it("says there are none when the folder holds no plugin, and writes a failed read to the log", async () => {
    await openPlugins([]);
    await expect($("#plugin-list .plugin-empty")).toHaveText("プラグインはまだありません");
    await openPlugins([], { plugins_list: rejects("プラグインを読めません") });
    await waitForLog("プラグインを読めません");
    await expect($(CARDS)).not.toExist();
  });

  it("starts Claude Code in the plugin pressed, with its own tools, the manual mode, no skill and no first instruction", async () => {
    await openPlugins();
    await waitForCount("#plugin-list .plugin-row", 2);
    await row(2).click();
    await expect(row(2)).toHaveAttribute("aria-current", "true");
    await expect(row(1)).toHaveAttribute("aria-current", "false");
    const [start] = await waitForCalls("claude_code_start");
    expect(start).toMatchObject({ id: "plugin:beta/1", builtinTools: true, permissionMode: "manual", skill: null, prompt: null });
    expect(((start as { viewport: { cols: number } }).viewport).cols).toBeGreaterThan(20);
    expect(await tabs()).toEqual(["Claude Code"]);
    await expect($(`${term}.claude-code-pane`)).toBeDisplayed();
    await expect($("#plugin-tab-add")).toBeEnabled();
  });

  it("adds a tab with the plus, starts another pane for it, and shows a tab again without a new start", async () => {
    await openPlugins();
    await waitForCount("#plugin-list .plugin-row", 2);
    await row(1).click();
    await waitForCalls("claude_code_start");
    await $("#plugin-tab-add").click();
    const starts = await waitForCalls("claude_code_start", 2);
    expect(starts.map((s) => (s as { id: string }).id)).toEqual(["plugin:alpha/1", "plugin:alpha/2"]);
    expect(await tabs()).toEqual(["Claude Code", "Claude Code 2"]);
    await expect($("#plugin-tabs .orca-tab:nth-child(2) .orca-tab-btn")).toHaveAttribute("aria-selected", "true");
    await $("#plugin-tabs .orca-tab:nth-child(1) .orca-tab-btn").click();
    await expect($("#plugin-tabs .orca-tab:nth-child(1) .orca-tab-btn")).toHaveAttribute("aria-selected", "true");
    await browser.pause(500);
    expect((await callsOf("claude_code_start")).length).toBe(2);
  });

  it("ends the process of a tab that is closed, and shows the tab next to it", async () => {
    await openPlugins();
    await waitForCount("#plugin-list .plugin-row", 2);
    await row(1).click();
    await waitForCalls("claude_code_start");
    await $("#plugin-tab-add").click();
    await waitForCalls("claude_code_start", 2);
    const close = await mock("claude_code_close", null);
    await $("#plugin-tabs .orca-tab:nth-child(2) .orca-tab-close").click();
    expect(await waitForCalls(close)).toEqual([{ id: "plugin:alpha/2", launch: 1 }]);
    expect(await tabs()).toEqual(["Claude Code"]);
    await expect($("#plugin-tabs .orca-tab-btn")).toHaveAttribute("aria-selected", "true");
    await expect($(`${term}.claude-code-pane`)).toBeDisplayed();
  });

  it("drops the tab of a process that ended by itself", async () => {
    await openPlugins();
    await waitForCount("#plugin-list .plugin-row", 2);
    await row(1).click();
    await waitForCalls("claude_code_start");
    await sendClaudeCode({ kind: "ended", message: "Claude Code が終わりました", clean: true });
    await waitForCount("#plugin-tabs .orca-tab", 0);
  });

  it("keeps the tabs of each plugin, and a plugin that is pressed with no tab left opens its first again", async () => {
    await openPlugins();
    await waitForCount("#plugin-list .plugin-row", 2);
    await row(1).click();
    await waitForCalls("claude_code_start");
    await $("#plugin-tab-add").click();
    await waitForCalls("claude_code_start", 2);
    await row(2).click();
    expect((await waitForCalls("claude_code_start", 3)).map((s) => (s as { id: string }).id)).toEqual(["plugin:alpha/1", "plugin:alpha/2", "plugin:beta/1"]);
    expect(await tabs()).toEqual(["Claude Code"]);
    await row(1).click();
    expect(await tabs()).toEqual(["Claude Code", "Claude Code 2"]);
    await browser.pause(500);
    expect((await callsOf("claude_code_start")).length).toBe(3);
    // The only tab closed: pressing the plugin opens a new first one (the next number).
    await row(2).click();
    await $("#plugin-tabs .orca-tab-close").click();
    expect(await tabs()).toEqual([]);
    await row(2).click();
    expect((await waitForCalls("claude_code_start", 4)).map((s) => (s as { id: string }).id).at(-1)).toBe("plugin:beta/2");
  });

  it("hides the terminal while another tab is shown, and starts nothing again when the tab is shown again", async () => {
    await openPlugins();
    await waitForCount("#plugin-list .plugin-row", 2);
    await row(1).click();
    await waitForCalls("claude_code_start");
    const close = await mock("claude_code_close", null);
    await openTab("google");
    await expect($(term)).not.toBeDisplayed();
    await openTab("plugins");
    await expect($(`${term}.claude-code-pane`)).toBeDisplayed();
    expect(await tabs()).toEqual(["Claude Code"]);
    await browser.pause(500);
    expect((await callsOf("claude_code_start")).length).toBe(1);
    expect(await callsOf(close)).toEqual([]);
  });

  it("ends the panes of a plugin that is no longer in the folder when the list is read again", async () => {
    await openPlugins();
    await waitForCount("#plugin-list .plugin-row", 2);
    await row(2).click();
    await waitForCalls("claude_code_start");
    await mock("plugins_list", [plugin("alpha", ["review", "design"])]);
    const close = await mock("claude_code_close", null);
    await openTab("google");
    await openTab("plugins");
    expect(await waitForCalls(close)).toEqual([{ id: "plugin:beta/1", launch: 1 }]);
    await waitForCount("#plugin-list .plugin-row", 1);
    expect(await tabs()).toEqual([]);
    await expect($("#plugin-tab-add")).toBeDisabled();
  });

  it("makes a plugin with the name typed, reads the list again and selects the new plugin", async () => {
    await openPlugins([plugin("alpha")]);
    await waitForCount("#plugin-list .plugin-row", 1);
    await expect($("#plugin-new-row")).not.toBeDisplayed();
    // The page's own click: the driver's click focuses the button after the handler, which takes the focus off the field.
    await browser.execute(() => {
      document.getElementById("plugin-new")!.click();
    });
    await expect($("#plugin-new-name")).toBeFocused();
    await expect($("#plugin-new-name")).not.toHaveAttribute("placeholder");
    const create = await mock("plugin_create", plugin("client-a"));
    await mock("plugins_list", [plugin("alpha"), plugin("client-a")]);
    await $("#plugin-new-name").setValue("client-a");
    await browser.keys("Enter");
    expect(await waitForCalls(create)).toEqual([{ name: "client-a" }]);
    await waitForCount("#plugin-list .plugin-row", 2);
    await expect($("#plugin-new-row")).not.toBeDisplayed();
    await expect($("#plugin-new-name")).toHaveValue("");
    await expect(row(2)).toHaveAttribute("aria-current", "true");
    expect((await waitForCalls("claude_code_start")).map((s) => (s as { id: string }).id)).toEqual(["plugin:client-a/1"]);
  });

  it("shows the refusal of a name on a card and keeps the name typed", async () => {
    await openPlugins([plugin("alpha")]);
    await waitForCount("#plugin-list .plugin-row", 1);
    await $("#plugin-new").click();
    await mock("plugin_create", rejects("プラグイン「alpha」はもうあります"));
    await $("#plugin-new-name").setValue("alpha");
    await browser.keys("Enter");
    await expect($(CARD)).toHaveText("プラグイン「alpha」はもうあります");
    await expect($("#plugin-new-name")).toHaveValue("alpha");
    await expect($("#plugin-new-row")).toBeDisplayed();
    expect(await count("#plugin-list .plugin-row")).toBe(1);
  });

  it("makes nothing for an empty name, and Escape closes the field", async () => {
    await openPlugins([plugin("alpha")]);
    await $("#plugin-new").click();
    const create = await mock("plugin_create", plugin("x"));
    await browser.keys("Enter");
    await browser.pause(300);
    expect(await callsOf(create)).toEqual([]);
    await $("#plugin-new-name").setValue("abc");
    await browser.keys("Escape");
    await expect($("#plugin-new-row")).not.toBeDisplayed();
    await expect($("#plugin-new-name")).toHaveValue("");
  });
});
