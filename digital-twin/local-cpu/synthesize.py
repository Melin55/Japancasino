#!/usr/bin/env python3
"""Generate Japanese speech from an authorized reference using GPT-SoVITS v2."""
import argparse
import json
import os
from pathlib import Path
import sys
import time


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--engine-root", type=Path, required=True)
    parser.add_argument("--reference-audio", type=Path, required=True)
    parser.add_argument("--reference-text", type=Path, required=True)
    parser.add_argument("--script", type=Path, required=True)
    parser.add_argument("--out", type=Path, required=True)
    parser.add_argument("--threads", type=int, default=4)
    args = parser.parse_args()
    root, audio, prompt_file, script_file, out = [p.resolve() for p in
        (args.engine_root, args.reference_audio, args.reference_text, args.script, args.out)]
    for file in (root / "GPT_SoVITS/TTS_infer_pack/TTS.py", audio, prompt_file, script_file):
        if not file.is_file():
            parser.error(f"Missing file: {file}")
    if args.threads < 1 or out.suffix.lower() != ".wav":
        parser.error("Use a positive thread count and a .wav output")
    if out.exists() or out.with_suffix(".json").exists():
        parser.error("Choose a new output path; existing results are not overwritten")
    prompt = prompt_file.read_text(encoding="utf-8").strip()
    script = script_file.read_text(encoding="utf-8").strip()
    if not prompt or not script:
        parser.error("Reference transcript and target script must be nonempty")
    out.parent.mkdir(parents=True, exist_ok=True)
    for key, name in [("HF_HOME", "hf-cache"), ("XDG_CACHE_HOME", "cache"),
                      ("NLTK_DATA", "nltk-data"), ("MPLCONFIGDIR", "matplotlib")]:
        os.environ.setdefault(key, str(out.parent / name))
    os.chdir(root)
    sys.path[:0] = [str(root), str(root / "GPT_SoVITS")]
    import numpy as np
    import soundfile as sf
    import torch
    torch.set_num_threads(args.threads)
    torch.set_num_interop_threads(1)
    from TTS_infer_pack.TTS import TTS, TTS_Config
    started = time.monotonic()
    tts = TTS(TTS_Config({"version": "v2"}))
    loaded = time.monotonic()
    results = list(tts.run({"text": script, "text_lang": "all_ja", "ref_audio_path": str(audio),
                            "prompt_text": prompt, "prompt_lang": "all_ja", "text_split_method": "cut0",
                            "batch_size": 1, "seed": 42, "parallel_infer": True, "return_fragment": False}))
    if len(results) != 1:
        raise RuntimeError("Expected one complete speech result")
    rate, waveform = results[0]
    if not len(waveform) or not np.isfinite(waveform).all() or not np.any(waveform):
        raise RuntimeError("Speech generation returned empty, non-finite or silent audio")
    sf.write(out, waveform, rate, subtype="PCM_16")
    result = {"script": script, "engine": "GPT-SoVITS v2", "device": "CPU", "synthetic": True,
              "load_seconds": loaded - started, "inference_seconds": time.monotonic() - loaded,
              "audio_duration_seconds": len(waveform) / rate, "likeness_verified": False}
    out.with_suffix(".json").write_text(json.dumps(result, ensure_ascii=False, indent=2), encoding="utf-8")
    print(json.dumps(result, ensure_ascii=False))


if __name__ == "__main__":
    main()
