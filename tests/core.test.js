import test from "node:test";
import assert from "node:assert/strict";
import {
  normalizeUrl,
  isPublicAddress,
  validateDestination,
} from "../server/network.js";
import { extractPage, crawlSite } from "../server/crawler.js";
import {
  preferenceProfile,
  chooseTheme,
  renderPage,
  auditProposal,
  relativeFile,
} from "../server/design.js";
import { demoData, demoReferences } from "../server/demo.js";
import { groundResearch, extractResponse } from "../server/ai.js";

test("URL and DNS validation rejects local destinations and mixed public/private DNS", async () => {
  for (const url of [
    "http://127.0.0.1",
    "http://2130706433",
    "http://0x7f000001",
    "http://[::1]",
    "https://user:password@example.com",
    "http://service.internal",
    "http://example.com:8080",
    "file:///etc/passwd",
  ])
    assert.throws(() => normalizeUrl(url));
  assert.equal(
    normalizeUrl("example.com/about#team"),
    "https://example.com/about",
  );
  for (const ip of [
    "127.0.0.1",
    "10.0.0.1",
    "100.64.0.1",
    "169.254.169.254",
    "172.17.0.1",
    "192.168.0.1",
    "::1",
    "::ffff:127.0.0.1",
    "2001:db8::1",
  ])
    assert.equal(isPublicAddress(ip), false, ip);
  assert.equal(isPublicAddress("8.8.8.8"), true);
  await assert.rejects(() =>
    validateDestination("https://example.com", async () => [
      { address: "8.8.8.8", family: 4 },
      { address: "10.0.0.1", family: 4 },
    ]),
  );
});
test("crawler respects robots and its scope, follows same-origin HTML without inventing missing pages", async () => {
  const pages = {
    "https://example.com/robots.txt": {
      text: "User-agent: *\nDisallow: /secret",
      status: 200,
      contentType: "text/plain",
    },
    "https://example.com/": {
      text: '<title>Example</title><h1>Company</h1><p>Our service.</p><a href="/about/">About</a><a href="/secret">Secret</a><a href="https://external.com/">Other</a>',
      status: 200,
      contentType: "text/html",
    },
    "https://example.com/sitemap.xml": {
      text: "<urlset><url><loc>https://example.com/about/</loc></url></urlset>",
      status: 200,
      contentType: "application/xml",
    },
    "https://example.com/about/": {
      text: "<title>About</title><h1>About us</h1>",
      status: 200,
      contentType: "text/html",
    },
  };
  const fetched = [];
  const data = await crawlSite("https://example.com/", {
    fetcher: async (url) => {
      fetched.push(url);
      return { url, ...pages[url] };
    },
  });
  assert.equal(data.pages.length, 2);
  assert.equal(data.errors.length, 1);
  assert.equal(fetched.includes("https://example.com/secret"), false);
  assert.equal(
    fetched.some((u) => u.startsWith("https://external.com")),
    false,
  );
});
test("redesign keeps every extracted text unit, breadcrumb, link and anchor; source scripts cannot execute", () => {
  const page = extractPage(
    '<html><title>A &amp; B</title><meta name="description" content="hello"><script>alert(1)</script><script type="application/ld+json">{"@type":"BreadcrumbList","itemListElement":[{"position":1,"name":"Home","item":"https://example.com/"}]}</script><h1 id="top">A &amp; B</h1><p id="detail">Price: ¥30,000. &lt;script&gt;bad&lt;/script&gt;</p><a href="#detail">See detail</a><a href="javascript:alert(1)">Unsafe</a><a href="mailto:hello@example.com">Contact</a></html>',
    "https://example.com/",
  );
  const p = {
    ...demoData(),
    id: "test",
    inventory: { pages: [page], errors: [], remaining: 0, limitations: [] },
    proposal: {
      theme: chooseTheme({ vector: {} }, []),
      plan: {
        pages: [
          {
            url: page.url,
            orderedBlockIds: [page.blocks[0].id, "fabricated-id"],
            rationale: "",
            improvements: [],
          },
        ],
      },
    },
  };
  const html = renderPage(p, page);
  assert.ok(html.includes("Price: ¥30,000. &lt;script&gt;bad&lt;/script&gt;"));
  assert.ok(!html.includes("<script>alert"));
  assert.ok(!html.includes('href="javascript:'));
  assert.ok(html.includes('id="detail"'));
  assert.ok(html.includes("url=https%3A%2F%2Fexample.com%2F#detail"));
  const audit = auditProposal(p);
  assert.equal(audit.passed, true, JSON.stringify(audit));
  assert.equal(audit.retained, page.blocks.length);
  assert.equal(audit.breadcrumbs, 1);
  assert.equal(audit.links, 2);
});
test("preference signal changes the actual output while uniform ratings do not claim personalization", () => {
  const equal = Object.fromEntries(
    demoReferences.map((r) => [r.id, { value: 5 }]),
  );
  assert.equal(preferenceProfile(demoReferences, equal).signal, false);
  const ratings = Object.fromEntries(
    demoReferences.map((r, i) => [
      r.id,
      { value: i === 1 ? 5 : i < 5 ? 1 : 3 },
    ]),
  );
  const profile = preferenceProfile(demoReferences, ratings);
  assert.equal(profile.signal, true);
  assert.equal(profile.selectedId, "bold");
  const a = chooseTheme(profile, demoReferences),
    b = chooseTheme(preferenceProfile(demoReferences, equal), demoReferences);
  assert.notEqual(a.background, b.background);
});

test("content extraction retains business facts in plain divs and around nested paragraphs", () => {
  const page = extractPage(
    '<h1>Company</h1><div>Price: <strong>30,000円</strong></div><li>対象は法人<p>全国に対応</p>追加料金なし</li><div id="fine-print">税込です</div>',
    "https://example.com/",
  );
  const texts = page.blocks.map((b) => b.text);
  for (const text of [
    "Company",
    "Price: 30,000円",
    "対象は法人",
    "全国に対応",
    "追加料金なし",
    "税込です",
  ])
    assert.ok(texts.includes(text), text);
  assert.equal(texts.filter((t) => t.includes("全国に対応")).length, 1);
});
test("unverified citations and growth numbers are downgraded, duplicate references rejected", () => {
  const d = demoData();
  const result = structuredClone(d.research);
  result.references = result.references.map((r, i) => ({
    ...r,
    url: `https://reference${i}.com/`,
  }));
  result.competitors[0].url = "https://competitor.com/";
  result.competitors[1].url = "https://competitor2.com/";
  result.company.positioning[0] = {
    text: "Leader",
    kind: "fact",
    sourceUrls: ["https://invented.com/"],
  };
  result.competitors[0].growth = {
    status: "estimated",
    fromValue: 100,
    toValue: 200,
    periodFrom: "2026-01",
    periodTo: "2026-03",
    unit: "visits",
    metric: "traffic",
    sourceUrls: ["https://invented.com/"],
  };
  const grounded = groundResearch(result, [], d.inventory);
  assert.equal(grounded.company.positioning[0].kind, "hypothesis");
  assert.deepEqual(grounded.company.positioning[0].sourceUrls, []);
  assert.equal(grounded.competitors[0].growth.status, "unknown");
  grounded.references[1].url = grounded.references[0].url;
  assert.throws(() => groundResearch(grounded, [], d.inventory));
});
test("Responses parsing rejects incomplete JSON and keeps returned source provenance", () => {
  assert.throws(() => extractResponse({ status: "incomplete", output: [] }));
  const r = extractResponse({
    id: "fixture",
    status: "completed",
    output: [
      {
        type: "web_search_call",
        action: { sources: [{ url: "https://example.com/", title: "Source" }] },
      },
      {
        type: "message",
        content: [
          { type: "output_text", text: '{"answer":true}', annotations: [] },
        ],
      },
    ],
  });
  assert.equal(r.sources.length, 1);
  assert.equal(r.data.answer, true);
});
test("export paths preserve distinct routes and cannot escape archive root", () => {
  assert.equal(relativeFile("https://example.com/"), "index.html");
  assert.equal(relativeFile("https://example.com/about/"), "about/index.html");
  assert.equal(
    relativeFile("https://example.com/contact.html"),
    "contact.html",
  );
  assert.ok(!relativeFile("https://example.com/%2e%2e/secret").includes("../"));
  assert.notEqual(
    relativeFile("https://example.com/?x=1"),
    relativeFile("https://example.com/?x=2"),
  );
});
