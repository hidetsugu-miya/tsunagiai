#!/usr/bin/env bash
# Antigravity lifecycle hook adapter: translates Antigravity's camelCase stdin/stdout JSON contract
# to the Claude Code hook contract used by .agents/hooks/*.sh, and runs the main checkout's copy of the hook.
# Usage: agy-adapter.sh <PreToolUse|PostToolUse|SessionStart> <hook-script-name>
set -uo pipefail

event=${1:?event}
script=${2:?script}
input=$(cat)

# Resolve the target hook script in the main checkout (like .claude/settings.local.json),
# with TSUNAGIAI_HOOKS_DIR override for self-tests.
if [ -n "${TSUNAGIAI_HOOKS_DIR:-}" ]; then
  target="$TSUNAGIAI_HOOKS_DIR/$script"
else
  here="$(cd "$(dirname "$0")" && pwd)"
  common="$(git -C "$here" rev-parse --path-format=absolute --git-common-dir 2>/dev/null)" || common=""
  if [ -n "$common" ] && [ -x "$common/../.agents/hooks/$script" ]; then
    target="$common/../.agents/hooks/$script"
  else
    target="$here/$script"
  fi
fi

# Extract project dir and translate Antigravity stdin JSON to Claude Code stdin JSON.
project_dir=$(jq -r '.workspacePaths[0] // .cwd // empty' <<< "$input")
translated=$(jq -c '
  (.toolCall.name // "") as $name |
  (.toolCall.args // {}) as $args |
  {
    cwd: (.cwd // ""),
    tool_name: (
      if $name == "run_command" then "Bash"
      elif $name == "write_file" then "Write"
      elif $name == "edit_file" then "Edit"
      else $name
      end
    ),
    tool_input: (
      if $name == "run_command" then {command: ($args.CommandLine // "")}
      elif $name == "write_file" then {file_path: ($args.Path // ""), content: ($args.Content // "")}
      elif $name == "edit_file" then {file_path: ($args.Path // ""), old_string: ($args.Target // ""), new_string: ($args.Replacement // "")}
      else $args
      end
    )
  }
' <<< "$input")

err_file=$(mktemp) || exit 1
trap 'rm -f "$err_file"' EXIT

CLAUDE_PROJECT_DIR="${project_dir:-$PWD}" "$target" <<< "$translated" >/dev/null 2>"$err_file"
rc=$?
err=$(cat "$err_file")

case "$event" in
  PreToolUse)
    if [ "$rc" -eq 0 ]; then
      printf '{"decision":"allow"}\n'
    else
      jq -nc --arg r "${err:-Blocked by $script}" '{decision: "deny", reason: $r}'
    fi
    exit 0
    ;;
  PostToolUse)
    [ -n "$err" ] && printf '%s\n' "$err" >&2
    printf '{}\n'
    exit "$rc"
    ;;
  SessionStart)
    [ -n "$err" ] && printf '%s\n' "$err" >&2
    printf '{}\n'
    exit 0
    ;;
  *)
    echo "Unknown hook event: $event" >&2
    exit 64
    ;;
esac
