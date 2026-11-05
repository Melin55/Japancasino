import os,sys,time,json,argparse,subprocess
from pathlib import Path
from context import context
args,cfg,out,work=context('Generate new mouth movements with MuseTalk 1.5 on CPU')
root=cfg['musetalk_root']
os.chdir(root);sys.path.insert(0,str(root))
for key,name in [('HF_HOME','hf-cache'),('XDG_CACHE_HOME','cache'),('MPLCONFIGDIR','matplotlib')]:os.environ[key]=str(work/name)
import torch,cv2,numpy as np
import torchvision.transforms.functional as functional
sys.modules['torchvision.transforms.functional_tensor']=functional
cv2.setNumThreads(1)
torch.set_num_threads(4);torch.set_num_interop_threads(1);torch.manual_seed(42)
from musetalk.utils.utils import load_all_model
from musetalk.utils.face_parsing import FaceParsing
from musetalk.utils.blending import get_image
from musetalk.utils.audio_processor import AudioProcessor
from transformers import WhisperModel
started=time.monotonic();device=torch.device('cpu');dtype=torch.float32 if args.fp32 else torch.bfloat16
print('LOAD',flush=True)
vae,unet,pe=load_all_model(device=device)
vae.vae.eval().to(dtype=dtype);unet.model.eval().to(dtype=dtype);pe.eval().to(dtype=dtype)
parser=FaceParsing()
whisper=WhisperModel.from_pretrained(str(root/'models/whisper'),torch_dtype=torch.float32).eval()
audio=AudioProcessor(str(root/'models/whisper'))
with torch.inference_mode():
 features,length=audio.get_audio_feature(str(out/'speech.wav'))
 chunks=audio.get_whisper_chunk(features,device,torch.float32,whisper,length,fps=25)
del whisper,features
coords=json.loads((work/'faces.json').read_text())['coords'];count=min(len(coords),len(chunks));count=min(count,args.frames) if args.frames else count
prefix='benchmark' if args.frames else 'generated'
writer=subprocess.Popen(['ffmpeg','-hide_banner','-loglevel','error','-y','-f','rawvideo','-pix_fmt','bgr24','-s','1080x1920','-r','25','-i','pipe:0','-an','-c:v','libx264','-preset','fast','-threads','2','-crf','16','-pix_fmt','yuv420p',str(work/(prefix+'-silent.mp4'))],stdin=subprocess.PIPE)
cap=cv2.VideoCapture(str(cfg['motion_video']));timing=[];print('RENDER',count,'load_seconds',time.monotonic()-started,flush=True)
try:
 with torch.inference_mode():
  for i in range(count):
   tick=time.monotonic();ok,frame=cap.read()
   if not ok:raise RuntimeError('Missing source frame '+str(i))
   x1,y1,x2,y2=coords[i];y2=min(frame.shape[0],y2+10);box=[x1,y1,x2,y2]
   face=cv2.resize(frame[y1:y2,x1:x2],(256,256),interpolation=cv2.INTER_LANCZOS4)
   latent=vae.get_latents_for_unet(face)
   audio_batch=pe(chunks[i:i+1].to(dtype))
   pred=unet.model(latent,torch.tensor([0]),encoder_hidden_states=audio_batch).sample
   recon=vae.decode_latents(pred)[0]
   recon=cv2.resize(recon,(x2-x1,y2-y1),interpolation=cv2.INTER_LANCZOS4)
   merged=get_image(frame,recon,box,upper_boundary_ratio=0.60,mode='jaw',fp=parser)
   writer.stdin.write(merged.tobytes())
   if i in [0,2,4,25,100,200]:
    cv2.imwrite(str(work/f'{prefix}-frame-{i}.jpg'),merged)
    cv2.imwrite(str(work/f'{prefix}-face-{i}.jpg'),recon)
   timing.append(time.monotonic()-tick)
   print('FRAME',i+1,'/',count,'seconds',round(timing[-1],3),'elapsed',round(time.monotonic()-started,1),flush=True)
 writer.stdin.close()
 if writer.wait()!=0:raise RuntimeError('FFmpeg failed')
finally:
 cap.release()
 if writer.poll() is None:writer.terminate()
video=out/(prefix+'-lipsync.mp4')
subprocess.run(['ffmpeg','-hide_banner','-loglevel','error','-y','-i',str(work/(prefix+'-silent.mp4')),'-i',str(out/'speech.wav'),'-map','0:v:0','-map','1:a:0','-c:v','copy','-c:a','aac','-b:a','192k','-t',str(count/25),'-movflags','+faststart',str(video)],check=True)
metrics={'engine':'MuseTalk 1.5','frames':count,'fps':25,'dtype':str(dtype),'elapsed_seconds':time.monotonic()-started,'mean_frame_seconds':sum(timing)/len(timing),'source':str(cfg['motion_video']),'speech_synthetic':True,'mouth_synthetic':True,'body_motion':'preserved from source','output':str(video)}
(out/(prefix+'-metrics.json')).write_text(json.dumps(metrics,indent=2));print('DONE',json.dumps(metrics),flush=True)
