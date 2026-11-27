// The failures and warnings (A-28): every one goes to the app's log, and a failure of something the user did, a failure or warning that goes on (`setNotice`) and a login that must be done again also show as a white card at the bottom right.
// A card stays until its × is pressed, and a new one is put above the others. The screens draw no failure or warning in their own place: it is a card.
import { $, tag } from "./dom.js";
import { CLOSE_SVG } from "./icons.js";
import { invoke } from "./ipc.js";
import { setScreen } from "./nav.js";

// The text of a failure as the log and the card hold it: Rust's errors arrive as text, any other is made one.
const textOf = (e: unknown) => String(e);

// Where Rust puts what the script of a database connection printed on its standard error (`database/script.rs`): the log keeps the text up to it, since what a program printed is not written to the log (A-28).
const STDERR_MARK = "。標準エラーの最後の行";

// Writes a failure to the log. `source` names where it happened (the module). A log that cannot be written is left alone: it must not make another failure.
export function logError(source: string, e: unknown) {
  invoke("log_write", { level: "error", source, message: textOf(e).split(STDERR_MARK)[0] }).catch(() => {});
}

// `className` is added to the card: the notice of an event (C-8) is this card with another color at its left.
export function card(text: string, extra: (HTMLElement | null)[], className = "") {
  const root = tag("div", `error-card ${className}`.trim());
  root.setAttribute("role", "alert");
  const close = tag("button", "icon-btn error-card-close");
  close.type = "button";
  close.setAttribute("aria-label", "閉じる");
  close.innerHTML = CLOSE_SVG;
  const body = tag("div", "error-card-body");
  body.append(tag("div", "error-card-text", text), ...extra.filter((x) => x !== null));
  root.append(body, close);
  $("error-cards").prepend(root);
  return { root, close };
}

// Writes a failure of something the user did to the log and shows it as a card, with the button that opens the log tab of the settings.
// The same text that a card still shows is not drawn twice (the log keeps every one).
export function showFailure(source: string, e: unknown) {
  logError(source, e);
  const text = textOf(e);
  if ([...document.querySelectorAll(".error-card-text")].some((n) => n.textContent === text)) return;
  const log = logButton();
  const { root, close } = card(text, [log]);
  close.onclick = () => root.remove();
}

// The button that opens the log tab of the settings, or none on a page that has no settings screen (the window of a task, T-11).
function logButton() {
  if (document.getElementById("settings") === null) return null;
  const log = tag("button", "text-btn error-card-log", "ログを見る");
  log.type = "button";
  log.onclick = () => setScreen("settings", "log");
  return log;
}

// A button of a notice: `run` gets the button, so that it can be disabled while the work goes on.
export type NoticeAction = { label: string; run: (button: HTMLButtonElement) => void };

// A failure or a warning that goes on: `warn` is a warning (the orange line at the left), else a failure; `actions` are the buttons before 「ログを見る」.
export type Notice = { text: string; warn?: boolean; actions?: NoticeAction[] };

type Held = { text: string; root: HTMLElement | null; actions: NoticeAction[]; labels: string };

// The notices by key, "{module}:{what}" (the module is the place written to the log). `root` is null once the × was pressed.
const notices = new Map<string, Held>();

// Shows a failure or a warning that goes on as the one card of `key`, and takes the card off with `null` (the screen calls it at every draw, so it does no more than a change needs).
// The card shows once, and is rewritten in place while the key is called again with another text, color or buttons. The log gets a line only when the key is new or its text changed.
// A card closed with its × is not shown again until `null` comes (the account is read well, or the screen is left), which also forgets the ×.
export function setNotice(key: string, notice: Notice | null) {
  const held = notices.get(key);
  if (notice === null) {
    held?.root?.remove();
    notices.delete(key);
    return;
  }
  if (held === undefined || held.text !== notice.text) logError(key.split(":")[0], notice.text);
  const actions = notice.actions ?? [];
  const labels = JSON.stringify(actions.map((a) => a.label));
  if (held === undefined) return makeNotice(key, notice, actions, labels);
  held.text = notice.text;
  held.actions = actions;
  const root = held.root;
  if (root === null) return;
  root.classList.toggle(WARN_CLASS, notice.warn === true);
  root.querySelector(".error-card-text")!.textContent = notice.text;
  if (held.labels === labels) return;
  held.labels = labels;
  const box = root.querySelector(".error-card-actions")!;
  for (const b of box.querySelectorAll(".error-card-action")) b.remove();
  box.prepend(...actionButtons(held));
}

// The buttons of the notice, which call the actions as the latest call gave them.
function actionButtons(held: Held) {
  return held.actions.map((action, i) => {
    const button = tag("button", "text-btn error-card-action", action.label);
    button.type = "button";
    button.onclick = () => held.actions[i]?.run(button);
    return button;
  });
}

function makeNotice(key: string, notice: Notice, actions: NoticeAction[], labels: string) {
  const held: Held = { text: notice.text, root: null, actions, labels };
  const box = tag("div", "error-card-actions");
  box.append(...actionButtons(held), ...[logButton()].filter((b) => b !== null));
  const { root, close } = card(notice.text, [box], notice.warn ? WARN_CLASS : "");
  close.onclick = () => {
    root.remove();
    held.root = null;
  };
  held.root = root;
  notices.set(key, held);
}

// The cards that ask for a login again, by "{scope}:{account}": the entry is null once its × was pressed, so the card is not made again until the account has logged in and needs it again.
const logins = new Map<string, HTMLElement | null>();

// The class that puts the orange line at the left of a card: a warning, such as a login to do again, in place of a failure.
const WARN_CLASS = "warn-card";

// Takes the cards of `scope` off, those of `account` only when it is given: an account has logged in again or is gone, and the screen that made the card may not be the one shown. A card that is still needed is made again by the next read of that screen.
export function clearRelogin(scope: string, account: string | null = null) {
  for (const [key, node] of [...logins]) {
    if (!key.startsWith(`${scope}:`) || (account !== null && key !== `${scope}:${account}`)) continue;
    node?.remove();
    logins.delete(key);
  }
}

// Makes the cards of the accounts of `scope` that must log in again, with the button that logs them in (`run`). A card of an account that no longer needs it goes.
export function setRelogin(scope: string, accounts: string[], text: (account: string) => string, run: (account: string, button: HTMLButtonElement) => void) {
  for (const [key, node] of [...logins]) {
    if (!key.startsWith(`${scope}:`) || accounts.includes(key.slice(scope.length + 1))) continue;
    node?.remove();
    logins.delete(key);
  }
  for (const account of accounts) {
    const key = `${scope}:${account}`;
    if (logins.has(key)) continue;
    const button = tag("button", "text-btn error-card-login", "再ログイン");
    button.type = "button";
    button.onclick = () => run(account, button);
    const { root, close } = card(text(account), [button], WARN_CLASS);
    close.onclick = () => {
      root.remove();
      logins.set(key, null);
    };
    logins.set(key, root);
  }
}
