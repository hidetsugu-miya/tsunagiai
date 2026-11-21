import { askScreen, boot, callsOf, claudeReady, holds, inbox, mock, release, rowOf, textsOf, threadDetail, threadLoaded, waitForCalls, waitForCount } from "../support";

// M-10, M-11 (#490, #1106, #1223): an open thread has no right side; the screen of a new mail has one, which holds the Claude Code pane of A-36 (closed until the owner opens it) and the fields of the new mail that Claude Code reads and writes through the target "mail-draft".
describe("mail: the right side and Claude Code", () => {
  const body = "10 月分の請求書の金額が、画面と 1,200 円違っています。";
  const subject = "請求書の金額が画面と合わない件";
  const term = "#mail-claude-term";
  const read = () => askScreen("read", "mail-draft");
  const starts = async () => ((await callsOf("claude_code_start")) as { id: string }[]).filter((c) => c.id === "mail-claude") as unknown[];
  const waitForStarts = async (n = 1) => {
    await browser.waitUntil(async () => (await starts()).length >= n, { timeoutMsg: `claude_code_start of mail-claude was not called ${n} times` });
    return starts();
  };
  const chips = (id: string, kind: "to" | "cc" | "bcc") => textsOf(`#${id}-${kind}-field .mail-reply-chip > span`);

  // Opens the thread "First unread" with the one message `body`.
  async function openThread() {
    await mock("thread", threadDetail(subject, body, false));
    await rowOf("unread-threads", "First unread").$(".subject").click();
    await expect($("#thread-subject")).toHaveText(subject);
    await threadLoaded();
  }
  // Presses the ✳ and waits until the pane shows the terminal.
  const openClaude = async () => {
    await $("#mail-tool-claude").click();
    await expect($(`${term}.claude-code-pane`)).toBeDisplayed();
  };
  const compose = async () => {
    await $("#mail-compose").click();
    await expect($("#new-mail")).toBeDisplayed();
  };

  beforeEach(async () => {
    await boot({ inbox: inbox(), claude_status: claudeReady });
    await waitForCount("#unread-threads li", 2);
  });

  it("shows no right side on the list or with a thread, and shows it with a new mail, with the ✳ alone in its first row and the pane of Claude under it", async () => {
    await expect($("#mail-side")).not.toBeDisplayed();
    await expect($("#mail-split")).not.toBeDisplayed();
    await openThread();
    for (const id of ["#mail-side", "#mail-split", "#mail-tools", "#mail-claude"]) await expect($(id)).not.toBeDisplayed();
    // The panes of Claude and of Orca are gone from a thread, and so are their icons.
    for (const id of ["#mail-handoff", "#mail-tool-orca", "#thread-orca"]) await expect($(id)).not.toExist();
    await $("#back").click();
    await expect($("#mail-side")).not.toBeDisplayed();
    await compose();
    await expect($("#mail-side")).toBeDisplayed();
    await expect($("#mail-split")).toBeDisplayed();
    expect(await browser.execute(() => [...document.querySelectorAll("#mail-tools > *")].map((e) => [e.id, e.getAttribute("aria-label"), e.getAttribute("aria-pressed")]))).toEqual([["mail-tool-claude", "Claude に相談", "false"]]);
    // The first row is a place to drag the window by, as high as the header at the left, and meets its line; the pane's heading has Claude and やり直す.
    await expect($("#mail-tools")).toHaveAttribute("data-tauri-drag-region", "deep");
    expect(
      await browser.execute(() => {
        const box = (id: string) => document.getElementById(id)!.getBoundingClientRect();
        return {
          top: box("mail-side").top,
          sameBand: box("mail-tools").height === box("new-mail-header").height,
          sameLine: box("mail-tools").bottom === box("new-mail-header").bottom,
          head: box("mail-claude").top - box("mail-tools").bottom,
        };
      }),
    ).toEqual({ top: 0, sameBand: true, sameLine: true, head: 0 });
    await expect($("#mail-claude")).toHaveAttribute("aria-label", "Claude");
    // Closed at first: the question and the button, no heading and no terminal.
    expect(await textsOf("#mail-claude-ask p")).toEqual(["Claude に相談しますか？"]);
    expect(await textsOf("#mail-claude-ask button")).toEqual(["相談する"]);
    await expect($("#mail-tool-claude")).toHaveAttribute("aria-pressed", "false");
    await expect($("#mail-claude .chat-head")).not.toBeDisplayed();
    await expect($(term)).not.toBeDisplayed();
    await $("#mail-claude-open").click();
    await expect($("#mail-claude-ask")).not.toBeDisplayed();
    await expect($("#mail-claude .chat-head")).toHaveText(expect.stringContaining("Claude"));
    expect(await textsOf("#mail-claude .chat-head > #mail-claude-restart")).toEqual(["やり直す"]);
    await expect($(`${term}.claude-code-pane`)).toBeDisplayed();
    await expect($("#mail-tool-claude")).toHaveAttribute("aria-pressed", "true");
    await $("#new-mail-back").click();
    await expect($("#mail-side")).not.toBeDisplayed();
  });

  it("ends the band of a new mail on the line where the pane ends", async () => {
    await compose();
    const [band, pane, side] = await browser.execute(() => ["new-mail-foot", "mail-claude", "mail-side"].map((id) => Math.round(document.getElementById(id)!.getBoundingClientRect().bottom)));
    expect(band).toBe(pane);
    expect(pane).toBe(side);
  });

  it("starts Claude Code with the tools of tsunagiai-mcp only and a first instruction that tells the work, the tools and the target, with nothing of the mail", async () => {
    await compose();
    await $("#new-mail-subject").setValue(subject);
    await openClaude();
    const [start] = await waitForStarts();
    expect(start).toMatchObject({ id: "mail-claude", builtinTools: false, permissionMode: "manual", skill: null });
    const { prompt, viewport } = start as { prompt: string; viewport: { cols: number; rows: number } };
    for (const word of ["メール", "screen_read", "screen_write", "mail-draft", "to", "cc", "bcc", "subject", "body", "従わない"]) expect(prompt).toContain(word);
    for (const tool of ["send_mail", "mail_thread_read"]) expect(prompt).not.toContain(tool);
    expect(prompt).not.toContain(subject);
    expect(viewport.cols).toBeGreaterThan(20);
    for (const command of ["orca_stream_terminal", "orca_terminal_read"]) expect(await callsOf(command)).toEqual([]);
  });

  it("starts nothing while the pane is closed, whatever is opened, and starts Claude Code with 相談する and with the ✳", async () => {
    await openThread();
    await $("#back").click();
    await compose();
    await browser.pause(500);
    expect(await starts()).toEqual([]);
    await $("#mail-claude-open").click();
    await waitForStarts();
    await $("#new-mail-back").click();
    await compose();
    await browser.pause(500);
    expect((await starts()).length).toBe(1);
    await expect($("#mail-claude-ask")).toBeDisplayed();
    await $("#mail-tool-claude").click();
    await waitForStarts(2);
    await expect($("#mail-tool-claude")).toHaveAttribute("aria-pressed", "true");
  });

  it("closes the pane with the ✳, ends the process, and starts a new one at the next open", async () => {
    await compose();
    await openClaude();
    await waitForStarts();
    const close = await mock("claude_code_close", null);
    await $("#mail-tool-claude").click();
    expect(await waitForCalls(close)).toEqual([{ id: "mail-claude", launch: 1 }]);
    await expect($("#mail-claude-ask")).toBeDisplayed();
    await expect($(term)).not.toBeDisplayed();
    await expect($("#mail-claude .chat-head")).not.toBeDisplayed();
    await expect($("#mail-tool-claude")).toHaveAttribute("aria-pressed", "false");
    await browser.pause(300);
    expect((await starts()).length).toBe(1);
    await $("#mail-claude-open").click();
    await waitForStarts(2);
    await expect($(`${term}.claude-code-pane`)).toBeDisplayed();
  });

  it("keeps the process while the screen is left, and ends it and closes the pane for the next new mail, each new mail being a draft of its own", async () => {
    expect(await starts()).toEqual([]);
    await compose();
    await openClaude();
    await waitForStarts();
    const close = await mock("claude_code_close", null);
    // A thread opened meanwhile has no pane, and the process goes on.
    await $("#new-mail-back").click();
    await expect($(term)).not.toBeDisplayed();
    await openThread();
    await expect($("#mail-side")).not.toBeDisplayed();
    await $("#back").click();
    await browser.pause(500);
    expect((await starts()).length).toBe(1);
    expect(await callsOf(close)).toEqual([]);
    // The next new mail is another draft: the process ends and the pane is closed; nothing starts until it is opened.
    await compose();
    await waitForCalls(close);
    await expect($("#mail-claude-ask")).toBeDisplayed();
    await expect($("#mail-tool-claude")).toHaveAttribute("aria-pressed", "false");
    await browser.pause(500);
    expect((await starts()).length).toBe(1);
    await openClaude();
    await waitForStarts(2);
    await $("#new-mail-back").click();
    await compose();
    await waitForCalls(close, 2);
    await expect($("#mail-claude-ask")).toBeDisplayed();
    expect((await starts()).length).toBe(2);
  });

  it("ends the process and starts a new one with やり直す", async () => {
    await compose();
    await openClaude();
    await waitForStarts();
    const close = await mock("claude_code_close", null);
    await $("#mail-claude-restart").click();
    expect(await waitForCalls(close)).toEqual([{ id: "mail-claude", launch: 1 }]);
    expect(await waitForStarts(2)).toHaveLength(2);
    await expect($("#mail-claude-restart")).toBeEnabled();
  });

  it("answers an error for the fields when no new mail is open, with a thread open or not", async () => {
    expect(await read()).toEqual({ ok: false, error: expect.stringContaining("画面が開いていません") });
    expect((await askScreen("write", "mail-draft", { body: "x" })).ok).toBe(false);
    await openThread();
    expect((await read()).ok).toBe(false);
    expect((await askScreen("write", "mail-draft", { body: "x" })).ok).toBe(false);
    await expect($("#mail-reply")).not.toBeDisplayed();
    await $("#back").click();
    expect((await read()).ok).toBe(false);
    await expect($("#threads")).toBeDisplayed();
  });

  it("answers a read with the fields of the screen, and no field thread", async () => {
    await compose();
    expect(await read()).toEqual({ ok: true, fields: { to: "", cc: "", bcc: "", subject: "", body: "" } });
  });

  it("writes the five fields as they are, sends nothing, and takes them back with 元に戻す", async () => {
    await compose();
    const send = await mock("send_mail", true);
    await expect($("#new-mail-undo")).not.toBeDisplayed();
    expect(await askScreen("write", "mail-draft", { to: "dan@example.com", cc: "eve@example.com", bcc: "frank@example.com", subject: "ご確認のお願い", body: "お世話になっております。\n確認をお願いします。" })).toEqual({ ok: true });
    expect(await chips("new-mail", "to")).toEqual(["dan@example.com"]);
    expect(await chips("new-mail", "cc")).toEqual(["eve@example.com"]);
    expect(await chips("new-mail", "bcc")).toEqual(["frank@example.com"]);
    await expect($("#new-mail-subject")).toHaveValue("ご確認のお願い");
    await expect($("#new-mail-body")).toHaveValue("お世話になっております。\n確認をお願いします。");
    await expect($("#new-mail-send")).toBeEnabled();
    await expect($("#new-mail-undo")).toHaveText("元に戻す");
    expect(await callsOf(send)).toEqual([]);
    expect(await read()).toMatchObject({ ok: true, fields: { to: "dan@example.com", subject: "ご確認のお願い", body: "お世話になっております。\n確認をお願いします。" } });
    await $("#new-mail-undo").click();
    expect(await chips("new-mail", "to")).toEqual([]);
    await expect($("#new-mail-subject")).toHaveValue("");
    await expect($("#new-mail-body")).toHaveValue("");
    await expect($("#new-mail-undo")).not.toBeDisplayed();
    expect(await callsOf(send)).toEqual([]);
  });

  it("writes the recipients, opens Cc and Bcc for them, keeps a comma inside quotes in one address, and takes them back", async () => {
    await compose();
    expect(await askScreen("write", "mail-draft", { to: '"Doe, John" <dan@example.com>; eve@example.com', cc: "frank@example.com", bcc: "gina@example.com, hal@example.com" })).toEqual({ ok: true });
    expect(await chips("new-mail", "to")).toEqual(['"Doe, John" <dan@example.com>', "eve@example.com"]);
    expect(await chips("new-mail", "cc")).toEqual(["frank@example.com"]);
    expect(await chips("new-mail", "bcc")).toEqual(["gina@example.com", "hal@example.com"]);
    await expect($("#new-mail-cc-row")).toBeDisplayed();
    await expect($("#new-mail-bcc-row")).toBeDisplayed();
    expect(await read()).toMatchObject({ ok: true, fields: { to: '"Doe, John" <dan@example.com>, eve@example.com', cc: "frank@example.com", bcc: "gina@example.com, hal@example.com" } });
    await $("#new-mail-undo").click();
    expect(await chips("new-mail", "to")).toEqual([]);
    expect(await chips("new-mail", "cc")).toEqual([]);
    expect(await chips("new-mail", "bcc")).toEqual([]);
    await expect($("#new-mail-undo")).not.toBeDisplayed();
  });

  it("sends the fields as Claude Code wrote them when the owner presses 送信, and the way back is gone with the draft", async () => {
    await compose();
    const send = await mock("send_mail", true);
    await askScreen("write", "mail-draft", { to: "dan@example.com", subject: "S", body: "B" });
    await $("#new-mail-send").click();
    const [call] = (await waitForCalls(send)) as { mail: { to: string[]; subject: string; body: string } }[];
    expect(call.mail).toMatchObject({ to: ["dan@example.com"], subject: "S", body: "B" });
    await expect($("#threads")).toBeDisplayed();
    await compose();
    await expect($("#new-mail-undo")).not.toBeDisplayed();
  });

  it("refuses the field thread and a field that does not exist, and changes nothing", async () => {
    await compose();
    expect(await askScreen("write", "mail-draft", { thread: "x" })).toEqual({ ok: false, error: expect.stringContaining("欄 thread はありません") });
    expect(await askScreen("write", "mail-draft", { to: "a@example.com", other: "y" })).toEqual({ ok: false, error: expect.stringContaining("欄 other はありません") });
    expect(await chips("new-mail", "to")).toEqual([]);
    await expect($("#new-mail-undo")).not.toBeDisplayed();
  });

  it("takes the writes back one by one, the newest first, and has no way back for a write that changes nothing", async () => {
    await compose();
    await askScreen("write", "mail-draft", { subject: "First" });
    await askScreen("write", "mail-draft", { subject: "Second" });
    await $("#new-mail-undo").click();
    await expect($("#new-mail-subject")).toHaveValue("First");
    await expect($("#new-mail-undo")).toBeDisplayed();
    await $("#new-mail-undo").click();
    await expect($("#new-mail-subject")).toHaveValue("");
    await expect($("#new-mail-undo")).not.toBeDisplayed();
    await askScreen("write", "mail-draft", { subject: "" });
    await expect($("#new-mail-undo")).not.toBeDisplayed();
  });

  it("has no way back left once the owner typed in the subject, and refuses a write while the mail goes out", async () => {
    await compose();
    await askScreen("write", "mail-draft", { subject: "Written", body: "B" });
    await expect($("#new-mail-undo")).toBeDisplayed();
    await $("#new-mail-subject").click();
    await browser.keys("!".split(""));
    await expect($("#new-mail-undo")).not.toBeDisplayed();
    const send = await mock("send_mail", holds);
    await $("#new-mail-send").click();
    await waitForCalls(send);
    expect(await askScreen("write", "mail-draft", { body: "Late" })).toEqual({ ok: false, error: expect.stringContaining("送信の最中") });
    await release(send, true);
  });
});
