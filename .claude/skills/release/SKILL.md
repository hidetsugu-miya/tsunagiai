---
name: release
description: Prepares the つなぎAI Release PR (opens or updates `release/next` with the CHANGELOG and features entries, the photos and the body), merges it once its checks have passed, and sees the release through (the tag, the release run, the comments on the issues, the mark), by launching `release-preparer` and `release-watcher`. Use on 「Release PR を作って」「Release PR を更新して」「リリースを見届けて」, when `post-gh.sh` tells a session to do so after `gh pr merge`, and from step 7 of `implement`.
---

# release

Two procedures, each run by a subagent of its own (at the owner's instruction, 2026-11-22; #1258).
Procedure A prepares the Release PR when changes wait for the release, and merges it: `release-preparer` (Sonnet).
Procedure B sees the release of a merged Release PR through: `release-watcher` (Haiku).
The lead is the session that read this file. It launches the two agents, checks their returns and sorts a failed release run; it runs neither procedure itself.
The rules of both are in "Rules" at the end of this file.
Only a session prepares the Release PR, merges it and sees the release through, and it does not wait for the owner (at the owner's instruction, 2026-11-21; #1179: the night run is removed).
Tools are at `"$(git rev-parse --path-format=absolute --git-common-dir)/../.claude/tools/"`.

## Steps

### The lead

Give each launch the absolute path of the main checkout.

1. Launch `release-preparer`. Check its return, with `gh pr view {pr} --json state` for `merged`. On `merged`, `merge-refused` and `blocked`, when `unphotographed` is not empty, file an issue with `issue-plan` for each screen in it (label `documentation`; `readme-product`), then:
   - `merged`: go on to 2.
   - `nothing-to-prepare`: stop.
   - `in-use`: another session has `release/next` and is preparing the Release PR. Tell the owner and stop.
   - `merge-refused` and `blocked`: tell the owner the reason and stop, with the Release PR open. Merge by no other means (no `--admin`, no bypass of the ruleset).
2. Launch `release-watcher`, at once after a `merged`, and also for a `follow_up` or `tag_due` that `post-gh.sh` or `plan-release.py release` shows a session that did not merge. Check its return:
   - `released`: run `plan-release.py release` once. When it still prints a `follow_up` or `tag_due`, launch `release-watcher` again for it, and tell the owner if the same one is printed after that launch. Report the versions.
   - `nothing-left`: nothing is left from a merge.
   - `run-failed`: sort the cause yourself with `gh run view {run_id} --log-failed` ("After the Release PR is merged" in "Rules"), then launch `release-watcher` again after a rerun or a fix.
   - `no-run`: no run of the merge exists, and the run list it returns shows none for the merge: make the annotated tag by hand on `commit` and push it in the same command (`versioning.md`), then launch `release-watcher` again. Look at the run list first: a run in progress is the workflow tagging.
   - `error`: tell the owner what failed.

### A. Prepare the Release PR (release-preparer)

Always run `plan-release.py release` first. If `changes` is empty, there is nothing to prepare: return `nothing-to-prepare`. Otherwise take the worktree for `release/next` (`use-worktree.sh release/next`; on exit 3 another session has it checked out: touch nothing and return `in-use`) and do "Keep one Release PR open while changes wait" in "Rules":

- Take in main (`git merge origin/main`), write the entries of `CHANGELOG.md`, under the heading `## v{version}` (`version` of `release`, checked against `requirements/` for the digit; "Take the digit from the requirement IDs"), and of `docs/features.md`. Change no version line of the source: it is fixed (`versioning.md`). Read `README.md` against the changes that go out with `readme-product`, and fix it in `release/next` only when a photo or a claim is out of date. Change only `README.md` and `docs/` there: do not change the spec of the photos (`.claude/skills/readme-product/shots/`), because it is not release-only. When a photo cannot be taken because the spec does not fit the screen, take no photo of that screen, name it in the body as a screen that could not be photographed, and return it in `unphotographed`: the lead files the issue with `issue-plan` (`readme-product`). Commit the result.
- Run neither `run-ci.sh` nor `run-e2e.sh` on the HEAD of `release/next`: its diff is release-only, and `pre-git.sh` and `post-checks.sh` ask no CI, E2E or pass record for it (`testing.md`, `review.md`; #931). Push, and run `post-checks.sh`.
- Open the pull request (`gh pr create`, title `release: v{version}`), or update the open one (`gh pr edit`). The body lists the changes (the issues, with their points), the digit and why, and whether `README.md` needed anything. It holds no decision to release.
- Show the screens that the changes touch: put the photo of each such screen, `docs/assets/readme/{name}.png` at the pushed HEAD of `release/next`, in the body or in a comment, linked by the raw URL of that HEAD's SHA ("Keep one Release PR open while changes wait"). Take no photo here: the first item retook, inside the commit, those that were out of date, and the others already show the screen. Name a touched screen, and what changed in it, when no photo shows the change, and say so when the changes touch no screen.
- Merge it as soon as `post-checks.sh` has sent its statuses and the items above are done, whether or not `urgent` is true (at the owner's instruction, 2026-11-21): `gh pr merge {number} --merge`, then `git fetch origin main` and `git -C "$main" merge --ff-only origin/main`, then `use-worktree.sh --park` from inside the worktree of `release/next`, so that the next preparer can take it (`worktree.md`). Send no notification.
  - When the merge is refused (a status that the ruleset requires is missing, the branch does not contain main, anything else), merge by no other means, stop with the Release PR open, and return `merge-refused` with the reason.

### B. See the merged Release PR through (release-watcher)

The merge has started the release by itself: `release.yml` tags the merge commit and builds ("After the Release PR is merged" in "Rules"). Run `git fetch origin main` and `plan-release.py release` (an output printed earlier may be stale). `follow_up` (the tag exists, the Release PR has no mark) and `tag_due` (no tag) say what is left; when neither is printed, return `nothing-left`.

- `tag_due`: run `watch-ci.sh {tag_due.commit}`, which waits up to 2 minutes for the run of the merge to appear and then for its end. When it says that no run was found, return `no-run` with `commit` and the output of `gh run list --workflow release.yml --event pull_request --branch release/next --limit 5`. When the run ends in success, run `plan-release.py release` again, which prints `follow_up`.
- `follow_up`: run `watch-ci.sh {follow_up.commit}` until it ends (`review.md`).
- When a run ends in failure, return `run-failed` with `run_id` and the last 40 lines of the output of `watch-ci.sh`, and stop: no rerun, no tag, no search for the cause.
- When the release job has succeeded: run `plan-release.py close`; comment `{follow_up.tag} で対応しました` on each issue listed in the body of the Release PR (`gh pr view {follow_up.pr} --json body`); then comment `<!-- released {follow_up.tag} -->` on the Release PR (`gh pr comment {follow_up.pr}`), which closes `follow_up`.

The tag comes first because what waits is counted from the last tag.

## Rules

### Keep one Release PR open while changes wait, and merge it in the session that prepared it

The agents prepare the Release PR, and the merge tags and releases it by itself (`release.yml`; at the owner's instruction, 2026-11-09; #303). The session that prepared it merges it as soon as its checks have passed, and sees the release through; it does not wait for the owner (at the owner's instruction, 2026-11-21). No schedule merges it (at the owner's instruction, 2026-11-21; #1179).
The `tag` job of `release.yml` goes on only for a merge by the repository's owner (`merged_by.login`), and the `gh` of a session runs under the owner's account, so the merge of a session starts the release as the owner's own merge does. `release.yml` stays as it is.
`plan-release.py release` says what waits (`changes`: merged and not released, a change that is only documentation, `.claude/agents/`, `.claude/evals/`, `.claude/rules/` or `.claude/skills/` not counted), whether the Release PR exists, and the version it writes (the first heading of `CHANGELOG.md`; the source holds no version, `versioning.md`).
An `implement` run launches the preparer after it has merged its own pull request and the fix of left review Lows, flaky tests and retrospectives (step 7 of `implement`), and a session does when the owner asks:
- Changes wait and there is no Release PR: open it from the branch `release/next`, with a commit that writes the entries of `CHANGELOG.md` under the heading `## v{version}` and of `docs/features.md` (`versioning.md`).
- Changes wait and the Release PR is open: bring its branch up to date with main, correct the heading `## v{version}` of `CHANGELOG.md` (the digit may have changed), write the entries of the new changes in `CHANGELOG.md` and `docs/features.md`, and update the body.
- Nothing waits: nothing to do.

Its title is `release: v{version}`, and its body holds the changes, the digit and why, and whether `README.md` needed anything.
The Release PR shows the screens that its changes touch, as photos in its body or in a comment, so that the owner sees the result of the changes (at the owner's instruction, 2026-11-13). The photos are the ones `readme-product` takes from the mocked E2E build with made-up data, the files of `docs/assets/readme/` at the pushed HEAD of `release/next` (the preparer retakes, inside the commit, only those out of date), linked by the raw URL of the commit that holds them (`https://raw.githubusercontent.com/{owner}/{repo}/{commit SHA}/docs/assets/readme/{name}.png`), never a photo of the real app, because the repository is public (`publishing.md`). A screen that the changes touch, where no photo shows the change (a settings tab, a dialog, a part that no photo has), is named in the body with what changed in it. A Release PR whose changes touch no screen has no photo, and its body says so.
`urgent` of `plan-release.py release` changes nothing here: the preparer merges every Release PR as soon as it is ready (at the owner's instruction, 2026-11-21).
Merged Release PRs are the release history.

```text
変更: #21 Slack の書式を表示する  point:3  (closes #12)
版:   minor（要件 ID S-12 が増えた）
README: 直すところなし
```

```text
Good: an `implement` run merged its pull request, and `release` lists 2 changes and no Release PR -> release-preparer opens release/next, pushes, runs `post-checks.sh` and merges it, and release-watcher sees the release through
Good: a waiting bug has importance:high -> the Release PR is merged like any other, with no notification
Good: the merge is refused because a status is missing -> the lead tells the owner the reason and stops, with the Release PR open
Bad:  the session ends with the Release PR ready and waits for the owner to merge it
Bad:  the merge is refused, and the session retries with `--admin`
Bad:  the body of the Release PR says "wait" or "release now" (there is no such decision to write)
Bad:  release-watcher reruns a failed run, or tags by hand (the lead sorts the cause)
```

### Take the digit from the requirement IDs

Raise the minor when `requirements/` has a requirement ID that the last tag does not, and the patch otherwise (`versioning.md`).
`plan-release.py release` prints `version` from the `adds:requirement` labels of the waiting changes: check it against `requirements/` before it goes in the Release PR, and correct the label when they disagree.
The `enhancement` label does not decide it: #9 was an enhancement and went out as v0.31.1.

```text
Good: S-12 is new since v0.32.0 -> v0.33.0
Bad:  the issue says enhancement -> minor
```

### After the Release PR is merged, the workflow tags and releases it, and an agent sees it through

The merge of a pull request from `release/next` starts `release.yml`: its `tag` job reads the first `## v{version}` heading of `CHANGELOG.md` at the merge commit, checks the version as for a pushed tag, and pushes the annotated tag on the merge commit, and its `release` job builds and publishes in the same run (at the owner's instruction, 2026-11-09; #303). No agent tags by hand when it works. The version is the heading that the preparer wrote before the merge; no version line of the source changes (`versioning.md`; Discussion #293).
Procedure B sees it through (the `follow_up` mark stays open until its last step, because the workflow tags at the merge and no agent is there to see it; at the owner's instruction, 2026-11-09; #303). A tag made by hand is followed up the same way.
The lead sorts a failed or missing run, which needs a judgment that `release-watcher` does not make:
- A run that failed in the `tag` job is a finding about the Release PR (a version that is not the heading, a source version that is not fixed, a commit that is not on main): tell the owner; do not tag by hand over a failed check. A failure of the runner or the network is retried like the one below.
- A run that failed in the `release` job after the tag was pushed: find the cause with `gh run view {run ID} --log-failed`. A failure of the runner or the network (nothing in the commit) is retried with `gh run rerun {run ID} --failed`; the rerun builds the tag that is already on the merge commit. Any other cause is told to the owner and fixed with the next patch version (`review.md`), and a published tag is never moved (`versioning.md`).
- Where no run of the merge exists (the workflow was off, or the run was lost; right after the merge, a run that is not yet listed is not a missing run, and `watch-ci.sh` waits for it), make the annotated tag by hand on the commit `tag_due` names and push it (`versioning.md`); the push starts the `release` run, and the workflow tags nothing that already has a tag.

```text
Good: the preparer merges -> the workflow tags v0.33.0 and releases -> the watcher sees `follow_up`, watch-ci.sh succeeds -> close -> "v0.33.0 で対応しました" on each issue -> the mark on the Release PR
Good: the watcher returns `no-run` and the run list shows none for the merge -> the lead tags by hand on the commit `tag_due` names, pushes, and launches the watcher again
Good: the watcher returns `run-failed` with a runner error in the log -> the lead runs `gh run rerun {run ID} --failed` and launches the watcher again
Bad:  comment on the issues before the release run has succeeded
Bad:  comment on the issues and leave no mark, so that the next run comments on them again
Bad:  tag origin/main by hand after another pull request has merged on top of the Release PR (the tag goes on the commit that tag_due names)
Bad:  tag by hand at once when tag_due is printed, while the run of the merge is still going (it tags in a minute)
```
