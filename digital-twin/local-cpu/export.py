#!/usr/bin/env python3
"""Export a still-pose avatar using its original transparent portrait mask."""
import argparse
import importlib.util
import json
import os
from pathlib import Path
import subprocess


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--video", type=Path, required=True)
    parser.add_argument("--portrait", type=Path, required=True)
    parser.add_argument("--out", type=Path, required=True)
    args = parser.parse_args()
    video, portrait, out = [p.resolve() for p in (args.video, args.portrait, args.out)]
    if out.exists() and any(out.iterdir()):
        parser.error("Choose an empty output directory; existing files are not overwritten")
    helper = Path(__file__).resolve().parents[1] / "twin.py"
    spec = importlib.util.spec_from_file_location("twin_media", helper)
    media = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(media)
    video_info, portrait_info = media.probe(video), media.probe(portrait)
    stream = next(s for s in video_info["streams"] if s["codec_type"] == "video")
    image = next(s for s in portrait_info["streams"] if s["codec_type"] == "video")
    if (stream["width"], stream["height"]) != (image["width"], image["height"]):
        parser.error("Video and portrait dimensions must match; use SadTalker full mode")
    if not any(s["codec_type"] == "audio" for s in video_info["streams"]):
        parser.error("Input video has no speech track")
    media.check_alpha(portrait)
    duration = float(stream.get("duration") or video_info["format"]["duration"])
    if duration <= 0:
        parser.error("Input video must have a positive duration")
    out.mkdir(parents=True, exist_ok=True)
    os.environ.setdefault("XDG_CACHE_HOME", str(out / "cache"))
    webm, mov, preview = [out / name for name in ("avatar-alpha.webm", "avatar-alpha.mov", "preview.mp4")]
    mask_filter = (
        "[1:v]alphaextract[a];[0:v]setpts=PTS-STARTPTS[rgb];"
        "[rgb][a]alphamerge,"
        "scale=1080:1920:force_original_aspect_ratio=decrease:force_divisible_by=2:flags=lanczos,"
        "pad=1080:1920:(ow-iw)/2:oh-ih:color=black@0,format=yuva420p[v];"
        "[0:a]asetpts=PTS-STARTPTS,apad[audio]"
    )
    subprocess.run(["ffmpeg", "-hide_banner", "-loglevel", "error", "-n", "-i", str(video),
                    "-loop", "1", "-framerate", stream["avg_frame_rate"], "-i", str(portrait),
                    "-filter_complex", mask_filter, "-map", "[v]", "-map", "[audio]",
                    "-c:v", "libvpx-vp9", "-crf", "22", "-b:v", "0", "-auto-alt-ref", "0",
                    "-threads", "2", "-c:a", "libopus", "-t", str(duration), str(webm)], check=True)
    alpha = media.check_alpha(webm)
    mov_result = media.export_mov(webm, mov)
    checker = ("nullsrc=s=1080x1920:r=" + stream["avg_frame_rate"] +
               ",geq=lum='if(mod(floor(X/60)+floor(Y/60),2),220,245)':cb=128:cr=128")
    preview_filter = (
        "[1:v]setpts=PTS-STARTPTS[fg];[0:v][fg]overlay=shortest=1,"
        "drawtext=text='AI GENERATED - PREVIEW':x=48:y=60:fontsize=32:fontcolor=0x334155[v];"
        "[1:a]asetpts=PTS-STARTPTS,apad[a]"
    )
    subprocess.run(["ffmpeg", "-hide_banner", "-loglevel", "error", "-n", "-f", "lavfi", "-i", checker,
                    "-c:v", "libvpx-vp9", "-i", str(webm), "-filter_complex", preview_filter,
                    "-map", "[v]", "-map", "[a]", "-c:v", "libx264", "-crf", "18",
                    "-pix_fmt", "yuv420p", "-c:a", "aac", "-movflags", "+faststart",
                    "-t", str(duration), str(preview)], check=True)
    result = {"webm": str(webm), "mov": mov_result, "preview": str(preview),
              "alpha": alpha, "dimensions": [1080, 1920], "duration_seconds": duration,
              "mask": "Original portrait alpha; suitable only for matching fixed silhouettes",
              "boundary_quality": "Requires visual inspection, including moving face/hair edges"}
    (out / "export.json").write_text(json.dumps(result, ensure_ascii=False, indent=2), encoding="utf-8")
    print(json.dumps(result, ensure_ascii=False))


if __name__ == "__main__":
    main()
