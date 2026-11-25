#!/usr/bin/env bash
# PreToolUse: 合格記録（.claude/reviews/ と record-review*.sh）と GitHub の commit status（/statuses/）に触れる呼び出しは、release-verifier 以外には次の 2 つの形だけ通し、ほかは止める。
# 通す 1: 読むだけの 1 つのコマンド（cat、head、grep、rg、sed -n、git diff、git show、git log）。コマンド全体が 1 つの単純なコマンドで、; & | < > 改行 ` $( ${ を含まないときだけ。
#   sed は -n があり、スクリプトが行番号（N または N,M）と p だけで、ファイル以外に - で始まる引数が無いときだけ（-i、w、e を使えない）。
#   rg は --pre と --hostname-bin（外のコマンドを走らせる）を、git diff / show / log は --output（ファイルに書く）を含まないときだけ。
# 通す 2: Write / Edit / MultiEdit で、file_path が .claude/worktrees/{名前}/.claude/hooks/ の下の記録のスクリプト（名前が record-review で始まる .sh）か guard-review.sh で、パスに .. を含まないもの。main checkout の写しの編集は止める。
# 止める: スクリプトを走らせること（bash や直接の実行）、.claude/reviews/ への書き込み、/statuses/ を含むコマンド（gh api など）、上の 2 つの形でないすべて。
# 例外: マージ済みの版の止めない指摘だけを直した差分の範囲確認は .claude/tools/range-check.sh が行い、通れば自分で記録のスクリプトを呼んで記録を書く（#932）。
# そのコマンドの文は記録のスクリプトの名前も .claude/reviews も含まないのでここで止まらない。主エージェントが記録のスクリプトを呼ぶことや .claude/reviews/ に書くことは止まる。
set -uo pipefail
. "$(cd "$(dirname "$0")" && pwd)/hook-log.sh"
input=$(cat)
tool=$(jq -r '.tool_name // empty' <<< "$input")
cmd=$(jq -r '.tool_input.command // empty' <<< "$input")
path=$(jq -r '.tool_input.file_path // .tool_input.notebook_path // empty' <<< "$input")
deny='record-review|\.claude/reviews|/statuses/'
printf '%s\n%s\n' "$cmd" "$path" | grep -q -E "$deny" || exit 0
hook_log_begin
case "$(jq -r '.agent_type // empty' <<< "$input")" in release-verifier) exit 0 ;; esac

# 読むだけの 1 つのコマンドか。
read_only() {
  local c=$1 q="'" dq='"' num='[0-9]+(,[0-9]+)?p' sed_re
  [[ -n $c ]] || return 1
  case $c in
    *[';&|<>`']*|*$'\n'*|*'$('*|*'${'*) return 1 ;;
  esac
  sed_re="^sed -n ($q$num$q|$dq$num$dq|$num)( [^ $q$dq-][^ ]*)+\$"
  case $c in
    "cat "*|"head "*|"grep "*) return 0 ;;
    "rg "*) [[ $c != *--pre* && $c != *--hostname-bin* ]] ;;
    "git diff "*|"git show "*|"git log "*) [[ $c != *--output* ]] ;;
    "sed "*) [[ $c =~ $sed_re ]] ;;
    *) return 1 ;;
  esac
}

# ワークツリーの記録のスクリプトか guard-review.sh の編集か。
worktree_hook_edit() {
  local re='^/.*/\.claude/worktrees/[^/.][^/]*/\.claude/hooks/(record-review[^/]*|guard-review)\.sh$'
  [[ -z $cmd && $path =~ $re && $path != *..* ]] || return 1
  ! grep -q -E "$deny" <<< "$(dirname "$path")"
}

case "$tool" in
  Write|Edit|MultiEdit) worktree_hook_edit && exit 0 ;;
  *) read_only "$cmd" && exit 0 ;;
esac
echo "合格記録は release-verifier と range-check.sh だけが書けます（読むだけのコマンドと、ワークツリーの記録のスクリプトの編集は通ります）。.claude/rules/review.md の手順でレビューを受けてください" >&2
exit 2
