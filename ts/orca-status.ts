// The icon of a status of Orca's list and its name (A-6, A-8), and the marks of a file's tab: the Orca screen draws them in its tabs and rows, and the window of a tab (A-46, `ts/popout.ts`) in its header, which does not load the screen.
import type { OrcaStatus } from "./bindings/OrcaStatus";
import { tag } from "./dom.js";
import { ACTIVITY_SVG, ASK_SVG, DATABASE_SVG, DEFINITION_SVG, DIFF_SVG, FILE_SVG, LOCK_SVG, TICKET_SVG } from "./icons.js";

// The name of each status icon (its `aria-label`).
export const STATUS_LABELS: Record<OrcaStatus, string> = { question: "入力待ち", failed: "失敗", working: "作業中", monitoring: "監視中", interrupted: "中断", done: "完了", idle: "動いていない" };

// The mark of a file's tab (the status icon of a terminal's).
export function fileIcon() {
  const icon = tag("span", "orca-ic orca-file-tab-ic");
  icon.innerHTML = FILE_SVG;
  return icon;
}

// The mark of the tab of a diff, of a definition, of a database and of a Jira ticket.
const documentIcon = (svg: string) => {
  const icon = tag("span", "orca-ic orca-file-tab-ic");
  icon.innerHTML = svg;
  return icon;
};
export const diffIcon = () => documentIcon(DIFF_SVG);
export const definitionIcon = () => documentIcon(DEFINITION_SVG);
export const databaseIcon = () => documentIcon(DATABASE_SVG);
export const ticketIcon = () => documentIcon(TICKET_SVG);

// The mark of the tab of a file outside the worktree: it is read only (A-34).
export function lockIcon() {
  const icon = tag("span", "orca-ic orca-file-tab-ic");
  icon.setAttribute("role", "img");
  icon.setAttribute("aria-label", "読み取り専用");
  icon.innerHTML = LOCK_SVG;
  return icon;
}

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
