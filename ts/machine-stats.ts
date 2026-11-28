// The load of the machines in the footer (A-48): for this Mac and for each saved environment, its CPU and its memory, and, pressed, the pane "リソース" from the right with the whole of them.
// Rust reads Orca (`machine_resources` every 5 seconds); this module only reads that command and draws, as text. A read does not start while the window is hidden or while the one before it is not back, and the machines drawn are always the last answer, so a saved environment that left the list is not drawn or read again.
import type { MachineResources } from "./bindings/MachineResources";
import { $, el, span, tag } from "./dom.js";
import { periodMs } from "./e2e-timers.js";
import { closeOtherPanes, registerPane } from "./footer.js";
import { invoke } from "./ipc.js";

const RESOURCES_MS = 5_000;
// A number at or over this is drawn in orange.
const HOT = 80;
const NONE = "—";

// The last answers; null until the first one is back.
let resources: MachineResources[] | null = null;
let readingResources = false;

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

function machineChip(m: MachineResources) {
  const chip = span("stat-machine", "");
  const ok = m.error === null;
  chip.append(tag("b", "stat-name", m.name), stat("CPU", ok ? m.cpuPercent : null), stat("メモリ", ok ? m.memoryPercent : null));
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

function machineSection(m: MachineResources) {
  const section = tag("section", "res-machine");
  section.append(tag("h3", "", m.name));
  const ok = m.error === null;
  const load = ok && m.loadAverage !== null && m.cores !== null ? `${m.loadAverage.toFixed(2)} / ${m.cores} コア` : "";
  const bytes = ok && m.usedBytes !== null && m.totalBytes !== null ? `${gb(m.usedBytes)} / ${gb(m.totalBytes)} GB` : "";
  section.append(row("CPU", ok ? m.cpuPercent : null, load), row("メモリ", ok ? m.memoryPercent : null, bytes));
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
  setInterval(readResources, periodMs("machineResources", RESOURCES_MS));
}
