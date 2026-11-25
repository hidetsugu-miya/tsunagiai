// The database tabs of the work pane of the Orca screen (A-43): a table of the tree of the database part opens as a tab with the tabs of D-4 to D-6 (records, structure, SQL), and the menu of a database opens the SQL of that database as a tab of its own. Drawing is `drawTableTab` of database-work.ts, which the database screen's work pane shares; this module holds what each tab shows and reads it (`database_records`, `database_structure`, `database_sql`), as the database screen does for its tabs (D-4 to D-6).
// The tabs are kept in memory only, by target and project, as the tabs of the files are (their ids are `database:{n}`). A tab that is not shown keeps its box and what it read; a read that ends after its tab was closed is dropped. Nothing is read by the clock.
import { drawTableTab, focusSqlField, lastResultTab, type RecordsState, type SqlState, type StructureState, type TabActions } from "./database-work.js";
import { tag } from "./dom.js";
import { invoke } from "./ipc.js";

export interface DatabaseTab {
  id: string;
  target: string | null;
  project: string;
  // The connection, and its name as it was when the tab was opened.
  connection: string;
  name: string;
  database: string;
  // The table, or none for the SQL tab of the database.
  table: string | null;
  // The selected tab of the table: "records", "structure" or "sql".
  tab: string;
  // What the tab strip of the screen says: "{table} · {connection}", or "SQL · {database} · {connection}".
  title: string;
  records: RecordsState | null;
  structure: StructureState | null;
  sql: SqlState;
  // Focus the field of the SQL when the tab is first shown (a new query).
  wantFocus: boolean;
  el: HTMLElement;
  actions: TabActions;
}

const tabs = new Map<string, DatabaseTab>();
let lastId = 0;
// Tells that a read of a tab showed its connection lost: the screen drops the connection (`lostConnection` of `orca-database.ts`), and the window of a tab (A-46) tells the screen.
let lost: (connection: string, error: string) => void = () => {};

export function initDatabaseTabs(on: { lost: (connection: string, error: string) => void }) {
  lost = on.lost;
}

// What a tab shows, as the window of a tab (A-46) opens the same one: the connection and its name, the database, the table (none for the SQL of the database), the selected tab of the table, the page of its records and the text of its SQL.
export interface DatabaseCondition {
  connection: string;
  name: string;
  database: string;
  table: string | null;
  tab: string;
  page: number;
  sql: string;
}

export const conditionOf = (t: DatabaseTab): DatabaseCondition => ({ connection: t.connection, name: t.name, database: t.database, table: t.table, tab: t.tab, page: t.records?.page ?? 0, sql: t.sql.text });

const draw = (t: DatabaseTab) => drawTableTab(t.el, { connection: t.connection, database: t.database, table: t.table, tab: t.tab, records: t.records, structure: t.structure, sql: t.sql }, t.actions);

// Reads the page `page` of the records of the table (D-4), or, when `typed` is given, the page that this text of the page field names (`page` is then the page that is shown). The page that was shown stays until the new one comes; an error drops it.
async function readRecords(t: DatabaseTab, page: number, typed?: string) {
  const { connection: id, database, table } = t;
  if (table === null) return;
  const mine: RecordsState = { page, loading: true, error: null, data: t.records?.data ?? null };
  t.records = mine;
  draw(t);
  try {
    mine.data = await invoke("database_records", { id, database, table, page, estimate: mine.data?.estimate ?? null, ...(typed === undefined ? {} : { typed }) });
    mine.page = mine.data.page;
  } catch (e) {
    mine.data = null;
    mine.error = String(e);
    if (t.records === mine && tabs.has(t.id)) lost(id, mine.error);
  }
  mine.loading = false;
  draw(t);
}

// Reads the structure of the table (D-5), at every press of the tab 構造.
async function readStructure(t: DatabaseTab) {
  const { connection: id, database, table } = t;
  if (table === null) return;
  const mine: StructureState = { loading: true, error: null, data: null };
  t.structure = mine;
  draw(t);
  try {
    mine.data = await invoke("database_structure", { id, database, table });
  } catch (e) {
    mine.error = String(e);
    if (t.structure === mine && tabs.has(t.id)) lost(id, mine.error);
  }
  mine.loading = false;
  draw(t);
}

// Runs the text of the SQL tab on the connection and database of the tab (D-6). A run waits for the one before it.
async function runSql(t: DatabaseTab) {
  const mine = t.sql;
  if (mine.loading) return;
  mine.loading = true;
  mine.error = null;
  draw(t);
  try {
    mine.data = await invoke("database_sql", { id: t.connection, database: t.database, sql: mine.text });
    mine.tab = lastResultTab(mine.data);
  } catch (e) {
    mine.data = null;
    mine.tab = 0;
    mine.error = String(e);
    if (tabs.has(t.id)) lost(t.connection, mine.error);
  }
  mine.loading = false;
  draw(t);
}

function create(target: string | null, project: string, profile: { id: string; name: string }, database: string, table: string | null): DatabaseTab {
  const id = `database:${++lastId}`;
  const el = tag("div", "orca-database-tab");
  el.dataset.databaseTab = id;
  const t: DatabaseTab = {
    id,
    target,
    project,
    connection: profile.id,
    name: profile.name,
    database,
    table,
    tab: table === null ? "sql" : "records",
    title: table === null ? `SQL · ${database} · ${profile.name}` : `${table} · ${profile.name}`,
    records: null,
    structure: null,
    sql: { text: "", loading: false, error: null, data: null, tab: 0 },
    wantFocus: false,
    el,
    actions: {
      page: (page) => {
        if (t.records) void readRecords(t, page);
      },
      pageInput: (text) => {
        if (t.records) void readRecords(t, t.records.page, text);
      },
      // The table stays: only the tab changes. The records are kept as they are, and the structure is read at every press of its tab.
      tab: (next) => {
        if (next === t.tab) return;
        t.tab = next;
        if (next === "structure") void readStructure(t);
        else draw(t);
      },
      // The field draws nothing while it is typed in: the text is only kept.
      sqlText: (text) => {
        t.sql.text = text;
      },
      runSql: () => void runSql(t),
      sqlTab: (index) => {
        if (t.sql.tab === index) return;
        t.sql.tab = index;
        draw(t);
      },
    },
  };
  tabs.set(id, t);
  return t;
}

// Opens the table in a tab of the project (made when there is none) with the first page of its records, read again at every press, and gives the tab and whether it was made now.
export function openTable(target: string | null, project: string, profile: { id: string; name: string }, database: string, table: string) {
  const held = [...tabs.values()].find((t) => t.target === target && t.project === project && t.connection === profile.id && t.database === database && t.table === table);
  const t = held ?? create(target, project, profile, database, table);
  t.tab = "records";
  t.structure = null;
  void readRecords(t, 0);
  return { tab: t, created: held === undefined };
}

// Opens the SQL of the database in a tab of its own, with an empty field that takes the focus when the tab is shown. It calls nothing.
export function openQuery(target: string | null, project: string, profile: { id: string; name: string }, database: string) {
  const t = create(target, project, profile, database, null);
  t.wantFocus = true;
  draw(t);
  return t;
}

// Opens the tab that `c` names (the window of a tab, A-46): the table with the page of its records read, or the structure, or the SQL with its text, and gives it. Nothing else is read, and no SQL is run.
export function restoreDatabaseTab(target: string | null, project: string, c: DatabaseCondition) {
  const t = create(target, project, { id: c.connection, name: c.name }, c.database, c.table);
  t.sql.text = c.sql;
  if (c.table === null) {
    draw(t);
    return t;
  }
  t.tab = c.tab;
  void readRecords(t, c.page);
  if (c.tab === "structure") void readStructure(t);
  return t;
}

// The database tabs of the project.
export const databaseTabsOf = (target: string | null, project: string) => [...tabs.values()].filter((t) => t.target === target && t.project === project);

export function closeDatabaseTab(id: string) {
  const t = tabs.get(id);
  if (!t) return;
  t.el.remove();
  tabs.delete(id);
}

// Closes the tabs of a connection that is closed, deleted or lost (A-43); answers whether there were any.
export function closeConnectionTabs(connection: string) {
  const mine = [...tabs.values()].filter((t) => t.connection === connection);
  for (const t of mine) closeDatabaseTab(t.id);
  return mine.length > 0;
}

// Shows each tab of `placements` in its host element and takes every other tab out of the page (it keeps what it holds).
export function showDatabaseTabs(placements: { id: string; host: HTMLElement }[]) {
  const shown = new Set(placements.map((p) => p.id));
  for (const [id, t] of tabs) if (!shown.has(id)) t.el.remove();
  for (const { id, host } of placements) {
    const t = tabs.get(id);
    if (!t || t.el.parentElement === host) continue;
    host.replaceChildren(t.el);
    if (t.wantFocus) {
      t.wantFocus = false;
      focusSqlField(t.el);
    }
  }
}
