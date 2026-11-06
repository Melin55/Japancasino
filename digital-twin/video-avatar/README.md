# 実写の身振りを使う動画アバター（CPU）

最新のv8は、下記のCPUによる実写動作の再利用とは別に、[生成した立ち姿の仕上げ](#生成した立ち姿の仕上げv8)を使います。

新しい日本語台本から声と口元を生成し、参照動画の座り姿・頭・目・手の動きを残す制作パイプラインです。自由に回転できる3Dモデルや、台詞に応じて新しい身振りを生成する仕組みではありません。本人・会社の了承を得た素材を使用します。

## このテンプレートの範囲

- GPT-SoVITS v2：本人の短い参照音声と文字起こしから新しい発話を合成。
- facexlib / MuseTalk 1.5：顔を追跡し、音声に合わせて下半分の顔を生成。
- LaMa：元動画の胸付近の字幕を除去。隠れていた服や手の細部はAIによる補完。
- Robust Video Matting：人物を切り抜き、テーブルを含めて透過WebMを出力。
- FFmpeg：1080×1920、25fpsの通常MP4と透過WebMを出力。顔の生成自体は256×256であり、1080pの新しい顔情報を復元するものではありません。

**字幕位置、タイトル領域、テーブルの切り抜き範囲は、指定された `3fs1htwZR9I` の構図専用です。** 別の構図には `clean_and_matte.py` と `export.py` の調整が必要です。前処理済みの1080×1920・25fpsの動作素材を使い、発話の長さはその素材以内にします。字幕のない原本が得られれば、補完による服・手のにじみを避けられます。

## 環境

Linux CPU環境で元となる各処理を実行しています。Macでの動作、GPU版、1本10分以内の処理は未検証です。実行用CLIに整理したコードは構文・実行計画を確認しており、CLI全体の再実行はしていません。最終書き出し工程は整理後のCLIから実行しています。

Python 3.10、FFmpeg（libx264 / libvpx-vp9 / libopus / ffv1）、日本語フォントが必要です。[静止画CPU版](../local-cpu/README.md)のGPT-SoVITS環境に加え、Torch 2.5.1 CPU、torchvision 0.20.1 CPU、transformers 4.51.3、facexlib 0.3.0、NumPy 1.23.5、OpenCV、Pillow、SciPy、einops、および `requirements-extra.txt` の依存を使用しました。既存環境と競合する場合は専用venvを使ってください。

モデルはGit外に配置します。コードだけでは動作せず、各配布元のライセンス・利用条件を確認したうえで次を用意します。

- [MuseTalk](https://github.com/TMElyralab/MuseTalk)（使用コミット `0a89dec45a0192b824e3cf4daf96c239440c5ed8`）：配布元に従って `models/musetalkV15/{unet.pth,musetalk.json}`、`models/sd-vae/`、`models/whisper/`、`models/face-parse-bisent/` を配置。
- [GPT-SoVITS](https://github.com/RVC-Boss/GPT-SoVITS) v2（使用コミット `d7c2210da8c013e81a94bfc7b811a477c99fd506`）：静止画CPU版の配置に従う。
- [RobustVideoMatting](https://github.com/PeterL1n/RobustVideoMatting)：リポジトリ直下に `rvm_mobilenetv3.pth`。
- [LaMa TorchScript](https://github.com/enesmsahin/simple-lama-inpainting/releases/tag/v0.1.0)：`big-lama.pt`。
- facexlib：`detection_Resnet50_Final.pth` と `alignment_WFLW_4HG.pth` を指定のweightsフォルダに配置。

## 実行

```sh
cp profile.example.json profile.json
```

`profile.json` のモデル、前処理済み動作動画、参照音声、文字起こしのパスを設定します。相対パスはprofileのあるフォルダを基準に解決します。別フォルダに依存を隔離した場合のみ `extra_python_path` を追加します。モデル・音声・動画・本人用profileはGitにコミットしません。

```sh
# 実行する処理を表示するだけ（モデルはロードしない）
python run.py --profile profile.json --script private/script.txt --out output/sample-01 --dry-run

# 新しい空の出力先に順番に生成する
python run.py --profile profile.json --script private/script.txt --out output/sample-01

# 前工程の成果物が存在する場合、指定の工程から個別に再実行できる
python run.py --profile profile.json --script private/script.txt --out output/sample-01 --stage export
```

工程は `voice → faces → lipsync → matte → export`。CPUの取り合いを避けるため逐次実行します。BF16非対応CPUでは `--fp32` を指定します。計算時間とメモリ使用量が増える可能性があります。

出力は `original-ai-video.mp4`、`avatar-transparent.webm`、`speech.wav`、生成記録JSONと中間ファイルです。透過WebMは対応する編集ソフトに読み込んでください。プレーヤーでは透明部分が黒く表示される場合があります。MP4にはAI生成サンプル表示を入れ、編集用透過素材には固定タイトルを入れません。

## 確認事項

新しい台本が最後まで発話されること、音声と口の動き、元映像にない顔のゆがみ、字幕除去部分のちらつき、髪・指・テーブル周囲の透過を確認します。ASR一致だけでは声の似方や自然さを保証できません。発話内容と身振りの意味が一致するとは限らず、完成見本として本人・会社による確認が必要です。

## 動き・音・解像感の修正

元動画にジャンプカットがある場合、口元だけの生成では姿勢の飛びが残ります。v5の見本では元動画の59.60〜64.84秒の連続区間を使用し、往復再生の折り返しを数フレームで丸めた10.72秒の動作素材を作りました。その後に新しい口元を生成するため、発話音声を逆再生することはありません。往復させた身振りを使う構成であり、台本に応じた新しい全身動作の生成ではありません。

音声は既存の10.7秒の合成音声に、FoxJoyのONNX dereverb、DeepFilterNet3（抑制上限12dB、遅延補償あり）、65Hzハイパスと音量調整を適用しました。反響分離モデル単独の変化が小さかったため、音声ノイズ抑制も併用しています。台詞の変更や話速変更はしていません。処理後のASRでも元の台詞と一致しました。利用依存は `onnxruntime==1.19.2`、`deepfilternet==0.5.6`、既存のTorch CPU環境です。外部モデルは別途必要です。

連続した25fpsの通常版・透過版が揃った後、次の処理で1440×2560・50fpsに仕上げられます。

```sh
python polish.py --source output/sample-01 --out output/sample-01-polished
```

`polish.py` は `original-ai-video.mp4`、`avatar-transparent.webm`、`speech.wav` を読みます。前後方向のオプティカルフローで中間フレームを補間し、透過色をアルファで乗算した状態で補間・拡大して縁の色混入を抑えます。Lanczos拡大と軽い輪郭補正を使用し、新しく撮影した高解像度の細部を復元する処理ではありません。ジャンプカットの自動修復機能はありません。出力は1440p・50fpsのMP4／透過WebMと処理記録です。`--frames 16` で短い試験書き出しができます。

## 正面の身振りと金色の日本語タイトル

v7は静止画の顔だけを動かす構成から、実写の首・肩・手が連動する構成へ戻しています。59.60〜63.60秒の正面を向いた区間を使い、インタビュアーを見る後半を除きました。短い区間の身振りを往復させた動作参照に、新しい10.7秒の音声で口元を生成します。全身動作の新規生成ではなく、同じ身振りが繰り返される制約があります。背景とテーブルは元のインタビュー映像のままです。

`gesture_driver.py` は、字幕除去・マット作成済みの1080×1920・25fps動画と、出力フレームから参照フレームへの対応を読みます。折り返しを平滑化し、小数位置を双方向オプティカルフローで補間するため、参照フレーム番号の丸めによるコマの重複を減らします。音声を読み込んだり話速を変更したりする処理ではありません。

```sh
# plan内のパスはplanファイルからの相対パス。新しい出力先を指定する。
python gesture_driver.py --plan gesture-plan.example.json --out output/motion
```

`control_points` は `[出力フレーム, 参照フレーム]` の列です。例は59.60秒を起点に切り出した素材向けです。別素材ではカット・視線・身振りを確認して設計し直してください。長い素材をすべて読み込む用途ではなく、数秒の動作参照用です。生成した `motion-driver.mp4` をprofileの `motion_video` に指定し、顔追跡と口元生成を行います。前処理を再利用する場合、出力先の `work/prepared-clean.mp4` に動作動画、`work/prepared-alpha.mkv` に生成した対応マットを置いてからexport工程を実行します。

profileの `consistent_latent_noise: true` は、MuseTalkのVAEで毎フレーム同じ乱数系列を使い、サンプリング由来の質感のばらつきを減らします。省略時は従来動作です。時間的一貫性や口の自然さを保証する機能ではありません。

金色タイトルは [Dela Gothic One（デラゴシック）](https://github.com/google/fonts/tree/main/ofl/delagothicone) と Noto Sans CJK JP Bold を使用します。フォントは別途配置し、DelaのSIL OFLライセンスも保存してください。元動画のフォント名は特定できていないため、同一フォントの再現ではなく、極太の日本語ゴシックに寄せたデザインです。

```sh
python gold_title.py \
  --display-font private/fonts/DelaGothicOne-Regular.ttf \
  --name-font /usr/share/fonts/opentype/noto/NotoSansCJK-Bold.ttc \
  --out private/gold-title.png
```

profileに `"title_overlay": "private/gold-title.png"` を追加すると、通常MP4のタイトルを差し替えられます。PNGは1080×1920で、パスはprofileから解決します。背景透過素材にはタイトルを焼き込みません。元のタイトル全体を覆い、顔・髪に重ならない構図専用の配置です。表示文字は日本語ですが、元背景に写る英字ロゴは保持します。

この素材では首横にある赤・白の背景ロゴがマットに残ることがあります。今回の10.68秒・1440p50見本には、仕上げ後に次の補助処理を適用しました。顔ランドマークの外側だけを対象に色を抽出し、縁をぼかしてアルファを修正します。元動画の領域に限定した処理で、別の構図・尺にはそのまま使用できません。通常MP4の背景には適用しません。

```sh
python clean_alpha_logo.py \
  --input output/sample-01-polished/avatar-transparent-1440p50.webm \
  --speech output/sample-01/speech.wav \
  --landmarks output/sample-01/work/faces.json \
  --out output/sample-01-polished/avatar-transparent-clean.webm
```

## 生成した立ち姿の仕上げ（v8）

参照ページ「日本カジノスクール」の④に合わせ、正面・目の高さ・太ももの途中まで入る立ち姿に変更しました。本人の実写を基準に生成AIで目線と姿勢を補完した画像を作り、既存の約10.7秒の本人合成音声と、発言ごとの動作指示をHeyGenの画像アバター生成に渡しています。背景はインタビューの緑・クリーム色の壁を生成AIで再構成したものです。実写の背景とピクセル単位で同じではありません。

動作指示は「緊張しますよね」で軽いうなずき、「基本から」で手を開き、「一つずつ」で小さな一拍、「聞いてください」で相談を促す両手の動きです。指示通りの正確な時刻や、目・指の完全な自然さを保証するものではないため、完成動画を確認します。v7の往復動作素材は使いません。

今回の接続アカウントでは画像からの生成が無料プランで完了しました。出力は720×1280、25fps、10.72秒で、HeyGenの透かしが付きます。1080pを指定しても720pに制限されました。本人のカスタムアバター登録完了を意味せず、今後の無料利用枠も保証しません。課金プランへの変更は行っていません。

```sh
python finish_generated.py \
  --input private/generated-720p.mp4 \
  --previous private/previous-version.mp4 \
  --display-font private/fonts/DelaGothicOne-Regular.ttf \
  --name-font /usr/share/fonts/opentype/noto/NotoSansCJK-Bold.ttc \
  --out output/standing-v8
```

FFmpegとPillowが必要です。`--previous`を省略すると比較動画は作りません。このテンプレートは指定の立ち姿と台詞用です。新しい台詞では見出しと動作指示も変更してください。フォント・動画のパスにはFFmpegフィルタの特殊文字を含めないでください。

出力は、1080×1920の通常MP4、前回との1280×1280同時再生比較、見出しPNG、検証JSONです。背景とサービスの透かしを保持します。透過WebMはこの工程では作りません。見出しは頭に重ならない上端へ移動し、日本語のDela Gothic Oneと金・深緑を使います。元の動画のフォント名は未特定です。

生成された25fpsのフレームをそのまま使い、往復再生・ループ・時間伸縮・補間は行いません。1080p納品はLanczos拡大であり、ネイティブ1080p生成ではありません。主動画の音声は再エンコードせず保持します。実際の音声を従来の発話と照合した相関は約0.985、遅延は約23msでした。全フレームのデコード、毎秒の画像、変化量の大きい箇所の前後と目元を確認しました。音声の聴取レビューはこの改訂では行っていません。

## 間と尺を保った少し早口の版（v9）

ユーザーが明示的に希望した速度変更用に `retime_speech.py` を追加しました。通常の仕上げで自動的に発話を伸縮するものではありません。v8の発話部分だけを1.07倍速にし、指定した文間・句間は同じ長さで残します。短くなった分は、既存の発話後の動きをゆっくり再生する余韻へ回し、全体の10.72秒を維持します。顔や台詞を新しく生成し直しません。

```sh
python retime_speech.py \
  --input private/generated-720p.mp4 \
  --timeline retime-timeline.example.json \
  --overlay private/gold-header.png \
  --out output/standing-faster-v9
```

NumPy、OpenCV、FFmpegの `rubberband` フィルタが必要です。例のタイムラインはv8の音声波形に合わせたものなので、別の発話にはそのまま使わないでください。全区間を `speech` / `pause` / `tail` に分け、最後に発話のない `tail` を1つ指定します。境界は低音量の箇所を選びます。声の高さを保って音声を調整し、同じ時刻対応表で口元・身振りを動かします。句間の継ぎ目は前後3msだけフェードします。

映像は双方向DISオプティカルフローで50fpsへ補間します。静止画の引き延ばしや逆再生はしませんが、速い口・手の輪郭に補間のにじみが出る場合があるため確認が必要です。出力は見出し付き1080p MP4、見出しなし720p MP4、音声WAV、音声と映像の時刻対応・検証JSONです。背景とHeyGenの透かしは残り、720pの生成解像度自体は上がりません。

## 指定されたBGMを重ねる（v10）

`add_bgm.py` は、ローカルの音楽から連続した区間を選び、発話中だけ音楽を下げて合成します。既定値はBGMを18dB下げ、冒頭0.08秒・末尾0.72秒をフェードします。曲や台詞の速度は変えず、映像は再圧縮せずコピーします。音源の取得や利用許諾を行うツールではありません。

```sh
python add_bgm.py \
  --input output/standing-faster-v9/standing-interview-faster-720p50.mp4 \
  --music private/music.m4a --start 0 --music-gain-db -18 \
  --out output/bgm-trial.mp4
```

FFmpeg/ffprobeとPython標準ライブラリのみ使用します。音楽が選択した区間を覆わない場合は停止し、ループはしません。今回の約10.72秒の試作では、全体デコード、元動画とのH.264ビット列ハッシュ一致、出力音量（約-22.9 LUFS、最大ピーク約-7.5dBFS）を確認しました。聴取レビューは未実施です。音源・ミックス済み動画・配信サービスの応答はGitに含めません。

## BGMを含む全体の速度変更（v11）

`speed_video.py` は、ユーザーが動画全体の速度変更を明示した場合に使います。指定した入力動画を基準に映像・混合済み音声・間・フェードをまとめて変更し、声と音楽の高さを維持します。v11はBGM入りのv10に対して1.15倍速で、10.72秒から約9.32秒になります。v9のように元の尺や間を維持する処理ではありません。

```sh
python speed_video.py --input output/bgm-trial.mp4 --speed 1.15 \
  --out output/bgm-trial-115.mp4
```

FFmpegのRubber Bandで音声のピッチを保持し、映像は時刻を変更して50fpsに書き出します。両方のストリームの長さと元の画面寸法を検証し、全体デコードを実行します。新しい生成やAI補間は行いません。出力先は既存ファイルを上書きしない新しいパスを指定してください。
