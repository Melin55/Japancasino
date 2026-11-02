import assets from "iikanji:assets";
import { crawlSite } from "../server/crawler.js";
import { researchCompany, planWebsite } from "../server/ai.js";
import { preferenceProfile } from "../server/design.js";
import { normalizeUrl, UserError } from "./network.js";

const limits=new Map(); // Secondary protection for the owner-only trial; not a billing cap.
const headers={"cache-control":"no-store","x-content-type-options":"nosniff","referrer-policy":"no-referrer"};
const json=(data,status=200)=>Response.json(data,{status,headers});
const ready=env=>Boolean(env.OPENAI_API_KEY?.trim());
async function readBody(request){
  const reader=request.body?.getReader();if(!reader)throw new UserError("入力がありません。");
  let size=0,text="";const decoder=new TextDecoder();
  for(;;){const {value,done}=await reader.read();if(done)break;size+=value.byteLength;if(size>2_000_000){await reader.cancel();throw new UserError("入力が上限を超えています。",413);}text+=decoder.decode(value,{stream:true});}
  try{return JSON.parse(text+decoder.decode());}catch{throw new UserError("入力を確認してください。");}
}
function signedData(p){return JSON.stringify({url:p.url,goal:p.goal,inventory:p.inventory,research:p.research,sources:p.sources,expiresAt:p.proof.expiresAt,owner:p.proof.owner});}
async function hmacKey(env){return crypto.subtle.importKey("raw",new TextEncoder().encode(env.OPENAI_API_KEY),{name:"HMAC",hash:"SHA-256"},false,["sign","verify"]);}
async function sign(p,env,owner){
  p.proof={owner,expiresAt:Date.now()+86400000};
  const signature=await crypto.subtle.sign("HMAC",await hmacKey(env),new TextEncoder().encode(signedData(p)));
  p.proof.signature=Array.from(new Uint8Array(signature),x=>x.toString(16).padStart(2,"0")).join("");
}
async function verify(p,env,owner){
  if(!p?.proof || p.proof.owner!==owner || p.proof.expiresAt<Date.now() || !/^[a-f0-9]{64}$/.test(p.proof.signature))throw new UserError("調査の有効期限が切れました。URLから再調査してください。",403);
  const signature=Uint8Array.from(p.proof.signature.match(/../g),x=>parseInt(x,16));
  if(!await crypto.subtle.verify("HMAC",await hmacKey(env),signature,new TextEncoder().encode(signedData(p))))throw new UserError("調査内容の整合性を確認できませんでした。",403);
}
export default {
  async fetch(request,env={}){
    const url=new URL(request.url);
    try{
      if(["GET","HEAD"].includes(request.method)){
        if(url.pathname==="/api/config")return json({aiAvailable:ready(env),storage:"browser",mode:"owner-trial"});
        const name=url.pathname==="/"?"/index.html":url.pathname;
        if(assets[name]){
          const [content,type]=assets[name];
          return new Response(request.method==="HEAD"?null:content,{headers:{...headers,"content-type":type,"content-security-policy":"default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' https: data:; frame-src 'self' about:; connect-src 'self'; object-src 'none'; base-uri 'none'; frame-ancestors 'self' https://chatgpt.com"}});
        }
        return json({error:"ページが見つかりません。"},404);
      }
      if(request.method!=="POST"||!["/api/research","/api/generate"].includes(url.pathname))throw new UserError("操作が見つかりません。",404);
      const owner=request.headers.get("oai-authenticated-user-id");
      if(!owner)throw new UserError("ログインして開き直してください。",401);
      if(request.headers.get("origin")!==url.origin)throw new UserError("この画面から操作してください。",403);
      if(!request.headers.get("content-type")?.startsWith("application/json"))throw new UserError("入力形式を確認してください。",415);
      if(!ready(env))throw new UserError("実サイトのAI調査は接続準備中です。プレビューはそのまま試せます。",503,"AI_NOT_CONFIGURED");
      const day=new Date().toISOString().slice(0,10),limit=limits.get(owner)||{day,count:0,active:false};
      if(limit.day!==day){limit.day=day;limit.count=0;}
      if(limit.active || limit.count>=20)throw new UserError("ただいま処理中、または本日の利用上限です。",429);
      limit.active=true;limit.count++;limits.set(owner,limit);
      try{
        const body=await readBody(request);
        const options={key:env.OPENAI_API_KEY,model:env.OPENAI_MODEL||"gpt-5.5",fetcher:fetch};
        if(url.pathname==="/api/research"){
          const p={mode:"live",url:normalizeUrl(body.url),goal:({inquiry:"問い合わせを増やす",brand:"魅力を伝える",recruit:"採用につなげる"})[body.goal]||"問い合わせを増やす"};
          p.inventory=await crawlSite(p.url,{maxPages:12});
          const result=await researchCompany(p,options);
          p.research=result.data;p.sources=result.sources;p.usage=[{stage:"research",...result.usage}];p.status="ready";
          await sign(p,env,owner);
          return json(p);
        }
        const p=body.project;await verify(p,env,owner);
        if(!p.ratings || p.research.references.some(r=>!Number.isInteger(p.ratings[r.id]?.value)||p.ratings[r.id].value<1||p.ratings[r.id].value>5))throw new UserError("10件を1〜5点で採点してください。");
        p.feedback=p.feedback?{decision:["accepted","needs_changes"].includes(p.feedback.decision)?p.feedback.decision:"needs_changes",note:String(p.feedback.note||"").slice(0,1000)}:null;
        const result=await planWebsite(p,preferenceProfile(p.research.references,p.ratings),options);
        return json({plan:result.data,usage:{stage:"proposal",...result.usage}});
      }finally{limit.active=false;}
    }catch(error){
      return json({error:error instanceof UserError?error.message:"処理を完了できませんでした。時間をおいてお試しください。",code:error.code||"REQUEST_FAILED"},error instanceof UserError?error.status:502);
    }
  },
};
