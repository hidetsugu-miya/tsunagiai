#!/usr/bin/env bash
# PostToolUse(Write|Edit|MultiEdit): 公開禁止語の検査、アイコンの形の置き場所の検査、rustfmt、TypeScript の tsc。
set -uo pipefail
. "$(cd "$(dirname "$0")" && pwd)/hook-log.sh"
f=$(jq -r '.tool_input.file_path // empty')
[ -n "$f" ] && [ -f "$f" ] || exit 0
# 編集したファイルの属する checkout（main か worktree）を検査の root にする。
root="$(git -C "$(dirname "$f")" rev-parse --show-toplevel 2>/dev/null)" || exit 0
# Only the files of this repository (the main checkout and its worktrees) are checked, not those of another repository.
[ "$(git -C "$(dirname "$f")" rev-parse --path-format=absolute --git-common-dir 2>/dev/null)" = "$(git -C "$(dirname "$0")" rev-parse --path-format=absolute --git-common-dir 2>/dev/null)" ] || exit 0
hook_log_begin

msg=$("$(cd "$(dirname "$0")" && pwd)/guard-public.sh" file "$f" 2>&1) || { echo "$msg" >&2; exit 2; }

abs="$(cd "$(dirname "$f")" && pwd -P)/$(basename "$f")"

# アイコンの形は ts/icons.ts にだけ置く。ts/*.ts と src/index.html は、その checkout の check-icons.sh で検査する（無ければ省く）。
case "$abs" in
  "$root"/ts/*.ts|"$root"/src/index.html)
    [ -x "$root/.agents/tools/check-icons.sh" ] && { out=$("$root/.agents/tools/check-icons.sh" "$abs" 2>&1) || { echo "$out" >&2; exit 2; }; }
    ;;
esac
case "$abs" in
  "$root"/src-tauri/*.rs)
    out=$(cd "$root/src-tauri" && mise exec -- rustfmt --edition 2021 "$abs" 2>&1) \
      || { echo "rustfmt 失敗: $abs"$'\n'"$out" >&2; exit 2; }
    ;;
  "$root"/ts/*.ts|"$root"/e2e/*.ts|"$root"/wdio.conf.ts)
    # 編集したファイルのプロジェクトだけを型検査する（node_modules が無ければ省く）。
    [ -x "$root/node_modules/.bin/tsc" ] || exit 0
    case "$abs" in "$root"/ts/*) proj=ts ;; *) proj=e2e ;; esac
    out=$(cd "$root" && node_modules/.bin/tsc --noEmit -p "$proj/tsconfig.json" 2>&1) \
      || { echo "tsc 失敗 ($proj): $abs"$'\n'"$(tail -n 40 <<< "$out")" >&2; exit 2; }
    ;;
esac
exit 0
