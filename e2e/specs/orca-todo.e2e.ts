import { account, callsOf, comment, count, mock, onceId, popoutTab, sendPopout, textsOf, todoData, waitForCalls, waitForCount } from "../support";
import { filesToggle, openOrca, orcaOverview, pickItem, project, sample, selectedTab, tabOf, worktrees } from "../orca-support";

// A-49: the Todo part of the file pane and the tab of a task in the work pane. The tasks are the Todo screen's own (T-1; its reads are the Todo spec's); here the screen is checked: what the part draws from them, what a press opens, and what the tab does.
describe("orca: the Todo part of the file pane and the tab of a task (A-49)", () => {
  // The data of the Todo screen with a description and a due moment to draw: "Write report" is due today and has a description whose first line is not the first line of the text.
  const data = () => {
    const base = todoData();
    return { ...base, tasks: base.tasks.map((t) => (t.id === "k1" ? { ...t, description: "\n  First line of it\nSecond line" } : t)) };
  };
  const paneMode = (label: string) => $(`#orca-files-bar [aria-label="${label}"]`);
  async function openFiles(fixtures: Record<string, unknown> = {}) {
    await openOrca(orcaOverview(sample(), worktrees()), { orca_terminal_read: ["$"], orca_files_list: { entries: [], total: 0 }, orca_files_ignored: [], editor_settings: { autosaveMs: 100 }, todoist_load: data(), todoist_comments: [], ...fixtures });
    await project("example-app").click();
    await expect(selectedTab()).toBeDisplayed();
    await filesToggle().click();
    await expect($("#orca-files")).toBeDisplayed();
  }
  async function openTodo(fixtures: Record<string, unknown> = {}) {
    await openFiles(fixtures);
    await paneMode("Todo").click();
    await expect($("#orca-todo")).toBeDisplayed();
  }
  const rowsOf = () => textsOf("#orca-todo-list .orca-todo-row");
  const optionsOf = () => browser.execute(() => [...document.querySelectorAll<HTMLOptionElement>("#orca-todo-project option")].map((o) => [o.value, o.textContent]));
  // Chooses an option as the page does: the driver's choice of an option of a select sends no `change` in this WebView.
  const pick = (value: string) =>
    browser.execute((v) => {
      const field = document.getElementById("orca-todo-project") as HTMLSelectElement;
      field.value = v;
      field.dispatchEvent(new Event("change"));
    }, value);
  const row = (id: string) => $(`#orca-todo-list .orca-todo-row[data-id="${id}"]`);
  const taskTabs = () => browser.execute(() => [...document.querySelectorAll<HTMLElement>('.orca-tab[data-tab^="task:"]')].map((t) => t.dataset.tab));
  const rightClickTab = (tab: string) =>
    browser.execute(
      (id, once) => {
        if (!window.__e2e_once__(once)) return;
        document.querySelector(`[data-tab="${id}"]`)!.dispatchEvent(new MouseEvent("contextmenu", { bubbles: true, cancelable: true, button: 2 }));
      },
      tab,
      onceId(),
    );
  const nameOfDetail = () => browser.execute(() => (document.querySelector(".orca-todo-detail .name") as HTMLTextAreaElement | null)?.value ?? null);
  const windowOf = (id: string, title: string) => popoutTab(`todo:${id}`, "", title, { project: "todo", label: "", content: { kind: "todo", id } });

  it("has the Todo button after the Jira one, with the icon, and shows the part under the row with no heading (A-49)", async () => {
    await openFiles();
    await expect(paneMode("Todo")).toHaveAttribute("aria-pressed", "false");
    await expect($("#orca-todo")).not.toBeDisplayed();
    const bar = await browser.execute(() => [...document.querySelectorAll<HTMLElement>("#orca-files-bar > button")].map((b) => [b.getAttribute("aria-label"), b.getAttribute("aria-pressed"), b.querySelector("svg") !== null]));
    expect(bar.map((b) => b[0])).toEqual(["ファイル", "履歴", "言語サーバー", "データベース", "Jira", "Todo", "ファイル欄"]);
    await paneMode("Todo").click();
    await expect(paneMode("Todo")).toHaveAttribute("aria-pressed", "true");
    await expect(paneMode("ファイル")).toHaveAttribute("aria-pressed", "false");
    await expect($("#orca-todo")).toBeDisplayed();
    await expect($("#orca-files-tree")).not.toBeDisplayed();
    await expect($("#orca-files-head")).not.toBeDisplayed();
    await paneMode("ファイル").click();
    await expect($("#orca-todo")).not.toBeDisplayed();
    await expect($("#orca-files-head")).toBeDisplayed();
  });

  it("offers 今日, インボックス and the projects with the sub-projects indented, and lists the tasks due today at first (A-49)", async () => {
    await openTodo();
    await waitForCount("#orca-todo-list .orca-todo-row", 1);
    expect(await optionsOf()).toEqual([["today", "今日"], ["inbox", "インボックス"], ["p1", "Work"], ["p2", "　Design"], ["p3", "　　Sketch"], ["p4", "Home"]]);
    expect(await $("#orca-todo-project").getValue()).toBe("today");
    expect(await rowsOf()).toEqual(["Write reportFirst line of it今日"]);
  });

  it("lists the tasks of a project with the name, the first line of the description and the due moment, and not the subtasks (A-49)", async () => {
    await openTodo();
    await waitForCount("#orca-todo-list .orca-todo-row", 1);
    await pick("p1");
    await waitForCount("#orca-todo-list .orca-todo-row", 2);
    expect(await rowsOf()).toEqual(["Write reportFirst line of it今日", "Plan trip"]);
    await pick("p4");
    await waitForCount("#orca-todo-list .orca-todo-row", 0);
    // The choice is kept while the part is hidden and shown again.
    await pick("p1");
    await paneMode("ファイル").click();
    await paneMode("Todo").click();
    expect(await $("#orca-todo-project").getValue()).toBe("p1");
    await waitForCount("#orca-todo-list .orca-todo-row", 2);
  });

  it("shows no task and no text when Todoist has no token (A-49)", async () => {
    await openTodo({ todoist_load: null });
    await waitForCalls("todoist_load");
    expect(await optionsOf()).toEqual([["today", "今日"], ["inbox", "インボックス"]]);
    expect(await count("#orca-todo-list .orca-todo-row")).toBe(0);
    expect(await textsOf("#orca-todo-list")).toEqual([""]);
    expect(await count("#orca-todo [placeholder]")).toBe(0);
  });

  it("opens the task in a tab of the work pane with its detail, once, and selects the tab it has (A-49)", async () => {
    await openTodo();
    await pick("p1");
    await waitForCount("#orca-todo-list .orca-todo-row", 2);
    expect(await taskTabs()).toEqual([]);
    await row("k2").click();
    await expect(tabOf("task:1")).toBeDisplayed();
    await expect(tabOf("task:1").$(".orca-tab-btn")).toHaveAttribute("aria-selected", "true");
    await expect(tabOf("task:1").$(".orca-tab-title")).toHaveText("Plan trip");
    await expect(tabOf("task:1").$(".orca-file-tab-ic svg")).toExist();
    await browser.waitUntil(async () => (await nameOfDetail()) === "Plan trip", { timeoutMsg: "the detail never showed the task" });
    // The part stays where it was, and the Todo screen's own detail is not drawn here.
    await expect($("#orca-todo")).toBeDisplayed();
    await row("k1").click();
    expect(await taskTabs()).toEqual(["task:1", "task:2"]);
    await row("k2").click();
    expect(await taskTabs()).toEqual(["task:1", "task:2"]);
    await expect(tabOf("task:1").$(".orca-tab-btn")).toHaveAttribute("aria-selected", "true");
    expect(await nameOfDetail()).toBe("Plan trip");
  });

  it("draws the detail of the Todo screen without the grip of a subtask, opens a subtask in a tab of its own, and reads the comments (A-49)", async () => {
    await openTodo({ todoist_comments: [comment("c1", "Ann", "Hello there")] });
    await pick("p1");
    await waitForCount("#orca-todo-list .orca-todo-row", 2);
    await row("k2").click();
    await waitForCount(".orca-todo-detail .subs li.task", 1);
    expect(await count(".orca-todo-detail .subs .grip")).toBe(0);
    expect(await count(".orca-todo-detail .mail-link")).toBe(0);
    expect(await waitForCalls("todoist_comments")).toEqual([{ taskId: "k2", projectId: "p1" }]);
    await waitForCount(".orca-todo-detail .c-row", 1);
    expect(await textsOf(".orca-todo-detail .c-text")).toEqual(["Hello there"]);
    await $(".orca-todo-detail .subs li.task").click();
    await expect(tabOf("task:2").$(".orca-tab-title")).toHaveText("Book flights");
    await browser.waitUntil(async () => (await nameOfDetail()) === "Book flights", { timeoutMsg: "the subtask was not drawn" });
    await expect($(".orca-todo-detail .parent-link")).toBeDisplayed();
    await $(".orca-todo-detail .parent-link").click();
    expect(await taskTabs()).toEqual(["task:1", "task:2"]);
    await expect(tabOf("task:1").$(".orca-tab-btn")).toHaveAttribute("aria-selected", "true");
  });

  it("keeps the look of the work pane while the description is edited, cancelled or saved unchanged: no mail card, no grip, and a subtask opens a tab beside (A-49)", async () => {
    const base = todoData();
    const withText = { ...base, tasks: base.tasks.map((t) => (t.id === "k2" ? { ...t, description: "Plan it", mail: { account, threadId: "t1" } } : t)) };
    await openTodo({ todoist_load: withText });
    await pick("p1");
    await waitForCount("#orca-todo-list .orca-todo-row", 2);
    await row("k2").click();
    await waitForCount(".orca-todo-detail .subs li.task", 1);
    const plain = async () => {
      expect(await count(".orca-todo-detail .mail-link")).toBe(0);
      expect(await count(".orca-todo-detail .subs .grip")).toBe(0);
    };
    await plain();
    await $(".orca-todo-detail .desc").click();
    await expect($(".orca-todo-detail .desc-edit")).toBeDisplayed();
    await plain();
    await $(".orca-todo-detail .desc-actions").$("button=キャンセル").click();
    await expect($(".orca-todo-detail .desc")).toBeDisplayed();
    await plain();
    await $(".orca-todo-detail .desc").click();
    await expect($(".orca-todo-detail .desc-edit")).toBeDisplayed();
    await $(".orca-todo-detail .desc-actions").$("button=保存").click();
    await expect($(".orca-todo-detail .desc")).toBeDisplayed();
    await plain();
    await $(".orca-todo-detail .subs li.task").click();
    await expect(tabOf("task:2").$(".orca-tab-title")).toHaveText("Book flights");
    expect(await taskTabs()).toEqual(["task:1", "task:2"]);
  });

  it("writes through the commands of the Todo screen, and the tab closes when the task is completed (A-49)", async () => {
    await openTodo({ todoist_set_done: true });
    await waitForCount("#orca-todo-list .orca-todo-row", 1);
    await row("k1").click();
    await browser.waitUntil(async () => (await nameOfDetail()) === "Write report", { timeoutMsg: "the detail never showed the task" });
    const data = todoData();
    await mock("todoist_set_done", true);
    await mock("todoist_load", { ...data, tasks: data.tasks.filter((t) => t.id !== "k1") });
    await $(".orca-todo-detail .head .check").click();
    expect(await waitForCalls("todoist_set_done")).toEqual([{ id: "k1", done: true }]);
    await waitForCount('.orca-tab[data-tab^="task:"]', 0);
    await waitForCount("#orca-todo-list .orca-todo-row", 0);
    // The reload after the change was read by the Orca screen, with the completed tasks.
    expect(await waitForCalls("todoist_load")).toEqual([{ withDone: true }]);
  });

  it("has the two split rows and 「別ウィンドウで開く」 in the menu of a tab (A-17, A-46)", async () => {
    await openTodo();
    await pick("p1");
    await waitForCount("#orca-todo-list .orca-todo-row", 2);
    await row("k2").click();
    await expect(tabOf("task:1")).toBeDisplayed();
    // The pane holds the session's tab as well, so the split rows are there.
    await rightClickTab("task:1");
    expect(await textsOf('.menu[role="menu"] > *')).toEqual(["右に分割", "下に分割", "別ウィンドウで開く"]);
    await browser.keys("Escape");
  });

  it("puts the task in a window of its own: the tab leaves the pane and orca_popout_open is asked for the task (A-49, A-46)", async () => {
    await openTodo();
    await pick("p1");
    await waitForCount("#orca-todo-list .orca-todo-row", 2);
    await row("k2").click();
    await rightClickTab("task:1");
    await pickItem("別ウィンドウで開く");
    expect(await waitForCalls("orca_popout_open")).toEqual([{ tab: windowOf("k2", "Plan trip") }]);
    await waitForCount('.orca-tab[data-tab^="task:"]', 0);
    await expect($(".orca-todo-tab")).not.toBeDisplayed();
    // A task that has a window brings it to the front, and opens no tab.
    await row("k2").click();
    expect(await waitForCalls("orca_popout_focus")).toEqual([{ tab: "todo:k2" }]);
    expect(await taskTabs()).toEqual([]);
  });

  it("puts the tab back in the work pane when the button at the right end of its window is pressed (A-49, A-46)", async () => {
    await openTodo();
    await pick("p1");
    await waitForCount("#orca-todo-list .orca-todo-row", 2);
    await row("k2").click();
    await rightClickTab("task:1");
    await pickItem("別ウィンドウで開く");
    await waitForCalls("orca_popout_open");
    await waitForCount('.orca-tab[data-tab^="task:"]', 0);
    await sendPopout({ kind: "restore", tab: "todo:k2" });
    expect(await waitForCalls("orca_popout_end")).toEqual([{ tab: "todo:k2" }]);
    await waitForCount('.orca-tab[data-tab^="task:"]', 1);
    await expect(selectedTab().$(".orca-tab-title")).toHaveText("Plan trip");
  });

  it("closes the tab with its close button, and reads nothing for it (A-49)", async () => {
    await openTodo();
    await waitForCount("#orca-todo-list .orca-todo-row", 1);
    await row("k1").click();
    await expect(tabOf("task:1")).toBeDisplayed();
    const loads = (await callsOf("todoist_load")).length;
    await tabOf("task:1").$(".orca-tab-close").click();
    await waitForCount('.orca-tab[data-tab^="task:"]', 0);
    expect(await count(".orca-todo-tab")).toBe(0);
    expect((await callsOf("todoist_load")).length).toBe(loads);
  });
});
