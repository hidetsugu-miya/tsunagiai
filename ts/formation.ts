// The orchestration of the development screen (A-37): a formation selected in the list (formation-list.ts, under its heading at the top of the Orca screen's list) takes the place of the work pane of a project with two panes, the tabs in the middle (the leader's terminal and the children's, formation-flow.ts) and the flow at the right, a column of cards. While a project or a session is selected, or nothing, the work pane of Orca is shown.
// A formation belongs to one PC. Its orchestrator runs in a terminal of the Orca of that PC, this Mac's or a saved environment's (#1579), which Rust makes (`formation_orchestrator`) and which is shown here as a child's terminal is: streamed when the Orca screen streams that environment, else mirrored.
import type { FormationOrchestrator } from "./bindings/FormationOrchestrator";
import { $ } from "./dom.js";
import { ensureConsent } from "./formation-consent.js";
import { hideSession, isLeaderTab, onTabChange, showChild, startFlow, startList, stopFlow, switchFormation } from "./formation-flow.js";
import { currentFormation, drawNotices, formationEnvironment, initFormationList } from "./formation-list.js";
import { setNotice } from "./error-card.js";
import { invoke } from "./ipc.js";
import { redrawOrca, streamsEnvironment } from "./orca.js";
import { hideTerminals, isShowing, releaseTerminal, showTerminals } from "./orca-terminal.js";

// The name of the owner of the leader's terminal: what `hideTerminals` is told when the formation is deselected or the screen is left.
const OWNER = "formation-screen";

// The environment of this Mac in `FormationEntry.environment` and `FormationOrchestrator.environment`; the terminal source calls it null, as the Orca screen's.
const LOCAL = "local";
// The orchestrators of the formations, by the name of the formation: the terminal once Rust has made it (in memory only; Rust finds the recorded one again), the starts on their way, and the words of the ones that failed.
const terminals = new Map<string, FormationOrchestrator>();
const starting = new Set<string>();
// The formations whose orchestrator's terminal has ended (it left its Orca's list: Claude Code ended and the terminal went with it). The last screen stays drawn; the handle is dropped at the next show of the formation, which asks Rust again (it makes a new terminal when none is listed).
const ended = new Set<string>();
const failures = new Map<string, string>();

// The card of a failure of the leader's terminal (A-28): it is there while the leader's tab of that formation is shown, and goes when the formation is pressed again (which tries again), when another tab or formation is shown and when the screen is left.
const NOTICE_TERM = "formation:terminal";

// Whether the development screen is shown (set by `showFormation` and `hideFormation`).
let onScreen = false;

// Shows the terminal of the orchestrator of the formation that is shown, and hides the one of another (its process goes on). The process starts with the first show of a formation, and a show of a running one starts nothing (A-36).
// Nothing is shown while the screen is left: a selection or a deletion that ends then (it was on its way when the owner left) must not take the hidden pane.
// While no formation is selected the middle pane is not shown, and no orchestrator is started.
function showPane() {
  if (!onScreen) return;
  const name = currentFormation();
  if (name === null) {
    setNotice(NOTICE_TERM, null);
    return hideTerminals(OWNER);
  }
  const host = $("formation-term");
  const said = failures.get(name) ?? null;
  // The leader's terminal and its words are shown only while the leader's tab is the selected one; a child's tab shows the child's terminal under the strip (formation-flow.ts), and the leader's process goes on.
  const leader = isLeaderTab();
  host.hidden = !leader;
  setNotice(NOTICE_TERM, said !== null && leader ? { text: said } : null);
  if (!leader) return hideTerminals(OWNER);
  showLeader(name, host, said);
}

// Shows the terminal of the orchestrator of a formation, and starts it when it has none and no failure is on the screen (a failure is tried again by pressing the formation again).
function showLeader(name: string, host: HTMLElement, failure: string | null) {
  if (ended.delete(name)) dropLeader(name);
  const got = terminals.get(name);
  if (!got) {
    hideTerminals(OWNER);
    if (failure === null) void startLeader(name);
    return;
  }
  host.classList.add("claude-code-pane");
  // The terminal is read and typed into in the Orca of the formation's environment.
  const environment = got.environment === LOCAL ? null : got.environment;
  const kind = streamsEnvironment(environment) ? "stream" : "mirror";
  const placement = { id: got.handle, source: { kind, handle: got.handle, path: "", environment, onGone: () => gone(name, got.handle) } as const, host };
  if (!isShowing(placement, OWNER)) showTerminals([placement], got.handle, OWNER);
}

// The screen forgets the terminal of the orchestrator of `name`.
function dropLeader(name: string) {
  const got = terminals.get(name);
  if (got) releaseTerminal(got.handle, OWNER);
  terminals.delete(name);
}

// The terminal `handle` of `name` left the list of its Orca. The terminal stays as it was drawn; the next show of the formation drops it and asks Rust for the leader again. A terminal that this screen no longer holds for `name` is not the leader's end.
function gone(name: string, handle: string) {
  if (terminals.get(name)?.handle === handle) ended.add(name);
}

// Asks Rust for the terminal of the orchestrator of `name` (one start at a time for a formation), and shows it when that formation is still the one shown.
async function startLeader(name: string) {
  if (starting.has(name)) return;
  starting.add(name);
  failures.delete(name);
  try {
    // A formation made before the owner's consent for its PC (#893) asks for it first. When the owner declines nothing is started, and nothing is shown: pressing the formation again asks again.
    if (!(await ensureConsent($("formation-head"), formationEnvironment(name)))) {
      starting.delete(name);
      return;
    }
    terminals.set(name, await invoke("formation_orchestrator", { name, restart: false }));
  } catch (e) {
    failures.set(name, String(e));
  } finally {
    starting.delete(name);
  }
  if (currentFormation() === name) showPane();
}

// The panes of the formation take the place of the work pane of Orca while a formation is selected, and the other way round. The list is read while the screen is shown, and the children of the selected formation with it.
function syncPanes() {
  if (!onScreen) return;
  const formation = currentFormation() !== null;
  $("formation").hidden = !formation;
  $("orca-session").hidden = formation;
  if (formation) startFlow();
  else {
    startList();
    hidePanes();
  }
  showPane();
}

// The development screen is shown.
export function showFormation() {
  onScreen = true;
  syncPanes();
}

export function initFormation() {
  // The tab changes between the leader's and a child's: the leader's terminal is hidden or shown.
  onTabChange(showPane);
  // Another formation is selected in the list, or none (a project or a session is): the panes of the selection are shown, its flow is read in place of the last one's, and its orchestrator is shown in the middle.
  initFormationList(
    (name) => {
      // A formation that is pressed again tries again after a failure.
      if (name !== null) failures.delete(name);
      switchFormation();
      syncPanes();
      redrawOrca();
    },
    // A formation was deleted: Rust has closed its orchestrator's terminal, so the screen drops it. The release hides the shown terminal of this owner too, so the shown formation's is shown again.
    (name) => {
      dropLeader(name);
      ended.delete(name);
      failures.delete(name);
      showPane();
    },
    // The row of a child in the list was pressed, after its formation was selected: the child's tab is shown.
    showChild,
  );
}

// The screen is left: the terminals are hidden (the orchestrator's process goes on, the children's mirrors stop), and nothing is read.
export function hideFormation() {
  onScreen = false;
  setNotice(NOTICE_TERM, null);
  drawNotices();
  stopFlow();
  hidePanes();
}

// Only the terminals are hidden.
function hidePanes() {
  hideSession();
  hideTerminals(OWNER);
}
