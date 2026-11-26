// C-8: the notice of an event before it starts. The week of today is read in the background every 5 minutes, whatever screen is shown,
// and every minute Rust says which events are to be told of (`calendar_notices`); the sidebar's calendar button shows how many, and each is a card at the bottom right (the card of A-28 with its own color).
// What was pressed is kept in memory only, so after a restart the cards that still hold come again.
import type { EventNotice } from "./bindings/EventNotice";
import type { Week } from "./bindings/Week";
import { accountList } from "./accounts.js";
import { calendarFirstDay, openCalendarEvent } from "./calendar.js";
import { tag } from "./dom.js";
import { periodMs } from "./e2e-timers.js";
import { card, logError } from "./error-card.js";
import { addDays, hhmm, isoDate } from "./format.js";
import { invoke } from "./ipc.js";
import { setNavCount } from "./view.js";

const TICK_MS = 60_000;
// The week is read once in this many ticks.
const READ_TICKS = 5;
// How long before its start an event is told of: keep in step with NOTICE_MIN in calendar.rs.
const AHEAD_MS = 5 * 60_000;

// The week of today as last read, when it was read, the day it was read on, and the accounts it was read for (joined); `reading` while a read is on its way.
let week: Week | null = null;
let readAt = 0;
let readDay = "";
let readFor = "";
let reading = false;
// The week after `week`, and the date it was read for ("" for none): it is read only while 5 minutes ahead is in it.
let nextWeek: Week | null = null;
let nextFor = "";
// Bumped by every draw, so that an answer that comes late is not drawn over a newer one.
let drawSeq = 0;
// The events whose card was pressed (参加, 予定を開く or ×), by `keyOf`.
const pressed = new Set<string>();
const cards = new Map<string, { root: HTMLElement; when: HTMLElement; n: EventNotice }>();

const tickMs = () => periodMs("calendarNotice", TICK_MS);
// An event is told by its account, calendar, ID and start, so an event moved to another time is a new one.
const keyOf = (e: EventNotice["event"]) => `${e.account}\n${e.calendarId}\n${e.eventId}\n${e.start}`;

// How long to the start, or since it: 「5 分後」, 「開始」, 「開始から 3 分」.
export const leftText = ({ minutes, started }: EventNotice) => (!started ? `${minutes} 分後` : minutes === 0 ? "開始" : `開始から ${minutes} 分`);

const whenText = (n: EventNotice) => `${leftText(n)} · ${hhmm(n.event.startMin)}–${hhmm(n.event.endMin)}`;

// The events whose card is shown now, for the rows of the pane of the notices (A-35).
export const shownNotices = () => [...cards.values()].map((c) => c.n);

const showCount = () => setNavCount("nav-calendar", cards.size, "カレンダー", "予定");

function press(key: string) {
  pressed.add(key);
  cards.get(key)?.root.remove();
  cards.delete(key);
  showCount();
}

// 「予定を開く」 of a card, and of the row of the pane (A-35): takes the card and the count off, and opens the detail of the event on the calendar.
export function openNoticeEvent(e: EventNotice["event"]) {
  press(keyOf(e));
  openCalendarEvent(e);
}

function makeCard(key: string, n: EventNotice) {
  const e = n.event;
  const actions = tag("div", "event-card-actions");
  if (e.meetUrl) {
    const join = tag("a", "text-btn primary event-card-join", "参加");
    join.href = e.meetUrl;
    join.onclick = () => press(key);
    actions.append(join);
  }
  const open = tag("button", "text-btn", "予定を開く");
  open.type = "button";
  open.onclick = () => openNoticeEvent(e);
  actions.append(open);
  const { root, close } = card(whenText(n), [tag("div", "event-card-title", e.summary || "(件名なし)"), actions], "event-card");
  root.setAttribute("role", "status");
  const when = root.querySelector<HTMLElement>(".error-card-text")!;
  when.classList.add("event-card-when");
  close.onclick = () => press(key);
  return { root, when, n };
}

// The timed events of the week after the one read, when 5 minutes ahead is in it: those of its first minutes are told of at the end of the day before.
async function nextTimed() {
  if (!week) return [];
  const first = isoDate(addDays(week.weekStart, 7));
  if (isoDate(new Date(Date.now() + AHEAD_MS)) < first) return [];
  if (nextFor !== first) {
    nextFor = first;
    try {
      nextWeek = await invoke("calendar_week", { date: first, firstDay: await calendarFirstDay(), refresh: false });
    } catch (e) {
      nextFor = "";
      logError("calendar-notice", e);
      return [];
    }
  }
  return nextWeek?.timed ?? [];
}

// Draws the cards and the number from what Rust says is to be told of now.
async function draw() {
  const seq = ++drawSeq;
  const accounts = accountList();
  const events = [...(week?.timed ?? []), ...(await nextTimed())].filter((e) => accounts.includes(e.account));
  if (seq !== drawSeq) return;
  let found: EventNotice[] = [];
  if (events.length > 0) {
    try {
      found = await invoke("calendar_notices", { events, nowMs: Date.now() });
    } catch (e) {
      if (seq === drawSeq) logError("calendar-notice", e);
      return;
    }
  }
  if (seq !== drawSeq) return;
  const due = found.filter((n) => !pressed.has(keyOf(n.event)));
  const keys = new Set(due.map((n) => keyOf(n.event)));
  for (const [key, c] of cards) {
    if (keys.has(key)) continue;
    c.root.remove();
    cards.delete(key);
  }
  for (const n of due) {
    const key = keyOf(n.event);
    const kept = cards.get(key);
    if (kept) {
      kept.when.textContent = whenText(n);
      kept.n = n;
    } else cards.set(key, makeCard(key, n));
  }
  showCount();
}

async function read(accounts: string) {
  reading = true;
  readFor = accounts;
  readAt = Date.now();
  readDay = isoDate(new Date());
  nextFor = "";
  try {
    week = await invoke("calendar_week", { date: readDay, firstDay: await calendarFirstDay(), refresh: false });
  } catch (e) {
    logError("calendar-notice", e);
  } finally {
    reading = false;
  }
  await draw();
}

// The calendar screen drew a week that holds today (`calendar_week` of the screen): it is the week of today as read now, so the clock of the next read starts from it.
export function weekDrawn(w: Week) {
  week = w;
  readAt = Date.now();
  readDay = isoDate(new Date());
  readFor = accountList().join("\n");
  nextFor = "";
}

// Reads the week when it has not been read for these accounts, today or in the last 5 ticks, and draws. With no account there is nothing to read: what was drawn goes.
// While the window is hidden nothing is read, and the cards go on being drawn from the week held; `visibilitychange` brings the read that is due.
export function syncCalendarNotice() {
  const accounts = accountList();
  if (accounts.length === 0) {
    week = null;
    readFor = "";
  } else if (!reading && !document.hidden) {
    const joined = accounts.join("\n");
    if (joined !== readFor || readDay !== isoDate(new Date()) || Date.now() - readAt >= READ_TICKS * tickMs()) {
      void read(joined);
      return;
    }
  }
  void draw();
}

export function initCalendarNotice() {
  setInterval(syncCalendarNotice, tickMs());
  document.addEventListener("visibilitychange", () => !document.hidden && syncCalendarNotice());
}
