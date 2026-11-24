// The tabs of the Orca screen that are shown in a window of their own (A-46; Rust: `orca_popout.rs`, the page of the window: `ts/popout.ts`).
// A tab in a window is away from its pane: `orca_panes` keeps its place in the saved layout and leaves it out of the answer, so it is drawn nowhere on this screen, and its terminal is stopped here before the window shows it.
// The windows are held here by the id of their tab, as they were last given to Rust. What the owner does in a window (the red button closes the tab as the × of its pane does, the button at the right end puts it back) comes by the channel of `orca_popout_main`,
// and this module carries it out through the screen (`PopoutHost`) and then ends the window. A window whose tab left the list ends with it, and what the list says of a tab (its name, its status, where its terminal comes from) is given to its window at each draw.
// A window that is open when the page is loaded again (the screen holds nothing of it) is taken back from Rust.
// A diff, a definition and a database tab (A-24, A-34, A-43) stay in the memory of the screen, away from their pane: the window reads them again from the conditions it was given (`orca_popout_open`), and what it changes after that (the page of the records, the text of the SQL) is not taken back by a restore.
// A file in a window (A-18, A-29) is held by the page of its window, not here: it is saved and closed there before the tab leaves its pane, so this module keeps only its entry; the tab stays in the layout (it is away whether the list holds it or not), and coming back opens the file again in its pane with the id it had.
// What the editor of a file window opens next (the definition of a name, A-34) comes from the window by the same channel, and the screen shows it in its own pane.
import type { PopoutAction } from "./bindings/PopoutAction";
import type { PopoutTab } from "./bindings/PopoutTab";
import { invoke } from "./ipc.js";
import type { DefinitionOpen, DefinitionQuery } from "./orca-definition.js";
import { reserveId } from "./orca-editor.js";

// What the screen does for the windows: draws itself again, closes a tab as its pane's × does (and says whether it was closed), opens a file again in its pane (the window of a file was put back), shows the definition that the editor of a window asked for,
// opens a place that the definition tab of a window asked for, drops a connection that the database tab of a window found lost, and shows a failure.
export interface PopoutHost {
  changed: () => void;
  close: (project: string, tab: string) => Promise<boolean>;
  reopen: (entry: PopoutTab) => void;
  definition: (query: DefinitionQuery) => void;
  place: (place: DefinitionOpen) => void;
  lost: (connection: string, error: string) => void;
  failed: (e: unknown) => void;
}

const windows = new Map<string, PopoutTab>();
let host: PopoutHost = { changed: () => {}, close: async () => false, reopen: () => {}, definition: () => {}, place: () => {}, lost: () => {}, failed: () => {} };

// Whether the tab `tab` is in a window.
export const isAway = (tab: string) => windows.has(tab);

// The ids of the tabs of the project `project` that are in a window: a terminal while `live` (the tabs the list holds) has it, a file always (the window holds it).
export const awayIn = (project: string, live: string[]) => [...windows.values()].filter((w) => w.project === project && (w.content.kind === "file" || live.includes(w.tab))).map((w) => w.tab);

// The id of the tab that holds the file `relative` of the worktree at `path` in a window (`outside`: the file that a definition named outside the worktree), none when no window holds it: the file is not opened a second time.
export const awayFile = (target: string | null, project: string, path: string, relative: string, outside: boolean) =>
  [...windows.values()].find((w) => w.project === project && w.environment === target && w.content.kind === "file" && w.content.path === path && w.content.relative === relative && (w.content.server !== null) === outside)?.tab;

// Whether a window holds a file of the worktree at `path` of `target`: its language server is still wanted (A-34).
export const awayFileIn = (target: string | null, path: string) => [...windows.values()].some((w) => w.environment === target && w.content.kind === "file" && w.content.path === path);

// Puts the tab in a window: it leaves its pane at once (the draw stops its terminal here), and comes back when the window could not be made.
export async function popOut(tab: PopoutTab) {
  if (windows.has(tab.tab)) return;
  windows.set(tab.tab, tab);
  host.changed();
  try {
    await invoke("orca_popout_open", { tab });
  } catch (e) {
    if (windows.get(tab.tab) === tab) {
      windows.delete(tab.tab);
      // A file left the editor of this page to be saved and opened in the window: it is opened here again.
      host.reopen(tab);
      host.changed();
    }
    host.failed(e);
  }
}

// Brings the window of the tab `tab` to the front; false when it has none.
export function focusPopout(tab: string) {
  if (!windows.has(tab)) return false;
  invoke("orca_popout_focus", { tab }).catch(host.failed);
  return true;
}

// Carries out what the owner did in a window. A close that did not close the tab keeps the window; the tab that is not held any more only has its window ended.
// The page of a file window closed the file before it asked for the close or the restore, so only the restore has something to do for it: the file opens again in its pane. A diff, a definition and a database tab are kept by the screen, so the restore only shows them again.
async function act(action: PopoutAction) {
  const entry = windows.get(action.tab);
  if (action.kind === "definition") {
    if (entry !== undefined) host.definition({ ...action.query, tab: action.tab });
    return;
  }
  // The definition tab of a window opens a place in a pane of the screen, whose question is the tab's (the window's tab is in no pane, so the place opens beside the first pane that is not the definition's).
  if (action.kind === "place") {
    if (entry !== undefined) host.place({ definition: action.tab, query: { ...action.query, tab: action.tab }, path: action.path, outside: action.outside, line: action.line, character: action.character });
    return;
  }
  if (action.kind === "lost") {
    if (entry !== undefined) host.lost(action.connection, action.error);
    return;
  }
  if (entry !== undefined && action.kind === "close" && entry.content.kind !== "file" && !(await host.close(entry.project, entry.tab))) return;
  // A tab that the close removed from the screen has ended its window already (the draw that followed it).
  if (windows.delete(action.tab) || entry === undefined) await invoke("orca_popout_end", { tab: action.tab }).catch(host.failed);
  if (entry !== undefined && action.kind === "restore") host.reopen(entry);
  host.changed();
}

// Gives each window what the list says of its tab now: `look` answers the tab as it is (its id may have changed, a plain terminal where Claude starts), null when the list no longer has it (its window ends), and undefined when the list cannot say (it is not read, or not on the screen).
export function syncPopouts(look: (entry: PopoutTab) => PopoutTab | null | undefined) {
  for (const [id, entry] of [...windows]) {
    const now = look(entry);
    if (now === undefined) continue;
    if (now === null) {
      windows.delete(id);
      invoke("orca_popout_end", { tab: id }).catch(host.failed);
    } else if (JSON.stringify(now) !== JSON.stringify(entry)) {
      windows.delete(id);
      windows.set(now.tab, now);
      invoke("orca_popout_update", { was: id, tab: now }).catch(host.failed);
    }
  }
}

export function initPopout(screen: PopoutHost) {
  host = screen;
  const channel = new window.__TAURI__.core.Channel<PopoutAction>();
  channel.onmessage = (action) => void act(action);
  invoke("orca_popout_main", { channel }).then((tabs) => {
    for (const tab of tabs) {
      windows.set(tab.tab, tab);
      // The counter of the file ids passes a file that a window holds, so no file opened now takes its id.
      if (tab.content.kind === "file") reserveId(tab.tab);
    }
    if (tabs.length > 0) host.changed();
  }, screen.failed);
}
