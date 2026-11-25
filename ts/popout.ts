// The page of the window of a tab (A-46; `popout.html`, made by `orca_popout_open` of `orca_popout.rs`): a header with the tab's icon and name, the pin and the button that puts the tab back in its pane, and the tab under it.
// It is a page of its own, since `index.html` would start every screen again and answer the questions of the screen bridge twice. It loads only what draws a terminal (`orca-terminal.ts`), and the window has no permission of its own: what it does goes through the commands `orca_popout_*`.
// What the tab shows comes from Rust (`orca_popout_attach`) and again each time the Orca screen knows more of the tab (the channel it gives); the red button of the window is not here: Rust stops it and asks the Orca screen to close the tab,
// except for a file, whose text and save this page holds: Rust tells this page (the channel), which closes the file as the × of a pane does and then asks for the close (`orca_popout_close`).
// A kind of tab that this page can show has a function in `shows`; the terminal of a Claude session and of a plain terminal is shown as the Orca screen shows it (the owner of its terminals is this window), with the font and the colors the settings give the terminals.
// A diff, a definition and a database tab (A-24, A-34, A-43) are opened here with the modules of the Orca screen, from the conditions of the tab (the file of the difference and its commit, the question of the definition, the table with its tab, page and SQL); a diff is read again by the clock too, and a place that a definition tab opens is shown by the Orca screen in its own pane.
// A file (A-18, A-29) is opened here with the editor of the Orca screen (`ts/orca-editor.ts`), read from the disk again: nothing of the editor it left (the undo history, the scroll, the caret) comes with it. Its disk is read by the clock (the watch of the disk belongs to the Orca screen), its language server is the one that screen started, and what its editor opens next (a definition, A-34) is shown by the Orca screen in its own pane (`orca_popout_definition`).
import type { PopoutPage } from "./bindings/PopoutPage";
import type { PopoutTab } from "./bindings/PopoutTab";
import { $, tag } from "./dom.js";
import { periodMs } from "./e2e-timers.js";
import { CLOSE_SVG, fillIcons } from "./icons.js";
import { invoke } from "./ipc.js";
import { initToast, toast } from "./toast.js";
import { initTooltip } from "./tooltip.js";
import { setCopy, setCsvReport } from "./database-work.js";
import { closeFile, initOrcaEditor, openFile, refreshEditors, saveFile, setAutosaveMs, showEditors } from "./orca-editor.js";
import { closeDatabaseTab, initDatabaseTabs, restoreDatabaseTab, showDatabaseTabs } from "./orca-database-tabs.js";
import { closeDefinition, initDefinition, openDefinition, showDefinitions } from "./orca-definition.js";
import { closeDiff, openDiff, refreshDiffs, showDiffs } from "./orca-diff.js";
import { databaseIcon, definitionIcon, diffIcon, fileIcon, lockIcon, statusIcon } from "./orca-status.js";
import { applyTerminalFont, applyTerminalSettings, applyTerminalTheme, hideTerminals, initOrcaTerminal, showTerminals } from "./orca-terminal.js";

const OWNER = "orca-popout";

// The tab the window shows now, as the screen last said it.
let current: PopoutTab | null = null;

// A failure is written to the log and shown as a card (A-28), as `error-card.ts` does for the screens (which is not loaded here).
function fail(e: unknown) {
  const text = String(e);
  invoke("log_write", { level: "error", source: "orca-popout", message: text }).catch(() => {});
  if ([...document.querySelectorAll(".error-card-text")].some((n) => n.textContent === text)) return;
  const card = tag("div", "error-card");
  card.setAttribute("role", "alert");
  const close = tag("button", "icon-btn error-card-close");
  close.type = "button";
  close.setAttribute("aria-label", "閉じる");
  close.innerHTML = CLOSE_SVG;
  close.onclick = () => card.remove();
  const body = tag("div", "error-card-body");
  body.append(tag("div", "error-card-text", text));
  card.append(body, close);
  $("error-cards").prepend(card);
}

// The kinds of tab this page shows.
const shows: { [K in PopoutTab["content"]["kind"]]: (tab: PopoutTab & { content: { kind: K } }) => void } = {
  claude: (tab) => showTerminal(tab),
  terminal: (tab) => showTerminal(tab),
  file: (tab) => showFile(tab),
  diff: (tab) => {
    const { path, relative, commit } = tab.content;
    showDocument(tab, () => openDiff(tab.environment, tab.project, path, relative, commit), closeDiff, showDiffs);
  },
  definition: (tab) => {
    const { kind: _kind, ...query } = tab.content;
    showDocument(tab, () => openDefinition({ ...query, tab: tab.tab }).tab.id, closeDefinition, showDefinitions);
  },
  database: (tab) => {
    const { connection, name, database, table, tab: selected, page, sql } = tab.content;
    showDocument(tab, () => restoreDatabaseTab(tab.environment, tab.project, { connection, name, database, table, tab: selected, page, sql }).id, closeDatabaseTab, showDatabaseTabs);
  },
};

// The diff, the definition or the database tab that this page opened from the conditions of its tab: it is opened again only when the tab's conditions are other than the ones it was opened with (the screen gives the tab at each change of its name or status too).
let opened: { key: string; id: string; close: (id: string) => void } | null = null;

function showDocument(tab: PopoutTab, open: () => string, close: (id: string) => void, show: (placements: { id: string; host: HTMLElement }[]) => void) {
  showBody(true);
  const key = JSON.stringify([tab.environment, tab.project, tab.content]);
  if (opened?.key !== key) {
    opened?.close(opened.id);
    opened = { key, id: open(), close };
  }
  show([{ id: opened.id, host: $("popout-file") }]);
}

// The body is the terminal or the editor of the tab (a window shows one tab).
function showBody(file: boolean) {
  $("popout-term").hidden = file;
  $("popout-file").hidden = !file;
}

function showFile(tab: PopoutTab & { content: { kind: "file" } }) {
  const { path, relative, server } = tab.content;
  showBody(true);
  showEditors([{ id: openFile(tab.environment, tab.project, path, relative, server, tab.tab), host: $("popout-file") }]);
}

function showTerminal(tab: PopoutTab & { content: { kind: "claude" | "terminal" } }) {
  showBody(false);
  const { handle, path, stream, ended } = tab.content;
  const source = { kind: stream ? ("stream" as const) : ("mirror" as const), handle, path, environment: tab.environment, ended };
  showTerminals([{ id: handle, source, host: $("popout-term") }], handle, OWNER);
}

// The icon of the header: the one the tab has in its pane.
function iconOf(tab: PopoutTab) {
  const { content } = tab;
  if (content.kind === "file") return content.server === null ? fileIcon() : lockIcon();
  if (content.kind === "diff") return diffIcon();
  if (content.kind === "definition") return definitionIcon();
  if (content.kind === "database") return databaseIcon();
  return statusIcon(tab.status, tab.label);
}

// Draws the header, and the tab under it.
function draw(tab: PopoutTab) {
  current = tab;
  $("popout-icon").replaceChildren(iconOf(tab));
  $("popout-name").textContent = tab.title;
  document.title = tab.title;
  (shows[tab.content.kind] as (tab: PopoutTab) => void)(tab);
}

// The font, the colors and Ghostty's settings that the Orca screen gives its terminals (A-13, A-14, A-20), read again each time the page is made.
async function drawLook() {
  const [saved, themes, fonts, editor] = await Promise.all([invoke("ghostty_saved"), invoke("terminal_themes"), invoke("font_settings"), invoke("editor_settings")]);
  // The editor of a file takes the wait of its save and its font (A-18, A-20) as the Orca screen gives them.
  setAutosaveMs(editor.autosaveMs);
  const root = document.documentElement.style;
  if (fonts.editor.family) root.setProperty("--editor-family", `${JSON.stringify(fonts.editor.family)}, ui-monospace, Menlo, monospace`);
  root.setProperty("--editor-size", `${fonts.editor.size}px`);
  applyTerminalSettings(saved?.settings ?? null);
  const colorsOf = (name: string) => themes.themes.find((t) => t.name === name)?.colors;
  const [light, dark] = [colorsOf(themes.selection.light), colorsOf(themes.selection.dark)];
  applyTerminalTheme(light && dark ? { light, dark, appearance: themes.selection.appearance } : null);
  const pick = fonts.orcaWork;
  applyTerminalFont(pick.ghostty ? null : { family: pick.family, size: pick.size });
}

// The red button: a file is closed here as the × of a pane closes it (its typing saved first), and a save that fails keeps the window, with its message.
async function closeWindow() {
  if (current?.content.kind === "file" && !(await closeFile(current.tab))) return;
  invoke("orca_popout_close").catch(fail);
}

// The button at the right end. A file is saved first and closed here, and a save that failed or was refused keeps it in the window; the screen then opens it again in its pane. When the screen cannot be asked, the file is opened here again.
async function restore() {
  const tab = current;
  if (tab?.content.kind !== "file") {
    // The terminal stops here first, so the keys not sent yet go before the screen shows it again.
    hideTerminals(OWNER);
    invoke("orca_popout_restore").catch(fail);
    return;
  }
  if (!((await saveFile(tab.tab)) && (await closeFile(tab.tab)))) return;
  try {
    await invoke("orca_popout_restore");
  } catch (e) {
    fail(e);
    draw(tab);
  }
}

async function init() {
  fillIcons();
  initToast();
  initTooltip();
  initOrcaTerminal(fail, () => {});
  initOrcaEditor({
    changed: () => {
      if (current?.content.kind === "file") showFile(current as PopoutTab & { content: { kind: "file" } });
    },
    error: fail,
    definition: ({ tab: _tab, ...query }) => void invoke("orca_popout_definition", { query }).catch(fail),
    serve: () => {},
    mayAsk: () => true,
  });
  // What a definition tab opens, and a connection that a database tab found lost, are the screen's to show (A-46): the window tells it.
  initDefinition({ open: (place) => void invoke("orca_popout_place", { path: place.path, outside: place.outside, line: place.line, character: place.character }).catch(fail) });
  initDatabaseTabs({ lost: (connection, error) => void invoke("orca_popout_lost", { connection, error }).catch(fail) });
  setCsvReport({ saved: (text) => toast(text), failed: fail });
  setCopy(async (text) => {
    try {
      await navigator.clipboard.writeText(text);
    } catch (e) {
      fail(e);
    }
  });
  // The files and the diffs are read again by the clock while the window is seen, and once when it is seen again (the main screen does the same, A-18).
  const reread = () => {
    if (document.hidden) return;
    refreshEditors();
    refreshDiffs();
  };
  window.setInterval(reread, periodMs("orcaClock", 10_000));
  document.addEventListener("visibilitychange", reread);
  const pin = $<HTMLButtonElement>("popout-pin");
  pin.onclick = () => {
    const pinned = pin.getAttribute("aria-pressed") !== "true";
    pin.setAttribute("aria-pressed", String(pinned));
    invoke("orca_popout_pin", { pinned }).catch((e) => {
      pin.setAttribute("aria-pressed", String(!pinned));
      fail(e);
    });
  };
  $("popout-restore").onclick = () => void restore();
  const channel = new window.__TAURI__.core.Channel<PopoutPage>();
  channel.onmessage = (page) => (page.kind === "tab" ? draw(page.tab) : void closeWindow());
  try {
    await drawLook();
  } catch (e) {
    fail(e);
  }
  try {
    draw(await invoke("orca_popout_attach", { channel }));
  } catch (e) {
    fail(e);
  }
}

void init();
