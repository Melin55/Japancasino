import os,sys,time,json
from pathlib import Path
from context import context
args,cfg,root,work=context('Track this reference video with facexlib on CPU')
os.environ['XDG_CACHE_HOME']=str(work/'cache')
import torch,cv2,numpy as np
import torchvision.transforms.functional as f
sys.modules['torchvision.transforms.functional_tensor']=f
torch.set_num_threads(4);torch.set_num_interop_threads(1)
from facexlib.detection import init_detection_model
from facexlib.alignment import init_alignment_model,landmark_98_to_68
cv2.setNumThreads(1)
weights=str(cfg['facexlib_weights'])
original_load=torch.load
def cpu_load(*args,**kwargs):
 kwargs.setdefault('map_location','cpu')
 return original_load(*args,**kwargs)
torch.load=cpu_load
detector=init_detection_model('retinaface_resnet50',device='cpu',model_rootpath=weights)
aligner=init_alignment_model('awing_fan',device='cpu',model_rootpath=weights)
torch.load=original_load
cap=cv2.VideoCapture(str(cfg['motion_video']));coords=[];landmarks=[];idx=0;t=time.monotonic();last=None
with torch.inference_mode():
 while True:
  ok,frame=cap.read()
  if not ok:break
  H,W=frame.shape[:2]
  if idx%3==0 or last is None:
   small=cv2.resize(frame,(W//2,H//2));faces=detector.detect_faces(small,0.9)
   if not len(faces):raise RuntimeError('No face '+str(idx))
   face=max(faces,key=lambda f:(f[2]-f[0])*(f[3]-f[1]));last=face[:4]*2
  x1,y1,x2,y2=last;cx=(x1+x2)/2;cy=(y1+y2)/2;size=max(x2-x1,y2-y1)*1.15
  rx1=max(0,int(cx-size/2));ry1=max(0,int(cy-size/2));rx2=min(W,int(cx+size/2));ry2=min(H,int(cy+size/2))
  points=landmark_98_to_68(aligner.get_landmarks(frame[ry1:ry2,rx1:rx2]))+np.array([rx1,ry1])
  nose=points[29];chin=points[:,1].max();upper=max(0,2*nose[1]-chin)
  bbox=[int(points[:,0].min()),int(upper),int(points[:,0].max()),int(chin)]
  if bbox[2]-bbox[0]<80 or bbox[3]-bbox[1]<80:raise RuntimeError('Invalid bbox '+str(bbox))
  coords.append(bbox);landmarks.append(points.tolist())
  if idx in [0,50,100,200]:
   test=frame.copy();cv2.rectangle(test,tuple(bbox[:2]),tuple(bbox[2:]),(0,0,255),3)
   for pt in points:cv2.circle(test,tuple(pt.astype(int)),2,(0,255,0),-1)
   cv2.imwrite(str(work/f'landmarks-{idx}.jpg'),test)
  idx+=1
  if idx%25==0:print('FACES',idx,'seconds',round(time.monotonic()-t,1),flush=True)
cap.release()
# A short symmetric filter suppresses detector jitter; it preserves frame timing.
from scipy.ndimage import gaussian_filter1d
smooth=np.rint(gaussian_filter1d(np.asarray(coords,dtype=float),sigma=1,axis=0,mode='nearest')).astype(int)
(work/'faces.json').write_text(json.dumps({'fps':25,'coords':smooth.tolist(),'landmarks':landmarks,'frames':idx,'elapsed_seconds':time.monotonic()-t}))
print('DONE',idx,flush=True)
