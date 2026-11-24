// The tabs of the Orca screen that are shown in a window of their own (A-46; Rust: `orca_popout.rs`, the page of the window: `ts/popout.ts`).
// A tab in a window is away from its pane: `orca_panes` keeps its place in the saved layout and leaves it out of the answer, so it is drawn nowhere on this screen, and its terminal is stopped here before the window shows it.
// The windows are held here by the id of their tab, as they were last given to Rust. What the owner does in a window (the red button closes the tab as the × of its pane does, the button at the right end puts it back) comes by the channel of `orca_popout_main`,
// and this module carries it out through the screen (`PopoutHost`) and then ends the window. A window whose tab left the list ends with it, and what the list says of a tab (its name, its status, where its terminal comes from) is given to its window at each draw.
// A window that is open when the page is loaded again (the screen holds nothing of it) is taken back from Rust.
import type { PopoutAction } from "./bindings/PopoutAction";
import type { PopoutTab } from "./bindings/PopoutTab";
import { invoke } from "./ipc.js";

// What the screen does for the windows: draws itself again, closes a tab as its pane's × does (and says whether it was closed), and shows a failure.
export interface PopoutHost {
  changed: () => void;
  close: (project: string, tab: string) => Promise<boolean>;
  failed: (e: unknown) => void;
}

const windows = new Map<string, PopoutTab>();
let host: PopoutHost = { changed: () => {}, close: async () => false, failed: () => {} };

// Whether the tab `tab` is in a window.
export const isAway = (tab: string) => windows.has(tab);

// The ids of the tabs of the project `project` that are in a window.
export const awayIn = (project: string) => [...windows.values()].filter((w) => w.project === project).map((w) => w.tab);

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
async function act(action: PopoutAction) {
  const entry = windows.get(action.tab);
  if (entry !== undefined && action.kind === "close" && !(await host.close(entry.project, entry.tab))) return;
  windows.delete(action.tab);
  await invoke("orca_popout_end", { tab: action.tab }).catch(host.failed);
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
    for (const tab of tabs) windows.set(tab.tab, tab);
    if (tabs.length > 0) host.changed();
  }, screen.failed);
}
