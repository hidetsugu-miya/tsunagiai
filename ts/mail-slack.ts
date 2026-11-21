// The Slack post pane on the right of an open mail (S-28): opened and closed by the # of the row of operations (`#thread-slack`).
// Its header has the button of the channel it posts to (`# name`, which opens a list of the channels of every connected workspace, grouped by workspace, with a search field) and a close button; its foot has the text field and the send button.
// The field starts empty (nothing of the mail is put in it). The send is `slack_channel_post` (S-21, as plain text), and the list is `slack_channels` of each workspace of `slack_load`.
// The channel last chosen (the one last posted to, or the last one picked) stays chosen while the app runs; it is kept in memory only, in no file. view.ts shows the pane while a thread is open (`mailSlackOpen`).
import type { Channel } from "./bindings/Channel";
import type { Workspace } from "./bindings/Workspace";
import { $, composing, isMac, partMatcher, tag } from "./dom.js";
import { invoke } from "./ipc.js";
import { closeMenu, showMenu } from "./menu.js";
import { setScreen } from "./nav.js";
import { toast } from "./toast.js";

// Where the post goes.
interface Chosen {
  teamId: string;
  channel: string;
  name: string;
}
let chosen: Chosen | null = null;
// Whether the pane is open, and whether a post is on its way (the field, the channel button and the send button are off then, so that a text is never posted twice).
let open = false;
let posting = false;
// The latest load of the list; an earlier one that answers late draws nothing.
let listSeq = 0;

const field = () => $<HTMLTextAreaElement>("mail-slack-text");

export const mailSlackOpen = () => open;

// A mail is opened (S-28): the text written for the mail before is not the new one's, so the field and its error are emptied; a text whose post is still on its way stays.
export function resetMailSlack() {
  if (posting) return;
  field().value = "";
  $("mail-slack-error").hidden = true;
  draw();
}

// Draws what follows from the state: the chosen channel on its button, and which of the field, the channel button and the send button can be used.
function draw() {
  const button = $<HTMLButtonElement>("mail-slack-channel");
  const name = tag("span", "name", chosen ? `#${chosen.name}` : "#");
  const chevron = document.createElement("span");
  chevron.innerHTML = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 9l6 6 6-6"/></svg>';
  button.replaceChildren(name, chevron.firstElementChild!);
  button.setAttribute("aria-label", chosen ? `投稿先: #${chosen.name}` : "投稿先のチャンネル");
  button.disabled = posting;
  field().disabled = posting;
  $<HTMLButtonElement>("mail-slack-send").disabled = posting || !chosen || !field().value.trim();
}

function setOpen(on: boolean) {
  open = on;
  closeMenu();
  $("mail-side").hidden = $("mail-split").hidden = $("mail-slack").hidden = !on;
  $("thread-slack").setAttribute("aria-pressed", String(on));
  if (!on) return;
  // The field opens empty; a text whose post is still on its way stays.
  if (!posting) field().value = "";
  $("mail-slack-error").hidden = true;
  draw();
  field().focus();
}

// Posts the field's text to the chosen channel. A failure shows the error and keeps the text (a toast when the pane is no longer shown); a success empties the field and says so.
async function post() {
  const to = chosen;
  const text = field().value;
  if (posting || !to || !text.trim()) return;
  $("mail-slack-error").hidden = true;
  posting = true;
  draw();
  try {
    await invoke("slack_channel_post", { teamId: to.teamId, channel: to.channel, text });
  } catch (e) {
    posting = false;
    draw();
    if ($("mail-slack").hidden) toast(`#${to.name} に投稿できませんでした: ${e}`);
    else {
      $("mail-slack-error").textContent = `投稿できませんでした: ${e}`;
      $("mail-slack-error").hidden = false;
    }
    return;
  }
  posting = false;
  field().value = "";
  draw();
  toast(`#${to.name} に投稿しました`);
}

// Draws the list of the channels, grouped by workspace, in `list`: the ones whose name holds `query`, and a line when none does. `pick` is called with the choice.
function drawList(list: HTMLElement, groups: { workspace: Workspace; channels: Channel[] | string }[], query: string, pick: (c: Chosen) => void) {
  const re = partMatcher(query);
  const nodes: Node[] = [];
  let hits = 0;
  for (const { workspace, channels } of groups) {
    if (typeof channels === "string") {
      // A workspace whose list could not be read says why, under its name.
      nodes.push(tag("div", "menu-group", workspace.team), tag("div", "menu-group fail", channels));
      continue;
    }
    const found = channels.filter((c) => !re || re.test(c.name));
    if (!found.length) continue;
    hits += found.length;
    nodes.push(tag("div", "menu-group", workspace.team));
    for (const c of found) {
      const b = tag("button", "", `#${c.name}`);
      b.type = "button";
      b.setAttribute("role", "menuitem");
      b.setAttribute("aria-current", String(chosen?.teamId === workspace.teamId && chosen.channel === c.id));
      b.onclick = () => pick({ teamId: workspace.teamId, channel: c.id, name: c.name });
      nodes.push(b);
    }
  }
  if (!hits && !groups.some((g) => typeof g.channels === "string")) nodes.push(tag("div", "menu-empty", "該当するチャンネルがありません"));
  list.replaceChildren(...nodes);
}

// Opens the list under the channel button: the workspaces are read (`slack_load`) and then the channels of each (`slack_channels`), and the search field narrows them as it is typed.
async function openList() {
  const anchor = $("mail-slack-channel");
  const pop = tag("div", "menu menu-searchable mail-slack-pop");
  pop.setAttribute("role", "menu");
  const input = tag("input", "menu-search");
  input.type = "text";
  input.placeholder = "検索";
  input.setAttribute("aria-label", "チャンネルを検索");
  input.autocomplete = "off";
  input.spellcheck = false;
  const list = tag("div", "menu-list");
  list.append(tag("div", "menu-empty", "読み込んでいます…"));
  pop.append(input, list);
  showMenu(anchor, pop);
  const seq = ++listSeq;
  let groups: { workspace: Workspace; channels: Channel[] | string }[] = [];
  const pick = (c: Chosen) => {
    chosen = c;
    $("mail-slack-error").hidden = true;
    closeMenu();
    draw();
    field().focus();
  };
  const redraw = () => drawList(list, groups, input.value, pick);
  input.oninput = redraw;
  input.onkeydown = (e) => {
    if (e.key !== "Enter" || composing(e)) return;
    e.preventDefault();
    list.querySelector<HTMLButtonElement>("button")?.click();
  };
  input.focus();
  try {
    const { workspaces } = await invoke("slack_load");
    if (seq !== listSeq || !pop.isConnected) return;
    if (!workspaces.length) {
      closeMenu();
      return toast("Slack のワークスペースを設定で追加してください", { label: "設定を開く", run: () => setScreen("settings", "slack") });
    }
    const got = await Promise.allSettled(workspaces.map((w) => invoke("slack_channels", { teamId: w.teamId, refresh: false })));
    if (seq !== listSeq || !pop.isConnected) return;
    groups = workspaces.map((workspace, i) => {
      const r = got[i];
      return { workspace, channels: r.status === "fulfilled" ? r.value : String(r.reason) };
    });
    redraw();
  } catch (e) {
    if (seq === listSeq && pop.isConnected) list.replaceChildren(tag("div", "menu-group fail", String(e)));
  }
}

export function initMailSlack() {
  $("thread-slack").onclick = () => setOpen(!open);
  $("mail-slack-close").onclick = () => setOpen(false);
  $("mail-slack-channel").onclick = openList;
  $("mail-slack-send").onclick = post;
  field().oninput = () => {
    $("mail-slack-error").hidden = true;
    draw();
  };
  // Enter is a line break; Cmd+Enter (Ctrl+Enter off macOS) posts, unless it only confirms an IME conversion (S-21).
  field().onkeydown = (e) => {
    if (e.key !== "Enter" || !(isMac ? e.metaKey : e.ctrlKey) || composing(e)) return;
    e.preventDefault();
    post();
  };
  draw();
}
