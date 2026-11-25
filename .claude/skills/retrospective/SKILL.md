---
name: retrospective
description: Looks back on one つなぎAI run (what stopped, failed, was redone or waited, what the owner corrected, the review rounds, the flaky failures) and files one 「振り返り:」 issue for each cause in this project's skills and subagents, or comments on an open issue of the same cause. Runs at step 8 of `implement`, after the release and before the clean-up, and on /retrospective.
---

# retrospective

The lead runs it, because the events of the run are in its context (at the owner's instruction, 2026-11-21; #1213).
It looks at what happened in the run; `improvement-proposal` looks at the code and the logs as they stand, and is not repeated here.
Step 6 of a later `implement` run fixes its issues before the Release PR.

`guard-public.sh` is at `"$(git rev-parse --path-format=absolute --git-common-dir)/../.claude/hooks/"`.

## Steps

1. **List what happened** in the run: each stop, failure, redone work, wait, correction by the owner, review round after the first, and flaky failure. Back each with its evidence: `.claude/ci/{SHA}.log` and `.claude/e2e/{SHA}.log` of the main checkout, `logs/hooks-{YYYY-MM-DD}.log` (`exit=2` is a refusal), and the run's pull requests.
2. **Group them by cause.** One cause holds every event it explains. Keep a cause that lies in `.claude/skills/`, `.claude/agents/` or the `.claude/tools/` they run, and whose fix changes what the next run does. Drop the rest: a one-off from outside them (the network, the runner), and product code (`improvement-proposal`). A flaky failure already has its 「flaky:」 issue (`review.md`), and counts here only for how the run handled it. With no cause left, file nothing and go to step 5.
3. **Look for the same cause** in the open retrospective issues and proposals, the owner's only (`issues.md`): `gh issue list --state open --search "振り返り: in:title" --json number,title,author,body` and `gh issue list --state open --label proposal --json number,title,author,body`. A cause that one of them holds gets a comment there (`gh issue comment`) with this run's events and evidence, not a new issue.
4. **File the rest**, one issue for each cause, through `issue-plan` (`issues.md`: the evidence is its verification, the fix is its design, no prototype): the title 「振り返り: {要旨}」, the labels `importance:low`, `point:2` or `point:3` (never `point:5` or `point:8`), and `documentation` when the fix touches only `.claude/agents/`, `.claude/evals/`, `.claude/rules/` or `.claude/skills/`. The body, in plain Japanese: what happened, with the evidence as paths relative to the repository root; the cause; the fix, as what to cut or merge (`harness.md`); and the eval case to add to `.claude/evals/{name}.json`. A cause whose fix needs a design decision of the owner is not filed: it goes to the owner as a question in step 5 (at the owner's instruction, 2026-11-25).
   Pass each body, and each comment of step 3, through `guard-public.sh text` (stdin) before `gh`; when it refuses, post nothing and report the refusal.
5. **Report** the issues filed and the comments made, with their numbers, and the causes put to the owner as questions, or that there were none.

```text
Good: pre-git.sh refused two pushes for the same missing step -> one issue 「振り返り: …」 with both refusals, and nothing for a merge that failed once on the network
Good: the cause is already in an open 「振り返り:」 issue -> a comment there with this run's evidence
Bad:  one issue for each event, or an issue for a run where nothing went wrong
Bad:  an issue about a bug of `src-tauri/` (that is `improvement-proposal`'s)
```
