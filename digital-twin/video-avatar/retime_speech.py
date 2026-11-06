"""Explicitly requested speech-speed edit, preserving pauses and total runtime.

Use a reviewed timeline: speech intervals accelerate, pause intervals retain
their duration, and an existing nonspeaking tail absorbs the saved time. Audio
pitch is preserved by Rubber Band; video follows the same sample-based mapping.
This tool is not used automatically to force other videos into a runtime.
"""
import argparse
import json
from pathlib import Path
import subprocess
import time
import wave

import cv2
import numpy as np


RATE = 48000


def command(args, **kwargs):
    return subprocess.run(['ffmpeg', '-nostdin', '-v', 'error', '-n', *args],
                          check=True, **kwargs)


def save_wav(path, samples):
    with wave.open(str(path), 'wb') as file:
        file.setparams((1, 2, RATE, 0, 'NONE', 'not compressed'))
        file.writeframes(np.rint(np.clip(samples, -1, 32767 / 32768) * 32768)
                        .astype('<i2').tobytes())


def main():
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument('--input', type=Path, required=True)
    ap.add_argument('--timeline', type=Path, required=True)
    ap.add_argument('--overlay', type=Path, required=True)
    ap.add_argument('--out', type=Path, required=True)
    args = ap.parse_args()
    cfg = json.loads(args.timeline.read_text())
    speed = float(cfg['speech_speed'])
    if not 1 < speed <= 1.2:
        ap.error('This small speed adjustment supports 1.0 < speed <= 1.2')
    if args.out.exists():
        ap.error('Use a new output directory')
    args.out.mkdir(parents=True)
    cv2.setNumThreads(1)
    cap = cv2.VideoCapture(str(args.input))
    width, height = int(cap.get(3)), int(cap.get(4))
    fps = cap.get(5)
    frames = int(cap.get(cv2.CAP_PROP_FRAME_COUNT))
    if (width, height) != (720, 1280) or abs(fps - 25) > .001:
        ap.error('This preset expects the reviewed 720x1280, 25fps source')
    total_samples = round(frames / fps * RATE)
    starts, ends, kinds = [], [], []
    previous = 0
    for item in cfg['segments']:
        start, end = [round(float(item[k]) * RATE) for k in ['start', 'end']]
        if start != previous or end <= start or item['kind'] not in ['speech', 'pause', 'tail']:
            ap.error('Timeline must cover the source continuously with positive segments')
        starts.append(start); ends.append(end); kinds.append(item['kind']); previous = end
    if ends[-1] != total_samples or kinds[-1] != 'tail' or kinds.count('tail') != 1:
        ap.error('Timeline must end with one reviewed nonspeaking tail and match source duration')
    lengths = [round((b-a)/speed) if k == 'speech' else b-a
               for a, b, k in zip(starts, ends, kinds)]
    saved = total_samples - sum(lengths)
    lengths[-1] += saved
    output_edges = np.concatenate(([0], np.cumsum(lengths)))
    # PCM16 downmix keeps the speech level consistent with the previous export.
    raw = command(['-i', str(args.input), '-vn', '-ac', '1', '-ar', str(RATE),
                   '-f', 's16le', 'pipe:1'], stdout=subprocess.PIPE).stdout
    source_audio = np.frombuffer(raw, '<i2').astype(np.float32) / 32768
    if len(source_audio) < total_samples:
        source_audio = np.pad(source_audio, (0, total_samples-len(source_audio)))
    result = np.zeros(total_samples, np.float32)
    timeline = []
    for j, (a, b, kind, target) in enumerate(zip(starts, ends, kinds, lengths)):
        samples = source_audio[a:b]
        if kind == 'speech':
            processed = command([
                '-f', 'f32le', '-ar', str(RATE), '-ac', '1', '-i', 'pipe:0',
                '-af', f'rubberband=tempo={speed}:pitch=1:formant=preserved',
                '-f', 'f32le', 'pipe:1'], input=samples.astype('<f4').tobytes(),
                stdout=subprocess.PIPE).stdout
            edited = np.frombuffer(processed, '<f4').copy()
            mismatch = len(edited)-target
            if abs(mismatch) > .025 * RATE:
                raise RuntimeError(f'Unexpected Rubber Band duration mismatch: {mismatch} samples')
            edited = np.pad(edited, (0, max(0, target-len(edited))))[:target]
        elif kind == 'pause':
            edited = samples.copy()
            mismatch = 0
        else:
            # The original room-tone decay is retained; saved time follows it.
            edited = np.pad(samples, (0, target-len(samples)))
            mismatch = 0
        result[output_edges[j]:output_edges[j+1]] = edited
        timeline.append({'kind': kind, 'source_start': a/RATE, 'source_end': b/RATE,
                         'output_start': int(output_edges[j])/RATE,
                         'output_end': int(output_edges[j+1])/RATE,
                         'audio_rounding_samples': mismatch})
    # Fade only 3ms at low-energy joins to avoid sample discontinuities.
    joins = []
    for edge in output_edges[1:-1]:
        n = round(.003 * RATE)
        peak = float(np.max(np.abs(result[edge-n:edge+n])))
        if peak > .03:
            raise RuntimeError(f'A reviewed speech boundary is too loud to join safely: {edge/RATE:.4f}s, peak={peak:.5f}')
        result[edge-n:edge] *= np.linspace(1, 0, n)
        result[edge:edge+n] *= np.linspace(0, 1, n)
        joins.append({'sample': int(edge), 'pre_fade_peak': peak})
    speech = args.out/'speech.wav'
    save_wav(speech, result)
    out_fps = 50
    count = round(total_samples/RATE*out_fps)
    main_path = args.out/'standing-interview-faster-1080p50.mp4'
    plain_path = args.out/'standing-interview-faster-720p50.mp4'
    enc = ['-c:v', 'libx264', '-preset', 'veryfast', '-crf', '18', '-threads', '2',
           '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-b:a', '192k', '-movflags', '+faststart']
    writer = subprocess.Popen(['ffmpeg', '-nostdin', '-v', 'error', '-n',
        '-filter_complex_threads', '2', '-f', 'rawvideo', '-pix_fmt', 'bgr24',
        '-s', f'{width}x{height}', '-r', str(out_fps), '-i', 'pipe:0',
        '-i', str(speech), '-i', str(args.overlay), '-filter_complex',
        '[0:v]split=2[raw][full];[full]scale=1080:1920:flags=lanczos[large];'
        '[large][2:v]overlay=0:0:format=auto,format=yuv420p[main]',
        '-map', '[main]', '-map', '1:a:0', *enc, str(main_path),
        '-map', '[raw]', '-map', '1:a:0', *enc, str(plain_path)], stdin=subprocess.PIPE)
    flow = cv2.DISOpticalFlow_create(cv2.DISOPTICAL_FLOW_PRESET_MEDIUM)
    yy, xx = np.indices((height, width), dtype=np.float32)
    current = -1
    first = second = forward = backward = None
    started = time.monotonic()
    mapping = []
    try:
        for frame in range(count):
            t = frame/out_fps
            j = min(int(np.searchsorted(output_edges/RATE, t, side='right')-1), len(lengths)-1)
            ratio = (t*RATE-output_edges[j])/lengths[j]
            src = (starts[j]+ratio*(ends[j]-starts[j]))/RATE*fps
            idx = min(int(src), frames-1); fraction = float(src-idx)
            if idx != current:
                if current < 0:
                    ok, second = cap.read()
                    if not ok: raise RuntimeError('Source decode failed')
                while current < idx:
                    first = second
                    ok, second = cap.read()
                    if not ok:
                        if current+1 != frames-1: raise RuntimeError('Early source EOF')
                        second = first
                    current += 1
                gray_a = cv2.resize(cv2.cvtColor(first, cv2.COLOR_BGR2GRAY), (240, 426))
                gray_b = cv2.resize(cv2.cvtColor(second, cv2.COLOR_BGR2GRAY), (240, 426))
                forward = cv2.resize(flow.calc(gray_a, gray_b, None), (width, height))
                backward = cv2.resize(flow.calc(gray_b, gray_a, None), (width, height))
                forward *= np.array([width/240, height/426], np.float32)
                backward *= np.array([width/240, height/426], np.float32)
            if fraction < .001 or idx == frames-1:
                picture = first
            else:
                aa = cv2.remap(first, xx-forward[:,:,0]*fraction, yy-forward[:,:,1]*fraction,
                               cv2.INTER_LINEAR, borderMode=cv2.BORDER_REPLICATE)
                bb = cv2.remap(second, xx-backward[:,:,0]*(1-fraction), yy-backward[:,:,1]*(1-fraction),
                               cv2.INTER_LINEAR, borderMode=cv2.BORDER_REPLICATE)
                picture = cv2.addWeighted(aa, 1-fraction, bb, fraction, 0)
            writer.stdin.write(picture.tobytes())
            mapping.append({'frame': frame, 'output_seconds': t, 'source_frame': src})
            if frame % 100 == 0:
                print('RENDER', frame, '/', count, round(time.monotonic()-started, 1), flush=True)
        writer.stdin.close()
        if writer.wait() != 0: raise RuntimeError('Encoding failed')
    finally:
        cap.release()
        if writer.poll() is None: writer.terminate(); writer.wait()
    for path in [main_path, plain_path]:
        command(['-xerror', '-i', str(path), '-f', 'null', '-'])
    report = {'speech_speed': speed, 'pitch_factor': 1, 'source_duration': total_samples/RATE,
              'output_duration': total_samples/RATE, 'saved_speech_seconds': saved/RATE,
              'pause_durations_preserved': True, 'tail_extended_without_freeze': True,
              'timeline': timeline, 'joins': joins, 'fps': out_fps, 'frames': count,
              'interpolation': 'bidirectional DIS optical flow, existing frames only',
              'full_decode': 'passed', 'listening_review': False,
              'limitations': ['interpolated 50fps and enlarged 1080p are not native generation',
                             'fast mouth/hand edges can show interpolation artifacts']}
    (args.out/'retime-report.json').write_text(json.dumps(report, indent=2))
    (args.out/'frame-map.json').write_text(json.dumps(mapping))
    print('DONE', json.dumps(report), flush=True)


if __name__ == '__main__':
    main()
