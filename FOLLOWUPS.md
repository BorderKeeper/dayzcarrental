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
- **Uncapped spend:** the Actions build path currently runs WITHOUT the budget ledger, so real builds
  spend Claude tokens uncapped until the donation→budget wiring (item 2) is connected to it. A single
  build is typically ~$0.20–$2, but a confused run can spend more (bounded only by the 12-iteration
  cap). Consider a small test proposal first.
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

## Deferred (not started)
- **Cron auto-tally** — close a vote automatically at its deadline (Vercel Cron) instead of a manual
  `/tally`. Small follow-up.
- **Auto-open-PR polish** — the builder opens a PR; refining PR description/labels/branch naming is
  cosmetic.
