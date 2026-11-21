// The content a Slack thread or a Todo hands to Orca (A-9): a title, the line under it, and the text as plain text. Rust quotes it in the prompt (`orca_handoff`); nothing here is drawn as HTML.
import type { Comment } from "./bindings/Comment";
import type { HandoffKind } from "./bindings/HandoffKind";
import type { TaskItem } from "./bindings/TaskItem";
import type { ThreadMessage } from "./bindings/ThreadMessage";
import { formatDetailDate } from "./format.js";
import { slackMs } from "./slack-view.js";
import { dueLabel } from "./todo-data.js";

export interface HandoffCard {
  kind: HandoffKind;
  title: string;
  // The line under the title in the card.
  meta: string;
  body: string;
}

const chars = (text: string) => [...text].length;

// The thread as the screen shows it (and as S-7 gives it to Claude Code): the sender's name, the time and the text of each message.
export function slackCard(channelName: string, messages: ThreadMessage[]): HandoffCard {
  const body = messages.map((m) => `${m.name}  ${formatDetailDate(slackMs(m.ts))}\n${m.text}`).join("\n\n");
  const names = [...new Set(messages.map((m) => m.name))];
  const who = names.length === 0 ? "不明" : names.length === 1 ? names[0] : `${names[0]} ほか`;
  return { kind: "slack", title: `#${channelName} のスレッド`, meta: `${who} ・ ${messages.length} 件`, body };
}

// The task, with its project, due moment, description and the comments that are already loaded.
export function todoCard(task: TaskItem, project: string, comments: Comment[] | undefined): HandoffCard {
  const due = task.due ? dueLabel(task.due) : "";
  const lines = [`タスク: ${task.content}`];
  if (project) lines.push(`プロジェクト: ${project}`);
  if (due) lines.push(`期限: ${due}`);
  if (task.description.trim()) lines.push("", "説明:", task.description.trim());
  if (comments?.length) lines.push("", "コメント:", ...comments.map((c) => `- ${c.author}${c.posted ? ` (${c.posted.date}${c.posted.time ? ` ${c.posted.time}` : ""})` : ""}: ${c.content}`));
  const description = chars(task.description.trim());
  return { kind: "todo", title: task.content, meta: [description ? `説明 ${description} 字` : "説明なし", due].filter(Boolean).join(" ・ "), body: lines.join("\n") };
}
