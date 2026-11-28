// C-9: the guests of the calendar screen. A guest is a person of an account's organization whose week is laid over the week of the screen.
// The search field, the candidates and the chips of the people shown are at the left, between the month calendar and the calendars (ts/calendar-side.ts).
// The people shown, and their weeks, are held in memory only: nothing of a person is saved in a file.
import type { DirectoryPeople } from "./bindings/DirectoryPeople";
import type { DirectoryPerson } from "./bindings/DirectoryPerson";
import type { PersonWeek } from "./bindings/PersonWeek";
import { addAccount } from "./accounts.js";
import { $, composing, el, tag } from "./dom.js";
import { setNotice, setRelogin, showFailure } from "./error-card.js";
import { avatarColor, initials } from "./format.js";
import { CLOSE_SVG } from "./icons.js";
import { invoke } from "./ipc.js";

// The share of a day column that the user's own events keep while a guest is shown, and where the guests' strips lie: from GUEST_LEFT, over GUEST_SPAN in all, in percent of the column.
export const OWN_SHARE = 0.62;
export const GUEST_LEFT = 64;
export const GUEST_SPAN = 35;
// How long after the last key the search is sent, so a run of keys searches once.
const SEARCH_MS = 250;

// The people shown, in the order they were chosen. A person is told by the address, whatever its case.
let guests: DirectoryPerson[] = [];
// The week of each guest that was read last, by the guest's address in lower case: a week of another first day is not drawn.
const weeks = new Map<string, PersonWeek>();
// The week the screen asks for: a read that ends after another week was asked for is dropped.
let wanted: { weekStart: string; first: number } | null = null;
// Called when the guests or a week of theirs changed: with the week's first day for a week that arrived, null for a change of the guests.
let onChanged: (weekStart: string | null) => void = () => {};
// The last search, which the candidates and the cards of its failures are drawn from.
let found: DirectoryPeople | null = null;
let searchSeq = 0;
let searchTimer: ReturnType<typeof setTimeout> | undefined;
// The keys of the cards of the last search's failures.
let noticeKeys = new Set<string>();

const idOf = (g: { email: string }) => g.email.toLowerCase();

export const shownGuests = () => guests;

// The week of `guest` that starts on `weekStart`, if it has been read.
export function guestWeek(guest: DirectoryPerson, weekStart: string) {
  const week = weeks.get(idOf(guest));
  return week?.weekStart === weekStart ? week : undefined;
}

// The color of a guest's events and chip.
export const guestColor = (guest: DirectoryPerson) => avatarColor(guest.email);

async function readWeek(guest: DirectoryPerson, weekStart: string, first: number) {
  try {
    const week = await invoke("calendar_person_week", { account: guest.account, email: guest.email, date: weekStart, firstDay: first });
    // The guest may have been taken off, or another week asked for, while the read ran.
    if (!guests.includes(guest) || wanted?.weekStart !== weekStart) return;
    const held = weeks.get(idOf(guest));
    weeks.set(idOf(guest), week);
    drawGuestNotices();
    if (JSON.stringify(held) !== JSON.stringify(week)) onChanged(week.weekStart);
  } catch (e) {
    if (guests.includes(guest) && wanted?.weekStart === weekStart) showFailure("calendar-guests", e);
  }
}

// Reads the week that starts on `weekStart` (the day `first`) of every guest shown. Only the guests shown now are read, so a guest taken off is read no more.
export function loadGuestWeeks(weekStart: string, first: number) {
  wanted = { weekStart, first };
  for (const g of guests) readWeek(g, weekStart, first);
}

// The accounts changed (a login, a removal): what was read for the guests, and the last search, are stale.
export function forgetGuestReads() {
  weeks.clear();
  found = null;
  drawCandidates();
  drawGuestNotices();
}

// Takes off the guests whose account is gone from the screen.
export function pruneGuests(accounts: string[]) {
  const kept = guests.filter((g) => accounts.includes(g.account));
  if (kept.length === guests.length) return;
  guests = kept;
  for (const id of [...weeks.keys()]) if (!guests.some((g) => idOf(g) === id)) weeks.delete(id);
  drawChips();
  drawGuestNotices();
  onChanged(null);
}

// The cards that belong to the screen, drawn from the last search and the weeks: one for each account that must log in again, and one for each account whose directory failed.
// They are taken off while the calendar is not shown, and made again when it is.
export function drawGuestNotices() {
  const texts = new Map<string, string>();
  const login = new Set<string>();
  if (!$("calendar").hidden) {
    for (const a of found?.needsLogin ?? []) login.add(a);
    for (const g of guests) if (weeks.get(idOf(g))?.needsLogin) login.add(g.account);
    for (const [a, message] of Object.entries(found?.failed ?? {})) texts.set(`calendar-guests:failed:${a}`, `${a} のユーザー検索に失敗しました: ${message}`);
  }
  setRelogin("calendar-guests", [...login], (a) => `${a} はユーザーを探すため再ログインが必要です`, addAccount);
  for (const key of noticeKeys) if (!texts.has(key)) setNotice(key, null);
  for (const [key, text] of texts) setNotice(key, { text });
  noticeKeys = new Set(texts.keys());
}

function removeGuest(guest: DirectoryPerson) {
  guests = guests.filter((g) => g !== guest);
  weeks.delete(idOf(guest));
  drawChips();
  drawGuestNotices();
  onChanged(null);
}

function chip(guest: DirectoryPerson) {
  const node = tag("div", "cal-guest-chip");
  node.dataset.guest = guest.email;
  const swatch = tag("span", "cal-guest-swatch");
  swatch.style.background = guestColor(guest);
  const remove = tag("button", "icon-btn");
  remove.type = "button";
  remove.setAttribute("aria-label", `${guest.name || guest.email}を外す`);
  remove.innerHTML = CLOSE_SVG;
  remove.onclick = () => removeGuest(guest);
  node.append(swatch, tag("span", "cal-guest-name", guest.name || guest.email), remove);
  return node;
}

function drawChips() {
  const box = document.getElementById("cal-guest-chips");
  // The panel is made by `initCalendarGuests`; a change of the accounts can come before it.
  if (!box) return;
  box.hidden = guests.length === 0;
  box.replaceChildren(el("cal-side-group", "表示中"), ...guests.map(chip));
}

// The people of the last search that are not shown yet, once for each address (two accounts may find the same person).
const candidates = () => {
  const seen = new Set(guests.map(idOf));
  return (found?.people ?? []).filter((p) => !seen.has(idOf(p)) && seen.add(idOf(p)));
};

function addGuest(person: DirectoryPerson) {
  if (guests.some((g) => idOf(g) === idOf(person))) return;
  const guest = { ...person };
  guests.push(guest);
  const input = $<HTMLInputElement>("cal-guest-input");
  input.value = "";
  searchSeq++;
  clearTimeout(searchTimer);
  found = null;
  drawCandidates();
  drawChips();
  drawGuestNotices();
  input.focus({ preventScroll: true });
  onChanged(null);
  if (wanted) readWeek(guest, wanted.weekStart, wanted.first);
}

function candidate(person: DirectoryPerson) {
  const item = tag("li");
  const button = tag("button", "cal-guest-cand");
  button.type = "button";
  button.dataset.guest = person.email;
  const avatar = tag("span", "cal-side-avatar", initials(person.name || person.email));
  avatar.style.background = avatarColor(person.email);
  const text = tag("span", "cal-guest-cand-text");
  text.append(el("cal-guest-name", person.name || person.email), el("cal-guest-mail", person.email));
  button.append(avatar, text);
  button.onclick = () => addGuest(person);
  item.append(button);
  return item;
}

function drawCandidates() {
  const list = document.getElementById("cal-guest-cands");
  if (!list) return;
  const people = candidates();
  list.hidden = people.length === 0;
  list.replaceChildren(...people.map(candidate));
}

async function search(text: string) {
  const mine = ++searchSeq;
  try {
    const read = await invoke("calendar_search_people", { text });
    if (mine !== searchSeq) return;
    found = read;
    drawCandidates();
    drawGuestNotices();
  } catch (e) {
    if (mine === searchSeq) showFailure("calendar-guests", e);
  }
}

// Makes the panel of the guests and puts it under the month calendar. `changed` redraws the week.
export function initCalendarGuests(changed: (weekStart: string | null) => void) {
  onChanged = changed;
  const root = tag("div");
  root.id = "cal-guest";
  const label = tag("label", "cal-guest-label", "ゲスト");
  label.htmlFor = "cal-guest-input";
  const input = tag("input");
  input.id = "cal-guest-input";
  input.type = "text";
  input.autocomplete = "off";
  input.spellcheck = false;
  const list = tag("ul", "cal-guest-cands");
  list.id = "cal-guest-cands";
  list.hidden = true;
  const chips = tag("div");
  chips.id = "cal-guest-chips";
  chips.hidden = true;
  const typed = () => {
    clearTimeout(searchTimer);
    searchSeq++;
    const text = input.value.trim();
    if (text === "") {
      found = null;
      drawCandidates();
      drawGuestNotices();
      return;
    }
    searchTimer = setTimeout(() => search(text), SEARCH_MS);
  };
  input.oninput = typed;
  input.onkeydown = (e) => {
    if (composing(e)) return;
    // Enter takes the first candidate; Escape clears the field.
    if (e.key === "Enter") {
      const first = candidates()[0];
      if (first) addGuest(first);
    } else if (e.key === "Escape") {
      input.value = "";
      typed();
    }
  };
  root.append(label, input, list, chips);
  $("cal-side").insertBefore(root, $("cal-side-feed"));
}
