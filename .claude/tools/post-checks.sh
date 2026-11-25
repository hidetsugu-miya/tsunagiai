#!/usr/bin/env bash
# HEAD の e2e と review の合格を、GitHub の commit status で送る（.claude/rules/issues.md）。main の ruleset がこの 2 つを必須にしている。
# 手元の CI と E2E の記録があるときだけ送るので、合格記録を書けるのは release-verifier と range-check.sh だけで、この役割は変わらない。指摘の中身は送らない。
# CI・E2E・review は、HEAD の記録か、origin/main から HEAD までがリリース作業だけ（Release PR）であることで満たす（#931）。
# 送ったあと、HEAD のブランチの PR の mergeStateStatus が BLOCKED でなくなるまで待つ（2 秒おき、上限 30 秒）。GitHub が statuses を ruleset に反映する前に、続く gh pr merge が拒まれないようにする（#1416）。
# PR がなければ待たず、上限を過ぎても今と同じく終わる。
# HEAD を push してから呼ぶ。どのチェックアウトからでもよく、呼んだ場所の HEAD を見る。
set -uo pipefail
main="$(git rev-parse --path-format=absolute --git-common-dir)/.." || exit 2
git diff --quiet HEAD || { echo "コミットしていない変更があります" >&2; exit 1; }
sha=$(git rev-parse HEAD) || exit 2

# origin/main から HEAD までがリリース作業だけか（Release PR）。要るときに 1 回だけ fetch して調べる。
ro=""
offending=""
release_only() {
  if [ -z "$ro" ]; then
    git fetch -q origin main || exit 2
    if offending=$("$main/.claude/tools/release-only-diff.sh" origin/main HEAD 2>&1); then ro=yes; else ro=no; fi
  fi
  [ "$ro" = yes ]
}

ci_out=$("$main/.claude/tools/check-ci.sh" 2>&1); ci=$?
e2e_out=$("$main/.claude/tools/check-e2e.sh" 2>&1); e2e=$?
if [ "$ci" -ne 0 ] || [ "$e2e" -ne 0 ]; then
  release_only || {
    [ "$ci" -eq 0 ] || echo "$ci_out" >&2
    [ "$e2e" -eq 0 ] || echo "$e2e_out" >&2
    echo "HEAD ${sha:0:7} に CI か E2E の記録がなく、origin/main からの差分もリリース作業だけではありません（下が外れたパス）" >&2
    echo "$offending" >&2
    exit 1
  }
fi

if [ ! -f "$main/.claude/reviews/$sha" ]; then
  release_only || {
    echo "HEAD ${sha:0:7} に合格記録がなく、origin/main からの差分もリリース作業だけではありません（下が外れたパス）" >&2
    echo "$offending" >&2
    exit 1
  }
fi

repo=$(gh repo view --json nameWithOwner --jq .nameWithOwner) || exit 2
for context in e2e review; do
  gh api -X POST "repos/$repo/statuses/$sha" -f state=success -f context="$context" -f description="passed on this machine" >/dev/null || exit 1
done
echo "送信しました: ${sha:0:7} e2e review"

# ruleset が statuses を取り込むまで待つ。PR がない（gh pr view が失敗する）ときは待たない。
# 反映前の UNKNOWN（まだ計算中）も BLOCKED と同じく待つ。
for _ in $(seq 15); do
  state=$(gh pr view --json mergeStateStatus --jq .mergeStateStatus 2>/dev/null) || exit 0
  case "$state" in
    BLOCKED|UNKNOWN) sleep 2 ;;
    *) exit 0 ;;
  esac
done
echo "30 秒待っても mergeStateStatus が BLOCKED から変わりませんでした（そのまま終わります）"
