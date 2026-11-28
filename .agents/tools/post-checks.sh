#!/usr/bin/env bash
# HEAD の e2e と review の合格を、GitHub の commit status で送る（.agents/rules/issues.md）。main の ruleset がこの 2 つを必須にしている。
# 手元の CI と E2E の記録があるときだけ送るので、合格記録を書けるのは release-verifier と range-check.sh だけで、この役割は変わらない。指摘の中身は送らない。
# CI と E2E は check-records.sh で確かめる。HEAD の記録があるか、記録のあるコミット（無ければ origin/main）から HEAD までが検査の読まないファイルだけなら通る（#1502）。
# 後者のとき、e2e の status は送り（ruleset が求める）、description で E2E 不要と分かるようにする。
# review は、HEAD の合格記録か、origin/main から HEAD までがリリース作業だけ（Release PR）であることで満たす（#931）。
# 送ったあと、HEAD のブランチの開いた PR の mergeStateStatus が BLOCKED でなくなるまで待つ（2 秒おき、上限 30 秒）。GitHub が statuses を ruleset に反映する前に、続く gh pr merge が拒まれないようにする（#1416）。
# 開いた PR がなければ待たず、上限を過ぎても今と同じく終わる。
# HEAD を push し、PR を作ってから呼ぶ。どのチェックアウトからでもよく、呼んだ場所の HEAD を見る。
set -uo pipefail
main="$(git rev-parse --path-format=absolute --git-common-dir)/.." || exit 2
git diff --quiet HEAD || { echo "コミットしていない変更があります" >&2; exit 1; }
sha=$(git rev-parse HEAD) || exit 2

# origin/main は要るときに 1 回だけ fetch する。
fetched=""
fetch_main() {
  [ -n "$fetched" ] || { git fetch -q origin main || exit 2; fetched=yes; }
}

# origin/main から HEAD までがリリース作業だけか（Release PR）。
ro=""
offending=""
release_only() {
  if [ -z "$ro" ]; then
    fetch_main
    if offending=$("$main/.agents/tools/release-only-diff.sh" origin/main HEAD 2>&1); then ro=yes; else ro=no; fi
  fi
  [ "$ro" = yes ]
}

records=$("$main/.agents/tools/check-records.sh" 2>&1) || {
  fetch_main
  records=$("$main/.agents/tools/check-records.sh" 2>&1) || {
    echo "HEAD ${sha:0:7} の CI と E2E の記録が要るのにありません" >&2
    echo "$records" >&2
    exit 1
  }
}
e2e_description="passed on this machine"
grep -q '^E2E: 不要' <<< "$records" && e2e_description="not needed: only files that the checks do not read changed"

if [ ! -f "$main/.claude/reviews/$sha" ]; then
  release_only || {
    echo "HEAD ${sha:0:7} に合格記録がなく、origin/main からの差分もリリース作業だけではありません（下が外れたパス）" >&2
    echo "$offending" >&2
    exit 1
  }
fi

repo=$(gh repo view --json nameWithOwner --jq .nameWithOwner) || exit 2
for context in e2e review; do
  description="passed on this machine"
  [ "$context" != e2e ] || description=$e2e_description
  gh api -X POST "repos/$repo/statuses/$sha" -f state=success -f context="$context" -f description="$description" >/dev/null || exit 1
done
echo "送信しました: ${sha:0:7} e2e review"

# ruleset が statuses を取り込むまで待つ。開いた PR がない（マージ済みや閉じた PR は読まない）ときは待たない。
# 反映前の UNKNOWN（まだ計算中）も BLOCKED と同じく待つ。
branch=$(git branch --show-current)
[ -n "$branch" ] || exit 0
for _ in $(seq 15); do
  state=$(gh pr list --head "$branch" --state open --json mergeStateStatus --jq '.[0].mergeStateStatus // empty' 2>/dev/null) || exit 0
  case "$state" in
    BLOCKED|UNKNOWN) sleep 2 ;;
    *) exit 0 ;;
  esac
done
echo "30 秒待っても mergeStateStatus が BLOCKED から変わりませんでした（そのまま終わります）"
