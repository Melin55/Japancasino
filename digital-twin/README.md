# 大岩根校長のデジタルツイン制作

対象は大岩根成悦（おおいわね まさよし）さん。日本カジノスクール校長・株式会社ブライト代表取締役であることを[学校公式](https://casinoschool.co.jp/school-information/school-about/)で確認。調査日：2026-11-04（日本時間）。ユーザーから顔・声のAI利用について本人・会社の了承済み、同意動画と追加撮影を用意可能と確認した。

**現状：素材調査と生成・透過書き出しツールの準備まで。本人アバター、声モデル、本人の生成動画は未作成。**

## 作るもの

台本 → 本人の声で読み上げ → 本人アバターのリップシンク → 透過WebM → ProRes 4444 MOV。標準設定は縦9:16・1080p。横16:9も設定可能。字幕は映像に焼き込まず、生成サービスにSRTを別出力させる。話す動画素材を目的としており、本人の知識や判断を模倣する対話AIではない。

まず同じ短い台本を生成し、本人・会社で声、口元、間、笑顔、手の動きを評価する。合格後に同じアバターと声のIDで量産する。モデルの出来は実写素材と実際の生成結果を見て判定する。

## 公開素材の調査結果

[sources.csv](sources.csv)と[sources.json](sources.json)に30件の調査項目（28URL）、うち動画候補11本を記録した。同じ掲載一覧で見つけたラジオ番組は項目を分けている。別人・別話者など8件の除外／保留も記録。11本すべてが使用可能・ダウンロード済みという意味ではない。出演根拠の確認、実際の視聴、ファイル取得、利用可能な発話時間を別の状態で管理する。

| 優先候補 | 目的 | 現時点の確認 |
| --- | --- | --- |
| [MONDO TVの校長インタビュー](https://www.youtube.com/watch?v=hGfcVkkqxYg) | 単独取材の話し方 | タイトル・説明で本人取材。尺・画角・公開年は未検証 |
| [MBS 2024-04-16](https://www.youtube.com/watch?v=H8mRwjDYKnc) | 説明の口調と表情 | 学校公式が本人への取材として掲載 |
| [NoBorder 2026-06-01](https://www.youtube.com/watch?v=4jqkaNb1pyM) | 自然な対話、間、相づち | 出演告知と番組リンクを確認。話者分離が必要 |
| [公式紹介動画](https://www.youtube.com/watch?v=Y2h2XbKc7Fk) | 学校保有の撮影原本を探す | 本人の発話区間は未確認 |
| [ABCニュースの会見映像](https://www.youtube.com/watch?v=Yz7yySH3Odc) | 最近の顔・声 | 検索結果に本人コメント。短い可能性 |
| [MBSの会見映像](https://www.youtube.com/watch?v=Fy7DcvD6rmI) | 最近の顔・声 | ABCと同じ会見なら素材の重複に注意 |
| [関西テレビの特集](https://www.youtube.com/watch?v=oOsL0nLhrYU) | 2025年末時点の取材 | 局の記事に本人コメントと動画埋め込み |
| [おもスロい人々・前編](https://fod.fujitv.co.jp/title/g2r4/g2r4110171/)／[後編](https://www.videomarket.jp/title/163032/A163032010999H01) | 長い会話の参考 | 各29分の掲載。未購入・未視聴。58分全部が本人発話ではない |

YouTube実ファイルの取得は実行環境のプロキシからHTTP 403となり停止。音声・映像を視聴したことに基づく話速、声質、採用タイムコードはまだ記載していない。学校の元ファイルを受け取るのが早く、高品質。テレビ番組は本人の了承に加えて番組権利元の素材再利用条件を確認する。レンタルの購入や契約は行っていない。

追加診断で拒否本文は `Domain forbidden`、YouTubeへのTLS接続前の拒否と特定。[診断結果と録画手順](acquisition-status.md)、[ローカル録画ページ](../public/capture.html)を追加した。ユーザー側のChromeで再生できる動画を音声付きWebMに保存できる設計だが、実録画は未検証。

公開素材は話し方の参考・検証用として整理し、アバター登録用には現在の姿を新規撮影する。古い映像や異なるマイク、他の出演者の声を大量に混ぜると再現の一貫性が下がる。

## 撮影セット

1. **本人の同意動画**：HeyGen画面で指定される文言・方法に従って本人が撮影する。台詞をこちらで代作せず、AIで同意動画を合成しない。登録時の本人確認に必要。
2. **本番映像1本、3〜5分、無編集の連続テイク**：最低1080p・30fps、可能なら4K。カメラは固定し、レンズを見る。胸から上〜腰上まで、手を使うなら手も画角内に収める。明るく均一な照明、無地の背景、BGMなし、静かな室内、外部マイク推奨。眼鏡は普段どおりでもよいが反射を避ける。
3. **任意の声用追加録音**：声の再現が弱ければ同じマイク・距離で別録りする。音声量の必要条件は選ぶ声モデルの登録画面で確認。不要な強いノイズ除去・音楽・他人の声を加えない。

3〜5分の撮影は、挨拶→普段教えている仕事の説明→よくある質問に答える→短い笑顔と締め、の順で自然に話す。軽い言い直しがあっても継ぎ接ぎせず、必要なら最初から撮り直す。冒頭と末尾に2〜3秒の自然な静止を入れる。常に無表情で読み上げず、説明のときの普段の表情を使う。

[HeyGen撮影ガイド](https://help.heygen.com/en/articles/12089286-create-your-first-digital-twin-video-avatar-with-avatar-iv)は無編集の連続映像と本人の同意動画を要求している。[同意動画ガイド](https://help.heygen.com/en/articles/12092609-recording-your-consent-video)に沿って登録する。

## 登録・品質合わせ

HeyGenは提案済みだが、この作業時点では接続未確認。顔と声の登録・本人確認を完了し、本人のDigital Twinの**look ID**と本人の**voice ID**を取得する。透過出力にはmatting対応のアバターが必要。追加撮影を用いた新しいDigital Twinを優先する。プラグイン接続と、このCLIで使用するAPIキーは別の認証方法。

初回はAvatar IVで基準動画を作る。Avatar Vとの比較は対象lookの `supported_api_engines` に `avatar_v` が含まれることを確認した後に行う。料金・生成枠は実行するアカウントで確認する。本作業では有料生成や新規契約を行っていない。

[scripts/quality-check.txt](scripts/quality-check.txt)は発音・口元の試験用の新規台本で、本人の過去の発言引用ではない。固有名詞・数字は実際に聞いて読みを調整する。公開用の完成動画では説明欄や画面の適切な位置でAI生成であることを明示できるようにする。透過素材自体には固定ラベルを焼き込まない。

## 実行方法

Python 3とFFmpegが必要。追加Pythonライブラリは不要。`ffmpeg` にlibvpx-vp9、prores_ksが含まれることを確認する。

```sh
cd /workspace/Japancasino/digital-twin
cp profile.example.json profile.json
```

`profile.json`の空欄に登録済みの本人のIDを入れる。APIキーは `HEYGEN_API_KEY` という環境変数に安全な方法で設定する。Git管理・チャット・台本には含めない。profileとoutputはGit除外済み。

```sh
# 送信内容を確認するだけ。通信・課金は発生しない。
python3 twin.py plan --profile profile.json --script scripts/quality-check.txt

# 1回だけ生成を依頼する。このコマンドはHeyGenの生成枠を消費する。
python3 twin.py render --profile profile.json --script scripts/quality-check.txt --job output/check-01.json

# 状態を1回確認。未完了なら少し時間をおいて同じコマンドで再確認する。
# 完了していれば透過WebMを取得する。
python3 twin.py resume --job output/check-01.json --out output/check-01.webm

# アルファ画素を検査し、編集用の透過MOVへ変換する。
python3 twin.py export --input output/check-01.webm --out output/check-01.mov
python3 twin.py inspect --input output/check-01.mov
```

`render`は送信前にジョブと冪等キーを保存する。同じジョブで再実行しても取得済みvideo_idを再利用し、不明な送信結果は同じキーで再試行する。23時間を超えた未確定ジョブは自動再送しない。並行実行せず1ジョブずつ実行する。

`resume`は `video_url` の字幕なし本体をダウンロードする。SRTはHeyGen側に生成されるが、このCLIの自動取得対象はWebMのみ。SRTが必要なら管理画面またはAPIの `subtitle_url` から取得する。

話者を確認した手元の実写素材から、音声候補を切り出す場合：

```sh
# 秒数は必ず実際の視聴に基づいて設定する。
python3 twin.py extract-audio --input private/source.mp4 --start 12.3 --end 42.5 --out private/voice-01.wav
```

これは切り出しと48kHz・モノラルPCM化のみ。他人の声の分離、BGM除去、本人判定はしない。`review.csv`に本人の区間、画角、音質、権利元の条件を記録してから採用する。

## 検証と残件

`python3 -m unittest -v test_twin.py`で、二重送信防止、通信断後の再開、不透明素材の拒否、透過WebM→MOVでアルファ・音声・寸法が保たれることを合成テスト素材で確認できる。

実際の本人映像の品質、HeyGen APIとの実接続、対象アカウントの出力上限、編集ソフトへの読込は未検証。アバター登録後に短い実動画で検証する。`inspect`は冒頭・中央・末尾の3時点を検査するため、髪、眼鏡、指、手振りの全フレームの品質は目視で確認する。

必要な次の入力は、本人の同意動画・新規撮影映像、およびHeyGenの接続または登録済みIDと実行環境のAPI認証。本人・会社の了承を改めて取り直す必要はない。

## 実装の根拠

- [HeyGen Digital Twin](https://developers.heygen.com/generate-avatar-video)：v3の生成・状態取得・エンジン選択。
- [Create Video](https://developers.heygen.com/reference/create-video)：生成パラメータとIdempotency-Key。
- [Transparent Background Videos](https://developers.heygen.com/transparent-background-videos)：`output_format: webm`、matting要件、backgroundとの併用不可。
- [Digital Twin FAQ](https://help.heygen.com/en/articles/9380615-digital-twin-faq)：元素材の表情・手の動き、本人の同意、声の登録。

透過WebMのVP9デコードではFFmpegのlibvpx-vp9を明示し、アルファを保持する。MOVはProRes 4444、音声はPCM。不透明な動画をファイル名変更だけで透過素材にはしない。
