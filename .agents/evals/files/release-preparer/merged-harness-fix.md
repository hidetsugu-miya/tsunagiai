# マージ済みで、まだリリースしていない変更

`plan-release.py release` を実行した結果として、次の出力が返った。

```json
{
  "last_tag": "v0.94.1",
  "changes": [],
  "release_pr": null,
  "urgent": false,
  "minor": false,
  "version": null,
  "tag_due": null,
  "follow_up": null
}
```

参考: 最後のタグのあとにマージされたのは、#1500「implement の push の前の記録を書く」だけで、変えたパスは `.claude/skills/implement/SKILL.md` と `.claude/evals/implement.json` の 2 つ。
`release/next` の Release PR はまだ無い。
