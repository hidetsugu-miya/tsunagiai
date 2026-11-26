// The accounts: the popup of the Claude avatar, the Google card of the settings, logging in and removing an account.
import type { Claude } from "./bindings/Claude";
import { calendarNeedsLogin, loadCalendar, resetCalendar } from "./calendar.js";
import { syncCalendarNotice } from "./calendar-notice.js";
import { getClaude } from "./claude.js";
import { $, el, tag } from "./dom.js";
import { avatarColor, initials } from "./format.js";
import { confirmUnlink, hintPopup, toggleHint } from "./hint.js";
import { CLAUDE_SVG, LINK_SVG } from "./icons.js";
import { forgetRemoved, historyIds, load } from "./inbox.js";
import { rows, updateBadge } from "./inbox-rows.js";
import { invoke } from "./ipc.js";
import { currentScreen, setScreen } from "./nav.js";
import { itemRow } from "./settings.js";
import { forgetThread, loading, opened } from "./thread.js";
import { clearRelogin, setRelogin, showFailure } from "./error-card.js";
import { show } from "./view.js";

// Per account, what the last load could not do; the Google card reads it.
let inboxIssues: { needsLogin: string[]; failed: Record<string, string> } = { needsLogin: [], failed: {} };
// The Google accounts, as the inbox last answered.
let accounts: string[] = [];
// Whether the Claude avatar's popup is open (it is drawn in #account-popup).
let claudePopup = false;

export const accountList = () => accounts;

// Closes the popup if it is Claude's (Claude can no longer be used).
export function closeClaudePopup() {
  if (claudePopup) closePopup();
}

// Whether the popup of Claude is open.
export const popupOpen = () => claudePopup;

// Every account's row in the settings' Google card, a re-login row for each account that needs it, and an error row for each that failed to load.
export function renderAccounts({ accounts: list, needsLogin, failed }: { accounts: string[]; needsLogin: string[]; failed: Record<string, string> }) {
  inboxIssues = { needsLogin, failed };
  const changed = list.join("\n") !== accounts.join("\n");
  accounts = list;
  $<HTMLButtonElement>("nav-calendar").disabled = list.length === 0;
  // The minutes of the cards go with the clock of C-8; only a change of the accounts asks for a read and a draw at once.
  if (changed) syncCalendarNotice();
  renderGoogleCard();
  $("relogin").replaceChildren(
    ...needsLogin.map((a) => {
      const div = document.createElement("div");
      const button = document.createElement("button");
      button.textContent = "再ログイン";
      button.onclick = () => addAccount(a, button);
      div.append(`${a} は再ログインが必要です`, button);
      return div;
    }),
    ...Object.entries(failed).map(([a, message]) => {
      const div = document.createElement("div");
      div.textContent = `${a} の読み込みに失敗しました: ${message}`;
      return div;
    }),
  );
  // An account that must log in again is also told by a card, once, until it has logged in.
  setRelogin("mail", needsLogin, (a) => `${a} は再ログインが必要です`, addAccount);
}

export function closePopup() {
  claudePopup = false;
  $("account-popup").hidden = true;
  $("claude-btn").setAttribute("aria-expanded", "false");
}

// Puts the popup right of the sidebar at the Claude avatar's height, inside the window.
function placePopup() {
  const popup = $("account-popup");
  popup.style.left = `${$("sidebar").getBoundingClientRect().right + 8}px`;
  popup.style.top = `${Math.max(8, Math.min($("claude-btn").getBoundingClientRect().top, innerHeight - popup.offsetHeight - 8))}px`;
}

// Claude's popup: who is logged in and the plan (or "API キー" when a key is in use). Nothing to change here; the settings hold the rest.
function toggleClaudePopup() {
  if (claudePopup) return closePopup();
  claudePopup = true;
  $("claude-btn").setAttribute("aria-expanded", "true");
  // The button is only shown while Claude can be used.
  const claude = getClaude() as Extract<Claude, { state: "ready" }>;
  const avatar = el("avatar claude");
  avatar.innerHTML = CLAUDE_SVG;
  const open = tag("button", "text-btn", "設定を開く");
  open.onclick = () => {
    closePopup();
    setScreen("settings", "claude");
  };
  $("account-popup").replaceChildren(
    avatar,
    el("popup-email", claude.method === "apiKey" ? "API キー" : claude.email),
    el("popup-plan", claude.plan ? `Claude ・ ${claude.plan} プラン` : "Claude"),
    tag("span", "status ok", claude.method === "apiKey" ? "使用中" : "ログイン中"),
    open,
  );
  $("account-popup").hidden = false;
  placePopup();
}

// What the settings card says about an account: what is wrong with it, whether it needs a login, and its unread count.
function accountState(a: string) {
  const lines: string[] = [];
  if (a in inboxIssues.failed) lines.push(`受信トレイの読み込みに失敗しました: ${inboxIssues.failed[a]}`);
  if (inboxIssues.needsLogin.includes(a)) lines.push("再ログインが必要です");
  if (calendarNeedsLogin(a)) lines.push("カレンダーの再ログインが必要です");
  const relogin = lines.some((l) => l.includes("再ログイン"));
  const unread = [...rows.values()].filter((r) => r.t.account === a && r.t.unread && r.li.isConnected).length;
  return { lines, relogin, unread };
}

// The settings' Google card: one row per account. It is drawn only while the settings screen is shown, and redrawn only when a row changes.
let googleKey = "";
export function renderGoogleCard() {
  if (currentScreen() !== "settings") return;
  const states = accounts.map((a) => [a, accountState(a)] as const);
  const key = JSON.stringify(states);
  if (key === googleKey) return;
  googleKey = key;
  $("google-accounts").replaceChildren(
    ...(states.length
      ? states.map(([a, { lines, relogin, unread }]) => {
          const avatar = tag("span", "avatar", initials(a));
          avatar.style.background = avatarColor(a);
          const status: [string, string] = relogin ? ["warn", "要再ログイン"] : lines.length ? ["warn", "読み込み失敗"] : ["ok", "ログイン中"];
          const actions: HTMLButtonElement[] = [];
          if (relogin) {
            const b = tag("button", "text-btn", "再ログイン") as HTMLButtonElement;
            b.onclick = () => addAccount(a, b);
            actions.push(b);
          }
          const unlink = tag("button", "icon-btn") as HTMLButtonElement;
          unlink.innerHTML = LINK_SVG;
          unlink.setAttribute("aria-label", `${a} の接続を解除`);
          unlink.setAttribute("data-hint", "");
          unlink.onclick = () => confirmUnlink(unlink, a, `${a} をつなぎAIから削除します。Gmail のメールは消えません。`, () => removeAccount(a, unlink));
          actions.push(unlink);
          return itemRow({ avatar, name: a, meta: [...lines, `未読 ${unread}`].join(" · "), warn: lines.length > 0, status, actions });
        })
      : [tag("div", "card-empty", "アカウントはまだありません")]),
  );
}

// Logs in (the account chosen in the browser, or `hint` preselected) and reloads the list.
export async function addAccount(hint: string | null, button: HTMLButtonElement) {
  button.disabled = true;
  try {
    await invoke("login", { loginHint: hint });
    // The accounts changed: weeks kept so far and the calendar lists behind them are stale.
    // The login may have fixed the calendar too; the card must not keep the old state until the calendar is opened.
    resetCalendar(false);
    clearRelogin("calendar");
    await load();
    if (currentScreen() === "calendar") await loadCalendar();
  } catch (e) {
    showFailure("accounts", e);
  } finally {
    button.disabled = false;
  }
}

// Removes the account in the backend (revokes Google's grant, deletes its token), then drops what the screen kept of it.
async function removeAccount(account: string, button: HTMLButtonElement) {
  button.disabled = true;
  try {
    await invoke("remove_account", { account });
  } catch (e) {
    button.disabled = false;
    return showFailure("accounts", e);
  }
  for (const [key, r] of rows) {
    if (r.t.account !== account) continue;
    r.li.remove();
    rows.delete(key);
  }
  historyIds.delete(account);
  forgetRemoved(account);
  // An open thread of this account, or one still loading, cannot be acted on any more; the settings are on screen, so only the thread is let go.
  if ((opened.current ?? loading.current)?.account === account) forgetThread();
  resetCalendar(true);
  clearRelogin("calendar", account);
  updateBadge();
  await load();
  if (currentScreen() !== "calendar") return;
  // With no account left there is no calendar to show: back to the mail screen, which shows the login.
  if (accounts.length === 0) {
    setScreen("mail");
    show("login");
  } else {
    await loadCalendar();
  }
}

export function initAccounts() {
  $("claude-btn").onclick = toggleClaudePopup;
  document.addEventListener("pointerdown", (e) => {
    if (claudePopup && !(e.target as Element).closest("#account-popup, .account-btn")) closePopup();
  });
  document.addEventListener("keydown", (e) => {
    if (e.key !== "Escape" || !claudePopup) return;
    const inside = $("account-popup").contains(document.activeElement);
    closePopup();
    if (inside) $("claude-btn").focus();
  });
  window.addEventListener("resize", () => claudePopup && placePopup());
  // The unread count follows every change of the list: load, sync, read toggle, removal.
  new MutationObserver(renderGoogleCard).observe($("threads"), { childList: true, subtree: true, attributes: true, attributeFilter: ["class"] });
  $("login-button").onclick = () => addAccount(null, $<HTMLButtonElement>("login-button"));
  $("google-add").onclick = () => addAccount(null, $<HTMLButtonElement>("google-add"));
  $("google-help").onclick = (e) =>
    toggleHint(
      e.currentTarget as Element,
      hintPopup(
        "Google アカウントの追加",
        [
          ["「アカウントを追加」を押すと、既定のブラウザが開きます"],
          ["Google でログインし、Gmail とカレンダーへのアクセスを許可します"],
          ["受信トレイとカレンダーに、そのアカウントの分が加わります"],
        ],
        "ログインの情報はキーチェーンに保存します",
      ),
    );
}
