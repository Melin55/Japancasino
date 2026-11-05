"""Remove this interview's small red/white backdrop logo beside the jaw.

Conservative color mask outside tracked facial skin; composition-specific.
This fixed template expects a 534-frame, 10.68-second polished sample and
25fps native 1080x1920 landmarks. It does not generalize to other framing.
"""
import cv2,numpy as np,json,subprocess,time,argparse
from pathlib import Path
cv2.setNumThreads(1)
ap=argparse.ArgumentParser(description=__doc__)
ap.add_argument('--input',type=Path,required=True)
ap.add_argument('--speech',type=Path,required=True)
ap.add_argument('--landmarks',type=Path,required=True)
ap.add_argument('--out',type=Path,required=True)
args=ap.parse_args()
if args.out.exists():ap.error('Use a new output file')
info=json.loads(subprocess.check_output(['ffprobe','-v','error','-show_streams','-of','json',str(args.input)]))
v=next(s for s in info['streams'] if s['codec_type']=='video')
duration=float(subprocess.check_output(['ffprobe','-v','error','-show_entries','format=duration','-of','default=nw=1:nk=1',str(args.input)]))
if abs(duration-10.68)>.05:ap.error('This template requires a 10.68-second sample')
if (v['width'],v['height'],v['avg_frame_rate'])!=(1440,2560,'50/1'):ap.error('Expected 1440x2560, 50fps polished WebM')
points=np.array(json.loads(args.landmarks.read_text())['landmarks'])
if points.shape[0]<267 or points.shape[1:]!=(68,2):ap.error('Expected at least 267 native landmark frames')
args.out.parent.mkdir(parents=True,exist_ok=True)
W,H=1440,2560;scale=W/1080
def clean(frame,i):
 x0,x1,y0,y1=[int(v*scale) for v in [650,900,930,1110]]
 region=frame[y0:y1,x0:x1]
 b=region[:,:,:3].astype(np.float32)
 j=min(i//2,len(points)-1);t=(i%2)*.5
 p=(points[j]*(1-t)+points[min(j+1,len(points)-1)]*t)*scale-[x0,y0]
 face=np.zeros(region.shape[:2],np.uint8)
 cv2.fillConvexPoly(face,cv2.convexHull(p[:27].astype(np.int32)),1)
 face=cv2.dilate(face,np.ones((3,3),np.uint8))
 red=(b[:,:,2]>110)&(b[:,:,2]>b[:,:,1]*1.5)&(b[:,:,2]>b[:,:,0]*1.5)
 white=(b.min(2)>135)&((b.max(2)-b.min(2))<45)
 mask=(red|white).astype(np.uint8)*(1-face)
 mask=cv2.dilate(mask,np.ones((13,13),np.uint8))*(1-face)
 soft=cv2.GaussianBlur(mask.astype(np.float32),(7,7),0)*(1-face)
 region[:,:,3]=(region[:,:,3]*(1-soft)).astype(np.uint8)
 return frame

if __name__=='__main__':
 decoder=subprocess.Popen(['ffmpeg','-v','error','-threads','1','-c:v','libvpx-vp9','-i',str(args.input),'-an','-f','rawvideo','-pix_fmt','bgra','pipe:1'],stdout=subprocess.PIPE)
 target=args.out
 encoder=subprocess.Popen(['ffmpeg','-v','error','-y','-f','rawvideo','-pix_fmt','bgra','-s',f'{W}x{H}','-r','50','-i','pipe:0','-i',str(args.speech),'-map','0:v:0','-map','1:a:0','-c:v','libvpx-vp9','-deadline','realtime','-cpu-used','8','-threads','2','-crf','22','-b:v','0','-auto-alt-ref','0','-pix_fmt','yuva420p','-c:a','libopus','-t','10.68',str(target)],stdin=subprocess.PIPE)
 started=time.monotonic()
 try:
  for i in range(534):
   raw=decoder.stdout.read(W*H*4);assert len(raw)==W*H*4
   f=clean(np.frombuffer(raw,np.uint8).reshape(H,W,4).copy(),i)
   encoder.stdin.write(f.tobytes())
   if i%100==0:print('ALPHA',i,round(time.monotonic()-started,1),flush=True)
  encoder.stdin.close();assert encoder.wait()==0
  decoder.stdout.close();assert decoder.wait()==0
 finally:
  for p in [decoder,encoder]:
   if p.poll() is None:p.terminate();p.wait()
 args.out.with_suffix('.json').write_text(json.dumps({'frames':534,'method':'red/white logo removal outside tracked face, soft feather, native ROI x650:900 y930:1110','elapsed_seconds':time.monotonic()-started},indent=2))
