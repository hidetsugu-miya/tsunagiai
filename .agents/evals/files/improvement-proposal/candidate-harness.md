# improvement-proposal の候補（手順 6 まで終え、手順 7 で「AI が決める issue」に振り分けた）

`harness-scout` の候補を、リードが一次情報で確かめ済み。

- 題の案：implement の手順 5 の push の前に、CI と E2E の記録を確かめる
- 問題：`logs/hooks-2026-11-20.log` に、`pre-git.sh` が E2E の記録が無いと拒んだ行（`gate=E2E exit=2`）が 2 回ある。`.claude/skills/implement/SKILL.md` の手順 5 と 6.5 の「Push」に、記録が要ることが書かれていない。
- 方向：手順 5 と 6.5 に、push の前に `check-ci.sh` と `check-e2e.sh` を通す 1 文を足す（足す前に、近い 2 文を 1 つにまとめて行数は増やさない）。
- 計画：1. `.claude/skills/implement/SKILL.md` を直す。2. `.claude/evals/implement.json` に case を足す。ほかのファイルは触れない。
- 振り分けの理由：ゲートを強める直しで、オーナーが見るものも「オーナーの指示による」規則も変えない。
- ポイントの理由：1 つの skill と 1 つの eval だけを直す小さな直し。
