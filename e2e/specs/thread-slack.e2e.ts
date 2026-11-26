import type { Channel } from "../../ts/bindings/Channel";
import type { SlackLoad } from "../../ts/bindings/SlackLoad";
import { boot, callsOf, count, holds, inbox, mock, rejects, release, rowOf, textsOf, threadDetail, threadLoaded, waitForCalls, waitForCard, waitForCount, workspace, CARD, CARDS } from "../support";

// S-28 (#1224): the # of the row of operations of an open mail opens and closes a post pane on the right: the channel button in its header (a list of the channels of every workspace, grouped by workspace, with a search field),
// and the text field and the send button in its foot. The send is `slack_channel_post` (S-21).
describe("mail: the Slack post pane on the right", () => {
  const second = { ...workspace, teamId: "T2", team: "Second Team" };
  const load: SlackLoad = { workspaces: [workspace, second] };
  // What `slack_channels` answers for both workspaces.
  const channels: Channel[] = [
    { id: "C1", name: "general", private: false },
    { id: "C2", name: "random", private: false },
  ];
  const field = () => $("#mail-slack-text");
  const send = () => $("#mail-slack-send");
  const channelButton = () => $("#mail-slack-channel");

  beforeEach(async () => {
    await boot({ inbox: inbox(), slack_load: load });
    await waitForCount("#unread-threads li", 2);
    await mock("thread", threadDetail("First unread", "Hello from Alice", false));
    await rowOf("unread-threads", "First unread").$(".subject").click();
    await expect($("#thread-subject")).toHaveText("First unread");
    await threadLoaded();
  });

  const openPane = async () => {
    await $("#thread-slack").click();
    await expect($("#mail-slack")).toBeDisplayed();
  };
  // Opens the list of the channels and waits until it holds them.
  const openList = async () => {
    await mock("slack_channels", channels);
    await channelButton().click();
    await expect($(".mail-slack-pop .menu-search")).toBeDisplayed();
    await browser.waitUntil(async () => (await textsOf(".mail-slack-pop button")).length > 0, { timeoutMsg: "the list of the channels never came" });
  };
  const items = () => textsOf(".mail-slack-pop button");
  // Picks the `n`th channel of the list (from 0), in the order of the workspaces.
  const pick = async (n: number) => {
    await (await $$(".mail-slack-pop button"))[n].click();
    await expect($(".mail-slack-pop")).not.toExist();
  };

  it("opens and closes with the #, and shows nothing of the mail or of Claude", async () => {
    for (const id of ["#mail-side", "#mail-split", "#mail-slack"]) await expect($(id)).not.toBeDisplayed();
    await expect($("#thread-slack")).toHaveAttribute("aria-pressed", "false");
    // The page's own click: the driver's click focuses the button after the handler has given the keyboard to the field.
    await browser.execute(() => document.getElementById("thread-slack")!.click());
    await expect($("#mail-slack")).toBeDisplayed();
    await expect($("#mail-side")).toBeDisplayed();
    await expect($("#mail-split")).toBeDisplayed();
    for (const id of ["#mail-tools", "#mail-claude"]) await expect($(id)).not.toBeDisplayed();
    await expect($("#thread-slack")).toHaveAttribute("aria-pressed", "true");
    // The header has the channel button and the close button; the foot has the field (empty, no placeholder) and the send button, which is off.
    await expect($("#mail-slack")).toHaveAttribute("aria-label", "Slack に投稿");
    await expect($("#mail-slack-head")).toHaveAttribute("data-tauri-drag-region", "deep");
    await expect(channelButton()).toHaveAttribute("aria-label", "投稿先のチャンネル");
    await expect($("#mail-slack-close")).toHaveAttribute("aria-label", "閉じる");
    await expect(field()).toHaveValue("");
    await expect(field()).toHaveAttribute("aria-label", "投稿する文");
    expect(await field().getAttribute("placeholder")).toBeNull();
    await expect(send()).toHaveText("送信");
    await expect(send()).toBeDisabled();
    // The header is as high as the header of the mail at the left, and meets its line.
    expect(await browser.execute(() => document.getElementById("mail-slack-head")!.getBoundingClientRect().bottom === document.getElementById("mail-header")!.getBoundingClientRect().bottom)).toBe(true);
    // The field opened by the # has the keyboard.
    expect(await browser.execute(() => document.activeElement?.id)).toBe("mail-slack-text");
    await $("#thread-slack").click();
    for (const id of ["#mail-side", "#mail-split", "#mail-slack"]) await expect($(id)).not.toBeDisplayed();
    await expect($("#thread-slack")).toHaveAttribute("aria-pressed", "false");
    await openPane();
    await $("#mail-slack-close").click();
    await expect($("#mail-side")).not.toBeDisplayed();
    await expect($("#thread-slack")).toHaveAttribute("aria-pressed", "false");
  });

  it("lists the channels of every workspace under the workspace, and narrows them by the typed text", async () => {
    await openPane();
    await openList();
    expect(await textsOf(".mail-slack-pop .menu-group")).toEqual(["Example Team", "Second Team"]);
    expect(await items()).toEqual(["#general", "#random", "#general", "#random"]);
    expect(await callsOf("slack_channels")).toEqual([
      { teamId: "T1", refresh: false },
      { teamId: "T2", refresh: false },
    ]);
    const search = $(".mail-slack-pop .menu-search");
    await search.setValue("RAN");
    expect(await items()).toEqual(["#random", "#random"]);
    expect(await textsOf(".mail-slack-pop .menu-group")).toEqual(["Example Team", "Second Team"]);
    await search.setValue("zzz");
    expect(await items()).toEqual([]);
    expect(await textsOf(".mail-slack-pop .menu-empty")).toEqual(["該当するチャンネルがありません"]);
    // Enter picks the first one left.
    await search.setValue("gen");
    await browser.keys("Enter");
    await expect($(".mail-slack-pop")).not.toExist();
    await expect(channelButton()).toHaveText("#general");
    await expect(channelButton()).toHaveAttribute("aria-label", "投稿先: #general");
  });

  it("says why when the list of a workspace cannot be read", async () => {
    await openPane();
    await mock("slack_channels", rejects("missing_scope"));
    await channelButton().click();
    // Both workspaces fail with the same answer: each says why on a card with its name, and the list holds neither.
    await waitForCount(CARDS, 2);
    await waitForCard("Example Team: missing_scope");
    await waitForCard("Second Team: missing_scope");
    expect(await count(".mail-slack-pop .menu-group")).toBe(0);
    await browser.keys("Escape");
    await expect($(".mail-slack-pop")).not.toExist();
  });

  it("asks for the workspace in settings when there is none", async () => {
    await mock("slack_load", { workspaces: [] });
    await openPane();
    await channelButton().click();
    await expect($(".toast")).toHaveText(expect.stringContaining("Slack のワークスペースを設定で追加してください"));
    await expect($(".mail-slack-pop")).not.toExist();
    expect(await callsOf("slack_channels")).toEqual([]);
  });

  it("sends the text to the chosen channel as it is, empties the field, and chooses the same channel next time", async () => {
    await openPane();
    // Nothing can be sent before a channel is chosen.
    await field().setValue("こんにちは");
    await expect(send()).toBeDisabled();
    await openList();
    await pick(3);
    await expect(channelButton()).toHaveText("#random");
    await expect(send()).toBeEnabled();
    const post = await mock("slack_channel_post", true);
    await send().click();
    expect(await waitForCalls(post)).toEqual([{ teamId: "T2", channel: "C2", text: "こんにちは" }]);
    await expect(field()).toHaveValue("");
    await expect(send()).toBeDisabled();
    await expect($(".toast")).toHaveText("#random に投稿しました");
    await expect(channelButton()).toHaveText("#random");
    // Closed and opened again, the field is empty and the channel is still the one last posted to.
    await field().setValue("あとで");
    await $("#thread-slack").click();
    await $("#thread-slack").click();
    await expect(field()).toHaveValue("");
    await expect(channelButton()).toHaveText("#random");
  });

  it("posts with Cmd+Enter, and a blank text is not sent", async () => {
    await openPane();
    await openList();
    await pick(0);
    const post = await mock("slack_channel_post", true);
    await field().setValue("  \n ");
    await expect(send()).toBeDisabled();
    await browser.keys(["Meta", "Enter"]);
    await field().setValue("一行目");
    await browser.keys(["Enter", "二行目"]);
    await browser.keys(["Meta", "Enter"]);
    expect(await waitForCalls(post)).toEqual([{ teamId: "T1", channel: "C1", text: "一行目\n二行目" }]);
  });

  it("shows the error in a card and keeps the text when the post fails, and the card stays while the text is typed", async () => {
    await openPane();
    await openList();
    await pick(0);
    const post = await mock("slack_channel_post", rejects("channel_not_found"));
    await field().setValue("送れない文");
    await send().click();
    await waitForCalls(post);
    await expect($(CARD)).toHaveText("投稿できませんでした: channel_not_found");
    await expect(field()).toHaveValue("送れない文");
    await expect(send()).toBeEnabled();
    await expect(channelButton()).toHaveText("#general");
    await field().addValue("！");
    await expect($(CARD)).toHaveText("投稿できませんでした: channel_not_found");
  });

  it("names the channel in the card when the pane was closed before the post failed, and keeps the text", async () => {
    await openPane();
    await openList();
    await pick(0);
    const post = await mock("slack_channel_post", holds);
    await field().setValue("閉じても残る文");
    await send().click();
    await waitForCalls(post);
    await $("#thread-slack").click();
    await expect($("#mail-slack")).not.toBeDisplayed();
    await release(post, rejects("channel_not_found"));
    await waitForCard("#general に投稿できませんでした: channel_not_found");
    await expect(field()).toHaveValue("閉じても残る文");
  });

  it("empties the field when another mail is opened, and the pane stays open", async () => {
    await openPane();
    await openList();
    await pick(0);
    const post = await mock("slack_channel_post", rejects("channel_not_found"));
    await field().setValue("前のメールの文");
    await send().click();
    await waitForCalls(post);
    await waitForCard("投稿できませんでした: channel_not_found");
    await $("#back").click();
    await waitForCount("#unread-threads li", 2);
    await mock("thread", threadDetail("Second unread", "Hello from Bob", false));
    await rowOf("unread-threads", "Second unread").$(".subject").click();
    await expect($("#thread-subject")).toHaveText("Second unread");
    await threadLoaded();
    await expect($("#mail-slack")).toBeDisplayed();
    await expect(field()).toHaveValue("");
    await expect(channelButton()).toHaveText("#general");
  });

  it("turns the field, the channel button and the send off while the post is on its way, so that nothing is posted twice", async () => {
    await openPane();
    await openList();
    await pick(0);
    const post = await mock("slack_channel_post", holds);
    await field().setValue("一度だけ");
    await send().click();
    await waitForCalls(post);
    await expect(field()).toBeDisabled();
    await expect(send()).toBeDisabled();
    await expect(channelButton()).toBeDisabled();
    await release(post, true);
    await expect(field()).toHaveValue("");
    await expect(field()).toBeEnabled();
    expect(await callsOf(post)).toHaveLength(1);
  });
});
