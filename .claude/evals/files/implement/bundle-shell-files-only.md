# 手順 3 の束の組み立て（1 つ目の束）

- 実装を名指しされた issue は 3 件。
  - #1721「Slack の一覧の読み込み中の行をカードにする」。触るファイルは `ts/slack.ts`、`requirements/slack.md`、`e2e/specs/slack-list.e2e.ts`。画面から消す要素は `src/index.html` の `#slack-loading` と `src/style.css` の `.slack-loading`。
  - #1722「Todo の一覧の読み込み中の行をカードにする」。触るファイルは `ts/todo.ts`、`requirements/tasks.md`、`e2e/specs/todo-list.e2e.ts`。画面から消す要素は `src/index.html` の `#todo-loading` と `src/style.css` の `.todo-loading`。
  - #1723「カレンダーの読み込み中の行をカードにする」。触るファイルは `ts/calendar.ts`、`requirements/calendar.md`、`e2e/specs/calendar-view.e2e.ts`。画面から消す要素は `src/index.html` の `#calendar-loading` と `src/style.css` の `.calendar-loading`。
- ts/、requirements/、e2e/ のファイルは 3 件で重ならない。重なるのは `src/index.html` と `src/style.css` だけ。
- ここに無い出来事は起きていない。
