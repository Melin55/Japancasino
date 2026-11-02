import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { unzipSync, strFromU8 } from "fflate";
import { createApp } from "../server/index.js";
import { demoData } from "../server/demo.js";
async function setup(t, options = {}) {
  const dir = await mkdtemp(path.join(tmpdir(), "iikanji-test-"));
  const app = await createApp({
    dataRoot: dir,
    keyAvailable: () => false,
    ...options,
  });
  await new Promise((r) => app.server.listen(0, "127.0.0.1", r));
  t.after(async () => {
    await new Promise((r) => app.server.close(r));
    await rm(dir, { recursive: true, force: true });
  });
  return { app, base: `http://127.0.0.1:${app.server.address().port}` };
}
async function client(base) {
  let cookie = "";
  return async (url, body, method) => {
    const r = await fetch(base + url, {
      method: method || (body ? "POST" : "GET"),
      headers: {
        cookie,
        ...(body ? { "content-type": "application/json" } : {}),
      },
      body: body ? JSON.stringify(body) : undefined,
    });
    if (r.headers.get("set-cookie"))
      cookie = r.headers.get("set-cookie").split(";")[0];
    const data = r.headers.get("content-type")?.includes("json")
      ? await r.json()
      : new Uint8Array(await r.arrayBuffer());
    return { status: r.status, data };
  };
}
async function untilComplete(call, id) {
  for (let i = 0; i < 60; i++) {
    const r = await call(`/api/projects/${id}`);
    if (["complete", "ready", "error"].includes(r.data.status)) return r.data;
    await new Promise((r) => setTimeout(r, 30));
  }
  throw new Error("job did not complete");
}
test("complete sample flow: isolated ownership, concurrent ratings, real preview and ZIP, revision and deletion", async (t) => {
  const { base } = await setup(t);
  const call = await client(base);
  const created = await call("/api/projects", { mode: "demo" });
  assert.equal(created.status, 201);
  const p = created.data;
  assert.equal(p.owner, undefined);
  const other = await client(base);
  assert.equal((await other(`/api/projects/${p.id}`)).status, 404);
  assert.equal((await call(`/api/projects/${p.id}/proposal`, {})).status, 400);
  assert.equal(
    (
      await call(`/api/projects/${p.id}/ratings`, {
        referenceId: p.research.references[0].id,
        value: 6,
      })
    ).status,
    400,
  );
  const scores = await Promise.all(
    p.research.references.map((ref, i) =>
      call(`/api/projects/${p.id}/ratings`, {
        referenceId: ref.id,
        value: i === 1 ? 5 : i < 5 ? 1 : 3,
        reason: "余白",
      }),
    ),
  );
  assert.ok(scores.every((x) => x.status === 200));
  assert.equal(
    Object.keys((await call(`/api/projects/${p.id}`)).data.ratings).length,
    10,
  );
  assert.equal((await call(`/api/projects/${p.id}/proposal`, {})).status, 202);
  const done = await untilComplete(call, p.id);
  assert.equal(done.status, "complete");
  assert.equal(done.proposal.audit.passed, true);
  assert.equal(done.proposal.audit.retained, done.proposal.audit.blocks);
  assert.equal(done.proposal.profile.selectedId, "bold");
  const preview = await call(`/api/projects/${p.id}/preview`);
  assert.equal(preview.status, 200);
  assert.ok(strFromU8(preview.data).includes("暮らしに、余白を。"));
  const archive = await call(`/api/projects/${p.id}/download`);
  assert.equal(archive.status, 200);
  const files = unzipSync(archive.data);
  assert.ok(files["index.html"]);
  assert.ok(files["about/index.html"]);
  assert.ok(files["works/index.html"]);
  assert.ok(files["proposal.json"]);
  assert.ok(
    strFromU8(files["index.html"]).includes('href="/works/index.html"'),
  );
  assert.equal(
    (
      await call(`/api/projects/${p.id}/feedback`, {
        decision: "needs_changes",
        note: "文字を大きく",
      })
    ).status,
    200,
  );
  const changed = await call(`/api/projects/${p.id}/ratings`, {
    referenceId: p.research.references[1].id,
    value: 2,
  });
  assert.equal(changed.data.status, "ready");
  assert.equal(changed.data.proposal, undefined);
  assert.ok(changed.data.previousProposal);
  assert.equal(changed.data.feedback.note, "文字を大きく");
  await call(`/api/projects/${p.id}/proposal`, {});
  const revised = await untilComplete(call, p.id);
  assert.equal(revised.proposal.plan.presentation.textSize, "large");
  assert.ok(
    strFromU8((await call(`/api/projects/${p.id}/preview`)).data).includes(
      "font-size:18px",
    ),
  );
  assert.equal((await call(`/api/projects/${p.id}`, {}, "DELETE")).status, 200);
  assert.equal((await call(`/api/projects/${p.id}`)).status, 404);
});
test("missing key returns honest unavailable state; mutation rejects cross-origin requests", async (t) => {
  const { base } = await setup(t);
  const call = await client(base);
  const config = await call("/api/config");
  assert.equal(config.data.aiAvailable, false);
  const r = await call("/api/projects", { url: "https://example.com" });
  assert.equal(r.status, 503);
  assert.equal(r.data.code, "AI_NOT_CONFIGURED");
  const cross = await fetch(base + "/api/projects", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      origin: "https://attacker.example",
    },
    body: '{"mode":"demo"}',
  });
  assert.equal(cross.status, 403);
  const html = await fetch(base + "/");
  assert.equal(html.status, 200);
  assert.ok(
    html.headers.get("content-security-policy").includes("object-src 'none'"),
  );
});
test("live pipeline with provider fixtures retains provenance and reaches a verified artifact", async (t) => {
  const fixture = demoData();
  fixture.research.references = fixture.research.references.map((r, i) => ({
    ...r,
    url: `https://ref${i}.example.com/`,
    sample: false,
  }));
  let modelCalls = 0;
  const { base } = await setup(t, {
    keyAvailable: () => true,
    crawler: async () => fixture.inventory,
    referenceFetcher: async (url) => ({
      url,
      status: 200,
      contentType: "text/html",
      text: "<title>Reference</title><h1>Reference site</h1>",
    }),
    ai: {
      researchCompany: async () => {
        modelCalls++;
        return {
          data: fixture.research,
          sources: [{ url: "https://source.example.com/", title: "Source" }],
          usage: { input_tokens: 100 },
        };
      },
      planWebsite: async () => {
        modelCalls++;
        return {
          data: {
            pages: fixture.inventory.pages.map((p) => ({
              url: p.url,
              orderedBlockIds: p.blocks.map((b) => b.id),
              rationale: "Fixture",
              improvements: [],
            })),
          },
          usage: { output_tokens: 100 },
        };
      },
    },
  });
  const call = await client(base);
  const r = await call("/api/projects", {
    url: "https://company.example.com",
    goal: "inquiry",
  });
  assert.equal(r.status, 201);
  const p = await untilComplete(call, r.data.id);
  assert.equal(p.status, "ready");
  assert.equal(p.mode, "live");
  assert.equal(p.sources.length, 11);
  assert.equal(modelCalls, 1);
  for (const [i, ref] of p.research.references.entries())
    await call(`/api/projects/${p.id}/ratings`, {
      referenceId: ref.id,
      value: (i % 5) + 1,
    });
  await call(`/api/projects/${p.id}/proposal`, {});
  const done = await untilComplete(call, p.id);
  assert.equal(done.status, "complete");
  assert.equal(done.proposal.audit.passed, true);
  assert.equal(modelCalls, 2);
  assert.equal(done.usage.length, 2);
});
