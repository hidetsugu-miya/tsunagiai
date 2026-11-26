// The load of the machines and the use of the AI in the footer (A-48): for this Mac and for each saved environment, its CPU, its memory and its Claude and Antigravity (weekly), and, pressed, the pane "リソース" from the right with the whole of them.
// Rust reads Orca (`machine_resources` every 5 seconds, `machine_usage` every 60 seconds); this module only reads those commands and draws, as text. A read does not start while the window is hidden or while the one before it is not back, and the machines drawn are always the last answer, so a saved environment that left the list is not drawn or read again.
import type { AiUsage } from "./bindings/AiUsage";
import type { MachineResources } from "./bindings/MachineResources";
import type { MachineUsage } from "./bindings/MachineUsage";
import type { UsageWindow } from "./bindings/UsageWindow";
import { $, el, span, tag } from "./dom.js";
import { periodMs } from "./e2e-timers.js";
import { closeOtherPanes, registerPane } from "./footer.js";
import { hhmm, WEEKDAYS } from "./format.js";
import { invoke } from "./ipc.js";

const RESOURCES_MS = 5_000;
const USAGE_MS = 60_000;
// A number at or over this is drawn in orange.
const HOT = 80;
const NONE = "—";

// The last answers; null until the first one is back.
let resources: MachineResources[] | null = null;
let usage: MachineUsage[] | null = null;
let readingResources = false;
let readingUsage = false;

const isOpen = () => !$("resource-pane").hidden;

const num = (value: number | null) => {
  const node = tag("b", "stat-num", value === null ? NONE : `${value}%`);
  node.classList.toggle("hot", value !== null && value >= HOT);
  return node;
};

// The share used of an AI's window, when Orca says the AI is readable (status ok) and gives the window.
const usedOf = (ai: AiUsage | undefined, which: "session" | "weekly") => (ai?.status === "ok" ? (ai[which]?.usedPercent ?? null) : null);

const stat = (label: string, value: number | null) => {
  const node = span("stat", "");
  node.append(`${label} `, num(value));
  return node;
};

// The weekly of an AI as a dot and a number; the dot says which AI, and the label gives its name to a reader that does not see the color.
function aiStat(name: string, kind: string, value: AiUsage | undefined) {
  const node = span("stat-ai", "");
  node.setAttribute("role", "group");
  node.setAttribute("aria-label", name);
  const dot = tag("i", "stat-dot");
  dot.dataset.ai = kind;
  node.append(dot, num(usedOf(value, "weekly")));
  return node;
}

function machineChip(m: MachineResources) {
  const chip = span("stat-machine", "");
  const ok = m.error === null;
  chip.append(tag("b", "stat-name", m.name), stat("CPU", ok ? m.cpuPercent : null), stat("メモリ", ok ? m.memoryPercent : null));
  // The AI of this machine: the row of the usage with the same environment, drawn once the first reading is back. A machine that gave nothing has only dashes, the AI's too.
  if (usage) {
    const mine = ok ? usage.find((u) => u.environment === m.environment) : undefined;
    chip.append(aiStat("Claude", "claude", mine?.claude), aiStat("Antigravity", "antigravity", mine?.antigravity));
  }
  return chip;
}

function drawFooter() {
  const button = $("footer-stats");
  if (!resources || resources.length === 0) {
    button.hidden = true;
    button.replaceChildren();
    return;
  }
  button.hidden = false;
  // A separator stands between two machines.
  button.replaceChildren(...resources.flatMap((m, i): Node[] => (i === 0 ? [machineChip(m)] : [tag("i", "stat-sep"), machineChip(m)])));
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

const windowRow = (label: string, ai: AiUsage | undefined, which: "session" | "weekly") => {
  const w: UsageWindow | null = ai?.status === "ok" ? (ai[which] ?? null) : null;
  return row(label, w?.usedPercent ?? null, w?.resetsAt != null ? resetText(w.resetsAt) : "");
};

function aiGroup(name: string, kind: string, ai: AiUsage | undefined) {
  const group = el("res-group");
  const title = el("res-group-name");
  const dot = tag("i", "stat-dot");
  dot.dataset.ai = kind;
  title.append(dot, name);
  group.append(title);
  // The window of 5 hours only where Orca gives one.
  if (ai?.status === "ok" && ai.session) group.append(windowRow("5 時間", ai, "session"));
  group.append(windowRow("weekly", ai, "weekly"));
  return group;
}

function machineSection(m: MachineResources) {
  const section = tag("section", "res-machine");
  section.append(tag("h3", "", m.name));
  const ok = m.error === null;
  const load = ok && m.loadAverage !== null && m.cores !== null ? `${m.loadAverage.toFixed(2)} / ${m.cores} コア` : "";
  const bytes = ok && m.usedBytes !== null && m.totalBytes !== null ? `${gb(m.usedBytes)} / ${gb(m.totalBytes)} GB` : "";
  section.append(row("CPU", ok ? m.cpuPercent : null, load), row("メモリ", ok ? m.memoryPercent : null, bytes));
  if (usage) {
    // A machine that gave nothing has only dashes, the AI's too.
    const mine = ok ? usage.find((u) => u.environment === m.environment) : undefined;
    section.append(aiGroup("Claude", "claude", mine?.claude), aiGroup("Antigravity", "antigravity", mine?.antigravity));
  }
  return section;
}

function drawPane() {
  if (!isOpen()) return;
  $("resource-pane-list").replaceChildren(...(resources ?? []).map(machineSection));
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

async function readUsage() {
  if (document.hidden || readingUsage) return;
  readingUsage = true;
  try {
    usage = await invoke("machine_usage");
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
  readResources();
  readUsage();
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
  readResources();
  readUsage();
  setInterval(readResources, periodMs("machineResources", RESOURCES_MS));
  setInterval(readUsage, periodMs("machineUsage", USAGE_MS));
}
