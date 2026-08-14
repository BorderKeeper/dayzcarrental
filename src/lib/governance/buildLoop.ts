// buildLoop.ts — the AI feature-builder's agentic loop.
//
// Given an APPROVED proposal, this drives Claude through a manual tool-use loop
// (read/list/write/build — builderTools.ts) to implement the feature, then
// returns a summary + the set of changed files for the PR. It NEVER merges and
// NEVER deploys — the caller (the GitHub Actions entrypoint) opens a branch/PR
// the founder merges.
//
// Defense-in-depth, because this is the surface that turns untrusted proposal
// text into code:
//   * RE-SCREEN — the proposal is run through screen.ts again here, so even if
//     it somehow reached the builder, a non-compliant/injection proposal
//     refuses to build (belt-and-suspenders on the vote-time screen).
//   * LOCKED-FILE REFUSAL — every write goes through checkWritable(); the AI
//     cannot edit compliance/guardrail/config/CI files or escape the repo root.
//   * BOUNDED — a hard cap on iterations so a confused model can't loop forever.
//   * BUDGET-BOUND — a SpendGuard; each model call is pre-checked and its
//     actual token usage debited, so builds stop when donations run out. In CI
//     the guard is backed by the DURABLE donation balance (spendGuard.ts), so
//     the ceiling is real money rather than a per-process counter.
//
// No SDK (package.json is locked): raw fetch to the Messages API. The transport,
// fs, build runner, and clock are all injected → fully unit-testable offline.

import type { Proposal } from "./types";
import { screenProposal } from "./screen";
import { BUILDER_TOOLS, executeTool, type BuilderFs, type BuildRunner, type ToolContext } from "./builderTools";
import type { SpendGuard } from "./spendGuard";
import { OPUS_5_PRICING, actualCostMicros, estimateMaxCostMicros, type FetchLike, type ModelPricing } from "./aiClient";

export interface BuildResult {
  status: "built" | "refused" | "build-failed" | "budget-exhausted" | "gave-up";
  summary: string;
  changedFiles: string[];
  buildPassed: boolean;
  reasons?: string[]; // for "refused"
}

export interface BuildLoopOptions {
  apiKey: string;
  root: string;
  fs: BuilderFs;
  runBuild: BuildRunner;
  fetchImpl?: FetchLike;
  // Budget enforcement. Optional at the type level so tests can omit it, but
  // the CI entrypoint (scripts/ai-build.mjs) REFUSES to build without one —
  // an unbudgeted build spends real money with no ceiling.
  budget?: SpendGuard;
  maxIterations?: number; // default 12
  maxTokens?: number; // per model call, default 8192
  model?: string;
  pricing?: ModelPricing;
}

const SYSTEM = [
  "You are the AI maintainer for DayzCarRental.com, implementing a community-APPROVED change.",
  "You work ONLY within the repository via the provided tools. Rules you cannot break:",
  "- Never edit locked files (COMPLIANCE.md, CLAUDE.md, GUARDRAILS.md, .claude/**, .github/**,",
  "  package.json, package-lock.json, next.config.js, tsconfig.json, any .env*). The write tool will",
  "  refuse them — do not fight it; work within src/, public/, and non-locked docs.",
  "- Never add real-money rental pricing/checkout, never gate gameplay behind donations, never remove",
  "  the 'not affiliated with Bohemia' disclaimer. Match existing code style.",
  "- Make the smallest focused change that implements the request. Then call run_build and fix any",
  "  errors. When the build passes and the feature is done, stop and give a one-paragraph summary of",
  "  what you changed.",
].join("\n");

// Rough input-token estimate for the budget pre-check (chars/4).
function estTokens(s: string): number {
  return Math.ceil(s.length / 4);
}

export async function runBuildLoop(proposal: Proposal, opts: BuildLoopOptions): Promise<BuildResult> {
  // 1. RE-SCREEN. A non-compliant or injection proposal never builds.
  const screen = screenProposal(proposal);
  if (!screen.ok) {
    return {
      status: "refused",
      summary: "Refused to build: the proposal failed the compliance/safety screen.",
      changedFiles: [],
      buildPassed: false,
      reasons: screen.reasons.map((r) => r.detail),
    };
  }

  const fetchImpl: FetchLike =
    opts.fetchImpl ?? ((url, init) => fetch(url, init) as unknown as ReturnType<FetchLike>);
  const model = opts.model ?? "claude-opus-5";
  const pricing = opts.pricing ?? OPUS_5_PRICING;
  const maxTokens = opts.maxTokens ?? 8192;
  const maxIterations = opts.maxIterations ?? 12;

  const ctx: ToolContext = {
    root: opts.root,
    fs: opts.fs,
    runBuild: opts.runBuild,
    changedFiles: new Set<string>(),
  };

  // Conversation seed: the approved proposal as the task.
  const messages: any[] = [
    {
      role: "user",
      content:
        `A community vote APPROVED this change. Implement it, then run the build.\n\n` +
        `Title: ${proposal.title}\nKind: ${proposal.actionKind}\n\nDetails:\n${proposal.rawBody}`,
    },
  ];

  let lastText = "";
  let buildPassed = false;

  for (let i = 0; i < maxIterations; i++) {
    // Budget pre-check (worst case), if a guard is enforcing. Checked BEFORE
    // the call, against the worst case, so we never start a step we can't pay
    // for — the debit afterwards is the true cost, which is lower.
    if (opts.budget) {
      const estIn = estTokens(SYSTEM) + estTokens(JSON.stringify(messages));
      const estimate = estimateMaxCostMicros(estIn, maxTokens, pricing);
      if (!(await opts.budget.canAfford(estimate))) {
        return {
          status: "budget-exhausted",
          summary: "Stopped: the donation-funded budget can't afford another build step.",
          changedFiles: [...ctx.changedFiles],
          buildPassed,
        };
      }
    }

    const res = await fetchImpl("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-api-key": opts.apiKey,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({ model, max_tokens: maxTokens, system: SYSTEM, tools: BUILDER_TOOLS, messages }),
    });
    if (!res.ok) {
      const body = await res.text();
      throw new Error(`Anthropic API error ${res.status}: ${body.slice(0, 400)}`);
    }
    const data = await res.json();

    // Debit actual usage. The guard clamps at zero and never throws, so a bad
    // estimate can't crash a build mid-flight — it just leaves the balance at
    // zero, and the next pre-check stops the loop.
    if (opts.budget) {
      const usage = {
        inputTokens: data?.usage?.input_tokens ?? 0,
        outputTokens: data?.usage?.output_tokens ?? 0,
        cacheReadTokens: data?.usage?.cache_read_input_tokens ?? 0,
      };
      await opts.budget.spend(actualCostMicros(usage, pricing), `AI build step (${model})`);
    }

    const content: any[] = Array.isArray(data?.content) ? data.content : [];
    lastText = content.filter((b) => b.type === "text").map((b) => b.text).join("").trim() || lastText;

    const toolUses = content.filter((b) => b.type === "tool_use");

    // No tool calls → the model is done talking. Append and finish.
    if (toolUses.length === 0) {
      return {
        status: ctx.changedFiles.size > 0 ? (buildPassed ? "built" : "build-failed") : "gave-up",
        summary: lastText || "The builder finished with no summary.",
        changedFiles: [...ctx.changedFiles],
        buildPassed,
      };
    }

    // Execute each tool call; collect results.
    messages.push({ role: "assistant", content });
    const toolResults: any[] = [];
    for (const tu of toolUses) {
      const out = await executeTool(tu.name, tu.input, ctx);
      if (tu.name === "run_build") buildPassed = !out.isError;
      toolResults.push({
        type: "tool_result",
        tool_use_id: tu.id,
        content: out.content,
        is_error: out.isError,
      });
    }
    messages.push({ role: "user", content: toolResults });
  }

  // Hit the iteration cap.
  return {
    status: ctx.changedFiles.size > 0 ? (buildPassed ? "built" : "build-failed") : "gave-up",
    summary: (lastText ? lastText + "\n\n" : "") + `(Stopped at the ${maxIterations}-iteration cap.)`,
    changedFiles: [...ctx.changedFiles],
    buildPassed,
  };
}
