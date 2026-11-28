// The load of the machines and the cached AI usage in the footer (A-48): for this Mac and for each saved environment, its CPU and its memory, plus Claude Code and Antigravity usage read from the local statusLine cache, and, pressed, the pane "リソース" from the right with the whole of them.
// Rust reads Orca (`machine_resources` every 5 seconds) and the local cache (`ai_usage_read` every 15 seconds); this module only reads those commands and draws, as text.
import type { AiUsageCache } from "./bindings/AiUsageCache";
import type { AiUsageEntry } from "./bindings/AiUsageEntry";
import type { MachineResources } from "./bindings/MachineResources";
import type { UsageWindow } from "./bindings/UsageWindow";
import { $, el, span, tag } from "./dom.js";
import { periodMs } from "./e2e-timers.js";
import { closeOtherPanes, registerPane } from "./footer.js";
import { hhmm, WEEKDAYS } from "./format.js";
import { ANTIGRAVITY_SVG, CLAUDE_SVG } from "./icons.js";
import { invoke } from "./ipc.js";

const RESOURCES_MS = 5_000;
const USAGE_MS = 15_000;
// A number at or over this is drawn in orange.
const HOT = 80;
const NONE = "—";

// The last answers; null until the first one is back.
let resources: MachineResources[] | null = null;
let usage: AiUsageCache | null = null;
let readingResources = false;
let readingUsage = false;

const isOpen = () => !$("resource-pane").hidden;

const num = (value: number | null) => {
  const node = tag("b", "stat-num", value === null ? NONE : `${value}%`);
  node.classList.toggle("hot", value !== null && value >= HOT);
  return node;
};

const stat = (label: string, value: number | null) => {
  const node = span("stat", "");
  node.append(`${label} `, num(value));
  return node;
};

function aiIcon(kind: "claude" | "antigravity") {
  const node = tag("span", "stat-icon");
  node.dataset.ai = kind;
  node.innerHTML = kind === "claude" ? CLAUDE_SVG : ANTIGRAVITY_SVG;
  return node;
}

// Returns the used percent of `w` if it exists and has not passed its reset time.
function livePercent(w: UsageWindow | null | undefined, now: number): number | null {
  if (!w) return null;
  if (w.resetsAt !== null && w.resetsAt <= now) return null;
  return w.usedPercent;
}

function aiStat(name: string, kind: "claude" | "antigravity", entry: AiUsageEntry, now: number) {
  const node = span("stat-ai", "");
  const icon = aiIcon(kind);
  icon.setAttribute("role", "img");
  icon.setAttribute("aria-label", name);
  node.append(icon, num(livePercent(entry.weekly, now)));
  return node;
}

function machineChip(m: MachineResources) {
  const chip = span("stat-machine", "");
  const ok = m.error === null;
  chip.append(tag("b", "stat-name", m.name), stat("CPU", ok ? m.cpuPercent : null), stat("メモリ", ok ? m.memoryPercent : null));
  return chip;
}

function aiChip(cache: AiUsageCache, now: number): HTMLElement | null {
  const items: Node[] = [];
  if (cache.claude) items.push(aiStat("Claude", "claude", cache.claude, now));
  if (cache.antigravity) items.push(aiStat("Antigravity", "antigravity", cache.antigravity, now));
  if (items.length === 0) return null;
  const chip = span("stat-machine", "");
  chip.append(...items);
  return chip;
}

function drawFooter() {
  const button = $("footer-stats");
  const now = Date.now();
  const chips: Node[] = [];
  for (const m of resources ?? []) chips.push(machineChip(m));
  const ai = usage ? aiChip(usage, now) : null;
  if (ai) chips.push(ai);
  if (chips.length === 0) {
    button.hidden = true;
    button.replaceChildren();
    return;
  }
  button.hidden = false;
  // A separator stands between two groups.
  button.replaceChildren(...chips.flatMap((c, i): Node[] => (i === 0 ? [c] : [tag("i", "stat-sep"), c])));
}

// A line of the pane: the key, the number, and under them the small text (the load and the cores, the bytes, the reset) when there is one.
function row(label: string, value: number | null, sub = "") {
  const node = el("res-row");
  node.append(span("res-key", label), num(value));
  if (sub) node.append(span("res-sub", sub));
  return node;
}

const gb = (bytes: number) => Number((bytes / 1024 ** 3).toFixed(1));

const resetText = (ms: number) => {
  const d = new Date(ms);
  return `${WEEKDAYS[d.getDay()]} ${hhmm(d.getHours() * 60 + d.getMinutes())} にリセット`;
};

const updatedText = (ms: number) => {
  const d = new Date(ms);
  return `${d.getMonth() + 1}/${d.getDate()} ${hhmm(d.getHours() * 60 + d.getMinutes())} 更新`;
};

function aiGroup(name: string, kind: "claude" | "antigravity", entry: AiUsageEntry, now: number) {
  const group = el("res-group");
  const title = el("res-group-name");
  title.append(aiIcon(kind), name, span("res-updated", updatedText(entry.updatedAt)));
  group.append(title);
  if (entry.session) {
    const pct = livePercent(entry.session, now);
    group.append(row("5 時間", pct, pct !== null && entry.session.resetsAt !== null ? resetText(entry.session.resetsAt) : ""));
  }
  const wpct = livePercent(entry.weekly, now);
  group.append(row("weekly", wpct, wpct !== null && entry.weekly?.resetsAt != null ? resetText(entry.weekly.resetsAt) : ""));
  return group;
}

function machineSection(m: MachineResources) {
  const section = tag("section", "res-machine");
  section.append(tag("h3", "", m.name));
  const ok = m.error === null;
  const load = ok && m.loadAverage !== null && m.cores !== null ? `${m.loadAverage.toFixed(2)} / ${m.cores} コア` : "";
  const bytes = ok && m.usedBytes !== null && m.totalBytes !== null ? `${gb(m.usedBytes)} / ${gb(m.totalBytes)} GB` : "";
  section.append(row("CPU", ok ? m.cpuPercent : null, load), row("メモリ", ok ? m.memoryPercent : null, bytes));
  return section;
}

function aiSection(cache: AiUsageCache, now: number): HTMLElement | null {
  if (!cache.claude && !cache.antigravity) return null;
  const section = tag("section", "res-machine");
  section.append(tag("h3", "", "AI 利用率"));
  if (cache.claude) section.append(aiGroup("Claude", "claude", cache.claude, now));
  if (cache.antigravity) section.append(aiGroup("Antigravity", "antigravity", cache.antigravity, now));
  return section;
}

function drawPane() {
  if (!isOpen()) return;
  const now = Date.now();
  const sections: Node[] = (resources ?? []).map(machineSection);
  const ai = usage ? aiSection(usage, now) : null;
  if (ai) sections.push(ai);
  $("resource-pane-list").replaceChildren(...sections);
}

const draw = () => {
  drawFooter();
  drawPane();
};

// A read that fails leaves what was read (Rust answers every machine, with its error, so a rejection is the call itself failing).
async function readResources() {
  if (document.hidden || readingResources) return;
  readingResources = true;
  try {
    resources = await invoke("machine_resources");
    draw();
  } catch {
    // Nothing to draw again.
  } finally {
    readingResources = false;
  }
}

export async function refreshAiUsage() {
  if (document.hidden || readingUsage) return;
  readingUsage = true;
  try {
    usage = await invoke("ai_usage_read");
    draw();
  } catch {
    // Nothing to draw again.
  } finally {
    readingUsage = false;
  }
}

function close() {
  $("resource-pane").hidden = true;
  $("footer-stats").setAttribute("aria-expanded", "false");
}

function toggle() {
  if (isOpen()) return close();
  closeOtherPanes("resources");
  $("resource-pane").hidden = false;
  $("footer-stats").setAttribute("aria-expanded", "true");
  drawPane();
  void readResources();
  void refreshAiUsage();
}

export function initMachineStats() {
  registerPane("resources", close);
  $("footer-stats").onclick = toggle;
  $("resource-pane-close").onclick = close;
  // A press outside the pane (the footer's own button excepted, which toggles it) closes it.
  document.addEventListener("mousedown", (e) => {
    const target = e.target as Element;
    if (isOpen() && !$("resource-pane").contains(target) && !$("footer-stats").contains(target)) close();
  });
  void readResources();
  void refreshAiUsage();
  setInterval(() => void readResources(), periodMs("machineResources", RESOURCES_MS));
  setInterval(() => void refreshAiUsage(), periodMs("aiUsage", USAGE_MS));
}
