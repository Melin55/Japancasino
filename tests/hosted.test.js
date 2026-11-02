import test from "node:test";
import assert from "node:assert/strict";
import app from "../dist/server/index.js";
import { demoData } from "../server/demo.js";

const origin="https://iikanji.example.com";
function request(path,body,owner="owner-1",site=origin){
  return new Request(origin+path,{method:"POST",headers:{origin:site,"content-type":"application/json",...(owner?{"oai-authenticated-user-id":owner}:{})},body:JSON.stringify(body)});
}
test("hosted deployment serves its assets and honestly gates live AI",async()=>{
  const html=await app.fetch(new Request(origin));
  assert.equal(html.status,200);assert.match(await html.text(),/data-hosted="true"/);
  assert.equal((await app.fetch(new Request(origin+"/engine.js"))).status,200);
  assert.equal((await (await app.fetch(new Request(origin+"/api/config"))).json()).aiAvailable,false);
  assert.equal((await app.fetch(request("/api/research",{},null))).status,401);
  assert.equal((await app.fetch(request("/api/research",{},"owner-1","https://other.example.com"))).status,403);
  assert.equal((await app.fetch(request("/api/research",{}))).status,503);
});
test("hosted live pipeline binds sourced research to its owner and rejects tampering before model calls",async t=>{
  const data=demoData();
  const research=structuredClone(data.research);
  research.competitors=[];
  research.references.forEach((r,i)=>{r.url=`https://reference-${i}.example.com/`;r.sourceUrls=[r.url];});
  let calls=0;
  const original=globalThis.fetch;
  t.after(()=>globalThis.fetch=original);
  globalThis.fetch=async(input,options)=>{
    const url=new URL(input);
    if(url.hostname==="cloudflare-dns.com")return Response.json({Answer:[{type:1,data:"93.184.216.34"}]});
    if(url.hostname==="api.openai.com"){
      calls++;
      const body=JSON.parse(options.body);
      const result=body.tools?research:{pages:[{url:"https://company.example.com/",orderedBlockIds:[],rationale:"Fixture",improvements:[]}],presentation:{textSize:"standard",spacing:"comfortable"}};
      return Response.json({status:"completed",output:[{type:"web_search_call",action:{sources:research.references.map(r=>({url:r.url,title:r.name}))}},{type:"message",content:[{type:"output_text",text:JSON.stringify(result)}]}],usage:{output_tokens:1}});
    }
    if(url.pathname==="/robots.txt")return new Response("User-agent: *\nAllow: /");
    if(url.pathname==="/sitemap.xml")return new Response("",{status:404});
    return new Response("<html><head><title>Company</title></head><body><h1>Company</h1><p>Existing company facts.</p></body></html>",{headers:{"content-type":"text/html"}});
  };
  const env={OPENAI_API_KEY:"fixture-key-not-a-real-secret"};
  const response=await app.fetch(request("/api/research",{url:"https://company.example.com/"}),env);
  assert.equal(response.status,200);
  const project=await response.json();
  assert.equal(calls,1);assert.equal(project.research.references.length,10);
  project.ratings=Object.fromEntries(project.research.references.map((r,i)=>[r.id,{value:i%5+1}]));
  const proposal=await app.fetch(request("/api/generate",{project}),env);
  assert.equal(proposal.status,200);assert.equal(calls,2);
  assert.equal((await app.fetch(request("/api/generate",{project},"different-owner"),env)).status,403);
  project.inventory.pages[0].blocks[0].text="Tampered data";
  assert.equal((await app.fetch(request("/api/generate",{project}),env)).status,403);
  assert.equal(calls,2);
});
