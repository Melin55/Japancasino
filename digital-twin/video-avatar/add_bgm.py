"""Mix a selected music excerpt under dialogue, copying video without re-encoding.

Supply music locally; this script neither acquires music nor grants music rights.
"""
import argparse
import hashlib
import json
from pathlib import Path
import subprocess


def probe(path):
    return json.loads(subprocess.check_output([
        'ffprobe', '-v', 'error', '-show_streams', '-show_format',
        '-of', 'json', str(path)], text=True))


def video_hash(path):
    data = subprocess.check_output(['ffmpeg', '-v', 'error', '-i', str(path),
        '-map', '0:v:0', '-c', 'copy', '-f', 'h264', 'pipe:1'])
    return hashlib.sha256(data).hexdigest()


def main():
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument('--input', type=Path, required=True)
    ap.add_argument('--music', type=Path, required=True)
    ap.add_argument('--start', type=float, default=0)
    ap.add_argument('--music-gain-db', type=float, default=-18)
    ap.add_argument('--out', type=Path, required=True)
    args = ap.parse_args()
    if args.out.exists() or args.out.with_suffix('.json').exists():
        ap.error('Choose a new output path')
    source = probe(args.input)
    duration = float(next(x for x in source['streams'] if x['codec_type']=='video')['duration'])
    music_duration = float(probe(args.music)['format']['duration'])
    if args.start < 0 or args.start+duration > music_duration:
        ap.error('Music must cover the complete chosen excerpt without looping')
    if duration < 1 or args.music_gain_db > 0:
        ap.error('Use at least one second of video and a nonpositive music gain')
    args.out.parent.mkdir(parents=True, exist_ok=True)
    graph = (
        f'[0:a]atrim=duration={duration},asetpts=PTS-STARTPTS,aresample=48000,'
        'aformat=sample_fmts=fltp:channel_layouts=stereo,asplit=2[voice][key];'
        f'[1:a]atrim=start={args.start}:duration={duration},asetpts=PTS-STARTPTS,'
        'aresample=48000,aformat=sample_fmts=fltp:channel_layouts=stereo,'
        f'volume={args.music_gain_db}dB,afade=t=in:d=0.08,'
        f'afade=t=out:st={duration-.72}:d=0.72[music];'
        '[music][key]sidechaincompress=threshold=0.035:ratio=3:attack=12:release=260:makeup=1[bed];'
        '[voice][bed]amix=inputs=2:duration=first:dropout_transition=0:normalize=0[mix]')
    subprocess.run(['ffmpeg', '-nostdin', '-v', 'error', '-n',
        '-i', str(args.input), '-i', str(args.music), '-filter_complex', graph,
        '-map', '0:v:0', '-map', '[mix]', '-c:v', 'copy', '-c:a', 'aac',
        '-b:a', '256k', '-ar', '48000', '-movflags', '+faststart', str(args.out)], check=True)
    subprocess.run(['ffmpeg', '-v', 'error', '-xerror', '-i', str(args.out), '-f', 'null', '-'], check=True)
    before, after = video_hash(args.input), video_hash(args.out)
    if before != after:
        raise RuntimeError('Video stream changed unexpectedly')
    output = probe(args.out)
    if abs(float(output['format']['duration'])-duration) > .025:
        raise RuntimeError('Output duration changed')
    report = {'duration': duration, 'music_start': args.start, 'music_gain_db': args.music_gain_db,
              'speech': 'original dialogue, no tempo or pitch changes',
              'ducking': {'threshold': .035, 'ratio': 3, 'attack_ms': 12, 'release_ms': 260},
              'music_fades_seconds': [.08, .72], 'video_sha256': after,
              'video_bitstream_identical': True, 'full_decode': 'passed',
              'bytes': args.out.stat().st_size, 'listen_review': False}
    args.out.with_suffix('.json').write_text(json.dumps(report, indent=2))
    print(json.dumps(report), flush=True)


if __name__ == '__main__':
    main()
