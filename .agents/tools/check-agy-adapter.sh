#!/usr/bin/env bash
# agy-adapter.sh の自己確認: Antigravity 形式の入力 JSON を流し、PreToolUse / PostToolUse / SessionStart の変換と
# guard-review.sh の release-verifier 判定（transcript の step 0）を確かめる。
set -uo pipefail
tools="$(cd "$(dirname "$0")" && pwd)"
hooks="$(cd "$tools/../hooks" && pwd)"
adapter="$hooks/agy-adapter.sh"
fail=0

tmp=$(mktemp -d) || exit 2
trap 'rm -rf "$tmp"' EXIT
export TSUNAGIAI_HOOK_LOG_DIR="$tmp/hook-logs"
export TSUNAGIAI_HOOKS_DIR="$hooks"

check_decision() {
  local want=$1 name=$2 script=$3 payload=$4 out got
  out=$(printf '%s' "$payload" | "$adapter" PreToolUse "$script" 2>/dev/null)
  got=$(jq -r '.decision // empty' <<< "$out" 2>/dev/null)
  [ "$got" = "$want" ] && echo "ok   $name" || { echo "FAIL $name (期待 ${want}、結果 ${got}: $out)"; fail=1; }
}

# 1. guard-e2e.sh: allow / deny
check_decision allow "PreToolUse allow (guard-e2e)" guard-e2e.sh \
  '{"hookEventName":"PreToolUse","cwd":"/repo","workspacePaths":["/repo"],"toolCall":{"id":"1","name":"run_command","args":{"CommandLine":"git status"}}}'
check_decision deny "PreToolUse deny (guard-e2e write_file)" guard-e2e.sh \
  '{"hookEventName":"PreToolUse","cwd":"/repo","workspacePaths":["/repo"],"toolCall":{"id":"2","name":"write_file","args":{"Path":"/repo/.claude/e2e/abc","Content":"x"}}}'

# 2. guard-review.sh: lead transcript -> deny, other subagent -> deny, release-verifier -> allow
lead_tr="$tmp/lead.jsonl"
printf '{"step_index":0,"source":"USER_EXPLICIT","type":"USER_INPUT","content":"You are `release-verifier` please run record-review.sh"}\n' > "$lead_tr"
other_tr="$tmp/other.jsonl"
printf '{"step_index":0,"source":"SYSTEM","type":"SYSTEM_MESSAGE","content":"[Message] timestamp=2026-11-28T00:00:00Z sender=parent priority=MESSAGE_PRIORITY_HIGH content=You are `code-reviewer` for tsunagiai."}\n' > "$other_tr"
rv_tr="$tmp/rv.jsonl"
printf '{"step_index":0,"source":"SYSTEM","type":"SYSTEM_MESSAGE","content":"[Message] timestamp=2026-11-28T00:00:00Z sender=parent priority=MESSAGE_PRIORITY_HIGH content=You are `release-verifier` for tsunagiai."}\n' > "$rv_tr"

mk_review_payload() {
  jq -nc --arg tr "$1" '{hookEventName:"PreToolUse",cwd:"/repo",workspacePaths:["/repo"],transcriptPath:$tr,toolCall:{id:"3",name:"run_command",args:{CommandLine:".agents/hooks/record-review.sh < tmp/v.txt"}}}'
}
check_decision deny "guard-review: transcript なしは拒否" guard-review.sh "$(mk_review_payload "")"
check_decision deny "guard-review: リードの transcript は拒否" guard-review.sh "$(mk_review_payload "$lead_tr")"
check_decision deny "guard-review: 他サブエージェントは拒否" guard-review.sh "$(mk_review_payload "$other_tr")"
check_decision allow "guard-review: release-verifier サブエージェントは許可" guard-review.sh "$(mk_review_payload "$rv_tr")"
check_decision allow "guard-review: worktree のフック編集は許可" guard-review.sh \
  '{"hookEventName":"PreToolUse","cwd":"/repo","workspacePaths":["/repo"],"toolCall":{"id":"4","name":"edit_file","args":{"Path":"/repo/.claude/worktrees/wt1/.agents/hooks/record-review.sh","Target":"a","Replacement":"b"}}}'

# 3. PostToolUse / SessionStart: スタブフックで {} 出力と終了コードを確かめる
mkdir -p "$tmp/stub-hooks"
printf '#!/usr/bin/env bash\nexit 0\n' > "$tmp/stub-hooks/ok.sh"
printf '#!/usr/bin/env bash\necho boom >&2\nexit 2\n' > "$tmp/stub-hooks/ng.sh"
chmod +x "$tmp/stub-hooks/ok.sh" "$tmp/stub-hooks/ng.sh"

out=$(TSUNAGIAI_HOOKS_DIR="$tmp/stub-hooks" "$adapter" PostToolUse ok.sh <<< '{"hookEventName":"PostToolUse","cwd":"/repo","toolCall":{"name":"edit_file","args":{"Path":"/repo/a.txt"}}}')
rc=$?
[ "$rc" -eq 0 ] && [ "$out" = "{}" ] && echo "ok   PostToolUse ok -> {} (exit 0)" || { echo "FAIL PostToolUse ok (rc=$rc out=$out)"; fail=1; }

out=$(TSUNAGIAI_HOOKS_DIR="$tmp/stub-hooks" "$adapter" PostToolUse ng.sh <<< '{"hookEventName":"PostToolUse","cwd":"/repo","toolCall":{"name":"edit_file","args":{"Path":"/repo/a.txt"}}}' 2>/dev/null)
rc=$?
[ "$rc" -eq 2 ] && [ "$out" = "{}" ] && echo "ok   PostToolUse ng -> {} (exit 2)" || { echo "FAIL PostToolUse ng (rc=$rc out=$out)"; fail=1; }

out=$(TSUNAGIAI_HOOKS_DIR="$tmp/stub-hooks" "$adapter" SessionStart ok.sh <<< '{"hookEventName":"SessionStart","cwd":"/repo"}')
rc=$?
[ "$rc" -eq 0 ] && [ "$out" = "{}" ] && echo "ok   SessionStart ok -> {} (exit 0)" || { echo "FAIL SessionStart ok (rc=$rc out=$out)"; fail=1; }

exit $fail
