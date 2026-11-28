// The pane of the notices (A-35): the count in the footer opens it from the right, over the screen and down to the footer. Tabs over the list (all, mail, Slack, calendar, Todo, each with its count, also at 0) choose the kind of the rows. It lists the unread threads of the inbox, the unread messages of the Slack list, the events C-8 tells of and the tasks that are due (T-5), mixed, the newest first.
// A row says which kind it is by its icon, then the sender's avatar and name, the channel (Slack), the time and the text, up to 3 lines (the subject and the snippet of a mail, or the text of a Slack message). Its text button does what pressing the row of the inbox or of the Slack list does.
// While the pointer is on a row or the focus is in it, its icon buttons show: a mail's trash and archive (M-3, M-4: the list's `removeRow`), a Slack message's "既読にする" (only where it changes something) and "ウォッチ" (S-13). The row goes from the pane and the count of the footer falls.
// It draws what the inbox and the Slack list hold, with no call of its own, and it is drawn again where either changes (the inbox's unread rows, `drawUnreadPane` of slack-list.ts and the count of the footer). Everything is drawn as text.
import type { ThreadItem } from "./bindings/ThreadItem";
import type { EventNotice } from "./bindings/EventNotice";
import type { TaskItem } from "./bindings/TaskItem";
import type { TimelineMessage } from "./bindings/TimelineMessage";
import { leftText, openNoticeEvent, shownNotices } from "./calendar-notice.js";
import { $, el, span, tag } from "./dom.js";
import { closeOtherPanes, registerPane, watchFooterCount, type FooterCounts } from "./footer.js";
import { avatarColor, formatDate, hhmm, initials, unescapeHtml } from "./format.js";
import { BOOKMARK_SVG, CALENDAR_SVG, CHECK_SVG, MAIL_SVG, SLACK_SVG, TODO_SVG, TRASH_SVG } from "./icons.js";
import { removeRow } from "./inbox.js";
import { pending, rowKey, rows } from "./inbox-rows.js";
import { setScreen } from "./nav.js";
import { openUnreadMessage, readableMessage, readUnreadMessage, unreadMessages, watchUnreadMessage } from "./slack-list.js";
import { decorateAvatar, loadIcons, slackMs, workspaceColor } from "./slack-view.js";
import { openThread } from "./thread.js";
import { dueLabel, dueTasks } from "./todo-data.js";
import { openTodoTask } from "./todo.js";

type Kind = "mail" | "slack" | "calendar" | "todo";
type Tab = "all" | Kind;
const TABS: [Tab, string][] = [["all", "すべて"], ["mail", "メール"], ["slack", "Slack"], ["calendar", "予定"], ["todo", "Todo"]];

// The count in the heading: the footer's, which counts every unread message held and not only the rows the pane can list. A fall of it to 0 closes the pane. `counts` are the ones the tabs show.
let count = 0;
let counts: FooterCounts = { mail: 0, slack: 0, calendar: 0, todo: 0 };
// The tab shown: all each time the pane opens.
let tab: Tab = "all";
// What the pane drew last, so that a redraw with nothing changed leaves the rows (and a hover or a focus on them) alone.
let drawnKey = "";

const isOpen = () => !$("unread-pane").hidden;

function close() {
  $("unread-pane").hidden = true;
  $("footer-bell").setAttribute("aria-expanded", "false");
}

function toggle() {
  if (isOpen()) return close();
  closeOtherPanes("unread");
  $("unread-pane").hidden = false;
  $("footer-bell").setAttribute("aria-expanded", "true");
  tab = "all";
  drawnKey = "";
  drawUnreadPane();
}

// One unread item as the pane draws it, in the order of `ms`.
type Item = { kind: Kind; ms: number; key: string; node: () => HTMLLIElement };

// An icon button of a row: its press does `run` and does not reach the row, which would open the thread. The second click of a double click, which lands on the row that moved under the pointer, does nothing.
const DOUBLE_CLICK_MS = 500;
let lastActionAt = 0;
function iconButton(label: string, svg: string, run: () => void) {
  const button = tag("button", "icon-btn");
  button.type = "button";
  button.setAttribute("aria-label", label);
  button.innerHTML = svg;
  button.onclick = (e) => {
    e.stopPropagation();
    if (e.detail > 1 && Date.now() - lastActionAt < DOUBLE_CLICK_MS) return;
    lastActionAt = Date.now();
    run();
  };
  return button;
}

function line(avatar: HTMLElement | null, who: HTMLElement, text: string, icon: string, label: string, open: () => void, actions: HTMLButtonElement[]) {
  const li = tag("li", "unread-item");
  const kind = span("unread-kind", "");
  kind.innerHTML = icon;
  const body = el("unread-body");
  body.append(who, span("unread-line", text));
  const button = tag("button", "text-btn", label);
  button.type = "button";
  // The text button comes first in the document, so that the focus reaches the row before its icon buttons, which show only while the row has the pointer or the focus.
  const buttons = el("unread-actions");
  buttons.append(button, ...actions);
  li.append(kind, ...(avatar ? [avatar] : []), body, buttons);
  // A row with no avatar (an event, a task) has one column less.
  li.classList.toggle("bare", !avatar);
  // The text button's press reaches the row, so the row alone opens it, once.
  li.onclick = () => {
    close();
    open();
  };
  return li;
}

function mailItem(t: ThreadItem): Item {
  const name = t.fromName || t.fromAddress;
  const ms = t.dateMs;
  return {
    kind: "mail",
    ms,
    key: JSON.stringify(["mail", rowKey(t), name, t.subject, t.snippet, ms]),
    node: () => {
      const subject = t.subject || "(件名なし)";
      // The subject, then the snippet the list holds (Gmail sends it HTML-escaped): read only when the row is made, not at each check of the pane's key.
      const snippet = unescapeHtml(t.snippet).trim();
      const text = snippet ? `${subject} — ${snippet}` : subject;
      const avatar = span("avatar", initials(name));
      avatar.style.background = avatarColor(name);
      const who = el("unread-who");
      who.append(tag("b", "", name), span("unread-time", formatDate(ms)));
      // The row the list holds now, which a sync may have made again since the pane was drawn: the list's own removal takes it out, with the notice and the way back on a failure.
      const remove = (command: "trash" | "archive") => () => {
        const now = rows.get(rowKey(t));
        if (now) removeRow(command, t.account, t.id, now.li);
      };
      const li = line(
        avatar,
        who,
        text,
        MAIL_SVG,
        "詳細を開く",
        () => {
          const now = rows.get(rowKey(t));
          setScreen("mail");
          openThread(now?.t ?? t, now?.li ?? null);
        },
        [iconButton("ゴミ箱へ移動", TRASH_SVG, remove("trash")), iconButton("アーカイブ", CHECK_SVG, remove("archive"))],
      );
      li.dataset.kind = "mail";
      return li;
    },
  };
}

// The message as a row says it: its plain text (the row draws up to 3 lines of it), or the files it holds.
const lineOf = (m: TimelineMessage) => m.text.trim() || (m.hasFiles ? "（添付ファイル）" : "");

function slackItem(m: TimelineMessage): Item {
  const ms = slackMs(m.ts);
  const text = lineOf(m);
  // Pressing the check changes nothing for a message whose channel the token cannot write the position of (S-15): the row has no check then.
  const readable = readableMessage(m);
  return {
    kind: "slack",
    ms,
    key: JSON.stringify(["slack", m.teamId, m.channel, m.ts, m.name, m.channelName, m.iconUrl, text, m.team, readable]),
    node: () => {
      const avatar = tag("span", "avatar feed-avatar");
      decorateAvatar(avatar, m.name, m.iconUrl);
      const dot = tag("i", "feed-ws");
      dot.style.background = workspaceColor(m.team);
      dot.title = m.team;
      avatar.append(dot);
      const who = el("unread-who");
      who.append(tag("b", "", m.name), span("unread-channel", m.channelKind ? m.channelName : `#${m.channelName}`), span("unread-time", formatDate(ms)));
      const actions = [iconButton("ウォッチ", BOOKMARK_SVG, () => watchUnreadMessage(m))];
      if (readable) actions.unshift(iconButton("既読にする", CHECK_SVG, () => readUnreadMessage(m)));
      const li = line(avatar, who, text, SLACK_SVG, "スレッドを開く", () => openUnreadMessage(m), actions);
      li.dataset.kind = "slack";
      return li;
    },
  };
}

// An event that C-8 tells of: its title and its time, and how long to its start. The row opens the event's detail on the calendar, as the card's 「予定を開く」 does: the card and the count go.
function eventItem(n: EventNotice): Item {
  const e = n.event;
  const title = e.summary || "(件名なし)";
  const range = `${hhmm(e.startMin)}–${hhmm(e.endMin)}`;
  const left = leftText(n);
  return {
    kind: "calendar",
    ms: Date.parse(e.start) || 0,
    key: JSON.stringify(["calendar", e.account, e.calendarId, e.eventId, e.start, title, range, left]),
    node: () => {
      const who = el("unread-who");
      who.append(tag("b", "", title), span("unread-time", range));
      const li = line(null, who, left, CALENDAR_SVG, "予定を開く", () => openNoticeEvent(e), []);
      li.dataset.kind = "calendar";
      return li;
    },
  };
}

// A task that is due: its name, when it fell due and its description. The row opens the task on the Todo screen.
function todoItem(t: TaskItem): Item {
  const ms = t.dueAt ?? 0;
  const due = t.due ? dueLabel(t.due) : "";
  const text = t.description.trim();
  return {
    kind: "todo",
    ms,
    key: JSON.stringify(["todo", t.id, t.content, due, text, ms]),
    node: () => {
      const who = el("unread-who");
      who.append(tag("b", "", t.content), span("unread-time", due));
      const li = line(null, who, text, TODO_SVG, "詳細を開く", () => openTodoTask(t.id), []);
      li.dataset.kind = "todo";
      return li;
    },
  };
}

// Draws the heading, the tabs and, while the pane is open, the rows of the tab: the unread threads the inbox holds (those being archived or trashed left out), the unread messages the Slack list holds, the events told of and the tasks that are due, the newest first.
export function drawUnreadPane() {
  if (!isOpen()) return;
  $("unread-pane-title").textContent = `通知 ${count}`;
  for (const b of $("unread-pane-tabs").querySelectorAll<HTMLElement>(".unread-tab")) {
    const id = b.dataset.tab as Tab;
    b.textContent = `${TABS.find(([t]) => t === id)![1]} ${id === "all" ? count : counts[id]}`;
    b.setAttribute("aria-selected", String(id === tab));
  }
  const want = (kind: Kind) => tab === "all" || tab === kind;
  const messages = want("slack") ? unreadMessages() : [];
  const items = [
    ...(want("mail") ? [...rows].filter(([key, r]) => r.t.unread && !pending.has(key)).map(([, r]) => mailItem(r.t)) : []),
    ...messages.map(slackItem),
    ...(want("calendar") ? shownNotices().map(eventItem) : []),
    ...(want("todo") ? dueTasks().map(todoItem) : []),
  ].sort((a, b) => b.ms - a.ms);
  const key = JSON.stringify(items.map((i) => i.key));
  if (key === drawnKey) return;
  drawnKey = key;
  $("unread-pane-list").replaceChildren(...items.map((i) => i.node()));
  // The icons not fetched yet come later and are painted onto the avatars in the page.
  loadIcons(messages.map((m) => m.iconUrl));
}

export function initUnreadPane() {
  for (const [id, name] of TABS) {
    const b = tag("button", "unread-tab", name);
    b.type = "button";
    b.setAttribute("role", "tab");
    b.dataset.tab = id;
    b.onclick = () => {
      tab = id;
      drawUnreadPane();
    };
    $("unread-pane-tabs").append(b);
  }
  watchFooterCount((n, parts) => {
    const before = count;
    count = n;
    counts = parts;
    // The count falling to 0 while the pane is open closes it, whatever cleared the last unread: a row's button or a sync. A pane opened at 0 stays, and one that closed stays closed when 元に戻す brings the count back.
    if (before > 0 && n === 0) close();
    drawUnreadPane();
  });
  registerPane("unread", close);
  $("footer-bell").onclick = toggle;
  $("unread-pane-close").onclick = close;
  // A press outside the pane (the bell excepted, which toggles it, and the notice of a trash or an archive from a row, whose 元に戻す is pressed with the pane open) closes it.
  document.addEventListener("mousedown", (e) => {
    const target = e.target as Element;
    if (isOpen() && !$("unread-pane").contains(target) && !$("footer-bell").contains(target) && !target.closest(".toast")) close();
  });
  // The inbox's unread rows change with every load, sync, removal and read toggle.
  new MutationObserver(drawUnreadPane).observe($("unread-threads"), { childList: true });
}
