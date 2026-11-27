// The Plugins tab of the settings screen (A-51): at the left the plugins of the owner (`~/.local/share/tsunagiai/plugins/` of this PC) with their skills as `plugin:skill`, and a plus that makes a new plugin;
// in the middle the tabs of the selected plugin, each a pane of Claude Code (A-36, `ts/claude-code.ts`) that runs in the plugin's folder with Claude Code's own tools and the `manual` permission mode, and a plus that adds a tab, and a file tab for each file opened from the tree (its path and a ✕; the editor is `ts/plugin-files.ts`, A-51, #1537); at the right (`plugin-files`) the file tree of the plugin's folder.
// Rust reads the folder and makes a plugin (`plugins_list`, `plugin_create`, `src-tauri/src/plugins.rs`) and starts the pane in the plugin's folder: the pane's id is `plugin:{folder}/{n}`, and Rust takes the folder out of it and checks it (`claude_code_start`); no path comes from here.
// The tabs belong to the plugin: another plugin shows its own tabs, and the processes of the others go on. The first pane of a plugin starts when the plugin is selected and the tab is in view.
// The terminal is hidden while the tab or the settings are left (the processes go on), and a plugin that left the folder takes its panes with it.
import type { Plugin } from "./bindings/Plugin";
import { closeClaudeCode, hideClaudeCode, isClaudeCodeShowing, showClaudeCode } from "./claude-code.js";
import { $, onEnter, tag } from "./dom.js";
import { logError, showFailure } from "./error-card.js";
import { CLOSE_SVG } from "./icons.js";
import { invoke } from "./ipc.js";
import { closeEditor, dropPlugin, initPluginFiles, isDirty, openEditor, rereadFiles, showEditor, showTree, watchFiles } from "./plugin-files.js";

// A tab of Claude Code, or (`file`: the path from the plugin's folder) the editor of a file.
interface PaneTab {
  id: string;
  title: string;
  file?: string;
}

// The tabs a plugin has open, the one shown, and how many it has opened (the number in the id of the next pane).
interface Open {
  tabs: PaneTab[];
  active: string;
  count: number;
}

// The owner of the terminals in ts/orca-terminal.ts.
const OWNER = "plugin-claude";

// The plugins as last read, the folder of the one selected, and what each plugin has open (by folder).
let plugins: Plugin[] = [];
let selected: string | null = null;
const open = new Map<string, Open>();
// Only the latest read may draw the list.
let listSeq = 0;
// A plugin is being made: another one waits.
let busy = false;

const paneId = (folder: string, n: number) => `plugin:${folder}/${n}`;

// Opens a new tab of Claude Code in the plugin `folder` and makes it the one shown. Nothing starts until `syncPane` shows it.
function openTab(folder: string) {
  const o = open.get(folder) ?? { tabs: [], active: "", count: 0 };
  const n = ++o.count;
  const id = paneId(folder, n);
  o.tabs.push({ id, title: n === 1 ? "Claude Code" : `Claude Code ${n}` });
  o.active = id;
  open.set(folder, o);
}

// Opens the file `relative` of the plugin `folder` in a tab of its own, or shows its tab when it is open.
function openFile(folder: string, relative: string) {
  const o = open.get(folder);
  if (!o) return;
  const id = `file:${relative}`;
  if (!o.tabs.some((t) => t.id === id)) o.tabs.push({ id, title: relative, file: relative });
  o.active = id;
  openEditor(folder, relative);
  if (folder === selected) drawTabs();
  syncPane();
}

// Ends the pane `id` of the plugin `folder` (for a file, closes its editor, which saves the typing first and stays when that fails) and takes its tab away; the tab next to it is shown in its place.
async function closeTab(folder: string, id: string) {
  const tab = open.get(folder)?.tabs.find((t) => t.id === id);
  if (!tab) return;
  if (tab.file !== undefined) {
    if (!(await closeEditor(folder, tab.file))) return;
  } else {
    closeClaudeCode(id, OWNER);
  }
  // The tabs may have changed while the editor saved.
  const o = open.get(folder);
  const at = o?.tabs.findIndex((t) => t.id === id) ?? -1;
  if (!o || at < 0) return;
  o.tabs.splice(at, 1);
  if (o.active === id) o.active = (o.tabs[at] ?? o.tabs[at - 1])?.id ?? "";
  if (folder === selected) drawTabs();
  syncPane();
}

// Shows the editor of the file tab that is shown, or the terminal of the Claude Code tab that is shown, while the tab of the settings is in view, and hides them (the processes go on) while it is not: another tab or screen is shown, or the window is hidden. The first show of a pane starts Claude Code. The clock that reads the files again runs only while the tab is in view and a plugin is selected.
function syncPane() {
  const host = $("plugin-term");
  const folder = selected;
  const o = folder === null ? undefined : open.get(folder);
  const file = o?.tabs.find((t) => t.id === o.active)?.file;
  // The terminal gives its place to the editor of a file tab.
  host.hidden = file !== undefined;
  const inView = folder !== null && !document.hidden && $("plugin-files").getClientRects().length > 0;
  watchFiles(inView);
  showEditor(inView ? folder : null, file ?? null);
  if (folder === null || !o?.active || file !== undefined || !inView || host.getClientRects().length === 0) return hideClaudeCode(OWNER);
  const id = o.active;
  if (!isClaudeCodeShowing(host, id, OWNER)) showClaudeCode(host, { id, builtinTools: true, onEnd: () => void closeTab(folder, id) }, OWNER);
}

// The tabs of the plugin selected, marked as the tabs of the Orca work pane are, and the plus that adds one.
function drawTabs() {
  const o = selected === null ? undefined : open.get(selected);
  const folder = selected;
  $("plugin-tabs").replaceChildren(
    ...(o?.tabs ?? []).map((t) => {
      const wrap = tag("div", "plugin-tab");
      wrap.setAttribute("role", "presentation");
      const select = tag("button", "plugin-tab-btn");
      select.type = "button";
      select.setAttribute("role", "tab");
      select.setAttribute("aria-selected", String(t.id === o?.active));
      select.append(tag("span", "plugin-tab-title", t.title));
      if (folder !== null && t.file !== undefined && isDirty(folder, t.file)) select.append(tag("span", "plugin-tab-dirty"));
      select.onclick = () => {
        if (!o) return;
        o.active = t.id;
        drawTabs();
        syncPane();
        // A tab shown again may hold what Claude Code of another tab wrote meanwhile.
        rereadFiles();
      };
      // The close button is beside the tab, not in it, so that pressing it never selects the tab.
      const close = tag("button", "icon-btn plugin-tab-close");
      close.type = "button";
      close.setAttribute("aria-label", "閉じる");
      close.innerHTML = CLOSE_SVG;
      close.onclick = () => folder !== null && void closeTab(folder, t.id);
      wrap.append(select, close);
      return wrap;
    }),
  );
  $<HTMLButtonElement>("plugin-tab-add").disabled = selected === null;
}

function drawList() {
  if (plugins.length === 0) return $("plugin-list").replaceChildren(tag("div", "item-meta plugin-empty", "プラグインはまだありません"));
  $("plugin-list").replaceChildren(
    ...plugins.map((p) => {
      const item = tag("div", "plugin-item");
      const row = tag("button", "plugin-row");
      row.type = "button";
      row.setAttribute("aria-current", String(p.folder === selected));
      row.append(tag("div", "item-name", p.name));
      row.onclick = () => selectPlugin(p.folder);
      item.append(row, ...p.skills.map((s) => tag("div", "item-meta plugin-skill", `${p.name}:${s}`)));
      return item;
    }),
  );
}

// Selects the plugin `folder`: its tabs are shown, and a plugin with none opens its first.
function selectPlugin(folder: string) {
  selected = folder;
  if (!open.get(folder)?.tabs.length) openTab(folder);
  drawList();
  drawTabs();
  showTree(plugins.find((p) => p.folder === folder) ?? null);
  syncPane();
}

async function loadPlugins() {
  const seq = ++listSeq;
  let list: Plugin[];
  try {
    list = await invoke("plugins_list");
  } catch (e) {
    return logError("plugin-settings", e);
  }
  if (seq !== listSeq) return;
  plugins = list;
  // A plugin that left the folder takes its panes (and their processes) with it.
  for (const [folder, o] of [...open]) {
    if (list.some((p) => p.folder === folder)) continue;
    for (const t of o.tabs) if (t.file === undefined) closeClaudeCode(t.id, OWNER);
    open.delete(folder);
    dropPlugin(folder);
    if (selected === folder) selected = null;
  }
  drawList();
  drawTabs();
  showTree(plugins.find((p) => p.folder === selected) ?? null);
  syncPane();
}

// The tab was shown: the plugins are read, and the pane of the plugin selected is shown.
export function showPluginsTab() {
  void loadPlugins();
  syncPane();
}

// The tab or the settings are left.
export function hidePluginClaude() {
  hideClaudeCode(OWNER);
  watchFiles(false);
}

async function createPlugin() {
  const input = $<HTMLInputElement>("plugin-new-name");
  const name = input.value.trim();
  if (busy || name === "") return;
  busy = true;
  let made: Plugin;
  try {
    made = await invoke("plugin_create", { name });
  } catch (e) {
    return showFailure("plugin-settings", e);
  } finally {
    busy = false;
  }
  input.value = "";
  $("plugin-new-row").hidden = true;
  await loadPlugins();
  if (plugins.some((p) => p.folder === made.folder)) selectPlugin(made.folder);
}

export function initPluginSettings() {
  $("plugin-new").onclick = () => {
    const row = $("plugin-new-row");
    row.hidden = !row.hidden;
    if (!row.hidden) $("plugin-new-name").focus();
  };
  const input = $<HTMLInputElement>("plugin-new-name");
  onEnter(input, () => void createPlugin());
  const base = input.onkeydown;
  input.onkeydown = (e) => {
    if (e.key === "Escape") {
      input.value = "";
      $("plugin-new-row").hidden = true;
      return;
    }
    base?.call(input, e);
  };
  $("plugin-tab-add").onclick = () => {
    if (selected === null) return;
    openTab(selected);
    drawTabs();
    syncPane();
  };
  initPluginFiles({
    open: openFile,
    changed: () => drawTabs(),
    // A file that cannot be read is given back: its tab goes.
    failed: (folder, relative) => {
      const o = open.get(folder);
      const at = o?.tabs.findIndex((t) => t.file === relative) ?? -1;
      if (!o || at < 0) return;
      const [gone] = o.tabs.splice(at, 1);
      if (o.active === gone.id) o.active = (o.tabs[at] ?? o.tabs[at - 1])?.id ?? "";
      if (folder === selected) drawTabs();
      syncPane();
    },
  });
  document.addEventListener("visibilitychange", syncPane);
  // Another screen leaves through `ts/nav.ts`, which this tab is not in: the host loses its size then, and gets it back when the settings are shown on this tab again.
  new ResizeObserver(syncPane).observe($("plugin-term"));
  // The terminal's host has no size while a file tab holds its place, so the tree's is watched too.
  new ResizeObserver(syncPane).observe($("plugin-files"));
}
