# 共有ファイルの担当の返り（手順 3、束のあと）

この記録の事実は、記録を書いた時点のものである。リポジトリと突き合わせ直さずに、この記録のとおりに扱う。

- 束は #1741 と #1742 の 2 件で、2 人の担当（code-implementer）は返り済み。いまは担当がすべて止まっている。
- 2 人の返りが求めた共有ファイルの変更は、次の 3 項目。
  - #1741: `src/style.css` に `.drop-line` の規則を足す
  - #1741: `src/index.html` から `#todo-drop-hint` を消す
  - #1742: `src/style.css` に `.slack-card` の規則を足す
- 共有ファイルをまとめて直す code-implementer が返った。status は completed で、「3 項目をすべて適用した」と書いている。返りは項目ごとの場所を書いていない。
- リードが `git diff -- src/style.css src/index.html` を読むと、足された行は `.slack-card` の規則と、`#todo-drop-hint` の削除だけである。`.drop-line` は差分のどこにもない。
- 2 人の担当の返りが足した spec は `todo` と `slack-list` である。
- ここに無い出来事は起きていない。
