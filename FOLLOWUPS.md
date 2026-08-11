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

## 2. PayPal → budget donations [IN PROGRESS — parked at founder-action boundary]

**Status:** Code built (see PR for `paypalVerify.ts`, `budgetStore.ts`, `/api/paypal` route). Reaches
the point where it needs founder setup (PayPal app + webhook + a durable store). See `BOT.md §6`.

**What it does:** a PayPal donation webhook → verify the signature → extract the USD amount →
idempotently credit the bot's budget ledger. Donations fund AI-token upkeep (COMPLIANCE.md-allowed);
no rental/payout/gameplay-gate path.

**Founder steps to activate (detail in `BOT.md §6`):**
1. PayPal Developer dashboard → create/enable a REST app → get `PAYPAL_CLIENT_ID` +
   `PAYPAL_CLIENT_SECRET`; set in Vercel.
2. Create a webhook pointing at `https://dayzcarrental.com/api/paypal` subscribed to
   `PAYMENT.CAPTURE.COMPLETED` (+ optionally `CHECKOUT.ORDER.APPROVED`); set its `PAYPAL_WEBHOOK_ID`
   in Vercel.
3. Provision a durable budget store (the in-memory one resets on every serverless cold start) and set
   its connection env — options noted in `BOT.md §6`. This is the one piece that needs a real
   datastore.
4. Redeploy.

**Then test:** send a PayPal sandbox donation → confirm the budget balance rises (idempotently — a
re-delivered webhook must not double-credit).

**Once live, connect it to the builder:** pass the funded ledger into the Actions build path so AI
builds are budget-capped (removes the uncapped-spend caveat in item 1).

---

## Deferred (not started)
- **Cron auto-tally** — close a vote automatically at its deadline (Vercel Cron) instead of a manual
  `/tally`. Small follow-up.
- **Auto-open-PR polish** — the builder opens a PR; refining PR description/labels/branch naming is
  cosmetic.
