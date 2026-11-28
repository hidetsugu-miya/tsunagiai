#!/usr/bin/env bash
# review-verifier だけが呼ぶ（guard-review.sh が強制する）。stdin の判定を HEAD の合格記録として残し、pre-git.sh が push 前に見る。
# stdin が空か、1 行目が「判定: 合格」で始まらないときは、何も書かずに終了コード 2 で止める（判定のない合格記録を残さない。#1375）。
set -euo pipefail
verdict=$(cat)
case "$(printf '%s\n' "$verdict" | head -n 1)" in
  '判定: 合格'*) ;;
  *) echo "stdin の 1 行目が「判定: 合格」で始まっていません。判定の全文を stdin で渡してください。記録は書きません" >&2; exit 2 ;;
esac
cd "${CLAUDE_PROJECT_DIR:-$(git rev-parse --show-toplevel)}"
git diff --quiet HEAD || { echo "コミットしていない変更があります。レビューした中身と HEAD が一致しません" >&2; exit 1; }
dir="$(git rev-parse --path-format=absolute --git-common-dir)/../.claude/reviews"
mkdir -p "$dir"
sha=$(git rev-parse HEAD)
printf '%s\n' "$verdict" > "$dir/$sha"
echo "合格を記録しました: $sha"
