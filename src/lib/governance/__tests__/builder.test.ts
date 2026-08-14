// builder.test.ts — verification for the AI feature-builder, the most
// safety-critical surface in the project (untrusted proposal text → code).
//
// Covers: locked-file + traversal refusal at the write tool, the re-screen that
// refuses non-compliant proposals, a full agentic loop against a STUBBED Claude
// that writes a file and builds, the budget hard-stop, and the GitHub dispatch
// payload. All offline — injected fs, build runner, and fetch.

import { test } from "node:test";
import assert from "node:assert/strict";

import { isLockedPath, safeResolveWithinRoot, checkWritable } from "../lockedPaths";
import { executeTool, type ToolContext, type BuilderFs } from "../builderTools";
import { runBuildLoop } from "../buildLoop";
import { BudgetLedger } from "../budget";
import { ledgerGuard } from "../spendGuard";
import { dispatchAiBuild } from "../githubDispatch";
import type { FetchLike } from "../aiClient";
import type { Proposal } from "../types";

const ROOT = "/repo";

// In-memory fs for the builder tools.
function memFs(seed: Record<string, string> = {}): { fs: BuilderFs; files: Map<string, string> } {
  const files = new Map<string, string>(Object.entries(seed));
  const fs: BuilderFs = {
    async readFile(abs) {
      if (!files.has(abs)) throw new Error("ENOENT");
      return files.get(abs)!;
    },
    async writeFile(abs, data) {
      files.set(abs, data);
    },
    async list(abs) {
      const prefix = abs.endsWith("/") ? abs : abs + "/";
      return [...files.keys()].filter((k) => k.startsWith(prefix)).map((k) => k.slice(prefix.length).split("/")[0]);
    },
    async exists(abs) {
      return files.has(abs);
    },
  };
  return { fs, files };
}

// ---------------------------------------------------------------------------
// LOCKED-PATH GUARD
// ---------------------------------------------------------------------------
test("lockedPaths: recognizes locked files, .env, .claude, .github", () => {
  for (const p of [
    "COMPLIANCE.md",
    "CLAUDE.md",
    "GUARDRAILS.md",
    "package.json",
    "next.config.js",
    "tsconfig.json",
    ".env",
    ".env.local",
    ".claude/settings.json",
    ".github/workflows/ci.yml",
    "src/../.github/x",
  ]) {
    assert.equal(isLockedPath(p), true, `${p} should be locked`);
  }
  for (const p of ["src/app/page.tsx", "public/logo.png", "README.md", "src/lib/x.ts"]) {
    assert.equal(isLockedPath(p), false, `${p} should NOT be locked`);
  }
});

test("lockedPaths: traversal outside root is refused; inside is allowed", () => {
  assert.equal(safeResolveWithinRoot(ROOT, "src/app/page.tsx"), "/repo/src/app/page.tsx");
  assert.equal(safeResolveWithinRoot(ROOT, "../secrets.txt"), null);
  assert.equal(safeResolveWithinRoot(ROOT, "src/../../etc/passwd"), null);
  assert.equal(safeResolveWithinRoot(ROOT, "/etc/passwd"), null);
});

test("lockedPaths: checkWritable blocks locked + traversal, allows src", () => {
  assert.equal(checkWritable(ROOT, "COMPLIANCE.md").ok, false);
  assert.equal(checkWritable(ROOT, ".github/workflows/x.yml").ok, false);
  assert.equal(checkWritable(ROOT, "../evil.ts").ok, false);
  assert.equal(checkWritable(ROOT, "src/app/new.tsx").ok, true);
});

// ---------------------------------------------------------------------------
// WRITE TOOL refuses locked files at execution time
// ---------------------------------------------------------------------------
test("write_file tool refuses a locked file and never writes it", async () => {
  const { fs, files } = memFs();
  const ctx: ToolContext = { root: ROOT, fs, runBuild: async () => ({ ok: true, output: "" }), changedFiles: new Set() };

  const denied = await executeTool("write_file", { path: "COMPLIANCE.md", content: "hacked" }, ctx);
  assert.equal(denied.isError, true);
  assert.match(denied.content, /LOCKED/);
  assert.equal(files.has("/repo/COMPLIANCE.md"), false);
  assert.equal(ctx.changedFiles.size, 0);

  const ok = await executeTool("write_file", { path: "src/app/x.tsx", content: "ok" }, ctx);
  assert.equal(ok.isError, false);
  assert.equal(files.get("/repo/src/app/x.tsx"), "ok");
  assert.ok(ctx.changedFiles.has("src/app/x.tsx"));
});

// ---------------------------------------------------------------------------
// RE-SCREEN: a non-compliant proposal refuses to build
// ---------------------------------------------------------------------------
test("buildLoop: a non-compliant proposal is refused before any model call", async () => {
  let called = false;
  const fetchImpl: FetchLike = async () => {
    called = true;
    return { ok: true, status: 200, json: async () => ({}), text: async () => "" };
  };
  const { fs } = memFs();
  const proposal: Proposal = {
    id: "p-rmt",
    authorId: "x",
    actionKind: "content-edit",
    title: "Add $20 Stripe checkout to rent a car",
    rawBody: "Charge real money to rent.",
  };
  const result = await runBuildLoop(proposal, {
    apiKey: "k",
    root: ROOT,
    fs,
    runBuild: async () => ({ ok: true, output: "" }),
    fetchImpl,
  });
  assert.equal(result.status, "refused");
  assert.equal(called, false, "no model call for a refused proposal");
  assert.ok(result.reasons && result.reasons.length > 0);
});

// ---------------------------------------------------------------------------
// FULL LOOP against a stubbed Claude: write a file, build, finish
// ---------------------------------------------------------------------------
test("buildLoop: implements a compliant change end to end (stubbed model)", async () => {
  const { fs, files } = memFs({ "/repo/src/app/page.tsx": "old" });

  // Scripted model: turn 1 → write_file + run_build; turn 2 → done (text only).
  let turn = 0;
  const fetchImpl: FetchLike = async () => {
    turn++;
    if (turn === 1) {
      return jsonResp({
        content: [
          { type: "text", text: "Adding the note." },
          { type: "tool_use", id: "t1", name: "write_file", input: { path: "src/app/note.tsx", content: "export const Note = () => null;" } },
          { type: "tool_use", id: "t2", name: "run_build", input: {} },
        ],
        usage: { input_tokens: 100, output_tokens: 50 },
      });
    }
    return jsonResp({
      content: [{ type: "text", text: "Done: added a Note component." }],
      usage: { input_tokens: 120, output_tokens: 20 },
    });
  };

  const result = await runBuildLoop(
    { id: "p1", authorId: "x", actionKind: "content-edit", title: "Add a Note component", rawBody: "Add a small Note component." },
    { apiKey: "k", root: ROOT, fs, runBuild: async () => ({ ok: true, output: "compiled" }), fetchImpl },
  );

  assert.equal(result.status, "built");
  assert.equal(result.buildPassed, true);
  assert.deepEqual(result.changedFiles, ["src/app/note.tsx"]);
  assert.equal(files.get("/repo/src/app/note.tsx"), "export const Note = () => null;");
  assert.match(result.summary, /Done/);
});

test("buildLoop: a failing build is reported as build-failed (human decides)", async () => {
  const { fs } = memFs();
  let turn = 0;
  const fetchImpl: FetchLike = async () => {
    turn++;
    if (turn === 1) {
      return jsonResp({
        content: [
          { type: "tool_use", id: "t1", name: "write_file", input: { path: "src/x.ts", content: "syntax ((" } },
          { type: "tool_use", id: "t2", name: "run_build", input: {} },
        ],
        usage: { input_tokens: 10, output_tokens: 10 },
      });
    }
    return jsonResp({ content: [{ type: "text", text: "Couldn't fix the build." }], usage: { input_tokens: 10, output_tokens: 5 } });
  };
  const result = await runBuildLoop(
    { id: "p2", authorId: "x", actionKind: "content-edit", title: "x", rawBody: "y" },
    { apiKey: "k", root: ROOT, fs, runBuild: async () => ({ ok: false, output: "SyntaxError" }), fetchImpl },
  );
  assert.equal(result.status, "build-failed");
  assert.equal(result.buildPassed, false);
});

// ---------------------------------------------------------------------------
// BUDGET hard-stop
// ---------------------------------------------------------------------------
test("buildLoop: stops when the budget can't afford the next step", async () => {
  const { fs } = memFs();
  const ledger = new BudgetLedger(50); // 50 µ$ — nowhere near a build step estimate
  let called = false;
  const fetchImpl: FetchLike = async () => {
    called = true;
    return jsonResp({ content: [], usage: {} });
  };
  const result = await runBuildLoop(
    { id: "p3", authorId: "x", actionKind: "content-edit", title: "tiny", rawBody: "tiny" },
    {
      apiKey: "k",
      root: ROOT,
      fs,
      runBuild: async () => ({ ok: true, output: "" }),
      fetchImpl,
      budget: ledgerGuard(ledger),
    },
  );
  assert.equal(result.status, "budget-exhausted");
  assert.equal(called, false, "no model call when the budget can't afford it");
});

// ---------------------------------------------------------------------------
// GITHUB DISPATCH payload
// ---------------------------------------------------------------------------
test("dispatchAiBuild: POSTs the right event and payload; false on failure", async () => {
  let captured: any = null;
  const fetchOk: FetchLike = async (url, init) => {
    captured = { url, body: JSON.parse((init as any).body) };
    return { ok: true, status: 204, json: async () => ({}), text: async () => "" };
  };
  const ok = await dispatchAiBuild(
    { proposalId: "p", title: "T", actionKind: "content-edit", body: "B" },
    { token: "ghtok", owner: "BorderKeeper", repo: "dayzcarrental", fetchImpl: fetchOk },
  );
  assert.equal(ok, true);
  assert.match(captured.url, /repos\/BorderKeeper\/dayzcarrental\/dispatches$/);
  assert.equal(captured.body.event_type, "ai-build");
  assert.equal(captured.body.client_payload.title, "T");

  const fetchFail: FetchLike = async () => ({ ok: false, status: 401, json: async () => ({}), text: async () => "bad" });
  const bad = await dispatchAiBuild(
    { proposalId: "p", title: "T", actionKind: "content-edit", body: "B" },
    { token: "x", owner: "o", repo: "r", fetchImpl: fetchFail },
  );
  assert.equal(bad, false);
});

function jsonResp(body: any) {
  return { ok: true, status: 200, json: async () => body, text: async () => "" };
}
