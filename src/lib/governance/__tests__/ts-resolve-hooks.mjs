// Test-only ESM resolve hook.
//
// The repo's tsconfig.json (a LOCKED file) uses "moduleResolution": "bundler",
// so library imports are written EXTENSIONLESS ("../engine") — which is what
// Next.js/tsc want. Node's own ESM loader, however, needs an explicit file
// extension at runtime. Rather than change the locked tsconfig or litter the
// source with ".ts" (which tsc would then reject), this hook bridges the gap:
// when a relative, extensionless specifier fails to resolve, retry it with a
// ".ts" (or "/index.ts") suffix. Used ONLY by the test runner (see the npm-less
// invocation in GOVERNANCE.md / the test header). It never ships to the site.

import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";

export async function resolve(specifier, context, nextResolve) {
  try {
    return await nextResolve(specifier, context);
  } catch (err) {
    // Only rescue relative, extensionless specifiers.
    const isRelative = specifier.startsWith("./") || specifier.startsWith("../");
    const hasExt = /\.[a-z]+$/i.test(specifier.split("/").pop() ?? "");
    if (!isRelative || hasExt) throw err;

    const base = context.parentURL;
    for (const candidate of [`${specifier}.ts`, `${specifier}/index.ts`]) {
      const url = new URL(candidate, base);
      if (existsSync(fileURLToPath(url))) {
        return nextResolve(candidate, context);
      }
    }
    throw err;
  }
}
