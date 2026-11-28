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
  if [ -d "$here/../../.git" ]; then
    target="$here/$script"
  else
    common="$(git -C "$here" rev-parse --path-format=absolute --git-common-dir 2>/dev/null)" || common=""
    if [ -n "$common" ] && [ -x "$common/../.agents/hooks/$script" ]; then
      target="$common/../.agents/hooks/$script"
    else
      target="$here/$script"
    fi
  fi
fi

# Extract metadata and translate Antigravity stdin JSON to Claude Code stdin JSON in a single jq call.
{
  IFS= read -r project_dir
  IFS= read -r transcript_path
  IFS= read -r agent_type
  IFS= read -r translated
} < <(jq -r '
  (.toolCall.name // "") as $name |
  (.toolCall.args // {}) as $args |
  (.workspacePaths[0] // .cwd // ""),
  (.transcriptPath // ""),
  (.agentType // .agent_type // ""),
  ({
    cwd: (.cwd // ""),
    agent_type: (.agentType // .agent_type // ""),
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
  } | tojson)
' <<< "$input")

# Antigravity PreToolUse payloads do not include agent_type. For guard-review.sh, identify a
# release-verifier subagent from step 0 of its transcript (a lead session has source=USER_EXPLICIT,
# whereas a subagent starts with a SYSTEM_MESSAGE delivered by the parent).
if [ "$script" = "guard-review.sh" ] && [ -z "$agent_type" ] && [ -n "$transcript_path" ] && [ -r "$transcript_path" ]; then
  if head -n 1 "$transcript_path" | jq -e '
    .step_index == 0
    and .source == "SYSTEM"
    and .type == "SYSTEM_MESSAGE"
    and ((.content // "") | test("\\[Message\\] timestamp=[^ ]+ sender=[^ ]+ priority=[^ ]+ content=You are `?release-verifier`?"))
  ' >/dev/null 2>&1; then
    translated=$(jq -c '.agent_type = "release-verifier"' <<< "$translated")
  fi
fi

err=$(CLAUDE_PROJECT_DIR="${project_dir:-$PWD}" "$target" <<< "$translated" 2>&1 >/dev/null)
rc=$?

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
