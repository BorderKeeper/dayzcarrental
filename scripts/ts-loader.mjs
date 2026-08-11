// scripts/ts-loader.mjs — registers a resolve hook so extensionless,
// bundler-style relative imports in src/lib/governance (written for Next.js/tsc)
// resolve to their ".ts" files when the ai-build entrypoint runs under Node.
// Node's ESM loader needs explicit extensions; tsc's "bundler" resolution wants
// them omitted. This bridges the two for the CI script, same as the test hook.
import { register } from "node:module";
register("./ts-resolve-hooks.mjs", import.meta.url);
