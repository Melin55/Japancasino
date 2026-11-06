# 無料CPU版の制作コード

本人の了承を得た参照音声と、準備済みの正面・背景透過PNGを使い、日本語台本から音声、正面の喋る動画、背景透過WebM／ProRes 4444 MOVを生成する研究用ワークフローです。外部の生成APIは呼びません。専用モデルの追加学習は行わず、GPT-SoVITSの参照音声による合成とSadTalkerの静止画アニメーションを組み合わせます。

正面PNGの作成はこのCLIの対象外です。今回の基準画像は、ユーザー提供の2本の動画から抽出した画像を参照し、画像編集モデルで正面化・細部補完しました。生成された細部は元動画から実測復元したものではありません。

## ファイル

```text
local-cpu/
├── run.py                    # 台本からの一連の実行
├── synthesize.py             # GPT-SoVITS v2、日本語音声
├── animate.py                # SadTalker、正面固定、256/512
├── export.py                 # 1080×1920の透過WebM/MOVと確認用MP4
├── profile.example.json      # モデル・参照素材の場所
└── requirements-linux.txt    # Linuxでの検証環境の固定バージョン
```

モデル、ユーザーの参照素材、生成結果はGitに含めません。ローカルの `profile.json`、`../private/`、`../output/` は既存の `.gitignore` の対象です。

## 環境

検証環境はLinux x86_64、Python 3.10、PyTorch 2.5.1+cpuです。`--bf16` は対応するLinux CPUでの任意設定です。ユーザーのIntel MacBook Pro 2019／macOS Tahoe上では未検証です。PyTorch 2.5.1にはIntel Mac向けwheelがないため、このLinux用固定環境をMacへそのまま導入しないでください。Intel Mac向けの2.2.2は別途互換性の検証が必要です。

FFmpeg・ffprobeをPATHに用意し、隔離したPython環境を使います。Linux環境の再現例：

```sh
python3.10 -m venv .venv
.venv/bin/python -m pip install torch==2.5.1 torchvision==0.20.1 torchaudio==2.5.1 --index-url https://download.pytorch.org/whl/cpu
.venv/bin/python -m pip install setuptools wheel
.venv/bin/python -m pip install --no-build-isolation -r requirements-linux.txt --extra-index-url https://download.pytorch.org/whl/cpu
```

BasicSRのビルド時に別のGPU用PyTorchが入らないよう、CPU版を先に入れ、依存関係のビルド隔離を無効にしています。最新の依存パッケージへの一括更新は未検証です。

外部エンジンは次のリビジョンを使いました。

- [GPT-SoVITS](https://github.com/RVC-Boss/GPT-SoVITS): `d7c2210da8c013e81a94bfc7b811a477c99fd506`（`20250606v2pro` タグ、合成モデルはv2）。
- [SadTalker](https://github.com/OpenTalker/SadTalker): `cd4c0465ae0b54a6f85af57f5c65fec9fe23e7f8`。

両プロジェクトの手順でモデルを配置します。GPT-SoVITSでは `GPT_SoVITS/pretrained_models/` に `chinese-hubert-base/`、`chinese-roberta-wwm-ext-large/`、`gsv-v2final-pretrained/s1bert25hz-5kh-longer-epoch=12-step=369668.ckpt`、`gsv-v2final-pretrained/s2G2333k.pth` を使用します。[公開モデル](https://huggingface.co/lj1995/GPT-SoVITS/tree/main)

SadTalkerでは `checkpoints/` に選択したサイズの `SadTalker_V0.0.2_512.safetensors` または `SadTalker_V0.0.2_256.safetensors` と `mapping_00109-model.pth.tar`、`gfpgan/weights/` に `alignment_WFLW_4HG.pth` と `detection_Resnet50_Final.pth` を配置します。[公式のダウンロード手順](https://github.com/OpenTalker/SadTalker/blob/main/scripts/download_models.sh)

## 台本を差し替える

1. `profile.example.json` を `profile.json` にコピーし、モデルと素材の実際のパスに変更します。相対パスはprofileファイルの場所を基準に解決します。
2. `reference_audio` は対象者だけが話す3〜10秒の音声、`reference_text` はその正確な文字起こしを入れたUTF-8ファイルです。他の出演者の声を混ぜないでください。
3. `portrait` は正面の背景透過PNGです。輪郭の透明度は出力動画に引き継ぎます。大きく頭や体を動かす動画には固定マスクを使えません。
4. 読ませたい台本をUTF-8の `script.txt` に保存します。氏名などは必要に応じて読み仮名にし、生成音声を試聴してください。

```sh
# このフォルダーから、モデルをインストールしたPythonで実行
python run.py --profile profile.json --script script.txt --out ../output/trial-001 --dry-run
python run.py --profile profile.json --script script.txt --out ../output/trial-001
```

出力先は毎回新しい空のディレクトリを指定します。実行中の段階は `job.json`、音声は `speech.wav`、最終ファイルは `export/` に保存します。途中失敗後の自動再開は実装していません。完了した音声や動画を使って次の段階から手動で再開できます。

```sh
python animate.py --engine-root /path/to/SadTalker --image ../private/frontal-reference.png --audio ../output/trial-001/speech.wav --out ../output/animation-002 --size 512
python export.py --video /path/to/generated.mp4 --portrait ../private/frontal-reference.png --out ../output/export-002
```

`animate.py` は同一入力の画像特徴だけを再利用し、最初の再利用時に通常計算との完全一致を検証します。フレーム数や音声の長さは削減しません。表情・口の動きに依存する処理は各フレームで実行します。

## 出力と確認

- `avatar-alpha.webm`：VP9＋アルファ。再生ソフトによって透明部分が黒く見えることがあります。
- `avatar-alpha.mov`：ProRes 4444＋アルファ、PCM音声。
- `preview.mp4`：市松背景とAI生成表示を付けた確認用。不透明なMP4です。
- `export.json`：3時点のアルファ画素検査、寸法、時間など。

1080×1920は出力キャンバスの寸法です。顔の生成解像度は256または512で、元の顔の細部を完全復元するものではありません。正面性・本人への似方・発音・口元・髪の輪郭を確認してから素材として採用してください。初期の256版では約4秒のアニメーションにLinux CPUで約11分かかっており、高解像度版はさらに時間を要します。

画像モデルの生成結果、同梱されない重み、各外部依存の利用条件はそれぞれの提供元に従います。今回の改変はモデルの学習コードや重みを再配布せず、インストール済みのエンジンを呼び出すラッパーです。


## 正面・カメラ目線を維持する版

対談の動作動画には横を見る動きが含まれます。一人でレンズを見ながら話す場合は、正面の基準画像を用意し、静止姿勢と yaw / pitch / roll = 0 を指定するこのルートを使います。手元と体は基準画像のまま固定され、顔・口元・まばたきを動かす構成です。正面画像をAIで補完する場合、本人らしさは確認が必要です。3Dメッシュは出力しません。

`animate.py --frame-stride 2` は元の音声タイミングのまま1コマおきの表情を生成し、その間を前後方向のオプティカルフローで補間します。512pxの顔の描画時間を抑えるための選択肢で、25fpsの全コマを独立に生成する設定は `--frame-stride 1` です。出力尺とコマ数は維持しますが、高速な口の動きには補間によるにじみが出る可能性があります。設定例の `frame_stride: 2` はrun.pyからこの選択肢を渡します。

音声をすでに仕上げている場合は、`animate.py` にそのWAVを渡して再利用できます。最終書き出しでも元の高サンプルレートWAVを使用し、SadTalker内部の16kHz中間音声に置き換えないでください。正面版の通常動画は淡い背景に合成し、編集用には元PNGの透過マスクを使用しています。

生成した頭部と元の透過輪郭がわずかにずれると、耳や首の横に黒い縁が出る場合があります。正面版では、目の中心から固定の相似変換を求めて顔を基準画像へ合わせ、顔ランドマークの輪郭内だけを内側へ24pxぼかして合成しました。髪・耳・首・体は元画像を維持します。この追加合成は今回の制作工程で適用した処理で、標準 `export.py` が自動で行う機能ではありません。
