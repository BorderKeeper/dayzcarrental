# FOUNDER ACTION REQUIRED — locked file proposal: `.github/workflows/ai-build.yml`

The AI feature-builder runs in **GitHub Actions**, triggered by a `repository_dispatch`
(`event_type: "ai-build"`) that an **approved** `/tally` fires. The workflow file lives under
`.github/**`, which is a **LOCKED** directory (`GUARDRAILS.md`) — the AI maintainer cannot create it,
by design (it can't edit its own CI). So this is a `propose-change` proposal: **you** add the file by
hand.

Everything else (the builder logic, the dispatch trigger, the entrypoint script, the tests) is in the
merged PR. This workflow is the last piece, and it's yours to apply.

## What it does

1. Runs on `repository_dispatch` with `types: [ai-build]`.
2. Checks out the repo, sets up Node 24.
3. Runs the builder entrypoint (`scripts/ai-build.mjs`) with the approved proposal as
   `AI_BUILD_PAYLOAD` and your `ANTHROPIC_API_KEY` from Actions secrets.
4. If the builder changed files, it creates a **branch and opens a PR** for you to review — it
   **never** pushes to `main` and **never** deploys.

## Prerequisites you set up (one time)

1. **Actions secret `ANTHROPIC_API_KEY`** — repo → Settings → Secrets and variables → Actions → New
   repository secret. (The bot's Claude key; the same one, or a separate budgeted key.)
2. **A GitHub token for the dispatch**, set in **Vercel** as `GITHUB_DISPATCH_TOKEN` (so the bot can
   fire the event). A fine-grained PAT with **Contents: read/write** + **Actions: read/write** on this
   repo. (Optional: also `GITHUB_REPO_OWNER` / `GITHUB_REPO_NAME` in Vercel if they ever differ from
   the defaults `BorderKeeper` / `dayzcarrental`.)
3. **Let Actions open PRs** — repo → Settings → Actions → General → Workflow permissions → enable
   "Read and write permissions" and "Allow GitHub Actions to create and approve pull requests."

## The file to create — `.github/workflows/ai-build.yml`

```yaml
name: AI maintainer build

# Fired by an APPROVED /tally via repository_dispatch. Never runs on push to main.
on:
  repository_dispatch:
    types: [ai-build]

# The workflow may create a branch + PR; it must never merge or deploy.
permissions:
  contents: write
  pull-requests: write

jobs:
  build-feature:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4

      - uses: actions/setup-node@v4
        with:
          node-version: '24'

      - name: Install dependencies
        run: npm ci

      - name: Run the AI feature-builder
        id: aibuild
        env:
          ANTHROPIC_API_KEY: ${{ secrets.ANTHROPIC_API_KEY }}
          # The approved proposal, passed straight from the dispatch payload.
          AI_BUILD_PAYLOAD: ${{ toJSON(github.event.client_payload) }}
        run: node --import ./scripts/ts-loader.mjs scripts/ai-build.mjs

      - name: Open a pull request with the AI's changes
        if: always()
        uses: peter-evans/create-pull-request@v6
        with:
          branch: ai-build/${{ github.event.client_payload.proposalId }}
          base: main
          title: "AI build: ${{ github.event.client_payload.title }}"
          body-path: AI_BUILD_RESULT.md
          labels: ai-maintainer
          # NOTE: this action opens/updates a PR; it never merges. The founder
          # reviews and merges, per CLAUDE.md. main stays branch-protected.
          delete-branch: true
```

## Why this is safe

- **The workflow never merges and never deploys** — it opens a PR; `main` stays branch-protected
  (the `protect-main` ruleset still requires a human merge, and the AI has no bypass).
- **The builder can't touch locked files** — `scripts/ai-build.mjs` → `runBuildLoop` gates every write
  through `checkWritable()` (compliance/guardrail/config/CI/secrets + path traversal all refused),
  and re-screens the proposal for compliance/injection before building. Verified by
  `src/lib/governance/__tests__/builder.test.ts`.
- **It only runs on an approved vote** — the dispatch is fired solely from the `approved` branch of
  `/tally`, and only when `GITHUB_DISPATCH_TOKEN` is configured.
- **`create-pull-request@v6`** is pinned; review its source or pin to a full SHA if you prefer.

Once you've added the workflow file + secrets, the loop is live: approved vote → AI builds → PR you
merge. Delete this proposal file after applying.
