import { callsOf, count, jiraBoard, jiraIssue, jiraIssues, jiraSprint, logged, mock, rejects, textsOf, waitForCalls, waitForCount, waitForLog } from "../support";
import { filesToggle, openOrca, orcaOverview, project, sample, selectedTab, worktrees } from "../orca-support";

// J-2: the Jira part of the file pane (#870). Rust reads the boards, the sprints and the tickets (unit tests); here the screen is checked: what it asks of Rust, and how it draws the answers.
describe("orca: the Jira part of the file pane (J-2)", () => {
  const connected = { site: "https://example.atlassian.net", email: "me@example.com", hasToken: true };
  const board = jiraBoard(1, "Example board");
  const sprint12 = jiraSprint(12, "Sprint 12");
  const sprint13 = jiraSprint(13, "Sprint 13", "future");
  const issuesOf = {
    12: jiraIssues([jiraIssue("EX-1", "Write the page", "In Progress", "indeterminate"), jiraIssue("EX-2", "Fix the list", "Done", "done"), jiraIssue("EX-3", "Plan the work", "To Do")]),
    13: jiraIssues([jiraIssue("EX-4", "Draft the next step", "To Do")]),
  };
  const backlog = jiraIssues([jiraIssue("EX-5", "Clean up the old code", "To Do"), jiraIssue("EX-6", "Remove the flag", "Done", "done")]);
  // A connection with one scrum board, two sprints and a backlog.
  const jiraFixtures = (extra: Record<string, unknown> = {}) => ({ jira_settings: connected, jira_boards: [board, jiraBoard(2, "Example kanban", "kanban")], jira_sprints: [sprint12, sprint13], jira_issues_of: issuesOf, jira_backlog: backlog, ...extra });

  const paneMode = (label: string) => $(`#orca-files-bar [aria-label="${label}"]`);
  // The app with the file pane open on the example-app project.
  async function openFiles(fixtures: Record<string, unknown> = {}) {
    await openOrca(orcaOverview(sample(), worktrees()), { orca_terminal_read: ["$"], orca_files_list: { entries: [], total: 0 }, orca_files_ignored: [], editor_settings: { autosaveMs: 100 }, ...fixtures });
    await project("example-app").click();
    await expect(selectedTab()).toBeDisplayed();
    await filesToggle().click();
    await expect($("#orca-files")).toBeDisplayed();
  }
  async function openJira(fixtures: Record<string, unknown> = {}) {
    await openFiles(fixtures);
    await paneMode("Jira").click();
    await expect($("#orca-jira")).toBeDisplayed();
  }
  // The sections drawn: the key of each, with the keys of its tickets.
  const sectionsOf = () =>
    browser.execute(() =>
      [...document.querySelectorAll<HTMLElement>("#orca-jira-list .orca-jira-section")].map((s) => [s.dataset.key, ...[...s.querySelectorAll<HTMLElement>(".orca-jira-issue")].map((i) => i.dataset.key)]),
    );
  const rowOf = (key: string) =>
    browser.execute(
      (k) => {
        const row = document.querySelector<HTMLElement>(`.orca-jira-issue[data-key="${k}"]`)!;
        const part = (name: string) => row.querySelector<HTMLElement>(`.orca-jira-${name}`)!;
        return { key: part("key").textContent, summary: part("summary").textContent, status: part("status").textContent, category: row.dataset.category, keyLine: getComputedStyle(part("key")).textDecorationLine, summaryLine: getComputedStyle(part("summary")).textDecorationLine };
      },
      key,
    );
  const select = (id: string) => $(`#${id}`);
  // Chooses an option as the page does: the driver's choice of an option of a select sends no `change` in this WebView.
  const pick = (id: string, value: string) =>
    browser.execute(
      (i, v) => {
        const field = document.getElementById(i) as HTMLSelectElement;
        field.value = v;
        field.dispatchEvent(new Event("change"));
      },
      id,
      value,
    );
  const optionsOf = (id: string) => browser.execute((i) => [...document.querySelectorAll<HTMLOptionElement>(`#${i} option`)].map((o) => [o.value, o.textContent]), id);

  it("has the Jira button after the database one, and reads nothing until the part is shown (J-2)", async () => {
    await openFiles(jiraFixtures());
    await expect(paneMode("Jira")).toHaveAttribute("aria-pressed", "false");
    await expect($("#orca-jira")).not.toBeDisplayed();
    expect(await callsOf("jira_settings")).toEqual([]);
    await paneMode("Jira").click();
    await expect(paneMode("Jira")).toHaveAttribute("aria-pressed", "true");
    await expect(paneMode("ファイル")).toHaveAttribute("aria-pressed", "false");
    await expect($("#orca-jira")).toBeDisplayed();
    await expect($("#orca-files-tree")).not.toBeDisplayed();
    await expect($("#orca-files-head")).not.toBeDisplayed();
    expect(await waitForCalls("jira_settings")).toEqual([null]);
    await paneMode("ファイル").click();
    await expect($("#orca-jira")).not.toBeDisplayed();
    await expect($("#orca-files-head")).toBeDisplayed();
  });

  it("says that Jira is not connected when no site or no token is saved, and leads to the Jira card of the settings (J-2)", async () => {
    await openJira();
    await waitForCount("#orca-jira-list .orca-jira-none", 1);
    expect(await textsOf("#orca-jira-list .orca-jira-none")).toEqual(["Jira に接続されていません設定を開く"]);
    expect(await callsOf("jira_boards")).toEqual([]);
    await $("#orca-jira-list .orca-jira-none .text-btn").click();
    await expect($("#settings")).toBeDisplayed();
    await expect($("#settings-tab-orca")).toHaveAttribute("aria-selected", "true");
    // The connection is saved there, and the screen reads it again when it is shown.
    await mock("jira_settings", connected);
    await mock("jira_boards", [board]);
    await mock("jira_sprints", [sprint12]);
    await mock("jira_backlog", jiraIssues([]));
    await mock("jira_sprint_issues", issuesOf[12]);
    await $("#nav-orca").click();
    await waitForCalls("jira_boards");
    await waitForCount("#orca-jira-list .orca-jira-section", 2);
    expect(await count(".orca-jira-none")).toBe(0);
  });

  it("reads the scrum boards, the sprints, the tickets of the first sprint and the backlog, and draws a row for each ticket (J-2)", async () => {
    await openJira(jiraFixtures());
    await waitForCount("#orca-jira-list .orca-jira-issue", 5);
    expect(await callsOf("jira_boards")).toEqual([null]);
    expect(await callsOf("jira_sprints")).toEqual([{ boardId: 1 }]);
    expect(await callsOf("jira_sprint_issues")).toEqual([{ sprintId: 12 }]);
    expect(await callsOf("jira_backlog")).toEqual([{ boardId: 1 }]);
    expect(await sectionsOf()).toEqual([["s12", "EX-1", "EX-2", "EX-3"], ["backlog", "EX-5", "EX-6"]]);
    expect(await textsOf(".orca-jira-head")).toEqual(["Sprint 12進行中3 件", "バックログ2 件"]);
    // Only the scrum board is read, so there is nothing to choose between.
    await expect(select("orca-jira-board")).not.toBeDisplayed();
    await expect(select("orca-jira-sprint")).toBeDisplayed();
    expect(await rowOf("EX-1")).toEqual({ key: "EX-1", summary: "Write the page", status: "In Progress", category: "indeterminate", keyLine: "none", summaryLine: "none" });
    expect(await count("#orca-jira-list [placeholder]")).toBe(0);
  });

  it("strikes through a ticket that is done and colors the status by its category (J-2)", async () => {
    await openJira(jiraFixtures());
    await waitForCount("#orca-jira-list .orca-jira-issue", 5);
    const done = await rowOf("EX-2");
    expect([done.category, done.keyLine, done.summaryLine]).toEqual(["done", "line-through", "line-through"]);
    expect((await rowOf("EX-6")).summaryLine).toBe("line-through");
    expect((await rowOf("EX-3")).summaryLine).toBe("none");
    const fills = await browser.execute(() => ["EX-3", "EX-1", "EX-2"].map((k) => getComputedStyle(document.querySelector(`.orca-jira-issue[data-key="${k}"] .orca-jira-status`)!).backgroundColor));
    expect(new Set(fills).size).toBe(3);
  });

  it("offers every sprint and reads the tickets of the sprints that the choice names, once (J-2)", async () => {
    await openJira(jiraFixtures());
    await waitForCount("#orca-jira-list .orca-jira-issue", 5);
    expect(await optionsOf("orca-jira-sprint")).toEqual([["all", "すべてのスプリント"], ["12", "Sprint 12"], ["13", "Sprint 13"]]);
    await pick("orca-jira-sprint", "all");
    await waitForCount("#orca-jira-list .orca-jira-section", 3);
    await waitForCount("#orca-jira-list .orca-jira-issue", 6);
    expect(await sectionsOf()).toEqual([["s12", "EX-1", "EX-2", "EX-3"], ["s13", "EX-4"], ["backlog", "EX-5", "EX-6"]]);
    expect(await textsOf(".orca-jira-state")).toEqual(["進行中", "予定"]);
    await pick("orca-jira-sprint", "13");
    await waitForCount("#orca-jira-list .orca-jira-section", 2);
    expect(await sectionsOf()).toEqual([["s13", "EX-4"], ["backlog", "EX-5", "EX-6"]]);
    expect(await callsOf("jira_sprint_issues")).toEqual([{ sprintId: 12 }, { sprintId: 13 }]);
    expect(await callsOf("jira_backlog")).toHaveLength(1);
  });

  it("narrows every section to the status that is chosen, and counts what is left (J-2)", async () => {
    await openJira(jiraFixtures());
    await waitForCount("#orca-jira-list .orca-jira-issue", 5);
    expect(await optionsOf("orca-jira-status")).toEqual([["", "すべてのステータス"], ["In Progress", "In Progress"], ["Done", "Done"], ["To Do", "To Do"]]);
    await pick("orca-jira-status", "Done");
    await waitForCount("#orca-jira-list .orca-jira-issue", 2);
    expect(await sectionsOf()).toEqual([["s12", "EX-2"], ["backlog", "EX-6"]]);
    expect(await textsOf(".orca-jira-count")).toEqual(["1 件", "1 件"]);
    await pick("orca-jira-status", "");
    await waitForCount("#orca-jira-list .orca-jira-issue", 5);
    expect(await callsOf("jira_sprint_issues")).toHaveLength(1);
  });

  it("reads the sprints and the backlog of another scrum board when it is chosen (J-2)", async () => {
    await openJira(jiraFixtures({ jira_boards: [board, jiraBoard(2, "Second board")], jira_sprints: [sprint12] }));
    await waitForCount("#orca-jira-list .orca-jira-issue", 5);
    await expect(select("orca-jira-board")).toBeDisplayed();
    expect(await optionsOf("orca-jira-board")).toEqual([["1", "Example board"], ["2", "Second board"]]);
    await mock("jira_sprints", [sprint13]);
    await mock("jira_backlog", jiraIssues([jiraIssue("OTH-1", "Other ticket", "To Do")]));
    await pick("orca-jira-board", "2");
    expect(await waitForCalls("jira_sprints")).toEqual([{ boardId: 2 }]);
    await waitForCount("#orca-jira-list .orca-jira-issue", 2);
    expect(await sectionsOf()).toEqual([["s13", "EX-4"], ["backlog", "OTH-1"]]);
    expect(await callsOf("jira_backlog")).toEqual([{ boardId: 2 }]);
  });

  it("says that a board has no scrum board when the boards are all of another kind (J-2)", async () => {
    await openJira(jiraFixtures({ jira_boards: [jiraBoard(2, "Example kanban", "kanban")] }));
    await waitForCount("#orca-jira-list .orca-jira-none", 1);
    expect(await textsOf("#orca-jira-list .orca-jira-none")).toEqual(["スクラムボードがありません"]);
    expect(await callsOf("jira_sprints")).toEqual([]);
  });

  it("keeps a section that failed apart from the others, with its message and a button that reads it again (J-2)", async () => {
    await openJira(jiraFixtures({ jira_backlog: rejects("Jira が認証を拒否しました（401）") }));
    await waitForCount("#orca-jira-list .pending.fail", 1);
    expect(await sectionsOf()).toEqual([["s12", "EX-1", "EX-2", "EX-3"], ["backlog"]]);
    expect(await textsOf("#orca-jira-list .pending.fail")).toEqual(["Jira が認証を拒否しました（401）再読み込み"]);
    expect((await logged()).some((l) => l.level === "error" && l.source === "orca-jira")).toBe(true);
    expect(await count("#error-cards .error-card")).toBe(0);
    await mock("jira_backlog", backlog);
    await $("#orca-jira-list .pending.fail .text-btn").click();
    expect(await waitForCalls("jira_backlog")).toEqual([{ boardId: 1 }]);
    await waitForCount("#orca-jira-list .orca-jira-issue", 5);
    expect(await callsOf("jira_sprint_issues")).toHaveLength(1);
  });

  it("shows a failed read of the boards as a row with its message, writes it to the log, and reads again with the button (J-2)", async () => {
    await openJira(jiraFixtures({ jira_boards: rejects("Jira が 500 を返しました: boom") }));
    await waitForCount("#orca-jira-list .pending.fail", 1);
    await waitForLog("Jira が 500 を返しました: boom");
    expect(await textsOf("#orca-jira-list .pending.fail")).toEqual(["Jira が 500 を返しました: boom再読み込み"]);
    await mock("jira_boards", [board]);
    await mock("jira_sprints", [sprint12]);
    await mock("jira_sprint_issues", issuesOf[12]);
    await mock("jira_backlog", backlog);
    await $("#orca-jira-list .pending.fail .text-btn").click();
    await waitForCount("#orca-jira-list .orca-jira-issue", 5);
    expect(await count("#orca-jira-list .pending.fail")).toBe(0);
  });

  it("says how many tickets were read when Jira has more, and reads everything again with the reload button (J-2)", async () => {
    await openJira(jiraFixtures({ jira_backlog: jiraIssues([jiraIssue("EX-5", "Clean up the old code", "To Do")], true) }));
    await waitForCount("#orca-jira-list .orca-jira-issue", 4);
    expect(await textsOf("#orca-jira-list .orca-file-note")).toEqual(["1 件で打ち切りました"]);
    await mock("jira_backlog", backlog);
    await $("#orca-jira-reload").click();
    await waitForCount("#orca-jira-list .orca-jira-issue", 5);
    expect(await count("#orca-jira-list .orca-file-note")).toBe(0);
    expect(await callsOf("jira_settings")).toHaveLength(2);
  });

  it("reads again each time the part is shown, and not at an interval (J-2)", async () => {
    await openJira(jiraFixtures());
    await waitForCount("#orca-jira-list .orca-jira-issue", 5);
    await paneMode("ファイル").click();
    await paneMode("Jira").click();
    await waitForCalls("jira_boards", 2);
    await waitForCount("#orca-jira-list .orca-jira-issue", 5);
    await browser.pause(1500);
    expect(await callsOf("jira_boards")).toHaveLength(2);
    expect(await callsOf("jira_sprint_issues")).toHaveLength(2);
  });
});
