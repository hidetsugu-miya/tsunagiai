# 手順 3 の記録（eval 用の作り話）

- 対象: #1800「Orca の一覧の行に、ブランチの状態を出す」（feat、point:3）。
- 本文: `ts/bindings/OrcaWorktree.ts` の型に `status` を足し、`ts/orca.ts` の行に出す。`e2e/specs/orca-list.e2e.ts` の固定データも合わせる。
- 触ってよいファイル: `src-tauri/src/orca.rs`、`ts/bindings/OrcaWorktree.ts`、`ts/orca.ts`、`e2e/specs/orca-list.e2e.ts`、`requirements/orca.md`。
- worktree: `.claude/worktrees/feat-A-46`。束はこの 1 件だけ。
