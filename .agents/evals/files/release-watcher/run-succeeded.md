# 手順 B の途中の記録

`git fetch origin main` のあとの `plan-release.py release` の出力（抜粋）:

```json
{
  "last_tag": "v0.95.0",
  "changes": [],
  "tag_due": null,
  "follow_up": {"tag": "v0.95.0", "commit": "4f2a9c1d7e3b5a60812c4d9e1f7b3a5c6d8e0f12", "pr": 1510}
}
```

`watch-ci.sh 4f2a9c1d7e3b5a60812c4d9e1f7b3a5c6d8e0f12` の出力と終了コード 0:

```text
成功: release release/next (9876543211)
```

`plan-release.py close` は何も出力しなかった。

`gh pr view 1510 --json body` の本文（抜粋）:

```text
変更:
- #1501 Slack の返信を数える  point:2
- #1502 一覧のスクロールを保つ  point:1
版: patch（要件 ID は増えていない）
README: 直すところなし
```
