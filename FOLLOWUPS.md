# FOLLOWUPS.md — parked work & pending tests

Running list of things built-but-not-yet-live-tested, and deferred work. Founder reviews, then we
test together. (Committed here rather than relying on session memory.)

---

## 1. AI feature-builder — real end-to-end test [TODO tomorrow]

**Status:** Built + merged (PR #7). Verified against a *stubbed* Claude only — no real build has run.

**What to test:** the live loop `/propose` → vote → `/tally` approves → the AI actually writes code,
runs the build, and opens a PR.

**Founder steps to activate (from `AI_BUILD_WORKFLOW.proposal.md`):**
1. Add `.github/workflows/ai-build.yml` from the proposal (locked path — founder applies by hand).
2. Add Actions secret `ANTHROPIC_API_KEY`; add `GITHUB_DISPATCH_TOKEN` in Vercel; redeploy.
3. Repo → Settings → Actions → General → allow "GitHub Actions to create pull requests".

**Then:** `/propose` a small real feature → get an eligible ✅ (or use `GOVERNANCE_QUORUM_OVERRIDE=1`
temporarily) → `/tally` → confirm a PR opens with the AI's changes.

**⚠️ Caveats to weigh before running:**
- **~~Uncapped spend~~ — RESOLVED by item 3 (PR #18).** The Actions build path is now bound to the
  durable donation balance and *refuses to start* without `REDIS_URL`. A single build is typically
  ~$0.20–$2; it can no longer exceed the donated balance. Still worth a small test proposal first.
- **Build quality is variable:** first real agentic build may need iteration. The human PR-merge gate
  is the backstop — nothing auto-merges.
- **Also still needs `GOVERNANCE_QUORUM_OVERRIDE` removed** once real approval testing is done, if it
  was set (restores real quorum of 3).

---

## 2. PayPal → budget donations [LIVE — verified end-to-end 2026-08-12]

**Status:** Working in production. Two real $1.00 donations were detected, credited, and persisted;
`/api/treasury` reports the balance from durable Redis.

**How it works — two channels, one balance:**
- `/api/paypal` (webhook, PR #13/#15) — the fast path: verify signature → extract amount → credit.
- `/api/paypal/reconcile` (poller, PR #16) — the backstop: reads PayPal's Transaction Search ledger
  nightly (`vercel.json`, 04:00 UTC) and credits anything the webhook missed.

Both key idempotency on the PayPal **transaction id**, so a donation seen by both credits once.
Amounts are **net of PayPal fees** — the balance is a spending ceiling, so it must reflect money
actually banked, not gross.

**Setup is done** (`DEPLOY.md` §5 documents it): PayPal app + Transaction Search feature,
`PAYPAL_*` and `REDIS_URL` and `CRON_SECRET` set in Vercel.

**⚠️ Known-open: the webhook itself has never fired.** Live donations only ever arrived via the
reconciler; the Webhook Events log stayed empty. Unresolved suspects: `PAYPAL_WEBHOOK_ID` not
matching `16M39581132446341`, or `PAYPAL_CLIENT_ID` belonging to a different app than the one owning
that webhook (`GET /v1/notifications/webhooks` with those creds answers both). Not urgent — the
poller makes the balance correct regardless — but the fast path is worth recovering.

**Historical note:** the first two donations were credited **gross** ($2.00) before the switch to
net; the true banked figure was $1.36. Their idempotency keys are set, so re-running won't correct
them. Left as-is deliberately — a $0.64 overstatement, recorded here rather than silently patched.

**Remaining work → item 3:** the balance is funded but nothing *enforces* it against AI spend.

---

## 3. Donation budget as a binding ceiling on AI spend [CODE DONE — needs CI secret]

**Status:** Implemented (`spendGuard.ts`, `buildLoop.ts`, `scripts/ai-build.mjs`). Closes the
uncapped-spend caveat in item 1.

**What changed:** the build loop no longer takes an optional in-memory ledger that nobody passed. It
takes a `SpendGuard`, and the CI entrypoint binds it to the **durable donation balance** — the same
Redis store `/api/paypal/reconcile` credits. Every model call is pre-checked against the real
balance and debited at its true token cost, so a build stops when donations run out.

`scripts/ai-build.mjs` **refuses to run** without `REDIS_URL` rather than building uncapped.
`AI_BUILD_ALLOW_UNBUDGETED=1` is the deliberate, loudly-logged escape hatch for a smoke test.

**Founder step to activate — half done (2026-08-14):** the `REDIS_URL` **Actions secret is now set**.
Still missing: the workflow doesn't pass it to the build step, so `scripts/ai-build.mjs` continues to
fail closed. One line in `.github/workflows/ai-build.yml` (locked path — see `CI.proposal.md` §3):

```yaml
          REDIS_URL: ${{ secrets.REDIS_URL }}
```

---

## 4. Non-USD donations are not spendable [CODE DONE — inert until a rate is set]

**Was:** the budget store holds a balance **per currency**; the spend guard debits **one** (USD).
The founder's PayPal is CZK-based, so a donation PayPal reported in CZK landed in a CZK balance AI
spend couldn't draw on — the treasury showing funds while a build refused as if broke.

**Now:** option (a) from the original write-up is implemented (`fxRates.ts`). A founder-set
`PAYPAL_FX_<CUR>_USD` rate is applied at **credit time** in both channels (webhook + reconciler),
and the rate that booked each donation is recorded with its idempotency key — readable afterwards
via `getDonationMemo(transactionId)`. No live rate, deliberately: that would put a network
dependency and a silent failure mode inside the money path.

**Inert until activated.** With no rate set nothing converts and donations credit natively, exactly
as before. See `DEPLOY.md` §5e for the founder step; a rate that is malformed, zero, negative, or
implausible (>100 USD per unit) is ignored rather than applied.

**⚠️ What the code cannot catch:** an **inverted** rate — `23` (CZK per USD) instead of `0.0435` —
looks plausible and would inflate the AI spending ceiling ~500×. The env var name carries the
direction and every conversion is echoed in the API response, but the founder is the check here.

**Still open — the historical CZK case:** if a donation was already credited to a CZK balance before
a rate existed, setting one does **not** retroactively convert it; the idempotency key is spent. It
would need a deliberate one-off `topUp`. Not currently the case — no CZK donation has landed.

---

## 5. Three tests fail on Windows [FIXED]

`lockedPaths: traversal outside root…`, `write_file tool refuses a locked file…`, and
`buildLoop: implements a compliant change end to end…` asserted POSIX paths
(`/repo/src/app/page.tsx`) and got Windows ones (`F:\repo\src\app\page.tsx`). The **code** was
path-correct throughout — only the test fixtures assumed POSIX.

Fixed by building the expectations with the same `node:path` call the code uses (`at()` in
`builder.test.ts`) instead of hardcoding strings, and making the in-memory fs separator-agnostic.
The suite is now 76/76 on Windows and unchanged on Linux.

---

## 6. CI gate on pull requests [APPLIED 2026-08-14 — one settings step left]

**Was:** `ai-build.yml` was the only workflow and fired on `repository_dispatch`, never on a PR — so
the test suite and `npm run build` had **never run automatically on any PR**. The trust model
constrained what the AI *can do* (locked files, compliance screening, spend ceiling) but nothing
checked that what it produced **works**.

**Now:** `.github/workflows/ci.yml` runs the governance suite + build on every PR into `main` and on
`main` itself, with `permissions: contents: read` and no secrets in scope. Applied by the founder by
hand — `.github/**` is locked. `AI_BUILD_RESULT.md` stays gitignored, so it serves as the PR body
without entering the diff.

**Two things `ai-build.yml` needed at the same time:**
- `REDIS_URL` passed to the builder step — the last activation step of item 3. AI builds no longer
  fail closed.
- `token: ${{ secrets.CI_PAT }}` on `create-pull-request`. GitHub won't start a workflow from an
  event raised by the default `GITHUB_TOKEN`, so without a separate PAT the AI-authored PRs — the
  ones this gate exists for — would arrive with **no CI run at all**, gate inverted.
- The PR step is `if: always() && hashFiles('AI_BUILD_RESULT.md') != ''`: a refused or failed build
  still surfaces as a PR, but an early throw (unreachable Redis, bad key) doesn't turn into a
  confusing `body-path` error that masks the real cause.

**⚠️ Still to do — the check is not yet a gate.** `protect-main` has rules `deletion`,
`non_fast_forward`, `pull_request` and **0 bypass actors**, but no `required_status_checks`. Until
`verify` is added there (Settings → Rules → `protect-main`), CI reports and a red build can still be
merged.

---

## Deferred (not started)
- **Cron auto-tally** — close a vote automatically at its deadline (Vercel Cron) instead of a manual
  `/tally`. Small follow-up.
- **Auto-open-PR polish** — the builder opens a PR; refining PR description/labels/branch naming is
  cosmetic.
