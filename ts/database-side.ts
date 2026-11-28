// The tree of the connections (D-1, D-3), which the side menu of the database screen (database.ts) and the database part of the file pane of the Orca screen (A-43, orca-database.ts) draw into a box each: the connections by name, each with a menu that a right press opens (edit, disconnect, delete), and under an open connection its databases, each with a menu of its own (new query, close the database), and under an open database its tables. An item of a menu whose action the screen does not give is not in the menu, and a menu with no item does not open.
// Drawing only: what is held and what each press does belong to the screen. A box is drawn again only when what it shows changes, and the focus stays.
// The favorite tables (A-52, #1540) are drawn only when the screen gives them (`SideState.favorites`: the Orca screen's database part does, for the project it follows; the database screen gives none): a section above the tree with a row for each favorite table (the table, and under the same line, at the right, its database and connection), then a line, and in the tree a star on the row of a favorite table and a menu on the row of a table. A press on a favorite opens its table (the screen connects first when the connection is not open).
// The error of a connection or of a database is not drawn in the tree: it is a card (A-28, `setNotice`), one for each, which goes when the error is gone from the state or the row is closed. A card closed with its × stays closed until then, and the next press of the row reads again.
import type { DatabaseProfileView } from "./bindings/DatabaseProfileView";
import { tag } from "./dom.js";
import { setNotice } from "./error-card.js";
import { BOOKMARK_SVG, CHEVRON_SVG, CLOSE_SVG, CODE_SVG, DATABASE_SVG, DELETE_SVG, EDIT_SVG } from "./icons.js";
import { openMenu } from "./menu.js";

export interface DatabaseNode {
  name: string;
  expanded: boolean;
  loading: boolean;
  error: string | null;
  // The names of its tables.
  tables: string[];
}

export interface ConnectionNode {
  profile: DatabaseProfileView;
  expanded: boolean;
  // The connection is open (Rust holds its session): the dot is on.
  connected: boolean;
  loading: boolean;
  // The last line of the script's output while the connection opens, or none.
  output: string | null;
  error: string | null;
  databases: DatabaseNode[];
}

export interface Selected {
  id: string;
  database: string | null;
  table: string | null;
}

// A favorite table whose connection is in the list.
export interface FavoriteNode {
  profile: DatabaseProfileView;
  database: string;
  table: string;
}

export interface SideState {
  connections: ConnectionNode[];
  // The favorite tables, in the order they were added; none when the screen has no favorites to give (no section, no star, no menu on a table).
  favorites?: FavoriteNode[];
  // The row that was pressed last, or none.
  selected: Selected | null;
}

export interface SideActions {
  pressConnection: (profile: DatabaseProfileView) => void;
  pressDatabase: (profile: DatabaseProfileView, database: string) => void;
  pressTable: (profile: DatabaseProfileView, database: string, table: string) => void;
  // Selects the database and opens its SQL tab with an empty field.
  newQuery?: (profile: DatabaseProfileView, database: string) => void;
  // Closes the tree of the database; the connection stays open.
  closeDatabase: (profile: DatabaseProfileView, database: string) => void;
  // Opens the table of a favorite (A-52).
  pressFavorite?: (profile: DatabaseProfileView, database: string, table: string) => void;
  // Adds the table to the favorites (`on`) or takes it off (A-52).
  favorite?: (profile: DatabaseProfileView, database: string, table: string, on: boolean) => void;
  edit?: (profile: DatabaseProfileView) => void;
  disconnect: (profile: DatabaseProfileView) => void;
  // `anchor` is the name of the row, which the confirmation opens under.
  remove?: (profile: DatabaseProfileView, anchor: Element) => void;
}

// What each box shows now.
const drawn = new WeakMap<HTMLElement, string>();

// The star of a favorite table: on a row of the tree it is an image with a label, in the section it is left to the text.
function star(decorative: boolean) {
  const mark = tag("span", "database-star", "★");
  if (decorative) mark.setAttribute("aria-hidden", "true");
  else {
    mark.setAttribute("role", "img");
    mark.setAttribute("aria-label", "お気に入り");
  }
  return mark;
}

const favoriteId = (id: string, database: string, table: string) => JSON.stringify([id, database, table]);

function row(key: string, depth: number, pressed: boolean, expanded: boolean | null, icon: string | null, name: string, onclick: () => void, starred = false) {
  const button = tag("button", "database-btn");
  button.type = "button";
  button.dataset.key = key;
  button.style.setProperty("--depth", String(depth));
  button.setAttribute("aria-pressed", String(pressed));
  if (expanded !== null) button.setAttribute("aria-expanded", String(expanded));
  button.onclick = onclick;
  const mark = tag("span", "database-mark");
  if (expanded !== null) mark.innerHTML = CHEVRON_SVG;
  const ic = tag("span", "database-ic");
  if (icon) ic.innerHTML = icon;
  button.append(mark, ic, tag("span", "database-name", name));
  if (starred) button.append(star(false));
  return button;
}

// The dot of a connection: green while it is open, orange while it opens, gray otherwise. Its label says which.
function dotNode(node: ConnectionNode) {
  const state = node.connected ? "connected" : node.loading ? "connecting" : "closed";
  const dot = tag("span", "database-dot");
  dot.dataset.state = state;
  dot.setAttribute("role", "img");
  dot.setAttribute("aria-label", { connected: "接続済み", connecting: "接続しています", closed: "未接続" }[state]);
  return dot;
}

// A line under a row that says what is going on (the load, the last line of a script).
function note(text: string, depth: number) {
  const line = tag("p", "database-note", text);
  line.style.setProperty("--depth", String(depth));
  line.setAttribute("role", "status");
  return line;
}

function databaseNodes(node: ConnectionNode, selected: Selected | null, favorites: Set<string> | null, actions: SideActions) {
  const id = node.profile.id;
  return node.databases.flatMap((db) => {
    const here = selected?.id === id && selected.database === db.name;
    const button = row(`${id}/d/${db.name}`, 1, here && selected?.table === null, db.expanded, null, db.name, () => actions.pressDatabase(node.profile, db.name));
    // The menu is anchored on the name, as the connection's is.
    const name = button.querySelector(".database-name")!;
    const { newQuery } = actions;
    button.oncontextmenu = (e) => {
      e.preventDefault();
      openMenu(
        name,
        [
          ...(newQuery ? [{ label: "新規クエリ", color: "", icon: CODE_SVG, current: false, pick: () => newQuery(node.profile, db.name) }] : []),
          { label: "データベースを閉じる", color: "", icon: CLOSE_SVG, current: false, pick: () => actions.closeDatabase(node.profile, db.name) },
        ],
        { at: { x: e.clientX, y: e.clientY } },
      );
    };
    const out: Node[] = [button];
    if (db.expanded) {
      if (db.loading) out.push(note("読み込み中…", 2));
      const { favorite } = actions;
      for (const table of db.tables) {
        const on = favorites?.has(favoriteId(id, db.name, table)) ?? false;
        const button = row(`${id}/d/${db.name}/t/${table}`, 2, here && selected?.table === table, null, null, table, () => actions.pressTable(node.profile, db.name, table), on);
        // A table has a menu only where there are favorites to keep (A-52).
        if (favorite && favorites) {
          const name = button.querySelector(".database-name")!;
          button.oncontextmenu = (e) => {
            e.preventDefault();
            openMenu(name, [on ? { label: "お気に入りから外す", color: "", icon: CLOSE_SVG, current: false, pick: () => favorite(node.profile, db.name, table, false) } : { label: "お気に入りに追加", color: "", icon: BOOKMARK_SVG, current: false, pick: () => favorite(node.profile, db.name, table, true) }], { at: { x: e.clientX, y: e.clientY } });
          };
        }
        out.push(button);
      }
    }
    return out;
  });
}

function itemNode(node: ConnectionNode, selected: Selected | null, favorites: Set<string> | null, actions: SideActions) {
  const profile = node.profile;
  const item = tag("div", "database-item");
  const button = row(profile.id, 0, selected?.id === profile.id && selected.database === null, node.expanded, DATABASE_SVG, profile.name, () => actions.pressConnection(profile));
  button.append(dotNode(node));
  // The menu is anchored on the name, not on the button, which carries the aria-expanded of its tree.
  const name = button.querySelector(".database-name")!;
  const { edit, remove } = actions;
  button.oncontextmenu = (e) => {
    e.preventDefault();
    const items = [
      ...(edit ? [{ label: "編集", color: "", icon: EDIT_SVG, current: false, pick: () => edit(profile) }] : []),
      ...(node.connected || node.loading ? [{ label: "切断", color: "", icon: CLOSE_SVG, current: false, pick: () => actions.disconnect(profile) }] : []),
      ...(remove ? [{ label: "削除", color: "", icon: DELETE_SVG, current: false, danger: true, pick: () => remove(profile, name) }] : []),
    ];
    if (items.length > 0) openMenu(name, items, { at: { x: e.clientX, y: e.clientY } });
  };
  item.append(button);
  if (node.expanded) {
    const children = tag("div", "database-children");
    if (node.loading) {
      const line = note(node.output ?? (node.connected ? "読み込み中…" : "接続中…"), 1);
      line.dataset.scriptNote = "";
      children.append(line);
    }
    children.append(...databaseNodes(node, selected, favorites, actions));
    item.append(children);
  }
  return item;
}

// The section of the favorite tables above the tree (A-52): the row of each is the table with its database and connection at the right, and has the menu 「お気に入りから外す」. Nothing while there is none.
function favoriteSection(state: SideState, actions: SideActions): Node[] {
  const list = state.favorites ?? [];
  if (list.length === 0) return [];
  const { pressFavorite, favorite } = actions;
  const section = tag("div", "database-favorites");
  section.setAttribute("role", "group");
  section.setAttribute("aria-label", "お気に入り");
  section.append(tag("p", "database-head", "お気に入り"));
  for (const f of list) {
    const button = tag("button", "database-btn database-fav");
    button.type = "button";
    button.dataset.key = `fav/${f.profile.id}/d/${f.database}/t/${f.table}`;
    button.setAttribute("aria-pressed", String(state.selected?.id === f.profile.id && state.selected.database === f.database && state.selected.table === f.table));
    button.onclick = () => pressFavorite?.(f.profile, f.database, f.table);
    const name = tag("span", "database-name", f.table);
    button.append(star(true), name, tag("span", "database-sub", `${f.database} · ${f.profile.name}`));
    if (favorite) {
      button.oncontextmenu = (e) => {
        e.preventDefault();
        openMenu(name, [{ label: "お気に入りから外す", color: "", icon: CLOSE_SVG, current: false, pick: () => favorite(f.profile, f.database, f.table, false) }], { at: { x: e.clientX, y: e.clientY } });
      };
    }
    section.append(button);
  }
  section.append(tag("div", "database-sep"));
  return [section];
}

// Puts the last line of a script's output into the note under the row of its connection, in place: a script may write many lines in a second, and the box is not made again for each. Answers false when that note is not on the screen (the caller draws the box then). The box is drawn again at the next change of what it shows, which also makes it again from the state.
export function showScriptOutput(box: HTMLElement, id: string, line: string): boolean {
  const note = box.querySelector(`[data-key="${CSS.escape(id)}"]`)?.closest(".database-item")?.querySelector<HTMLElement>("[data-script-note]");
  if (!note) return false;
  note.textContent = line;
  return true;
}

// The keys of the errors that each box has a card for, "{connection id}" and "{connection id}/{database}".
const cards = new WeakMap<HTMLElement, Set<string>>();

// Makes the card of each error that a row shows (the rows of a closed tree show none) and takes off the card of one that is gone. The key holds the box, because the database screen and the Orca file pane each have a tree.
function drawErrors(box: HTMLElement, state: SideState) {
  const errors = new Map<string, string>();
  for (const c of state.connections) {
    if (!c.expanded) continue;
    if (c.error !== null) errors.set(c.profile.id, c.error);
    for (const d of c.databases) if (d.expanded && d.error !== null) errors.set(`${c.profile.id}/${d.name}`, d.error);
  }
  const noticeKey = (key: string) => `database-side:${box.id}/${key}`;
  for (const key of cards.get(box) ?? []) if (!errors.has(key)) setNotice(noticeKey(key), null);
  for (const [key, text] of errors) setNotice(noticeKey(key), { text });
  cards.set(box, new Set(errors.keys()));
}

export function drawDatabaseSide(box: HTMLElement, state: SideState, actions: SideActions) {
  const key = JSON.stringify(state);
  if (key === drawn.get(box)) return;
  drawn.set(box, key);
  drawErrors(box, state);
  const top = box.scrollTop;
  const focused = (document.activeElement as HTMLElement | null)?.dataset?.key;
  const favorites = state.favorites === undefined ? null : new Set(state.favorites.map((f) => favoriteId(f.profile.id, f.database, f.table)));
  box.replaceChildren(...favoriteSection(state, actions), ...state.connections.map((c) => itemNode(c, state.selected, favorites, actions)));
  box.scrollTop = top;
  if (focused) box.querySelector<HTMLElement>(`[data-key="${CSS.escape(focused)}"]`)?.focus({ preventScroll: true });
}
