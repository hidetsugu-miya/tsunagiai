# 手順 3 の記録（eval 用の作り話）

- 対象: #1900「Slack の返信に、ホバーで出す「コピー」ボタンを足す」（feat、point:2）。
- 本文: `ts/slack-thread.ts` の返信の行に、`.reply:hover .copy` と `.reply:focus-within .copy` で出すボタンを足す。`e2e/specs/slack-thread.e2e.ts` に、ボタンが出て、押すと `copy_text` が呼ばれる spec を足す。
- 触ってよいファイル: `ts/slack-thread.ts`、`src/style.css`、`e2e/specs/slack-thread.e2e.ts`、`requirements/slack.md`。
- worktree: `.claude/worktrees/feat-S-29`。束はこの 1 件だけ。
