import { load } from "cheerio";
import { createHash } from "node:crypto";
import robotsParser from "robots-parser";
import { publicFetch, normalizeUrl, UserError } from "./network.js";

const clean = (text) => text.replace(/\s+/g, " ").trim();
const hash = (text) =>
  createHash("sha256").update(text).digest("hex").slice(0, 16);
export function safeLink(value, base) {
  try {
    const u = new URL(value, base);
    return ["http:", "https:", "mailto:", "tel:"].includes(u.protocol) &&
      !u.username &&
      !u.password
      ? u.href
      : null;
  } catch {
    return null;
  }
}
export function extractPage(html, url) {
  const $ = load(html);
  const base = safeLink($("base").attr("href") || url, url) || url;
  const schema = [];
  $('script[type="application/ld+json"]').each((_, e) => {
    try {
      schema.push(JSON.parse($(e).text()));
    } catch {
      /* reported separately, never execute page scripts */
    }
  });
  const flatten = (value) =>
    Array.isArray(value)
      ? value.flatMap(flatten)
      : value && typeof value === "object"
        ? [value, ...flatten(value["@graph"] || [])]
        : [];
  const breadcrumbs = schema
    .flatMap(flatten)
    .filter((s) => [].concat(s["@type"] || []).includes("BreadcrumbList"))
    .flatMap((s) =>
      (s.itemListElement || []).map((x, i) => ({
        name: clean(String(x.name || x.item?.name || "")),
        url: safeLink(
          typeof x.item === "string" ? x.item : x.item?.["@id"] || url,
          base,
        ),
        position: Number(x.position) || i + 1,
      })),
    )
    .filter((x) => x.name && x.url);
  if (!breadcrumbs.length)
    $('nav[aria-label*="readcrumb"] a, .breadcrumb a, .breadcrumbs a').each(
      (i, e) => {
        const href = safeLink($(e).attr("href"), base);
        if (href)
          breadcrumbs.push({
            name: clean($(e).text()),
            url: href,
            position: i + 1,
          });
      },
    );
  const links = [];
  const seen = new Set();
  $("a[href]").each((_, e) => {
    const href = safeLink($(e).attr("href"), base);
    const label = clean($(e).text()) || $(e).find("img").attr("alt") || href;
    if (href && !seen.has(href)) {
      seen.add(href);
      links.push({ url: href, label });
    }
  });
  const images = [];
  $("img").each((_, e) => {
    const src = safeLink($(e).attr("src") || $(e).attr("data-src"), base);
    if (src?.startsWith("https://"))
      images.push({ src, alt: $(e).attr("alt") || "" });
  });
  const forms = $("form").length;
  const title = clean($("title").first().text()) || new URL(url).hostname;
  const description = $('meta[name="description"]').attr("content") || "";
  const canonical = safeLink(
    $('link[rel="canonical"]').attr("href") || url,
    base,
  );
  $("script,style,noscript,svg,template,iframe").remove();
  const blocks = [];
  const selectors =
    "h1,h2,h3,h4,h5,h6,p,li,td,th,dt,dd,figcaption,address,label,button,div,section,article,main,header,footer,nav,ul,ol,dl,form,table";
  function append(text, node) {
    text = clean(text);
    if (!text) return;
    blocks.push({
      id: hash(`${url}:${blocks.length}:${text}`),
      tag: /^h[1-6]$/.test(node?.tagName) ? node.tagName : "p",
      text,
      anchor: node ? $(node).attr("id") || "" : "",
    });
  }
  function walk(node) {
    if (!$(node).find(selectors).length) {
      append($(node).text(), node);
      return;
    }
    let inline = "";
    const flush = () => {
      append(inline, null);
      inline = "";
    };
    for (const child of node.children || []) {
      if (child.type === "text") inline += child.data;
      else if (child.type === "tag") {
        if ($(child).is(selectors) || $(child).find(selectors).length) {
          flush();
          walk(child);
        } else inline += $(child).text();
      }
    }
    flush();
  }
  const body = $("body")[0];
  if (body) walk(body);
  const truncated =
    blocks.length > 500 || images.length > 50 || links.length > 500;
  const anchors = [
    ...new Set(
      $("[id],a[name]")
        .toArray()
        .map((el) => $(el).attr("id") || $(el).attr("name"))
        .filter(Boolean),
    ),
  ];
  return {
    url,
    title,
    description,
    canonical,
    breadcrumbs,
    blocks: blocks.slice(0, 500),
    links: links.slice(0, 500),
    images: images.slice(0, 50),
    forms,
    anchors,
    truncated,
    contentHash: hash(blocks.map((b) => b.text).join("\n")),
    fetchedAt: new Date().toISOString(),
  };
}
export async function crawlSite(
  input,
  { maxPages = 12, onProgress = async () => {}, fetcher = publicFetch } = {},
) {
  const initial = normalizeUrl(input);
  let origin = new URL(initial).origin;
  const rules = new Map();
  const errors = [];
  const pages = [];
  const visited = new Set();
  const queue = [initial];
  const discovered = new Set(queue);
  async function allowed(url) {
    const root = new URL(url).origin;
    if (!rules.has(root)) {
      const r = await fetcher(`${root}/robots.txt`, { maxBytes: 250000 });
      if (r.status === 401 || r.status === 403)
        throw new UserError("このサイトは自動取得を許可していません。");
      if (r.status >= 500 || r.status === 429)
        throw new UserError(
          "robots.txt を確認できませんでした。時間をおいてお試しください。",
        );
      rules.set(
        root,
        robotsParser(`${root}/robots.txt`, r.status === 200 ? r.text : ""),
      );
    }
    return rules.get(root).isAllowed(url, "IikanjiResearch") !== false;
  }
  const enqueue = (href) => {
    try {
      const u = new URL(href);
      u.hash = "";
      if (
        u.origin !== origin ||
        u.search ||
        /\.(pdf|zip|png|jpe?g|webp|svg|mp[34]|css|js|xml)$/i.test(u.pathname) ||
        visited.has(u.href) ||
        discovered.has(u.href) ||
        discovered.size >= 300
      )
        return;
      discovered.add(u.href);
      queue.push(u.href);
    } catch {
      /* invalid links are not crawl targets */
    }
  };
  while (
    queue.length &&
    pages.length < maxPages &&
    visited.size < maxPages * 3
  ) {
    const url = queue.shift();
    if (visited.has(url)) continue;
    visited.add(url);
    try {
      if (!(await allowed(url))) {
        errors.push({ url, reason: "robots.txt により取得対象外" });
        continue;
      }
      const result = await fetcher(url);
      if (result.status !== 200) throw new Error(`HTTP ${result.status}`);
      if (!result.contentType.includes("html"))
        throw new Error("HTML以外のページ");
      if (pages.length === 0) {
        origin = new URL(result.url).origin;
        if (!(await allowed(result.url)))
          throw new UserError("移動先のサイトは自動取得を許可していません。");
      } else if (new URL(result.url).origin !== origin)
        throw new Error("別ドメインへの転送");
      if (pages.some((p) => p.url === result.url)) continue;
      const page = extractPage(result.text, result.url);
      if (!page.blocks.length)
        throw new Error(
          "本文を取得できません。JavaScriptで生成されるページの可能性があります。",
        );
      pages.push(page);
      visited.add(result.url);
      page.links.forEach((link) => enqueue(link.url));
      await onProgress({
        pages: pages.length,
        discovered: discovered.size,
        lastUrl: result.url,
      });
      if (pages.length === 1) {
        try {
          const sitemapUrl = `${origin}/sitemap.xml`;
          if (await allowed(sitemapUrl)) {
            const sitemap = await fetcher(sitemapUrl, { maxBytes: 500000 });
            if (sitemap.status === 200) {
              const xml = load(sitemap.text, { xmlMode: true });
              xml("url > loc").each((_, e) => enqueue(xml(e).text()));
            }
          }
        } catch {
          /* sitemap is supplementary; scope explicitly remains bounded */
        }
      }
    } catch (e) {
      errors.push({
        url,
        reason:
          e instanceof UserError ? e.message : String(e.message).slice(0, 160),
      });
    }
  }
  if (!pages.length)
    throw new UserError(
      errors[0]?.reason ||
        "サイトを取得できませんでした。URLをご確認ください。",
    );
  return {
    pages,
    errors,
    remaining: queue.length,
    discovered: discovered.size,
    maxPages,
    scope: "public-html",
    limitations: [
      "公開HTMLを最大" +
        maxPages +
        "ページまで取得。ログイン内、PDF、JavaScript生成部分、サイトマップ索引、クエリ付きリンクの巡回は対象外。",
      "フォームや決済などの機能は移植せず、元サイトへのリンクを維持します。",
    ],
  };
}
