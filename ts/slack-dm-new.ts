// New direct message popover (S-31): picks 1 to 8 active non-bot members of a workspace (`slack_users`) and opens or resumes a DM / group DM (`slack_open_dm`).
import type { SideChannel } from "./bindings/SideChannel";
import type { WorkspaceUser } from "./bindings/WorkspaceUser";
import { tag } from "./dom.js";
import { showFailure } from "./error-card.js";
import { invoke } from "./ipc.js";
import { closeMenu, showMenu } from "./menu.js";
import { decorateAvatar, loadIcons } from "./slack-view.js";

const MAX_USERS = 8;
const MAX_SHOWN = 50;

export function openNewDmMenu(
  anchor: HTMLElement,
  teamId: string,
  team: string,
  onOpened: (dm: SideChannel) => void,
) {
  const pop = tag("div", "pop dm-new-pop");
  pop.setAttribute("role", "dialog");
  pop.setAttribute("aria-label", "ダイレクトメッセージを作成");

  const head = tag("div", "dm-new-head");
  head.append(tag("span", "dm-new-title", "ダイレクトメッセージを作成"), tag("span", "dm-new-team", team));

  const chips = tag("div", "dm-new-chips");
  const search = tag("input", "dm-new-search");
  search.type = "text";
  search.placeholder = "相手を検索";
  search.setAttribute("aria-label", "相手を検索");

  const list = tag("div", "dm-new-list");
  list.append(tag("div", "dm-new-empty", "読み込んでいます…"));

  const cancel = tag("button", "text-btn", "キャンセル");
  cancel.type = "button";
  cancel.onclick = () => closeMenu();

  const openBtn = tag("button", "text-btn primary", "開く");
  openBtn.type = "button";
  openBtn.disabled = true;

  const actions = tag("div", "dm-new-actions");
  actions.append(cancel, openBtn);

  pop.append(head, chips, search, list, actions);

  let users: WorkspaceUser[] | null = null;
  let picked: WorkspaceUser[] = [];
  let busy = false;

  function render() {
    chips.replaceChildren(
      ...picked.map((u) => {
        const chip = tag("span", "chip dm-new-chip");
        chip.append(tag("span", "", u.selfUser ? `${u.name} (自分)` : u.name));
        const rm = tag("button", "dm-new-rm", "×");
        rm.type = "button";
        rm.setAttribute("aria-label", `${u.name} を外す`);
        rm.onclick = () => {
          picked = picked.filter((p) => p.id !== u.id);
          render();
        };
        chip.append(rm);
        return chip;
      }),
    );
    openBtn.disabled = busy || picked.length === 0;
    if (users === null) return;
    const q = search.value.trim().toLowerCase();
    const matched = users.filter((u) => !q || u.name.toLowerCase().includes(q)).slice(0, MAX_SHOWN);
    if (!matched.length) {
      list.replaceChildren(tag("div", "dm-new-empty", "該当する相手がいません"));
      return;
    }
    list.replaceChildren(
      ...matched.map((u) => {
        const selected = picked.some((p) => p.id === u.id);
        const btn = tag("button", selected ? "dm-new-user picked" : "dm-new-user");
        btn.type = "button";
        btn.dataset.uid = u.id;
        btn.setAttribute("aria-pressed", String(selected));
        const av = tag("span", "avatar slack-dm-av");
        decorateAvatar(av, u.name, u.iconUrl);
        const label = tag("span", "slack-side-name", u.name);
        if (u.selfUser) label.append(tag("span", "slack-dm-self", "(自分)"));
        btn.append(av, label);
        btn.onclick = () => {
          if (selected) picked = picked.filter((p) => p.id !== u.id);
          else if (picked.length < MAX_USERS) picked = [...picked, u];
          render();
        };
        return btn;
      }),
    );
    loadIcons(matched.map((u) => u.iconUrl));
  }

  search.oninput = render;
  openBtn.onclick = async () => {
    if (busy || !picked.length) return;
    busy = true;
    render();
    try {
      const opened = await invoke("slack_open_dm", { teamId, userIds: picked.map((u) => u.id) });
      if (!pop.isConnected) return;
      closeMenu();
      onOpened(opened);
    } catch (e) {
      if (!pop.isConnected) return;
      busy = false;
      render();
      showFailure("slack-dm-new", `DM を開けませんでした: ${e}`);
    }
  };

  showMenu(anchor, pop);
  search.focus();

  invoke("slack_users", { teamId }).then(
    (got) => {
      if (!pop.isConnected) return;
      users = got;
      render();
    },
    (e) => {
      if (!pop.isConnected) return;
      users = [];
      list.replaceChildren(tag("div", "dm-new-empty", "読み込めませんでした"));
      showFailure("slack-dm-new", `メンバーを読み込めませんでした: ${e}`);
    },
  );
}
