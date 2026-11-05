#!/usr/bin/env python3
"""Interpolate a continuous 25fps video/alpha pair to 50fps and upscale mildly.

This is finishing, not jump-cut repair: remove discontinuous source edits first.
"""
import argparse
import json
from pathlib import Path
import subprocess
import time


def main():
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument('--source', type=Path, required=True)
    ap.add_argument('--out', type=Path, required=True)
    ap.add_argument('--frames', type=int, help='Short diagnostic export')
    args = ap.parse_args()
    import cv2
    import numpy as np
    cv2.setNumThreads(1)
    source, out = args.source.resolve(), args.out.resolve()
    if source == out:
        ap.error('Use a separate output directory')
    out.mkdir(parents=True, exist_ok=True)
    cap = cv2.VideoCapture(str(source / 'original-ai-video.mp4'))
    if not cap.isOpened():
        raise RuntimeError('Cannot open the source MP4')
    width, height = int(cap.get(3)), int(cap.get(4))
    if (width, height) != (1080, 1920) or abs(cap.get(5) - 25) > .001:
        raise ValueError('Expected the native 1080x1920, 25fps export')
    count = int(cap.get(cv2.CAP_PROP_FRAME_COUNT))
    if args.frames is not None:
        if args.frames < 1:
            ap.error('--frames must be positive')
        count = min(count, args.frames)
    decoder = subprocess.Popen(['ffmpeg', '-v', 'error', '-threads', '1', '-c:v', 'libvpx-vp9',
        '-i', str(source / 'avatar-transparent.webm'), '-an', '-frames:v', str(count), '-f', 'rawvideo',
        '-pix_fmt', 'bgra', 'pipe:1'], stdout=subprocess.PIPE)
    encoders = []
    def writer(name, pix, codec):
        p = subprocess.Popen(['ffmpeg', '-v', 'error', '-y', '-f', 'rawvideo', '-pix_fmt', pix,
            '-s', '1440x2560', '-r', '50', '-i', 'pipe:0', '-i', str(source / 'speech.wav'),
            '-map', '0:v:0', '-map', '1:a:0', *codec, '-t', str(count / 25), str(out / name)],
            stdin=subprocess.PIPE)
        encoders.append(p)
        return p
    video = writer('original-ai-video-1440p50.mp4', 'bgr24',
        ['-c:v', 'libx264', '-preset', 'veryfast', '-threads', '2', '-crf', '17',
         '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-b:a', '192k', '-movflags', '+faststart'])
    alpha_video = writer('avatar-transparent-1440p50.webm', 'bgra',
        ['-c:v', 'libvpx-vp9', '-deadline', 'realtime', '-cpu-used', '8', '-threads', '2',
         '-crf', '22', '-b:v', '0', '-auto-alt-ref', '0', '-pix_fmt', 'yuva420p', '-c:a', 'libopus'])
    flow_engine = cv2.DISOpticalFlow_create(cv2.DISOPTICAL_FLOW_PRESET_MEDIUM)
    yy, xx = np.indices((height, width), dtype=np.float32)
    def read_pair():
        ok, bgr = cap.read()
        raw = decoder.stdout.read(width * height * 4)
        if not ok or len(raw) != width * height * 4:
            raise RuntimeError('Video and transparent asset frame counts do not match')
        return bgr, np.frombuffer(raw, np.uint8).reshape(height, width, 4)
    def premultiply(bgra):
        a = bgra[:, :, 3:4].astype(np.float32) / 255
        return np.concatenate((bgra[:, :, :3].astype(np.float32) * a, a), axis=2)
    def to_bgra(pm):
        a = pm[:, :, 3:4].clip(0, 1)
        color = np.divide(pm[:, :, :3], a, out=np.zeros_like(pm[:, :, :3]), where=a > .002)
        return np.concatenate((color.clip(0, 255), a * 255), axis=2).astype(np.uint8)
    def upscale(bgr, pm):
        rgb = cv2.resize(bgr, (1440, 2560), interpolation=cv2.INTER_LANCZOS4)
        rgb = cv2.addWeighted(rgb, 1.15, cv2.GaussianBlur(rgb, (0, 0), .7), -.15, 0)
        enlarged = cv2.resize(pm, (1440, 2560), interpolation=cv2.INTER_LANCZOS4)
        rgba = to_bgra(enlarged)
        sharp = cv2.addWeighted(rgba[:, :, :3], 1.15,
                               cv2.GaussianBlur(rgba[:, :, :3], (0, 0), .7), -.15, 0)
        rgba[:, :, :3] = np.where(rgba[:, :, 3:4] > 250, sharp, rgba[:, :, :3])
        return rgb, rgba
    def midpoint(a, b, pa, pb):
        ga = cv2.resize(cv2.cvtColor(a, cv2.COLOR_BGR2GRAY), (width // 3, height // 3))
        gb = cv2.resize(cv2.cvtColor(b, cv2.COLOR_BGR2GRAY), (width // 3, height // 3))
        if float(cv2.absdiff(ga, gb).mean()) < .025:
            return a, pa
        ab = cv2.resize(flow_engine.calc(ga, gb, None), (width, height)) * 3
        ba = cv2.resize(flow_engine.calc(gb, ga, None), (width, height)) * 3
        ma = (xx - ab[:, :, 0] * .5, yy - ab[:, :, 1] * .5)
        mb = (xx - ba[:, :, 0] * .5, yy - ba[:, :, 1] * .5)
        def warp(img, maps):
            return cv2.remap(img, *maps, cv2.INTER_LINEAR, borderMode=cv2.BORDER_REPLICATE)
        return cv2.addWeighted(warp(a, ma), .5, warp(b, mb), .5, 0), (warp(pa, ma) + warp(pb, mb)) * .5
    started = time.monotonic()
    try:
        a, rgba = read_pair()
        pa = premultiply(rgba)
        for index in range(count):
            if index + 1 < count:
                b, next_rgba = read_pair()
                pb = premultiply(next_rgba)
                mid, pmid = midpoint(a, b, pa, pb)
            else:
                b, pb, mid, pmid = a, pa, a, pa
            for color, pm in [(a, pa), (mid, pmid)]:
                main_frame, alpha_frame = upscale(color, pm)
                video.stdin.write(main_frame.tobytes())
                alpha_video.stdin.write(alpha_frame.tobytes())
            if index in [0, 50, 133, 200, 266]:
                cv2.imwrite(str(out / f'check-{index}.jpg'), main_frame)
                al = alpha_frame[:, :, 3:4].astype(np.float32) / 255
                check = (alpha_frame[:, :, :3] * al + 235 * (1-al)).astype(np.uint8)
                cv2.imwrite(str(out / f'alpha-check-{index}.jpg'), check)
            a, pa = b, pb
            if index % 25 == 0:
                print('POLISH', index, '/', count, 'seconds', round(time.monotonic()-started, 1), flush=True)
        for p in encoders:
            p.stdin.close()
        if any(p.wait() != 0 for p in encoders):
            raise RuntimeError('Encoding failed')
    finally:
        cap.release()
        decoder.stdout.close()
        if decoder.poll() is None:
            decoder.terminate()
        decoder.wait()
        for p in encoders:
            if p.poll() is None:
                p.terminate()
                p.wait()
    metrics = {'source_frames': count, 'output_frames': count*2, 'fps': 50,
        'dimensions': [1440, 2560], 'duration_seconds': count/25,
        'elapsed_seconds': time.monotonic()-started,
        'method': 'bidirectional DIS optical-flow midpoint interpolation; premultiplied alpha; Lanczos resize; mild sharpening',
        'limitation': 'Interpolated and upscaled detail is not newly captured detail; source jump cuts must be removed before this stage'}
    (out / 'polish.json').write_text(json.dumps(metrics, indent=2))
    print('DONE', json.dumps(metrics), flush=True)


if __name__ == '__main__':
    main()
