# 実行の記録（手順 5）

この記録の事実は記録の時点のものです。動かす担当は、リポジトリと照らし直しません。

- ブランチ `fix/pre-release-20261128-1712` のワークツリーで作業している。main のチェックアウトのパスは `$main` に入っている。
- PR #1580 は `gh pr create` のあと、`post-checks.sh` が `e2e` と `review` を GitHub に送り、通った。
- `gh pr merge --merge` を実行し、GitHub 上でマージされた。手元の `origin/main` はまだ #1580 のマージコミットを持っていない（`git fetch` をまだ実行していない）。
- ほかに起きた出来事はない。
