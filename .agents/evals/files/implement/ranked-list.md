# 手順 1 の記録

オーナーは「次を進めて」とだけ言った。

`plan-release.py snapshot` の出力（抜粋）:

```json
[{"number":63,"title":"serde 1.0.200 to 1.0.210","labels":["dependencies","point:2"],"points":2},{"number":62,"title":"Slack 一覧の未読を数え直す","labels":["importance:high","point:3"],"points":3},{"number":61,"title":"受信一覧の件名が切れる","labels":["bug","point:1"],"points":1}]
```

issue-ranker の返り:

```json
{"ranked":[{"number":63,"urgency":"normal","importance":"normal","blocked_by":[],"reason":"Dependabot の更新なので最初に置く"},{"number":62,"urgency":"normal","importance":"high","blocked_by":[],"reason":"重要の段"},{"number":61,"urgency":"normal","importance":"normal","blocked_by":[],"reason":"1 点の bug だが、段が下"}]}
```

`next` の `claimed` と `held` は空。
