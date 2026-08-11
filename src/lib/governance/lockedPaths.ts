// lockedPaths.ts — the AI feature-builder's in-code mirror of the repo's locked
// files (see .claude/hooks/guard.js) plus path-traversal safety.
//
// The builder is the most sensitive surface in the project: an APPROVED
// proposal's text becomes the instruction to an AI that writes code. Even
// though a human merges the resulting PR, the builder must NOT be able to edit
// its own guardrails or compliance/config files, and must not write outside the
// repo root. This module is the deterministic refusal used by the write tool —
// the same defense the PreToolUse hook provides for the interactive session,
// now applied inside the autonomous builder.

import { relative, resolve, sep } from "node:path";

// Locked basenames — compliance/guardrail/config files the AI can never edit.
const LOCKED_BASENAMES = new Set([
  "COMPLIANCE.md",
  "CLAUDE.md",
  "GUARDRAILS.md",
  "package.json",
  "package-lock.json",
  "next.config.js",
  "tsconfig.json",
]);

// True if the (repo-relative or absolute) path targets a locked file/dir.
// Mirrors guard.js: locked basenames, any .env*, and anything under
// .claude/ or .github/.
export function isLockedPath(p: string): boolean {
  if (!p) return false;
  const norm = String(p).replace(/\\/g, "/").trim();
  const base = norm.split("/").pop() || "";
  if (LOCKED_BASENAMES.has(base)) return true;
  if (/^\.env(\.|$)/.test(base)) return true; // .env, .env.local, …
  if (/(^|\/)\.claude(\/|$)/.test(norm)) return true;
  if (/(^|\/)\.github(\/|$)/.test(norm)) return true;
  return false;
}

// Resolve a builder-supplied path against the repo root and confirm it stays
// inside it. Returns the absolute path if safe, or null if it escapes (via
// "..", an absolute path outside root, or a symlink-style climb). The caller
// treats null as a refusal.
export function safeResolveWithinRoot(root: string, requested: string): string | null {
  const absRoot = resolve(root);
  const abs = resolve(absRoot, requested);
  const rel = relative(absRoot, abs);
  if (rel === "") return abs; // the root itself
  // Any ".." in the resolved relative path means it climbs out of root.
  if (rel === ".." || rel.startsWith(".." + sep)) return null;
  return abs;
}

// Combined check the write tool uses: the path must resolve inside root AND not
// be a locked file. Returns { ok } or { ok:false, reason }.
export function checkWritable(root: string, requested: string): { ok: true; abs: string } | { ok: false; reason: string } {
  const abs = safeResolveWithinRoot(root, requested);
  if (!abs) return { ok: false, reason: `Path escapes the repository root: '${requested}'.` };
  // Check the repo-relative form against the locked rules.
  const rel = relative(resolve(root), abs);
  if (isLockedPath(rel) || isLockedPath(requested)) {
    return {
      ok: false,
      reason:
        `'${requested}' is a LOCKED file (compliance/guardrail/config/CI). The AI builder cannot edit it; ` +
        `such changes must be proposed for the founder to apply by hand.`,
    };
  }
  return { ok: true, abs };
}
