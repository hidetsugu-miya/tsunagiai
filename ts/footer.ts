// The footer under every screen (A-35): the bell with the unread count of the inbox and of the Slack list added up.
import { $ } from "./dom.js";

// What the pane of the unread (unread-pane.ts) does when the count changes: it draws its heading again.
let onCount: ((count: number) => void) | null = null;
export function watchFooterCount(listener: (count: number) => void) {
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

// The count on the bell (99+ from 100; none for 0). The label carries it too.
export function setFooterCount(count: number) {
  const badge = $("footer-bell").querySelector<HTMLElement>(".footer-count")!;
  badge.hidden = count === 0;
  badge.textContent = count > 99 ? "99+" : String(count);
  $("footer-bell").setAttribute("aria-label", count === 0 ? "通知" : `通知（未読 ${count} 件）`);
  onCount?.(count);
}
