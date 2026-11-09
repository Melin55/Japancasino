#!/usr/bin/env python3
"""HeyGen v3 submission/resume and real-alpha ProRes export. Python stdlib only."""
import argparse
import json
import os
import subprocess
import sys
import tempfile
import time
import uuid
from pathlib import Path
from urllib.error import HTTPError, URLError
from urllib.parse import quote, urlparse
from urllib.request import HTTPRedirectHandler, Request, build_opener, urlopen

BASE = "https://api.heygen.com/v3"


def read_json(path):
    return json.loads(Path(path).read_text(encoding="utf-8"))


def save_json(path, value):
    path = Path(path)
    path.parent.mkdir(parents=True, exist_ok=True)
    temporary = path.with_name(path.name + ".tmp")
    with temporary.open("w", encoding="utf-8") as stream:
        os.chmod(temporary, 0o600)
        json.dump(value, stream, ensure_ascii=False, indent=2)
        stream.write("\n")
    temporary.replace(path)


def payload(profile, script):
    for field in ("avatar_id", "voice_id"):
        if not isinstance(profile.get(field), str) or not profile[field].strip():
            raise ValueError(f"profile.json の {field} に登録済みの本人のIDを設定してください。")
    if not script.strip():
        raise ValueError("台本が空です。")
    engine = profile.get("engine", "avatar_iv")
    if engine not in ("avatar_iv", "avatar_v"):
        raise ValueError("engine は avatar_iv または avatar_v を指定してください。")
    ratio = profile.get("aspect_ratio", "9:16")
    if ratio not in ("9:16", "16:9", "1:1", "4:5", "5:4", "auto"):
        raise ValueError("未対応の aspect_ratio です。")
    resolution = profile.get("resolution", "1080p")
    if resolution not in ("720p", "1080p"):
        raise ValueError("このツールのIV/V出力は720pまたは1080pです。")
    speed = float(profile.get("speed", 1))
    if not 0.5 <= speed <= 1.5:
        raise ValueError("speed は0.5〜1.5の範囲です。")
    return {
        "type": "avatar", "avatar_id": profile["avatar_id"].strip(),
        "voice_id": profile["voice_id"].strip(), "script": script.strip(),
        "title": profile.get("title", "Digital Twin"), "engine": {"type": engine},
        "resolution": resolution, "aspect_ratio": ratio, "fit": "contain",
        "voice_settings": {"speed": speed}, "output_format": "webm",
        "caption": {"file_format": "srt"},
    }


class NoRedirect(HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        return None  # Never forward the API key to a redirected host.


class HeyGen:
    def __init__(self):
        self.key = os.environ.get("HEYGEN_API_KEY")
        if not self.key:
            raise ValueError("HEYGEN_API_KEY を実行環境に設定してください。チャットやファイルに貼り付ける必要はありません。")

    def request(self, method, route, body=None, idempotency_key=None):
        headers = {"x-api-key": self.key, "Content-Type": "application/json"}
        if idempotency_key:
            headers["Idempotency-Key"] = idempotency_key
        data = None if body is None else json.dumps(body).encode("utf-8")
        req = Request(BASE + route, data=data, headers=headers, method=method)
        try:
            with build_opener(NoRedirect()).open(req, timeout=60) as response:
                result = json.load(response)
        except HTTPError as error:
            raise RuntimeError(f"HeyGen HTTP {error.code}。ジョブを保持しました。アカウントの権限・残高・アバター設定を確認してください。") from None
        except (URLError, TimeoutError):
            raise RuntimeError("HeyGen通信が完了しませんでした。同じジョブで再実行してください。") from None
        if not isinstance(result, dict) or not isinstance(result.get("data"), dict):
            raise RuntimeError("HeyGenの応答形式が想定と異なります。ジョブを保持して確認してください。")
        return result["data"]


def submit(client, request_body, job_path):
    job_path = Path(job_path)
    if job_path.exists():
        job = read_json(job_path)
        if job["request"] != request_body:
            raise ValueError("既存ジョブと台本・設定が異なります。別の --job パスを指定してください。")
        if job.get("video_id"):
            if job.get("output_format") != "webm":
                raise ValueError("このジョブでは透過WebMの受理を確認できていません。HeyGen管理画面で確認してください。")
            return job  # Re-running the command must not create another paid render.
        if time.time() - job["created_at"] >= 23 * 3600:
            raise ValueError("未確定ジョブが23時間以上経過しています。HeyGen側の生成履歴を確認してから新規ジョブを作成してください。")
    else:
        job = {"request": request_body, "idempotency_key": str(uuid.uuid4()),
               "created_at": time.time(), "status": "not_submitted"}
        save_json(job_path, job)  # Persist before the potentially billable request.
    result = client.request("POST", "/videos", request_body, job["idempotency_key"])
    if not result.get("video_id"):
        raise RuntimeError("video_idが返りませんでした。同じジョブを保持してください。")
    job.update(video_id=result["video_id"], status=result.get("status", "waiting"),
               output_format=result.get("output_format"))
    save_json(job_path, job)
    if result.get("output_format") != "webm":
        raise RuntimeError("透過WebMが受理されたことを確認できません。追加生成せずHeyGen側でこのvideo_idを確認してください。")
    return job


def download(url, output):
    if urlparse(url).scheme != "https":
        raise ValueError("ダウンロードURLはHTTPSが必要です。")
    output = Path(output)
    if output.exists():
        raise ValueError(f"既存ファイルを上書きしません: {output}")
    output.parent.mkdir(parents=True, exist_ok=True)
    fd, name = tempfile.mkstemp(prefix=output.name + ".", suffix=".part", dir=output.parent)
    os.close(fd)
    temporary = Path(name)
    try:
        # No API-key header on media/CDN requests.
        with urlopen(url, timeout=60) as response, temporary.open("wb") as stream:
            while block := response.read(1024 * 1024):
                stream.write(block)
        temporary.replace(output)
    finally:
        temporary.unlink(missing_ok=True)


def resume(client, job_path, output):
    job = read_json(job_path)
    if not job.get("video_id"):
        raise ValueError("video_id未取得です。同じrenderコマンドで再開してください。")
    if job.get("output_format") != "webm":
        raise ValueError("このジョブでは透過WebMの受理を確認できていません。")
    data = client.request("GET", "/videos/" + quote(job["video_id"], safe=""))
    job["status"] = data["status"]
    save_json(job_path, job)  # Do not persist expiring signed download URLs.
    if data["status"] == "failed":
        raise RuntimeError("HeyGenの生成が失敗しました。管理画面でこのvideo_idを確認してください。")
    if data["status"] == "completed" and output:
        if Path(output).suffix.lower() != ".webm":
            raise ValueError("取得先は.webmを指定してください。MOVへの変換はexportで行います。")
        download(data["video_url"], output)
        job["downloaded_file"] = str(Path(output).resolve())
        save_json(job_path, job)
    return {"video_id": job["video_id"], "status": job["status"],
            "downloaded_file": job.get("downloaded_file")}


def run_media(command):
    result = subprocess.run(command, capture_output=True)
    if result.returncode:
        raise RuntimeError(result.stderr.decode(errors="replace")[-2500:])
    return result.stdout


def probe(path):
    return json.loads(run_media(["ffprobe", "-v", "error", "-show_streams",
                                "-show_format", "-of", "json", str(path)]))


def decoder_for(info):
    video = next(s for s in info["streams"] if s["codec_type"] == "video")
    # FFmpeg's native VP9 decoder can silently discard WebM alpha.
    return {"vp9": ["-c:v", "libvpx-vp9"], "vp8": ["-c:v", "libvpx"]}.get(video["codec_name"], [])


def check_alpha(path):
    info = probe(path)
    duration = float(info.get("format", {}).get("duration", 0))
    samples = sorted(set([0, duration / 2, max(0, duration - 0.2)]))
    low, high = 255, 0
    for position in samples:
        raw = run_media(["ffmpeg", "-v", "error", *decoder_for(info), "-i", str(path),
                         "-ss", str(position), "-map", "0:v:0", "-vf", "alphaextract,scale=64:64",
                         "-frames:v", "1", "-f", "rawvideo", "-pix_fmt", "gray", "pipe:1"])
        if raw:
            low, high = min(low, min(raw)), max(high, max(raw))
    if low == 255 or high == 0:
        raise ValueError("有効な透過と被写体を確認できません。透過WebMか、黒背景が焼き込まれていないか確認してください。")
    return {"alpha_min": low, "alpha_max": high, "sample_seconds": samples,
            "note": "3時点の画素を検証。全フレームや髪・指の境界品質は別途目視確認が必要。"}


def export_mov(source, output):
    source, output = Path(source), Path(output)
    if output.suffix.lower() != ".mov":
        raise ValueError("ProRes 4444の出力先には.movを指定してください。")
    if output.exists():
        raise ValueError("既存の出力を上書きしません。別名を指定してください。")
    check_alpha(source)
    output.parent.mkdir(parents=True, exist_ok=True)
    fd, name = tempfile.mkstemp(prefix=output.stem + ".", suffix=".mov", dir=output.parent)
    os.close(fd)
    temporary = Path(name)
    try:
        run_media(["ffmpeg", "-v", "error", "-y", *decoder_for(probe(source)), "-i", str(source),
                   "-map", "0:v:0", "-map", "0:a?", "-c:v", "prores_ks", "-profile:v", "4",
                   "-pix_fmt", "yuva444p10le", "-alpha_bits", "16", "-c:a", "pcm_s16le",
                   str(temporary)])
        check_alpha(temporary)
        temporary.replace(output)
    finally:
        temporary.unlink(missing_ok=True)
    return {"output": str(output.resolve()), "codec": "ProRes 4444", "alpha": check_alpha(output)}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    commands = parser.add_subparsers(dest="command", required=True)
    for name in ("plan", "render"):
        p = commands.add_parser(name)
        p.add_argument("--profile", required=True)
        p.add_argument("--script", required=True)
        if name == "render":
            p.add_argument("--job", required=True)
    p = commands.add_parser("resume")
    p.add_argument("--job", required=True)
    p.add_argument("--out")
    for name in ("export", "inspect"):
        p = commands.add_parser(name)
        p.add_argument("--input", required=True)
        if name == "export":
            p.add_argument("--out", required=True)
    p = commands.add_parser("extract-audio")
    p.add_argument("--input", required=True)
    p.add_argument("--start", required=True, type=float)
    p.add_argument("--end", required=True, type=float)
    p.add_argument("--out", required=True)
    args = parser.parse_args()
    if args.command in ("plan", "render"):
        body = payload(read_json(args.profile), Path(args.script).read_text(encoding="utf-8"))
        if args.command == "plan":
            result = body  # Offline: no key, no network, no charge.
        else:
            job = submit(HeyGen(), body, args.job)
            result = {"video_id": job["video_id"], "status": job["status"], "job": args.job}
    elif args.command == "resume":
        result = resume(HeyGen(), args.job, args.out)
    elif args.command == "export":
        result = export_mov(args.input, args.out)
    elif args.command == "inspect":
        result = {"media": probe(args.input), "alpha": check_alpha(args.input)}
    else:
        if not 0 <= args.start < args.end:
            raise ValueError("0 <= start < end が必要です。")
        if Path(args.out).suffix.lower() != ".wav":
            raise ValueError("音声の出力先は.wavを指定してください。")
        duration = float(probe(args.input)["format"]["duration"])
        if args.end > duration:
            raise ValueError("指定した終了時刻が素材の長さを超えています。")
        Path(args.out).parent.mkdir(parents=True, exist_ok=True)
        run_media(["ffmpeg", "-v", "error", "-n", "-i", args.input, "-ss", str(args.start),
                   "-t", str(args.end - args.start), "-map", "0:a:0", "-vn", "-ac", "1",
                   "-ar", "48000", "-c:a", "pcm_s16le", args.out])
        result = {"output": args.out, "duration": args.end - args.start}
    print(json.dumps(result, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    try:
        main()
    except (ValueError, RuntimeError, OSError, KeyError, StopIteration) as error:
        print(f"ERROR: {error}", file=sys.stderr)
        sys.exit(1)
