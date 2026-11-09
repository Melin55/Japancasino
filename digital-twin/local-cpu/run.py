#!/usr/bin/env python3
"""Run the local CPU voice, frontal animation and transparent video pipeline."""
import argparse
import json
from pathlib import Path
import subprocess
import sys


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--profile", type=Path, required=True)
    parser.add_argument("--script", type=Path, required=True)
    parser.add_argument("--out", type=Path, required=True)
    parser.add_argument("--dry-run", action="store_true", help="Validate paths and print stages without loading models")
    args = parser.parse_args()
    profile_file = args.profile.resolve()
    profile = json.loads(profile_file.read_text(encoding="utf-8"))
    required = ("gpt_sovits_root", "sadtalker_root", "portrait", "reference_audio", "reference_text")
    paths = {}
    for key in required:
        value = profile.get(key)
        if not isinstance(value, str) or not value:
            parser.error(f"Profile requires a nonempty path: {key}")
        paths[key] = (profile_file.parent / value).resolve()
        if not paths[key].exists():
            parser.error(f"Missing {key}: {paths[key]}")
    threads, size, bf16 = profile.get("threads", 4), profile.get("face_size", 512), profile.get("bf16", False)
    if type(threads) is not int or threads < 1 or size not in (256, 512) or type(bf16) is not bool:
        parser.error("Use positive integer threads, face_size 256/512, and boolean bf16")
    stride = profile.get("frame_stride", 1)
    if type(stride) is not int or stride not in (1, 2):
        parser.error("frame_stride must be 1 or 2")
    script, out = args.script.resolve(), args.out.resolve()
    if not script.is_file() or not script.read_text(encoding="utf-8").strip():
        parser.error("Script must be a nonempty UTF-8 text file")
    if out.exists() and any(out.iterdir()):
        parser.error("Choose an empty output directory")
    source = Path(__file__).resolve().parent
    speech = [sys.executable, str(source / "synthesize.py"), "--engine-root", str(paths["gpt_sovits_root"]),
              "--reference-audio", str(paths["reference_audio"]), "--reference-text", str(paths["reference_text"]),
              "--script", str(script), "--out", str(out / "speech.wav"), "--threads", str(threads)]
    animation = [sys.executable, str(source / "animate.py"), "--engine-root", str(paths["sadtalker_root"]),
                 "--image", str(paths["portrait"]), "--audio", str(out / "speech.wav"),
                 "--out", str(out / "animation"), "--size", str(size), "--threads", str(threads),
                 "--frame-stride", str(stride)]
    if bf16:
        animation.append("--bf16")
    plan = {"speech": speech, "animation": animation,
            "export": {"portrait": str(paths["portrait"]), "out": str(out / "export")}}
    if args.dry_run:
        print(json.dumps(plan, ensure_ascii=False, indent=2))
        return
    out.mkdir(parents=True, exist_ok=True)
    state = {"status": "running", "stage": "speech", "plan": plan}
    state_file = out / "job.json"

    def save():
        state_file.write_text(json.dumps(state, ensure_ascii=False, indent=2), encoding="utf-8")

    save()
    try:
        subprocess.run(speech, check=True)
        state["stage"] = "animation"
        save()
        subprocess.run(animation, check=True)
        video = json.loads((out / "animation/render.json").read_text(encoding="utf-8"))["video"]
        state["stage"] = "export"
        save()
        subprocess.run([sys.executable, str(source / "export.py"), "--video", video,
                        "--portrait", str(paths["portrait"]), "--out", str(out / "export")], check=True)
        state.update(status="completed", output=str(out / "export"))
        save()
        print(json.dumps(state, ensure_ascii=False, indent=2))
    except Exception as error:
        state.update(status="failed", error=str(error))
        save()
        raise


if __name__ == "__main__":
    main()
