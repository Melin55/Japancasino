import dns from "node:dns/promises";
import { isIP } from "node:net";
import { Agent, EnvHttpProxyAgent, fetch as request } from "undici";

export class UserError extends Error {
  constructor(message, status = 400, code = "INVALID_REQUEST") {
    super(message);
    this.status = status;
    this.code = code;
  }
}
export function normalizeUrl(input) {
  if (typeof input !== "string" || input.length > 2048 || !input.trim())
    throw new UserError("URLを2048文字以内で入力してください。");
  let url;
  try {
    url = new URL(
      /^https?:\/\//i.test(input.trim())
        ? input.trim()
        : `https://${input.trim()}`,
    );
  } catch {
    throw new UserError("公開されているサイトのURLを入力してください。");
  }
  const host = url.hostname.toLowerCase();
  if (
    !["https:", "http:"].includes(url.protocol) ||
    url.username ||
    url.password ||
    url.port ||
    isIP(host) ||
    host.includes(":") ||
    !host.includes(".") ||
    /(^|\.)(localhost|local|internal|lan|test|invalid|onion)$/.test(host)
  ) {
    throw new UserError(
      "公開ドメインの http / https URLを入力してください。IPアドレスや内部ネットワークは利用できません。",
    );
  }
  url.hash = "";
  return url.href;
}
export function isPublicAddress(address) {
  if (isIP(address) === 4) {
    const [a, b] = address.split(".").map(Number);
    return !(
      a === 0 ||
      a === 10 ||
      a === 127 ||
      a >= 224 ||
      (a === 100 && b >= 64 && b <= 127) ||
      (a === 169 && b === 254) ||
      (a === 172 && b >= 16 && b <= 31) ||
      (a === 192 && [0, 168].includes(b)) ||
      (a === 198 && [18, 19, 51].includes(b)) ||
      (a === 203 && b === 0)
    );
  }
  if (isIP(address) === 6) {
    // Only global unicast; reject mapped IPv4, link-local, loopback and documentation ranges.
    return (
      /^[23][0-9a-f]{3}:/i.test(address) &&
      !/^2001:(db8|0):/i.test(address) &&
      !address.startsWith("2002:")
    );
  }
  return false;
}
export async function validateDestination(input, resolver = dns.lookup) {
  const url = normalizeUrl(input);
  const addresses = await resolver(new URL(url).hostname, { all: true });
  if (!addresses.length || addresses.some((x) => !isPublicAddress(x.address)))
    throw new UserError(
      "このURLにはアクセスできません。公開サイトのURLをお使いください。",
    );
  return { url, addresses };
}
const hasProxy = Boolean(
  process.env.HTTPS_PROXY ||
    process.env.HTTP_PROXY ||
    process.env.https_proxy ||
    process.env.http_proxy,
);
const proxy = hasProxy ? new EnvHttpProxyAgent() : null;
export async function publicFetch(
  input,
  {
    maxBytes = 2_000_000,
    timeout = 18000,
    accept = "text/html,application/xhtml+xml,text/plain,application/xml",
    resolver = dns.lookup,
  } = {},
) {
  let next = input;
  for (let redirects = 0; redirects <= 4; redirects++) {
    const { url, addresses } = await validateDestination(next, resolver);
    const pinned =
      proxy ||
      new Agent({
        connect: {
          lookup: (_hostname, options, cb) =>
            options.all
              ? cb(null, addresses)
              : cb(null, addresses[0].address, addresses[0].family),
        },
      });
    try {
      const response = await request(url, {
        dispatcher: pinned,
        redirect: "manual",
        signal: AbortSignal.timeout(timeout),
        headers: {
          "user-agent": "IikanjiResearch/0.1 (+website-redesign-preview)",
          accept,
        },
      });
      if ([301, 302, 303, 307, 308].includes(response.status)) {
        const location = response.headers.get("location");
        await response.body?.cancel();
        if (!location)
          throw new UserError("移動先のURLを確認できませんでした。");
        next = new URL(location, url).href;
        continue;
      }
      let bytes = 0;
      const parts = [];
      for await (const part of response.body || []) {
        bytes += part.byteLength;
        if (bytes > maxBytes)
          throw new UserError("ページが大きすぎるため、取得を中止しました。");
        parts.push(Buffer.from(part));
      }
      return {
        url,
        status: response.status,
        text: Buffer.concat(parts).toString("utf8"),
        contentType: response.headers.get("content-type") || "",
      };
    } finally {
      if (!proxy) await pinned.close();
    }
  }
  throw new UserError("転送回数が多すぎるため、取得を中止しました。");
}
export function apiFetch(url, options) {
  return request(url, { ...options, ...(proxy ? { dispatcher: proxy } : {}) });
}
