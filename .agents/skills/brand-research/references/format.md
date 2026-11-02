# 調査JSONの形式（schema_version: 1.0）

Python 3.10以上、追加依存なし。UTF-8のJSONを使う。
スクリプトは構造・値・出典参照を検証する。URLの到達性や出典の真偽は判定しないため、実際の確認は調査担当が行う。

## トップレベル

| キー | 型・条件 |
| --- | --- |
| schema_version | 文字列 `1.0` |
| company | `name`（会社・ブランド名）、`website`（公式http/https URL、未確認はnull） |
| researched_at | タイムゾーン付きISO 8601日時 |
| research | `status`: `complete` / `partial`、`limitations`: 不足・矛盾の説明の文字列配列 |
| sources | 出典オブジェクトの配列。IDは重複不可 |
| colors | 項目オブジェクトの配列。valueは `#RRGGBB` / `#RRGGBBAA` またはnull |
| typography | 項目オブジェクトの配列。valueはフォント名の文字列配列またはnull |
| logos | 項目オブジェクトの配列。valueはロゴまたは配布ページのhttp/https URLまたはnull |
| voice | 項目オブジェクトの配列。valueは言葉遣いの説明またはnull |
| rules | 項目オブジェクトの配列。valueは制作ルールの説明またはnull |

全てのトップレベルキーを含める。各オブジェクトは表に記載したキーのみを使う。
partialの場合はlimitationsを1件以上記載する。
completeは全5カテゴリに1件以上の項目があり、unknownとlimitationsがなく、公式サイトを特定できた場合だけ使う。
completeは調査範囲を確認できたという意味で、全項目が公式ルールという意味ではない。各項目のstatusを優先する。
項目のないカテゴリは空配列を許容するが、research.statusはpartialにする。

## 出典オブジェクト

| キー | 型・条件 |
| --- | --- |
| id | `guide` / `homepage-css` などの一意なID。英小文字で始まり、英小文字・数字・ハイフンのみ |
| title | 資料名 |
| url | 実際に確認したhttp/https URL。検索クエリのURLで代用しない |
| kind | `official` / `third_party` |
| accessed_at | タイムゾーン付きISO 8601日時 |

出典が公式かどうかは、ドメインだけでなく所有者や公式サイトからのリンクなどで確認する。
ブランドアセット配布先が別ドメインでも、公式サイトから確認できる場合はofficialにできる。

## 項目オブジェクト（全カテゴリ共通）

| キー | 型・条件 |
| --- | --- |
| token | カテゴリ内で一意なID。英小文字で始まり、英小文字・数字・ハイフンのみ |
| label | 日本語などの表示名 |
| value | 上表のカテゴリ別の値。unknownの場合だけnull |
| status | `official` / `observed` / `inferred` / `unknown` |
| source_ids | sources内に存在するIDの配列。unknownは空配列、それ以外は1件以上 |
| note | 根拠の要約、適用範囲、推定理由、不明の理由。空文字不可 |

公式ガイドに明記された数値がofficial、Webサイトの実装値がobserved。
officialとobservedは、最低1件のofficial出典を必要とする。
CSSファイルを根拠にした場合はnoteに変数名・セレクタなどを残す。
ロゴのnoteには、確認できた利用条件とその根拠も書く。条件が不明なら「利用条件は未確認」と明記する。
フォントのvalueは例 `['Noto Sans JP', 'sans-serif']` のような配列（JSONではダブルクオート）。
CSSへ出す際、一般的な総称フォント以外の名前は引用符で囲まれる。
unknownの例:

```json
{
  "token": "primary",
  "label": "メインカラー",
  "value": null,
  "status": "unknown",
  "source_ids": [],
  "note": "公式ガイドにアクセスできず、正確なHEX値は未確認。"
}
```

## 変換と検証

```sh
python3 scripts/build_harness.py research.json --check
python3 scripts/build_harness.py research.json --out brands/company
```

コマンドはスキルディレクトリを起点とした例。
出力先が既存のファイル・ディレクトリ・シンボリックリンクの場合は失敗し、上書きしない。
まず全項目を検証し、不正なJSONからはファイルを生成しない。
CSSはofficial/observedのみ。推定・不明の値はbrand.jsonとBRAND.mdに残す。
値がなくてもtokens.cssは生成されるが、未確認の値やデフォルトのブランドカラーは補わない。
