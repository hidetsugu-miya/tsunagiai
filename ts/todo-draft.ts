// The page that opens when Claude has summarised a Slack message (S-2), in the place of the Todo list (the task detail's place, `#todo-main`): the draft of the Todo, shaped like the task detail (the name and the description, and beside them the project, the date and the labels),
// 破棄 at the bottom left and the add button at the bottom right. Nothing is created until the add button is pressed.
// The Todo header's back button (`#todo-back`, the one of the task detail) and 破棄 close it; Escape does not, so a draft is never lost by accident.
// The project list beside it is inert while the page is open, so that no other list can be chosen under it.
import type { Summary } from "./bindings/Summary";
import { $, composing, isMac, tag } from "./dom.js";
import { showFailure } from "./error-card.js";
import { hostOf } from "./format.js";
import { PLUS_SVG, SLACK_SVG } from "./icons.js";
import { getSlackWorkspaces } from "./slack-workspaces.js";
import { addSlackTodo, drawDueChip, type ReviewJob } from "./todo-add.js";
import { inboxOf, projectName, projectOf, todoState } from "./todo-data.js";
import { field, nameField, openProjectPicker } from "./todo-detail.js";
import { renderTodo } from "./todo.js";

// What the owner of the draft does with it: drop it (破棄, the back button), and learn that the task was added (`added` is its name; null when Todoist needs a token).
export interface DraftHooks {
  remove: () => void;
  added: (name: string | null) => void;
}

// The open draft: `page` is its node (it stays in the document while another screen is shown), `opener` where the focus returns, `discard` what 破棄 and the back button do.
let open: {
  page: HTMLElement;
  opener: HTMLElement | null;
  discard: () => void;
} | null = null;

// Whether a draft is open.
export const draftOpen = () => open !== null;

// Drops the open draft, as 破棄 does: the back button of the Todo header.
export const discardDraft = () => open?.discard();

// Takes the open draft off the page and draws the Todo screen in its place (the list, with the next waiting draft opened by that if there is one).
function close() {
  if (!open) return;
  const { page, opener } = open;
  open = null;
  page.remove();
  $<HTMLButtonElement>("todo-back").disabled = false;
  $("projects").inert = false;
  if (todoState.todo) renderTodo();
  if (!draftOpen()) (opener?.isConnected ? opener : $("todo-add-input")).focus();
}

export function openDraft(job: ReviewJob, summary: Summary, hooks: DraftHooks) {
  close();
  const name = nameField(summary.content);
  name.classList.add("draft-name");
  const description = tag("textarea", "draft-desc");
  description.value = summary.description;
  description.setAttribute("aria-label", "説明");

  // The due date is text Todoist reads (or empty); the field opens the same popover as a task's detail, which changes only this text.
  let dueText = summary.due ?? "";
  const dueButton = tag("button", "field-value draft-due");
  dueButton.type = "button";
  const showDue = () =>
    drawDueChip(dueButton, dueText || (job.today ? "空なら今日" : "期限なし"), dueText, (text) => {
      dueText = text.trim();
      showDue();
    });
  showDue();

  const add = tag("button", "draft-add");
  add.type = "button";
  const projectButton = tag("button", "field-value draft-project");
  projectButton.type = "button";
  const showProject = () => {
    const id = job.projectId ?? inboxOf()?.id ?? "";
    const p = projectOf(id);
    const dot = tag("span", "pdot");
    dot.style.background = p?.color as string;
    projectButton.replaceChildren(dot, projectName(p));
    // Choosing another project takes the tag off the chip; the menu keeps it on its row.
    if (job.recommended !== null && id === job.recommended) projectButton.append(tag("span", "tag", "推奨"));
    add.setAttribute("aria-label", `${projectName(p)}に追加`);
  };
  showProject();
  projectButton.onclick = () =>
    todoState.todo &&
    openProjectPicker(
      projectButton,
      job.projectId ?? inboxOf()?.id,
      (id) => {
        job.projectId = id;
        showProject();
      },
      job.recommended,
    );
  // The labels are not sent: the add command takes none, so the field is only the frame of the task detail's.
  const labels = tag("div", "field");
  labels.append(tag("div", "field-label", "ラベル"));

  const team = getSlackWorkspaces()?.find((w) => hostOf(w.url) === job.host)?.team ?? job.host ?? "";
  // The workspace and the first line of the linked message (Rust cuts and flattens it); the line the header cannot hold is cut by the CSS.
  const source = tag("div", "draft-src");
  source.title = job.url;
  source.insertAdjacentHTML("beforeend", SLACK_SVG);
  source.append(tag("span", "draft-team", team));
  if (summary.targetText) source.append(tag("span", "draft-quote", summary.targetText));
  const openLink = tag("a", "link-btn draft-open", "Slack で開く");
  if (job.url.startsWith("https://")) openLink.setAttribute("href", job.url);
  const head = tag("div", "draft-head");
  head.append(source, openLink);

  // The link of the message is put at the end of the description by Rust; it is shown here as it will be, and cannot be edited.
  const link = tag("div", "draft-link", job.url);
  // Only when the summary leaves out some of the thread's messages (a long thread, or a part that Claude could not summarise).
  const omitted = summary.omitted > 0 ? [tag("div", "draft-omitted", `${summary.omitted} 件のメッセージは要約に含まれていません`)] : [];
  // Only when the linked message was long enough to be cut before it was summarised.
  const targetCut = summary.targetCut ? [tag("div", "draft-target-cut", "対象のメッセージは長いため、先頭だけを要約しました")] : [];
  const main = tag("div", "draft-main");
  main.append(name, description, link, ...omitted, ...targetCut);
  const side = tag("aside", "detail-side");
  side.append(field("プロジェクト", projectButton), field("日付", dueButton), labels);

  const back = $<HTMLButtonElement>("todo-back");
  const drop = tag("button", "text-btn danger draft-drop", "破棄");
  drop.type = "button";
  add.innerHTML = PLUS_SVG;
  const foot = tag("div", "draft-foot");
  foot.append(drop, tag("span", "draft-grow"), add);
  const todo = tag("section", "draft-todo");
  todo.append(head, main, side, foot);

  const page = tag("section", "draft");
  page.id = "todo-draft";
  page.setAttribute("aria-label", "Todo の案");
  page.tabIndex = -1;
  page.append(todo);

  let saving = false;
  const commit = async () => {
    if (saving) return;
    if (!name.value.trim()) return name.focus();
    saving = true;
    drop.disabled = add.disabled = back.disabled = true;
    add.replaceChildren(tag("span", "spin"));
    add.setAttribute("aria-label", "追加中");
    try {
      const added = await addSlackTodo(job, name.value, description.value, dueText);
      close();
      hooks.added(added);
    } catch (e) {
      // The draft stays as the user left it.
      showFailure("todo-draft", `追加できませんでした: ${e}`);
      saving = false;
      drop.disabled = add.disabled = back.disabled = false;
      add.innerHTML = PLUS_SVG;
      showProject();
    }
  };
  add.onclick = commit;
  const discard = () => {
    close();
    hooks.remove();
  };
  drop.onclick = discard;
  // Enter in the name, or Cmd+Enter (Ctrl+Enter off macOS) anywhere in the draft, adds.
  page.onkeydown = (e) => {
    if (e.key !== "Enter" || composing(e) || !(e.target === name || (isMac ? e.metaKey : e.ctrlKey))) return;
    e.preventDefault();
    commit();
  };

  open = { page, opener: document.activeElement as HTMLElement | null, discard };
  $("projects").inert = true;
  $("todo-main").append(page);
  // The page takes the list's place (and the title), and the back button shows.
  renderTodo();
  page.focus();
}
