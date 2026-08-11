// builderTools.ts — the tools the AI feature-builder is allowed to use, and
// their safe execution against a checked-out repo root.
//
// The builder runs an agentic loop (buildLoop.ts) with exactly these tools:
//   read_file, list_dir, write_file, run_build.
// Every write goes through checkWritable() (lockedPaths.ts), so the AI can
// never edit a locked guardrail/compliance/config/CI file or write outside the
// repo root — the same deterministic refusal the PreToolUse hook enforces for
// interactive sessions.
//
// The filesystem and the build runner are INJECTED, so the whole builder is
// unit-testable with an in-memory fs and a stub build — no real disk, no real
// npm, no network.

import { checkWritable, safeResolveWithinRoot } from "./lockedPaths";

// Minimal fs surface the tools need. In production this is backed by node:fs;
// in tests it's an in-memory map.
export interface BuilderFs {
  readFile(abs: string): Promise<string>;
  writeFile(abs: string, data: string): Promise<void>;
  list(abs: string): Promise<string[]>;
  exists(abs: string): Promise<boolean>;
}

// Runs the project build; returns combined output + success. Injected so tests
// don't shell out.
export type BuildRunner = () => Promise<{ ok: boolean; output: string }>;

// The tool definitions advertised to Claude (JSON-schema tool-use).
export const BUILDER_TOOLS = [
  {
    name: "read_file",
    description: "Read a UTF-8 text file from the repository, given a repo-relative path.",
    input_schema: {
      type: "object",
      properties: { path: { type: "string", description: "Repo-relative path, e.g. src/app/page.tsx" } },
      required: ["path"],
    },
  },
  {
    name: "list_dir",
    description: "List the entries of a repository directory, given a repo-relative path ('.' for root).",
    input_schema: {
      type: "object",
      properties: { path: { type: "string", description: "Repo-relative directory path" } },
      required: ["path"],
    },
  },
  {
    name: "write_file",
    description:
      "Create or overwrite a UTF-8 text file at a repo-relative path. Locked files (compliance, " +
      "guardrails, config, CI, secrets) and paths outside the repo are refused.",
    input_schema: {
      type: "object",
      properties: {
        path: { type: "string", description: "Repo-relative path" },
        content: { type: "string", description: "Full new file contents" },
      },
      required: ["path", "content"],
    },
  },
  {
    name: "run_build",
    description: "Run the project's production build (npm run build) and return whether it succeeded plus output.",
    input_schema: { type: "object", properties: {}, required: [] },
  },
] as const;

export interface ToolContext {
  root: string;
  fs: BuilderFs;
  runBuild: BuildRunner;
  // Records every successful write so the caller knows what changed (for the PR).
  changedFiles: Set<string>;
}

// Execute one tool call. Returns the text result to feed back to Claude, and
// whether it was an error (so the model can recover). Writes are gated by
// checkWritable — a refusal is returned as an error result, not thrown, so the
// model adapts instead of the loop dying.
export async function executeTool(
  name: string,
  input: any,
  ctx: ToolContext,
): Promise<{ content: string; isError: boolean }> {
  try {
    switch (name) {
      case "read_file": {
        const abs = safeResolveWithinRoot(ctx.root, String(input?.path ?? ""));
        if (!abs) return err(`Path escapes the repository root: '${input?.path}'.`);
        if (!(await ctx.fs.exists(abs))) return err(`No such file: '${input?.path}'.`);
        return ok(await ctx.fs.readFile(abs));
      }
      case "list_dir": {
        const abs = safeResolveWithinRoot(ctx.root, String(input?.path ?? "."));
        if (!abs) return err(`Path escapes the repository root: '${input?.path}'.`);
        const entries = await ctx.fs.list(abs);
        return ok(entries.join("\n"));
      }
      case "write_file": {
        const path = String(input?.path ?? "");
        const check = checkWritable(ctx.root, path);
        if (!check.ok) return err(check.reason); // locked file or traversal → refuse
        await ctx.fs.writeFile(check.abs, String(input?.content ?? ""));
        ctx.changedFiles.add(path.replace(/\\/g, "/"));
        return ok(`Wrote ${path}.`);
      }
      case "run_build": {
        const res = await ctx.runBuild();
        return { content: (res.ok ? "BUILD OK\n" : "BUILD FAILED\n") + res.output, isError: !res.ok };
      }
      default:
        return err(`Unknown tool '${name}'.`);
    }
  } catch (e) {
    return err(`Tool '${name}' threw: ${(e as Error).message}`);
  }
}

function ok(content: string): { content: string; isError: boolean } {
  return { content, isError: false };
}
function err(reason: string): { content: string; isError: boolean } {
  return { content: reason, isError: true };
}
