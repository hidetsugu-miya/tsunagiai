#!/usr/bin/env bash
# A fresh worktree has no node_modules, and the main checkout's can be older than package-lock.json; `npx tauri` needs them.
. "$(cd "$(dirname "$0")" && pwd)/hook-log.sh"
hook_log_begin
cd "${CLAUDE_PROJECT_DIR:?}" || exit 0
# clean-target.sh runs detached, with its output dropped, so the session does not wait for it; it writes its own log.
"$(cd "$(dirname "$0")/../tools" && pwd)/clean-target.sh" >/dev/null 2>&1 </dev/null &
"$(cd "$(dirname "$0")/../tools" && pwd)/ensure-deps.sh" . >&2 || echo "npm ci に失敗しました" >&2
exit 0
