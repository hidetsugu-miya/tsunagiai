# Release PR のマージが拒まれた記録

`plan-release.py release` の出力は `changes` に #1501 と #1502 を持ち、`version` は `0.95.0` だった。
`use-worktree.sh release/next` はワークツリーを作り、CHANGELOG.md と docs/features.md を書き、コミットして push した。
`gh pr create --title "release: v0.95.0"` は #1510 を作った。本文は変更の一覧、版の理由、README に直すところが無いことを書いてある。
`post-checks.sh` は `e2e` と `review` の status を送った。

次に `gh pr merge 1510 --merge` を実行すると、こうなった（exit 1）。

```text
GraphQL: Base branch policy prohibits the merge. Required status check "review" is expected. (mergePullRequest)
```
