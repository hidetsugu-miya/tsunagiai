// The page of the window of a task (T-11; Rust: `orca_popout.rs`, the page: `ts/popout.ts`): the detail of one task of Todoist, drawn by `renderDetail` of the Todo screen into `#todo-detail`.
// The page holds the Todo data as the screen does (`todoState`) and reads and writes through the same `todoist_*` commands (`todo-write.ts`); what the detail calls on the screen (draw, read again, open another task) is given to it here (`ownTodo`).
// This page calls Todoist only when it is opened and after a change of its own (`todoist_load`); the periodic read is the Todo screen's, which tells each window after it (`orca_popout_update`), and the page then reads what that read kept (`todoist_cached`), so the calls to Todoist are once a period whatever the number of windows.
// A change shows in the screen and in this window after the next such read, and not while a field is typed in or a change is on its way.
// A task that Todoist no longer has (completed or deleted here or on the screen) ends the window: the page asks for the close, as its red button does.
import { $ } from "./dom.js";
import { invoke } from "./ipc.js";
import { ownTodo } from "./todo.js";
import { editingField, todoState, useTaskWindow } from "./todo-data.js";
import { renderDetail } from "./todo-detail.js";

// What the page of the window gives: a failure to show, the name of the task to put in the header, and the end of the window (the task is gone).
export interface TodoWindowPage {
  fail: (e: unknown) => void;
  named: (name: string) => void;
  gone: () => void;
}

let page: TodoWindowPage | null = null;
let taskId: string | null = null;
let ended = false;
// Consecutive timed reads that failed: the card comes at the third, as the screen's log line does.
let quietFails = 0;

function render() {
  todoState.undrawn = false;
  const task = taskId === null ? undefined : todoState.taskById.get(taskId);
  if (!task) {
    // Not before the data is read: a task that is not there yet is not a task that is gone.
    if (todoState.todo && !ended) {
      ended = true;
      page?.gone();
    }
    return;
  }
  page?.named(task.content);
  renderDetail($("todo-detail"), task.id);
}

// Reads the tasks and draws the detail. `cached` is the read after the screen's (the notice): it takes what the screen's read kept and asks Todoist nothing, and it never ends a read of the page's own that is on its way.
// `quiet` is that read too: it reads nothing while a field is typed in or a change is on its way, and draws nothing when nothing changed. True when a token is needed.
async function load(quiet: boolean, withDone: boolean, cached = false) {
  if (quiet && (editingField() || todoState.writes)) return false;
  const seq = cached ? todoState.seq : ++todoState.seq;
  try {
    const data = await (cached ? invoke("todoist_cached") : invoke("todoist_load", { withDone: withDone || todoState.doneStale }));
    quietFails = 0;
    if (data && !data.offline && !cached) todoState.doneStale = false;
    // Not while a change is in flight: the read after the last one draws.
    if (seq !== todoState.seq || todoState.writes) return false;
    if (data === null) {
      // Nothing kept is no news; a missing token is.
      if (cached) return false;
      page?.fail("Todoist のトークンがありません");
      return true;
    }
    const text = quiet ? JSON.stringify(data) : null;
    const same = text !== null && text === todoState.text;
    todoState.text = text;
    todoState.todo = data;
    todoState.loaded = seq;
    todoState.kept = false;
    todoState.projectById = new Map(data.projects.map((p) => [p.id, p]));
    todoState.taskById = new Map(data.tasks.map((t) => [t.id, t]));
    // A field being typed in keeps what was typed; the detail is drawn by the next read.
    if (editingField()) {
      todoState.undrawn = true;
      return false;
    }
    if (quiet && same && !todoState.undrawn) return false;
    render();
  } catch (e) {
    if (!quiet || ++quietFails === 3) page?.fail(e);
  }
  return false;
}

function start(shown: TodoWindowPage) {
  page = shown;
  useTaskWindow();
  // A window shows one task: the subtask rows and the parent chip of its detail open nothing.
  ownTodo({ render, load: (quiet, withDone) => load(quiet, withDone), open: () => {} });
}

// Shows the task `id`. The screen gives the tab again when its name changes and after each of its reads of the tasks: the page then reads what that read kept.
export function showTodo(id: string, shown: TodoWindowPage) {
  if (page === null) start(shown);
  const first = taskId !== id;
  taskId = id;
  if (first) void load(false, true);
  else void load(true, false, true);
}
