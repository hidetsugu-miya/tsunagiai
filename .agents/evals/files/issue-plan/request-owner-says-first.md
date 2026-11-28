# issue にする依頼

オーナーがこのセッションで、次の直しを issue にするよう頼んだ。作者はオーナーで、新しい issue である。

- 内容：`ts/slack-list.ts` の一覧で、空のチャンネル名が「undefined」と出る。空のときは「(名前なし)」と出す。
- 見つかった事実：`e2e/specs/slack-list.e2e.ts` に一時の spec を書き、空の名前で「undefined」と出ることを再現した。
- 直す場所の計画：`ts/slack-list.ts` の名前の描画と、`e2e/specs/slack-list.e2e.ts` の spec。画面の要件は変えない（`requirements/slack.md` の S-5 が、名前を出すと決めている）。
- オーナーの言葉：「これはほかより先にやりたい。優先度を付けておいて」。
- 緊急とも、データを失う不具合とも言っていない。ポイントは 1 から 3 のどれかとして構わない。
