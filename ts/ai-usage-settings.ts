// A-48 (#1603): the card in the 開発 tab of the settings screen that wraps and restores the `statusLine` hook of Claude Code and Antigravity CLI so their usage is cached locally and drawn in the footer.
import type { AiKind } from "./bindings/AiKind";
import type { AiStatuslineState } from "./bindings/AiStatuslineState";
import { $, tag } from "./dom.js";
import { logError, showFailure } from "./error-card.js";
import { code, hintPopup, toggleHint } from "./hint.js";
import { ANTIGRAVITY_SVG, CLAUDE_SVG } from "./icons.js";
import { invoke } from "./ipc.js";
import { refreshAiUsage } from "./machine-stats.js";

const AIS: { kind: AiKind; name: string; icon: string }[] = [
  { kind: "claude", name: "Claude Code", icon: CLAUDE_SVG },
  { kind: "antigravity", name: "Antigravity", icon: ANTIGRAVITY_SVG },
];

let state: AiStatuslineState | null = null;
let saving: AiKind | null = null;

function render(current: AiStatuslineState) {
  $("ai-usage-items").replaceChildren(
    ...AIS.map(({ kind, name, icon }) => {
      const enabled = current[kind];
      const item = tag("div", "item ai-usage-row");
      item.dataset.ai = kind;
      const glyph = tag("span", "stat-icon");
      glyph.dataset.ai = kind;
      glyph.innerHTML = icon;
      const who = tag("div", "who");
      who.append(tag("div", "item-name", name));
      const toggle = tag("button", "switch");
      toggle.type = "button";
      toggle.setAttribute("role", "switch");
      toggle.setAttribute("aria-checked", String(enabled));
      toggle.setAttribute("aria-label", `${name}のステータスラインから利用率を取得`);
      toggle.disabled = saving !== null;
      toggle.onclick = () => void save(kind, !enabled);
      item.append(glyph, who, toggle);
      return item;
    }),
  );
}

async function save(kind: AiKind, enabled: boolean) {
  if (saving !== null || state === null) return;
  saving = kind;
  render({ ...state, [kind]: enabled });
  try {
    state = await invoke("ai_usage_statusline_set", { kind, enabled });
    void refreshAiUsage();
  } catch (e) {
    showFailure("ai-usage-settings", e);
  } finally {
    saving = null;
    if (state) render(state);
    document.querySelector<HTMLElement>(`#ai-usage-items [data-ai="${kind}"] .switch`)?.focus();
  }
}

export function showAiUsageSettingsCard() {
  invoke("ai_usage_statusline_state").then(
    (next) => {
      state = next;
      render(next);
    },
    (e) => logError("ai-usage-settings", e),
  );
}

export function initAiUsageSettings() {
  const help = $("ai-usage-help");
  help.onclick = () =>
    toggleHint(
      help,
      hintPopup(
        "AI 利用率の取得",
        [
          ["ON にすると、", code("~/.claude/settings.json"), " または ", code("~/.gemini/antigravity-cli/settings.json"), " の ", code("statusLine"), " をラッパーで包み、通常利用時に渡される利用率をローカルにキャッシュしてフッターに表示します。"],
          ["既存のステータスライン設定がある場合はそのまま引き継いで実行します。OFF にすると元の設定へ戻します。"],
        ],
        "キャッシュは ai-usage-cache.json に保存されます。",
      ),
    );
}
