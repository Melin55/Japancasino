import { demoData, sampleReferenceHtml } from "../server/demo.js";
import { preferenceProfile, chooseTheme, renderPage, auditProposal, relativeFile } from "../server/design.js";
import { zipSync, strToU8 } from "fflate";

const jobs = new Map();
const db = new Promise((resolve,reject)=>{
  const request=indexedDB.open("iikanji",1);
  request.onupgradeneeded=()=>request.result.createObjectStore("projects",{keyPath:"id"});
  request.onsuccess=()=>resolve(request.result);
  request.onerror=()=>reject(new Error("保存領域を利用できません。通常のブラウザー画面で開いてください。"));
});
async function storage(method,value){
  const database=await db;
  return new Promise((resolve,reject)=>{
    const tx=database.transaction("projects",method==="get"?"readonly":"readwrite");
    const request=tx.objectStore("projects")[method](value);
    tx.oncomplete=()=>resolve(request.result);
    tx.onerror=()=>reject(new Error("保存できませんでした。ブラウザーの空き容量を確認してください。"));
  });
}
async function remote(path,body){
  const r=await fetch(path,{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify(body)});
  const data=await r.json(); if(!r.ok) throw new Error(data.error||"接続できませんでした。"); return data;
}
function record(p,type,data={}){
  p.events.push({at:new Date().toISOString(),type,...data});
  p.events=p.events.slice(-300);
}
function run(p,task){
  const job=(async()=>{
    try{await task();}catch(error){p.status="error";p.error=error.message;record(p,"failed",{message:error.message});}
    finally{try{await storage("put",p);}finally{jobs.delete(p.id);}}
  })();
  jobs.set(p.id,job); job.catch(()=>{});
}
function finish(p,plan){
  const profile=preferenceProfile(p.research.references,p.ratings);
  p.proposal={profile,theme:chooseTheme(profile,p.research.references),plan,createdAt:new Date().toISOString(),ratingRevision:JSON.stringify(p.ratings)};
  p.proposal.audit=auditProposal(p);p.status="complete";
  record(p,"proposal_created",{auditPassed:p.proposal.audit.passed,selectedId:profile.selectedId});
}
export async function api(path,body,method){
  if(path==="/api/config") return (await fetch(path)).json();
  if(path==="/api/projects"){
    const demo=body.mode==="demo";
    const p={...(demo?demoData():{mode:"live",url:body.url,goal:body.goal,status:"researching",usage:[],sources:[]}),id:crypto.randomUUID(),ratings:{},events:[],createdAt:new Date().toISOString()};
    await storage("put",p);
    if(!demo)run(p,async()=>{Object.assign(p,await remote("/api/research",{url:body.url,goal:body.goal}));record(p,"research_completed",{pages:p.inventory.pages.length});});
    return structuredClone(p);
  }
  const [,id,action]=path.match(/^\/api\/projects\/([^/]+)(?:\/([^?]+))?/)||[];
  const p=await storage("get",id);
  if(!p)throw new Error("保存したデータが見つかりません。このブラウザーで新しく試してください。");
  if(method==="DELETE"){await storage("delete",id);return {deleted:true};}
  if(!action){
    if(["researching","building"].includes(p.status)&&!jobs.has(id)){
      p.status="error";p.error="処理中にページが閉じられました。保存した採点から再開できます。";await storage("put",p);
    }
    return p;
  }
  if(action==="ratings"){
    if(!p.research.references.some(r=>r.id===body.referenceId)||!Number.isInteger(body.value)||body.value<1||body.value>5)throw new Error("1〜5点で採点してください。");
    p.ratings[body.referenceId]={value:body.value,reason:String(body.reason||"").slice(0,100)};
    p.status="ready";record(p,"rating",{referenceId:body.referenceId,value:body.value});
  }else if(action==="proposal"){
    if(p.research.references.some(r=>!p.ratings[r.id]))throw new Error("10件を採点してください。");
    if(p.mode==="demo")finish(p,{
      pages:p.inventory.pages.map(page=>({url:page.url,orderedBlockIds:page.blocks.map(b=>b.id),rationale:"元の情報を保持し、採点から色・文字・余白を反映しました。",improvements:p.research.recommendations})),
      presentation:{textSize:/文字.*(大|読みやす)/.test(p.feedback?.note||"")?"large":"standard",spacing:"comfortable"},
    });
    else{p.status="building";await storage("put",p);run(p,async()=>{const result=await remote("/api/generate",{project:p});finish(p,result.plan);p.usage.push(result.usage);});return structuredClone(p);}
  }else if(action==="feedback"){
    p.feedback={decision:body.decision,note:String(body.note||"").slice(0,1000),at:new Date().toISOString()};record(p,"feedback",p.feedback);
  }else throw new Error("操作が見つかりません。");
  await storage("put",p);return p;
}
export function reference(p,ref){return sampleReferenceHtml(ref);}
export function mountPreview(frame,p,page){
  frame.onload=()=>{
    frame.contentDocument?.addEventListener("click",event=>{
      const a=event.target.closest("a");if(!a)return;
      const url=new URL(a.href,location.origin);
      if(url.pathname===`/api/projects/${p.id}/preview`){
        const target=p.inventory.pages.find(x=>x.url===url.searchParams.get("url"));
        if(target){event.preventDefault();mountPreview(frame,p,target);}
      }else if(/^https?:$/.test(url.protocol)){a.target="_blank";a.rel="noopener noreferrer";}
    });
  };
  frame.srcdoc=renderPage(p,page);
}
export function download(p){
  const files={},mapping={};
  for(const page of p.inventory.pages){const name=relativeFile(page.url);files[name]=strToU8(renderPage(p,page,{exportMode:true}));mapping[page.url]=name;}
  files["url-map.json"]=strToU8(JSON.stringify(mapping,null,2));
  files["proposal.json"]=strToU8(JSON.stringify({company:p.research.company,proposal:p.proposal,sources:p.sources,feedback:p.feedback,events:p.events},null,2));
  files["README.txt"]=strToU8("確認用の仮サイトです。noindex付き。このフォルダをHTTPサーバーのルートとして配信してください。フォーム・決済は移植していません。\n");
  const url=URL.createObjectURL(new Blob([zipSync(files)],{type:"application/zip"}));
  const a=document.createElement("a");a.href=url;a.download="iikanji-proposal.zip";a.click();setTimeout(()=>URL.revokeObjectURL(url),10000);
}
