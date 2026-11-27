#!/usr/bin/env bash
# pre-git.sh の自己確認: 一時ディレクトリの git リポジトリ（リモート、main の checkout、worktree）に hook 入力を流し、止める（exit 2）・通す（exit 0）を確かめる（#310）。
# 本物のリモート、キーチェーン、記録は使わない。この script 自身の checkout の pre-git.sh を検査する（pre-git.sh は、自身に触れる push でこれを走らせる）。
set -uo pipefail
tools="$(cd "$(dirname "$0")" && pwd)"
hook="$tools/../hooks/pre-git.sh"
fail=0

tmp=$(mktemp -d) || exit 2
trap 'rm -rf "$tmp"' EXIT
export TSUNAGIAI_HOOK_LOG_DIR="$tmp/hook-logs"
export GIT_CONFIG_GLOBAL=/dev/null GIT_CONFIG_SYSTEM=/dev/null
export GIT_AUTHOR_NAME=t GIT_AUTHOR_EMAIL=t@example.test GIT_COMMITTER_NAME=t GIT_COMMITTER_EMAIL=t@example.test

git init -q --bare "$tmp/remote.git" || exit 2
git clone -q "$tmp/remote.git" "$tmp/main" 2>/dev/null || exit 2
main="$tmp/main"
mkdir -p "$main/src-tauri" "$main/.claude/tools"
printf '[package]\nname = "x"\nversion = "0.0.0"\n' > "$main/src-tauri/Cargo.toml"
cp "$tools/check-ci.sh" "$tools/check-e2e.sh" "$tools/check-records.sh" "$tools/release-only-diff.sh" "$main/.claude/tools/"
git -C "$main" checkout -q -b main
git -C "$main" add -A
git -C "$main" commit -q -m init
git -C "$main" push -q origin main 2>/dev/null || exit 2
git -C "$main" worktree add -q -b work "$tmp/work" origin/main 2>/dev/null || exit 2
work="$tmp/work"
echo change > "$work/change.txt"
git -C "$work" add change.txt
git -C "$work" commit -q -m "change"
sha=$(git -C "$work" rev-parse HEAD)

# check <期待する終了コード> <名前> <hook 入力の cwd> <コマンド> [CLAUDE_PROJECT_DIR]
check() {
  local want=$1 name=$2 got
  jq -n --arg cwd "$3" --arg c "$4" '{cwd: $cwd, tool_input: {command: $c}}' \
    | CLAUDE_PROJECT_DIR="${5:-$main}" "$hook" >/dev/null 2>&1
  got=$?
  [ "$got" -eq "$want" ] && echo "ok   $name" || { echo "FAIL $name (期待 ${want}、結果 ${got})"; fail=1; }
}

# check_gate <ゲート名> <名前> <hook 入力の cwd> <コマンド> [stderr に出る文]: exit 2 で止まり、ゲートの行がログに残り、文があればそれが stderr に出ることを確かめる
check_gate() {
  local gate=$1 name=$2 got err
  rm -rf "$tmp/hook-logs"
  err=$(jq -n --arg cwd "$3" --arg c "$4" '{cwd: $cwd, tool_input: {command: $c}}' \
    | CLAUDE_PROJECT_DIR="$main" "$hook" 2>&1 >/dev/null)
  got=$?
  if [ "$got" -ne 2 ]; then echo "FAIL $name (期待 2、結果 ${got})"; fail=1
  elif ! cat "$tmp"/hook-logs/hooks-*.log 2>/dev/null | grep -q -F "gate=$gate"$'\t'; then echo "FAIL $name (ログにゲート $gate の行がない)"; fail=1
  elif [ -n "${5:-}" ] && ! grep -q -F "$5" <<< "$err"; then echo "FAIL $name (文がない: $5)"; fail=1
  else echo "ok   $name"; fi
}

# 止める: 記録の無い worktree の HEAD は、main で起動しても止まる
check 2 "main で起動し worktree で push（記録なし）" "$work" "git push -u origin HEAD"
check 2 "main で起動し main から git -C で worktree を push（記録なし）" "$main" "git -C $work push -u origin HEAD"
check 2 "main で起動し main から git -C で相対の worktree を push（記録なし）" "$tmp" "git -C work push -u origin HEAD"
check 2 "main で起動し cd で worktree に移って push（記録なし）" "$main" "cd $work && git push -u origin HEAD"
check 2 "main で起動し cd の相対パスで worktree に移って push（記録なし）" "$tmp" "cd work; git push -u origin HEAD"

# 通す: 記録がそろった worktree と、新しいコミットの無い main
mkdir -p "$main/.claude/ci" "$main/.claude/e2e" "$main/.claude/reviews"
jq -n --arg sha "$sha" '{sha: $sha, clean: true, passed: true, version: "0.0.0"}' > "$main/.claude/ci/$sha"
jq -n --arg sha "$sha" '{sha: $sha, clean: true, passed: true, version: "0.0.0", tests: {passed: 1, total: 1}}' > "$main/.claude/e2e/$sha"
check_gate "レビュー" "main で起動し worktree で push（合格記録なし、ゲートの行が残る）" "$work" "git push -u origin HEAD"
: > "$main/.claude/reviews/$sha"
# check_logged_pass <ゲート名> <名前> <hook 入力の cwd> <コマンド>: exit 0 で通り、ゲートの行が exit=0 でログに残ることを確かめる
check_logged_pass() {
  local gate=$1 name=$2 got
  rm -rf "$tmp/hook-logs"
  jq -n --arg cwd "$3" --arg c "$4" '{cwd: $cwd, tool_input: {command: $c}}' \
    | CLAUDE_PROJECT_DIR="$main" "$hook" >/dev/null 2>&1
  got=$?
  if [ "$got" -ne 0 ]; then echo "FAIL $name (期待 0、結果 ${got})"; fail=1
  elif ! cat "$tmp"/hook-logs/hooks-*.log 2>/dev/null | grep -q -E "gate=$gate"$'\t'"duration_ms=[0-9]+"$'\t'"exit=0"; then echo "FAIL $name (ログにゲート $gate の exit=0 の行がない)"; fail=1
  else echo "ok   $name"; fi
}
check_logged_pass "レビュー" "main で起動し worktree で push（記録あり、ゲートの行が exit=0 で残る）" "$work" "git push -u origin HEAD"
check_logged_pass "CI" "main で起動し worktree で push（CI・E2E の記録あり、CI のゲートの行が exit=0 で残る）" "$work" "git push -u origin HEAD"
check_logged_pass "E2E" "main で起動し worktree で push（CI・E2E の記録あり、E2E のゲートの行が exit=0 で残る）" "$work" "git push -u origin HEAD"
echo dirty > "$work/dirty.txt"
git -C "$work" add dirty.txt
check 2 "main で起動し worktree で push（記録あり、未コミットの変更あり）" "$work" "git push -u origin HEAD"
check_gate "作業ツリー" "未コミットの変更ありで push（ゲートの行が残る）" "$work" "git push -u origin HEAD" "コミットしていない変更があります"
check_gate "作業ツリー" "未コミットの変更ありで commit と push（別のコマンドにする文が出る）" "$work" "git commit -m x && git push -u origin HEAD" "commit と push を別のコマンドにしてください"
err=$(jq -n --arg cwd "$work" --arg c "git tag -a v0.0.1 -m v0.0.1 && git push origin v0.0.1" '{cwd: $cwd, tool_input: {command: $c}}' \
  | CLAUDE_PROJECT_DIR="$main" "$hook" 2>&1 >/dev/null)
got=$?
if [ "$got" -ne 2 ]; then echo "FAIL 未コミットの変更ありで tag と push（期待 2、結果 ${got})"; fail=1
elif grep -q -F "別のコマンドにしてください" <<< "$err"; then echo "FAIL 未コミットの変更ありで tag と push（tag に別のコマンドを求める文が出た）"; fail=1
else echo "ok   未コミットの変更ありで tag と push（別のコマンドにする文は出ない）"; fi
git -C "$work" reset -q dirty.txt
rm "$work/dirty.txt"

# リリース作業だけの新しいコミット: 合格記録も CI・E2E の記録もなくても通り、CI・E2E とレビューのゲートの行が exit=0 で残る（#931）
echo "## v0.0.1" > "$work/CHANGELOG.md"
git -C "$work" add CHANGELOG.md
git -C "$work" commit -q -m "release"
check_logged_pass "CI・E2E\\(記録なし、検査の読まないファイルだけ\\)" "リリース作業だけの新しいコミットで push（CI・E2E の記録なし、ゲートの行が exit=0 で残る）" "$work" "git push -u origin HEAD"
check_logged_pass "レビュー" "リリース作業だけの新しいコミットで push（合格記録なし、ゲートの行が exit=0 で残る）" "$work" "git push -u origin HEAD"
# 記録のあるコミットから HEAD までにリリース作業の外の変更があれば、CI と E2E の記録のない HEAD は止まる
echo change2 > "$work/change2.txt"
git -C "$work" add change2.txt
git -C "$work" commit -q -m "change2"
check_gate "CI・E2E" "リリース作業の外の変更を含む新しいコミットで push（CI・E2E の記録なし）" "$work" "git push -u origin HEAD" "CI の記録が無いか"
git -C "$work" reset -q --hard HEAD~1
# 記録のあるコミットが範囲になく、範囲の基点から HEAD までがリリース作業だけでも通る（基点はリモートにある）
git -C "$work" push -q -u origin HEAD 2>/dev/null || { echo "FAIL リモートへの push の準備"; fail=1; }
echo "## v0.0.2" > "$work/CHANGELOG.md"
git -C "$work" add CHANGELOG.md
git -C "$work" commit -q -m "release 2"
check_logged_pass "CI・E2E\\(記録なし、検査の読まないファイルだけ\\)" "範囲の基点からリリース作業だけの新しいコミットで push（範囲に記録なし）" "$work" "git push origin HEAD"
check 0 "main の checkout から push（新しいコミットなし）" "$main" "git push origin main"
check 0 "無関係なコマンド" "$work" "git status"

# 検査の読まないファイルだけの新しいコミット（#1502）: CI と E2E の記録がなくても通り、レビューの判定で止まる。読むファイルが 1 つでもあれば CI・E2E で止まる
work2="$tmp/work2"
git -C "$main" worktree add -q -b work2 "$work2" origin/main 2>/dev/null || { echo "FAIL work2 の準備"; fail=1; }
# mkcommit <パス>...: work2 を origin/main に戻し、渡したパスを書いて 1 つのコミットにする
mkcommit() {
  local p
  git -C "$work2" reset -q --hard origin/main
  git -C "$work2" clean -q -fd
  for p in "$@"; do mkdir -p "$work2/$(dirname "$p")"; echo "$RANDOM" > "$work2/$p"; done
  git -C "$work2" add -A
  git -C "$work2" commit -q -m "t"
}
# exempt <名前> <パス>...: CI・E2E のゲートは記録なしで exit=0 で通り、レビューの合格記録が無いので止まる
exempt() {
  local name=$1 err got; shift
  mkcommit "$@"
  rm -rf "$tmp/hook-logs"
  err=$(jq -n --arg cwd "$work2" --arg c "git push -u origin HEAD" '{cwd: $cwd, tool_input: {command: $c}}' \
    | CLAUDE_PROJECT_DIR="$main" "$hook" 2>&1 >/dev/null)
  got=$?
  if [ "$got" -ne 2 ]; then echo "FAIL $name (期待 2、結果 ${got})"; fail=1
  elif ! cat "$tmp"/hook-logs/hooks-*.log 2>/dev/null | grep -q -E "gate=CI・E2E\\(記録なし、検査の読まないファイルだけ\\)"$'\t'"duration_ms=[0-9]+"$'\t'"exit=0"; then echo "FAIL $name (CI・E2E の免除のゲートの行がない)"; fail=1
  elif ! grep -q -F "ゲート失敗: レビュー" <<< "$err"; then echo "FAIL $name (レビューで止まっていない: $err)"; fail=1
  else echo "ok   $name"; fi
}
# blocked <名前> <パス>...: CI・E2E のゲートで止まる
blocked() {
  local name=$1; shift
  mkcommit "$@"
  check_gate "CI・E2E" "$name" "$work2" "git push -u origin HEAD" "変更があります"
}
exempt ".claude/rules だけ（記録なし）" .claude/rules/r.md
exempt "requirements、AGENTS.md、src-tauri/AGENTS.md、.claude/tools/watch-ci.sh（記録なし）" requirements/m.md AGENTS.md src-tauri/AGENTS.md .claude/tools/watch-ci.sh
exempt ".claude/agents、.claude/evals、.claude/hooks、.claude/skills（記録なし）" .claude/agents/a.md .claude/evals/e.json .claude/hooks/h.sh .claude/skills/implement/SKILL.md
blocked ".claude/rules と ts/ が同じ差分（記録なし）" .claude/rules/r.md ts/a.ts
blocked "readme-product の shots（記録なし）" .claude/skills/readme-product/shots/s.ts
for t in run-ci.sh run-e2e.sh check-icons.sh; do
  blocked ".claude/tools/${t}（記録なし）" ".claude/tools/${t}"
done
# check-ci.sh、check-e2e.sh、ensure-deps.sh は、変えると別の自己テストのゲートが先に走るので、release-only-diff.sh --untested に直接かける
for t in check-ci.sh check-e2e.sh ensure-deps.sh; do
  mkcommit ".claude/tools/${t}"
  (cd "$work2" && "$main/.claude/tools/release-only-diff.sh" --untested origin/main HEAD >/dev/null 2>&1); got=$?
  [ "$got" -eq 1 ] && echo "ok   .claude/tools/${t} は免除されない" || { echo "FAIL .claude/tools/${t} は免除されない (期待 1、結果 ${got})"; fail=1; }
done
# README だけの差分は、今までどおりレビューも免除される
mkcommit README.md
check_logged_pass "レビュー" "README だけの新しいコミットで push（記録なし、レビューも免除）" "$work2" "git push -u origin HEAD"
# 記録のあるコードのコミットの上に、検査の読まないファイルだけのコミットを積むと、CI・E2E は通る（レビューは別）
mkcommit ts/a.ts
code=$(git -C "$work2" rev-parse HEAD)
jq -n --arg sha "$code" '{sha: $sha, clean: true, passed: true, version: "0.0.0"}' > "$main/.claude/ci/$code"
jq -n --arg sha "$code" '{sha: $sha, clean: true, passed: true, version: "0.0.0", tests: {passed: 1, total: 1}}' > "$main/.claude/e2e/$code"
mkdir -p "$work2/.claude/agents"
echo agents > "$work2/.claude/agents/a.md"
git -C "$work2" add -A
git -C "$work2" commit -q -m "agents"
: > "$main/.claude/reviews/$(git -C "$work2" rev-parse HEAD)"
check_logged_pass "CI・E2E\\(記録なし、検査の読まないファイルだけ\\)" "記録のあるコードのコミットの上に .claude/agents だけのコミット（記録なし）" "$work2" "git push -u origin HEAD"
# 記録のあるコミットの上に ts/ を含むコミットを積むと止まる
echo more > "$work2/ts/a.ts"
git -C "$work2" add -A
git -C "$work2" commit -q -m "ts"
check_gate "CI・E2E" "記録のあるコミットの上に ts/ を含むコミット（記録なし）" "$work2" "git push -u origin HEAD"
git -C "$work2" reset -q --hard origin/main

# release-only-diff.sh: 解決できない A は exit 2 になり、差分が空のまま通ることはない
rod="$main/.claude/tools/release-only-diff.sh"
for mode in "" "--untested"; do
  (cd "$work" && "$rod" $mode no-such-commit HEAD >/dev/null 2>&1); got=$?
  [ "$got" -eq 2 ] && echo "ok   解決できない A は exit 2（${mode:-既定}）" || { echo "FAIL 解決できない A は exit 2（${mode:-既定}）(結果 ${got})"; fail=1; }
  (cd "$work" && "$rod" $mode HEAD no-such-commit >/dev/null 2>&1); got=$?
  [ "$got" -eq 2 ] && echo "ok   解決できない B は exit 2（${mode:-既定}）" || { echo "FAIL 解決できない B は exit 2（${mode:-既定}）(結果 ${got})"; fail=1; }
done

# main の checkout の HEAD に記録が無ければ、従来どおり止まる
echo main-change > "$main/main-change.txt"
git -C "$main" add main-change.txt
git -C "$main" commit -q -m "main change"
check 2 "main の checkout で push（記録なし）" "$main" "git push origin main"
exit $fail
