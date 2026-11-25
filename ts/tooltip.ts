// Tooltip for icon-only controls. The native title is slow or missing in WKWebView, so the text is the control's aria-label (and its `data-shortcut`, when it has one).
import { el } from "./dom.js";

const TIP_DELAY_MS = 300;
let tip: HTMLElement;
let tipTimer = 0;

function hideTip() {
  clearTimeout(tipTimer);
  tip.hidden = true;
}

// Right of a sidebar control, above a footer control (the footer is at the window's bottom edge), below any other; kept inside the window. A target that `covered` names shows none (the main window passes the avatars of the sidebar while the account popup, which covers that area, is open).
let covered: (target: Element) => boolean = () => false;

function showTip(target: Element) {
  hideTip();
  const inSidebar = target.closest("#sidebar");
  const inFooter = target.closest("#footer");
  if (covered(target)) return;
  tipTimer = setTimeout(() => {
    // A sidebar button that a number key reaches (A-5) adds it: "Slack ⌘3".
    const key = (target as HTMLElement).dataset.shortcut;
    tip.textContent = key ? `${target.getAttribute("aria-label")} ${key}` : target.getAttribute("aria-label");
    tip.hidden = false;
    const r = target.getBoundingClientRect();
    const left = inSidebar ? r.right + 8 : r.left + (r.width - tip.offsetWidth) / 2;
    const top = inSidebar ? r.top + (r.height - tip.offsetHeight) / 2 : inFooter ? r.top - tip.offsetHeight - 6 : r.bottom + 6;
    tip.style.left = `${Math.max(4, Math.min(left, innerWidth - tip.offsetWidth - 4))}px`;
    tip.style.top = `${Math.max(4, Math.min(top, innerHeight - tip.offsetHeight - 4))}px`;
  }, TIP_DELAY_MS);
}

// Delegated, so rows and avatars built later get tooltips too. The button stretched over a row of the Slack list has its label for the keyboard: the row itself shows what it says.
const TIP_TARGET = "button[aria-label]:not(.feed-open), input[aria-label], a.icon-btn[aria-label]";
const targetOf = (e: Event) => (e.target as Element).closest?.(TIP_TARGET);

// The page of a window of a tab (`popout.ts`) calls it with no argument: it must not load the modules of the main window, which `covered` would need.
export function initTooltip(covers?: (target: Element) => boolean) {
  if (covers) covered = covers;
  tip = el("tooltip");
  tip.hidden = true;
  document.body.append(tip);
  document.addEventListener("mouseover", (e) => {
    const t = targetOf(e);
    if (t && !t.contains(e.relatedTarget as Node | null)) showTip(t);
  });
  document.addEventListener("mouseout", (e) => {
    const t = targetOf(e);
    if (t && !t.contains(e.relatedTarget as Node | null)) hideTip();
  });
  // Only keyboard focus shows it; a click also focuses the control and must not bring the tooltip back.
  document.addEventListener("focusin", (e) => {
    const t = targetOf(e);
    if (t?.matches(":focus-visible")) showTip(t);
  });
  document.addEventListener("focusout", hideTip);
  document.addEventListener("pointerdown", hideTip);
  document.addEventListener("click", hideTip);
  document.addEventListener("scroll", hideTip, true);
  document.addEventListener("keydown", (e) => e.key === "Escape" && hideTip());
}
