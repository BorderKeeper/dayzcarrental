// scripts/ts-resolve-hooks.mjs — resolve hook: when a relative, extensionless
// specifier fails, retry it with ".ts" (or "/index.ts"). See ts-loader.mjs.
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";

export async function resolve(specifier, context, nextResolve) {
  try {
    return await nextResolve(specifier, context);
  } catch (err) {
    const isRelative = specifier.startsWith("./") || specifier.startsWith("../");
    const hasExt = /\.[a-z]+$/i.test(specifier.split("/").pop() ?? "");
    if (!isRelative || hasExt) throw err;
    for (const candidate of [`${specifier}.ts`, `${specifier}/index.ts`]) {
      const url = new URL(candidate, context.parentURL);
      if (existsSync(fileURLToPath(url))) return nextResolve(candidate, context);
    }
    throw err;
  }
}
