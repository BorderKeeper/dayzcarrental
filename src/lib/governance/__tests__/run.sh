#!/usr/bin/env bash
# Run the governance persona simulation tests.
#
# package.json is a LOCKED file (see GUARDRAILS.md), so we can't add an npm
# "test" script. This runner is the canonical way to invoke the suite. It uses
# Node 24 (type-stripping + node:test, no build step, no dependencies) and the
# test-only ESM resolve hook (register.mjs) that lets the extensionless,
# bundler-style imports resolve to their .ts files at runtime.
#
# Requires Node >= 22 (24 recommended; matches .tool-versions). If your PATH
# node is older, point NODE at an asdf/nvm Node 24, e.g.:
#   NODE="$(asdf where nodejs)/bin/node" ./src/lib/governance/__tests__/run.sh
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../../.." && pwd)"
NODE="${NODE:-node}"

exec "$NODE" \
  --import "$ROOT/src/lib/governance/__tests__/register.mjs" \
  --test \
  "$ROOT"/src/lib/governance/__tests__/*.test.ts
