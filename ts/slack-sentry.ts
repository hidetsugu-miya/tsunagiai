// The buttons of a Sentry notification in the thread (S-30): Resolve, Archive and Unresolve work on the issue in Sentry, with the workspace's Sentry token (S-29), through `sentry_set_status`.
// Rust says which message is a Sentry notification, which buttons it has and which issue it is about (`ThreadMessage.sentry`); only the values of Sentry's own buttons are sent, and the dialog offers the same choices as Sentry's in Slack.
// Resolve and Archive open a small dialog to choose from and send with its button; Unresolve sends at once. The buttons are off while the request is on its way.
import type { SentryButton } from "./bindings/SentryButton";
import type { SentryIssue } from "./bindings/SentryIssue";
import { tag } from "./dom.js";
import { invoke } from "./ipc.js";
import { toast } from "./toast.js";

interface Choice {
  label: string;
  value: string;
}

// The dialog of a button: its title, the name of its choice and the choices (Sentry's values), the first one chosen at first.
const DIALOGS: Record<string, { title: string; name: string; choices: Choice[] }> = {
  resolve_dialog: {
    title: "Resolve Issue",
    name: "Resolve",
    choices: [
      { label: "Immediately", value: "resolved" },
      { label: "In the next release", value: "resolved:inNextRelease" },
      { label: "In the current release", value: "resolved:inCurrentRelease" },
    ],
  },
  archive_dialog: {
    title: "Archive Issue",
    name: "Archive",
    choices: [
      { label: "Until escalating", value: "ignored:archived_until_escalating" },
      { label: "Until 10 events", value: "ignored:archived_until_condition_met:10" },
      { label: "Until 100 events", value: "ignored:archived_until_condition_met:100" },
      { label: "Until 1000 events", value: "ignored:archived_until_condition_met:1000" },
      { label: "Forever", value: "ignored:archived_forever" },
    ],
  },
};

// Opens the dialog of `kind` over the screen; `send` gets the value chosen. It closes with Escape, with the cancel button and with a press on the dimmed screen around it.
function openDialog(kind: { title: string; name: string; choices: Choice[] }, anchor: HTMLElement, send: (value: string) => void) {
  const select = tag("select", "sentry-select");
  select.setAttribute("aria-label", kind.name);
  for (const c of kind.choices) select.append(new Option(c.label, c.value));
  const row = tag("label", "sentry-row");
  row.append(tag("span", "", kind.name), select);
  const cancel = tag("button", "text-btn", "キャンセル");
  cancel.type = "button";
  const go = tag("button", "text-btn primary", kind.name);
  go.type = "button";
  const foot = tag("div", "sentry-foot");
  foot.append(cancel, go);
  const dialog = tag("div", "sentry-dialog");
  dialog.setAttribute("role", "dialog");
  dialog.setAttribute("aria-modal", "true");
  dialog.setAttribute("aria-label", kind.title);
  dialog.append(tag("h2", "", kind.title), row, foot);
  const scrim = tag("div", "scrim sentry-scrim");
  scrim.append(dialog);

  const behind = [...document.querySelectorAll<HTMLElement>("#sidebar, #content")];
  const close = () => {
    scrim.remove();
    for (const el of behind) el.inert = false;
    document.removeEventListener("keydown", onKey);
    anchor.focus();
  };
  const onKey = (e: KeyboardEvent) => {
    if (e.key === "Escape") close();
  };
  cancel.onclick = close;
  scrim.onpointerdown = (e) => {
    if (e.target !== scrim) return;
    e.preventDefault();
    close();
  };
  go.onclick = () => {
    const value = select.value;
    close();
    send(value);
  };
  for (const el of behind) el.inert = true;
  document.addEventListener("keydown", onKey);
  document.body.append(scrim);
  select.focus();
}

// The row of buttons of a Sentry notification of the workspace `teamId`; `done` is called after Sentry took the change, to read the thread again.
export function sentryNode(issue: SentryIssue, teamId: string, done: () => void) {
  const row = tag("div", "st-acts st-sentry");
  const buttons: HTMLButtonElement[] = [];
  const send = async (text: string, value: string) => {
    for (const b of buttons) b.disabled = true;
    try {
      await invoke("sentry_set_status", { teamId, org: issue.org, issueId: issue.issueId, value });
    } catch (e) {
      for (const b of buttons) b.disabled = false;
      toast(`Sentry に送れませんでした: ${e}`);
      return;
    }
    toast(`Sentry に送りました: ${text}`);
    done();
  };
  const buttonNode = (b: SentryButton) => {
    const node = tag("button", "text-btn", b.text);
    node.type = "button";
    const dialog = DIALOGS[b.value];
    node.onclick = () => (dialog ? openDialog(dialog, node, (value) => send(b.text, value)) : send(b.text, b.value));
    return node;
  };
  buttons.push(...issue.buttons.map(buttonNode));
  row.append(...buttons);
  return row;
}
