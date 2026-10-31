# 車輪の再発明確認

確認日：2026-10-31（日本時間）。公式公開ページの記述を調査。製品の有料契約・実機性能比較は行っていない。記述がない機能を「絶対に存在しない」と断定しない。

| サービスと出典 | 確認した重複 | 設計への反映 |
|---|---|---|
| [Taste](https://buildwithtaste.com/rate) | スワイプ反応から嗜好を学習。20反応、最低3 likes/3 passesで初期プロフィール。MCPでAIへ渡す | 採点UI自体は新規性ではない。10件の少数データで過信せず、企業情報と保持検証まで接続 |
| [Repaint](https://repaint.com/) | 既存サイト・ソーシャル・ファイルを取り込み再構築。元URL・内容との比較に言及 | 情報保持だけでも独占的優位ではない。保持を自動検査し、範囲と未確認箇所を見せる |
| [Revamp](https://revamp.dev/) | URLリニューアル、重要ページ・SEO情報保持、SEO改善、分析 | 根拠・好み・保持・成果を一続きに検証することを競争仮説とする |
| [Shuffle](https://shuffle.dev/ai-website-redesign) | 複数モデルで並行生成、比較、ページ追加、編集・書き出し | 案の数より、選定理由と修正負荷を評価する |
| [Relume](https://www.relume.ai/) | 既存情報から構成・ワイヤー・スタイル、既製コンポーネント、Webflow/Figma/React書き出し | 任意コード生成に頼らず、検査可能な構造と制約付きレンダラーを使用 |
| [10Web](https://10web.io/ai-website-builder/) | 既存URLから本文・画像を使って再構築。ページやURLが変わる可能性を明記 | URL・本文・パンくずを明示的な制約とし、対応表を出力 |
| [Peec AI](https://peec.ai/) | AI検索での露出・競合・引用元の計測、MCP/API | 可視性計測を独自に全面再開発せず、必要時の連携候補とする |

## 成長データ

[Similarweb Data Accuracy](https://support.similarweb.com/hc/en-us/articles/360002219177-Similarweb-s-Data-Accuracy) は推定値と直接計測の違い、小規模サイトのデータ不足を説明している。[Methodology](https://support.similarweb.com/hc/en-us/articles/360001631538-Similarweb-Data-Methodology) も複数データソースのモデリングに基づくことを示す。

したがって、流入推移は出典・地域・端末・期間・指標を揃える。モデルに伸び率を自由作文させない。欠測をゼロ成長と解釈しない。自社の検索順位や競合サイトの見た目だけで業績成長を推定しない。

## AIOと移行

- [Google: AI features and your website](https://developers.google.com/search/docs/appearance/ai-features)
- [Google: Optimizing for generative AI features](https://developers.google.com/search/docs/fundamentals/ai-optimization-guide)
- [Google: Site moves](https://developers.google.com/search/docs/crawling-indexing/site-move-with-url-changes)
- [Google: Breadcrumb structured data](https://developers.google.com/search/docs/appearance/structured-data/breadcrumb)

独自で役立つ情報、クロール可能性、内部リンク、良い閲覧体験、表示本文と整合する構造化データを優先。Googleでは特殊なAI用ファイル・スキーマでの優遇は保証されない。他のAI提供元すべてに同一条件を一般化しない。URL変更時は対応表・リダイレクト・監視が必要。今回は現行URLを基準に保存し、公開前のnoindexを維持する。

## 実装APIの参照

- [OpenAI: Web search](https://developers.openai.com/api/docs/guides/tools-web-search)
- [OpenAI: Structured outputs](https://developers.openai.com/api/docs/guides/structured-outputs)

Responses APIのweb_search、検索由来のsources、JSON Schemaを利用。利用可能なモデルは既存キーのプロジェクトで確認が必要。現在の既定モデルは環境変数で変更可能。
