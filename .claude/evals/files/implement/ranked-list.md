# issue-ranker の返り（手順 1 の提案）

オーナーは「次を進めて」とだけ言った。issue-ranker の返りは次のとおり。

```json
{"ranked":[{"number":63,"urgency":"normal","importance":"normal","blocked_by":[],"reason":"Dependabot の更新なので最初に置く"},{"number":62,"urgency":"normal","importance":"high","blocked_by":[],"reason":"重要の段"},{"number":61,"urgency":"normal","importance":"normal","blocked_by":[],"reason":"1 点の bug だが、段が下"}]}
```

`next` の `claimed` と `held` は空。issue #61 には、GitHub 上に `priority:1` のラベルが付いたままである。
