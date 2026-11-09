import os,sys,time,json,argparse,subprocess
from pathlib import Path
from context import context
args,cfg,out,work=context('Remove this reference clip subtitles and prepare recurrent alpha masks')
import torch,cv2,numpy as np
torch.set_num_threads(2);torch.set_num_interop_threads(1)
cv2.setNumThreads(1)
sys.path.insert(0,str(cfg['rvm_root']))
from model import MattingNetwork
lama=torch.jit.load(str(cfg['lama_model']),map_location='cpu').eval()
rvm=MattingNetwork('mobilenetv3').eval();rvm.load_state_dict(torch.load(cfg['rvm_root']/'rvm_mobilenetv3.pth',map_location='cpu',weights_only=True))
cap=cv2.VideoCapture(str(cfg['motion_video']));prefix='matte-test' if args.frames else 'prepared'
def writer(path,pix,codec):
 return subprocess.Popen(['ffmpeg','-hide_banner','-loglevel','error','-y','-f','rawvideo','-pix_fmt',pix,'-s','1080x1920','-r','25','-i','pipe:0','-an',*codec,str(path)],stdin=subprocess.PIPE)
color=writer(work/(prefix+'-clean.mp4'),'bgr24',['-c:v','libx264','-preset','veryfast','-threads','1','-crf','15','-pix_fmt','yuv420p'])
matte=writer(work/(prefix+'-alpha.mkv'),'gray',['-c:v','ffv1','-threads','1','-level','3'])
state=[None]*4;index=0;start=time.monotonic();times=[]
table=np.zeros((1920,1080),np.float32);cv2.fillPoly(table,[np.array([[0,1640],[1080,1775],[1080,1919],[0,1919]])],1);table=cv2.GaussianBlur(table,(5,5),0)
try:
 with torch.inference_mode():
  while True:
   if args.frames and index>=args.frames:break
   ok,frame=cap.read()
   if not ok:break
   tick=time.monotonic();roi=frame[1080:1400,40:1040];inside=roi[70:235,40:960]
   mask=np.zeros(roi.shape[:2],np.uint8);mask[70:235,40:960]=((inside.min(2)>200)&((inside.max(2).astype(int)-inside.min(2))<45)).astype(np.uint8)*255
   mask=cv2.dilate(mask,cv2.getStructuringElement(cv2.MORPH_ELLIPSE,(17,17)))
   image=cv2.resize(roi,(768,256),interpolation=cv2.INTER_AREA);msmall=cv2.resize(mask,(768,256),interpolation=cv2.INTER_NEAREST)
   tensor=torch.from_numpy(cv2.cvtColor(image,cv2.COLOR_BGR2RGB).transpose(2,0,1).copy()).float()[None]/255
   mt=torch.from_numpy((msmall>0).astype(np.float32))[None,None]
   predicted=lama(tensor,mt)[0].permute(1,2,0).numpy().clip(0,1)*255
   predicted=cv2.resize(cv2.cvtColor(predicted.astype(np.uint8),cv2.COLOR_RGB2BGR),(1000,320),interpolation=cv2.INTER_CUBIC)
   blend=cv2.GaussianBlur(mask.astype(np.float32)/255,(5,5),0)[...,None]
   roi[:]=(predicted*blend+roi*(1-blend)).astype(np.uint8)
   src=torch.from_numpy(cv2.cvtColor(frame,cv2.COLOR_BGR2RGB).transpose(2,0,1).copy()).float()[None]/255
   fg,alpha,*state=rvm(src,*state,downsample_ratio=0.25)
   a=alpha[0,0].numpy();a=np.maximum(a,table);a[:530]=0;a=np.clip(a*255,0,255).astype(np.uint8)
   color.stdin.write(frame.tobytes());matte.stdin.write(a.tobytes())
   if index in [0,50,150,250]:
    checker=np.where((np.indices((1920,1080)).sum(axis=0)//60)%2==0,225,245).astype(np.uint8)
    bg=np.full_like(frame,235);bg[:,:,0]=checker;bg[:,:,1]=checker;bg[:,:,2]=checker
    test=(frame*(a[...,None]/255)+bg*(1-a[...,None]/255)).astype(np.uint8)
    cv2.imwrite(str(work/f'{prefix}-check-{index}.jpg'),test)
   times.append(time.monotonic()-tick);index+=1
   if index%10==0:print('PREPARED',index,'seconds',round(time.monotonic()-start,1),'last',round(times[-1],2),flush=True)
 color.stdin.close();matte.stdin.close()
 if color.wait()!=0 or matte.wait()!=0:raise RuntimeError('Encoding failed')
finally:
 cap.release()
 for child in [color,matte]:
  if child.poll() is None:child.terminate()
metrics={'frames':index,'elapsed_seconds':time.monotonic()-start,'mean_frame_seconds':sum(times)/len(times),'subtitle_removal':'LaMa video-frame inpainting, cropped torso ROI','matting':'RVM, recurrent, table retained by polygon','source_timing':'25fps, no time stretch'}
(work/(prefix+'-metrics.json')).write_text(json.dumps(metrics,indent=2));print('DONE',json.dumps(metrics),flush=True)
