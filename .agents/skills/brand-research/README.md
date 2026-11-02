# Brand Research の使い方

会社名とURLをチャットで渡し、ブランドの調査結果をAIの制作に使うファイルへ変換するCodexスキルです。

## 設置

この `brand-research` フォルダを、使うプロジェクトの `.agents/skills/` 配下に置きます。
次の構造になっていれば設置完了です。

```text
.agents/skills/brand-research/
  SKILL.md
  README.md
  agents/openai.yaml
  references/format.md
  examples/research.json
  scripts/build_harness.py
```

Codexでそのプロジェクトを開いて使います。スキルが表示されない場合は、新しいチャットを開始するかCodexを再起動してください。
同名フォルダがある場合は上書きせず、内容を確認して統合してください。
このフォルダをダウンロードしただけでは、別のプロジェクトや一般的なChatGPTチャットには自動登録されません。

## 呼び出し

```text
$brand-research 会社名 https://公式サイトのURL
```

URLは省略可能です。同名企業がある場合は対象を確認します。
「LP制作向け」「提案資料向け」などの用途、`--out brands/company` で保存先を追加できます。

出力は `BRAND.md`、`brand.json`、`tokens.css`、`sources.md`。
後続のチャットでは「`brands/company/BRAND.md` を読んで、このブランドに合わせて制作して」と指定します。

## 実行環境

検索・閲覧・ファイル操作ができるCodex環境とPython 3.10以上が必要です。
追加Pythonパッケージや、このスキル専用のAPIキーは不要です。
Web検索はチャットが担当し、Pythonスクリプトは調査済みJSONの検証・変換を担当します。
未知の値は補完せず、部分的な調査はその旨を出力します。

`examples/research.json` は架空データです。実在企業のブランド資料として使わないでください。
設置先を起点に、形式だけを確認できます。

```sh
python3 scripts/build_harness.py examples/research.json --check
```

実際の調査手順は [SKILL.md](SKILL.md)、入力データの仕様は [references/format.md](references/format.md) を参照してください。
