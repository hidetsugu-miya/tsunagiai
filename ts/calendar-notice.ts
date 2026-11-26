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
import { hhmm, isoDate } from "./format.js";
import { invoke } from "./ipc.js";
import { setNavCount } from "./view.js";

const TICK_MS = 60_000;
// The week is read once in this many ticks.
const READ_TICKS = 5;

// The week of today as last read, when it was read, the day it was read on, and the accounts it was read for (joined); `reading` while a read is on its way.
let week: Week | null = null;
let readAt = 0;
let readDay = "";
let readFor = "";
let reading = false;
// Bumped by every draw, so that an answer that comes late is not drawn over a newer one.
let drawSeq = 0;
// The events whose card was pressed (参加, 予定を開く or ×), by `keyOf`.
const pressed = new Set<string>();
const cards = new Map<string, { root: HTMLElement; when: HTMLElement }>();

const tickMs = () => periodMs("calendarNotice", TICK_MS);
// An event is told by its account, calendar, ID and start, so an event moved to another time is a new one.
const keyOf = (e: EventNotice["event"]) => `${e.account}\n${e.calendarId}\n${e.eventId}\n${e.start}`;

function whenText({ event: e, minutes, started }: EventNotice) {
  const left = !started ? `${minutes} 分後` : minutes === 0 ? "開始" : `開始から ${minutes} 分`;
  return `${left} · ${hhmm(e.startMin)}–${hhmm(e.endMin)}`;
}

const showCount = () => setNavCount("nav-calendar", cards.size, "カレンダー", "予定");

function press(key: string) {
  pressed.add(key);
  cards.get(key)?.root.remove();
  cards.delete(key);
  showCount();
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
  open.onclick = () => {
    press(key);
    openCalendarEvent(e);
  };
  actions.append(open);
  const { root, close } = card(whenText(n), [tag("div", "event-card-title", e.summary || "(件名なし)"), actions], "event-card");
  root.setAttribute("role", "status");
  const when = root.querySelector<HTMLElement>(".error-card-text")!;
  when.classList.add("event-card-when");
  close.onclick = () => press(key);
  return { root, when };
}

// Draws the cards and the number from what Rust says is to be told of now.
async function draw() {
  const seq = ++drawSeq;
  const accounts = accountList();
  const events = (week?.timed ?? []).filter((e) => accounts.includes(e.account));
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
    if (kept) kept.when.textContent = whenText(n);
    else cards.set(key, makeCard(key, n));
  }
  showCount();
}

async function read(accounts: string) {
  reading = true;
  readFor = accounts;
  readAt = Date.now();
  readDay = isoDate(new Date());
  try {
    week = await invoke("calendar_week", { date: readDay, firstDay: await calendarFirstDay(), refresh: false });
  } catch (e) {
    logError("calendar-notice", e);
  } finally {
    reading = false;
  }
  await draw();
}

// Reads the week when it has not been read for these accounts, today or in the last 5 ticks, and draws. With no account there is nothing to read: what was drawn goes.
export function syncCalendarNotice() {
  const accounts = accountList();
  if (accounts.length === 0) {
    week = null;
    readFor = "";
  } else if (!reading) {
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
}
