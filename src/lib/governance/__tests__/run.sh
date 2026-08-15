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

# `--import` takes a module specifier, not a path. On Windows an absolute path
# like F:\repo\register.mjs parses as the URL scheme "f:", and Node rejects it
# with ERR_UNSUPPORTED_ESM_URL_SCHEME — every test file fails before a single
# test runs, and the stack trace never mentions the real cause. Pass a proper
# file:// URL instead; harmless on Linux/macOS, required under Git Bash/MSYS.
REGISTER="$ROOT/src/lib/governance/__tests__/register.mjs"
case "$(uname -s)" in
  MINGW* | MSYS* | CYGWIN*)
    # cygpath -m yields F:/repo/... — mixed separators, which file:/// accepts.
    REGISTER_URL="file:///$(cygpath -m "$REGISTER")"
    ;;
  *)
    REGISTER_URL="file://$REGISTER"
    ;;
esac

exec "$NODE" \
  --import "$REGISTER_URL" \
  --test \
  "$ROOT"/src/lib/governance/__tests__/*.test.ts
