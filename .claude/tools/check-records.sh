#!/usr/bin/env bash
# 使い方: check-records.sh [基点]（基点の既定は origin/main）
# このチェックアウトの HEAD に CI と E2E の記録が要るかを確かめる（pre-git.sh、range-check.sh が使う。#1502）。
# 通る条件は次のどちらか。
# - HEAD に、合格した CI の記録と E2E の記録が両方ある（check-ci.sh と check-e2e.sh）。
# - 基点から HEAD までの範囲で、記録を両方持つ最新のコミット（HEAD を除く。無ければ基点）から HEAD までの差分が、静的検査と E2E の読まないファイルだけ（release-only-diff.sh --untested）。
# 通ったら標準出力に「CI: …」と「E2E: …」の 2 行を出して exit 0（記録のとき check-ci.sh と check-e2e.sh の出力、免除のとき「不要（…）」）。
# 通らなければ理由を標準エラーに出して exit 1。
# 免除はレビューの免除ではない。レビューの合格記録は今までどおり要る。
set -uo pipefail
tools="$(cd "$(dirname "$0")" && pwd)"
[ $# -le 1 ] || { echo "使い方: check-records.sh [基点]" >&2; exit 2; }
base=${1:-origin/main}
main="$(git rev-parse --path-format=absolute --git-common-dir)/.." || exit 2
git rev-parse -q --verify HEAD >/dev/null || exit 2

ci=$("$tools/check-ci.sh" 2>&1); ci_rc=$?
e2e=$("$tools/check-e2e.sh" 2>&1); e2e_rc=$?
if [ "$ci_rc" -eq 0 ] && [ "$e2e_rc" -eq 0 ]; then
  printf 'CI: %s\nE2E: %s\n' "$ci" "$e2e"
  exit 0
fi

# 記録を両方持つ最新のコミット（HEAD は上で確かめた）。無ければ基点。基点はリモートにあり、このゲートを通っている。
from=""
if git rev-parse -q --verify "$base^{commit}" >/dev/null; then
  from=$base
  for c in $(git rev-list "$base..HEAD" 2>/dev/null | tail -n +2); do
    jq -e --arg sha "$c" '.sha == $sha and .clean == true and .passed == true' "$main/.claude/ci/$c" >/dev/null 2>&1 \
      && jq -e --arg sha "$c" '.sha == $sha and .clean == true and .passed == true' "$main/.claude/e2e/$c" >/dev/null 2>&1 \
      && { from=$c; break; }
  done
  if offending=$("$tools/release-only-diff.sh" --untested "$from" HEAD 2>&1); then
    short=$(git rev-parse --short "$from^{commit}")
    printf 'CI: 不要（%s から HEAD までが、静的検査の読まないファイルだけ）\n' "$short"
    printf 'E2E: 不要（%s から HEAD までが、E2E の読まないファイルだけ）\n' "$short"
    exit 0
  fi
else
  offending="基点を解決できません: $base"
fi

[ "$ci_rc" -eq 0 ] || echo "$ci" >&2
[ "$e2e_rc" -eq 0 ] || echo "$e2e" >&2
if [ -n "$from" ]; then
  echo "${from:0:7} から HEAD までに、静的検査か E2E の読むファイルの変更があります:" >&2
fi
echo "$offending" >&2
exit 1
