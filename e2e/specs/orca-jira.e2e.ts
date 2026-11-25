import { callsOf, CARD, CARDS, count, holds, jiraBoard, jiraDetail, jiraIssue, jiraIssues, jiraIssueType, jiraProject, jiraSprint, logged, mock, onceId, rejects, release, textsOf, waitForCalls, waitForCount, waitForLog } from "../support";
import { filesToggle, openOrca, orcaOverview, project, sample, selectedTab, tabOf, worktrees } from "../orca-support";

// J-2: the Jira part of the file pane (#870). Rust reads the boards, the sprints and the tickets (unit tests); here the screen is checked: what it asks of Rust, and how it draws the answers.
describe("orca: the Jira part of the file pane (J-2)", () => {
  const connected = { site: "https://example.atlassian.net", email: "me@example.com", hasToken: true, boardId: null };
  // The project that the file pane shows (the example-app of the list, on this machine): every command takes its environment and its project (#1394).
  const here = { environment: null, project: "proj_example-app" };
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
        return { key: part("key").textContent, summary: part("summary").textContent, status: part("status").textContent, assignee: part("assignee").textContent, priority: row.querySelector(".orca-jira-priority")?.textContent ?? null, category: row.dataset.category, summaryLine: getComputedStyle(part("summary")).textDecorationLine, summaryColor: getComputedStyle(part("summary")).color };
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
    expect(await waitForCalls("jira_settings")).toEqual([here]);
    await paneMode("ファイル").click();
    await expect($("#orca-jira")).not.toBeDisplayed();
    await expect($("#orca-files-head")).toBeDisplayed();
  });

  // J-1 (#1395): the connection is registered, changed and deleted in the pane.
  const empty = { site: "", email: "", hasToken: false, boardId: null };
  const user = { displayName: "Example User", emailAddress: "me@example.com" };
  const field = (name: string) => $(`#orca-jira-conn [aria-label="${name}"]`);
  const gear = () => $("#orca-jira-config");
  const formButtons = () => browser.execute(() => [...document.querySelectorAll<HTMLButtonElement>("#orca-jira-conn-buttons .text-btn")].filter((b) => !b.hidden).map((b) => b.textContent));
  const fillForm = async (site: string, email: string, token: string) => {
    await field("サイトの URL").setValue(site);
    await field("メールアドレス").setValue(email);
    await field("API トークン").setValue(token);
  };

  it("shows the form of the connection in place of the bar and the list while nothing is saved, and reads no board (J-1, #1395)", async () => {
    await openJira(jiraFixtures({ jira_settings: empty }));
    await expect($("#orca-jira-conn")).toBeDisplayed();
    await expect($("#orca-jira-bar")).not.toBeDisplayed();
    await expect($("#orca-jira-list")).not.toBeDisplayed();
    await expect(gear()).not.toBeDisplayed();
    await expect(field("サイトの URL")).toHaveValue("");
    await expect(field("メールアドレス")).toHaveValue("");
    await expect(field("API トークン")).toHaveAttribute("type", "password");
    expect(await formButtons()).toEqual(["保存", "接続を試す"]);
    expect(await count("#orca-jira-conn-state:not([hidden])")).toBe(0);
    expect(await callsOf("jira_boards")).toEqual([]);
  });

  it("saves the connection of the project with 保存, empties the token, and reads the boards with it (J-1, #1395)", async () => {
    await openJira(jiraFixtures({ jira_settings: empty }));
    const save = await mock("jira_save", connected);
    await fillForm("https://example.atlassian.net", "me@example.com", "tok-1");
    await $("#orca-jira-save").click();
    expect(await waitForCalls(save)).toEqual([{ ...here, site: "https://example.atlassian.net", email: "me@example.com", token: "tok-1" }]);
    await waitForCount("#orca-jira-list .orca-jira-issue", 3);
    await expect($("#orca-jira-conn")).not.toBeDisplayed();
    await expect($("#orca-jira-bar")).toBeDisplayed();
    await expect(gear()).toBeDisplayed();
    await expect(field("API トークン")).toHaveValue("");
    expect(await callsOf("jira_boards")).toEqual([here]);
    expect(await callsOf("jira_settings")).toHaveLength(1);
    expect(await count(CARDS)).toBe(0);
  });

  it("closes the form when the save succeeds, and shows the reading while the boards are on their way (J-1, #1395)", async () => {
    await openJira(jiraFixtures({ jira_settings: empty }));
    await mock("jira_save", connected);
    const boards = await mock("jira_boards", holds);
    await fillForm("https://example.atlassian.net", "me@example.com", "tok-4");
    await $("#orca-jira-save").click();
    expect(await waitForCalls(boards)).toEqual([here]);
    await expect($("#orca-jira-conn")).not.toBeDisplayed();
    await expect($("#orca-jira-list .pending")).toBeDisplayed();
    expect(await count("#orca-jira-list .orca-jira-issue")).toBe(0);
    await release(boards, [board]);
    await waitForCount("#orca-jira-list .orca-jira-issue", 3);
    await expect($("#orca-jira-conn")).not.toBeDisplayed();
  });

  it("keeps the form as typed, with the reason in a card, when the save is refused (J-1, #1395)", async () => {
    await openJira(jiraFixtures({ jira_settings: empty }));
    const reason = "サイトの URL は Atlassian Cloud のものだけです";
    const save = await mock("jira_save", rejects(reason));
    await fillForm("https://example.com", "me@example.com", "tok-2");
    await $("#orca-jira-save").click();
    await waitForCalls(save);
    await waitForCount(CARDS, 1);
    expect(await textsOf(CARD)).toEqual([reason]);
    await expect($("#orca-jira-conn")).toBeDisplayed();
    await expect(field("サイトの URL")).toHaveValue("https://example.com");
    await expect(field("API トークン")).toHaveValue("");
    await expect($("#orca-jira-save")).toBeEnabled();
    expect(await callsOf("jira_boards")).toEqual([]);
  });

  it("tries the form's values with 接続を試す, keeps the buttons off while it waits, and says who it found, and saves nothing (J-1, #1395)", async () => {
    await openJira(jiraFixtures({ jira_settings: empty }));
    const test = await mock("jira_test", holds);
    await mock("jira_save", connected);
    await fillForm("https://example.atlassian.net", "", "tok-3");
    await $("#orca-jira-test").click();
    expect(await waitForCalls(test)).toEqual([{ ...here, site: "https://example.atlassian.net", email: "", token: "tok-3" }]);
    await expect($("#orca-jira-test")).toBeDisabled();
    await expect($("#orca-jira-save")).toBeDisabled();
    await release(test, user);
    await expect($("#orca-jira-conn-status")).toHaveText("接続できました");
    await expect($("#orca-jira-conn-status")).toHaveElementClass("ok");
    await expect($("#orca-jira-conn-user")).toHaveText("Example User ・ me@example.com");
    await expect($("#orca-jira-test")).toBeEnabled();
    await expect(field("API トークン")).toHaveValue("tok-3");
    expect(await callsOf("jira_save")).toEqual([]);
    expect(await callsOf("jira_boards")).toEqual([]);
  });

  it("says 接続できません with the reason in a card when the test fails (J-1, #1395)", async () => {
    await openJira(jiraFixtures({ jira_settings: empty }));
    const reason = "Jira が認証を拒否しました（401）";
    const test = await mock("jira_test", rejects(reason));
    await fillForm("https://example.atlassian.net", "me@example.com", "tok-4");
    await $("#orca-jira-test").click();
    await waitForCalls(test);
    await expect($("#orca-jira-conn-status")).toHaveText("接続できません");
    await expect($("#orca-jira-conn-status")).toHaveElementClass("warn");
    await waitForCount(CARDS, 1);
    expect(await textsOf(CARD)).toEqual([reason]);
    await expect($("#orca-jira-test")).toBeEnabled();
    await expect(field("API トークン")).toHaveValue("tok-4");
  });

  it("opens the same form with the gear, with what is saved and no token, and closes it with 閉じる and no read (J-1, #1395)", async () => {
    await openJira(jiraFixtures());
    await waitForCount("#orca-jira-list .orca-jira-issue", 3);
    await expect($("#orca-jira-conn")).not.toBeDisplayed();
    await expect(gear()).toHaveAttribute("aria-label", "接続の設定");
    await expect(gear().$("svg")).toExist();
    await gear().click();
    await expect($("#orca-jira-conn")).toBeDisplayed();
    await expect($("#orca-jira-bar")).not.toBeDisplayed();
    await expect($("#orca-jira-list")).not.toBeDisplayed();
    await expect(field("サイトの URL")).toHaveValue(connected.site);
    await expect(field("メールアドレス")).toHaveValue(connected.email);
    await expect(field("API トークン")).toHaveValue("");
    await expect($("#orca-jira-conn-status")).toHaveText("保存済み");
    await expect($("#orca-jira-conn-status")).toHaveElementClass("ok");
    expect(await formButtons()).toEqual(["保存", "接続を試す", "削除", "閉じる"]);
    await field("メールアドレス").setValue("typed@example.com");
    await $("#orca-jira-close").click();
    await expect($("#orca-jira-conn")).not.toBeDisplayed();
    await expect($("#orca-jira-list")).toBeDisplayed();
    expect(await count("#orca-jira-list .orca-jira-issue")).toBe(3);
    expect(await callsOf("jira_settings")).toHaveLength(1);
    expect(await callsOf("jira_boards")).toHaveLength(1);
    // What was typed is not kept: the gear shows what is saved.
    await gear().click();
    await expect(field("メールアドレス")).toHaveValue(connected.email);
  });

  it("changes the connection with 保存 from the gear (an empty token keeps the stored one) and reads everything with it (J-1, #1395)", async () => {
    await openJira(jiraFixtures());
    await waitForCount("#orca-jira-list .orca-jira-issue", 3);
    const save = await mock("jira_save", { ...connected, email: "other@example.com" });
    await gear().click();
    await field("メールアドレス").setValue("other@example.com");
    await $("#orca-jira-save").click();
    expect(await waitForCalls(save)).toEqual([{ ...here, site: connected.site, email: "other@example.com", token: "" }]);
    await waitForCalls("jira_boards", 2);
    await waitForCount("#orca-jira-list .orca-jira-issue", 3);
    await expect($("#orca-jira-conn")).not.toBeDisplayed();
    await expect($("#orca-jira-bar")).toBeDisplayed();
  });

  it("deletes the connection of the project with 削除 and shows the empty form (J-1, #1395)", async () => {
    await openJira(jiraFixtures());
    await waitForCount("#orca-jira-list .orca-jira-issue", 3);
    const del = await mock("jira_delete", null);
    await gear().click();
    await $("#orca-jira-delete").click();
    expect(await waitForCalls(del)).toEqual([here]);
    await expect($("#orca-jira-conn")).toBeDisplayed();
    await expect(field("サイトの URL")).toHaveValue("");
    await expect(field("メールアドレス")).toHaveValue("");
    expect(await formButtons()).toEqual(["保存", "接続を試す"]);
    await expect(gear()).not.toBeDisplayed();
    await expect($("#orca-jira-list")).not.toBeDisplayed();
    expect(await count("#orca-jira-list .orca-jira-issue")).toBe(0);
    expect(await callsOf("jira_boards")).toEqual([here]);
  });

  it("keeps the connection and the form with the reason in a card when the delete is refused (J-1, #1395)", async () => {
    await openJira(jiraFixtures());
    await waitForCount("#orca-jira-list .orca-jira-issue", 3);
    const reason = "キーチェーンを読めません";
    await mock("jira_delete", rejects(reason));
    await gear().click();
    await $("#orca-jira-delete").click();
    await waitForCalls("jira_delete");
    await waitForCount(CARDS, 1);
    expect(await textsOf(CARD)).toEqual([reason]);
    await expect($("#orca-jira-conn")).toBeDisplayed();
    expect(await formButtons()).toEqual(["保存", "接続を試す", "削除", "閉じる"]);
    await expect($("#orca-jira-delete")).toBeEnabled();
  });

  it("keeps a connection to each project: another project has its own empty form (J-1, #1395)", async () => {
    await openJira(jiraFixtures({ jira_settings: empty }));
    await field("サイトの URL").setValue("https://typed.atlassian.net");
    await project("example-api").click();
    await waitForCalls("jira_settings", 2);
    expect(await callsOf("jira_settings")).toEqual([here, api]);
    await expect($("#orca-jira-conn")).toBeDisplayed();
    await expect(field("サイトの URL")).toHaveValue("");
  });

  it("saves the board that is chosen for the project, and shows the saved board the next time (J-1, J-2, #1395)", async () => {
    const two = { jira_boards: [board, jiraBoard(2, "Second board")], jira_sprints: [sprint12] };
    await openJira(jiraFixtures(two));
    await waitForCount("#orca-jira-list .orca-jira-issue", 3);
    const set = await mock("jira_set_board", { ...connected, boardId: 2 });
    await mock("jira_sprints", [sprint13]);
    await pick("orca-jira-board", "2");
    expect(await waitForCalls(set)).toEqual([{ ...here, boardId: 2 }]);
    await expect(gear()).toBeDisplayed();
    // The next time, with the board that Rust holds.
    await mock("jira_settings", { ...connected, boardId: 2 });
    await mock("jira_sprints", [sprint13]);
    await $("#orca-jira-reload").click();
    expect(await waitForCalls("jira_sprints")).toEqual([{ ...here, boardId: 2 }]);
    await expect(select("orca-jira-board")).toHaveValue("2");
  });

  it("starts with the board that the project saved, and with the first one when the saved one is gone (J-1, J-2, #1395)", async () => {
    const two = { jira_boards: [board, jiraBoard(2, "Second board")], jira_sprints: [sprint12] };
    await openJira(jiraFixtures({ ...two, jira_settings: { ...connected, boardId: 2 } }));
    await waitForCount("#orca-jira-list .orca-jira-issue", 3);
    expect(await callsOf("jira_sprints")).toEqual([{ ...here, boardId: 2 }]);
    await expect(select("orca-jira-board")).toHaveValue("2");
    expect(await callsOf("jira_set_board")).toEqual([]);
    await mock("jira_settings", { ...connected, boardId: 99 });
    await project("example-api").click();
    await waitForCalls("jira_sprints", 2);
    expect(await callsOf("jira_sprints")).toEqual([{ ...here, boardId: 2 }, { ...api, boardId: 1 }]);
  });

  it("shows the scrum boards and the team-managed boards, and no kanban board (J-2, #1395)", async () => {
    await openJira(jiraFixtures({ jira_boards: [board, jiraBoard(3, "Team board", "simple"), jiraBoard(2, "Example kanban", "kanban")] }));
    await waitForCount("#orca-jira-list .orca-jira-issue", 3);
    expect(await optionsOf("orca-jira-board")).toEqual([["1", "Example board"], ["3", "Team board"]]);
  });

  it("draws Jira's refusal in the place of the sprints of a team-managed board that has none, and still reads its backlog (J-2, #1395)", async () => {
    await openJira(jiraFixtures({ jira_boards: [jiraBoard(3, "Team board", "simple")] }));
    await waitForCount("#orca-jira-list .orca-jira-issue", 3);
    const refusal = "Jira が 400 を返しました: The board does not support sprints";
    await mock("jira_sprints", rejects(refusal));
    await mock("jira_backlog", backlog);
    await mock("jira_sprint_issues", issuesOf[12]);
    await mock("jira_settings", { ...connected, boardId: 3 });
    await $("#orca-jira-reload").click();
    await waitForCount("#orca-jira-list .orca-jira-sprint-note", 1);
    expect(await textsOf("#orca-jira-list .orca-jira-sprint-note")).toEqual([refusal]);
    expect(await callsOf("jira_sprints")).toEqual([{ ...here, boardId: 3 }]);
    await waitForCount("#orca-jira-list .orca-jira-issue", 2);
    expect(await sectionsOf()).toEqual([["backlog", "EX-5", "EX-6"]]);
    expect(await callsOf("jira_backlog")).toEqual([{ ...here, boardId: 3 }]);
    expect(await callsOf("jira_sprint_issues")).toEqual([]);
    await expect(select("orca-jira-sprint")).not.toBeDisplayed();
    await expect(plus()).toBeDisplayed();
    expect(await count(CARDS)).toBe(0);
    // A failed read of the sprints of a scrum board is still the failure of the board, with the button that reads again.
    await mock("jira_boards", [board]);
    await mock("jira_settings", { ...connected, boardId: 1 });
    await $("#orca-jira-reload").click();
    await waitForCount("#orca-jira-list .pending.fail", 1);
    expect(await count(".orca-jira-sprint-note")).toBe(0);
  });

  it("reads the scrum boards, the sprints and the tickets of the first sprint only, and draws a row of two lines for each ticket (J-2, #1407)", async () => {
    await openJira(jiraFixtures());
    await waitForCount("#orca-jira-list .orca-jira-issue", 3);
    expect(await callsOf("jira_boards")).toEqual([here]);
    expect(await callsOf("jira_sprints")).toEqual([{ ...here, boardId: 1 }]);
    expect(await callsOf("jira_sprint_issues")).toEqual([{ ...here, sprintId: 12 }]);
    // The backlog is read only when it is chosen.
    expect(await callsOf("jira_backlog")).toEqual([]);
    expect(await sectionsOf()).toEqual([["s12", "EX-1", "EX-2", "EX-3"]]);
    expect(await textsOf(".orca-jira-head")).toEqual(["Sprint 12進行中3 件"]);
    // Only the scrum board is read, so there is nothing to choose between.
    await expect(select("orca-jira-board")).not.toBeDisplayed();
    await expect(select("orca-jira-sprint")).toBeDisplayed();
    expect(await rowOf("EX-1")).toMatchObject({ key: "EX-1", summary: "Write the page", status: "In Progress", assignee: "未割り当て", priority: null, category: "indeterminate", summaryLine: "none" });
    expect(await count("#orca-jira-list [placeholder]")).toBe(0);
  });

  it("draws a row in two lines: the summary, and under it the key, the status, the assignee (未割り当て when none) and the priority (none when the project has none) (J-2, #1407)", async () => {
    const tickets = jiraIssues([jiraIssue("EX-1", "A long summary ".repeat(20), "To Do", "new", { assignee: "Mia", priority: "High" }), jiraIssue("EX-2", "No one has it", "To Do")]);
    await openJira(jiraFixtures({ jira_issues_of: { 12: tickets } }));
    await waitForCount("#orca-jira-list .orca-jira-issue", 2);
    expect(await rowOf("EX-1")).toMatchObject({ assignee: "Mia", priority: "High" });
    expect(await rowOf("EX-2")).toMatchObject({ assignee: "未割り当て", priority: null });
    const layout = await browser.execute(() => {
      const row = (k: string) => document.querySelector<HTMLElement>(`.orca-jira-issue[data-key="${k}"]`)!;
      const box = (k: string, part: string) => row(k).querySelector<HTMLElement>(`.orca-jira-${part}`)!.getBoundingClientRect();
      return { longHeight: box("EX-1", "summary").height, shortHeight: box("EX-2", "summary").height, metaBelow: box("EX-1", "meta").top >= box("EX-1", "summary").bottom, order: [...row("EX-1").querySelectorAll(".orca-jira-meta > *")].map((n) => n.className) };
    });
    // The summary is cut at two lines (a short one is one line high), and the key, the status, the assignee and the priority are on the line under it.
    expect(layout.longHeight).toBeLessThanOrEqual(layout.shortHeight * 2 + 1);
    expect(layout.longHeight).toBeGreaterThan(layout.shortHeight);
    expect(layout.metaBelow).toBe(true);
    expect(layout.order).toEqual(["orca-jira-key", "orca-jira-status", "orca-jira-assignee", "orca-jira-priority"]);
  });

  it("mutes the summary of a ticket that is done without striking it through, and colors the status by its category (J-2, #1407)", async () => {
    await openJira(jiraFixtures());
    await waitForCount("#orca-jira-list .orca-jira-issue", 3);
    const done = await rowOf("EX-2");
    expect([done.category, done.summaryLine]).toEqual(["done", "none"]);
    expect(done.summaryColor).not.toBe((await rowOf("EX-3")).summaryColor);
    expect((await rowOf("EX-3")).summaryLine).toBe("none");
    expect(await browser.execute(() => getComputedStyle(document.querySelector('.orca-jira-issue[data-key="EX-2"] .orca-jira-key')!).textDecorationLine)).toBe("none");
    const fills = await browser.execute(() => ["EX-3", "EX-1", "EX-2"].map((k) => getComputedStyle(document.querySelector(`.orca-jira-issue[data-key="${k}"] .orca-jira-status`)!).backgroundColor));
    expect(new Set(fills).size).toBe(3);
  });

  it("offers every sprint and the backlog last, and reads the tickets of what the choice names, once; every sprint leaves the backlog out (J-2, #1407)", async () => {
    await openJira(jiraFixtures());
    await waitForCount("#orca-jira-list .orca-jira-issue", 3);
    expect(await optionsOf("orca-jira-sprint")).toEqual([["all", "すべてのスプリント"], ["12", "Sprint 12"], ["13", "Sprint 13"], ["backlog", "バックログ"]]);
    await pick("orca-jira-sprint", "all");
    await waitForCount("#orca-jira-list .orca-jira-section", 2);
    await waitForCount("#orca-jira-list .orca-jira-issue", 4);
    expect(await sectionsOf()).toEqual([["s12", "EX-1", "EX-2", "EX-3"], ["s13", "EX-4"]]);
    expect(await textsOf(".orca-jira-state")).toEqual(["進行中", "予定"]);
    expect(await callsOf("jira_backlog")).toEqual([]);
    await pick("orca-jira-sprint", "13");
    await waitForCount("#orca-jira-list .orca-jira-section", 1);
    expect(await sectionsOf()).toEqual([["s13", "EX-4"]]);
    await pick("orca-jira-sprint", "backlog");
    await waitForCount("#orca-jira-list .orca-jira-issue", 2);
    expect(await sectionsOf()).toEqual([["backlog", "EX-5", "EX-6"]]);
    expect(await textsOf(".orca-jira-head")).toEqual(["バックログ2 件"]);
    expect(await callsOf("jira_sprint_issues")).toEqual([{ ...here, sprintId: 12 }, { ...here, sprintId: 13 }]);
    expect(await callsOf("jira_backlog")).toEqual([{ ...here, boardId: 1 }]);
    // The backlog that was read is not read again by a new choice.
    await pick("orca-jira-sprint", "12");
    await pick("orca-jira-sprint", "backlog");
    await waitForCount("#orca-jira-list .orca-jira-issue", 2);
    expect(await callsOf("jira_backlog")).toHaveLength(1);
    expect(await callsOf("jira_sprint_issues")).toHaveLength(2);
  });

  it("narrows every section to the status that is chosen, and counts what is left (J-2)", async () => {
    await openJira(jiraFixtures());
    await waitForCount("#orca-jira-list .orca-jira-issue", 3);
    await pick("orca-jira-sprint", "all");
    await waitForCount("#orca-jira-list .orca-jira-issue", 4);
    expect(await optionsOf("orca-jira-status")).toEqual([["", "すべてのステータス"], ["In Progress", "In Progress"], ["Done", "Done"], ["To Do", "To Do"]]);
    await pick("orca-jira-status", "Done");
    await waitForCount("#orca-jira-list .orca-jira-issue", 1);
    expect(await sectionsOf()).toEqual([["s12", "EX-2"], ["s13"]]);
    expect(await textsOf(".orca-jira-count")).toEqual(["1 件", "0 件"]);
    await pick("orca-jira-status", "");
    await waitForCount("#orca-jira-list .orca-jira-issue", 4);
    expect(await callsOf("jira_sprint_issues")).toHaveLength(2);
  });

  it("reads the sprints and the backlog of another scrum board when it is chosen (J-2)", async () => {
    await openJira(jiraFixtures({ jira_boards: [board, jiraBoard(2, "Second board")], jira_sprints: [sprint12] }));
    await waitForCount("#orca-jira-list .orca-jira-issue", 3);
    await expect(select("orca-jira-board")).toBeDisplayed();
    expect(await optionsOf("orca-jira-board")).toEqual([["1", "Example board"], ["2", "Second board"]]);
    await mock("jira_sprints", [sprint13]);
    await mock("jira_backlog", jiraIssues([jiraIssue("OTH-1", "Other ticket", "To Do")]));
    await pick("orca-jira-board", "2");
    expect(await waitForCalls("jira_sprints")).toEqual([{ ...here, boardId: 2 }]);
    await waitForCount("#orca-jira-list .orca-jira-issue", 1);
    expect(await sectionsOf()).toEqual([["s13", "EX-4"]]);
    expect(await callsOf("jira_backlog")).toEqual([]);
    await pick("orca-jira-sprint", "backlog");
    await waitForCount("#orca-jira-list .orca-jira-issue", 1);
    expect(await sectionsOf()).toEqual([["backlog", "OTH-1"]]);
    expect(await callsOf("jira_backlog")).toEqual([{ ...here, boardId: 2 }]);
  });

  it("says that a board has no scrum board when the boards are all of another kind (J-2)", async () => {
    await openJira(jiraFixtures({ jira_boards: [jiraBoard(2, "Example kanban", "kanban")] }));
    await waitForCount("#orca-jira-list .orca-jira-none", 1);
    expect(await textsOf("#orca-jira-list .orca-jira-none")).toEqual(["スクラムボードがありません"]);
    expect(await callsOf("jira_sprints")).toEqual([]);
  });

  it("keeps a section that failed with its message and a button that reads it again (J-2)", async () => {
    await openJira(jiraFixtures({ jira_backlog: rejects("Jira が認証を拒否しました（401）") }));
    await waitForCount("#orca-jira-list .orca-jira-issue", 3);
    await pick("orca-jira-sprint", "backlog");
    await waitForCount("#orca-jira-list .pending.fail", 1);
    expect(await sectionsOf()).toEqual([["backlog"]]);
    expect(await textsOf("#orca-jira-list .pending.fail")).toEqual(["Jira が認証を拒否しました（401）再読み込み"]);
    expect((await logged()).some((l) => l.level === "error" && l.source === "orca-jira")).toBe(true);
    expect(await count("#error-cards .error-card")).toBe(0);
    await mock("jira_backlog", backlog);
    await $("#orca-jira-list .pending.fail .text-btn").click();
    expect(await waitForCalls("jira_backlog")).toEqual([{ ...here, boardId: 1 }]);
    await waitForCount("#orca-jira-list .orca-jira-issue", 2);
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
    await waitForCount("#orca-jira-list .orca-jira-issue", 3);
    expect(await count("#orca-jira-list .pending.fail")).toBe(0);
  });

  it("says how many tickets were read when Jira has more, and reads everything again with the reload button (J-2)", async () => {
    await openJira(jiraFixtures({ jira_backlog: jiraIssues([jiraIssue("EX-5", "Clean up the old code", "To Do")], true) }));
    await waitForCount("#orca-jira-list .orca-jira-issue", 3);
    await pick("orca-jira-sprint", "backlog");
    await waitForCount("#orca-jira-list .orca-jira-issue", 1);
    expect(await textsOf("#orca-jira-list .orca-file-note")).toEqual(["1 件で打ち切りました"]);
    await mock("jira_backlog", backlog);
    await $("#orca-jira-reload").click();
    await waitForCount("#orca-jira-list .orca-jira-issue", 2);
    expect(await count("#orca-jira-list .orca-file-note")).toBe(0);
    expect(await callsOf("jira_settings")).toHaveLength(2);
  });

  const api = { environment: null, project: "proj_example-api" };

  it("reads the connection of the project that the pane shows, and reads everything again for another project (J-2, #1394)", async () => {
    await openJira(withTickets());
    await waitForCount("#orca-jira-list .orca-jira-issue", 3);
    expect(await callsOf("jira_settings")).toEqual([here]);
    await project("example-api").click();
    await waitForCalls("jira_settings", 2);
    expect(await callsOf("jira_settings")).toEqual([here, api]);
    await waitForCalls("jira_boards", 2);
    expect(await callsOf("jira_boards")).toEqual([here, api]);
    await waitForCalls("jira_sprints", 2);
    expect(await callsOf("jira_sprints")).toEqual([{ ...here, boardId: 1 }, { ...api, boardId: 1 }]);
    await waitForCalls("jira_sprint_issues", 2);
    expect(await callsOf("jira_sprint_issues")).toEqual([{ ...here, sprintId: 12 }, { ...api, sprintId: 12 }]);
    expect(await callsOf("jira_backlog")).toEqual([]);
  });

  it("opens a ticket in a tab that reads and writes through the connection of the project it was opened in (J-2, #1394)", async () => {
    await openJira(withTickets());
    await waitForCount("#orca-jira-list .orca-jira-issue", 3);
    await openTicket("EX-1");
    expect(await waitForCalls("jira_issue")).toEqual([{ ...here, key: "EX-1" }]);
    await project("example-api").click();
    await waitForCalls("jira_settings", 2);
    await waitForCalls("jira_sprint_issues", 2);
    await waitForCount("#orca-jira-list .orca-jira-issue", 3);
    await openTicket("EX-1");
    await waitForCalls("jira_issue", 2);
    expect(await callsOf("jira_issue")).toEqual([{ ...here, key: "EX-1" }, { ...api, key: "EX-1" }]);
    await mock("jira_transitions", transitions);
    await editButton(FIELD.status).click();
    expect(await waitForCalls("jira_transitions")).toEqual([{ ...api, key: "EX-1" }]);
  });

  it("reads again each time the part is shown, and not at an interval (J-2)", async () => {
    await openJira(jiraFixtures());
    await waitForCount("#orca-jira-list .orca-jira-issue", 3);
    await paneMode("ファイル").click();
    await paneMode("Jira").click();
    await waitForCalls("jira_boards", 2);
    await waitForCount("#orca-jira-list .orca-jira-issue", 3);
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
  // The page's own press on a row of the list.
  const openTicket = (key: string) =>
    browser.execute(
      (k, once) => {
        if (!window.__e2e_once__(once)) return;
        document.querySelector(`.orca-jira-issue[data-key="${k}"]`)!.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));
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

  it("opens the ticket in a tab of the work pane by one press on its row, and not by a double press twice over, and reads it (J-2, #1407)", async () => {
    await openJira(withTickets());
    await waitForCount("#orca-jira-list .orca-jira-issue", 3);
    expect(await callsOf("jira_issue")).toEqual([]);
    expect(await count(".orca-jira-tab")).toBe(0);
    await $('.orca-jira-issue[data-key="EX-1"]').click();
    await expect(tabOf("jira:1")).toBeDisplayed();
    await expect(tabOf("jira:1").$(".orca-tab-btn")).toHaveAttribute("aria-selected", "true");
    await expect(tabOf("jira:1").$(".orca-tab-title")).toHaveText("EX-1");
    await expect(tabOf("jira:1").$(".orca-file-tab-ic svg")).toExist();
    expect(await waitForCalls("jira_issue")).toEqual([{ ...here, key: "EX-1" }]);
    await expect($(".orca-jira-tab .orca-jira-title")).toHaveText("Write the page");
    // The tickets of the list stay where they were: the part is still shown.
    await expect($("#orca-jira")).toBeDisplayed();
  });

  it("draws the key with its parent, the summary, the description as Markdown and the comments, and the fields in the right column (J-2)", async () => {
    await openJira(withTickets());
    await waitForCount("#orca-jira-list .orca-jira-issue", 3);
    await openTicket("EX-1");
    await expect($(".orca-jira-tab .orca-jira-title")).toBeDisplayed();
    expect(await textsOf(".orca-jira-tab-head .orca-edit-path")).toEqual(["EX-1"]);
    expect(await textsOf(".orca-jira-crumb")).toEqual(["EX-100/EX-1"]);
    const html = await browser.execute(() => document.querySelector(".orca-jira-main .orca-jira-desc > .md")!.innerHTML);
    expect(html).toContain("<strong>the ticket</strong>");
    expect(html).toContain("<li>one</li>");
    expect(html).toContain('href="https://example.com/spec"');
    // What the sanitizer of the Todo comments drops: an address that is not http(s), and a form.
    expect(html).not.toContain("javascript:");
    expect(await count(".orca-jira-main .orca-jira-desc > .md form, .orca-jira-main .orca-jira-desc > .md input")).toBe(0);
    expect(await textsOf(".orca-jira-comments-head")).toEqual(["コメント 2 件"]);
    expect(await textsOf(".orca-jira-comment")).toEqual(["Ann2026-11-20 09:30Looks good", "Bob2026-11-21 18:05"]);
    expect(await textsOf(".orca-jira-side-row")).toEqual(["ステータスIn Progress", "担当Mia", "スプリントSprint 12", "優先度High", "ラベルuiready", "親EX-100The epic"]);
    await expect($(".orca-jira-pill")).toHaveAttribute("data-category", "indeterminate");
    expect(await count(".orca-jira-tab [placeholder]")).toBe(0);
  });

  it("says that a field has nothing when the ticket has none, and has no parent in its key line (J-2)", async () => {
    await openJira(withTickets());
    await waitForCount("#orca-jira-list .orca-jira-issue", 3);
    await openTicket("EX-2");
    await expect($(".orca-jira-tab .orca-jira-title")).toHaveText("Fix the list");
    expect(await textsOf(".orca-jira-crumb")).toEqual(["EX-2"]);
    expect(await textsOf(".orca-jira-side-row")).toEqual(["ステータスDone", "担当未割り当て", "スプリントなし", "優先度なし", "ラベルなし", "親なし"]);
    expect(await textsOf(".orca-jira-comments-head")).toEqual(["コメント 0 件"]);
    expect(await count(".orca-jira-main .orca-jira-desc > .md")).toBe(0);
    await expect($(".orca-jira-pill")).toHaveAttribute("data-category", "done");
  });

  it("selects the tab of a ticket that is open and reads it again, and gives another ticket a tab of its own (J-2)", async () => {
    await openJira(withTickets());
    await waitForCount("#orca-jira-list .orca-jira-issue", 3);
    await openTicket("EX-1");
    await expect(tabOf("jira:1")).toBeDisplayed();
    await openTicket("EX-2");
    await expect(tabOf("jira:2").$(".orca-tab-btn")).toHaveAttribute("aria-selected", "true");
    await expect($(".orca-jira-tab .orca-jira-title")).toHaveText("Fix the list");
    await tabOf("jira:1").$(".orca-tab-btn").click();
    await expect($(".orca-jira-tab .orca-jira-title")).toHaveText("Write the page");
    await openTicket("EX-1");
    await waitForCalls("jira_issue", 3);
    expect(await callsOf("jira_issue")).toEqual([{ ...here, key: "EX-1" }, { ...here, key: "EX-2" }, { ...here, key: "EX-1" }]);
    expect(await count('.orca-tab[data-jira="true"]')).toBe(2);
    await expect(tabOf("jira:1").$(".orca-tab-btn")).toHaveAttribute("aria-selected", "true");
  });

  it("shows the reason in place of the ticket when it cannot be read, writes it to the log with no card, and reads again with the button (J-2)", async () => {
    await openJira(withTickets());
    await waitForCount("#orca-jira-list .orca-jira-issue", 3);
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
    expect(await callsOf("jira_issue")).toEqual([{ ...here, key: "EX-1" }]);
  });

  it("says how many comments were read when Jira has more (J-2)", async () => {
    await openJira(jiraFixtures({ jira_details: { "EX-1": { ...detailOf["EX-1"], commentsTruncated: true } } }));
    await waitForCount("#orca-jira-list .orca-jira-issue", 3);
    await openTicket("EX-1");
    await waitForCount(".orca-jira-comments .orca-file-note", 1);
    expect(await textsOf(".orca-jira-comments .orca-file-note")).toEqual(["2 件で打ち切りました"]);
  });

  it("closes the tab with its close button, and has the split rows only in its menu, with no window of its own (J-2, A-17)", async () => {
    await openJira(withTickets());
    await waitForCount("#orca-jira-list .orca-jira-issue", 3);
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
    await waitForCount("#orca-jira-list .orca-jira-issue", 3);
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
    expect(await waitForCalls("jira_transitions")).toEqual([{ ...here, key: "EX-1" }]);
    await waitForCount('.menu[role="menu"]', 1);
    expect(await menuTexts()).toEqual(["To Do", "Done"]);
    await (await menuItem(1)).click();
    expect(await waitForCalls("jira_transition")).toEqual([{ ...here, key: "EX-1", transitionId: "21" }]);
    await expect($(".orca-jira-side-row:nth-child(1) .orca-jira-pill")).toHaveText("Done");
    await expect($(".orca-jira-side-row:nth-child(1) .orca-jira-pill")).toHaveAttribute("data-category", "done");
    expect(await rowOf("EX-1")).toMatchObject({ status: "Done", category: "done", summaryLine: "none" });
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
    expect(await waitForCalls("jira_assignable")).toEqual([{ ...here, key: "EX-1" }]);
    await waitForCount('.menu[role="menu"]', 1);
    expect(await menuTexts()).toEqual(["未割り当て", "Ann", "Mia"]);
    await expect($('.menu .menu-search[aria-label="担当を探す"]')).toBeDisplayed();
    // Mia has it already: nothing is sent.
    await (await menuItem(2)).click();
    expect(await callsOf("jira_assign")).toEqual([]);
    await editButton(FIELD.assignee).click();
    await waitForCount('.menu[role="menu"]', 1);
    await (await menuItem(1)).click();
    expect(await waitForCalls("jira_assign")).toEqual([{ ...here, key: "EX-1", accountId: "a1" }]);
    await expect(editButton(FIELD.assignee)).toHaveText("Ann");
    await editButton(FIELD.assignee).click();
    await waitForCount('.menu[role="menu"]', 1);
    await (await menuItem(0)).click();
    await waitForCalls("jira_assign", 2);
    expect(await callsOf("jira_assign")).toEqual([
      { ...here, key: "EX-1", accountId: "a1" },
      { ...here, key: "EX-1", accountId: null },
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
    expect(await waitForCalls("jira_priorities")).toEqual([{ ...here, key: "EX-1" }]);
    await waitForCount('.menu[role="menu"]', 1);
    expect(await menuTexts()).toEqual(["Highest", "High"]);
    await (await menuItem(0)).click();
    expect(await waitForCalls("jira_set_priority")).toEqual([{ ...here, key: "EX-1", priorityId: "1" }]);
    await expect(editButton(FIELD.priority)).toHaveText("Highest");
    await mock("jira_priorities", []);
    await editButton(FIELD.priority).click();
    await waitForCount('.menu[role="menu"]', 1);
    expect(await menuTexts()).toEqual(["選べるものがありません"]);
    await expect(await menuItem(0)).toBeDisabled();
  });

  it("moves the ticket to a sprint of its board or to the backlog, and reads the sections of the list that were read again (J-2)", async () => {
    await openEditable();
    await mock("jira_sprints", [sprint12, sprint13]);
    await mock("jira_set_sprint", null);
    const before = { sprint: (await callsOf("jira_sprint_issues")).length };
    await editButton(FIELD.sprint).click();
    expect(await waitForCalls("jira_sprints")).toEqual([{ ...here, boardId: 1 }]);
    await waitForCount('.menu[role="menu"]', 1);
    expect(await menuTexts()).toEqual(["バックログ", "Sprint 12", "Sprint 13"]);
    await (await menuItem(2)).click();
    expect(await waitForCalls("jira_set_sprint")).toEqual([{ ...here, key: "EX-1", sprintId: 13 }]);
    await expect(editButton(FIELD.sprint)).toHaveText("Sprint 13");
    await waitForCalls("jira_sprint_issues", before.sprint + 1);
    // The backlog was not read, so it is not read again: it is read when it is chosen.
    expect(await callsOf("jira_backlog")).toEqual([]);
    await editButton(FIELD.sprint).click();
    await waitForCount('.menu[role="menu"]', 1);
    await (await menuItem(0)).click();
    await waitForCalls("jira_set_sprint", 2);
    expect(await callsOf("jira_set_sprint")).toEqual([
      { ...here, key: "EX-1", sprintId: 13 },
      { ...here, key: "EX-1", sprintId: null },
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
    expect(await callsOf("jira_issue")).toEqual([{ ...here, key: "EX-1" }]);
  });

  // J-2 (#873): the description and the comments are edited in the rich Markdown editor of A-26.
  const descField = () => $("#orca-jira-desc-input .ProseMirror");
  const commentField = () => $("#orca-jira-comment-input .ProseMirror");
  const descText = () => browser.execute(() => document.querySelector<HTMLElement>(".orca-jira-main .orca-jira-desc > .md")?.innerText.trim() ?? null);
  // Replaces the text of a field of the editor (once Milkdown has made it editable) with `text`.
  const typeInto = async (field: () => ChainablePromiseElement, text: string) => {
    await browser.waitUntil(async () => (await field().getAttribute("contenteditable")) === "true");
    await field().click();
    await browser.keys(["Meta", "a"]);
    await browser.keys(text.split(""));
  };
  // Cmd+Enter (Ctrl+Enter off macOS) in a field, as the key event the page listens for.
  const pressSubmit = (selector: string) =>
    browser.execute(
      (s, once) => {
        if (!window.__e2e_once__(once)) return;
        const isMac = /Mac/.test(navigator.platform);
        document.querySelector(s)!.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", metaKey: isMac, ctrlKey: !isMac, bubbles: true, cancelable: true }));
      },
      selector,
      onceId(),
    );
  const original = detailOf["EX-1"].description;

  it("opens the editor on the description with its Markdown, and the cancel button gives the text back and sends nothing (J-2, #873)", async () => {
    await openEditable();
    expect(await count(".orca-jira-desc-edit")).toBe(1);
    expect(await count("#orca-jira-desc-input")).toBe(0);
    await $(".orca-jira-desc-edit").click();
    await waitForCount("#orca-jira-desc-input .ProseMirror", 1);
    await browser.waitUntil(async () => (await descField().getText()).includes("Show the ticket."));
    expect(await count(".orca-jira-main .orca-jira-desc > .md")).toBe(0);
    expect(await count(".orca-jira-desc-edit")).toBe(0);
    await expect($(".orca-jira-save")).toHaveText("保存");
    await expect($(".orca-jira-cancel")).toHaveText("キャンセル");
    await expect($('.orca-jira-tab-head .icon-btn[aria-label="読み直す"]')).toBeDisabled();
    expect(await count(".orca-jira-tab [placeholder]")).toBe(0);
    await $(".orca-jira-cancel").click();
    expect(await count("#orca-jira-desc-input")).toBe(0);
    expect(await descText()).toContain("Show the ticket.");
    await expect($('.orca-jira-tab-head .icon-btn[aria-label="読み直す"]')).toBeEnabled();
    expect(await callsOf("jira_set_description")).toEqual([]);
  });

  it("sends the key, the Markdown it started from and the Markdown of the editor, and draws what Jira answers with (J-2, #873)", async () => {
    await openEditable();
    await mock("jira_set_description", "The new **description**");
    await $(".orca-jira-desc-edit").click();
    await typeInto(descField, "The new description");
    await $(".orca-jira-save").click();
    expect(await waitForCalls("jira_set_description")).toEqual([{ ...here, key: "EX-1", base: original, markdown: "The new description\n" }]);
    await waitForCount("#orca-jira-desc-input", 0);
    expect(await descText()).toBe("The new description");
    expect(await $(".orca-jira-main .orca-jira-desc > .md strong").getText()).toBe("description");
    // The ticket is not read again, and the description is what Rust gave back for the next edit.
    expect(await callsOf("jira_issue")).toEqual([{ ...here, key: "EX-1" }]);
    await $(".orca-jira-desc-edit").click();
    await browser.waitUntil(async () => (await descField().getText()).includes("The new description"));
    await $(".orca-jira-cancel").click();
    await mock("jira_set_description", "Again");
    await $(".orca-jira-desc-edit").click();
    await typeInto(descField, "Again");
    await pressSubmit("#orca-jira-desc-input .ProseMirror");
    // `mock` cleared the record of the first save.
    expect(await waitForCalls("jira_set_description")).toEqual([{ ...here, key: "EX-1", base: "The new **description**", markdown: "Again\n" }]);
  });

  it("drops the answer of a read that was on its way when a description or a comment was saved, so that it does not put the old ticket back (J-2, #873)", async () => {
    await openEditable();
    const reload = $('.orca-jira-tab-head .icon-btn[aria-label="読み直す"]');
    await mock("jira_issue", holds);
    await reload.click();
    await waitForCalls("jira_issue");
    await expect(reload).toBeDisabled();
    // The pencil and the button of a new comment work while the read is on its way.
    await mock("jira_set_description", "The new **description**");
    await $(".orca-jira-desc-edit").click();
    await typeInto(descField, "The new description");
    await $(".orca-jira-save").click();
    await waitForCalls("jira_set_description");
    await waitForCount("#orca-jira-desc-input", 0);
    expect(await descText()).toBe("The new description");
    await expect(reload).toBeEnabled();
    const added = { author: "Me", created: "2026-11-25 10:00", body: "A new comment" };
    await mock("jira_add_comment", added);
    await $(".orca-jira-comment-add").click();
    await typeInto(commentField, "A new comment");
    await $(".orca-jira-comment-submit").click();
    await waitForCalls("jira_add_comment");
    await waitForCount("#orca-jira-comment-input", 0);
    expect(await textsOf(".orca-jira-comments-head")).toEqual(["コメント 3 件"]);
    // The read answers late with the ticket as it was: the tab keeps the description and the comment that Jira has taken.
    await release("jira_issue", detailOf["EX-1"]);
    await expect($(".orca-jira-tab .orca-jira-title")).toBeDisplayed();
    expect(await descText()).toBe("The new description");
    expect(await textsOf(".orca-jira-comments-head")).toEqual(["コメント 3 件"]);
    await expect(reload).toBeEnabled();
  });

  it("keeps the editor off while Jira answers, and keeps the typing with the reason in a card when Jira refuses (J-2, #873)", async () => {
    await openEditable();
    await mock("jira_set_description", holds);
    await $(".orca-jira-desc-edit").click();
    await typeInto(descField, "Typed text");
    await $(".orca-jira-save").click();
    await waitForCalls("jira_set_description");
    await expect($(".orca-jira-save")).toBeDisabled();
    await expect($(".orca-jira-cancel")).toBeDisabled();
    await expect(editButton(FIELD.status)).toBeDisabled();
    await expect(descField()).toHaveAttribute("contenteditable", "false");
    await release("jira_set_description", rejects("説明が Jira で変更されています。読み直してください"));
    await waitForCount(CARDS, 1);
    expect(await textsOf(CARD)).toEqual(["説明が Jira で変更されています。読み直してください"]);
    expect((await logged()).some((l) => l.level === "error" && l.source === "orca-jira")).toBe(true);
    // Still editing, with the typing in the editor and the buttons working again.
    await expect($(".orca-jira-save")).toBeEnabled();
    await expect(descField()).toHaveAttribute("contenteditable", "true");
    expect(await descField().getText()).toBe("Typed text");
    await expect(editButton(FIELD.status)).toBeEnabled();
    // The ticket shows the description it had.
    await $(".orca-jira-cancel").click();
    expect(await descText()).toContain("Show the ticket.");
  });

  it("opens the field of a new comment, keeps its button off while it is empty, and adds the comment under the others (J-2, #873)", async () => {
    await openEditable();
    expect(await count("#orca-jira-comment-input")).toBe(0);
    const added = { author: "Me", created: "2026-11-25 10:00", body: "A **new** comment" };
    await mock("jira_add_comment", added);
    await $(".orca-jira-comment-add").click();
    await waitForCount("#orca-jira-comment-input .ProseMirror", 1);
    await expect($(".orca-jira-comment-submit")).toBeDisabled();
    await typeInto(commentField, "A new comment");
    await expect($(".orca-jira-comment-submit")).toBeEnabled();
    await $(".orca-jira-comment-submit").click();
    expect(await waitForCalls("jira_add_comment")).toEqual([{ ...here, key: "EX-1", markdown: "A new comment\n" }]);
    await waitForCount("#orca-jira-comment-input", 0);
    expect(await textsOf(".orca-jira-comments-head")).toEqual(["コメント 3 件"]);
    expect((await textsOf(".orca-jira-comment"))[2]).toBe("Me2026-11-25 10:00A new comment");
    expect(await count(".orca-jira-comment-add")).toBe(1);
    expect(await callsOf("jira_issue")).toEqual([{ ...here, key: "EX-1" }]);
  });

  it("keeps the comment in its field with the reason in a card when Jira refuses, and drops it with the cancel button (J-2, #873)", async () => {
    await openEditable();
    await mock("jira_add_comment", holds);
    await $(".orca-jira-comment-add").click();
    await typeInto(commentField, "Kept text");
    await pressSubmit("#orca-jira-comment-input .ProseMirror");
    await waitForCalls("jira_add_comment");
    await expect($(".orca-jira-comment-submit")).toBeDisabled();
    await expect($(".orca-jira-comment-cancel")).toBeDisabled();
    await release("jira_add_comment", rejects("Jira が 403 を返しました: no permission"));
    await waitForCount(CARDS, 1);
    expect(await textsOf(CARD)).toEqual(["Jira が 403 を返しました: no permission"]);
    expect(await commentField().getText()).toBe("Kept text");
    expect(await textsOf(".orca-jira-comments-head")).toEqual(["コメント 2 件"]);
    await $(".orca-jira-comment-cancel").click();
    expect(await count("#orca-jira-comment-input")).toBe(0);
    await $(".orca-jira-comment-add").click();
    await browser.waitUntil(async () => (await commentField().getAttribute("contenteditable")) === "true");
    expect(await commentField().getText()).toBe("");
  });

  // J-2 (#874): the tab of a new ticket, opened by the plus of the list.
  const created = jiraDetail("EX-9", { summary: "Brand new", sprint: "Sprint 13" });
  const projectsOf = [jiraProject("10000", "EX", "Example"), jiraProject("10001", "AB", "Alpha")];
  const typesOf = { 10000: [jiraIssueType("10001", "Task"), jiraIssueType("10002", "Bug")], 10001: [jiraIssueType("10003", "Story")] };
  const withNew = (extra: Record<string, unknown> = {}) => jiraFixtures({ jira_details: { ...detailOf, "EX-9": created }, jira_projects: projectsOf, jira_types_of: typesOf, jira_create_issue: { key: "EX-9", sprintError: null }, ...extra });
  const plus = () => $("#orca-jira-new");
  const newField = (name: string) => $(`.orca-jira-new [aria-label="${name}"]`);
  const newDescField = () => $("#orca-jira-new-desc-input .ProseMirror");
  const newOptions = (name: string) => browser.execute((n) => [...document.querySelectorAll<HTMLOptionElement>(`.orca-jira-new [aria-label="${n}"] option`)].map((o) => [o.value, o.textContent]), name);
  // Chooses an option of a select of the form as the page does.
  const pickNew = (name: string, value: string) =>
    browser.execute(
      (n, v) => {
        const field = document.querySelector<HTMLSelectElement>(`.orca-jira-new [aria-label="${n}"]`)!;
        field.value = v;
        field.dispatchEvent(new Event("change"));
      },
      name,
      value,
    );
  const submitNew = () => $(".orca-jira-new-submit");
  // The list read, and the tab of a new ticket opened with its first options read.
  async function openNew(fixtures: Record<string, unknown> = withNew()) {
    await openJira(fixtures);
    await waitForCount("#orca-jira-list .orca-jira-issue", 3);
    await plus().click();
    await expect($(".orca-jira-new")).toBeDisplayed();
    await waitForCalls("jira_issue_types");
  }

  it("shows the plus only while a board is shown, and opens the tab of a new ticket that asks for the projects, the sprints of the board and the types of the first project (J-2, #874)", async () => {
    await openJira();
    await expect($("#orca-jira-conn")).toBeDisplayed();
    await expect(plus()).not.toBeDisplayed();
    await openNew();
    await expect(plus()).toBeDisplayed();
    await expect(tabOf("jira:1")).toBeDisplayed();
    await expect(tabOf("jira:1").$(".orca-tab-btn")).toHaveAttribute("aria-selected", "true");
    await expect(tabOf("jira:1").$(".orca-tab-title")).toHaveText("新しいチケット");
    await expect($(".orca-jira-tab-head .orca-edit-path")).toHaveText("新しいチケット");
    expect(await callsOf("jira_projects")).toEqual([here]);
    expect(await callsOf("jira_sprints")).toEqual([{ ...here, boardId: 1 }, { ...here, boardId: 1 }]);
    expect(await callsOf("jira_issue_types")).toEqual([{ ...here, projectId: "10000" }]);
    expect(await callsOf("jira_issue")).toEqual([]);
    expect(await newOptions("プロジェクト")).toEqual([["10000", "Example (EX)"], ["10001", "Alpha (AB)"]]);
    expect(await newOptions("種類")).toEqual([["10001", "Task"], ["10002", "Bug"]]);
    // The sprint of the list is the one chosen, and the backlog is the first choice.
    expect(await newOptions("スプリント")).toEqual([["", "バックログ"], ["12", "Sprint 12"], ["13", "Sprint 13"]]);
    expect(await newField("スプリント").getValue()).toBe("12");
    await expect(newField("件名")).toHaveValue("");
    await expect($("#orca-jira-new-desc-input")).toExist();
    expect(await count(".orca-jira-tab [placeholder]")).toBe(0);
    await expect(submitNew()).toBeDisabled();
  });

  it("reads the types of another project when it is chosen, and keeps one tab for the form when the plus is pressed again (J-2, #874)", async () => {
    await openNew();
    await newField("件名").setValue("Typed first");
    await pickNew("プロジェクト", "10001");
    await waitForCalls("jira_issue_types", 2);
    expect(await callsOf("jira_issue_types")).toEqual([{ ...here, projectId: "10000" }, { ...here, projectId: "10001" }]);
    await browser.waitUntil(async () => JSON.stringify(await newOptions("種類")) === JSON.stringify([["10003", "Story"]]));
    await plus().click();
    await waitForCalls("jira_projects", 2);
    await expect(tabOf("jira:2")).not.toExist();
    expect(await count(".orca-jira-new")).toBe(1);
    // What was typed and chosen stays through the read of the options.
    await expect(newField("件名")).toHaveValue("Typed first");
    expect(await newField("プロジェクト").getValue()).toBe("10001");
  });

  it("keeps the button off until there is a summary, sends what the form holds, and turns the tab into the ticket's tab with the list read again (J-2, #874)", async () => {
    await openNew();
    const before = { sprint: (await callsOf("jira_sprint_issues")).length };
    await newField("件名").setValue("  Brand new ");
    await expect(submitNew()).toBeEnabled();
    await newField("件名").setValue("   ");
    await expect(submitNew()).toBeDisabled();
    await newField("件名").setValue("Brand new");
    await typeInto(newDescField, "Some **text**");
    await pickNew("プロジェクト", "10000");
    await pickNew("種類", "10002");
    await pickNew("スプリント", "13");
    await submitNew().click();
    expect(await waitForCalls("jira_create_issue")).toEqual([{ ...here, projectId: "10000", issueTypeId: "10002", summary: "Brand new", markdown: "Some **text**\n", sprintId: 13 }]);
    await expect(tabOf("jira:1").$(".orca-tab-title")).toHaveText("EX-9");
    await expect(tabOf("jira:1").$(".orca-tab-btn")).toHaveAttribute("aria-selected", "true");
    expect(await waitForCalls("jira_issue")).toEqual([{ ...here, key: "EX-9" }]);
    await expect($(".orca-jira-tab .orca-jira-title")).toHaveText("Brand new");
    expect(await count(".orca-jira-new")).toBe(0);
    await expect(tabOf("jira:2")).not.toExist();
    await waitForCalls("jira_sprint_issues", before.sprint + 1);
    expect(await count(CARDS)).toBe(0);
  });

  it("makes a ticket with the backlog as its sprint and sends it by Enter in the summary (J-2, #874)", async () => {
    await openNew();
    await pickNew("スプリント", "");
    await newField("件名").setValue("Brand new");
    await expect(submitNew()).toBeEnabled();
    await browser.keys("Enter");
    expect(await waitForCalls("jira_create_issue")).toEqual([{ ...here, projectId: "10000", issueTypeId: "10001", summary: "Brand new", markdown: expect.any(String), sprintId: null }]);
    await expect(tabOf("jira:1").$(".orca-tab-title")).toHaveText("EX-9");
  });

  it("shows Jira's refusal of the sprints under the select of the sprints, keeps the form, makes the ticket with no sprint, and draws the sprints again when they can be read (J-2, #874, #1395)", async () => {
    await openJira(withNew());
    await waitForCount("#orca-jira-list .orca-jira-issue", 3);
    const refusal = "Jira が 400 を返しました: The board does not support sprints";
    await mock("jira_sprints", rejects(refusal));
    await plus().click();
    await expect($(".orca-jira-new")).toBeDisplayed();
    await waitForCalls("jira_issue_types");
    expect(await textsOf(".orca-jira-new-sprint-note")).toEqual([refusal]);
    expect(await newOptions("スプリント")).toEqual([["", "バックログ"]]);
    await expect(newField("スプリント")).toBeDisabled();
    expect(await newOptions("プロジェクト")).toEqual([["10000", "Example (EX)"], ["10001", "Alpha (AB)"]]);
    expect(await newOptions("種類")).toEqual([["10001", "Task"], ["10002", "Bug"]]);
    expect(await count(CARDS)).toBe(0);
    await newField("件名").setValue("Brand new");
    await expect(submitNew()).toBeEnabled();
    await submitNew().click();
    expect(await waitForCalls("jira_create_issue")).toEqual([{ ...here, projectId: "10000", issueTypeId: "10001", summary: "Brand new", markdown: expect.any(String), sprintId: null }]);
    // A tab that is still a new one reads the sprints again with 「読み直す」, and the note goes.
    await plus().click();
    await mock("jira_sprints", [sprint12, sprint13]);
    await $('.orca-jira-tab-head .icon-btn[aria-label="読み直す"]').click();
    await waitForCalls("jira_sprints");
    await waitForCount(".orca-jira-new-sprint-note:not([hidden])", 0);
    expect(await newOptions("スプリント")).toEqual([["", "バックログ"], ["12", "Sprint 12"], ["13", "Sprint 13"]]);
    await expect(newField("スプリント")).toBeEnabled();
  });

  it("keeps the fields off while Jira answers, and keeps the typing with the reason in a card when Jira refuses (J-2, #874)", async () => {
    await openNew();
    await mock("jira_create_issue", holds);
    await newField("件名").setValue("Kept summary");
    await typeInto(newDescField, "Kept text");
    await pressSubmit("#orca-jira-new-desc-input .ProseMirror");
    await waitForCalls("jira_create_issue");
    await expect(submitNew()).toBeDisabled();
    await expect(newField("件名")).toBeDisabled();
    await expect(newField("プロジェクト")).toBeDisabled();
    await expect(newField("種類")).toBeDisabled();
    await expect(newField("スプリント")).toBeDisabled();
    await expect(newDescField()).toHaveAttribute("contenteditable", "false");
    await release("jira_create_issue", rejects("Jira が 400 を返しました: Epic Name is required"));
    await waitForCount(CARDS, 1);
    expect(await textsOf(CARD)).toEqual(["Jira が 400 を返しました: Epic Name is required"]);
    expect((await logged()).some((l) => l.level === "error" && l.source === "orca-jira")).toBe(true);
    await expect(tabOf("jira:1").$(".orca-tab-title")).toHaveText("新しいチケット");
    await expect(newField("件名")).toHaveValue("Kept summary");
    await expect(newField("件名")).toBeEnabled();
    await expect(submitNew()).toBeEnabled();
    expect(await newDescField().getText()).toBe("Kept text");
    expect(await callsOf("jira_issue")).toEqual([]);
  });

  it("opens the ticket's tab and shows a card when the ticket was made but could not be put in the sprint (J-2, #874)", async () => {
    await openNew();
    await mock("jira_create_issue", { key: "EX-9", sprintError: "チケット EX-9 は作りましたが、スプリントに入れられませんでした: Jira が 400 を返しました: closed" });
    await newField("件名").setValue("Brand new");
    await expect(submitNew()).toBeEnabled();
    await submitNew().click();
    await waitForCount(CARDS, 1);
    expect(await textsOf(CARD)).toEqual(["チケット EX-9 は作りましたが、スプリントに入れられませんでした: Jira が 400 を返しました: closed"]);
    await expect(tabOf("jira:1").$(".orca-tab-title")).toHaveText("EX-9");
    expect(await waitForCalls("jira_issue")).toEqual([{ ...here, key: "EX-9" }]);
    expect(await count(".orca-jira-new")).toBe(0);
  });

  it("shows the reason in place of the form when the options cannot be read, with no card, and reads them again with the button (J-2, #874)", async () => {
    await openJira(withNew());
    await waitForCount("#orca-jira-list .orca-jira-issue", 3);
    await mock("jira_projects", rejects("Jira が 403 を返しました: no scope"));
    await plus().click();
    await waitForCount(".orca-jira-tab-body .orca-file-note.fail", 1);
    expect(await textsOf(".orca-jira-tab-body .orca-file-note.fail")).toEqual(["Jira が 403 を返しました: no scope"]);
    expect(await count(CARDS)).toBe(0);
    expect((await logged()).some((l) => l.level === "error" && l.source === "orca-jira")).toBe(true);
    expect(await count(".orca-jira-new")).toBe(0);
    await mock("jira_projects", projectsOf);
    await $('.orca-jira-tab-head .icon-btn[aria-label="読み直す"]').click();
    await expect($(".orca-jira-new")).toBeDisplayed();
    expect(await newOptions("プロジェクト")).toEqual([["10000", "Example (EX)"], ["10001", "Alpha (AB)"]]);
  });

  it("says so when there is no project to create a ticket in, and when the types cannot be read (J-2, #874)", async () => {
    await openJira(withNew());
    await waitForCount("#orca-jira-list .orca-jira-issue", 3);
    await mock("jira_projects", []);
    await plus().click();
    await waitForCount(".orca-jira-tab-body .orca-file-note", 1);
    expect(await textsOf(".orca-jira-tab-body .orca-file-note")).toEqual(["作れるプロジェクトがありません"]);
    await mock("jira_projects", projectsOf);
    await mock("jira_issue_types", rejects("Jira が 404 を返しました: no project"));
    await $('.orca-jira-tab-head .icon-btn[aria-label="読み直す"]').click();
    await waitForCount(".orca-jira-tab-body .orca-file-note.fail", 1);
    expect(await textsOf(".orca-jira-tab-body .orca-file-note.fail")).toEqual(["Jira が 404 を返しました: no project"]);
    expect(await count(CARDS)).toBe(0);
  });
});
