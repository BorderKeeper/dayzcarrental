// Registers the test-only ESM resolve hook (ts-resolve-hooks.mjs) on the module
// loader, so extensionless relative imports in the governance source resolve to
// their ".ts" files at runtime under Node. See ts-resolve-hooks.mjs for why.
// Used only by the test runner: `node --import ./…/register.mjs --test …`.
import { register } from "node:module";
register("./ts-resolve-hooks.mjs", import.meta.url);
