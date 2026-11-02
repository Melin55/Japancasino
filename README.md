# Japancasino

Codex クラウド環境で開発を始めるための最小構成です。
起動確認用の静的ページと、会社のブランドを調査してファイル化するCodexスキルを用意しています。

## ブランド調査コマンド

このリポジトリを開いたCodexチャットで、次のように入力します。

```text
$brand-research 会社名 https://公式サイトのURL
```

例えば、対象の会社名・URLに置き換えて、用途や出力先も指定できます。

```text
$brand-research 会社名 https://example.com --out brands/company LP制作向けに調べて
```

公式ブランドガイド、公式サイトのCSS、公開資料、必要に応じて記事・公式SNSを調べ、出典と確度を付けて以下を生成します。

| 出力 | 内容 |
| --- | --- |
| `brands/company/BRAND.md` | AIが制作前に読むブランドルール |
| `brands/company/brand.json` | カラー・書体・ロゴ・言葉遣い・制作ルールの構造化データ |
| `brands/company/tokens.css` | 公式資料または公式サイトで確認した色・フォントのCSS変数 |
| `brands/company/sources.md` | 出典URL・アクセス日時・調査の制限 |

次の制作では「`brands/company/BRAND.md` を読み、このブランドに合わせてLPを作って」のように指定します。
推定した色・書体は確定CSSに含めず、確認できない値はnullのまま残します。既存の出力は上書きしません。
ロゴやフォントはURLと利用条件を記録し、本体を再配布しません。

### 必要な環境とスキルの読み込み

- Codexなど、Agent Skills・公開Webの検索/閲覧・ファイル操作に対応する実行環境。
- Python 3.10以上。追加Pythonパッケージ、このスキル専用のAPIキーは不要。
- スキルは [.agents/skills/brand-research/SKILL.md](.agents/skills/brand-research/SKILL.md) に配置しています。
- 現在のチャットでスキル候補に出ない場合は、このリポジトリを開いて新しいCodexチャットを開始するか、Codexを再起動します。
- 別のプロジェクトで使う場合は、`brand-research` フォルダ全体をそのプロジェクトの `.agents/skills/` 配下にコピーします。既存の同名スキルがある場合は内容を確認してから統合してください。

調査はチャットの検索・閲覧機能で行います。Pythonスクリプト単体はWeb検索を行わず、調査済みデータを検証・変換します。
検索や閲覧ができない環境では、提供済みの資料のみを使い、不足を明示した部分的なハーネスを生成します。
ファイル操作やPythonも利用できないチャットでは、自動ファイル生成は実行できません。

### 変換処理の動作確認

以下は**架空のサンプル**を使う形式の検証です。実在する企業の調査ではありません。
出力先は新しいフォルダを指定してください。

```sh
python3 .agents/skills/brand-research/scripts/build_harness.py \
  .agents/skills/brand-research/examples/research.json --out /tmp/brand-research-demo
python3 -m unittest discover -s tests -v
```

JSONの形式は [references/format.md](.agents/skills/brand-research/references/format.md) に記載しています。
実データはチャット側で調査して作ります。変換時に出典ID・色の形式・未確認値・出力先の重複などを検証します。
この検証はURLの到達性や出典の真偽を保証するものではありません。

## 起動

必要なものは Python 3 のみです。追加パッケージや API キーは不要です。

```sh
cd /workspace/Japancasino
python3 -m http.server 8000 --bind 127.0.0.1 --directory public
```

別のターミナルで応答を確認できます。

```sh
curl --fail http://127.0.0.1:8000/
```

終了するには、起動したターミナルで `Ctrl+C` を押します。
ローカルの別の場所に clone した場合は、そのチェックアウトで同じコマンドを実行してください。

## 共同作業

- 1つの作業に担当者を1人決め、作業用ブランチから PR を作成します。
- 複数の人や Codex が同じ作業ディレクトリを同時に編集することは避けてください。
- PR に変更内容・確認結果・残件を記載し、引き継げるようにします。
- 秘密情報や `.env` はコミットしません。

Webアプリのフレームワーク、Slackへの自動通知はまだ設定していません。
