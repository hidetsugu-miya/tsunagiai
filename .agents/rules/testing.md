# Testing rules

## Layers

### Split checks into static, unit and E2E, and never check the same thing in two layers

| Layer | What it checks | Tools | What it does not check |
|-------|----------------|-------|------------------------|
| Static | Format, lint, types, Rust-TS type match, fixed source version, where the shape of an icon is written | cargo fmt, clippy, Biome (lint only), tsc, bindings diff, `scripts/check-version.sh`, `.agents/tools/check-icons.sh` | Behavior |
| Unit | Pure Rust logic (parsing API responses, validating input, computing dates, IDs and URLs, converting errors) | cargo test | Screens, WebView |
| E2E | Screen behavior (how command results are drawn, the commands and arguments an operation calls, how errors show) | WebdriverIO (real WKWebView, commands mocked) | Processing inside Rust |

When layers overlap, the same failure shows up twice and nobody knows where to fix it.
Unit tests own everything behind the E2E mock, and E2E owns everything in front of it.

```text
Good: put date computation in a Rust function and check it with cargo test
Good: check that pressing a list row calls archive with E2E
Bad:  check the result of a date computation from the text on the screen in E2E
```

### Put only drawing and operation in the frontend TS, and turn logic you want to test into a pure Rust function

We have no unit-test tool for TS. If logic that needs a test lives in TS, move it to Rust and check it with cargo test.
Testing pure TS would need one more tool and one more layer, and it would blur the line with E2E.

```text
Good: the deadline decision is a Rust function, and TS only draws the result
Bad:  write the deadline decision in TS and add a unit-test tool
```

### Let types own the shape at the Rust-TS boundary, and do not test it

For return structs, ts-rs writes the types to `ts/bindings/`, and tsc checks how TS uses them. The bindings diff before a push fails if the committed types are stale.
A test of the shape itself would duplicate the types and add a place to fix every time a struct changes.

```rust
// Good: the shape is the struct's; nothing tests it
#[derive(Serialize, TS)]
#[ts(export, export_to = crate::BINDINGS)]
struct Item { id: String }
```

### Do not write tests that touch a real external service, the keychain or the settings folder

Unit tests use pure functions and a local `TcpListener` (`rust.md`), and E2E uses command mocks and a separate identifier (`e2e.md`). That is enough.
If a test touches the owner's account or tokens, every run changes real data.

```text
Good: use the JSON of a Gmail response as the input to parse
Bad:  call the real Gmail API from a test
```

## Before a push and CI

### Run every check on this machine before a push, and run no check in GitHub Actions

`.github/workflows/release.yml` runs only on a pushed tag `v*` and on the merge of the Release PR (a closed pull request from `release/next`; at the owner's instruction, 2026-11-09; #303). Its job `tag` checks that the source version is still the fixed one, that the tag has the form `v0.{minor}.{patch}` and is the first `## v{version}` heading of `CHANGELOG.md`, and that the commit is on main, and, for the merge, pushes the annotated tag on the merge commit; its job `release` builds the app with the version of the tag, and puts the signed `.app`, its updater files and `latest.json` in a GitHub Release (U-1).
A pull request runs no check of ours (closing one starts `release.yml`, which does nothing unless it is the merged Release PR), and a push to main that changes the dependencies, the Rust version or `docs/` runs none that checks anything (at the owner's instruction, 2026-11-04: the same checks already ran before the push, and running them again cost time).
The two workflows of such a push are `rust-cache.yml`, which only builds the Rust dependencies to fill the cache that `release` restores (at the owner's instruction, 2026-11-08; #248), and `pages.yml`, which builds `docs/` and deploys it to GitHub Pages.
Before a push, `.agents/tools/run-ci.sh` runs the version check (the source version is the fixed value), tsc (`ts`, `e2e` and the spec of the README photos, `.agents/skills/readme-product/shots/tsconfig.json`), `check-icons.sh` (the shape of an icon is written only in `ts/icons.ts`, `frontend.md`), Biome, cargo fmt, clippy, cargo test and the bindings diff, and writes a record for HEAD to `.claude/ci/{HEAD SHA}` in the main checkout. It runs on a clean working tree only, and only it can write the record (`guard-e2e.sh`). `run-e2e.sh` calls it after `e2e:build`, beside the wdio run, when HEAD has no passing CI record (`review.md`; #420), so no CI run waits before E2E. Neither is run when `check-records.sh` passes (below).
`pre-git.sh` runs none of these checks. It does run the self-tests of the hooks and tools the pushed range touches, on the checkout's own copy (at the owner's instruction, 2026-11-09; #255): `.agents/tools/check-guard-e2e.sh` when the range touches `.agents/hooks/guard-e2e.sh`, `.agents/hooks/hook-log.sh` or that script, `.agents/tools/check-pre-git.sh` when it touches `.agents/hooks/pre-git.sh`, `.agents/hooks/hook-log.sh`, that script, `.agents/tools/check-ci.sh`, `.agents/tools/check-e2e.sh`, `.agents/tools/check-records.sh` or `.agents/tools/release-only-diff.sh`, `.agents/tools/check-range-check.sh` when it touches `.agents/tools/range-check.sh`, `.agents/hooks/record-review.sh`, that script, `.agents/tools/check-ci.sh`, `.agents/tools/check-e2e.sh`, `.agents/tools/check-records.sh` or `.agents/tools/release-only-diff.sh` (#932), and `python3 -I .agents/tools/plan-release-test.py` when it touches `.agents/tools/plan-release*.py`, `.agents/tools/use-worktree.sh`, `.agents/tools/ensure-deps.sh` or `.agents/hooks/post-gh.sh` (the test runs those three too). The checkout it checks is the one the command runs in (the `cwd` of the hook input, moved by a leading `cd DIR &&` or `cd DIR;` and by the place of `git -C`; #310), so a push from a worktree is checked at the worktree's HEAD whichever checkout the session started in, and the records are read from the main checkout. If there are new commits, it checks CI and E2E through `check-records.sh` (below) and the review pass record (`review.md`) for HEAD through the pass file; a push with no new commit (a tag on a commit already on the remote) needs none of them. `.agents/tools/check-records.sh [base]` decides CI and E2E (`pre-git.sh`, `range-check.sh`, `post-checks.sh` and release-verifier call it; at the owner's instruction, 2026-11-27; #1502, which widens #931 of 2026-11-18). It passes when HEAD has both passing records, or when the diff from the newest commit of the range that has both (or else the base, which passed this gate when it reached the remote) to HEAD holds only files that no check reads (`release-only-diff.sh --untested`), and it then prints `CI: 不要（…）` and `E2E: 不要（…）`. When it passes, run neither `run-ci.sh` nor `run-e2e.sh`: so the commits of the Release PR run neither, and neither does a branch that changes only rules, requirements or skills. The files no check reads are `README.md`, `CHANGELOG.md`, `docs/`, `AGENTS.md`, `CLAUDE.md`, `src-tauri/AGENTS.md`, `src-tauri/CLAUDE.md`, `requirements/`, `.agents/rules/`, `.agents/agents/`, `.agents/evals/`, `.agents/hooks/` (the self-tests of a hook run in `pre-git.sh` as above), `.agents/skills/` except `.agents/skills/readme-product/shots/` (tsc reads it) and `.agents/tools/` except `run-ci.sh`, `run-e2e.sh`, `check-ci.sh`, `check-e2e.sh`, `ensure-deps.sh` and `check-icons.sh` (the checks, or what they call). Every other path, `ts/`, `e2e/`, `src/`, `src-tauri/`, `scripts/` and the config files included, needs the records. This frees CI and E2E only, never the review: the pass record is still needed, except for the release-only commits of `review.md`.
`post-checks.sh` checks CI and E2E the same way, with `origin/main` as the base, and then sends the E2E and review results to GitHub as the statuses `e2e` and `review`, which the ruleset on main requires (`issues.md`); no workflow runs for them. It sends `e2e` when the check is exempt too, and its description says so. It then waits, up to 30 seconds, until the open pull request of HEAD's branch is no longer `BLOCKED`, so the `gh pr merge` that follows is not refused before GitHub has taken the statuses in (#1416); with no pull request it does not wait.
These checks run only on macOS; nothing checks Windows.

```text
Good: commit -> run-e2e.sh (its run-ci.sh beside wdio) and the reviewers together -> release-verifier -> push (pre-git.sh checks the records) -> post-checks.sh -> merge
Bad:  add a static, test or e2e job to the workflow
Good: release/next writes CHANGELOG -> push (the diff from the base is release-only, so no record is asked) -> gh pr create -> post-checks.sh
Good: a branch changes only `.agents/rules/` and `requirements/` -> check-records.sh passes -> no run-ci.sh and no run-e2e.sh -> the reviewers and release-verifier -> push
Bad:  a diff of `.agents/tools/run-e2e.sh` or `ts/` -> skip run-e2e.sh because most of `.claude/` needs none
Bad:  write a CI record by hand, or run the checks inside pre-git.sh again
```
