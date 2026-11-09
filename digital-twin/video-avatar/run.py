#!/usr/bin/env python3
"""Run the seated video-avatar workflow from a profile and a new script."""
import argparse
import json
from pathlib import Path
import subprocess
import sys


def probe(path):
    return json.loads(subprocess.check_output(['ffprobe','-v','error','-show_streams','-show_format','-of','json',str(path)]))


def main():
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--profile',type=Path,required=True)
    parser.add_argument('--script',type=Path,required=True)
    parser.add_argument('--out',type=Path,required=True)
    parser.add_argument('--stage',choices=['all','voice','faces','lipsync','matte','export'],default='all')
    parser.add_argument('--dry-run',action='store_true')
    parser.add_argument('--fp32',action='store_true')
    args=parser.parse_args();profile=args.profile.resolve();script=args.script.resolve();out=args.out.resolve()
    cfg=json.loads(profile.read_text(encoding='utf-8'))
    def path(key):
        value=Path(cfg[key]).expanduser()
        return value.resolve() if value.is_absolute() else (profile.parent/value).resolve()
    here=Path(__file__).resolve().parent
    shared=['--profile',str(profile),'--out',str(out)]
    stages=[('voice',[sys.executable,str(here.parent/'local-cpu/synthesize.py'),'--engine-root',str(path('gpt_sovits_root')),'--reference-audio',str(path('reference_audio')),'--reference-text',str(path('reference_text')),'--script',str(script),'--out',str(out/'speech.wav')]),
            ('faces',[sys.executable,str(here/'track_faces.py'),*shared]),
            ('lipsync',[sys.executable,str(here/'lipsync.py'),*shared,*(['--fp32'] if args.fp32 else [])]),
            ('matte',[sys.executable,str(here/'clean_and_matte.py'),*shared]),
            ('export',[sys.executable,str(here/'export.py'),*shared])]
    selected=stages if args.stage=='all' else [(name,command) for name,command in stages if name==args.stage]
    if args.dry_run:
        print(json.dumps({'stages':selected,'parallel':False},ensure_ascii=False,indent=2));return
    if not script.is_file() or not script.read_text(encoding='utf-8').strip():parser.error('Provide a nonempty UTF-8 speech script')
    if args.stage=='all' and out.exists() and any(out.iterdir()):parser.error('Use a new empty output directory for a complete run')
    source=probe(path('motion_video'));stream=next(s for s in source['streams'] if s['codec_type']=='video')
    if (stream['width'],stream['height'],stream['avg_frame_rate'])!=(1080,1920,'25/1'):parser.error('This template requires the prepared 1080x1920, 25fps motion clip')
    out.mkdir(parents=True,exist_ok=True)
    for name,command in selected:
        if name=='lipsync':
            speech=probe(out/'speech.wav')
            if float(speech['format']['duration'])>float(source['format']['duration'])+0.02:
                parser.error('Speech is longer than the motion reference; shorten the script or prepare a longer reference')
        (out/'job.json').write_text(json.dumps({'stage':name,'status':'running'},indent=2))
        subprocess.run(command,check=True)
    (out/'job.json').write_text(json.dumps({'stage':args.stage,'status':'completed'},indent=2))


if __name__=='__main__':main()
