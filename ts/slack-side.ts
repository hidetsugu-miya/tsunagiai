// The Slack screen's side menu (S-19): a column at the left of the list and of the thread, like the Orca screen's list of projects.
// The two sections of the list ("未読メッセージ" with the number of unread messages, "ウォッチ"), and under them each workspace's joined channels by name, bold when unread.
// A channel shows the button that keeps it off the list (S-9) while it is hovered or has the focus. Pressing a channel opens its history (S-20), reads it as S-15 does, and the channel stays pressed.
// A workspace's heading is a button that folds the workspace: the channels with no unread message go, the unread ones and the one whose history is shown stay.
// Drawing only: what is held and what each press does belong to slack-list.ts. It is drawn again only when what it shows changes, and the focus stays.
import type { SideChannel } from "./bindings/SideChannel";
import type { SideWorkspace } from "./bindings/SideWorkspace";
import { $, tag } from "./dom.js";
import { BOOKMARK_SVG, CHEVRON_SVG, HASH_SVG, LOCK_SVG, MAIL_SVG, MINUS_CIRCLE_SVG, PLUS_SVG } from "./icons.js";
import { decorateAvatar, loadIcons, workspaceColor } from "./slack-view.js";
import { initSplit } from "./split.js";

export type SlackSection = "unread" | "watch";

export interface SideState {
  section: SlackSection;
  // The unread messages (the Slack button's badge counts them too).
  unread: number;
  // The channel whose history is shown (S-20), as `{teamId}/{channel}`; none while a section is.
  channel: string | null;
  workspaces: SideWorkspace[];
  // The `teamId`s of the folded workspaces.
  folded: string[];
  // The `teamId`s whose direct-message subsection is folded (S-31, memory only).
  dmFolded: string[];
}

export interface SideActions {
  choose: (section: SlackSection) => void;
  open: (teamId: string, team: string, channel: SideChannel) => void;
  hide: (teamId: string, channel: string, name: string, dm: boolean) => void;
  fold: (teamId: string) => void;
  foldDm: (teamId: string) => void;
  newDm: (teamId: string, team: string, anchor: HTMLElement) => void;
}

const isDm = (c: SideChannel) => c.kind === "im" || c.kind === "mpim";

let drawn = "";

function iconOf(svg: string) {
  const ic = tag("span", "slack-side-ic");
  ic.innerHTML = svg;
  return ic;
}

function countOf(n: number) {
  return tag("span", "slack-side-n", n > 99 ? "99+" : String(n));
}

function dmMarkOf(c: SideChannel) {
  if (c.kind === "mpim") return tag("span", "slack-dm-mpim", String(c.memberCount ?? 2));
  const av = tag("span", "avatar slack-dm-av");
  decorateAvatar(av, c.name, c.iconUrl ?? null);
  return av;
}

function modeButton(section: SlackSection, state: SideState, actions: SideActions) {
  const button = tag("button", "slack-side-mode");
  button.type = "button";
  button.dataset.key = section;
  button.setAttribute("aria-pressed", String(state.channel === null && state.section === section));
  button.append(iconOf(section === "unread" ? MAIL_SVG : BOOKMARK_SVG), tag("span", "slack-side-name", section === "unread" ? "未読メッセージ" : "ウォッチ"));
  if (section === "unread" && state.unread > 0) button.append(countOf(state.unread));
  button.onclick = () => actions.choose(section);
  return button;
}

// A channel or DM: a button (pressed while its history is shown) with its mark, its name and its unread number, and beside it (not in it: a button is not put in a button) the one that keeps it off the list.
function channelNode(state: SideState, w: SideWorkspace, c: SideChannel, actions: SideActions) {
  const teamId = w.teamId;
  const dm = isDm(c);
  const item = tag("div", "slack-side-item");
  const classes = ["slack-side-btn", ...(dm ? ["dm-row"] : []), ...(c.unread > 0 ? ["unread"] : [])].join(" ");
  const button = tag("button", classes);
  button.type = "button";
  button.dataset.key = `${teamId}/${c.id}`;
  button.setAttribute("aria-pressed", String(state.channel === `${teamId}/${c.id}`));
  button.onclick = () => actions.open(teamId, w.team, c);
  const name = tag("span", "slack-side-name", c.name);
  if (c.selfDm) name.append(tag("span", "slack-dm-self", "(自分)"));
  button.append(dm ? dmMarkOf(c) : iconOf(c.private ? LOCK_SVG : HASH_SVG), name);
  if (c.unread > 0) button.append(countOf(c.unread));
  const hide = tag("button", "icon-btn slack-side-hide");
  hide.type = "button";
  hide.dataset.key = `${teamId}/${c.id}/hide`;
  hide.setAttribute("aria-label", dm ? `${c.name} を一覧に出さない` : `#${c.name} を一覧に出さない`);
  hide.innerHTML = MINUS_CIRCLE_SVG;
  hide.onclick = () => actions.hide(teamId, c.id, c.name, dm);
  item.append(button, hide);
  return item;
}

// A workspace's heading: a button (`aria-expanded` is true while its channels are all shown) with the turn mark, the workspace's dot and its name.
function groupNode(state: SideState, w: SideWorkspace, actions: SideActions) {
  const group = tag("button", "slack-side-group");
  group.type = "button";
  group.dataset.key = `${w.teamId}/fold`;
  group.setAttribute("aria-expanded", String(!state.folded.includes(w.teamId)));
  const dot = tag("i", "slack-side-ws");
  dot.style.background = workspaceColor(w.team);
  group.append(iconOf(CHEVRON_SVG), dot, tag("span", "slack-side-name", w.team));
  group.onclick = () => actions.fold(w.teamId);
  return group;
}

// The DM subheading inside a workspace (S-31): a collapsible heading and a "+" button to start a new DM.
function dmHeadNode(state: SideState, w: SideWorkspace, actions: SideActions) {
  const row = tag("div", "slack-side-subrow");
  const toggle = tag("button", "slack-side-sub");
  toggle.type = "button";
  toggle.dataset.key = `${w.teamId}/dm-fold`;
  toggle.setAttribute("aria-expanded", String(!state.dmFolded.includes(w.teamId)));
  toggle.append(iconOf(CHEVRON_SVG), tag("span", "slack-side-name", "ダイレクトメッセージ"));
  toggle.onclick = () => actions.foldDm(w.teamId);
  const add = tag("button", "icon-btn slack-side-add");
  add.type = "button";
  add.dataset.key = `${w.teamId}/dm-add`;
  add.setAttribute("aria-label", `${w.team} でダイレクトメッセージを作成`);
  add.innerHTML = PLUS_SVG;
  add.onclick = () => actions.newDm(w.teamId, w.team, add);
  row.append(toggle, add);
  return row;
}

function visibleWhenFolded(state: SideState, teamId: string, list: SideChannel[]) {
  return list.filter((c) => c.unread > 0 || state.channel === `${teamId}/${c.id}`);
}

function workspaceNodes(state: SideState, w: SideWorkspace, actions: SideActions) {
  const wsFolded = state.folded.includes(w.teamId);
  const dmFolded = state.dmFolded.includes(w.teamId);
  const channels = w.channels.filter((c) => !isDm(c));
  const dms = w.channels.filter(isDm);
  const shownCh = wsFolded ? visibleWhenFolded(state, w.teamId, channels) : channels;
  const shownDm = wsFolded || dmFolded ? visibleWhenFolded(state, w.teamId, dms) : dms;
  const nodes: HTMLElement[] = [groupNode(state, w, actions), ...shownCh.map((c) => channelNode(state, w, c, actions))];
  if (!wsFolded || shownDm.length > 0) {
    nodes.push(dmHeadNode(state, w, actions), ...shownDm.map((c) => channelNode(state, w, c, actions)));
  }
  return nodes;
}

export function drawSlackSide(state: SideState, actions: SideActions) {
  const key = JSON.stringify(state);
  if (key === drawn) return;
  drawn = key;
  const box = $("slack-side-feed");
  const top = box.scrollTop;
  const focused = (document.activeElement as HTMLElement | null)?.dataset?.key;
  const groups = state.workspaces.filter((w) => w.channels.length);
  box.replaceChildren(
    modeButton("unread", state, actions),
    modeButton("watch", state, actions),
    ...(groups.length ? [tag("div", "slack-side-sep")] : []),
    ...groups.flatMap((w) => workspaceNodes(state, w, actions)),
  );
  loadIcons(groups.flatMap((w) => w.channels.filter((c) => c.kind === "im").map((c) => c.iconUrl ?? null)));
  box.scrollTop = top;
  const target = focused ? box.querySelector<HTMLElement>(`[data-key="${CSS.escape(focused)}"]`) : null;
  if (target) {
    // The button that keeps a channel off the list is `visibility: hidden` until its row has the pointer or the focus, and a hidden element takes no focus: show it until it loses the focus.
    const item = target.classList.contains("slack-side-hide") ? target.closest(".slack-side-item") : null;
    if (item) {
      item.classList.add("keep");
      target.addEventListener("blur", () => item.classList.remove("keep"), { once: true });
    }
    target.focus({ preventScroll: true });
  }
}

export function initSlackSide() {
  initSplit($("slack-screen"), $("slack-side-split"), { side: "left", min: 0.15, max: 0.4, initial: 0.2, property: "--side-w" });
}
