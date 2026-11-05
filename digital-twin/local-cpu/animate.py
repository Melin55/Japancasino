#!/usr/bin/env python3
"""Render a frontal, still-pose presenter with a separately installed SadTalker."""
import argparse
import json
import os
from pathlib import Path
import runpy
import subprocess
import sys
import time


def install_source_caches(generator, torch):
    """Cache constant source encoders, checking input and first reused output."""
    modules = [("first", generator.first)]
    modules += [(f"down_{i}", module) for i, module in enumerate(generator.down_blocks)]
    modules += [("second", generator.second), ("resblocks_3d", generator.resblocks_3d)]
    restored = []

    def install(name, module):
        forward = module.forward
        state = {"input": None, "output": None, "verified": False, "hits": 0}

        def cached(value):
            if state["input"] is not None and torch.equal(value, state["input"]):
                if not state["verified"]:
                    if not torch.equal(forward(value), state["output"]):
                        raise RuntimeError(f"Source cache differs from uncached output: {name}")
                    state["verified"] = True
                state["hits"] += 1
                return state["output"]
            state["input"] = value.clone()
            state["output"] = forward(value)
            state["verified"] = False
            return state["output"]

        module.forward = cached
        restored.append((name, module, forward, state))

    for name, module in modules:
        install(name, module)
    return restored


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--engine-root", type=Path, required=True)
    parser.add_argument("--image", type=Path, required=True)
    parser.add_argument("--audio", type=Path, required=True)
    parser.add_argument("--out", type=Path, required=True)
    parser.add_argument("--size", type=int, choices=[256, 512], default=512)
    parser.add_argument("--threads", type=int, default=4)
    parser.add_argument("--frame-stride", type=int, choices=[1, 2], default=1,
                        help="Render every second expression frame and interpolate missing frames with optical flow")
    parser.add_argument("--bf16", action="store_true", help="Opt-in CPU BF16; tested on Linux EPYC, not Intel Mac")
    args = parser.parse_args()
    root, portrait, audio, out = [p.resolve() for p in
                                  (args.engine_root, args.image, args.audio, args.out)]
    for file in (root / "inference.py", portrait, audio):
        if not file.is_file():
            parser.error(f"Missing file: {file}")
    if args.threads < 1:
        parser.error("--threads must be positive")
    duration = float(subprocess.check_output([
        "ffprobe", "-v", "error", "-show_entries", "format=duration",
        "-of", "default=noprint_wrappers=1:nokey=1", str(audio)], text=True))
    if duration < 0.2:
        parser.error("SadTalker pose smoothing requires at least 0.2 seconds of audio")
    if out.exists() and any(out.iterdir()):
        parser.error("Choose an empty output directory; existing results are not overwritten")
    out.mkdir(parents=True, exist_ok=True)
    for key, name in [("XDG_CACHE_HOME", "cache"), ("MPLCONFIGDIR", "matplotlib"), ("TORCH_HOME", "torch-cache")]:
        os.environ.setdefault(key, str(out / name))
    os.chdir(root)
    sys.path.insert(0, str(root))
    import torch
    import cv2
    cv2.setNumThreads(1)
    import numpy as np
    import torchvision.transforms.functional as functional
    torch.set_num_threads(args.threads)
    torch.set_num_interop_threads(1)
    # BasicSR 1.4.2 imports the module name removed in torchvision 0.17.
    sys.modules["torchvision.transforms.functional_tensor"] = functional
    import src.facerender.animate as animation
    original = animation.make_animation
    cache_report = []

    def render(*positional, **keyword):
        # Only the source encoders are cached. Expressions use their original audio timing.
        original_count = positional[2].shape[1]
        indices = list(range(0, original_count, args.frame_stride))
        if indices[-1] != original_count - 1:
            indices.append(original_count - 1)
        selected = list(positional)
        selected[2] = positional[2][:, indices]
        for index in (7, 8, 9):
            if len(selected) > index and selected[index] is not None:
                selected[index] = selected[index][:, indices]
        generator = positional[3]
        restored = install_source_caches(generator, torch)
        forward = generator.forward
        progress = {"count": 0}
        def capture(*a, **kw):
            result = forward(*a, **kw)
            index = progress["count"]
            if index in (0, 1, 2, 25, 50, 100):
                rgb = result["prediction"][0].detach().float().cpu().permute(1, 2, 0).numpy()
                cv2.imwrite(str(out / f"face-keyframe-{indices[index]}.jpg"),
                            cv2.cvtColor((rgb.clip(0, 1)*255).astype(np.uint8), cv2.COLOR_RGB2BGR))
            progress["count"] += 1
            return result
        generator.forward = capture
        try:
            with torch.autocast("cpu", dtype=torch.bfloat16, enabled=args.bf16):
                result = original(*selected, **keyword).float()
            if args.frame_stride == 1:
                return result
            if result.shape[0] != 1:
                raise RuntimeError("Sparse interpolation expects batch size one")
            frames = result[0].cpu().permute(0, 2, 3, 1).numpy()
            height, width = frames.shape[1:3]
            yy, xx = np.indices((height, width), dtype=np.float32)
            flow = cv2.DISOpticalFlow_create(cv2.DISOPTICAL_FLOW_PRESET_MEDIUM)
            expanded = []
            for k in range(len(indices)-1):
                left, right = frames[k], frames[k+1]
                expanded.append(left)
                gap = indices[k+1] - indices[k]
                if gap > 1:
                    ga = cv2.cvtColor((left.clip(0,1)*255).astype(np.uint8), cv2.COLOR_RGB2GRAY)
                    gb = cv2.cvtColor((right.clip(0,1)*255).astype(np.uint8), cv2.COLOR_RGB2GRAY)
                    ab, ba = flow.calc(ga, gb, None), flow.calc(gb, ga, None)
                    for step in range(1, gap):
                        t = step/gap
                        wa = cv2.remap(left, xx-ab[:,:,0]*t, yy-ab[:,:,1]*t,
                                       cv2.INTER_LINEAR, borderMode=cv2.BORDER_REPLICATE)
                        wb = cv2.remap(right, xx-ba[:,:,0]*(1-t), yy-ba[:,:,1]*(1-t),
                                       cv2.INTER_LINEAR, borderMode=cv2.BORDER_REPLICATE)
                        expanded.append((wa*(1-t)+wb*t).clip(0,1))
            expanded.append(frames[-1])
            if len(expanded) != original_count:
                raise RuntimeError("Interpolation changed the number of speech frames")
            return torch.from_numpy(np.stack(expanded)).permute(0,3,1,2).unsqueeze(0)
        finally:
            generator.forward = forward
            for name, module, forward, state in restored:
                module.forward = forward
                cache_report.append({"module": name, "verified_equal_to_uncached": state["verified"], "hits": state["hits"]})

    animation.make_animation = render
    sys.argv = ["inference.py", "--cpu", "--still", "--size", str(args.size),
                "--batch_size", "1", "--preprocess", "full", "--source_image", str(portrait),
                "--driven_audio", str(audio), "--result_dir", str(out / "video"),
                "--input_yaw", "0", "--input_pitch", "0", "--input_roll", "0"]
    started = time.monotonic()
    runpy.run_path(str(root / "inference.py"), run_name="__main__")
    videos = list((out / "video").glob("*.mp4"))
    if len(videos) != 1:
        raise RuntimeError(f"Expected one generated video, found {len(videos)}")
    result = {"video": str(videos[0]), "engine": "SadTalker", "device": "CPU",
              "torch": torch.__version__, "bf16": args.bf16, "face_render_pixels": args.size, "frame_stride": args.frame_stride,
              "interpolation": "bidirectional optical flow" if args.frame_stride > 1 else None,
              "seconds": time.monotonic() - started, "source_encoder_cache": cache_report}
    (out / "render.json").write_text(json.dumps(result, ensure_ascii=False, indent=2), encoding="utf-8")
    print(json.dumps(result, ensure_ascii=False))


if __name__ == "__main__":
    main()
