import http from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { readFile } from "node:fs/promises";
import { randomBytes } from "node:crypto";
import { zipSync, strToU8 } from "fflate";
import { ProjectStore } from "./store.js";
import { normalizeUrl, UserError, publicFetch } from "./network.js";
import { crawlSite, extractPage } from "./crawler.js";
import { researchCompany, planWebsite } from "./ai.js";
import { demoData, sampleReferenceHtml } from "./demo.js";
import {
  preferenceProfile,
  chooseTheme,
  renderPage,
  auditProposal,
  relativeFile,
} from "./design.js";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const goals = {
  inquiry: "問い合わせを増やす",
  brand: "会社の魅力を伝える",
  recruit: "採用につなげる",
};
export async function createApp({
  dataRoot = path.join(root, ".data"),
  ai = { researchCompany, planWebsite },
  crawler = crawlSite,
  keyAvailable = () => Boolean(process.env.OPENAI_API_KEY?.trim()),
  referenceFetcher = publicFetch,
} = {}) {
  const store = new ProjectStore(dataRoot);
  await store.init();
  const active = new Map();
  const limits = new Map();
  const mutationQueues = new Map();
  async function lock(id) {
    const before = mutationQueues.get(id) || Promise.resolve();
    let release;
    const held = new Promise((resolve) => {
      release = resolve;
    });
    mutationQueues.set(id, held);
    await before;
    return () => {
      release();
      if (mutationQueues.get(id) === held) mutationQueues.delete(id);
    };
  }
  const save = (project) => store.save(project);
  const publicProject = (project) => {
    const { owner, ...rest } = project;
    return rest;
  };
  function event(p, type, data = {}) {
    p.events.push({ at: new Date().toISOString(), type, ...data });
    if (p.events.length > 300) p.events = p.events.slice(-300);
  }
  async function runResearch(project) {
    try {
      project.status = "crawling";
      await save(project);
      project.inventory = await crawler(project.url, {
        maxPages: Math.max(
          1,
          Math.min(20, Number(process.env.MAX_CRAWL_PAGES) || 12),
        ),
        onProgress: async (progress) => {
          project.progress = progress;
          await save(project);
        },
      });
      project.status = "researching";
      await save(project);
      const result = await ai.researchCompany(project);
      project.research = result.data;
      project.sources = result.sources;
      project.usage = [{ stage: "research", ...result.usage }];
      // Resolve real reference pages; do not replace failed candidates with fabricated cards.
      for (let i = 0; i < project.research.references.length; i += 3) {
        await Promise.all(
          project.research.references.slice(i, i + 3).map(async (ref) => {
            try {
              const page = await referenceFetcher(ref.url, {
                maxBytes: 2_000_000,
              });
              if (page.status !== 200 || !page.contentType.includes("html"))
                throw new Error("unavailable");
              ref.reachable = true;
              ref.checkedAt = new Date().toISOString();
              if (!project.sources.some((s) => s.url === ref.url))
                project.sources.push({
                  url: ref.url,
                  title: extractPage(page.text, page.url).title,
                });
            } catch {
              ref.reachable = false;
              ref.previewNote =
                "この参考サイトは取得を確認できませんでした。原サイトを確認して採点してください。";
            }
          }),
        );
      }
      project.status = "ready";
      event(project, "research_completed", {
        pages: project.inventory.pages.length,
        sources: project.sources.length,
      });
      await save(project);
    } catch (e) {
      project.status = "error";
      project.error =
        e instanceof UserError
          ? e.message
          : "調査を完了できませんでした。URLを確認して、もう一度お試しください。";
      project.errorCode = e.code || "RESEARCH_FAILED";
      event(project, "research_failed", { code: project.errorCode });
      await save(project);
    } finally {
      active.delete(project.id);
    }
  }
  async function runProposal(project) {
    try {
      project.status = "building";
      await save(project);
      const profile = preferenceProfile(
        project.research.references,
        project.ratings,
      );
      const result =
        project.mode === "demo"
          ? {
              data: {
                pages: project.inventory.pages.map((p) => ({
                  url: p.url,
                  orderedBlockIds: p.blocks.map((b) => b.id),
                  rationale:
                    "取得した見出しと本文を保持し、採点から選ばれた色・文字・余白を反映しました。",
                  improvements: project.research.recommendations,
                })),
                presentation: {
                  textSize: /文字.*(大|読みやす)/.test(
                    project.feedback?.note || "",
                  )
                    ? "large"
                    : "standard",
                  spacing: "comfortable",
                },
              },
              usage: {},
            }
          : await ai.planWebsite(project, profile);
      project.proposal = {
        profile,
        theme: chooseTheme(profile, project.research.references),
        plan: result.data,
        createdAt: new Date().toISOString(),
        ratingRevision: JSON.stringify(project.ratings),
      };
      project.proposal.audit = auditProposal(project);
      project.usage.push({ stage: "proposal", ...result.usage });
      project.status = "complete";
      event(project, "proposal_created", {
        auditPassed: project.proposal.audit.passed,
        selectedId: profile.selectedId,
      });
      await save(project);
    } catch (e) {
      project.status = "error";
      project.error =
        e instanceof UserError
          ? e.message
          : "提案の作成を完了できませんでした。採点は保存されています。";
      project.errorCode = e.code || "PROPOSAL_FAILED";
      await save(project);
    } finally {
      active.delete(project.id);
    }
  }
  const server = http.createServer(async (req, res) => {
    res.setHeader("X-Content-Type-Options", "nosniff");
    res.setHeader("Referrer-Policy", "no-referrer");
    res.setHeader("Cache-Control", "no-store");
    res.setHeader(
      "Content-Security-Policy",
      "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' https: data:; frame-src 'self'; connect-src 'self'; object-src 'none'; base-uri 'none'; form-action 'self'; frame-ancestors 'self'",
    );
    const json = (status, data) => {
      res.writeHead(status, {
        "content-type": "application/json; charset=utf-8",
      });
      res.end(JSON.stringify(data));
    };
    let unlock;
    try {
      const url = new URL(req.url, "http://localhost");
      const incomingCookie = String(req.headers.cookie || "").match(
        /(?:^|; )iikanji_session=([a-f0-9]{64})(?:;|$)/,
      )?.[1];
      const owner = incomingCookie || randomBytes(32).toString("hex");
      if (!incomingCookie)
        res.setHeader(
          "Set-Cookie",
          `iikanji_session=${owner}; HttpOnly; SameSite=Strict; Path=/; Max-Age=2592000`,
        );
      if (!["GET", "HEAD"].includes(req.method)) {
        if (
          req.headers.origin &&
          req.headers.origin !== `http://${req.headers.host}` &&
          req.headers.origin !== `https://${req.headers.host}`
        )
          throw new UserError(
            "この操作を実行できません。ページを再読み込みしてください。",
            403,
          );
        if (!String(req.headers["content-type"]).startsWith("application/json"))
          throw new UserError("JSON形式で送信してください。", 415);
      }
      let body = {};
      if (["POST", "PUT", "DELETE"].includes(req.method)) {
        let size = 0;
        const chunks = [];
        for await (const chunk of req) {
          size += chunk.length;
          if (size > 100000)
            throw new UserError("送信内容が大きすぎます。", 413);
          chunks.push(chunk);
        }
        try {
          body = JSON.parse(Buffer.concat(chunks).toString() || "{}");
        } catch {
          throw new UserError("送信内容を読み取れませんでした。");
        }
      }
      if (url.pathname === "/api/config" && req.method === "GET")
        return json(200, {
          aiAvailable: keyAvailable(),
          maxPages: Math.max(
            1,
            Math.min(20, Number(process.env.MAX_CRAWL_PAGES) || 12),
          ),
        });
      if (url.pathname === "/api/projects" && req.method === "POST") {
        if (body.mode !== "demo" && !keyAvailable())
          throw new UserError(
            "現在、サイト調査を開始できません。サンプルはそのまま体験できます。",
            503,
            "AI_NOT_CONFIGURED",
          );
        const timestamps = (limits.get(owner) || []).filter(
          (t) => Date.now() - t < 3600000,
        );
        if (timestamps.length >= 6)
          throw new UserError(
            "この時間帯の作成回数に達しました。時間をおいてお試しください。",
            429,
          );
        if ([...active.values()].includes(owner))
          throw new UserError(
            "進行中の調査が完了するまでお待ちください。",
            409,
          );
        const data =
          body.mode === "demo"
            ? demoData()
            : {
                mode: "live",
                url: normalizeUrl(String(body.url || "")),
                goal: goals[body.goal] || goals.inquiry,
                status: "crawling",
                sources: [],
                usage: [],
              };
        const p = await store.create(owner, data);
        limits.set(owner, [...timestamps, Date.now()]);
        event(p, "project_created", { mode: p.mode });
        await save(p);
        if (p.mode !== "demo") {
          active.set(p.id, owner);
          void runResearch(p);
        }
        return json(201, publicProject(p));
      }
      const match = url.pathname.match(
        /^\/api\/projects\/([a-f0-9-]+)(?:\/(ratings|proposal|preview|download|feedback|reference))?$/,
      );
      if (match) {
        if (req.method !== "GET") unlock = await lock(match[1]);
        const p = await store.get(match[1], owner);
        const action = match[2];
        if (!action && req.method === "GET") return json(200, publicProject(p));
        if (!action && req.method === "DELETE") {
          if (active.has(p.id))
            throw new UserError("処理が完了してから削除してください。", 409);
          await store.delete(p.id, owner);
          return json(200, { deleted: true });
        }
        if (action === "ratings" && req.method === "POST") {
          if (active.has(p.id))
            throw new UserError(
              "処理が完了してから採点を変更してください。",
              409,
            );
          if (
            !p.research?.references.some((r) => r.id === body.referenceId) ||
            !Number.isInteger(body.value) ||
            body.value < 1 ||
            body.value > 5
          )
            throw new UserError("1〜5点で採点してください。");
          const reason =
            typeof body.reason === "string" ? body.reason.slice(0, 160) : "";
          p.ratings[body.referenceId] = {
            value: body.value,
            reason,
            at: new Date().toISOString(),
          };
          event(p, "rating", {
            referenceId: body.referenceId,
            value: body.value,
            reason,
          });
          if (p.proposal) {
            p.previousProposal = p.proposal;
            delete p.proposal;
          }
          p.status = "ready";
          delete p.error;
          await save(p);
          return json(200, publicProject(p));
        }
        if (action === "proposal" && req.method === "POST") {
          if (active.has(p.id)) throw new UserError("提案を作成中です。", 409);
          if (
            p.research?.references.length !== 10 ||
            p.research.references.some((r) => !p.ratings[r.id])
          )
            throw new UserError(
              "10件すべての採点を終えてから提案を作成してください。",
            );
          if (p.proposal && p.status === "complete")
            return json(200, publicProject(p));
          if (p.mode !== "demo" && !keyAvailable())
            throw new UserError(
              "現在、提案を作成できません。採点は保存されています。",
              503,
              "AI_NOT_CONFIGURED",
            );
          const proposalRuns = p.events.filter(
            (e) => e.type === "proposal_started",
          ).length;
          if (p.mode !== "demo" && proposalRuns >= 3)
            throw new UserError(
              "この提案の作成上限に達しました。保存済みの提案をご確認ください。",
              429,
            );
          p.status = "building";
          event(p, "proposal_started");
          await save(p);
          active.set(p.id, owner);
          void runProposal(p);
          return json(202, publicProject(p));
        }
        if (
          action === "reference" &&
          req.method === "GET" &&
          p.mode === "demo"
        ) {
          const ref = p.research.references.find(
            (r) => r.id === url.searchParams.get("id"),
          );
          if (!ref) throw new UserError("参考デザインが見つかりません。", 404);
          res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
          return res.end(sampleReferenceHtml(ref));
        }
        if (action === "preview" && req.method === "GET") {
          if (!p.proposal)
            throw new UserError("提案を作成してから開いてください。", 409);
          const page =
            p.inventory.pages.find(
              (page) => page.url === url.searchParams.get("url"),
            ) || (!url.searchParams.get("url") ? p.inventory.pages[0] : null);
          if (!page) throw new UserError("ページが見つかりません。", 404);
          res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
          return res.end(renderPage(p, page));
        }
        if (action === "download" && req.method === "GET") {
          if (!p.proposal)
            throw new UserError(
              "提案を作成してからダウンロードしてください。",
              409,
            );
          const files = {};
          const mapping = {};
          for (const page of p.inventory.pages) {
            const file = relativeFile(page.url);
            if (files[file])
              throw new UserError(
                "書き出し先のURLが重複しているため停止しました。",
                409,
              );
            files[file] = strToU8(renderPage(p, page, { exportMode: true }));
            mapping[page.url] = file;
          }
          files["url-map.json"] = strToU8(JSON.stringify(mapping, null, 2));
          files["proposal.json"] = strToU8(
            JSON.stringify(
              {
                company: p.research.company,
                recommendations: p.research.recommendations,
                proposal: p.proposal,
                sources: p.sources,
              },
              null,
              2,
            ),
          );
          files["README.txt"] = strToU8(
            "リニューアル提案です。公開前の確認用として noindex を付けています。\nこのフォルダをHTTPサーバーのルートとして配信してください。\n外部画像と元サイトへのリンクはオンラインで利用します。\nフォーム・決済・会員機能は移植されていません。元サイトを参照します。\nURL対応は url-map.json、検査の対象と結果は proposal.json を参照してください。\n",
          );
          const zip = zipSync(files);
          res.writeHead(200, {
            "content-type": "application/zip",
            "content-disposition":
              'attachment; filename="iikanji-proposal.zip"',
          });
          return res.end(Buffer.from(zip));
        }
        if (action === "feedback" && req.method === "POST") {
          if (active.has(p.id))
            throw new UserError("処理が完了してから送信してください。", 409);
          if (!["accepted", "needs_changes"].includes(body.decision))
            throw new UserError("提案の評価を選んでください。");
          event(p, "feedback", {
            decision: body.decision,
            note: String(body.note || "").slice(0, 1000),
          });
          p.feedback = {
            decision: body.decision,
            note: String(body.note || "").slice(0, 1000),
            at: new Date().toISOString(),
          };
          await save(p);
          return json(200, { saved: true });
        }
        throw new UserError("この操作は利用できません。", 404);
      }
      if (req.method === "GET" || req.method === "HEAD") {
        const assets = {
          "/": "index.html",
          "/index.html": "index.html",
          "/app.js": "app.js",
          "/styles.css": "styles.css",
          "/favicon.svg": "favicon.svg",
        };
        const name = assets[url.pathname];
        if (!name) throw new UserError("ページが見つかりません。", 404);
        const mime = {
          html: "text/html",
          js: "text/javascript",
          css: "text/css",
          svg: "image/svg+xml",
        }[name.split(".").pop()];
        const file = await readFile(path.join(root, "public", name));
        res.writeHead(200, { "content-type": `${mime}; charset=utf-8` });
        return res.end(req.method === "HEAD" ? undefined : file);
      }
      throw new UserError("ページが見つかりません。", 404);
    } catch (e) {
      if (!res.headersSent)
        json(e.status || 500, {
          error:
            e instanceof UserError
              ? e.message
              : "処理を完了できませんでした。もう一度お試しください。",
          code: e.code || "INTERNAL_ERROR",
        });
      else res.end();
    } finally {
      unlock?.();
    }
  });
  server.requestTimeout = 30000;
  return { server, store, active };
}
if (
  process.argv[1] &&
  path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  const { server } = await createApp();
  const port = Number(process.env.PORT) || 3000;
  const host = process.env.HOST || "127.0.0.1";
  server.listen(port, host, () =>
    console.log(`HPいい感じにしますくん: http://${host}:${port}`),
  );
}
