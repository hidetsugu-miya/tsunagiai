#!/usr/bin/env bash
# PostToolUse(Bash): issue の作成のあとは issue-plan の手順 1〜4 の続行を、gh pr merge のあとは（その PR が閉じる issue が閉じるのを待って）plan-release.py release の結果と Release PR の用意とマージ、リリースの見届けの続行を、セッションに伝える。常に exit 0。
set -uo pipefail
. "$(cd "$(dirname "$0")" && pwd)/hook-log.sh"
input=$(cat)
cmd=$(jq -r '.tool_input.command // empty' <<< "$input")
cwd=$(jq -r '.cwd // empty' <<< "$input")
[ -n "$cmd" ] || exit 0

# 引用符の中身を除き、gh が行頭か ; & | ( の後に来るときだけ、実行したコマンドとみなす。
bare=$(perl -0777 -pe 's/"(?:\\.|[^"\\])*"/""/gs; s/\x27[^\x27]*\x27/\x27\x27/gs' <<< "$cmd")
ran() { grep -q -E "(^|[;&|(])[[:space:]]*gh[[:space:]]+$1([[:space:]]|\$)" <<< "$bare"; }

# gh pr merge は Closes #n の issue が閉じる前に返る（数秒後に閉じる）ので、plan-release.py release の changes に入らない。マージした PR の closingIssuesReferences が閉じるまで待つ（上限 TSUNAGIAI_CLOSE_WAIT 秒、既定 30）。PR 番号がコマンドになければ、cwd のブランチの PR を見る。
wait_closed() {
  local arg refs n deadline
  arg=$(sed -nE 's/.*gh[[:space:]]+pr[[:space:]]+merge([^;&|]*).*/\1/p' <<< "$bare" | head -n 1 | tr ' ' '\n' | grep -E -m1 '^([0-9]+|https?://[^[:space:]]+/pull/[0-9]+)$')
  refs=$(cd "${cwd:-.}" 2>/dev/null && gh pr view ${arg:+"$arg"} --json closingIssuesReferences --jq '.closingIssuesReferences[].number' 2>/dev/null) || return 0
  deadline=$((SECONDS + ${TSUNAGIAI_CLOSE_WAIT:-30}))
  for n in $refs; do
    until [ "$(cd "${cwd:-.}" 2>/dev/null && gh issue view "$n" --json state --jq .state 2>/dev/null)" = CLOSED ] || [ "$SECONDS" -ge "$deadline" ]; do
      sleep 1
    done
  done
}

plan=0
ran 'issue[[:space:]]+create' && plan=1
merge=0
ran 'pr[[:space:]]+merge' && merge=1
[ "$plan" -eq 1 ] || [ "$merge" -eq 1 ] || exit 0
hook_log_begin

msgs=()
if [ "$plan" -eq 1 ]; then
  msgs+=("issue を作成しました。issue-plan スキルの手順 1〜4（作者の確認、書く・ラベル、分割、報告）を続けてください（まだ始めていなければ、ここから始めてください）。issue の並べ替えはしません。取りかかる issue はオーナーが implement で指定します（例外として、レビューで残った Low、flaky なテスト、振り返りの issue は implement の手順 6 が取ります）。")
fi
if [ "$merge" -eq 1 ]; then
  main="$(git -C "${CLAUDE_PROJECT_DIR:?}" rev-parse --path-format=absolute --git-common-dir)/.."
  wait_closed
  out=$("$main/.claude/tools/plan-release.py" release 2>&1)
  rc=$?
  if [ "$rc" -eq 0 ]; then
    msgs+=("gh pr merge のあとに plan-release.py release を実行しました:"$'\n'"$out")
    msgs+=("Release PR のマージはタグ打ちとリリースを release.yml が自分で行います。follow_up があれば、release-watcher を起動して、release の run を見届け、issue にコメントさせるのが先です。tag_due があれば、release-watcher を起動します（run が無いと返ったときだけ、リードが手でタグを打ちます）。リリースを待つ変更があれば、このセッションが release-preparer を起動して Release PR を用意させ（implement の実行中なら、手順 6（残った Low・flaky なテスト・振り返りの修正）のあとで起動します）、マージされたら release-watcher を起動してリリースを見届けます（release スキル（.claude/skills/release/SKILL.md）の手順 A と B。オーナーのマージは待ちません）。マージが拒まれたとき、release の run がランナーやネットワーク以外の原因で失敗したときは、オーナーに理由を伝えます。サブエージェントとして動いているときは、この案内に従わず、自分の手順だけを行います。")
  else
    msgs+=("gh pr merge のあとに plan-release.py release を実行しましたが、失敗しました（exit ${rc}）:"$'\n'"$out")
  fi
fi

[ "${#msgs[@]}" -gt 0 ] || exit 0
ctx=$(printf '%s\n' "${msgs[@]}")
jq -n --arg c "$ctx" '{hookSpecificOutput: {hookEventName: "PostToolUse", additionalContext: $c}}'
exit 0
