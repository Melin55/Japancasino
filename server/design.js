import { createHash } from "node:crypto";
import { load } from "cheerio";

export const dimensions = {
  warmth: "あたたかさ",
  density: "情報の充実",
  boldness: "大胆さ",
  editorial: "読み物らしさ",
  contrast: "コントラスト",
};
export const escapeHtml = (value) =>
  String(value ?? "").replace(
    /[&<>"']/g,
    (x) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        x
      ],
  );
export const color = (value, fallback) =>
  /^#[0-9a-f]{6}$/i.test(value || "") ? value : fallback;
export function preferenceProfile(references, ratings) {
  const rated = references.filter((r) => ratings[r.id]);
  const values = rated.map((r) => ratings[r.id].value);
  const spread = values.length ? Math.max(...values) - Math.min(...values) : 0;
  const mean = values.reduce((a, b) => a + b, 0) / (values.length || 1);
  const norm = rated.reduce(
    (sum, r) => sum + Math.abs(ratings[r.id].value - mean),
    0,
  );
  const vector = Object.fromEntries(
    Object.keys(dimensions).map((key) => [
      key,
      norm
        ? rated.reduce(
            (sum, r) =>
              sum + (ratings[r.id].value - mean) * Number(r.features[key] || 0),
            0,
          ) / norm
        : 0,
    ]),
  );
  const ranked = [...rated].sort(
    (a, b) => ratings[b.id].value - ratings[a.id].value,
  );
  const strongest = Object.entries(vector).sort(
    (a, b) => Math.abs(b[1]) - Math.abs(a[1]),
  );
  const distinguishable =
    spread >= 2 &&
    rated.length >= 6 &&
    strongest.some(([, v]) => Math.abs(v) > 0.12);
  const top = ranked[0];
  return {
    vector,
    count: rated.length,
    confidence: distinguishable ? "暫定的な傾向" : "好みの差はまだ小さめ",
    signal: distinguishable,
    selectedId: distinguishable ? top?.id : null,
    reasons: rated.flatMap((r) =>
      ratings[r.id].reason
        ? [{ referenceId: r.id, reason: ratings[r.id].reason }]
        : [],
    ),
    summary: distinguishable
      ? strongest
          .slice(0, 2)
          .map(
            ([k, v]) =>
              `${dimensions[k]}${v > 0 ? "を感じる" : "を抑えた"}デザイン`,
          )
          .join("、")
      : "採点の差が小さいため、読みやすさを優先した中立的な案です。",
    topIds: ranked
      .filter((r) => ratings[r.id].value >= 4)
      .slice(0, 3)
      .map((r) => r.id),
  };
}
export function chooseTheme(profile, references) {
  const ref = references.find((r) => r.id === profile.selectedId);
  const vector = profile.vector;
  return {
    background: color(ref?.colors.background, "#f8f7f3"),
    foreground: color(ref?.colors.foreground, "#242a28"),
    accent: color(ref?.colors.accent, "#315e4c"),
    serif: vector.editorial > 0.12,
    spacious: vector.density <= 0.1,
    bold: vector.boldness > 0.12,
    name: ref ? `${ref.name}の評価を反映` : "読みやすさを優先",
    sourceId: ref?.id || null,
  };
}
export function relativeFile(url) {
  const u = new URL(url);
  const parts = u.pathname
    .split("/")
    .filter(Boolean)
    .map((s) => {
      let decoded = s;
      try {
        decoded = decodeURIComponent(s);
      } catch {}
      return encodeURIComponent(decoded).replace(/\./g, "%2E");
    });
  let file = parts.join("/");
  if (/\.html?$/i.test(u.pathname)) {
    const last = parts.pop();
    file = [...parts, last.replace(/%2E/gi, ".")].join("/");
  } else file = `${file ? `${file}/` : ""}index.html`;
  if (u.search)
    file = file.replace(
      /\.html$/,
      `-${createHash("sha256").update(u.search).digest("hex").slice(0, 8)}.html`,
    );
  return file;
}
export function orderedBlocks(page, plan) {
  const index = new Map(page.blocks.map((b) => [b.id, b]));
  const seen = new Set();
  const result = [];
  for (const id of plan?.orderedBlockIds || []) {
    if (index.has(id) && !seen.has(id)) {
      result.push(index.get(id));
      seen.add(id);
    }
  }
  for (const b of page.blocks) if (!seen.has(b.id)) result.push(b);
  return result;
}
function contrastRatio(a, b) {
  const lum = (hex) => {
    const rgb = hex
      .slice(1)
      .match(/../g)
      .map((x) => parseInt(x, 16) / 255)
      .map((x) => (x <= 0.04045 ? x / 12.92 : ((x + 0.055) / 1.055) ** 2.4));
    return 0.2126 * rgb[0] + 0.7152 * rgb[1] + 0.0722 * rgb[2];
  };
  const x = lum(a),
    y = lum(b);
  return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05);
}
export function accessibleTheme(theme) {
  const background = color(theme.background, "#f8f7f3");
  let foreground = color(theme.foreground, "#242a28");
  if (contrastRatio(background, foreground) < 4.5)
    foreground =
      contrastRatio(background, "#111111") >= 4.5 ? "#111111" : "#ffffff";
  const accent = color(theme.accent, "#315e4c");
  const buttonText =
    contrastRatio(accent, "#ffffff") >= 4.5 ? "#ffffff" : "#111111";
  return { ...theme, background, foreground, accent, buttonText };
}
export function renderPage(
  project,
  page,
  { exportMode = false, reference = false } = {},
) {
  const e = escapeHtml;
  const theme = accessibleTheme(
    project.proposal?.theme || chooseTheme({ vector: {} }, []),
  );
  const presentation = project.proposal?.plan?.presentation || {};
  const fontSize = presentation.textSize === "large" ? "18px" : "16px";
  const sectionGap =
    presentation.spacing === "airy"
      ? "56px"
      : presentation.spacing === "compact"
        ? "24px"
        : theme.spacious
          ? "42px"
          : "30px";
  const allPages = project.inventory.pages;
  const plan = project.proposal?.plan?.pages.find((p) => p.url === page.url);
  const blocks = orderedBlocks(page, plan);
  const rewrite = (target) => {
    let u;
    try {
      u = new URL(target);
    } catch {
      return "#";
    }
    if (!["http:", "https:", "mailto:", "tel:"].includes(u.protocol))
      return "#";
    const hash = u.hash;
    u.hash = "";
    if (allPages.some((p) => p.url === u.href))
      return exportMode
        ? `/${relativeFile(u.href)}${hash}`
        : `/api/projects/${project.id}/preview?url=${encodeURIComponent(u.href)}${hash}`;
    return target;
  };
  const titleBlock = blocks.find((b) => b.tag === "h1");
  const heroImg = page.images[0];
  const breadcrumbs = page.breadcrumbs
    .map((b) => `<a href="${e(rewrite(b.url))}">${e(b.name)}</a>`)
    .join('<span aria-hidden="true">/</span>');
  const jsonLd = JSON.stringify({
    "@context": "https://schema.org",
    "@type": "BreadcrumbList",
    itemListElement: page.breadcrumbs.map((b, i) => ({
      "@type": "ListItem",
      position: i + 1,
      name: b.name,
      item: b.url,
    })),
  }).replace(/</g, "\\u003c");
  const remaining = blocks.filter((b) => b !== titleBlock);
  const sections = [];
  let group = [];
  for (const block of remaining) {
    if (/^h[1-3]$/.test(block.tag) && group.length) {
      sections.push(group);
      group = [];
    }
    group.push(block);
  }
  if (group.length) sections.push(group);
  return `<!doctype html><html lang="ja"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex,nofollow"><title>${e(page.title)}</title><meta name="description" content="${e(page.description)}"><link rel="canonical" href="${e(page.canonical || page.url)}">${page.breadcrumbs.length ? `<script type="application/ld+json">${jsonLd}</script>` : ""}<style>
  *{box-sizing:border-box}body{margin:0;background:${theme.background};color:${theme.foreground};font-family:system-ui,-apple-system,'Noto Sans JP',sans-serif;font-size:${fontSize};line-height:1.85}a{color:inherit;text-underline-offset:4px;overflow-wrap:anywhere}header{padding:24px 6%;display:flex;gap:28px;align-items:center;border-bottom:1px solid currentColor}header strong{font-size:20px;margin-right:auto}header nav{display:flex;gap:22px;flex-wrap:wrap;font-size:13px}main{max-width:1200px;margin:auto;padding:0 6%}nav.breadcrumbs{display:flex;flex-wrap:wrap;gap:12px;font-size:12px;padding:26px 0}.hero{display:grid;grid-template-columns:${heroImg ? "1.1fr 1fr" : "1fr"};gap:6%;align-items:center;padding:${theme.spacious ? "65px" : "36px"} 0}h1,h2,h3{font-family:${theme.serif ? 'Georgia, "Yu Mincho", serif' : "inherit"};line-height:1.45;letter-spacing:-.035em}h1{font-size:clamp(30px,5vw,${theme.bold ? "70" : "52"}px);font-weight:${theme.bold ? 800 : 550};margin:12px 0 24px}h2{font-size:30px}h3{font-size:23px}img{max-width:100%;height:auto;display:block;border-radius:${theme.serif ? "0" : "14"}px}.hero img{width:100%;max-height:500px;object-fit:cover}.eyebrow{font-size:11px;letter-spacing:.15em;text-transform:uppercase}.section{padding:${sectionGap} 0;border-top:1px solid color-mix(in srgb,currentColor 18%,transparent)}.section p{max-width:76ch;white-space:pre-line;overflow-wrap:anywhere}.links{display:flex;gap:12px 24px;flex-wrap:wrap;font-size:13px}.links a{padding:6px 0}.gallery{display:grid;grid-template-columns:repeat(auto-fit,minmax(200px,1fr));gap:24px;margin:40px 0}footer{padding:35px 6%;border-top:1px solid currentColor;font-size:12px}.sample{padding:8px;text-align:center;font-size:11px;background:#242a28;color:white}.original{display:inline-flex;background:${theme.accent};color:${theme.buttonText};padding:12px 22px;border-radius:6px;font-weight:650;text-decoration:none}.notice{font-size:12px;opacity:.8}@media(max-width:640px){header{align-items:flex-start;flex-direction:column;gap:10px}.hero{grid-template-columns:1fr;padding:30px 0;gap:25px}h1{font-size:36px}.section{padding:24px 0}}
  </style></head><body>${project.mode === "demo" ? '<div class="sample">架空の会社を使ったサンプル</div>' : ""}<header><strong>${e(project.research.company.name)}</strong><nav aria-label="メインナビゲーション">${allPages
    .slice(0, 6)
    .map(
      (p) =>
        `<a href="${e(rewrite(p.url))}">${e(p.title.split(/[|｜—]/)[0].trim())}</a>`,
    )
    .join("")}</nav></header><main>${(page.anchors || [])
    .filter((a) => !blocks.some((b) => b.anchor === a))
    .map((a) => `<span id="${e(a)}"></span>`)
    .join(
      "",
    )}${breadcrumbs ? `<nav class="breadcrumbs" aria-label="パンくず">${breadcrumbs}</nav>` : ""}<section class="hero"><div><span class="eyebrow">${e(project.research.company.name)}</span>${titleBlock ? `<h1 ${titleBlock.anchor ? `id="${e(titleBlock.anchor)}"` : ""} data-block-id="${e(titleBlock.id)}">${e(titleBlock.text)}</h1>` : `<h1>${e(page.title)}</h1>`}<a class="original" href="${e(page.url)}" target="_blank" rel="noopener noreferrer">元のページを見る ↗</a></div>${heroImg ? `<img src="${e(heroImg.src)}" alt="${e(heroImg.alt)}" referrerpolicy="no-referrer">` : ""}</section>${sections.map((items) => `<section class="section">${items.map((b) => `<${b.tag === "h1" ? "h2" : b.tag} ${b.anchor ? `id="${e(b.anchor)}"` : ""} data-block-id="${e(b.id)}">${e(b.text)}</${b.tag === "h1" ? "h2" : b.tag}>`).join("")}</section>`).join("")}${
    page.images.length > 1
      ? `<div class="gallery">${page.images
          .slice(1)
          .map(
            (im) =>
              `<img loading="lazy" src="${e(im.src)}" alt="${e(im.alt)}" referrerpolicy="no-referrer">`,
          )
          .join("")}</div>`
      : ""
  }${page.links.length ? `<section class="section"><h2>関連ページ</h2><div class="links">${page.links.map((l) => `<a href="${e(rewrite(l.url))}">${e(l.label)}</a>`).join("")}</div></section>` : ""}${page.forms ? '<p class="notice">お問い合わせ・お申し込みは元サイトをご利用ください。この提案ではフォーム送信を行いません。</p>' : ""}</main><footer>${e(project.research.company.name)} · リニューアル提案</footer></body></html>`;
}
export function auditProposal(project) {
  const pages = project.inventory.pages;
  let blocks = 0,
    retained = 0,
    links = 0,
    crumbs = 0;
  const failures = [];
  for (const page of pages) {
    const html = renderPage(project, page);
    const $ = load(html);
    const renderedBlocks = new Map(
      $("[data-block-id]")
        .toArray()
        .map((el) => [$(el).attr("data-block-id"), $(el).text()]),
    );
    blocks += page.blocks.length;
    retained += page.blocks.filter(
      (b) => renderedBlocks.get(b.id) === b.text,
    ).length;
    const hrefs = new Set(
      $("a[href]")
        .toArray()
        .map((el) => $(el).attr("href")),
    );
    for (const link of page.links) {
      const u = new URL(link.url);
      const fragment = u.hash;
      u.hash = "";
      const target = pages.some((p) => p.url === u.href)
        ? `/api/projects/${project.id}/preview?url=${encodeURIComponent(u.href)}${fragment}`
        : link.url;
      if (hrefs.has(target)) links++;
      else failures.push(`${page.url}: リンクを保持できませんでした`);
    }
    if (page.breadcrumbs.length) {
      let json;
      try {
        json = JSON.parse($('script[type="application/ld+json"]').text());
      } catch {}
      const labels = $("nav.breadcrumbs a")
        .toArray()
        .map((el) => $(el).text());
      for (const [i, b] of page.breadcrumbs.entries()) {
        const item = json?.itemListElement?.[i];
        if (
          item?.name === b.name &&
          item?.item === b.url &&
          labels[i] === b.name
        )
          crumbs++;
        else failures.push(`${page.url}: パンくずを保持できませんでした`);
      }
    }
    if (
      $("title").text() !== page.title ||
      $('meta[name="description"]').attr("content") !== page.description
    )
      failures.push(`${page.url}: メタ情報に差分があります`);
    for (const anchor of page.anchors || [])
      if (
        !$("[id]")
          .toArray()
          .some((el) => $(el).attr("id") === anchor)
      )
        failures.push(`${page.url}: ページ内アンカーが欠落しています`);
    if (page.truncated)
      failures.push(`${page.url}: 取得上限を超えた情報があります`);
  }
  if (retained !== blocks) failures.push("取得した本文に欠落があります");
  return {
    scope: "取得できたページ内の本文・リンク・パンくず",
    pages: pages.length,
    blocks,
    retained,
    links,
    breadcrumbs: crumbs,
    failures,
    passed: failures.length === 0,
    unfetched: project.inventory.errors.length + project.inventory.remaining,
    forms: pages.reduce((n, p) => n + p.forms, 0),
    notes: project.inventory.limitations,
    checkedAt: new Date().toISOString(),
  };
}
