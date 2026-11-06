"""Apply an explicitly requested whole-video speed change with pitch preserved."""
import argparse
import json
from pathlib import Path
import subprocess


def probe(path):
    return json.loads(subprocess.check_output(['ffprobe', '-v', 'error',
        '-show_streams', '-show_format', '-of', 'json', str(path)], text=True))


def main():
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument('--input', type=Path, required=True)
    ap.add_argument('--speed', type=float, required=True)
    ap.add_argument('--out', type=Path, required=True)
    args = ap.parse_args()
    if not .5 <= args.speed <= 2:
        ap.error('Supported speed range: 0.5 to 2.0')
    if args.out.exists() or args.out.with_suffix('.json').exists():
        ap.error('Choose a new output path')
    source = probe(args.input)
    video = next(s for s in source['streams'] if s['codec_type'] == 'video')
    expected = float(video['duration']) / args.speed
    args.out.parent.mkdir(parents=True, exist_ok=True)
    subprocess.run(['ffmpeg', '-nostdin', '-v', 'error', '-n', '-threads', '2',
        '-i', str(args.input), '-map', '0:v:0', '-map', '0:a:0',
        '-vf', f'setpts=(PTS-STARTPTS)/{args.speed},fps=50',
        '-af', f'asetpts=PTS-STARTPTS,rubberband=tempo={args.speed}:pitch=1:formant=preserved',
        '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '18', '-threads', '2',
        '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-b:a', '256k', '-ar', '48000',
        '-movflags', '+faststart', str(args.out)], check=True)
    result = probe(args.out)
    streams = {s['codec_type']: s for s in result['streams']}
    for kind in ['video', 'audio']:
        if abs(float(streams[kind]['duration']) - expected) > .025:
            raise RuntimeError(f'{kind} duration does not match requested speed')
    if (streams['video']['width'], streams['video']['height']) != (video['width'], video['height']):
        raise RuntimeError('Unexpected dimension change')
    subprocess.run(['ffmpeg', '-v', 'error', '-xerror', '-i', str(args.out),
                    '-f', 'null', '-'], check=True)
    report = {'speed_relative_to_input': args.speed, 'audio_pitch_factor': 1,
              'scope': 'entire picture and mixed dialogue/BGM, including pauses and fades',
              'expected_seconds': expected, 'probe': result, 'full_decode': 'passed',
              'bytes': args.out.stat().st_size, 'listening_review': False}
    args.out.with_suffix('.json').write_text(json.dumps(report, indent=2))
    print(json.dumps({'file': str(args.out), 'seconds': result['format']['duration'],
                      'bytes': args.out.stat().st_size}), flush=True)


if __name__ == '__main__':
    main()
