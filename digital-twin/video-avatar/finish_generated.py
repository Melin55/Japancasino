"""Finish a generated standing interview clip without changing its body motion.

Preserves the provider watermark and audio. Native 25 fps footage is not looped,
reversed, retimed or interpolated. Fonts and private media stay outside Git.
"""
import argparse
import json
from pathlib import Path
import subprocess

from PIL import Image, ImageDraw, ImageFont


def run(argv):
    subprocess.run(argv, check=True)


def probe(path):
    return json.loads(subprocess.check_output([
        'ffprobe', '-v', 'error', '-show_streams', '-show_format',
        '-of', 'json', str(path)], text=True))


def header(display_font, name_font, out):
    """Compact gold panel stays above the head in the standing reference."""
    image = Image.new('RGBA', (1080, 1920))
    draw = ImageDraw.Draw(image)
    draw.rounded_rectangle((64, 20, 1016, 200), 18,
                           fill=(8, 29, 22, 242), outline=(217, 179, 91), width=3)
    draw.rounded_rectangle((74, 30, 1006, 190), 12,
                           outline=(112, 87, 40), width=1)
    rows = [
        ('日本カジノスクール　校長 大岩根成悦', name_font, 26, 52, (235, 207, 140)),
        ('初めてでも大丈夫？', display_font, 38, 102, (253, 248, 229)),
        ('基本から、一緒に。', display_font, 43, 158, (246, 209, 119)),
    ]
    for text, font_path, size, y, color in rows:
        font = ImageFont.truetype(str(font_path), size)
        box = draw.textbbox((0, 0), text, font=font)
        if box[2] - box[0] > 900:
            raise ValueError('Header text exceeds safe area')
        draw.text((540, y), text, font=font, anchor='mm', fill=color)
    font = ImageFont.truetype(str(name_font), 22)
    draw.rounded_rectangle((66, 210, 212, 244), 5, fill=(8, 29, 22, 220))
    draw.text((139, 226), '生成映像', font=font, anchor='mm', fill=(241, 211, 143))
    image.save(out)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--input', type=Path, required=True)
    parser.add_argument('--previous', type=Path)
    parser.add_argument('--display-font', type=Path, required=True)
    parser.add_argument('--name-font', type=Path, required=True)
    parser.add_argument('--out', type=Path, required=True)
    args = parser.parse_args()
    for path in [args.input, args.display_font, args.name_font, args.previous]:
        if path and not path.is_file():
            parser.error(f'Missing input: {path}')
    args.out.mkdir(parents=True, exist_ok=True)
    final = args.out / 'standing-interview-1080p.mp4'
    compare = args.out / 'comparison-v7-v8.mp4'
    if final.exists() or compare.exists():
        parser.error('Use a new output directory; outputs are not overwritten')
    metadata = probe(args.input)
    stream = next(s for s in metadata['streams'] if s['codec_type'] == 'video')
    duration = float(stream['duration'])
    overlay = args.out / 'gold-header.png'
    header(args.display_font, args.name_font, overlay)
    base = ['ffmpeg', '-hide_banner', '-loglevel', 'warning',
            '-filter_complex_threads', '2', '-threads', '2']
    encode = ['-c:v', 'libx264', '-preset', 'medium', '-crf', '18',
              '-threads', '2', '-pix_fmt', 'yuv420p', '-movflags', '+faststart']
    run(base + ['-i', str(args.input), '-i', str(overlay), '-filter_complex',
                '[0:v]scale=1080:1920:flags=lanczos,setsar=1[scaled];'
                '[scaled][1:v]overlay=0:0:format=auto,format=yuv420p[v]',
                '-map', '[v]', '-map', '0:a:0', *encode, '-c:a', 'copy', str(final)])
    if args.previous:
        seconds = min(duration, float(probe(args.previous)['format']['duration']))
        labels = {'left': '前回｜座り姿・実写の身振り',
                  'right': '今回｜④の構図・動きも生成',
                  'note': '左右を同時再生・音声は共通',
                  'detail': '比較用に同じ表示サイズへ縮小'}
        for name, value in labels.items():
            (args.out / (name + '.txt')).write_text(value, encoding='utf-8')

        def text(name, x, y, size, color='white'):
            return (f'drawtext=fontfile={args.name_font}:'
                    f'textfile={args.out / (name + ".txt")}:x={x}:y={y}:'
                    f'fontsize={size}:fontcolor={color}')

        filters = [
            '[0:v]fps=25,scale=594:1056:flags=lanczos,setsar=1,setpts=PTS-STARTPTS[l]',
            '[1:v]fps=25,scale=594:1056:flags=lanczos,setsar=1,setpts=PTS-STARTPTS[r]',
            f'color=c=0x081d16:s=1280x1280:r=25:d={seconds}[bg]',
            '[bg][l]overlay=30:100:shortest=1[half]',
            '[half][r]overlay=656:100:shortest=1,' + ','.join([
                text('left', '327-text_w/2', 30, 27),
                text('right', '953-text_w/2', 30, 27),
                text('note', '(w-text_w)/2', 1180, 30, '0xf2d177'),
                text('detail', '(w-text_w)/2', 1230, 21, '0xb8c2bd')]) + '[v]']
        run(base + ['-i', str(args.previous), '-i', str(final),
                    '-filter_complex', ';'.join(filters), '-map', '[v]', '-map', '1:a:0',
                    '-t', str(seconds), *encode, '-c:a', 'aac', '-b:a', '192k', str(compare)])
    outputs = [final] + ([compare] if args.previous else [])
    checks = []
    for path in outputs:
        run(['ffmpeg', '-v', 'error', '-xerror', '-i', str(path), '-f', 'null', '-'])
        checks.append({'file': path.name, 'bytes': path.stat().st_size,
                       'probe': probe(path), 'full_decode': 'passed'})
    (args.out / 'export-validation.json').write_text(json.dumps({
        'source_dimensions': [stream['width'], stream['height']],
        'source_fps': stream['r_frame_rate'], 'source_duration': duration,
        'upscaled': stream['height'] < 1920,
        'provider_watermark': 'preserved', 'audio': 'provider audio preserved in main export',
        'motion': 'native generated frames; no loop, reverse, retime or interpolation',
        'outputs': checks}, ensure_ascii=False, indent=2), encoding='utf-8')
    print('Finished and decoded:', ', '.join(str(p) for p in outputs), flush=True)


if __name__ == '__main__':
    main()
