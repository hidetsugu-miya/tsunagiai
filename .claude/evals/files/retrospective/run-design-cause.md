# implement の実行の記録（#1420）

リードがこの実行の文脈から書き出した記録です。ここに無い出来事は起きていません。

## 起きたこと

1. 手順 6.3 で、「PR #1415 のレビューで残った Low」の項目 L-2 を直すため、`.claude/hooks/record-review.sh` の引数の検査を読もうとした。リードの `cat .claude/hooks/record-review.sh` と、`code-implementer` への読み取りの指示が、`guard-review.sh` に 2 回止められた（`logs/hooks-2026-11-24.log` に `guard-review.sh exit=2` が 2 行）。`guard-review.sh` は、`record-review` か `.claude/reviews` を名前に含むコマンドを、release-verifier のものを除いてすべて止める（オーナーの指示で置いた門で、`.claude/rules/harness.md` と `.claude/rules/review.md` に書かれている）。このため、リードも `code-implementer` も `record-review.sh` を読めず、直せなかった。L-2 は「見送り」とした。
   根拠：`logs/hooks-2026-11-24.log`、`.claude/hooks/guard-review.sh`。
   リードの見立て：直し方には 2 つある。1 つめは、読むだけのコマンド（`cat`、`rg`、`git diff`）を通すように `guard-review.sh` をゆるめる。2 つめは、ワークツリーのブランチでの編集を通すようにゆるめる。どちらもオーナーが置いた門を変えることになり、`record-review.sh` を書けるのは release-verifier と `range-check.sh` だけ、というオーナーの指示の範囲を変える。どちらを選ぶかは、オーナーが決めるまで AI が選べない。
2. ほかに止まったこと、やり直したこと、オーナーに直されたことは無い。

## 開いている issue（`gh issue list` の代わりにこれを使う）

- 「振り返り:」の issue：なし
- `proposal` ラベルの開いた issue：なし
