// The card of the menu in the Menu tab of the settings screen (A-50): one row for each screen of the sidebar, in the saved order, with the key that opens it and the switch that shows or hides it.
// Rust holds the list (`side-menu.json`, `ts/nav.ts` reads it too) and refuses a list that is not each screen once or that turns the inbox off; this module draws the rows, takes the drag of a row and the press of a switch,
// saves the whole list at once, and hands the saved list to the sidebar (`drawMenu` of `ts/nav.ts`), so the sidebar and the numbers of the keys change in place.
import type { MenuEntry } from "./bindings/MenuEntry";
import type { MenuScreen } from "./bindings/MenuScreen";
import type { MenuSettings } from "./bindings/MenuSettings";
import { $, isMac, tag } from "./dom.js";
import { logError, showFailure } from "./error-card.js";
import { hintPopup, toggleHint } from "./hint.js";
import { CALENDAR_SVG, DATABASE_SVG, DEVELOP_SVG, GRIP_SVG, INBOX_SVG, SLACK_SVG, TASK_SVG } from "./icons.js";
import { invoke } from "./ipc.js";
import { drawMenu } from "./nav.js";

// The name and the icon of each screen, as the sidebar's button has them.
const SCREENS: Record<MenuScreen, { name: string; icon: string }> = {
  mail: { name: "受信トレイ", icon: INBOX_SVG },
  calendar: { name: "カレンダー", icon: CALENDAR_SVG },
  todo: { name: "Todo", icon: TASK_SVG },
  slack: { name: "Slack", icon: SLACK_SVG },
  orca: { name: "開発", icon: DEVELOP_SVG },
  database: { name: "データベース", icon: DATABASE_SVG },
};

// What Rust answered last, null until read.
let settings: MenuSettings | null = null;
// A save is on its way: the rows wait.
let saving = false;

function row(entry: MenuEntry, key: string) {
  const { name, icon } = SCREENS[entry.screen];
  const item = tag("div", `item menu-row${entry.enabled ? "" : " menu-row-off"}`);
  item.dataset.screen = entry.screen;
  const grip = tag("span", "menu-grip");
  grip.setAttribute("role", "img");
  grip.setAttribute("aria-label", `${name}をドラッグして並べ替え`);
  grip.innerHTML = GRIP_SVG;
  grip.onpointerdown = (e) => {
    if (e.button !== 0 || saving) return;
    e.preventDefault();
    pressDrag(e, item);
  };
  const glyph = tag("span", "menu-icon");
  glyph.innerHTML = icon;
  const who = tag("div", "who");
  who.append(tag("div", "item-name", name));
  item.append(grip, glyph, who, tag("span", "menu-key", key));
  if (entry.screen === "mail") {
    item.append(tag("span", "item-meta menu-always", "常に表示"));
  } else {
    const toggle = tag("button", "switch");
    toggle.type = "button";
    toggle.setAttribute("role", "switch");
    toggle.setAttribute("aria-checked", String(entry.enabled));
    toggle.setAttribute("aria-label", `${name}をサイドメニューに表示`);
    toggle.disabled = saving;
    toggle.onclick = () => save(settings!.items.map((x) => (x.screen === entry.screen ? { ...x, enabled: !x.enabled } : x)), entry.screen);
    item.append(toggle);
  }
  return item;
}

// Draws `items`. The key of a screen that is on is its place among the screens that are on, counted from the top (the numbers of `ts/nav.ts`); a screen that is off has none.
function render(items: MenuEntry[]) {
  let place = 0;
  $("menu-items").replaceChildren(...items.map((entry) => row(entry, entry.enabled ? `${isMac ? "⌘" : "Ctrl+"}${++place}` : "—")));
}

// Saves the whole list. The rows show `next` while it is on its way, and the saved list after it: a failed save shows its card and puts the rows back as they were saved.
// `focus` is the screen whose switch was pressed; its new switch has the focus again.
async function save(next: MenuEntry[], focus?: MenuScreen) {
  if (saving || settings === null) return;
  saving = true;
  render(next);
  try {
    settings = await invoke("side_menu_settings_set", { items: next });
    drawMenu(settings.items);
  } catch (e) {
    showFailure("menu-settings", e);
  } finally {
    saving = false;
    render(settings.items);
    if (focus) document.querySelector<HTMLElement>(`#menu-items [data-screen="${focus}"] .switch`)?.focus();
  }
}

// A drag of a row by its grip, by pointer events (not HTML5 drag and drop, which clashes with the window's file drop): the row goes up and down with the pointer, and the list is saved when the pointer is released.
// A press that hardly moves is not a drag. Escape, or a cancelled pointer, puts the rows back.
function pressDrag(e: PointerEvent, item: HTMLElement) {
  const pointer = e.pointerId;
  const list = $("menu-items");
  const y0 = e.clientY;
  let started = false;
  const mine = (f: (e: PointerEvent) => void) => (e: PointerEvent) => e.pointerId === pointer && f(e);
  const middle = (r: Element) => {
    const box = r.getBoundingClientRect();
    return box.top + box.height / 2;
  };
  const move = mine((e) => {
    if (!started) {
      if (Math.abs(e.clientY - y0) < 4) return;
      started = true;
      item.classList.add("dragging");
    }
    // The row goes before the first other row whose middle is below the pointer, or last.
    const before = [...list.children].find((r) => r !== item && middle(r) > e.clientY) ?? null;
    if (item.nextElementSibling !== before) list.insertBefore(item, before);
  });
  const up = mine(() => end(true));
  const cancel = mine(() => end(false));
  const onKey = (e: KeyboardEvent) => e.key === "Escape" && end(false);
  const end = (release: boolean) => {
    document.removeEventListener("pointermove", move, true);
    document.removeEventListener("pointerup", up, true);
    document.removeEventListener("pointercancel", cancel, true);
    document.removeEventListener("keydown", onKey);
    item.classList.remove("dragging");
    if (!started || settings === null) return;
    const order = [...list.children].map((r) => (r as HTMLElement).dataset.screen);
    const items = order.map((screen) => settings!.items.find((x) => x.screen === screen)!);
    // Rows that were dropped where they were, or put back, are drawn from the saved list again.
    if (!release || items.every((x, i) => x.screen === settings!.items[i]!.screen)) render(settings.items);
    else void save(items);
  };
  document.addEventListener("pointermove", move, true);
  document.addEventListener("pointerup", up, true);
  document.addEventListener("pointercancel", cancel, true);
  document.addEventListener("keydown", onKey);
}

export function initMenuSettings() {
  $("menu-help").onclick = (e) =>
    toggleHint(
      e.currentTarget as Element,
      hintPopup(
        "メニュー",
        [
          ["サイドメニューに出す画面と、その並びを選びます。変えるとすぐ保存し、サイドメニューに反映します"],
          ["左端の ⋮⋮ を上下にドラッグして、並べ替えます。スイッチで、その画面をサイドメニューに出すか、外すかを選びます。受信トレイは外せません"],
          [`${isMac ? "⌘" : "Ctrl"} と数字のキーは、サイドメニューに出ている画面を上から数えた番号で、押すとその画面に移ります。外した画面には番号がありません`],
        ],
        "設定のフォルダの side-menu.json に保存します",
      ),
    );
  invoke("side_menu_settings").then(
    (read) => {
      settings = read;
      render(read.items);
    },
    (e) => logError("menu-settings", e),
  );
}
