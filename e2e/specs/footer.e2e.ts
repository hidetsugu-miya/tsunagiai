import type { AiUsage } from "../../ts/bindings/AiUsage";
import type { MachineResources } from "../../ts/bindings/MachineResources";
import type { MachineUsage } from "../../ts/bindings/MachineUsage";
import { account, boot, callsOf, claudeReady, holds, inbox, mock, onceId, rejects, release, slackLoad, slackThread, slackTs, textsOf, thread, threadDetail, threadLoaded, threadMessage, timeline, timelineMessage, timers, waitForCalls, waitForCount, waitForText, weekOfToday, workspace, CARD } from "../support";

// `unread` unread messages of the Slack list, each in a channel of its own.
const heap = (unread: number) => Array.from({ length: unread }, (_, i) => timelineMessage(slackTs(i + 1, i), `Person ${i}`, "dev", `unread ${i}`, { unread: true, channel: `C${i}` }));
const label = () => browser.execute(() => document.getElementById("footer-bell")!.getAttribute("aria-label"));
// Where the footer and the bell are: against the window's bottom, the icon column's right edge, and the footer's right edge.
const places = () =>
  browser.execute(() => {
    const f = document.getElementById("footer")!.getBoundingClientRect();
    const b = document.getElementById("footer-bell")!.getBoundingClientRect();
    return { bottom: Math.round(innerHeight - f.bottom), left: Math.round(f.left - document.getElementById("sidebar")!.getBoundingClientRect().right), height: Math.round(f.height), bell: Math.round(f.right - b.right) };
  });

describe("footer", () => {
  // Two unread mails (the default inbox) and three unread Slack messages.
  const start = (slack = timeline(heap(3), { refreshSecs: 1 })) => boot({ inbox: inbox(), slack_load: slackLoad, slack_timeline: slack, claude_status: claudeReady, calendar_week: weekOfToday() });

  it("shows the sum of the unread mail and the unread Slack messages on the bell, with the sum in its label", async () => {
    await start();
    await waitForText("#footer-bell .footer-count", "5");
    await expect($("#footer-bell .footer-count")).toBeDisplayed();
    expect(await label()).toBe("通知（未読 5 件）");
    // The sidebar's own counts are the two that it sums.
    await expect($("#nav-mail .nav-count")).toHaveText("2");
    await expect($("#nav-slack .nav-count")).toHaveText("3");
  });

  it("is a low band at the bottom of the window, to the right of the icon column, with the bell at its right end, on every screen", async () => {
    await start();
    await waitForCount("#unread-threads li", 2);
    for (const nav of ["#nav-mail", "#nav-calendar", "#nav-todo", "#nav-settings", "#nav-slack"]) {
      await $(nav).click();
      await expect($("#footer")).toBeDisplayed();
      await expect($("#footer-bell")).toBeDisplayed();
      const p = await places();
      expect(p.bottom).toBe(0);
      expect(p.left).toBe(0);
      expect(p.height).toBeLessThan(40);
      expect(p.bell).toBeLessThan(24);
    }
  });

  it("keeps the footer and the bell with no number for 0 unread", async () => {
    await boot({ inbox: inbox([thread("t3", "Already read", false)]), slack_load: slackLoad, slack_timeline: timeline([timelineMessage(slackTs(1), "Person", "dev", "read")]), claude_status: claudeReady });
    await waitForCalls("slack_timeline");
    await waitForCount("#read-threads li", 1);
    await browser.pause(300);
    await expect($("#footer")).toBeDisplayed();
    await expect($("#footer-bell")).toBeDisplayed();
    await expect($("#footer-bell .footer-count")).not.toBeDisplayed();
    expect(await label()).toBe("通知");
  });

  it("shows the tooltip of a footer control above it, because the footer is at the window's bottom edge", async () => {
    await start();
    await waitForText("#footer-bell .footer-count", "5");
    // The window has no pointer to put over the control (`:hover` is not met), so the mouseover that the tooltip listens for is dispatched, once.
    await browser.execute((once) => window.__e2e_once__(once) && document.getElementById("footer-bell")!.dispatchEvent(new MouseEvent("mouseover", { bubbles: true })), onceId());
    await expect($(".tooltip")).toBeDisplayed();
    const where = await browser.execute(() => ({ tip: document.querySelector(".tooltip")!.getBoundingClientRect().bottom, target: document.getElementById("footer-bell")!.getBoundingClientRect().top }));
    expect(where.tip).toBeLessThanOrEqual(where.target);
    await browser.execute((once) => window.__e2e_once__(once) && document.getElementById("footer-bell")!.dispatchEvent(new MouseEvent("mouseout", { bubbles: true })), onceId());
    await expect($(".tooltip")).not.toBeDisplayed();
  });

  it("draws the sum again when the Slack count changes", async () => {
    await start();
    await waitForText("#footer-bell .footer-count", "5");
    await mock("slack_timeline", timeline(heap(1), { refreshSecs: 1 }));
    await waitForText("#footer-bell .footer-count", "3");
    expect(await label()).toBe("通知（未読 3 件）");
    await mock("slack_timeline", timeline([], { refreshSecs: 1 }));
    await waitForText("#footer-bell .footer-count", "2");
    expect(await textsOf("#footer-bell .footer-count")).toEqual(["2"]);
  });

  it("shows 99+ from 100, with the real sum in the label, and the Slack count above 20 at its real number", async () => {
    await start(timeline(heap(3), { unreadTotal: 120 }));
    await waitForText("#footer-bell .footer-count", "99+");
    expect(await label()).toBe("通知（未読 122 件）");
    await expect($("#nav-slack .nav-count")).toHaveText("20+");
  });

  describe("the pane of the unread", () => {
    // Two unread mails and two unread Slack messages, 2, 4, 6 and 8 minutes old, mixed.
    const mail = (id: string, subject: string, minutes: number) => ({ ...thread(id, subject, true), dateMs: Date.now() - minutes * 60_000 });
    const slackAt = (minutes: number, name: string, text: string) => timelineMessage(slackTs(minutes), name, "dev", text, { unread: true });
    const lines = () => textsOf("#unread-pane-list li .unread-line");
    // A mail's line is its subject and then its snippet (the fixture's snippet is the subject and " snippet").
    const mailLine = (subject: string) => `${subject} — ${subject} snippet`;
    const panes = (slack = timeline([slackAt(4, "Slack Second", "second text"), slackAt(8, "Slack Oldest", "oldest text")], { refreshSecs: 1 })) =>
      boot({ inbox: inbox([mail("t1", "Mail newest", 2), mail("t2", "Mail third", 6)]), slack_load: slackLoad, slack_timeline: slack, claude_status: claudeReady, calendar_week: weekOfToday() });
    const open = async () => {
      await waitForText("#footer-bell .footer-count", "4");
      await $("#footer-bell").click();
      await expect($("#unread-pane")).toBeDisplayed();
    };

    it("opens from the bell over the screen, above the footer and at the right, with the heading 未読 and the count", async () => {
      await panes();
      await expect($("#unread-pane")).not.toBeDisplayed();
      await open();
      await expect($("#unread-pane-title")).toHaveText("未読 4");
      await expect($("#footer-bell")).toHaveAttribute("aria-expanded", "true");
      const place = await browser.execute(() => {
        const p = document.getElementById("unread-pane")!.getBoundingClientRect();
        const f = document.getElementById("footer")!.getBoundingClientRect();
        return { width: Math.round(p.width), right: Math.round(innerWidth - p.right), above: Math.round(f.top - p.bottom) };
      });
      expect(place).toEqual({ width: 380, right: 0, above: 0 });
    });

    it("mixes the unread mail and the unread Slack messages, the newest first, each row with its icon, avatar, name, channel, time and text", async () => {
      await panes();
      await open();
      await waitForCount("#unread-pane-list li", 4);
      expect(await lines()).toEqual([mailLine("Mail newest"), "second text", mailLine("Mail third"), "oldest text"]);
      expect(await browser.execute(() => [...document.querySelectorAll<HTMLElement>("#unread-pane-list li")].map((li) => li.dataset.kind))).toEqual(["mail", "slack", "mail", "slack"]);
      const slack = $$("#unread-pane-list li")[1];
      await expect(slack.$(".unread-kind svg")).toBeDisplayed();
      await expect(slack.$(".avatar")).toBeDisplayed();
      await expect(slack.$("b")).toHaveText("Slack Second");
      await expect(slack.$(".unread-channel")).toHaveText("#dev");
      expect((await slack.$(".unread-time").getText()).length).toBeGreaterThan(0);
      const first = $$("#unread-pane-list li")[0];
      await expect(first.$("b")).toHaveText("Alice");
      await expect(first.$(".unread-channel")).not.toExist();
      expect(await textsOf("#unread-pane-list li .text-btn")).toEqual(["詳細を開く", "スレッドを開く", "詳細を開く", "スレッドを開く"]);
    });

    it("shows a mail's subject and snippet and a Slack message's text up to 3 lines, and cuts what passes them", async () => {
      const long = Array.from({ length: 40 }, (_, i) => `word${i}`).join(" ");
      const broken = "one\ntwo\nthree\nfour\nfive";
      const longMail = { ...mail("t2", "Long mail", 6), snippet: long };
      await boot({
        inbox: inbox([mail("t1", "Mail newest", 2), longMail]),
        slack_load: slackLoad,
        slack_timeline: timeline([slackAt(4, "Slack Long", long), slackAt(8, "Slack Short", "short"), slackAt(10, "Slack Broken", broken)], { refreshSecs: 1 }),
        claude_status: claudeReady,
        calendar_week: weekOfToday(),
      });
      await waitForText("#footer-bell .footer-count", "5");
      await $("#footer-bell").click();
      await waitForCount("#unread-pane-list li", 5);
      const shape = await browser.execute(() =>
        [...document.querySelectorAll<HTMLElement>("#unread-pane-list li .unread-line")].map((e) => ({
          text: e.textContent,
          height: e.clientHeight,
          clipped: e.scrollHeight > e.clientHeight + 1,
          clamp: getComputedStyle(e).getPropertyValue("-webkit-line-clamp"),
        })),
      );
      // The whole text is in the line: the mail's subject and its snippet, the message's text with its line breaks.
      expect(shape.map((r) => r.text)).toEqual([mailLine("Mail newest"), long, `Long mail — ${long}`, "short", broken]);
      for (const r of shape) expect(r.clamp).toBe("3");
      // A one-line text is not cut, and what passes three lines is cut to the height of three: a long text, a mail's long snippet and a text of five lines.
      const one = shape[3];
      expect(one.clipped).toBe(false);
      expect(shape[0].clipped).toBe(false);
      for (const i of [1, 2, 4]) {
        expect(shape[i].clipped).toBe(true);
        expect(Math.abs(shape[i].height - one.height * 3)).toBeLessThanOrEqual(3);
      }
    });

    it("closes with the bell again, with the close button, and with a press outside the pane", async () => {
      await panes();
      await open();
      await $("#footer-bell").click();
      await expect($("#unread-pane")).not.toBeDisplayed();
      await expect($("#footer-bell")).toHaveAttribute("aria-expanded", "false");
      await $("#footer-bell").click();
      await expect($("#unread-pane")).toBeDisplayed();
      await $('#unread-pane button[aria-label="閉じる"]').click();
      await expect($("#unread-pane")).not.toBeDisplayed();
      await $("#footer-bell").click();
      await expect($("#unread-pane")).toBeDisplayed();
      await $("#footer").click({ x: -200 });
      await expect($("#unread-pane")).not.toBeDisplayed();
    });

    describe("when the count of the footer reaches 0", () => {
      // One unread mail, and `slack` for the Slack list (empty unless given).
      const fewer = (slack = timeline([], { refreshSecs: 1 })) => boot({ inbox: inbox([mail("t1", "Mail only", 2)]), slack_load: slackLoad, slack_timeline: slack, claude_status: claudeReady, calendar_week: weekOfToday() });
      const slackOnly = () => timeline([timelineMessage(slackTs(4), "Slack Only", "dev", "only text", { unread: true })], { refreshSecs: 1 });
      const openAt = async (n: string) => {
        await waitForText("#footer-bell .footer-count", n);
        await $("#footer-bell").click();
        await expect($("#unread-pane")).toBeDisplayed();
        await waitForCount("#unread-pane-list li", Number(n));
      };

      it("closes the pane when the last row is cleared with a button of the row, and 元に戻す does not open it again", async () => {
        await fewer();
        await openAt("1");
        const trash = await mock("trash", true);
        const untrash = await mock("untrash", true);
        const row = $$("#unread-pane-list li")[0];
        await row.moveTo();
        await row.$('button[aria-label="ゴミ箱へ移動"]').click();
        expect(await waitForCalls(trash)).toEqual([{ account, id: "t1" }]);
        await expect($("#unread-pane")).not.toBeDisplayed();
        await expect($("#footer-bell")).toHaveAttribute("aria-expanded", "false");
        await expect($("#footer-bell .footer-count")).not.toBeDisplayed();
        await $(".toast button").click();
        expect(await waitForCalls(untrash)).toEqual([{ account, id: "t1" }]);
        await waitForText("#footer-bell .footer-count", "1");
        await expect($("#unread-pane")).not.toBeDisplayed();
      });

      it("closes the pane when the count falls to 0 for a reason outside it", async () => {
        await fewer(slackOnly());
        await openAt("2");
        // The Slack message is read in Slack: the count falls, but not to 0.
        await mock("slack_timeline", timeline([], { refreshSecs: 1 }));
        await waitForText("#footer-bell .footer-count", "1");
        await expect($("#unread-pane")).toBeDisplayed();
        // The mail is read on the list: the count reaches 0. set_read answers, or the row goes back and so does the count.
        const setRead = await mock("set_read", true);
        await browser.execute(() => document.querySelector<HTMLInputElement>("#unread-threads .read-box")!.click());
        expect(await waitForCalls(setRead)).toEqual([{ account, id: "t1", read: true }]);
        await expect($("#unread-pane")).not.toBeDisplayed();
      });

      it("keeps the pane open when an operation leaves the count above 0", async () => {
        await fewer(slackOnly());
        await openAt("2");
        const trash = await mock("trash", true);
        // The mail is 2 minutes old and the Slack message 4, so the mail is the first row.
        const mailRow = $$("#unread-pane-list li")[0];
        await mailRow.moveTo();
        await mailRow.$('button[aria-label="ゴミ箱へ移動"]').click();
        expect(await waitForCalls(trash)).toEqual([{ account, id: "t1" }]);
        await waitForText("#footer-bell .footer-count", "1");
        await browser.pause(300);
        await expect($("#unread-pane")).toBeDisplayed();
      });

      it("keeps the pane open with no rows when ウォッチ takes the last row and the count stays above 0", async () => {
        const only = timelineMessage(slackTs(4), "Slack Only", "dev", "only text", { unread: true, channel: "C1" });
        await boot({ inbox: inbox([thread("t3", "Already read", false)]), slack_load: slackLoad, slack_timeline: timeline([only], { refreshSecs: 1 }), claude_status: claudeReady, calendar_week: weekOfToday() });
        await openAt("1");
        const watch = await mock("slack_watch", holds);
        await mock("slack_timeline", timeline([], { unreadTotal: 1 }));
        const row = $$("#unread-pane-list li")[0];
        await row.moveTo();
        await row.$('button[aria-label="ウォッチ"]').click();
        expect(await waitForCalls(watch)).toEqual([{ teamId: workspace.teamId, channel: "C1", ts: slackTs(4) }]);
        await waitForCount("#unread-pane-list li", 0);
        await release(watch, true);
        await waitForCalls("slack_timeline");
        await expect($("#unread-pane-title")).toHaveText("未読 1");
        await expect($("#unread-pane")).toBeDisplayed();
      });

      it("leaves the pane open when the bell opens it at 0", async () => {
        await boot({ inbox: inbox([thread("t3", "Already read", false)]), slack_load: slackLoad, slack_timeline: timeline([]), claude_status: claudeReady, calendar_week: weekOfToday() });
        await waitForCount("#read-threads li", 1);
        await $("#footer-bell").click();
        await expect($("#unread-pane")).toBeDisplayed();
        await expect($("#unread-pane-title")).toHaveText("未読 0");
        await browser.pause(300);
        await expect($("#unread-pane")).toBeDisplayed();
      });
    });

    it("opens the thread of a mail with 詳細を開く as pressing its row does, and closes", async () => {
      await panes();
      await open();
      const detail = await mock("thread", threadDetail("Mail third", "Hello", true));
      await mock("set_read", true);
      await $$("#unread-pane-list li")[2].$("button=詳細を開く").click();
      await expect($("#thread")).toBeDisplayed();
      await expect($("#thread-subject")).toHaveText("Mail third");
      await threadLoaded();
      expect(await callsOf(detail)).toEqual([{ account, id: "t2" }]);
      await expect($("#unread-pane")).not.toBeDisplayed();
    });

    it("opens the thread of a Slack message with スレッドを開く as pressing its row does: it is read and the Slack button is current", async () => {
      await panes();
      await open();
      const second = slackTs(4);
      const read = await mock("slack_mark_read", true);
      const opened = await mock("slack_thread", slackThread([threadMessage(second, "Slack Second", "second text")]));
      await $$("#unread-pane-list li")[1].$("button=スレッドを開く").click();
      await expect($("#slack-thread")).toBeDisplayed();
      await expect($("#nav-slack")).toHaveAttribute("aria-current", "page");
      expect(await waitForCalls(opened)).toEqual([{ teamId: workspace.teamId, channel: "C0123ABCD", ts: second }]);
      expect(await waitForCalls(read)).toEqual([{ teamId: workspace.teamId, channel: "C0123ABCD", ts: second }]);
      await expect($("#unread-pane")).not.toBeDisplayed();
    });

    it("draws the open pane again where the Slack list or the inbox changes", async () => {
      await panes();
      await open();
      await waitForCount("#unread-pane-list li", 4);
      // A new unread Slack message arrives.
      await mock("slack_timeline", timeline([slackAt(1, "Slack Fresh", "fresh text"), slackAt(4, "Slack Second", "second text"), slackAt(8, "Slack Oldest", "oldest text")], { refreshSecs: 1 }));
      await waitForCount("#unread-pane-list li", 5);
      expect((await lines())[0]).toBe("fresh text");
      await expect($("#unread-pane-title")).toHaveText("未読 5");
      // The Slack list is read in Slack: the messages go.
      await mock("slack_timeline", timeline([], { refreshSecs: 1 }));
      await waitForCount("#unread-pane-list li", 2);
      expect(await lines()).toEqual([mailLine("Mail newest"), mailLine("Mail third")]);
      await expect($("#unread-pane-title")).toHaveText("未読 2");
      // A mail is made read in the inbox.
      await mock("set_read", true);
      await browser.execute(() => document.querySelector<HTMLInputElement>("#unread-threads .read-box")!.click());
      await waitForCount("#unread-pane-list li", 1);
      expect(await lines()).toEqual([mailLine("Mail third")]);
      await expect($("#unread-pane-title")).toHaveText("未読 1");
      expect(await textsOf("#unread-pane-list li b")).toEqual(["Alice"]);
    });

    describe("the buttons of a row", () => {
      // Mail newest (t1, 2 minutes), Slack A (4, channel C1), Mail third (t2, 6), Slack B (8, channel C2): each Slack message has a channel of its own, so that reading one reads no other.
      const slackIn = (minutes: number, channel: string, name: string, text: string) => timelineMessage(slackTs(minutes), name, "dev", text, { unread: true, channel });
      const slackA = () => slackIn(4, "C1", "Slack A", "text A");
      const slackB = () => slackIn(8, "C2", "Slack B", "text B");
      const lackingWrite = [{ teamId: workspace.teamId, team: workspace.team, scopes: ["channels:write"] }];
      const rowAt = (i: number) => $$("#unread-pane-list li")[i];
      const labelsOf = (i: number) => browser.execute((n) => [...document.querySelectorAll("#unread-pane-list li")[n].querySelectorAll(".unread-actions .icon-btn")].map((b) => b.getAttribute("aria-label")), i);
      const visibility = (i: number) => browser.execute((n) => getComputedStyle(document.querySelectorAll("#unread-pane-list li")[n].querySelector(".unread-actions .icon-btn")!).visibility, i);
      const pressed = async (i: number, label: string) => {
        await rowAt(i).moveTo();
        await rowAt(i).$(`button[aria-label="${label}"]`).click();
      };
      const start = async (slack = timeline([slackA(), slackB()])) => {
        await panes(slack);
        await open();
        await waitForCount("#unread-pane-list li", 4);
      };

      // :hover and :focus never match in the E2E window (the driver dispatches pointer events from JS and the window is hidden): the hidden state is the computed style, and the rule that shows the buttons is read from the stylesheet to say that the pointer or the focus in the row lifts it.
      it("draws a mail's trash and archive and a Slack message's 既読にする and ウォッチ, hidden until the pointer or the focus is in the row", async () => {
        await start();
        expect(await labelsOf(0)).toEqual(["ゴミ箱へ移動", "アーカイブ"]);
        expect(await labelsOf(1)).toEqual(["既読にする", "ウォッチ"]);
        expect(await visibility(0)).toBe("hidden");
        expect(await visibility(1)).toBe("hidden");
        const showing = await browser.execute(() => {
          for (const sheet of document.styleSheets)
            for (const rule of sheet.cssRules)
              if (rule instanceof CSSStyleRule && rule.selectorText.includes(".unread-actions .icon-btn") && rule.style.visibility === "visible") return rule.selectorText;
          return null;
        });
        expect(showing).toContain(".unread-item:hover");
        expect(showing).toContain(".unread-item:focus-within");
      });

      it("draws no 既読にする for a Slack message when the token cannot write the position, as the popup has none", async () => {
        await start(timeline([slackA(), slackB()], { missing: lackingWrite }));
        expect(await labelsOf(1)).toEqual(["ウォッチ"]);
        expect(await labelsOf(3)).toEqual(["ウォッチ"]);
        expect(await labelsOf(0)).toEqual(["ゴミ箱へ移動", "アーカイブ"]);
      });

      it("trashes a mail with the list's command: the row and the count go at once, no thread opens, and 元に戻す brings it back through untrash", async () => {
        await start();
        const trash = await mock("trash", true);
        const untrash = await mock("untrash", true);
        await pressed(0, "ゴミ箱へ移動");
        expect(await waitForCalls(trash)).toEqual([{ account, id: "t1" }]);
        await waitForCount("#unread-pane-list li", 3);
        expect(await lines()).toEqual(["text A", mailLine("Mail third"), "text B"]);
        await expect($("#unread-pane-title")).toHaveText("未読 3");
        await waitForText("#footer-bell .footer-count", "3");
        await expect($("#unread-pane")).toBeDisplayed();
        await expect($("#thread")).not.toBeDisplayed();
        await expect($(".toast")).toHaveText(expect.stringContaining("ゴミ箱へ移動しました"));
        await expect($(".toast button")).toHaveText("元に戻す");
        // A press on the notice's button is not a press outside the pane: the pane stays open.
        await browser.execute(() => document.querySelector(".toast button")!.dispatchEvent(new MouseEvent("mousedown", { bubbles: true })));
        await expect($("#unread-pane")).toBeDisplayed();
        await $(".toast button").click();
        expect(await waitForCalls(untrash)).toEqual([{ account, id: "t1" }]);
        await waitForCount("#unread-pane-list li", 4);
        expect((await lines())[0]).toBe(mailLine("Mail newest"));
        await expect($("#unread-pane-title")).toHaveText("未読 4");
      });

      it("archives a mail with the list's command, and offers 元に戻す", async () => {
        await start();
        const archive = await mock("archive", true);
        await pressed(2, "アーカイブ");
        expect(await waitForCalls(archive)).toEqual([{ account, id: "t2" }]);
        await waitForCount("#unread-pane-list li", 3);
        expect(await lines()).toEqual([mailLine("Mail newest"), "text A", "text B"]);
        await expect($("#unread-pane-title")).toHaveText("未読 3");
        await waitForText("#footer-bell .footer-count", "3");
        await expect($(".toast")).toHaveText(expect.stringContaining("アーカイブしました"));
        await expect($(".toast button")).toHaveText("元に戻す");
      });

      it("puts the mail back in the pane and the count, and says so, when trash fails", async () => {
        await start();
        await mock("trash", rejects("失敗しました"));
        await pressed(0, "ゴミ箱へ移動");
        await waitForCalls("trash");
        await expect($(CARD)).toHaveText(expect.stringContaining("失敗しました"));
        await waitForCount("#unread-pane-list li", 4);
        expect((await lines())[0]).toBe(mailLine("Mail newest"));
        await expect($("#unread-pane-title")).toHaveText("未読 4");
        await waitForText("#footer-bell .footer-count", "4");
      });

      it("reads a Slack message with 既読にする as the popup's check does: slack_mark_read is called, and the row and the count go without opening a thread", async () => {
        await start();
        const mark = await mock("slack_mark_read", true);
        await mock("slack_timeline", timeline([slackB()]));
        await pressed(1, "既読にする");
        expect(await waitForCalls(mark)).toEqual([{ teamId: workspace.teamId, channel: "C1", ts: slackTs(4) }]);
        await waitForCount("#unread-pane-list li", 3);
        expect(await lines()).toEqual([mailLine("Mail newest"), mailLine("Mail third"), "text B"]);
        await expect($("#unread-pane-title")).toHaveText("未読 3");
        await waitForText("#footer-bell .footer-count", "3");
        await expect($("#unread-pane")).toBeDisplayed();
        await expect($("#slack-thread")).not.toBeDisplayed();
      });

      it("puts the Slack message back, with the list made again from Rust's cache, and says so, when slack_mark_read fails", async () => {
        await start();
        await mock("slack_mark_read", rejects("失敗しました"));
        const fresh = await mock("slack_timeline", timeline([slackA(), slackB()]));
        await pressed(1, "既読にする");
        await expect($(CARD)).toHaveText(expect.stringContaining("既読を Slack に送れませんでした"));
        expect(await waitForCalls(fresh)).toEqual([{ cached: true }]);
        await waitForCount("#unread-pane-list li", 4);
        await expect($("#unread-pane-title")).toHaveText("未読 4");
      });

      it("watches the thread of a Slack message with ウォッチ as the popup does: slack_watch is called with the thread's ts, and the row goes at once and the count stays, without opening a thread", async () => {
        await start();
        const watch = await mock("slack_watch", holds);
        const mark = await mock("slack_mark_read", true);
        await mock("slack_timeline", timeline([slackB()], { unreadTotal: 2 }));
        await pressed(1, "ウォッチ");
        expect(await waitForCalls(watch)).toEqual([{ teamId: workspace.teamId, channel: "C1", ts: slackTs(4) }]);
        await waitForCount("#unread-pane-list li", 3);
        expect(await lines()).toEqual([mailLine("Mail newest"), mailLine("Mail third"), "text B"]);
        await expect($("#unread-pane-title")).toHaveText("未読 4");
        await expect($("#slack-thread")).not.toBeDisplayed();
        expect(await callsOf(mark)).toEqual([]);
        await release(watch, true);
        await waitForCalls("slack_timeline");
        await expect($("#unread-pane-title")).toHaveText("未読 4");
        await waitForText("#footer-bell .footer-count", "4");
      });
    });
  });
});

describe("footer: the resources (A-48)", () => {
  const reset = new Date(2026, 10, 27, 11, 0).getTime();
  const machine = (name: string, extra: Partial<MachineResources> = {}): MachineResources => ({ environment: null, name, cpuPercent: 38, loadAverage: 4.52, cores: 12, memoryPercent: 10, usedBytes: 6871947674, totalBytes: 68719476736, error: null, ...extra });
  const saved = (name: string, extra: Partial<MachineResources> = {}) => machine(name, { environment: name, cpuPercent: 9, loadAverage: 1.56, cores: 18, memoryPercent: 11, ...extra });
  const ai = (status: string, session: number | null, weekly: number | null): AiUsage => ({
    status,
    session: session === null ? null : { usedPercent: session, resetsAt: reset },
    weekly: weekly === null ? null : { usedPercent: weekly, resetsAt: reset },
  });
  const usageOf = (environment: string | null, claude: AiUsage, antigravity: AiUsage): MachineUsage => ({ environment, name: environment ?? "この Mac", claude, antigravity });
  const idle = ai("idle", null, null);
  const start = (fixtures: Record<string, unknown> = {}) =>
    boot({ inbox: inbox(), slack_load: slackLoad, slack_timeline: timeline(heap(3), { refreshSecs: 1 }), claude_status: claudeReady, calendar_week: weekOfToday(), ...fixtures });
  // The two readings never come by themselves in a spec that does not shorten them: only the start and the opening of the pane read.
  const quiet = timers({ machineResources: 600_000, machineUsage: 600_000 });
  const stats = () => textsOf("#footer-stats .stat");
  const names = () => textsOf("#footer-stats .stat-name");
  // The pane as it is drawn: a line for each machine's heading, group heading and row (the texts of its parts).
  const pane = () =>
    browser.execute(() =>
      [...document.querySelectorAll("#resource-pane-list .res-machine")].map((section) =>
        [...section.querySelectorAll("h3, .res-group-name, .res-row")].map((n) => (n.matches(".res-row") ? [...n.children].map((c) => c.textContent).join(" ") : (n.textContent ?? ""))),
      ),
    );
  const open = async () => {
    await $("#footer-stats").click();
    await expect($("#resource-pane")).toBeDisplayed();
  };

  it("shows the CPU and the memory of each machine and the weekly of this Mac's Claude and Antigravity as numbers at the left of the footer, before the bell, with a dash where there is none", async () => {
    await start({ machine_resources: [machine("この Mac"), saved("PC 1")], machine_usage: [usageOf(null, ai("ok", 30, 74), idle), usageOf("PC 1", ai("ok", null, 12), ai("ok", 46, 93))], ...quiet });
    await waitForText("#footer-stats", "AG");
    expect(await names()).toEqual(["この Mac", "PC 1"]);
    expect(await stats()).toEqual(["CPU 38%", "メモリ 10%", "CPU 9%", "メモリ 11%", "Claude 74%", "AG —"]);
    const place = await browser.execute(() => {
      const s = document.getElementById("footer-stats")!.getBoundingClientRect();
      const b = document.getElementById("footer-bell")!.getBoundingClientRect();
      const f = document.getElementById("footer")!.getBoundingClientRect();
      return { atLeft: Math.round(s.left - f.left), beforeBell: s.right <= b.left };
    });
    expect(place.atLeft).toBeLessThan(24);
    expect(place.beforeBell).toBe(true);
  });

  it("draws a dash for a machine that gave nothing and for an AI whose status is not ok, and draws 80% and over in orange", async () => {
    await start({
      machine_resources: [machine("この Mac", { cpuPercent: 80, memoryPercent: 79 }), saved("PC 1", { cpuPercent: null, loadAverage: null, cores: null, memoryPercent: null, usedBytes: null, totalBytes: null, error: "unavailable" })],
      machine_usage: [usageOf(null, ai("error", null, 90), ai("ok", null, 100))],
      ...quiet,
    });
    await waitForText("#footer-stats", "AG");
    expect(await stats()).toEqual(["CPU 80%", "メモリ 79%", "CPU —", "メモリ —", "Claude —", "AG 100%"]);
    const colors = await browser.execute(() => [...document.querySelectorAll("#footer-stats .stat-num")].map((n) => getComputedStyle(n).color));
    const [hot, plain] = [colors[0], colors[1]];
    expect(hot).toBe("rgb(154, 91, 0)");
    expect(plain).not.toBe(hot);
    expect(colors.map((c) => c === hot)).toEqual([true, false, false, false, false, true]);
  });

  it("draws no AI before the first reading of the usage is back, and nothing when there is no machine", async () => {
    await start({ machine_usage: holds, ...quiet });
    await waitForText("#footer-stats", "CPU 38%");
    expect(await stats()).toEqual(["CPU 38%", "メモリ 10%"]);
    await boot({ machine_resources: [], ...quiet });
    await waitForCalls("machine_resources");
    await expect($("#footer-stats")).not.toBeDisplayed();
  });

  it("draws a name that comes from outside as text", async () => {
    await start({ machine_resources: [machine("<i>PC</i>")], ...quiet });
    await waitForText("#footer-stats", "CPU 38%");
    expect(await names()).toEqual(["<i>PC</i>"]);
    expect(await browser.execute(() => document.querySelectorAll("#footer-stats i:not(.stat-dot):not(.stat-sep)").length)).toBe(0);
  });

  it("opens the pane from the right, with the heading リソース, the same place and width as the pane of the unread, and the numbers of each machine under it", async () => {
    await start({ machine_resources: [machine("この Mac"), saved("PC 1", { cpuPercent: 85 })], machine_usage: [usageOf(null, ai("ok", null, 74), idle), usageOf("PC 1", ai("error", null, null), ai("ok", 46, 93))], ...quiet });
    await waitForText("#footer-stats", "AG");
    await expect($("#resource-pane")).not.toBeDisplayed();
    await open();
    await expect($("#resource-pane h2")).toHaveText("リソース");
    await expect($("#footer-stats")).toHaveAttribute("aria-expanded", "true");
    const place = await browser.execute(() => {
      const p = document.getElementById("resource-pane")!.getBoundingClientRect();
      const f = document.getElementById("footer")!.getBoundingClientRect();
      return { width: Math.round(p.width), right: Math.round(innerWidth - p.right), above: Math.round(f.top - p.bottom) };
    });
    expect(place).toEqual({ width: 380, right: 0, above: 0 });
    expect(await pane()).toEqual([
      ["この Mac", "CPU 38% 4.52 / 12 コア", "メモリ 10% 6.4 / 64 GB", "Claude", "weekly 74% 金 11:00 にリセット", "Antigravity", "weekly —"],
      ["PC 1", "CPU 85% 1.56 / 18 コア", "メモリ 11% 6.4 / 64 GB", "Claude", "weekly —", "Antigravity", "5 時間 46% 金 11:00 にリセット", "weekly 93% 金 11:00 にリセット"],
    ]);
    const hot = await browser.execute(() => [...document.querySelectorAll("#resource-pane-list .stat-num")].filter((n) => n.classList.contains("hot")).map((n) => n.textContent));
    expect(hot).toEqual(["85%", "93%"]);
  });

  it("draws a machine that gave nothing in the pane as dashes with no small text", async () => {
    await start({ machine_resources: [machine("この Mac", { cpuPercent: null, loadAverage: null, cores: null, memoryPercent: null, usedBytes: null, totalBytes: null, error: "unavailable" })], machine_usage: [usageOf(null, ai("unavailable", null, null), ai("unavailable", null, null))], ...quiet });
    await waitForText("#footer-stats", "AG");
    await open();
    expect(await pane()).toEqual([["この Mac", "CPU —", "メモリ —", "Claude", "weekly —", "Antigravity", "weekly —"]]);
  });

  it("closes the pane with the close button, with the button of the footer and with a press outside it", async () => {
    await start(quiet);
    await waitForText("#footer-stats", "CPU 38%");
    await open();
    await $("#resource-pane-close").click();
    await expect($("#resource-pane")).not.toBeDisplayed();
    await expect($("#footer-stats")).toHaveAttribute("aria-expanded", "false");
    await open();
    await $("#footer-stats").click();
    await expect($("#resource-pane")).not.toBeDisplayed();
    await open();
    await $("#footer").click({ x: 300 });
    await expect($("#resource-pane")).not.toBeDisplayed();
  });

  it("does not stand with the pane of the unread: opening one closes the other", async () => {
    await start(quiet);
    await waitForText("#footer-bell .footer-count", "5");
    await waitForText("#footer-stats", "CPU 38%");
    await open();
    await $("#footer-bell").click();
    await expect($("#unread-pane")).toBeDisplayed();
    await expect($("#resource-pane")).not.toBeDisplayed();
    await expect($("#footer-stats")).toHaveAttribute("aria-expanded", "false");
    await $("#footer-stats").click();
    await expect($("#resource-pane")).toBeDisplayed();
    await expect($("#unread-pane")).not.toBeDisplayed();
    await expect($("#footer-bell")).toHaveAttribute("aria-expanded", "false");
  });

  it("reads both commands at once when the pane is opened, and reads again by the period only", async () => {
    await start(quiet);
    await waitForText("#footer-stats", "CPU 38%");
    const resources = await mock("machine_resources", [machine("この Mac", { cpuPercent: 51 })]);
    const usage = await mock("machine_usage", [usageOf(null, ai("ok", null, 20), idle)]);
    await browser.pause(300);
    expect(await callsOf(resources)).toEqual([]);
    expect(await callsOf(usage)).toEqual([]);
    await open();
    await waitForCalls(resources);
    await waitForCalls(usage);
    expect(await callsOf(resources)).toHaveLength(1);
    expect(await callsOf(usage)).toHaveLength(1);
    await waitForText("#resource-pane-list", "51%");
    await waitForText("#footer-stats", "Claude 20%");
  });

  it("reads the load every period and the usage by its own, one reading at a time", async () => {
    await start(timers({ machineResources: 300, machineUsage: 700 }));
    await waitForText("#footer-stats", "Claude 74%");
    const resources = await mock("machine_resources", holds);
    const usage = await mock("machine_usage", [usageOf(null, ai("ok", null, 74), idle)]);
    await waitForCalls(resources);
    await waitForCalls(usage, 2);
    // The reading that is not back is not followed by another.
    await browser.pause(900);
    expect(await callsOf(resources)).toHaveLength(1);
    await release(resources, [machine("この Mac", { cpuPercent: 44 })]);
    await waitForText("#footer-stats", "CPU 44%");
    await waitForCalls(resources, 2);
  });

  it("reads nothing while the window is hidden, and reads again when it is shown", async () => {
    await start(timers({ machineResources: 300, machineUsage: 300 }));
    await waitForText("#footer-stats", "Claude 74%");
    await browser.execute(() => Object.defineProperty(document, "hidden", { get: () => true, configurable: true }));
    const resources = await mock("machine_resources", [machine("この Mac")]);
    const usage = await mock("machine_usage", [usageOf(null, idle, idle)]);
    await browser.pause(1000);
    expect(await callsOf(resources)).toEqual([]);
    expect(await callsOf(usage)).toEqual([]);
    await browser.execute(() => Object.defineProperty(document, "hidden", { get: () => false, configurable: true }));
    await waitForCalls(resources);
    await waitForCalls(usage);
  });

  it("draws the machines of the last reading only: a saved environment that left the list goes from the footer and from the open pane", async () => {
    await start({ machine_resources: [machine("この Mac"), saved("PC 1")], ...timers({ machineResources: 300 }) });
    await waitForText("#footer-stats", "PC 1");
    await open();
    expect((await pane()).map((s) => s[0])).toEqual(["この Mac", "PC 1"]);
    await mock("machine_resources", [machine("この Mac")]);
    await browser.waitUntil(async () => (await names()).length === 1);
    expect(await names()).toEqual(["この Mac"]);
    expect((await pane()).map((s) => s[0])).toEqual(["この Mac"]);
  });
});
