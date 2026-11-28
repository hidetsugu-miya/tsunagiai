// The card of the iCloud tab of the settings screen (M-13): the iCloud accounts (`icloud_accounts`), each with its state (`icloud_check`) and the buttons that enter its password again or unlink it (`icloud_remove_account`),
// and the form that adds an account (`icloud_add_account`). The App-specific password is never shown: the field is emptied as soon as it is read, and Rust keeps it in the keychain.
import type { IcloudAccount } from "./bindings/IcloudAccount";
import type { IcloudCheck } from "./bindings/IcloudCheck";
import { $, tag } from "./dom.js";
import { avatarColor, initials } from "./format.js";
import { confirmUnlink, hintPopup, toggleHint } from "./hint.js";
import { forgetRemoved, historyIds, load } from "./inbox.js";
import { rows, updateBadge } from "./inbox-rows.js";
import { invoke } from "./ipc.js";
import { itemRow } from "./settings.js";
import { forgetThread, loading, opened } from "./thread.js";
import { logError, showFailure } from "./error-card.js";

// The accounts as last read, or null until the first read.
let accounts: IcloudAccount[] | null = null;
// address -> what the last `icloud_check` said. An address with no entry is being asked.
const checks = new Map<string, IcloudCheck>();
// Only the latest read, and no read or check that began before an add or an unlink, may draw.
let readSeq = 0;

const STATUS: Record<IcloudCheck["state"] | "pending", [string, string]> = {
  ok: ["ok", "接続中"],
  needsLogin: ["warn", "入れ直しが必要"],
  error: ["warn", "確認できません"],
  pending: ["off", "確認中"],
};

function row(a: IcloudAccount) {
  const check = checks.get(a.address);
  const avatar = tag("span", "avatar", initials(a.address));
  avatar.style.background = avatarColor(a.address);
  const actions: HTMLElement[] = [];
  if (check?.state === "needsLogin") {
    const again = tag("button", "text-btn", "入れ直す");
    again.type = "button";
    again.setAttribute("aria-label", `${a.address} の App 用パスワードを入れ直す`);
    again.onclick = () => {
      $<HTMLInputElement>("icloud-address").value = a.address;
      $("icloud-password").focus();
    };
    actions.push(again);
  }
  const unlink = tag("button", "text-btn", "解除");
  unlink.type = "button";
  unlink.setAttribute("aria-label", `${a.address} の接続を解除`);
  unlink.setAttribute("data-hint", "");
  unlink.onclick = () => confirmUnlink(unlink, a.address, "App 用パスワードをつなぎAIから削除します。iCloud のメールは残ります。", () => remove(a.address));
  actions.push(unlink);
  return itemRow({
    avatar,
    name: a.address,
    meta: check?.state === "needsLogin" ? "App 用パスワードが無効になりました" : check?.state === "error" ? check.message : "",
    warn: check?.state === "needsLogin" || check?.state === "error",
    status: STATUS[check?.state ?? "pending"],
    actions,
  });
}

function draw() {
  if (accounts === null) return $("icloud-accounts").replaceChildren();
  $("icloud-accounts").replaceChildren(...(accounts.length ? accounts.map(row) : [tag("div", "card-empty", "アカウントはまだありません")]));
}

async function remove(address: string) {
  readSeq++;
  try {
    accounts = await invoke("icloud_remove_account", { address });
  } catch (e) {
    return showFailure("icloud-settings", e);
  }
  checks.delete(address);
  draw();
  // As Google's removal does: the rows and the open thread of the account go, the sync stops asking about it, and the list is read again.
  for (const [key, r] of rows) {
    if (r.t.account !== address) continue;
    r.li.remove();
    rows.delete(key);
  }
  historyIds.delete(address);
  forgetRemoved(address);
  if ((opened.current ?? loading.current)?.account === address) forgetThread();
  updateBadge();
  await load();
}

// Asks iCloud about the kept password of each account; a row says its state when its answer comes.
function checkAll(seq: number) {
  for (const { address } of accounts ?? []) {
    invoke("icloud_check", { address }).then(
      (c) => {
        if (seq !== readSeq) return;
        checks.set(address, c);
        draw();
      },
      (e) => {
        logError("icloud-settings", e);
        if (seq !== readSeq) return;
        checks.set(address, { state: "error", message: String(e) });
        draw();
      },
    );
  }
}

// Reads the accounts and asks iCloud about each: each time the iCloud tab is shown.
export function showIcloudTab() {
  const seq = ++readSeq;
  invoke("icloud_accounts").then(
    (list) => {
      if (seq !== readSeq) return;
      accounts = list;
      checks.clear();
      draw();
      checkAll(seq);
    },
    (e) => logError("icloud-settings", e),
  );
}

export function initIcloudTab() {
  $("icloud-add").onsubmit = async (e) => {
    e.preventDefault();
    const address = $<HTMLInputElement>("icloud-address");
    const password = $<HTMLInputElement>("icloud-password");
    const button = $<HTMLButtonElement>("icloud-add-button");
    const [typed, secret] = [address.value, password.value];
    // The password is never shown: the field is emptied as soon as it is read.
    password.value = "";
    button.disabled = true;
    try {
      const list = await invoke("icloud_add_account", { address: typed, password: secret });
      readSeq++;
      accounts = list;
      // iCloud has just accepted the password, so the rows need no check until the tab is shown again.
      checks.clear();
      for (const a of list) checks.set(a.address, { state: "ok" });
      address.value = "";
      draw();
      // The list reads the new account's mail, and the sync of the list starts asking about it (an iCloud-only start leaves the login screen).
      await load();
    } catch (err) {
      showFailure("icloud-settings", err);
    } finally {
      button.disabled = false;
    }
  };
  $("icloud-help").onclick = (e) =>
    toggleHint(
      e.currentTarget as Element,
      hintPopup(
        "iCloud アカウントの追加",
        [
          ["account.apple.com にサインインする。Apple アカウントの 2 ファクタ認証が要ります"],
          ["「サインインとセキュリティ」の「App 用パスワード」で、パスワードを作る"],
          ["メールアドレスと、作ったパスワードを入れて「追加」を押す"],
        ],
        "パスワードはキーチェーンに保存します。Apple アカウントのパスワードを変えると、App 用パスワードはすべて無効になり、入れ直しが要ります",
      ),
    );
}
