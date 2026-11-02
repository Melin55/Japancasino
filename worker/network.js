// Cloudflare Workers has no local/private network bindings. Fetch only public,
// standard-port domains, revalidate every redirect and bound each response.
export class UserError extends Error {
  constructor(message, status = 400, code = "INVALID_REQUEST") {
    super(message); this.status = status; this.code = code;
  }
}
export function normalizeUrl(input) {
  if (typeof input !== "string" || !input.trim() || input.length > 2048)
    throw new UserError("公開サイトのURLを入力してください。");
  let u;
  try { u = new URL(/^https?:\/\//i.test(input.trim()) ? input.trim() : `https://${input.trim()}`); }
  catch { throw new UserError("URLを確認してください。"); }
  if (!/^https?:$/.test(u.protocol) || u.username || u.password || u.port ||
      !u.hostname.includes(".") || u.hostname.includes(":") || /^\d+(\.\d+){3}$/.test(u.hostname) ||
      /(^|\.)(localhost|local|internal|lan|test|invalid|onion)$/.test(u.hostname))
    throw new UserError("公開ドメインのURLを入力してください。");
  u.hash = ""; return u.href;
}
export function isPublicAddress(address) {
  if (/^\d+(\.\d+){3}$/.test(address)) {
    const [a,b] = address.split(".").map(Number);
    return !(a===0 || a===10 || a===127 || a>=224 || (a===100 && b>=64 && b<=127) ||
      (a===169 && b===254) || (a===172 && b>=16 && b<=31) ||
      (a===192 && [0,168].includes(b)) || (a===198 && [18,19,51].includes(b)) || (a===203 && b===0));
  }
  return /^[23][0-9a-f]{3}:/i.test(address) && !/^2001:(db8|0):/i.test(address) && !/^2002:/i.test(address);
}
export async function publicFetch(input, {maxBytes=2_000_000, timeout=18000}={}) {
  let next = input;
  const signal = AbortSignal.timeout(timeout);
  for (let count=0; count<=4; count++) {
    const url=normalizeUrl(next), hostname=new URL(url).hostname;
    const answers = await Promise.all(["A","AAAA"].map(async type => {
      const r=await fetch(`https://cloudflare-dns.com/dns-query?name=${encodeURIComponent(hostname)}&type=${type}`, {
        headers:{accept:"application/dns-json"}, signal,
      });
      if (!r.ok) throw new UserError("取得先を確認できませんでした。",502);
      return (await r.json()).Answer || [];
    }));
    const ips=answers.flat().filter(a=>[1,28].includes(a.type));
    if (!ips.length || ips.some(a=>!isPublicAddress(a.data))) throw new UserError("この取得先にはアクセスできません。");
    // Workers fetch independently rejects local IPs; no tunnel/service bindings.
    const r=await fetch(url,{redirect:"manual",signal,headers:{"user-agent":"IikanjiResearch/0.2","accept":"text/html,text/plain,application/xml"}});
    if ([301,302,303,307,308].includes(r.status)) {
      const location=r.headers.get("location"); await r.body?.cancel();
      if (!location) throw new UserError("移動先を確認できませんでした。");
      next=new URL(location,url).href; continue;
    }
    if (Number(r.headers.get("content-length"))>maxBytes) { await r.body?.cancel(); throw new UserError("ページの容量が上限を超えています。"); }
    const reader=r.body?.getReader(), chunks=[]; let size=0;
    if (reader) for (;;) {
      const {value,done}=await reader.read(); if(done) break;
      size+=value.byteLength;
      if(size>maxBytes){await reader.cancel();throw new UserError("ページの容量が上限を超えています。");}
      chunks.push(value);
    }
    const bytes=new Uint8Array(size);let offset=0;
    for(const chunk of chunks){bytes.set(chunk,offset);offset+=chunk.length;}
    return {url,status:r.status,contentType:r.headers.get("content-type")||"",text:new TextDecoder().decode(bytes)};
  }
  throw new UserError("転送回数が上限を超えています。");
}
export const apiFetch=(...args)=>fetch(...args);
