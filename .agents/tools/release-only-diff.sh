#!/usr/bin/env bash
# 使い方: release-only-diff.sh [--untested] A B
# 既定: A..B の差分がリリース作業だけ（README、CHANGELOG、docs）なら exit 0。そうでなければ、外れたパスを標準エラーに出して exit 1。
# pre-git.sh と post-checks.sh が、記録のあるコミット（または範囲の基点、origin/main）から HEAD までがリリース作業だけかを確かめるのに使う（.agents/rules/review.md）。
# リリース作業だけなら、HEAD にレビューの合格記録も CI（run-ci.sh）と E2E の記録も求めない（#931）。
# --untested: A..B の差分が、静的検査（run-ci.sh）と E2E が読まないファイルだけなら exit 0。そうでなければ、外れたパスを標準エラーに出して exit 1。
# check-records.sh が使い、HEAD に CI と E2E の記録を求めるかを決める（レビューの免除ではない。#1502）。
# A か B を解決できないときは exit 2（差分が取れないまま通ることはない）。
# カレントのリポジトリで動く。
set -uo pipefail
untested=0
if [ "${1:-}" = "--untested" ]; then
  untested=1
  shift
fi
[ $# -eq 2 ] || { echo "使い方: release-only-diff.sh [--untested] A B" >&2; exit 2; }
a=$1
b=$2
git rev-parse -q --verify "$a^{commit}" >/dev/null || { echo "解決できません: $a" >&2; exit 2; }
git rev-parse -q --verify "$b^{commit}" >/dev/null || { echo "解決できません: $b" >&2; exit 2; }

# リリース作業のパスか
release_path() {
  case "$1" in
    README.md | CHANGELOG.md | docs/*) return 0 ;;
    *) return 1 ;;
  esac
}

# 静的検査と E2E が読まないパスか（run-ci.sh、wdio、tsc、biome、cargo、build.rs の埋め込みのどれも読まない。#1502）
untested_path() {
  case "$1" in
    # tsc が読む（run-ci.sh）
    .agents/skills/readme-product/shots/* | .claude/skills/readme-product/shots/*) return 1 ;;
    # 検査そのもの、または検査が呼ぶ
    .agents/tools/run-ci.sh | .agents/tools/run-e2e.sh | .agents/tools/check-ci.sh | .agents/tools/check-e2e.sh | .agents/tools/ensure-deps.sh | .agents/tools/check-icons.sh | .claude/tools/run-ci.sh | .claude/tools/run-e2e.sh | .claude/tools/check-ci.sh | .claude/tools/check-e2e.sh | .claude/tools/ensure-deps.sh | .claude/tools/check-icons.sh) return 1 ;;
    README.md | CHANGELOG.md | docs/*) return 0 ;;
    AGENTS.md | CLAUDE.md | src-tauri/AGENTS.md | src-tauri/CLAUDE.md) return 0 ;;
    requirements/*) return 0 ;;
    .agents/rules/* | .agents/agents/* | .agents/evals/* | .agents/hooks/* | .agents/hooks.json | .agents/skills/* | .agents/tools/* | .claude/agents | .claude/rules | .claude/skills | .claude/rules/* | .claude/agents/* | .claude/evals/* | .claude/hooks/* | .claude/skills/* | .claude/tools/*) return 0 ;;
    *) return 1 ;;
  esac
}

paths=$(git diff --name-only --no-renames "$a" "$b") || { echo "差分を取れません: $a $b" >&2; exit 2; }
bad=()
while IFS= read -r path; do
  [ -n "$path" ] || continue
  if [ "$untested" -eq 1 ]; then
    untested_path "$path" || bad+=("$path")
  else
    release_path "$path" || bad+=("$path")
  fi
done <<< "$paths"

[ ${#bad[@]} -eq 0 ] && exit 0
printf '%s\n' "${bad[@]}" >&2
exit 1
