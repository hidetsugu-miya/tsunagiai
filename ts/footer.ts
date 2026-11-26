// The footer under every screen (A-35): the bell with the count of the unread mail, the unread Slack messages, the events being told of (C-8) and the tasks that are due (T-5) added up.
import { $ } from "./dom.js";

// The count of each kind that the bell adds up.
export type FooterCounts = { mail: number; slack: number; calendar: number; todo: number };

// What the pane of the notices (unread-pane.ts) does when the counts change: it draws its heading and its tabs again.
let onCount: ((count: number, counts: FooterCounts) => void) | null = null;
export function watchFooterCount(listener: (count: number, counts: FooterCounts) => void) {
  onCount = listener;
}

// The panes that open from the footer over the screen (the unread, A-35, and the resources, A-48) stand one at a time: a pane registers how it closes, and one that opens closes the others.
const panes = new Map<string, () => void>();
export function registerPane(name: string, close: () => void) {
  panes.set(name, close);
}
export function closeOtherPanes(name: string) {
  for (const [other, close] of panes) if (other !== name) close();
}

// The sum of `counts` on the bell (99+ from 100; none for 0). The label carries it too.
export function setFooterCount(counts: FooterCounts) {
  const count = counts.mail + counts.slack + counts.calendar + counts.todo;
  const badge = $("footer-bell").querySelector<HTMLElement>(".footer-count")!;
  badge.hidden = count === 0;
  badge.textContent = count > 99 ? "99+" : String(count);
  $("footer-bell").setAttribute("aria-label", count === 0 ? "通知" : `通知（${count} 件）`);
  onCount?.(count, counts);
}
