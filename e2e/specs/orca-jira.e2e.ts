import { callsOf, CARD, CARDS, count, holds, jiraBoard, jiraDetail, jiraIssue, jiraIssues, jiraSprint, logged, mock, onceId, rejects, release, textsOf, waitForCalls, waitForCount, waitForLog } from "../support";
import { filesToggle, openOrca, orcaOverview, project, sample, selectedTab, tabOf, worktrees } from "../orca-support";

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

  // J-2 (#871): the ticket in a tab of the work pane.
  const detailOf = {
    "EX-1": jiraDetail("EX-1", {
      summary: "Write the page",
      description: "Show **the ticket**.\n\n- one\n- two\n\n[spec](https://example.com/spec) and [bad](javascript:alert(1))\n\n<form><input name=\"x\"></form>",
      status: "In Progress",
      statusCategory: "indeterminate",
      assignee: "Mia",
      priority: "High",
      sprint: "Sprint 12",
      labels: ["ui", "ready"],
      parent: { key: "EX-100", summary: "The epic" },
      comments: [
        { author: "Ann", created: "2026-11-20 09:30", body: "Looks **good**" },
        { author: "Bob", created: "2026-11-21 18:05", body: "" },
      ],
    }),
    "EX-2": jiraDetail("EX-2", { summary: "Fix the list", status: "Done", statusCategory: "done" }),
  };
  const withTickets = () => jiraFixtures({ jira_details: detailOf });
  // The page's own double press on a row of the list.
  const openTicket = (key: string) =>
    browser.execute(
      (k, once) => {
        if (!window.__e2e_once__(once)) return;
        document.querySelector(`.orca-jira-issue[data-key="${k}"]`)!.dispatchEvent(new MouseEvent("dblclick", { bubbles: true, cancelable: true }));
      },
      key,
      onceId(),
    );
  const rightClickTab = (tab: string) =>
    browser.execute(
      (id, once) => {
        if (!window.__e2e_once__(once)) return;
        document.querySelector(`[data-tab="${id}"]`)!.dispatchEvent(new MouseEvent("contextmenu", { bubbles: true, cancelable: true, button: 2 }));
      },
      tab,
      onceId(),
    );

  it("opens the ticket in a tab of the work pane by a double press on its row, and not by one press, and reads it (J-2)", async () => {
    await openJira(withTickets());
    await waitForCount("#orca-jira-list .orca-jira-issue", 5);
    await $('.orca-jira-issue[data-key="EX-1"]').click();
    expect(await callsOf("jira_issue")).toEqual([]);
    expect(await count(".orca-jira-tab")).toBe(0);
    await openTicket("EX-1");
    await expect(tabOf("jira:1")).toBeDisplayed();
    await expect(tabOf("jira:1").$(".orca-tab-btn")).toHaveAttribute("aria-selected", "true");
    await expect(tabOf("jira:1").$(".orca-tab-title")).toHaveText("EX-1");
    await expect(tabOf("jira:1").$(".orca-file-tab-ic svg")).toExist();
    expect(await waitForCalls("jira_issue")).toEqual([{ key: "EX-1" }]);
    await expect($(".orca-jira-tab .orca-jira-title")).toHaveText("Write the page");
    // The tickets of the list stay where they were: the part is still shown.
    await expect($("#orca-jira")).toBeDisplayed();
  });

  it("draws the key with its parent, the summary, the description as Markdown and the comments, and the fields in the right column (J-2)", async () => {
    await openJira(withTickets());
    await waitForCount("#orca-jira-list .orca-jira-issue", 5);
    await openTicket("EX-1");
    await expect($(".orca-jira-tab .orca-jira-title")).toBeDisplayed();
    expect(await textsOf(".orca-jira-tab-head .orca-edit-path")).toEqual(["EX-1"]);
    expect(await textsOf(".orca-jira-crumb")).toEqual(["EX-100/EX-1"]);
    const html = await browser.execute(() => document.querySelector(".orca-jira-main > .md")!.innerHTML);
    expect(html).toContain("<strong>the ticket</strong>");
    expect(html).toContain("<li>one</li>");
    expect(html).toContain('href="https://example.com/spec"');
    // What the sanitizer of the Todo comments drops: an address that is not http(s), and a form.
    expect(html).not.toContain("javascript:");
    expect(await count(".orca-jira-main > .md form, .orca-jira-main > .md input")).toBe(0);
    expect(await textsOf(".orca-jira-comments-head")).toEqual(["コメント 2 件"]);
    expect(await textsOf(".orca-jira-comment")).toEqual(["Ann2026-11-20 09:30Looks good", "Bob2026-11-21 18:05"]);
    expect(await textsOf(".orca-jira-side-row")).toEqual(["ステータスIn Progress", "担当Mia", "スプリントSprint 12", "優先度High", "ラベルuiready", "親EX-100The epic"]);
    await expect($(".orca-jira-pill")).toHaveAttribute("data-category", "indeterminate");
    expect(await count(".orca-jira-tab [placeholder]")).toBe(0);
  });

  it("says that a field has nothing when the ticket has none, and has no parent in its key line (J-2)", async () => {
    await openJira(withTickets());
    await waitForCount("#orca-jira-list .orca-jira-issue", 5);
    await openTicket("EX-2");
    await expect($(".orca-jira-tab .orca-jira-title")).toHaveText("Fix the list");
    expect(await textsOf(".orca-jira-crumb")).toEqual(["EX-2"]);
    expect(await textsOf(".orca-jira-side-row")).toEqual(["ステータスDone", "担当未割り当て", "スプリントなし", "優先度なし", "ラベルなし", "親なし"]);
    expect(await textsOf(".orca-jira-comments-head")).toEqual(["コメント 0 件"]);
    expect(await count(".orca-jira-main > .md")).toBe(0);
    await expect($(".orca-jira-pill")).toHaveAttribute("data-category", "done");
  });

  it("selects the tab of a ticket that is open and reads it again, and gives another ticket a tab of its own (J-2)", async () => {
    await openJira(withTickets());
    await waitForCount("#orca-jira-list .orca-jira-issue", 5);
    await openTicket("EX-1");
    await expect(tabOf("jira:1")).toBeDisplayed();
    await openTicket("EX-2");
    await expect(tabOf("jira:2").$(".orca-tab-btn")).toHaveAttribute("aria-selected", "true");
    await expect($(".orca-jira-tab .orca-jira-title")).toHaveText("Fix the list");
    await tabOf("jira:1").$(".orca-tab-btn").click();
    await expect($(".orca-jira-tab .orca-jira-title")).toHaveText("Write the page");
    await openTicket("EX-1");
    await waitForCalls("jira_issue", 3);
    expect(await callsOf("jira_issue")).toEqual([{ key: "EX-1" }, { key: "EX-2" }, { key: "EX-1" }]);
    expect(await count('.orca-tab[data-jira="true"]')).toBe(2);
    await expect(tabOf("jira:1").$(".orca-tab-btn")).toHaveAttribute("aria-selected", "true");
  });

  it("shows the reason in place of the ticket when it cannot be read, writes it to the log with no card, and reads again with the button (J-2)", async () => {
    await openJira(withTickets());
    await waitForCount("#orca-jira-list .orca-jira-issue", 5);
    await mock("jira_issue", rejects("Jira が 404 を返しました: no ticket"));
    await openTicket("EX-1");
    await waitForCount(".orca-jira-tab .orca-file-note.fail", 1);
    expect(await textsOf(".orca-jira-tab .orca-file-note.fail")).toEqual(["Jira が 404 を返しました: no ticket"]);
    expect((await logged()).some((l) => l.level === "error" && l.source === "orca-jira")).toBe(true);
    expect(await count("#error-cards .error-card")).toBe(0);
    expect(await count(".orca-jira-side")).toBe(0);
    await mock("jira_issue", detailOf["EX-1"]);
    await $('.orca-jira-tab-head .icon-btn[aria-label="読み直す"]').click();
    await expect($(".orca-jira-tab .orca-jira-title")).toHaveText("Write the page");
    expect(await count(".orca-jira-tab .orca-file-note.fail")).toBe(0);
    // `mock` cleared the record: this is the read of the button.
    expect(await callsOf("jira_issue")).toEqual([{ key: "EX-1" }]);
  });

  it("says how many comments were read when Jira has more (J-2)", async () => {
    await openJira(jiraFixtures({ jira_details: { "EX-1": { ...detailOf["EX-1"], commentsTruncated: true } } }));
    await waitForCount("#orca-jira-list .orca-jira-issue", 5);
    await openTicket("EX-1");
    await waitForCount(".orca-jira-comments .orca-file-note", 1);
    expect(await textsOf(".orca-jira-comments .orca-file-note")).toEqual(["2 件で打ち切りました"]);
  });

  it("closes the tab with its close button, and has the split rows only in its menu, with no window of its own (J-2, A-17)", async () => {
    await openJira(withTickets());
    await waitForCount("#orca-jira-list .orca-jira-issue", 5);
    await openTicket("EX-1");
    await expect(tabOf("jira:1")).toBeDisplayed();
    await rightClickTab("jira:1");
    await expect($('.menu[role="menu"]')).toBeDisplayed();
    expect(await textsOf('.menu[role="menu"] > *')).toEqual(["右に分割", "下に分割"]);
    await browser.keys("Escape");
    await expect($(".menu")).not.toExist();
    await $('.orca-tab[data-jira="true"] .orca-tab-close').click();
    await expect($('.orca-tab[data-jira="true"]')).not.toExist();
    expect(await count(".orca-jira-tab")).toBe(0);
    // The tab was kept in memory only: nothing was called for the close, and a second press opens a new one.
    expect(await callsOf("jira_issue")).toHaveLength(1);
    await openTicket("EX-1");
    await expect($(".orca-jira-tab .orca-jira-title")).toHaveText("Write the page");
    expect(await callsOf("jira_issue")).toHaveLength(2);
  });

  // J-2 (#872): the status, the assignee, the sprint and the priority are changed in the right column.
  const FIELD = { status: 1, assignee: 2, sprint: 3, priority: 4 };
  const editButton = (field: number) => $(`.orca-jira-side-row:nth-child(${field}) .orca-jira-edit`);
  const sideTexts = () => textsOf(".orca-jira-side-row");
  const menuTexts = () => textsOf('.menu[role="menu"] [role="menuitem"]');
  const menuItem = async (index: number) => (await $$('.menu[role="menu"] [role="menuitem"]'))[index];
  // The ticket EX-1 open in its tab, with the tickets of the list drawn.
  async function openEditable() {
    await openJira(withTickets());
    await waitForCount("#orca-jira-list .orca-jira-issue", 5);
    await openTicket("EX-1");
    await expect($(".orca-jira-tab .orca-jira-title")).toBeDisplayed();
  }
  const transitions = [
    { id: "11", status: "To Do", statusCategory: "new" },
    { id: "21", status: "Done", statusCategory: "done" },
    { id: "31", status: "In Progress", statusCategory: "indeterminate" },
  ];

  it("makes the four fields buttons, and leaves the labels and the parent as they are (J-2)", async () => {
    await openEditable();
    expect(await count(".orca-jira-side .orca-jira-edit")).toBe(4);
    expect(await count(".orca-jira-side-row:nth-child(5) button, .orca-jira-side-row:nth-child(6) button")).toBe(0);
    expect(await sideTexts()).toEqual(["ステータスIn Progress", "担当Mia", "スプリントSprint 12", "優先度High", "ラベルuiready", "親EX-100The epic"]);
    // The options are asked when a button is pressed, not when the ticket is read.
    expect(await callsOf("jira_transitions")).toEqual([]);
    expect(await callsOf("jira_assignable")).toEqual([]);
    expect(await callsOf("jira_priorities")).toEqual([]);
  });

  it("offers the transitions of the ticket except its own status, takes one, and draws the new status in the tab and in the list (J-2)", async () => {
    await openEditable();
    await mock("jira_transitions", transitions);
    await mock("jira_transition", null);
    await editButton(FIELD.status).click();
    expect(await waitForCalls("jira_transitions")).toEqual([{ key: "EX-1" }]);
    await waitForCount('.menu[role="menu"]', 1);
    expect(await menuTexts()).toEqual(["To Do", "Done"]);
    await (await menuItem(1)).click();
    expect(await waitForCalls("jira_transition")).toEqual([{ key: "EX-1", transitionId: "21" }]);
    await expect($(".orca-jira-side-row:nth-child(1) .orca-jira-pill")).toHaveText("Done");
    await expect($(".orca-jira-side-row:nth-child(1) .orca-jira-pill")).toHaveAttribute("data-category", "done");
    expect(await rowOf("EX-1")).toMatchObject({ status: "Done", category: "done", keyLine: "line-through" });
    expect(await count(CARDS)).toBe(0);
    await expect(editButton(FIELD.status)).toBeEnabled();
  });

  it("shows the new value at once, keeps the fields off while Jira answers, and puts the old value back with the reason when Jira refuses (J-2)", async () => {
    await openEditable();
    await mock("jira_transitions", transitions);
    await mock("jira_transition", holds);
    await editButton(FIELD.status).click();
    await waitForCount('.menu[role="menu"]', 1);
    await (await menuItem(1)).click();
    await waitForCalls("jira_transition");
    await expect($(".orca-jira-side-row:nth-child(1) .orca-jira-pill")).toHaveText("Done");
    for (const field of Object.values(FIELD)) await expect(editButton(field)).toBeDisabled();
    await expect($('.orca-jira-tab-head .icon-btn[aria-label="読み直す"]')).toBeDisabled();
    await release("jira_transition", rejects("Jira が 400 を返しました: resolution is required"));
    await expect($(".orca-jira-side-row:nth-child(1) .orca-jira-pill")).toHaveText("In Progress");
    await expect($(".orca-jira-side-row:nth-child(1) .orca-jira-pill")).toHaveAttribute("data-category", "indeterminate");
    expect(await textsOf(CARD)).toEqual(["Jira が 400 を返しました: resolution is required"]);
    expect((await logged()).some((l) => l.level === "error" && l.source === "orca-jira")).toBe(true);
    // The list still has the old value, and the fields work again.
    expect(await rowOf("EX-1")).toMatchObject({ status: "In Progress", category: "indeterminate" });
    for (const field of Object.values(FIELD)) await expect(editButton(field)).toBeEnabled();
  });

  it("shows a card and no menu when the options cannot be read (J-2)", async () => {
    await openEditable();
    await mock("jira_transitions", rejects("Jira が認証を拒否しました（403）"));
    await editButton(FIELD.status).click();
    await waitForCount(CARDS, 1);
    expect(await textsOf(CARD)).toEqual(["Jira が認証を拒否しました（403）"]);
    expect(await count(".menu")).toBe(0);
    await expect(editButton(FIELD.status)).toBeEnabled();
    expect(await callsOf("jira_transition")).toEqual([]);
  });

  it("assigns the ticket to a person of the list, to no one, and not again to the one it has (J-2)", async () => {
    await openEditable();
    await mock("jira_assignable", [
      { accountId: "a1", displayName: "Ann" },
      { accountId: "m2", displayName: "Mia" },
    ]);
    await mock("jira_assign", null);
    await editButton(FIELD.assignee).click();
    expect(await waitForCalls("jira_assignable")).toEqual([{ key: "EX-1" }]);
    await waitForCount('.menu[role="menu"]', 1);
    expect(await menuTexts()).toEqual(["未割り当て", "Ann", "Mia"]);
    await expect($('.menu .menu-search[aria-label="担当を探す"]')).toBeDisplayed();
    // Mia has it already: nothing is sent.
    await (await menuItem(2)).click();
    expect(await callsOf("jira_assign")).toEqual([]);
    await editButton(FIELD.assignee).click();
    await waitForCount('.menu[role="menu"]', 1);
    await (await menuItem(1)).click();
    expect(await waitForCalls("jira_assign")).toEqual([{ key: "EX-1", accountId: "a1" }]);
    await expect(editButton(FIELD.assignee)).toHaveText("Ann");
    await editButton(FIELD.assignee).click();
    await waitForCount('.menu[role="menu"]', 1);
    await (await menuItem(0)).click();
    await waitForCalls("jira_assign", 2);
    expect(await callsOf("jira_assign")).toEqual([
      { key: "EX-1", accountId: "a1" },
      { key: "EX-1", accountId: null },
    ]);
    await expect(editButton(FIELD.assignee)).toHaveText("未割り当て");
    await expect(editButton(FIELD.assignee)).toHaveElementClass("none");
  });

  it("gives the ticket a priority of the list that Jira allows it, and says so when there is none to choose (J-2)", async () => {
    await openEditable();
    await mock("jira_priorities", [
      { id: "1", name: "Highest" },
      { id: "2", name: "High" },
    ]);
    await mock("jira_set_priority", null);
    await editButton(FIELD.priority).click();
    expect(await waitForCalls("jira_priorities")).toEqual([{ key: "EX-1" }]);
    await waitForCount('.menu[role="menu"]', 1);
    expect(await menuTexts()).toEqual(["Highest", "High"]);
    await (await menuItem(0)).click();
    expect(await waitForCalls("jira_set_priority")).toEqual([{ key: "EX-1", priorityId: "1" }]);
    await expect(editButton(FIELD.priority)).toHaveText("Highest");
    await mock("jira_priorities", []);
    await editButton(FIELD.priority).click();
    await waitForCount('.menu[role="menu"]', 1);
    expect(await menuTexts()).toEqual(["選べるものがありません"]);
    await expect(await menuItem(0)).toBeDisabled();
  });

  it("moves the ticket to a sprint of its board or to the backlog, and reads the sections of the list again (J-2)", async () => {
    await openEditable();
    await mock("jira_sprints", [sprint12, sprint13]);
    await mock("jira_set_sprint", null);
    const before = { sprint: (await callsOf("jira_sprint_issues")).length, backlog: (await callsOf("jira_backlog")).length };
    await editButton(FIELD.sprint).click();
    expect(await waitForCalls("jira_sprints")).toEqual([{ boardId: 1 }]);
    await waitForCount('.menu[role="menu"]', 1);
    expect(await menuTexts()).toEqual(["バックログ", "Sprint 12", "Sprint 13"]);
    await (await menuItem(2)).click();
    expect(await waitForCalls("jira_set_sprint")).toEqual([{ key: "EX-1", sprintId: 13 }]);
    await expect(editButton(FIELD.sprint)).toHaveText("Sprint 13");
    await waitForCalls("jira_sprint_issues", before.sprint + 1);
    await waitForCalls("jira_backlog", before.backlog + 1);
    await editButton(FIELD.sprint).click();
    await waitForCount('.menu[role="menu"]', 1);
    await (await menuItem(0)).click();
    await waitForCalls("jira_set_sprint", 2);
    expect(await callsOf("jira_set_sprint")).toEqual([
      { key: "EX-1", sprintId: 13 },
      { key: "EX-1", sprintId: null },
    ]);
    await expect(editButton(FIELD.sprint)).toHaveText("なし");
    expect(await count(CARDS)).toBe(0);
  });

  it("keeps the other rows of the list as they are, and does not read the ticket again after a change (J-2)", async () => {
    await openEditable();
    await mock("jira_transitions", transitions);
    await mock("jira_transition", null);
    await editButton(FIELD.status).click();
    await waitForCount('.menu[role="menu"]', 1);
    await (await menuItem(0)).click();
    await waitForCalls("jira_transition");
    await expect($(".orca-jira-side-row:nth-child(1) .orca-jira-pill")).toHaveText("To Do");
    expect(await rowOf("EX-1")).toMatchObject({ status: "To Do", category: "new" });
    expect(await rowOf("EX-3")).toMatchObject({ status: "To Do", category: "new" });
    expect(await rowOf("EX-2")).toMatchObject({ status: "Done", category: "done" });
    // The change is taken as it is: the ticket is not read again.
    expect(await callsOf("jira_issue")).toEqual([{ key: "EX-1" }]);
  });
});
