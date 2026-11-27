// The page of the window of a task (T-11; Rust: `orca_popout.rs`, the page: `ts/popout.ts`): the detail of one task of Todoist, drawn by `renderDetail` of the Todo screen into `#todo-detail`.
// The page holds the Todo data as the screen does (`todoState`) and reads and writes through the same `todoist_*` commands (`todo-write.ts`); what the detail calls on the screen (draw, read again, open another task) is given to it here (`ownTodo`).
// A change shows in the screen and in this window after the next read: this page reads by the clock (10 seconds, as the screen does) while it is seen and once when it is seen again, and not while a field is typed in or a change is on its way.
// A task that Todoist no longer has (completed or deleted here or on the screen) ends the window: the page asks for the close, as its red button does.
import { $ } from "./dom.js";
import { periodMs } from "./e2e-timers.js";
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

// Reads the tasks and draws the detail. `quiet` is the timed read: it reads nothing while a field is typed in or a change is on its way, and draws nothing when nothing changed. True when a token is needed.
async function load(quiet: boolean, withDone: boolean) {
  if (quiet && (editingField() || todoState.writes)) return false;
  const seq = ++todoState.seq;
  try {
    const data = await invoke("todoist_load", { withDone: withDone || todoState.doneStale });
    quietFails = 0;
    if (data && !data.offline) todoState.doneStale = false;
    // Not while a change is in flight: the read after the last one draws.
    if (seq !== todoState.seq || todoState.writes) return false;
    if (data === null) {
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
  ownTodo({ render, load, open: () => {} });
  const again = () => {
    if (!document.hidden && taskId !== null) void load(true, false);
  };
  window.setInterval(again, periodMs("todoWindow", 10_000));
  document.addEventListener("visibilitychange", again);
}

// Shows the task `id` (the screen gives the tab again when its name changes, which draws what is held and reads nothing).
export function showTodo(id: string, shown: TodoWindowPage) {
  if (page === null) start(shown);
  const first = taskId !== id;
  taskId = id;
  if (first) void load(false, true);
  else render();
}
