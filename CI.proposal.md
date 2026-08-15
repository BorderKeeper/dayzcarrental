# FOUNDER ACTION REQUIRED — locked file proposal: `.github/workflows/ci.yml` (+ one line in `ai-build.yml`)

`.github/**` is a **LOCKED** directory (`GUARDRAILS.md`) — the AI maintainer cannot create or edit its
own CI, by design. So this is a `propose-change` proposal: **you** apply it by hand.

Two things here, both small:

1. **New file** `.github/workflows/ci.yml` — a build + test gate on every PR.
2. **One added line** in the existing `.github/workflows/ai-build.yml` — pass `REDIS_URL` through, so
   AI builds stop failing closed.

---

## Why this matters

Right now `ai-build.yml` is the **only** workflow in the repo, and it fires on `repository_dispatch`
— never on a pull request. So the 88 tests and `npm run build` have **never run automatically on a
single PR**, including every PR merged so far.

That leaves the repo in an odd shape. The trust model is "untrusted Discord input → AI writes code →
human merges," and a lot of work has gone into constraining what the AI *can* do: locked files, path
traversal refusal, compliance re-screening, a hard spend ceiling. But nothing mechanically checks
whether what it produced actually **works**. A PR that doesn't compile looks exactly like a PR that
does until someone opens it and reads it.

`main` is protected by the `protect-main` ruleset, but with no CI there is no status check for that
ruleset to require. This gives it one.

---

## 1. The file to create — `.github/workflows/ci.yml`

```yaml
name: CI

# Every PR into main, plus main itself (so a broken merge is visible immediately).
on:
  pull_request:
    branches: [main]
  push:
    branches: [main]

# CI reads code and reports a status. It needs nothing else — no write scope,
# no secrets, no ability to touch the repo. An AI-authored PR runs here, so the
# smallest possible permission set is the point.
permissions:
  contents: read

# A new push to the same PR supersedes the previous run.
concurrency:
  group: ci-${{ github.ref }}
  cancel-in-progress: true

jobs:
  verify:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4

      - uses: actions/setup-node@v4
        with:
          node-version: '24'
          cache: 'npm'

      - name: Install dependencies
        run: npm ci

      # The governance suite: locked-path refusal, compliance screening, the
      # budget ceiling, donation idempotency, FX conversion. package.json is
      # locked so there is no `npm test` script — the runner is invoked directly.
      # The glob is quoted so node expands it, not the shell.
      - name: Run tests
        run: node --import ./scripts/ts-loader.mjs --test "src/lib/governance/__tests__/*.test.ts"

      - name: Build
        run: npm run build
```

Nothing in it is secret-dependent, so it is safe to run on any PR.

---

## 2. ⚠️ The catch you need to know about — AI-build PRs will NOT trigger this

GitHub deliberately does not start a workflow run from an event raised by the default `GITHUB_TOKEN`
(it prevents infinite recursion). `peter-evans/create-pull-request` documents this too.

**Consequence:** the PRs opened by `ai-build.yml` — the AI-authored ones, precisely the ones this
gate exists for — would open with **no CI run at all**, while your hand-made PRs get checked. The
gate would be silently inverted.

To fix it, `create-pull-request` must authenticate as something other than `GITHUB_TOKEN`. In
`ai-build.yml`, add a `token:` to that step:

```yaml
      - name: Open a pull request with the AI's changes
        if: steps.aibuild.outputs.changed_count != '0' && steps.aibuild.outputs.build_passed == 'true'
        uses: peter-evans/create-pull-request@v6
        with:
          token: ${{ secrets.CI_PAT }}          # ← add; without it CI skips AI PRs
          branch: ai-build/${{ github.event.client_payload.proposalId }}
          ...
```

`CI_PAT` is a fine-grained PAT on this repo with **Contents: read/write** and **Pull requests:
read/write**, added as an Actions secret. (The `GITHUB_DISPATCH_TOKEN` you already made for Vercel
has the right scopes — but it lives in Vercel, and reusing one token across two systems means one
leak costs you both. A separate token is worth the two minutes.)

**If you skip this**, CI still works for human PRs — you just have to remember that an
`ai-maintainer`-labelled PR arrives ungated, which is the opposite of what you want. I'd do it.

---

## 3. One line in `ai-build.yml` — unblock AI builds

You added the `REDIS_URL` Actions secret today, but the workflow doesn't pass it to the build step
yet, so `scripts/ai-build.mjs` still refuses to start (by design — it fails closed rather than
spending uncapped). Add the middle line:

```yaml
        env:
          ANTHROPIC_API_KEY: ${{ secrets.ANTHROPIC_API_KEY }}
          REDIS_URL: ${{ secrets.REDIS_URL }}        # ← add
          AI_BUILD_PAYLOAD: ${{ toJSON(github.event.client_payload) }}
```

That is the last step of PR #18. After it, the AI build binds to the real donation balance and stops
when donations run out.

---

## 4. Make the check required — repo settings

Once CI has run at least once (so GitHub knows the check name):

Settings → Rules → `protect-main` → **Require status checks to pass** → add **`verify`**.

Until you do this, CI reports but doesn't block — a red build can still be merged. Adding it is what
turns the workflow from information into a gate.

---

## Why this is safe

- **`permissions: contents: read`** — CI cannot write to the repo, open PRs, or reach any secret. It
  is the least-privileged workflow in the repo.
- **No secrets are exposed to PR code.** The job references none, so a malicious PR has nothing to
  exfiltrate. (This is why `pull_request` is used rather than `pull_request_target`, which *would*
  run untrusted code with repo write scope — deliberately avoided.)
- **It only reports.** Merging stays a human act; the ruleset decides whether a red check blocks.
- **It cannot be edited by the AI** — `.github/**` stays locked, so the maintainer cannot weaken its
  own gate. That is the whole reason this is a proposal rather than a commit.

---

## Verified before proposing

- `node --import ./scripts/ts-loader.mjs --test "src/lib/governance/__tests__/*.test.ts"` → **88
  tests, 88 pass** on `main` (`d33a952`).
- `npm run build` → compiles clean.
- `gh secret list` → `ANTHROPIC_API_KEY`, `REDIS_URL`. `CI_PAT` is the only one still missing, and
  only for §2.

Delete this proposal file once applied.
