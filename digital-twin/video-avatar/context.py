"""Paths shared by the CPU video-avatar stages; no models or media in Git."""
import argparse
import json
from pathlib import Path
import sys


def context(description):
    parser = argparse.ArgumentParser(description=description)
    parser.add_argument('--profile', type=Path, required=True)
    parser.add_argument('--out', type=Path, required=True)
    parser.add_argument('--frames', type=int, help='Optional short diagnostic render')
    parser.add_argument('--fp32', action='store_true', help='Disable BF16 in the lip-sync stage')
    args = parser.parse_args()
    profile = args.profile.resolve()
    cfg = json.loads(profile.read_text(encoding='utf-8'))
    path_keys = ['musetalk_root', 'rvm_root', 'lama_model', 'facexlib_weights',
                 'gpt_sovits_root', 'reference_audio', 'reference_text', 'motion_video', 'extra_python_path']
    for key in path_keys:
        if cfg.get(key):
            value = Path(cfg[key]).expanduser()
            cfg[key] = value.resolve() if value.is_absolute() else (profile.parent / value).resolve()
    if cfg.get('extra_python_path'):
        sys.path.insert(0, str(cfg['extra_python_path']))
    out = args.out.resolve()
    work = out / 'work'
    work.mkdir(parents=True, exist_ok=True)
    return args, cfg, out, work
