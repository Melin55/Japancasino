"""Render reviewed existing cuts and a separate official-logo end card.

Run with a local project JSON. Private media are never downloaded by this script.
"""
import argparse
import hashlib
import json
from pathlib import Path
import subprocess

import fitz
from PIL import Image


def probe(path):
    return json.loads(subprocess.check_output(['ffprobe', '-v', 'error',
        '-count_frames', '-show_streams', '-show_format', '-of', 'json', str(path)], text=True))


def main():
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument('--project', type=Path, required=True)
    args = ap.parse_args()
    cfg = json.loads(args.project.read_text())
    root = args.project.resolve().parent
    paths = {k: root / v for k, v in cfg['paths'].items()}
    for name in ['assets', 'exports']:
        paths[name].mkdir(parents=True, exist_ok=True)
    output_names = ['cut-01-reviewed.mp4', 'cut-03-reviewed.mp4', 'cut-06-logo-endcard.mp4']
    for name in output_names:
        if (paths['assets']/name).exists():
            ap.error('Output exists; retain it and render in a fresh project copy')
    base = ['ffmpeg', '-nostdin', '-v', 'error', '-n', '-threads', '2']
    codec = ['-an', '-r', '24', '-fps_mode', 'cfr', '-c:v', 'libx264', '-crf', '17', '-preset', 'medium',
             '-threads', '2', '-pix_fmt', 'yuv420p', '-movflags', '+faststart']
    results = []
    for cut in cfg['existingCuts']:
        src = root/cut['source']
        metadata = probe(src)
        video = next(s for s in metadata['streams'] if s['codec_type']=='video')
        if (video['width'], video['height'], video['r_frame_rate']) != (768, 1344, '24/1'):
            raise ValueError('Expected reviewed 768x1344, 24fps source')
        start, end = cut['sourceFrames']
        target = paths['assets']/cut['output']
        # Remove 6 pixels from each side; retain all frame height and true aspect.
        graph = (f'trim=start_frame={start}:end_frame={end},setpts=N/(24*TB),'
                 'crop=756:1344:6:0,scale=1080:1920:flags=lanczos,setsar=1')
        subprocess.run(base+['-i', str(src), '-map', '0:v:0', '-vf', graph,
                             *codec, str(target)], check=True)
        results.append((target, end-start))
    # Extract the complete official lockup from the identified PDF rectangle.
    logo_cfg = cfg['endcard']['logo']
    source = fitz.open(root/logo_cfg['sourcePdf'])
    clip = fitz.Rect(logo_cfg['sourceClipPoints'])
    logo_pdf = fitz.open()
    page = logo_pdf.new_page(width=clip.width, height=clip.height)
    page.show_pdf_page(page.rect, source, logo_cfg['sourcePageIndex'], clip=clip)
    logo_pdf.save(paths['assets']/'official-logo.pdf')
    (paths['assets']/'official-logo.svg').write_text(page.get_svg_image(text_as_path=True))
    scale = logo_cfg['renderWidth']/clip.width
    raster = page.get_pixmap(matrix=fitz.Matrix(scale, scale), alpha=True)
    raster.save(paths['assets']/'official-logo.png')
    logo = Image.open(paths['assets']/'official-logo.png').convert('RGBA')
    bounds = logo.getchannel('A').getbbox()
    x = round(540-(bounds[0]+bounds[2])/2)
    y = round(960-(bounds[1]+bounds[3])/2)
    background = Image.new('RGB', (1080,1920), cfg['endcard']['background'])
    background.save(paths['assets']/'cut-06-background.png')
    layer = Image.new('RGBA', background.size)
    layer.alpha_composite(logo, (x,y))
    poster = Image.alpha_composite(background.convert('RGBA'), layer).convert('RGB')
    poster.save(paths['exports']/'cut-06-logo-endcard-poster.png')
    target = paths['assets']/'cut-06-logo-endcard.mp4'
    writer = subprocess.Popen(base+['-f', 'rawvideo', '-pix_fmt', 'rgb24',
        '-s', '1080x1920', '-r', '24', '-i', 'pipe:0', '-frames:v', '144',
        '-vf', 'scale=out_color_matrix=bt709,format=yuv420p',
        '-colorspace', 'bt709', '-color_primaries', 'bt709', '-color_trc', 'bt709',
        # Intra-only encoding keeps equal static frames bit-identical after decode.
        '-g', '1', '-keyint_min', '1', '-sc_threshold', '0', *codec, str(target)], stdin=subprocess.PIPE)
    try:
        for frame in range(144):
            opacity = min(frame/12, 1)
            image = Image.blend(background, poster, opacity) if frame < 12 else poster
            writer.stdin.write(image.tobytes())
        writer.stdin.close()
        if writer.wait() != 0: raise RuntimeError('End card export failed')
    finally:
        if writer.poll() is None: writer.terminate(); writer.wait()
    results.append((target,144))
    hierarchy = {
        'schemaVersion':'1.0','sceneNumber':6,'size':[1080,1920],'fps':24,'durationFrames':144,
        'fullVideoRangeSeconds':[54,60], 'audio':None,
        'layers':[
            {'id':'background','type':'image','source':'assets/cut-06-background.png',
             'position':[0,0],'size':[1080,1920],'rangeFrames':[0,144]},
            {'id':'officialLogo','type':'image','source':'assets/official-logo.png',
             'editableVectorSources':['assets/official-logo.pdf','assets/official-logo.svg'],
             'position':[x,y],'size':list(logo.size),'rangeFrames':[0,144],
             'motion':{'opacityKeyframes':[[0,0],[12,1],[143,1]],'interpolation':'linear'},
             'transform':'uniform scale only; visible bounds centered; original paths/colors'},
            {'id':'export','type':'video','source':'assets/cut-06-logo-endcard.mp4',
             'codec':'H.264','pixelFormat':'yuv420p'}],
        'source':logo_cfg, 'background_note':'White design proposal; no supplied brand manual'}
    (root/'scenegraph-cut-06.json').write_text(json.dumps(hierarchy,ensure_ascii=False,indent=2))
    validation = []
    for path, frames in results:
        meta = probe(path)
        if len(meta['streams']) != 1 or meta['streams'][0]['codec_type'] != 'video':
            raise RuntimeError('Expected a video-only output')
        video = meta['streams'][0]
        if (video['width'],video['height'],video['r_frame_rate'],int(video['nb_read_frames'])) != (1080,1920,'24/1',frames):
            raise RuntimeError('Output dimensions, fps or frame count mismatch')
        if abs(float(video['duration'])-frames/24) > .001:
            raise RuntimeError('Duration mismatch')
        subprocess.run(['ffmpeg','-v','error','-xerror','-i',str(path),'-f','null','-'],check=True)
        validation.append({'file':str(path.relative_to(root)),'frames':frames,
                           'seconds':frames/24,'dimensions':[1080,1920],'fps':24,
                           'audioStreams':0,'fullDecode':'passed','bytes':path.stat().st_size})
    # Check decoded end-card tail, not just the uncompressed render source.
    decoder = subprocess.Popen(['ffmpeg','-v','error','-i',str(target),
        '-vf','select=gte(n\\,72)','-fps_mode','passthrough','-pix_fmt','rgb24',
        '-f','rawvideo','pipe:1'],stdout=subprocess.PIPE)
    hashes=[]; frame_bytes=1080*1920*3
    while True:
        data=decoder.stdout.read(frame_bytes)
        if not data: break
        if len(data)!=frame_bytes: raise RuntimeError('Incomplete verification frame')
        hashes.append(hashlib.sha256(data).hexdigest())
    decoder.stdout.close()
    if decoder.wait()!=0 or len(hashes)!=72 or len(set(hashes))!=1:
        raise RuntimeError('Last 3 seconds must decode to 72 identical frames')
    report={'outputs':validation,'lastThreeSeconds':{'frames':72,'uniqueDecodedFrames':1},
            'logoSourceSha256':hashlib.sha256((root/logo_cfg['sourcePdf']).read_bytes()).hexdigest(),
            'logoExtraction':'unchanged vector paths cropped from official PDF, no AI redraw',
            'aiFootageNativeDimensions':[768,1344],'upscaled':True,'speedMultiplier':1,
            'newGenerationForCuts01And03':False}
    (root/'validation.json').write_text(json.dumps(report,ensure_ascii=False,indent=2))
    print(json.dumps(report,ensure_ascii=False),flush=True)


if __name__ == '__main__':
    main()
