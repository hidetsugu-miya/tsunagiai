// The icon of a status of Orca's list and its name (A-6, A-8): the Orca screen draws it in its tabs and rows, and the window of a tab (A-46, `ts/popout.ts`) in its header, which does not load the screen.
import type { OrcaStatus } from "./bindings/OrcaStatus";
import { tag } from "./dom.js";
import { ACTIVITY_SVG, ASK_SVG } from "./icons.js";

// The name of each status icon (its `aria-label`).
export const STATUS_LABELS: Record<OrcaStatus, string> = { question: "入力待ち", failed: "失敗", working: "作業中", monitoring: "監視中", interrupted: "中断", done: "完了", idle: "動いていない" };

// The icon of a status (Orca's): the question mark, a ring that turns, the pulse, a green or a faint dot, and a small red or gray one. `label` names it where the word differs ("起動中" for a terminal).
export function statusIcon(status: OrcaStatus, label = STATUS_LABELS[status]) {
  const icon = tag("span", "orca-ic");
  icon.dataset.status = status;
  icon.setAttribute("role", "img");
  icon.setAttribute("aria-label", label);
  if (status === "question") icon.innerHTML = ASK_SVG;
  else if (status === "monitoring") icon.innerHTML = ACTIVITY_SVG;
  else icon.append(tag("span", `orca-mark ${status}`));
  return icon;
}
