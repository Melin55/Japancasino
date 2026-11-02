import http from "node:http";
import app from "../dist/server/index.js";
const port=Number(process.env.PORT)||3000;
http.createServer(async(req,res)=>{
  try{
    const url=`http://127.0.0.1:${port}${req.url}`;
    const request=new Request(url,{method:req.method,headers:req.headers,...(!["GET","HEAD"].includes(req.method)?{body:req,duplex:"half"}:{})});
    const result=await app.fetch(request,{});
    res.writeHead(result.status,Object.fromEntries(result.headers));
    res.end(Buffer.from(await result.arrayBuffer()));
  }catch{res.writeHead(500);res.end("Preview error");}
}).listen(port,"127.0.0.1",()=>console.log(`Preview http://127.0.0.1:${port}`));
