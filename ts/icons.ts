// Inline SVG icons. This is the one place that holds the shape of an icon (`.claude/tools/check-icons.sh` fails on a shape written anywhere else): ts/ takes the `*_SVG` strings, and index.html writes `<svg data-svg="{name}">`, which `fillIcons` fills at the start.

type Shape = { paths: string; viewBox: string };
const shapes = new Map<string, Shape>();

// Registers a shape under `name` (what `data-svg` of index.html says) and returns its `<svg>`.
function icon(name: string, paths: string, viewBox = "0 0 24 24") {
  if (shapes.has(name)) throw new Error(`icon "${name}" is defined twice`);
  shapes.set(name, { paths, viewBox });
  return `<svg viewBox="${viewBox}" aria-hidden="true">${paths}</svg>`;
}

// Puts a class on the `<svg>` of an icon.
export const withClass = (svg: string, cls: string) => svg.replace("<svg ", `<svg class="${cls}" `);

// Fills every `<svg data-svg="{name}">` of the page with its shape. Called first by main.ts.
export function fillIcons() {
  for (const svg of document.querySelectorAll<SVGElement>("svg[data-svg]")) {
    const shape = shapes.get(svg.dataset.svg!);
    if (!shape) continue;
    svg.setAttribute("viewBox", shape.viewBox);
    svg.setAttribute("aria-hidden", "true");
    svg.innerHTML = shape.paths;
  }
}

export const CHECK_ALL_SVG = icon("check-all", '<path d="M2 13l5 5L14 8"/><path d="M10 15l2 2L22 7"/>');
export const CHECK_SVG = icon("check", '<path d="M5 12l5 5L20 7"/>');
export const PERSON_SVG = icon("person", '<circle cx="12" cy="8" r="5"/><path d="M2 24c0-6 4.5-9 10-9s10 3 10 9z"/>');
export const TODO_SVG = icon("todo", '<rect x="3" y="4" width="14" height="14" rx="3"/><path d="M7 11l2.5 2.5L14 9"/><path d="M19 15v6M16 18h6"/>');
export const BOOKMARK_SVG = icon("bookmark", '<path d="M6 4h12v17l-6-4-6 4z"/>');
export const MINUS_CIRCLE_SVG = icon("minus-circle", '<circle cx="12" cy="12" r="9"/><path d="M8 12h8"/>');
export const HASH_SVG = icon("hash", '<path d="M5 9h14M5 15h14M10 4 8 20M16 4l-2 16"/>');
export const DOT_SVG = icon("dot", '<circle cx="12" cy="12" r="5"/>');
export const MAIL_SVG = icon("mail", '<rect x="3" y="5" width="18" height="14" rx="2"/><path d="M3 7l9 6 9-6"/>');
export const RETURN_SVG = icon("return", '<path d="M9 14 4 9l5-5M4 9h9a7 7 0 0 1 7 7v4"/>');
export const SUB_SVG = icon("sub", '<path d="M6 4v10a3 3 0 0 0 3 3h9"/><path d="M15 14l3 3-3 3"/>');
export const TAG_SVG = icon("tag", '<path d="M3 4v7l9.5 9.5a1.4 1.4 0 0 0 2 0l6-6a1.4 1.4 0 0 0 0-2L11 3H4a1 1 0 0 0-1 1z"/><path d="M7.5 7.5h.01"/>');
export const OPEN_SVG = icon("open", '<path d="M14 4h6v6"/><path d="M20 4l-9 9"/><path d="M18 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h5"/>');
export const DAY_SVG = icon("day", '<rect x="3" y="5" width="18" height="16" rx="2"/><path d="M3 10h18"/><path d="M12 14v3"/>');
export const DATE_SVG = icon("date", '<rect x="3" y="5" width="18" height="16" rx="2"/><path d="M3 10h18"/>');
export const GRIP_SVG = icon("grip", '<path d="M9 5h.01M15 5h.01M9 12h.01M15 12h.01M9 19h.01M15 19h.01"/>');
export const CHEVRON_SVG = icon("chevron", '<path d="M9 6l6 6-6 6"/>');
// The mark of a formation: the one at the heading 「フォーメーション」 of the list of the development screen (index.html), and on the row of a child's session in a project.
export const FORMATION_SVG = icon("formation", '<rect x="3" y="3" width="8" height="8" rx="2"/><path d="M7 11v4a2 2 0 0 0 2 2h4"/><rect x="13" y="13" width="8" height="8" rx="2"/>');
export const CHEVRON_LEFT_SVG = icon("chevron-left", '<path d="M15 6l-6 6 6 6"/>');
// D-4: the first and the last page (a chevron against a bar).
export const PAGE_FIRST_SVG = icon("page-first", '<path d="M6 5v14"/><path d="M17 6l-6 6 6 6"/>');
export const PAGE_LAST_SVG = icon("page-last", '<path d="M18 5v14"/><path d="M7 6l6 6-6 6"/>');
export const EDIT_SVG = icon("edit", '<path d="M4 20h4L19 9l-4-4L4 16z"/><path d="M13 7l4 4"/>');
export const OUTDENT_SVG = icon("outdent", '<path d="M3 5h18M13 12h8M3 19h18"/><path d="M8 9l-4 3 4 3"/>');
export const FOLDER_SVG = icon("folder", '<path d="M3 6a1 1 0 0 1 1-1h5l2 2h9a1 1 0 0 1 1 1v10a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1z"/>');
export const CLAUDE_SVG = icon("claude", '<path d="M12 3v18M3 12h18M5.6 5.6l12.8 12.8M18.4 5.6L5.6 18.4"/>');
export const SCRATCHPAD_SVG = icon("scratchpad", '<path d="M5 4h11l3 3v13a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V5a1 1 0 0 1 1-1z"/><path d="M8 12h8M8 16h5"/>');
// A-16: an AI CLI other than Claude in the menu of the plus (a four-pointed star).
export const AGENT_SVG = icon("agent", '<path d="M12 3l2 6 6 2-6 2-2 6-2-6-6-2 6-2z"/>');
export const TERMINAL_SVG = icon("terminal", '<rect x="3" y="4" width="18" height="16" rx="3"/><path d="M7 10l3 2-3 2M12 15h5"/>');
export const TRASH_SVG = icon("trash", '<path d="M4 7h16"/><path d="M9 7V4h6v3"/><path d="M6 7l1 13h10l1-13"/><path d="M10 11v6M14 11v6"/>');
export const SUMMARY_SVG = icon("summary", '<path d="M8 3l1.4 3.6L13 8l-3.6 1.4L8 13l-1.4-3.6L3 8l3.6-1.4z"/><path d="M16.5 6H21M16.5 11H21M4 17h17M4 21h11"/>');
export const SLACK_SVG = icon("slack", '<path d="M9.5 4L8 20M16 4l-1.5 16M4 9h16.5M3.5 15H20"/>');
export const KEY_SVG = icon("key", '<circle cx="8" cy="15" r="4"/><path d="M11 12l9-9M16 7l3 3M14 9l2 2"/>');
export const LINK_SVG = icon("link", '<path d="M9 15l6-6"/><path d="M11 6l1.5-1.5a3.5 3.5 0 0 1 5 5L16 11"/><path d="M13 18l-1.5 1.5a3.5 3.5 0 0 1-5-5L8 13"/>');
export const LOCK_SVG = icon("lock", '<rect x="5" y="11" width="14" height="10" rx="2"/><path d="M8 11V7a4 4 0 0 1 8 0v4"/>');
export const COPY_SVG = icon("copy", '<rect x="8" y="8" width="12" height="12" rx="2"/><path d="M16 8V5a1 1 0 0 0-1-1H5a1 1 0 0 0-1 1v10a1 1 0 0 0 1 1h3"/>');
export const COPY_PATH_SVG = icon("copy-path", '<rect x="9" y="9" width="12" height="12" rx="2"/><path d="M5 15H4a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1h10a1 1 0 0 1 1 1v1"/>');
export const DOWNLOAD_SVG = icon("download", '<path d="M12 3v12"/><path d="m7 10 5 5 5-5"/><path d="M4 17v2a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-2"/>');
export const MEET_SVG = icon("meet", '<rect x="3" y="6" width="13" height="12" rx="2"/><path d="m16 10 5-3v10l-5-3"/>');
export const PIN_SVG = icon("pin", '<path d="M12 21s7-6.2 7-11a7 7 0 1 0-14 0c0 4.8 7 11 7 11z"/><circle cx="12" cy="10" r="2.5"/>');
export const LINES_SVG = icon("lines", '<path d="M4 6h16M4 12h16M4 18h10"/>');
export const CLOCK_SVG = icon("clock", '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>');
export const PEOPLE_SVG = icon("people", '<circle cx="9" cy="8" r="3.5"/><path d="M3 20c.6-3.6 3-5.5 6-5.5s5.4 1.9 6 5.5M16 5a3.5 3.5 0 0 1 0 6.5M18 14.8c1.7.8 2.7 2.5 3 5.2"/>');
export const ORCA_SVG = icon("orca", '<rect x="3" y="4" width="18" height="16" rx="2"/><path d="M7 9l3 3-3 3M13 15h4"/>');
// The button that makes a formation (A-37): the tree of a leader and its teammates, with a plus at the corner.
export const FORMATION_NEW_SVG = icon("formation-new", '<rect x="7.5" y="3.5" width="6" height="4.5" rx="1.5"/><path d="M10.5 8v3.5M5 15.5v-4h11v4M10.5 11.5v4"/><rect x="2.5" y="15.5" width="5" height="5" rx="1.5"/><rect x="8" y="15.5" width="5" height="5" rx="1.5"/><rect x="14.5" y="15.5" width="5" height="5" rx="1.5"/><path d="M19 2v5M16.5 4.5h5"/>');
export const DATABASE_SVG = icon("database", '<ellipse cx="12" cy="6" rx="8" ry="3"/><path d="M4 6v12c0 1.7 3.6 3 8 3s8-1.3 8-3V6"/><path d="M4 12c0 1.7 3.6 3 8 3s8-1.3 8-3"/>');
export const CLOSE_SVG = icon("close", '<path d="M6 6l12 12M18 6L6 18"/>');
export const ARROW_UP_SVG = icon("arrow-up", '<path d="M12 19V5"/><path d="M5 12l7-7 7 7"/>');
export const INBOX_SVG = icon("inbox", '<path d="M3 13l3-8h12l3 8v6H3z"/><path d="M3 13h5l1 3h6l1-3h5"/>');
export const SMILE_PLUS_SVG = icon("smile-plus", '<circle cx="11" cy="13" r="8"/><path d="M7.5 14.5a4 4 0 0 0 7 0"/><path d="M8.5 11h.01M13.5 11h.01"/><path d="M19 2v6M16 5h6"/>');
export const MINUS_SVG = icon("minus", '<path d="M5 12h14"/>');
export const PLUS_SVG = icon("plus", '<path d="M12 5v14M5 12h14"/>');
// A-18: the move or the new name of a file (an arrow to a place).
export const MOVE_SVG = icon("move", '<path d="M4 12h12"/><path d="M11 7l5 5-5 5"/><path d="M20 5v14"/>');
export const DELETE_SVG = icon("delete", '<path d="M4 7h16"/><path d="M9 7V4h6v3"/><path d="M6 7l1 13h10l1-13"/>');
export const FILE_SVG = icon("file", '<path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z"/><path d="M14 3v5h5"/>');
export const CLIP_SVG = icon("clip", '<path d="M21.4 11.1l-9.2 9.2a6 6 0 0 1-8.5-8.5l9.2-9.2a4 4 0 0 1 5.7 5.7l-9.2 9.2a2 2 0 0 1-2.8-2.8l8.5-8.5"/>');
export const SEND_SVG = icon("send", '<path d="M22 2 11 13"/><path d="M22 2l-7 20-4-9-9-4z"/>');
export const SIDEBAR_SVG = icon("sidebar", '<rect x="3" y="4" width="18" height="16" rx="2"/><path d="M9 4v16"/>');
export const DIFF_SVG = icon("diff", '<path d="M12 4v8M8 8h8"/><path d="M8 18h8"/>');
export const COLUMNS_SVG = icon("columns", '<rect x="3" y="4" width="18" height="16" rx="2"/><path d="M12 4v16"/>');
// A-17: a square cut by a horizontal line (the split below in the menu of a tab).
export const ROWS_SVG = icon("rows", '<rect x="3" y="4" width="18" height="16" rx="2"/><path d="M3 12h18"/>');
export const UP_SVG = icon("up", '<path d="m6 15 6-6 6 6"/>');
export const DOWN_SVG = icon("down", '<path d="m6 9 6 6 6-6"/>');
export const RELOAD_SVG = icon("reload", '<path d="M20 12a8 8 0 1 1-2.3-5.7"/><path d="M20 4v5h-5"/>');
export const CODE_SVG = icon("code", '<path d="m8 8-4 4 4 4M16 8l4 4-4 4"/>');
export const EYE_SVG = icon("eye", '<path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12z"/><circle cx="12" cy="12" r="3"/>');
export const BRANCH_SVG = icon("branch", '<path d="M6 3v12"/><circle cx="18" cy="6" r="3"/><circle cx="6" cy="18" r="3"/><path d="M18 9a9 9 0 0 1-9 9"/>');
// A-34: a server (two racks with a light each), the button of the language server in the file pane.
export const TICKET_SVG = icon("ticket", '<path d="M3 9V6a1 1 0 0 1 1-1h16a1 1 0 0 1 1 1v3a3 3 0 0 0 0 6v3a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1v-3a3 3 0 0 0 0-6z"/><path d="M14 7v2M14 11v2M14 15v2"/>');
export const SERVER_SVG = icon("server", '<rect x="3" y="3" width="18" height="7" rx="2"/><rect x="3" y="14" width="18" height="7" rx="2"/><path d="M7 6.5h.01M7 17.5h.01"/>');
export const DEFINITION_SVG = icon("definition", '<circle cx="12" cy="12" r="8"/><circle cx="12" cy="12" r="2"/><path d="M12 2v3M12 19v3M2 12h3M19 12h3"/>');
// A-34: three dots, the menu of a card of a language server.
export const MORE_SVG = icon("more", '<path d="M5 12h.01M12 12h.01M19 12h.01"/>');
export const CLOUD_SVG = icon("cloud", '<path d="M17.5 19H9a7 7 0 1 1 6.7-9h1.8a4.5 4.5 0 1 1 0 9z"/>');

// The shapes that index.html and the modules drew by themselves before they were gathered here.
export const CALENDAR_SVG = icon("calendar", '<rect x="3" y="5" width="18" height="16" rx="2"/><path d="M3 10h18M8 3v4M16 3v4"/>');
export const TASK_SVG = icon("task", '<rect x="4" y="4" width="16" height="16" rx="4"/><path d="M8.5 12.5l2.5 2.5 4.5-5"/>');
export const DEVELOP_SVG = icon("develop", '<path d="m18 16 4-4-4-4M6 8l-4 4 4 4M14.5 4l-5 16"/>');
export const SETTINGS_SVG = icon("settings", '<circle cx="12" cy="12" r="3"/><path d="M12 2.5l1.6 2.6 3-.7.9 2.9 2.9.9-.7 3 2.6 1.6-2.6 1.6.7 3-2.9.9-.9 2.9-3-.7-1.6 2.6-1.6-2.6-3 .7-.9-2.9-2.9-.9.7-3L2.5 12l2.6-1.6-.7-3 2.9-.9.9-2.9 3 .7z"/>');
export const BACK_SVG = icon("back", '<path d="M19 12H5"/><path d="M11 6l-6 6 6 6"/>');
export const ARCHIVE_FLAT_SVG = icon("archive-flat", '<rect x="3" y="4" width="18" height="4" rx="1"/><path d="M5 8v11h14V8"/><path d="M10 12h4"/>');
export const ARCHIVE_SVG = icon("archive", '<rect x="3" y="4" width="18" height="4" rx="1"/><path d="M5 8v10a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8"/><path d="M10 12h4"/>');
export const SEARCH_SVG = icon("search", '<circle cx="11" cy="11" r="7"/><path d="M20 20l-4-4"/>');
export const HELP_SVG = icon("help", '<circle cx="12" cy="12" r="9"/><path d="M9.5 9.5a2.5 2.5 0 1 1 3.5 2.3c-.6.3-1 .9-1 1.6v.4"/><path d="M12 17h.01"/>');
export const PALETTE_SVG = icon("palette", '<path d="M12 4a8 8 0 1 0 0 16c1.4 0 2-.9 2-1.8 0-1.4-1.2-1.6-1.2-2.7 0-.8.7-1.5 1.6-1.5H17a3 3 0 0 0 3-3C20 6.9 16.4 4 12 4z"/><path d="M8 11h.01M11 8h.01M15 9h.01"/>');
export const PROMPT_SVG = icon("prompt", '<path d="M5 8l5 4-5 4M13 17h6"/>');
export const SERVER_PC_SVG = icon("server-pc", '<rect x="3" y="4" width="18" height="6" rx="1.5"/><rect x="3" y="14" width="18" height="6" rx="1.5"/><path d="M7 7h.01M7 17h.01"/>');
export const CHAIN_SVG = icon("chain", '<path d="M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1 1"/><path d="M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1-1"/>');
export const MONITOR_SVG = icon("monitor", '<rect x="3" y="4" width="18" height="12" rx="2"/><path d="M8 20h8M12 16v4"/>');
export const FONT_SVG = icon("font", '<path d="M5 19L12 5l7 14M8 14h8"/>');
export const UPDATE_SVG = icon("update", '<path d="M12 4v11M7 11l5 5 5-5M5 20h14"/>');
export const LOG_SVG = icon("log", '<path d="M5 6h14M5 12h14M5 18h9"/>');
export const FOLDER_PLUS_SVG = icon("folder-plus", '<path d="M3 6a1 1 0 0 1 1-1h5l2 2h9a1 1 0 0 1 1 1v10a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1z"/><path d="M12 10v6M9 13h6"/>');
export const PROJECT_FOLDER_SVG = icon("project-folder", '<circle cx="12" cy="13" r="2"/><path d="M14 13h3M7 13h3"/><path d="M2 20a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2h-7.9a2 2 0 0 1-1.69-.9L9.6 3.9A2 2 0 0 0 7.93 3H4a2 2 0 0 0-2 2z"/>');
export const BELL_SVG = icon("bell", '<path d="M6 16V11a6 6 0 0 1 12 0v5l2 2H4z"/><path d="M10 21h4"/>');
export const SIDEBAR_RIGHT_SVG = icon("sidebar-right", '<rect x="3" y="4" width="18" height="16" rx="2"/><path d="M15 4v16"/>');
export const FLOW_ARROW_SVG = icon("flow-arrow", '<path class="formation-arrow-line" d="M10 1V19"/><path d="M4 15l6 7 6-7"/>', "0 0 20 26");
export const ASK_SVG = icon("ask", '<path d="M2.992 16.342a2 2 0 0 1 .094 1.167l-1.065 3.29a1 1 0 0 0 1.236 1.168l3.413-.998a2 2 0 0 1 1.099.092 10 10 0 1 0-4.777-4.719"/><path d="M9.09 9a3 3 0 0 1 5.83 1c0 2-3 3-3 3"/><path d="M12 17h.01"/>');
export const ACTIVITY_SVG = icon("activity", '<path d="M22 12h-2.48a2 2 0 0 0-1.93 1.46l-2.35 8.36a.25.25 0 0 1-.48 0L9.24 2.18a.25.25 0 0 0-.48 0l-2.35 8.36A2 2 0 0 1 4.49 12H2"/>');
export const HOME_SVG = icon("home", '<path d="M4 11l8-7 8 7v9h-5v-6H9v6H4z"/>');
export const UP_FOLDER_SVG = icon("up-folder", '<path d="M12 19V5"/><path d="M6 11l6-6 6 6"/>');
// The tools of the rich editor.
export const BOLD_SVG = icon("bold", '<path d="M7 5h6a3.5 3.5 0 0 1 0 7H7zM7 12h7a3.5 3.5 0 0 1 0 7H7z"/>');
export const ITALIC_SVG = icon("italic", '<path d="M14 5h-4M14 19h-4M14 5l-4 14"/>');
export const STRIKE_SVG = icon("strike", '<path d="M5 12h14M16 7a4 3 0 0 0-8 0c0 4 8 2 8 7a4 3 0 0 1-8 0"/>');
export const FORMAT_LINK_SVG = icon("format-link", '<path d="M10 14a4 4 0 0 0 6 0l3-3a4 4 0 0 0-6-6l-1 1M14 10a4 4 0 0 0-6 0l-3 3a4 4 0 0 0 6 6l1-1"/>');
export const ORDERED_LIST_SVG = icon("ordered-list", '<path d="M10 6h10M10 12h10M10 18h10M4 6h1v4M4 18h2l-2-2"/>');
export const BULLET_LIST_SVG = icon("bullet-list", '<path d="M10 6h10M10 12h10M10 18h10M5 6h.01M5 12h.01M5 18h.01"/>');
export const QUOTE_SVG = icon("quote", '<path d="M5 5v14M10 7h9M10 12h9M10 17h6"/>');
export const INLINE_CODE_SVG = icon("inline-code", '<path d="M9 8l-4 4 4 4M15 8l4 4-4 4"/>');
export const CODE_BLOCK_SVG = icon("code-block", '<rect x="4" y="5" width="16" height="14" rx="2"/><path d="M9 10l-2 2 2 2M15 10l2 2-2 2"/>');
export const POPOUT_SVG = icon("popout", '<rect x="3" y="7" width="13" height="13" rx="2"/><path d="M10 3h11v11M21 3l-9 9"/>');
export const PUSHPIN_SVG = icon("pushpin", '<path d="M9 4h6l-1 6 4 3H6l4-3-1-6zM12 13v7"/>');
export const POPOUT_RESTORE_SVG = icon("popout-restore", '<rect x="8" y="4" width="13" height="16" rx="2"/><path d="M3 12h10M9 8l4 4-4 4"/>');
