# 手順 B の途中の記録

`git fetch origin main` のあとの `plan-release.py release` の出力（抜粋）:

```json
{
  "last_tag": "v0.94.1",
  "changes": [],
  "tag_due": null,
  "follow_up": {"tag": "v0.95.0", "commit": "4f2a9c1d7e3b5a60812c4d9e1f7b3a5c6d8e0f12", "pr": 1510}
}
```

`watch-ci.sh 4f2a9c1d7e3b5a60812c4d9e1f7b3a5c6d8e0f12` の出力と終了コード 1:

```text
失敗: release release/next (9876543210)
release	Set up job	2026-11-22T02:01:10Z	##[error]The runner has received a shutdown signal. This can happen when the runner service is stopped, or a manually started runner is canceled.
release	Set up job	2026-11-22T02:01:11Z	##[error]The operation was canceled.
```
