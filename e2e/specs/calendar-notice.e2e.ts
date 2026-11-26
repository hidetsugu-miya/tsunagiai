import type { EventNotice } from "../../ts/bindings/EventNotice";
import type { Week } from "../../ts/bindings/Week";
import { boot, callsOf, count, inbox, isoDate, meetUrl, mock, rfc, textsOf, timers, waitForCalls, weekOfToday } from "../support";

// C-8: the notice of an event before it starts. Which events are told of is Rust's (`calendar_notices`, checked by cargo test); the spec mocks its answer and checks what the screen asks and draws.

const TICK = 500;
const COUNT = "#nav-calendar .nav-count";
const NOTICE = "#error-cards .event-card";

// The week of today, with an ID and a start for each timed event: "Team sync" 10:00-11:00 has a Meet link, "Maybe lunch" has none.
function week(): Week {
  const w = weekOfToday();
  const today = isoDate(new Date());
  w.timed = w.timed.map((t, i) => ({ ...t, eventId: `e${i}`, calendarId: "c1", start: rfc(today, "10:00"), end: rfc(today, "11:00") }));
  return w;
}

const notice = (summary: string, over: Partial<EventNotice> = {}): EventNotice => ({
  event: week().timed.find((t) => t.summary === summary)!,
  minutes: 5,
  started: false,
  ...over,
});

const start = (answer: EventNotice[]) => boot({ inbox: inbox(), calendar_week: week(), calendar_notices: answer, ...timers({ calendarNotice: TICK }) });

// Waits the period of the clock times 1.2.
const tick = () => browser.pause(TICK * 1.2);

describe("calendar: notice of an event before it starts", () => {
  it("reads the week of today in the background and asks Rust about its timed events with the time", async () => {
    await start([]);
    const [read] = (await waitForCalls("calendar_week")) as { date: string; firstDay: number; refresh: boolean }[];
    expect(read).toEqual({ date: isoDate(new Date()), firstDay: 0, refresh: false });
    const [ask] = (await waitForCalls("calendar_notices")) as { events: unknown[]; nowMs: number }[];
    expect(ask.events).toEqual(week().timed);
    expect(Math.abs(ask.nowMs - Date.now())).toBeLessThan(60_000);
    await expect($(COUNT)).not.toBeDisplayed();
  });

  it("shows the number on the calendar button and a card at the bottom right, on a screen that is not the calendar", async () => {
    await start([notice("Team sync")]);
    await expect($(COUNT)).toHaveText("1");
    await expect($("#nav-calendar")).toHaveAttribute("aria-label", "カレンダー（予定 1 件）");
    await expect($(`${NOTICE} .event-card-when`)).toHaveText("5 分後 · 10:00–11:00");
    await expect($(`${NOTICE} .event-card-title`)).toHaveText("Team sync");
    expect(await textsOf(`${NOTICE} .event-card-actions .text-btn`)).toEqual(["参加", "予定を開く"]);
    await expect($(`${NOTICE} .error-card-close`)).toHaveAttribute("aria-label", "閉じる");
    await expect($(`${NOTICE} .event-card-join`)).toHaveAttribute("href", meetUrl);
    // The bar at the left is the color of the notice, not the red of a failure.
    const bar = await browser.execute(() => getComputedStyle(document.querySelector("#error-cards .event-card")!).borderLeftColor);
    expect(bar).toBe("rgb(26, 115, 232)");
    const place = await browser.execute(() => {
      const card = document.querySelector("#error-cards .event-card")!.getBoundingClientRect();
      return { right: window.innerWidth - card.right, belowMiddle: card.top > window.innerHeight / 2 };
    });
    expect(place).toEqual({ right: 16, belowMiddle: true });
  });

  it("has no 「参加」 for an event with no Meet link, and counts every card", async () => {
    await start([notice("Team sync"), notice("Maybe lunch", { minutes: 2 })]);
    await expect($(COUNT)).toHaveText("2");
    await expect($("#nav-calendar")).toHaveAttribute("aria-label", "カレンダー（予定 2 件）");
    await browser.waitUntil(async () => (await count(NOTICE)) === 2);
    expect(await textsOf(`${NOTICE} .event-card-join`)).toEqual(["参加"]);
    expect(await textsOf(`${NOTICE} .event-card-title`)).toEqual(["Maybe lunch", "Team sync"]);
  });

  it("draws the minutes again with the clock, and takes a card off when Rust no longer answers it", async () => {
    await start([notice("Team sync")]);
    await expect($(`${NOTICE} .event-card-when`)).toHaveText("5 分後 · 10:00–11:00");
    await mock("calendar_notices", [notice("Team sync", { minutes: 1 })]);
    await browser.waitUntil(async () => (await textsOf(`${NOTICE} .event-card-when`))[0] === "1 分後 · 10:00–11:00", { timeoutMsg: "the minutes were not drawn again" });
    await mock("calendar_notices", [notice("Team sync", { minutes: 3, started: true })]);
    await browser.waitUntil(async () => (await textsOf(`${NOTICE} .event-card-when`))[0] === "開始から 3 分 · 10:00–11:00");
    await mock("calendar_notices", [notice("Team sync", { minutes: 0, started: true })]);
    await browser.waitUntil(async () => (await textsOf(`${NOTICE} .event-card-when`))[0] === "開始 · 10:00–11:00");
    expect(await count(NOTICE)).toBe(1);
    await mock("calendar_notices", []);
    await browser.waitUntil(async () => (await count(NOTICE)) === 0, { timeoutMsg: "the card stayed" });
    await expect($(COUNT)).not.toBeDisplayed();
    await expect($("#nav-calendar")).toHaveAttribute("aria-label", "カレンダー");
  });

  it("takes the card off for good with the close button, which opens nothing", async () => {
    await start([notice("Team sync")]);
    await expect($(COUNT)).toHaveText("1");
    await $(`${NOTICE} .error-card-close`).click();
    await expect($(NOTICE)).not.toExist();
    await expect($(COUNT)).not.toBeDisplayed();
    await expect($("#calendar")).not.toBeDisplayed();
    // Rust still answers it, and the card does not come again.
    await tick();
    await tick();
    expect(await count(NOTICE)).toBe(0);
    await expect($(COUNT)).not.toBeDisplayed();
  });

  it("takes the card off for good with 「参加」, which is the link to the meeting", async () => {
    await start([notice("Team sync")]);
    await expect($(COUNT)).toHaveText("1");
    // The press follows the link in the app; the page keeps the window where it is.
    await browser.execute(() => document.addEventListener("click", (e) => (e.target as Element).closest("a")?.addEventListener("click", (c) => c.preventDefault(), { once: true }), true));
    await $(`${NOTICE} .event-card-join`).click();
    await expect($(NOTICE)).not.toExist();
    await expect($(COUNT)).not.toBeDisplayed();
    await tick();
    await tick();
    expect(await count(NOTICE)).toBe(0);
  });

  it("opens the week of today and the detail of the event with 「予定を開く」, and takes the card off for good", async () => {
    await start([notice("Team sync"), notice("Maybe lunch")]);
    await browser.waitUntil(async () => (await count(NOTICE)) === 2);
    const card = await $$(NOTICE).find(async (c) => (await c.$(".event-card-title").getText()) === "Team sync");
    await card!.$(".text-btn=予定を開く").click();
    await expect($("#calendar")).toBeDisplayed();
    await expect($(".cal-pop h2")).toHaveText("Team sync");
    await expect($(".cal-pop .meet-join")).toHaveAttribute("href", meetUrl);
    expect(await textsOf(`${NOTICE} .event-card-title`)).toEqual(["Maybe lunch"]);
    await expect($(COUNT)).toHaveText("1");
    await tick();
    await tick();
    expect(await textsOf(`${NOTICE} .event-card-title`)).toEqual(["Maybe lunch"]);
    const reads = (await callsOf("calendar_week")) as { date: string }[];
    expect(reads.some((r) => r.date === isoDate(new Date()))).toBe(true);
  });

  it("reads nothing while no account is left", async () => {
    await boot({ inbox: { ...inbox(), accounts: [], threads: [] }, calendar_week: week(), calendar_notices: [notice("Team sync")], ...timers({ calendarNotice: TICK }) });
    await tick();
    await tick();
    expect(await callsOf("calendar_week")).toEqual([]);
    expect(await callsOf("calendar_notices")).toEqual([]);
    expect(await count(NOTICE)).toBe(0);
    await expect($(COUNT)).not.toBeDisplayed();
  });
});
