import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { auditProposal } from "../server/design.js";

const includeDemo = process.argv.includes("--include-demo");
const root = path.resolve(".data");
let files = [];
try {
  files = await readdir(root);
} catch (e) {
  if (e.code !== "ENOENT") throw e;
}
const projects = [];
let unreadableRecords = 0;
for (const name of files.filter((name) => name.endsWith(".json"))) {
  try {
    const p = JSON.parse(await readFile(path.join(root, name), "utf8"));
    if (includeDemo || p.mode === "live") projects.push(p);
  } catch {
    unreadableRecords++;
  }
}
const proposals = projects.filter((p) => p.proposal);
const verified = proposals.map((p) => ({
  audit: auditProposal(p),
  feedback: p.feedback,
}));
const feedback = verified.filter((p) => p.feedback);
const accepted = feedback.filter(
  (p) => p.feedback.decision === "accepted",
).length;
const usage = projects.flatMap((p) => p.usage || []);
console.log(
  JSON.stringify(
    {
      measuredAt: new Date().toISOString(),
      population: includeDemo
        ? "includes_fictional_demo_not_customer_outcomes"
        : "live_only",
      status: projects.length
        ? "observations_only_no_causal_claim"
        : "no_live_data",
      projects: projects.length,
      completedProposals: proposals.length,
      auditedProposals: verified.length,
      auditFailures: verified.filter((p) => !p.audit.passed).length,
      completedRatingSets: projects.filter(
        (p) => Object.keys(p.ratings || {}).length === 10,
      ).length,
      feedbackCount: feedback.length,
      accepted,
      needsChanges: feedback.length - accepted,
      acceptanceAmongRespondents: feedback.length
        ? accepted / feedback.length
        : null,
      inputTokens: usage.reduce((n, x) => n + (Number(x.input_tokens) || 0), 0),
      outputTokens: usage.reduce(
        (n, x) => n + (Number(x.output_tokens) || 0),
        0,
      ),
      unreadableRecords,
      modelTrainingPerformed: false,
      caution:
        "少数の観測・自己選択された回答です。提案品質や事業成果の向上を証明する数値ではありません。",
    },
    null,
    2,
  ),
);
