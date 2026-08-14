// scripts/ai-build.mjs — the GitHub Actions entrypoint for the AI feature-builder.
//
// Triggered by a repository_dispatch(event_type: "ai-build") that an APPROVED
// /tally fires. The workflow (proposed for .github/workflows/, applied by the
// founder) checks out the repo, then runs this script:
//   1. read the approved proposal from the dispatch payload (env),
//   2. run the agentic build loop (real fs + fetch + `npm run build`),
//   3. write the changed files to the working tree.
// The WORKFLOW then commits the changes to a branch and opens a PR — this
// script never merges, never pushes to main, never deploys.
//
// Run with Node 24 (type-stripping) + the TS resolve hook so the extensionless,
// bundler-style imports in src/lib/governance resolve to their .ts files:
//   node --import ./scripts/ts-loader.mjs scripts/ai-build.mjs
//
// Secrets come from the Actions environment (ANTHROPIC_API_KEY, REDIS_URL). No
// secret is read from or written to the repo.
//
// BUDGET: this build spends real money, so it refuses to start unless it can
// bind itself to the durable donation balance (REDIS_URL — the same store
// /api/paypal and /api/paypal/reconcile credit). Every model call is
// pre-checked against that balance and debited at its true cost, so a build
// stops when donations run out instead of billing the founder's card.
// AI_BUILD_ALLOW_UNBUDGETED=1 is the deliberate escape hatch for a smoke test;
// it logs loudly and is never the default.

import { readFile, writeFile, readdir, stat, mkdir } from "node:fs/promises";
import { existsSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { spawn } from "node:child_process";

import { runBuildLoop } from "../src/lib/governance/buildLoop.ts";
import { storeGuard, describeSpend } from "../src/lib/governance/spendGuard.ts";
import { RedisBudgetStore, redisUrlFromEnv } from "../src/lib/governance/redisBudgetStore.ts";

const ROOT = resolve(process.cwd());

// The approved proposal, from the dispatch client_payload (surfaced as env by
// the workflow). AI_BUILD_PAYLOAD is the JSON blob.
function readProposal() {
  const raw = process.env.AI_BUILD_PAYLOAD;
  if (!raw) throw new Error("AI_BUILD_PAYLOAD env var is missing.");
  const p = JSON.parse(raw);
  return {
    id: String(p.proposalId ?? "dispatch"),
    authorId: "vote",
    actionKind: String(p.actionKind ?? "content-edit"),
    title: String(p.title ?? "(untitled)"),
    rawBody: String(p.body ?? ""),
  };
}

// Real filesystem backing the builder tools, rooted at the checkout.
const fs = {
  async readFile(abs) {
    return readFile(abs, "utf8");
  },
  async writeFile(abs, data) {
    await mkdir(dirname(abs), { recursive: true });
    await writeFile(abs, data, "utf8");
  },
  async list(abs) {
    return readdir(abs);
  },
  async exists(abs) {
    return existsSync(abs);
  },
};

// Real build runner: `npm run build`, capturing combined output.
function runBuild() {
  return new Promise((resolveP) => {
    const child = spawn("npm", ["run", "build"], { cwd: ROOT, env: process.env });
    let out = "";
    child.stdout.on("data", (d) => (out += d));
    child.stderr.on("data", (d) => (out += d));
    child.on("close", (code) => resolveP({ ok: code === 0, output: out.slice(-6000) }));
    child.on("error", (e) => resolveP({ ok: false, output: String(e) }));
  });
}

// Bind the build to the donation balance. Fails closed: without a durable
// store there is no ceiling, and an uncapped agentic build is exactly the risk
// the budget exists to remove.
async function resolveBudget() {
  const url = redisUrlFromEnv(process.env);
  if (url) {
    const guard = storeGuard(new RedisBudgetStore({ url }));
    const balance = await guard.balance(); // fail fast if the store is unreachable
    console.log(`Budget: ${(balance / 1_000_000).toFixed(4)} ${guard.currency} of donated funds available.`);
    return guard;
  }
  if (process.env.AI_BUILD_ALLOW_UNBUDGETED === "1") {
    console.warn(
      "⚠️  UNBUDGETED BUILD: no REDIS_URL, and AI_BUILD_ALLOW_UNBUDGETED=1 is set. " +
        "This build will spend Claude tokens with NO ceiling. Intended for a one-off smoke test only.",
    );
    return undefined;
  }
  throw new Error(
    "REDIS_URL is missing, so this build cannot be bound to the donation budget and would spend " +
      "uncapped. Set REDIS_URL (the store /api/paypal credits), or set AI_BUILD_ALLOW_UNBUDGETED=1 " +
      "to deliberately run without a ceiling.",
  );
}

async function main() {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) throw new Error("ANTHROPIC_API_KEY env var is missing.");
  const proposal = readProposal();
  const budget = await resolveBudget();

  const result = await runBuildLoop(proposal, { apiKey, root: ROOT, fs, runBuild, budget });
  const spendLine = budget ? await describeSpend(budget) : "Unbudgeted build — no spend ceiling was enforced.";
  console.log(spendLine);

  // Emit a summary for the workflow to put in the PR body + decide next steps.
  // GITHUB_OUTPUT is the Actions mechanism for step outputs.
  const summary = [
    `status=${result.status}`,
    `build_passed=${result.buildPassed}`,
    `changed_count=${result.changedFiles.length}`,
    `spent_micros=${budget ? budget.totalSpentMicros() : 0}`,
  ].join("\n");
  if (process.env.GITHUB_OUTPUT) {
    await writeFile(process.env.GITHUB_OUTPUT, summary + "\n", { flag: "a" });
  }
  // Write a PR-body file the workflow reads.
  await writeFile(
    resolve(ROOT, "AI_BUILD_RESULT.md"),
    `## AI maintainer build result\n\n**Status:** ${result.status}\n**Build passed:** ${result.buildPassed}\n\n` +
      `**Proposal:** ${proposal.title}\n\n${result.summary}\n\n**Budget:** ${spendLine}\n\n` +
      (result.reasons?.length ? `**Refusal reasons:**\n${result.reasons.map((r) => `- ${r}`).join("\n")}\n\n` : "") +
      `**Changed files:**\n${result.changedFiles.map((f) => `- ${f}`).join("\n") || "(none)"}\n`,
    "utf8",
  );

  console.log(`AI build finished: ${result.status} (build ${result.buildPassed ? "OK" : "not OK"}), ` +
    `${result.changedFiles.length} file(s) changed.`);

  // Non-zero exit only on a hard refusal with no useful output, so the workflow
  // can still open a PR for build-failed/gave-up (a human decides).
  if (result.status === "refused") process.exitCode = 3;
}

main().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
