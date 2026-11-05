"""Build a silent gesture driver from an explicitly authored source-frame path.

This reconstructs/repeats real gestures; it does not synthesize new body motion.
Use only continuous, camera-facing source ranges. Speech is added separately.
"""
import argparse
import json
from pathlib import Path
import subprocess


def main():
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument('--plan', type=Path, required=True)
    ap.add_argument('--out', type=Path, required=True)
    args = ap.parse_args()
    import cv2
    import numpy as np
    from scipy.ndimage import gaussian_filter1d
    cv2.setNumThreads(1)
    plan = json.loads(args.plan.read_text())
    count = int(plan['output_frames'])
    points = np.asarray(plan['control_points'], dtype=float)
    sigma = float(plan.get('turn_smoothing_frames', 2))
    if count < 2 or points.ndim != 2 or points.shape[1] != 2:
        ap.error('Provide at least two output frames and [output_frame, source_frame] points')
    if (len(points) < 2 or not np.isfinite(points).all() or sigma < 0
            or points[0, 0] != 0 or points[-1, 0] != count-1
            or np.any(np.diff(points[:, 0]) <= 0) or np.any(points[:, 1] < 0)):
        ap.error('Control points must cover the output, increase in output time, and use nonnegative source positions')
    positions = np.interp(np.arange(count), points[:, 0], points[:, 1])
    if sigma:
        positions = gaussian_filter1d(positions, sigma, mode='nearest')
    def asset(key):
        p = Path(plan[key]).expanduser()
        return p if p.is_absolute() else args.plan.resolve().parent / p
    color_cap = cv2.VideoCapture(str(asset('source_color')))
    alpha_cap = cv2.VideoCapture(str(asset('source_alpha')))
    for cap in (color_cap, alpha_cap):
        if not cap.isOpened() or (int(cap.get(3)), int(cap.get(4))) != (1080, 1920) or abs(cap.get(5)-25) > .001:
            ap.error('Expected matching 1080x1920, 25fps prepared color and alpha')
    last = int(np.ceil(positions.max()))
    frames, alphas = [], []
    try:
        for i in range(last+1):
            ok, frame = color_cap.read()
            ok_a, alpha = alpha_cap.read()
            if not ok or not ok_a:
                raise ValueError(f'Missing source frame {i}')
            frames.append(frame)
            alphas.append(alpha[:, :, 0])
    finally:
        color_cap.release()
        alpha_cap.release()
    out = args.out.resolve()
    out.mkdir(parents=True, exist_ok=True)
    targets = [out/'motion-driver.mp4', out/'prepared-alpha.mkv', out/'motion-map.json']
    if any(p.exists() for p in targets):
        ap.error('Use a new output directory to preserve previous renders')
    def writer(path, pix, codec):
        return subprocess.Popen(['ffmpeg', '-v', 'error', '-n', '-f', 'rawvideo', '-pix_fmt', pix,
            '-s', '1080x1920', '-r', '25', '-i', 'pipe:0', '-an', *codec, str(path)], stdin=subprocess.PIPE)
    writers = [writer(targets[0], 'bgr24', ['-c:v', 'libx264', '-crf', '15', '-preset', 'fast', '-threads', '2']),
               writer(targets[1], 'gray', ['-c:v', 'ffv1', '-level', '3', '-threads', '1'])]
    engine = cv2.DISOpticalFlow_create(cv2.DISOPTICAL_FLOW_PRESET_MEDIUM)
    gray = [cv2.resize(cv2.cvtColor(f, cv2.COLOR_BGR2GRAY), (360, 640)) for f in frames]
    flows = {}
    yy, xx = np.indices((1920, 1080), np.float32)
    try:
        for i, pos in enumerate(positions):
            j = int(pos)
            t = pos-j
            if t < 1e-6 or j == last:
                color, alpha = frames[j], alphas[j]
            else:
                if j not in flows:
                    flows[j] = (engine.calc(gray[j], gray[j+1], None), engine.calc(gray[j+1], gray[j], None))
                ab, ba = [cv2.resize(f, (1080, 1920))*3 for f in flows[j]]
                ma = (xx-ab[:, :, 0]*t, yy-ab[:, :, 1]*t)
                mb = (xx-ba[:, :, 0]*(1-t), yy-ba[:, :, 1]*(1-t))
                def mix(seq):
                    a = cv2.remap(seq[j], *ma, cv2.INTER_LINEAR, borderMode=cv2.BORDER_REPLICATE)
                    b = cv2.remap(seq[j+1], *mb, cv2.INTER_LINEAR, borderMode=cv2.BORDER_REPLICATE)
                    return cv2.addWeighted(a, 1-t, b, t, 0)
                color, alpha = mix(frames), mix(alphas)
            writers[0].stdin.write(color.tobytes())
            writers[1].stdin.write(alpha.tobytes())
            if i % 25 == 0:
                print('GESTURE', i, '/', count, flush=True)
        for p in writers:
            p.stdin.close()
        if any(p.wait() != 0 for p in writers):
            raise RuntimeError('Gesture encoding failed')
    finally:
        for p in writers:
            if p.poll() is None:
                p.terminate()
                p.wait()
    targets[2].write_text(json.dumps({'fps': 25, 'source_positions': positions.tolist(),
        'plan': plan, 'speech_retimed': False,
        'method': 'authored real-gesture reconstruction with eased turns and bidirectional optical flow',
        'limitation': 'repeated/reversed source gestures, not generated full-body motion'}, indent=2))


if __name__ == '__main__':
    main()
