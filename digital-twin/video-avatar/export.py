import os,json,time,subprocess
from pathlib import Path
import cv2,numpy as np
from PIL import Image,ImageDraw,ImageFont
from context import context
args,cfg,out,work=context('Export the original AI video and transparent WebM')
cv2.setNumThreads(1)
os.environ['XDG_CACHE_HOME']=str(work/'cache')
coords=json.loads((work/'faces.json').read_text())['coords']
base=cv2.VideoCapture(str(work/'prepared-clean.mp4'));lip=cv2.VideoCapture(str(out/'generated-lipsync.mp4'));alpha_cap=cv2.VideoCapture(str(work/'prepared-alpha.mkv'))
assert base.isOpened() and lip.isOpened() and alpha_cap.isOpened()
frames=int(lip.get(cv2.CAP_PROP_FRAME_COUNT));duration=frames/25
fontpath=cfg.get('font_path','/usr/share/fonts/opentype/noto/NotoSansCJK-Regular.ttc')
header=Image.new('RGBA',(1080,1920),(0,0,0,0));draw=ImageDraw.Draw(header)
draw.rounded_rectangle((181,259,899,524),radius=43,fill=(255,255,255,255))
draw.rounded_rectangle((206,259,872,335),radius=24,fill=(215,40,64,255))
namefont=ImageFont.truetype(fontpath,28);headline=ImageFont.truetype(fontpath,47);label=ImageFont.truetype(fontpath,24)
draw.text((539,292),'日本カジノスクール 大岩根校長',font=namefont,fill='white',anchor='mm')
draw.text((540,390),cfg.get('headline1','初めてでも大丈夫'),font=headline,fill=(25,25,25),anchor='mm')
draw.text((540,461),cfg.get('headline2','基本から、一緒に。'),font=headline,fill=(25,25,25),anchor='mm')
draw.rounded_rectangle((770,535,1030,580),radius=12,fill=(255,255,255,235));draw.text((900,556),'AI生成サンプル',font=label,fill=(30,50,45),anchor='mm')
hrgba=np.asarray(header);hcol=cv2.cvtColor(hrgba[:,:,:3],cv2.COLOR_RGB2BGR);ha=hrgba[:,:,3:4]/255.0

def writer(path,pix,codec):
 return subprocess.Popen(['ffmpeg','-hide_banner','-loglevel','error','-y','-f','rawvideo','-pix_fmt',pix,'-s','1080x1920','-r','25','-i','pipe:0','-i',str(out/'speech.wav'),'-map','0:v:0','-map','1:a:0',*codec,'-t',str(duration),str(path)],stdin=subprocess.PIPE)
preview=writer(out/'original-ai-video.mp4','bgr24',['-c:v','libx264','-preset','fast','-threads','2','-crf','18','-pix_fmt','yuv420p','-c:a','aac','-b:a','192k','-movflags','+faststart'])
transparent=writer(out/'avatar-transparent.webm','bgra',['-c:v','libvpx-vp9','-deadline','realtime','-cpu-used','5','-threads','2','-crf','20','-b:v','0','-auto-alt-ref','0','-pix_fmt','yuva420p','-c:a','libopus'])
start=time.monotonic()
try:
 for i in range(frames):
  ok,b=base.read();ok2,g=lip.read();ok3,a=alpha_cap.read()
  if not(ok and ok2 and ok3):raise RuntimeError('Frame missing '+str(i))
  a=a[:,:,0].copy()
  # Remove green backdrop retained between hair strands in this fixed composition.
  hair=b[530:860,150:900].astype(np.float32)
  green=np.clip(np.minimum(hair[:,:,1]-hair[:,:,0]-15,hair[:,:,1]-hair[:,:,2]-15)/25,0,1)
  green*=np.clip((hair[:,:,1]-50)/30,0,1)
  a[530:860,150:900]=(a[530:860,150:900]*(1-green)).astype(np.uint8)
  # The original white logo overlaps the upper-hair boundary in this clip.
  top=b[530:730,150:900].astype(np.float32)
  white=np.clip((top.min(2)-130)/40,0,1)*np.clip((65-(top.max(2)-top.min(2)))/25,0,1)
  a[530:730,150:900]=(a[530:730,150:900]*(1-white)).astype(np.uint8)
  # Discard isolated background lettering; retain substantial foreground pieces.
  count,labels,stats,_=cv2.connectedComponentsWithStats((a>20).astype(np.uint8),8)
  keep=np.zeros(count,np.uint8)
  if count>1:keep[1:]=(stats[1:,cv2.CC_STAT_AREA]>1000).astype(np.uint8)
  retained=keep[labels]
  retained=cv2.dilate(retained,np.ones((3,3),np.uint8))
  a*=retained
  x1,y1,x2,y2=coords[i];y2=min(1920,y2+10)
  # The lip-sync pass changes only this tracked face ROI. Keep the cleaned torso.
  b[y1:y2,x1:x2]=g[y1:y2,x1:x2]
  asset=b.copy()
  edge=(a>0)&(a<245)
  maxrb=np.maximum(asset[:,:,0],asset[:,:,2]).astype(np.float32)
  asset[:,:,1]=np.where(edge,np.minimum(asset[:,:,1],maxrb*1.12),asset[:,:,1]).astype(np.uint8)
  rgba=np.dstack([asset,a]);transparent.stdin.write(rgba.tobytes())
  main=(hcol*ha+b*(1-ha)).astype(np.uint8);preview.stdin.write(main.tobytes())
  if i in [0,50,150,250]:
   cv2.imwrite(str(work/f'final-frame-{i}.jpg'),main)
   checker=np.indices((1920,1080));pattern=np.where(((checker[0]//60+checker[1]//60)%2)==0,225,245).astype(np.uint8)
   bg=np.dstack([pattern]*3);test=(asset*(a[...,None]/255)+bg*(1-a[...,None]/255)).astype(np.uint8)
   cv2.imwrite(str(work/f'final-alpha-{i}.jpg'),test)
  if i%50==0:print('EXPORT',i,'/',frames,flush=True)
 preview.stdin.close();transparent.stdin.close()
 if preview.wait()!=0 or transparent.wait()!=0:raise RuntimeError('Output encoding failed')
finally:
 for cap in [base,lip,alpha_cap]:cap.release()
 for child in [preview,transparent]:
  if child.poll() is None:child.terminate()
metrics={'frames':frames,'fps':25,'duration_seconds':duration,'dimensions':[1080,1920],'export_seconds':time.monotonic()-start,'audio_synthetic':True,'mouth_synthetic':True,'gestures':'source video','background_transparent_asset':'avatar-transparent.webm','table_retained':True,'subtitle_removal':'LaMa, original torso detail under text is AI-completed','not_a_3d_mesh':True}
(out/'delivery.json').write_text(json.dumps(metrics,indent=2));print('DONE',json.dumps(metrics),flush=True)
