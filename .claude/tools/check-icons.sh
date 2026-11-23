#!/usr/bin/env bash
# アイコンの SVG の形が ts/icons.ts の外に書かれていないかを検査する（.claude/rules/frontend.md）。
# ts/icons.ts と ts/bindings/ を除く ts/ の .ts に svg、path、circle、rect などの要素の文字列があれば失敗する。
# src/index.html は svg に子要素を持たせず、すべての svg に data-svg を付ける（形は ts/icons.ts の fillIcons が入れる）。
# 使い方: check-icons.sh [ファイル...]（省略時はこの checkout の木全体。ファイルは絶対パスか checkout の root からの相対パス）。
# 失敗時は該当の path:line を stderr に出して exit 1。
set -uo pipefail
root="$(cd "$(dirname "$0")/../.." && pwd -P)"
cd "$root" || exit 2

shape='<(svg|path|circle|rect|line|polyline|polygon|ellipse|g|use|symbol)([ />]|$)'
child='<(path|circle|rect|line|polyline|polygon|ellipse|g|use|symbol)([ />]|$)'
bad=0

if [ "$#" -eq 0 ]; then
  set -- ts/*.ts src/index.html
  while IFS= read -r f; do set -- "$@" "$f"; done < <(find ts -mindepth 2 -name '*.ts' -not -path 'ts/bindings/*')
fi

for f in "$@"; do
  case "$f" in /*) rel="${f#"$root"/}" ;; *) rel="$f" ;; esac
  [ -f "$rel" ] || continue
  case "$rel" in
    ts/icons.ts|ts/bindings/*) ;;
    ts/*.ts)
      out=$(grep -nE "$shape" "$rel") && { sed "s|^|$rel:|" <<< "$out" >&2; bad=1; }
      ;;
    src/index.html)
      out=$(grep -nE "$child" "$rel") && { sed "s|^|$rel:|" <<< "$out" >&2; bad=1; }
      out=$(grep -nE '<svg' "$rel" | grep -v 'data-svg=') && { sed "s|^|$rel:|" <<< "$out" >&2; bad=1; }
      ;;
  esac
done

[ "$bad" -eq 0 ] || { echo "アイコンの形は ts/icons.ts に置く（index.html は <svg data-svg=\"名前\"></svg> だけを書く）: .claude/rules/frontend.md" >&2; exit 1; }
exit 0
