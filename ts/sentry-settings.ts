// The "Sentry" card in the Slack tab of the settings screen (S-29): a row per workspace that has a Sentry Personal Token (avatar, name, the last four characters of the token, a state label, and a button that deletes it, which asks first), and the add row: a select of the workspaces without one, a password field and "追加".
// Rust keeps the token in the keychain, and asks Sentry before it keeps one; this module only holds the list it was told.
import type { SentryConnection } from "./bindings/SentryConnection";
import type { Workspace } from "./bindings/Workspace";
import { $, tag } from "./dom.js";
import { avatarColor, initials } from "./format.js";
import { code, confirmUnlink, hintPopup, toggleHint } from "./hint.js";
import { LINK_SVG } from "./icons.js";
import { invoke } from "./ipc.js";
import { scopesBlock } from "./permission-pane.js";
import { itemRow } from "./settings.js";
import { getSlackWorkspaces, onSlackWorkspaces } from "./slack-workspaces.js";
import { logError, showFailure } from "./error-card.js";

const TOKEN_PAGE = "https://sentry.io/settings/account/api/auth-tokens/";
// What each scope of the token is for; the order is the one of the list that is copied.
const SENTRY_SCOPES: Record<string, string> = {
  "event:write": "Resolve、Archive、担当者の変更",
  "org:read": "トークンの確認、組織の読み取り",
  "member:read": "担当者の候補（メンバー）",
  "team:read": "担当者の候補（チーム）",
  "project:read": "通知のプロジェクトの読み取り",
};

// The workspaces that have a token, as Rust last answered; null until the first read.
let connections: SentryConnection[] | null = null;
// Only the latest read, and no read that began before a save or a delete, may draw.
let readSeq = 0;

function connectionRow(c: SentryConnection, w: Workspace) {
  const avatar = tag("span", "avatar", initials(w.team));
  avatar.style.background = avatarColor(w.team);
  const unlink = tag("button", "icon-btn");
  unlink.innerHTML = LINK_SVG;
  unlink.setAttribute("aria-label", `${w.team} の Sentry のトークンを削除`);
  unlink.setAttribute("data-hint", "");
  unlink.onclick = () =>
    confirmUnlink(unlink, `${w.team} の Sentry`, "トークンをつなぎAIから削除します。Sentry 側のトークンは取り消さないので、不要なら Sentry で取り消してください。", async () => {
      readSeq++;
      try {
        adopt(await invoke("sentry_delete", { teamId: c.teamId }));
      } catch (e) {
        showFailure("sentry-settings", e);
      }
    });
  return itemRow({ avatar, name: w.team, meta: `…${c.tail}`, status: ["ok", "接続済み"], actions: [unlink] });
}

function render() {
  const workspaces = getSlackWorkspaces() ?? [];
  const kept = (connections ?? []).flatMap((c) => {
    const w = workspaces.find((x) => x.teamId === c.teamId);
    return w ? [{ c, w }] : [];
  });
  $("sentry-items").replaceChildren(...(kept.length ? kept.map(({ c, w }) => connectionRow(c, w)) : [tag("div", "card-empty", workspaces.length ? "接続はまだありません" : "ワークスペースはまだありません")]));
  const select = $<HTMLSelectElement>("sentry-team");
  const chosen = select.value;
  const free = workspaces.filter((w) => !kept.some(({ c }) => c.teamId === w.teamId));
  select.replaceChildren(
    ...free.map((w) => {
      const option = tag("option", "", w.team);
      option.value = w.teamId;
      return option;
    }),
  );
  if (free.some((w) => w.teamId === chosen)) select.value = chosen;
  for (const control of [select, $("sentry-token"), $("sentry-form").querySelector("button")!] as (HTMLElement & { disabled: boolean })[]) control.disabled = free.length === 0;
}

function adopt(list: SentryConnection[]) {
  connections = list;
  render();
}

// Reads the connections and draws them: each time the settings screen opens. Sentry is asked nothing.
export function loadSentryCard() {
  const seq = ++readSeq;
  invoke("sentry_connections").then(
    (list) => {
      if (seq === readSeq) adopt(list);
    },
    (e) => logError("sentry-settings", e),
  );
}

export function initSentryCard() {
  onSlackWorkspaces((list) => {
    // Rust deleted the token of a workspace that was removed, so its entry goes too, and a workspace added again starts with none.
    if (connections) connections = connections.filter((c) => list.some((w) => w.teamId === c.teamId));
    render();
  });
  render();
  $("sentry-form").onsubmit = async (e) => {
    e.preventDefault();
    const input = $<HTMLInputElement>("sentry-token");
    const token = input.value;
    // The token is never shown: the field is emptied as soon as it is read.
    input.value = "";
    readSeq++;
    try {
      adopt(await invoke("sentry_save", { teamId: $<HTMLSelectElement>("sentry-team").value, token }));
    } catch (err) {
      showFailure("sentry-settings", err);
    }
  };
  $("sentry-help").onclick = (e) => {
    const link = tag("a", "", "sentry.io/settings/account/api/auth-tokens/");
    link.href = TOKEN_PAGE;
    toggleHint(
      e.currentTarget as Element,
      hintPopup(
        "Sentry の設定方法",
        [
          [link, " で、Personal Token を作る"],
          ["「Permissions」に次のスコープを選ぶ", ...scopesBlock(Object.keys(SENTRY_SCOPES), SENTRY_SCOPES)],
          ["ワークスペースを選び、作ったトークンを下の欄に貼って「追加」を押す。Sentry が受け付けたときだけ、つなぎAIに入れる"],
          [code("event:write"), " がないと、Sentry の通知の Resolve などは Slack で操作することになります"],
        ],
        "トークンは OS の資格情報の保管場所に入れ、画面には末尾の 4 文字しか出しません",
      ),
    );
  };
}
