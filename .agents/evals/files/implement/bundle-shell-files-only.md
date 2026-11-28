# 手順 3 の束の組み立て（計画の段のあと、1 つ目の束）

- 実装を名指しされた issue は 3 件。計画の段で issue ごとに `code-explore` を 1 つずつ起動し、返りの上位の候補をリードが `rg` で確かめた。結果は次のとおり。
  - #1721「Slack の一覧の読み込み中の行をカードにする」。触るファイルは `ts/slack-list.ts`、`e2e/specs/slack-list.e2e.ts`。変える要件は `requirements/slack.md` の S-5。画面から消す要素は `src/index.html` の `#slack-list-loading` と `src/style.css` の `.slack-list-loading`。
  - #1722「Slack のチャンネルの履歴の読み込み中の行をカードにする」。触るファイルは `ts/slack-history.ts`、`e2e/specs/slack-history.e2e.ts`。変える要件は `requirements/slack.md` の S-20。画面から消す要素は `src/index.html` の `#slack-history-loading` と `src/style.css` の `.slack-history-loading`。
  - #1723「Slack のスレッドの読み込み中の行をカードにする」。触るファイルは `ts/slack-thread.ts`、`e2e/specs/slack-thread.e2e.ts`。変える要件は `requirements/slack.md` の S-6。画面から消す要素は `src/index.html` の `#slack-thread-loading` と `src/style.css` の `.slack-thread-loading`。
- ts/ と e2e/specs/ のファイルは 3 件で重ならない。重なるのは `requirements/slack.md`（節は別）、`src/index.html`、`src/style.css` だけ。
- この束のほかに実装する issue は無い。
- ここに無い出来事は起きていない。
