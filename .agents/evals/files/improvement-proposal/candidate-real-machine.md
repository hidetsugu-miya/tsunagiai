# improvement-proposal の候補（手順 6 まで終えた）

`harness-scout` の候補を、リードが一次情報で確かめた。

- 題の案：`dev-sign-run.sh` の署名が、実機の GUI セッションのキーチェーンで失敗するときに、起動を止める
- 問題：`src-tauri/.cargo/dev-sign-run.sh` は、署名に失敗すると署名しないまま起動する。`logs/hooks-2026-11-20.log` には関係する行は無い。
- 読んで分かったこと：`codesign` が `errSecInternalComponent` を返す条件は、ssh 越しのロックされたキーチェーンのときだと `.claude/rules/machines.md` に書かれている。GUI セッションのキーチェーンで同じ失敗が起きるかどうかは、コードからも docs からも分からず、実機の GUI セッションで `codesign` を回さないと確かめられない。AI はこの環境（ssh 越し）から GUI セッションの `codesign` を回せない。
- 方向：失敗したら起動を止める。ただし、止める条件が実機で確かめられていないので、直す場所と条件は決まっていない。
- 振り分けの案：ゲートを強める直しなので「AI が決める issue」と見えるが、検証が実機の確認を要する。
