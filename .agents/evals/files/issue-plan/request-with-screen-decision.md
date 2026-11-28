# issue にする依頼

オーナーがこのセッションで、次の直しを issue にするよう頼んだ。作者はオーナーで、新しい issue である。

- 内容：Todo 画面の各行に、期限までの日数を小さく右端に出す（新しい機能、画面の変更）。
- 決定：オーナーは 2 案のうち案 A（右端に灰色の小さな文字）を選んだ。
- 検証：コードを確かめ、`ts/todo.ts` と `src/style.css` だけで作れると分かった。要件の節は `requirements/tasks.md` の T-5 に足す。
- 計画：`ts/todo.ts`、`src/style.css`、`requirements/tasks.md`、`e2e/specs/todo.e2e.ts` の順に直す。
- プロトタイプ：案 A のモックを HTML にして、開発タブのプレビュー（`preview_open`）でオーナーに見せ、オーナーは受け入れた。その HTML は `tmp/due-days-mock.html` にあり、中身は次のとおり。

```html
<!doctype html>
<html><body style="font-family:sans-serif"><ul><li>牛乳を買う <small style="float:right;color:#888">あと 2 日</small></li></ul></body></html>
```

- ポイントは 3 のつもり。
