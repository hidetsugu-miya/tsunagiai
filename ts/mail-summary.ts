// The AI summary of the open thread: the card under the subject, and what each thread's card holds.
// The states live in memory only: a summary is never saved, and it is gone when the app quits.
// The text is drawn with textContent only: it comes from an untrusted mail, so it never becomes HTML or a link.
import { $, tag } from "./dom.js";
import { setNotice } from "./error-card.js";
import { CLOSE_SVG, SUMMARY_SVG } from "./icons.js";
import { invoke } from "./ipc.js";
import { mailText } from "./mail-text.js";
import type { OpenThread } from "./thread.js";

type State = { phase: "loading" } | { phase: "done"; points: string[]; open: boolean } | { phase: "failed"; error: string };

// By account, thread and latest message: a thread that got a new message starts with no summary.
const states = new Map<string, State>();
const keyOf = (t: OpenThread) => `${t.account}/${t.id}/${t.messages.at(-1)!.id}`;
// The most states kept; the oldest is dropped first (a Map keeps its keys in the order they were first set).
const MAX_STATES = 50;
// What Rust sends to the model at most (INPUT_LIMIT in claude.rs): the text past it is never read, so it is not made.
const TEXT_LIMIT = 10_000;

// The card of a summary that failed (A-28): it follows the thread on the screen, and goes with the card.
const FAILED_KEY = "mail-summary:failed";

// The thread whose card is on the screen. A result for another thread is kept in `states` and drawn when that thread is opened again.
let shown: string | null = null;

function head(title: string, t: OpenThread) {
  const icon = tag("span");
  icon.innerHTML = SUMMARY_SVG;
  const close = tag("button", "icon-btn");
  close.setAttribute("aria-label", "閉じる");
  close.innerHTML = CLOSE_SVG;
  close.onclick = () => closeCard(t);
  const row = tag("div", "summary-head");
  row.append(icon, tag("span", "", title), close);
  return row;
}

// The card of a failure goes, with its ×, when the detail view is left: it is made again when the thread is opened, which draws its failure.
export function initSummary() {
  new MutationObserver(() => {
    if ($("thread").hidden) setNotice(FAILED_KEY, null);
  }).observe($("thread"), { attributes: true, attributeFilter: ["hidden"] });
}

// Empties the card while a thread is loading, so that no result of the thread before it is drawn there.
export function clearSummary() {
  shown = null;
  setNotice(FAILED_KEY, null);
  $("mail-summary").hidden = true;
  $("mail-summary").replaceChildren();
}

// Draws the card of `t`, the thread now open: nothing for a thread with no summary or a closed one.
export function renderSummary(t: OpenThread) {
  shown = keyOf(t);
  const state = states.get(shown);
  const card = $("mail-summary");
  setNotice(
    FAILED_KEY,
    state?.phase === "failed" ? { text: `要約できませんでした: ${state.error}`, actions: [{ label: "やり直す", run: () => start(t) }] } : null,
  );
  card.hidden = !state || state.phase === "failed" || (state.phase === "done" && !state.open);
  if (!state || card.hidden) {
    // An emptied card holds no handler that still points at an earlier thread.
    card.replaceChildren();
    return;
  }
  card.dataset.phase = state.phase;
  switch (state.phase) {
    case "loading":
      card.replaceChildren(tag("span", "spin"), tag("span", "", "Claude が要約しています…"));
      break;
    case "done": {
      const list = tag("ul");
      list.append(...state.points.map((p) => tag("li", "", p)));
      card.replaceChildren(head("AI 要約", t), list);
      break;
    }
  }
}

// "×": a summary is folded away and kept (the icon shows it again).
function closeCard(t: OpenThread) {
  const state = states.get(keyOf(t));
  if (state?.phase === "done") state.open = false;
  renderSummary(t);
}

// Only the first press of a thread sends its text to Claude; a kept summary is shown and hidden without sending anything,
// and a press while it is being made does nothing.
async function start(t: OpenThread) {
  const key = keyOf(t);
  // The earlier states of this thread (before its latest message changed) are not shown again.
  for (const k of states.keys()) if (k.startsWith(`${t.account}/${t.id}/`)) states.delete(k);
  states.set(key, { phase: "loading" });
  while (states.size > MAX_STATES) states.delete(states.keys().next().value!);
  renderSummary(t);
  // Let the "loading" card be drawn before the text of the messages is made.
  await new Promise(requestAnimationFrame);
  try {
    // From the newest message back, until the text reaches what Rust reads; then oldest first as before.
    const messages = [];
    let length = 0;
    for (let i = t.messages.length - 1; i >= 0; i--) {
      const m = t.messages[i];
      const text = mailText(m);
      messages.push({ from: m.from, dateMs: m.dateMs, text });
      length += text.length;
      if (length >= TEXT_LIMIT) break;
    }
    messages.reverse();
    const { points } = await invoke("claude_summarize_mail", { subject: t.subject, messages });
    states.set(key, { phase: "done", points, open: true });
  } catch (e) {
    states.set(key, { phase: "failed", error: String(e) });
  }
  if (shown === key) renderSummary(t);
}

export function summaryPressed(t: OpenThread) {
  const state = states.get(keyOf(t));
  if (state?.phase === "loading") return;
  if (state?.phase === "done") {
    state.open = !state.open;
    renderSummary(t);
  } else {
    start(t);
  }
}
