// The search of the Todo screen (T-9): the field in the header, and the results that take the place of the list while it holds a word.
import type { TaskHit } from "./bindings/TaskHit";
import { $ } from "./dom.js";
import { showFailure } from "./error-card.js";
import { invoke } from "./ipc.js";
import { searching, todoState } from "./todo-data.js";
import { renderTodo } from "./todo.js";

// Searches the text of the field and draws what it found, or the list that was shown when the text has no word. An answer that is not the latest is dropped.
export async function searchTodo() {
  const seq = ++todoState.searchSeq;
  let hits: TaskHit[] = [];
  if (searching()) {
    try {
      hits = await invoke("todoist_search", { query: todoState.query });
    } catch (e) {
      return showFailure("todo-search", e);
    }
  }
  if (seq !== todoState.searchSeq) return;
  todoState.hits = hits;
  renderTodo();
}

// Empties the field and forgets the results, and drops a search still on its way. It draws nothing: the caller does.
export function clearSearch() {
  todoState.query = "";
  todoState.hits = [];
  todoState.searchSeq++;
  $<HTMLInputElement>("todo-search-input").value = "";
  $("todo-search-clear").hidden = true;
}

export function initTodoSearch() {
  const input = $<HTMLInputElement>("todo-search-input");
  input.oninput = () => {
    todoState.query = input.value;
    $("todo-search-clear").hidden = input.value === "";
    // The results (or the list, when the text is emptied) take the screen from the open task.
    todoState.open = null;
    void searchTodo();
  };
  $("todo-search-clear").onclick = () => {
    clearSearch();
    todoState.open = null;
    void searchTodo();
    input.focus();
  };
}
