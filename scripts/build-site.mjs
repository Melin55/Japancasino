import { build } from "esbuild";
import { readFile, writeFile, mkdir, copyFile } from "node:fs/promises";
import path from "node:path";

const root=process.cwd();
const networkAlias={name:"worker-network",setup(b){b.onResolve({filter:/^\.\/network\.js$/},args=>({path:path.join(root,"worker/network.js")}));}};
const options={bundle:true,format:"esm",platform:"browser",target:"es2022",minify:true,write:false,plugins:[networkAlias]};
const engine=await build({...options,entryPoints:["browser/engine.js"]});
const assets={"/engine.js":[engine.outputFiles[0].text,"text/javascript; charset=utf-8"]};
for(const [name,mime] of Object.entries({"index.html":"text/html","app.js":"text/javascript","styles.css":"text/css","favicon.svg":"image/svg+xml"})){
  let text=await readFile(`public/${name}`,"utf8");
  if(name==="index.html")text=text.replace("<html lang=\"ja\">","<html lang=\"ja\" data-hosted=\"true\">");
  assets[`/${name}`]=[text,`${mime}; charset=utf-8`];
}
const virtual={name:"site-assets",setup(b){b.onResolve({filter:/^iikanji:assets$/},()=>({path:"assets",namespace:"assets"}));b.onLoad({filter:/.*/,namespace:"assets"},()=>({contents:`export default ${JSON.stringify(assets)}`}));}};
const worker=await build({...options,entryPoints:["worker/index.js"],plugins:[networkAlias,virtual]});
await mkdir("dist/server",{recursive:true});await mkdir("dist/.openai",{recursive:true});
await writeFile("dist/server/index.js",worker.outputFiles[0].text);
await copyFile(".openai/hosting.json","dist/.openai/hosting.json");
const {default:entry}=await import(path.join(root,"dist/server/index.js")+`?v=${Date.now()}`);
if(typeof entry?.fetch!=="function")throw new Error("Worker entrypoint invalid");
console.log(`Built Worker: ${worker.outputFiles[0].contents.length} bytes, ${Object.keys(assets).length} assets`);
