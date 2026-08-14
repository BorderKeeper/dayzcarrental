# DEPLOY.md — ship DayzCarRental.com

Stack: **Next.js 15 (App Router) → GitHub → Vercel**, domain **bought through Vercel**.
The site is a static mockup: no backend, no env vars, no secrets required to deploy.

Steps marked **[you]** need your accounts / payment / an interactive login and can't be automated
for you. Steps marked **[done]** are already set up in the repo.

---

## 0. Prerequisites — [done] / [you]

- **[done]** Repo builds clean on Next 15.5.23 / React 19 (`npm run build`).
- **[done]** `engines.node = ">=18.18.0"` in `package.json` so Vercel picks a compatible build image.
- **[done]** Local Node pinned to 24.19.0 via `.tool-versions` (asdf). Vercel ignores this and uses
  its own Node — that's expected.
- **[you]** A [Vercel account](https://vercel.com/signup) (log in with the GitHub account
  `BorderKeeper` to make importing one click).
- **[done]** GitHub CLI authed as `BorderKeeper` (`gh auth status`).

> **Local dev note:** your system `node` is still v16. In this project, use the pinned Node 24 —
> if `node -v` shows 16, run `asdf local nodejs 24.19.0` is already set via `.tool-versions`; ensure
> asdf's shims are on your PATH (`. "$(brew --prefix asdf)/libexec/asdf.sh"` in your shell rc).

---

## 1. Push to GitHub — [you] (one command)

The repo has an initial commit on `main`. Create the GitHub repo and push:

```bash
cd ~/repos/DayzCarRental
# private is safer while it's a mockup; use --public if you want it open
gh repo create dayzcarrental --private --source=. --remote=origin --push
```

That creates `github.com/BorderKeeper/dayzcarrental` and pushes `main`.
(If you want it under a GitHub **org** per the roadmap, create the org first and use
`gh repo create <org>/dayzcarrental ...`.)

---

## 2. Import into Vercel — [you]

1. Go to <https://vercel.com/new>.
2. **Import Git Repository** → pick `BorderKeeper/dayzcarrental` (authorize Vercel for GitHub if
   prompted; grant access to just this repo).
3. Vercel auto-detects **Next.js** — leave Framework Preset, Build Command (`next build`), and
   Output as-is. **No environment variables needed.**
4. Click **Deploy**. First build takes ~1–2 min. You'll get a live URL like
   `dayzcarrental.vercel.app`.

From now on: **push to `main` → production deploy; open a PR → automatic preview URL.** That matches
our branch → PR → founder-merge flow (see `GUARDRAILS.md`).

---

## 3. Buy the domain through Vercel — [you]

1. In the project: **Settings → Domains** (or **Domains** in the dashboard).
2. Type `dayzcarrental.com` and click **Buy** / **Purchase**.
3. Complete checkout (~\$20/yr for `.com`; Vercel shows the exact price). Payment is on your Vercel
   account.
4. Vercel **auto-configures DNS + TLS** because it's the registrar — no manual records. Add
   `www.dayzcarrental.com` too and set the redirect (Vercel offers `www → apex` or vice-versa;
   apex `dayzcarrental.com` as primary is the convention).
5. Wait for the cert to issue (usually minutes). Then <https://dayzcarrental.com> is live.

> If Vercel says `.com` isn't available to purchase there for your region, fall back to an external
> registrar (Cloudflare at-cost / Namecheap): buy the domain, then in Vercel **Add Domain** and
> point the registrar's DNS at Vercel — apex `A → 76.76.21.21` and `www CNAME → cname.vercel-dns.com`.
> Vercel shows the exact values on the Domains screen.

---

## 4. Verify — [you]

- Visit `https://dayzcarrental.com` — retro home (Rent a Car) loads over HTTPS.
- Click each nav tab; confirm only the active tab highlights (the `/donate` vs `/donate-a-car` fix).
- Car images render; a rent flow reaches the "Request received (demo)" step.
- Update the placeholder links in `src/data/site.ts` (Discord invite, PayPal) — commit on a branch,
  open a PR, merge → auto-deploys.

---

## 5. Donations: webhook + nightly reconcile — [you]

Two channels credit the upkeep budget. The **webhook** (`/api/paypal`) is the fast path; the
**reconciler** (`/api/paypal/reconcile`) is the backstop that catches anything the webhook missed —
PayPal's delivery lags and no-code pay-link payments don't reliably produce an event. Both key
idempotency on the PayPal **transaction id**, so a donation seen by both credits **once**.

Both credit **net of PayPal's fee** — a $1.00 gift banks $0.68. This balance is a hard ceiling on AI
spend, so it tracks money actually received, not the headline amount.

### 5a. Enable Transaction Search on the PayPal app — [you]

The reconciler reads `GET /v1/reporting/transactions`, which is off by default:

1. <https://developer.paypal.com/dashboard/applications/live> → open the app (the same one the
   webhook lives on).
2. Under **Features**, tick **Transaction Search**, then **Save**.
3. Without this the endpoint returns `502 … 403 (is 'Transaction Search' enabled…)`.

> PayPal takes **up to 3 hours** to publish an executed transaction to this API. A reconcile run
> right after a donation can legitimately report nothing; the next run picks it up.

### 5b. Set the env vars in Vercel — [you]

Project → **Settings → Environment Variables** (Production):

| Variable | Value |
| --- | --- |
| `CRON_SECRET` | a long random string — `openssl rand -hex 32` |
| `PAYPAL_RECONCILE_DAYS` | optional lookback, default `7`, max `31` |

`PAYPAL_CLIENT_ID`, `PAYPAL_CLIENT_SECRET` and `REDIS_URL` are already set for the webhook; the
reconciler reuses them. Vercel Cron automatically sends `Authorization: Bearer $CRON_SECRET`.
**Without `CRON_SECRET` the endpoint 503s** — it fails closed rather than exposing a
budget-mutating URL. Redeploy after adding it.

### 5c. The schedule — [done] / [you]

`vercel.json` runs it **daily at 04:00 UTC**, which is what the Hobby plan allows (once per day).
On Pro, tighten it to e.g. `0 */6 * * *`. Confirm it registered under
project → **Settings → Cron Jobs** after the deploy.

### 5d. Verify — [you]

Dry run first — this reports what it *would* credit and changes nothing:

```bash
curl -H "Authorization: Bearer $CRON_SECRET" \
  "https://dayzcarrental.com/api/paypal/reconcile?dry=1"
```

Then run it for real (drop `?dry=1`) and check the balance moved:

```bash
curl https://dayzcarrental.com/api/treasury
```

The two $1.00 donations from 2026-08-12 should appear as a `USD` balance. Re-running is safe: the
second run reports them under `alreadyApplied`, not `credited`.

### 5e. Non-USD donations: set a conversion rate — [you, only if needed]

The balance is held **per currency**, and AI spend draws on the **USD** one. Your PayPal is
CZK-based, so if PayPal ever reports a donation in CZK it lands in a CZK balance the AI budget
cannot spend — the treasury shows funds while a build refuses as if broke. Both live donations so
far were reported in USD, so this may never bite.

To make a currency spendable, set **one env var per currency**:

| Variable | Value |
| --- | --- |
| `PAYPAL_FX_CZK_USD` | how many **USD one CZK is worth**, e.g. `0.0435` |

The name reads *from → to*: `PAYPAL_FX_CZK_USD` means "multiply the CZK amount by this to get USD".
**Get the direction right** — `23` (CZK per USD) instead of `0.0435` would inflate the AI spending
ceiling ~500×. Values that are non-numeric, zero, negative, or above `100` are ignored rather than
applied, so a typo falls back to the old behaviour instead of misstating money.

Nothing converts until you set a rate. Once set, `/api/paypal/reconcile` reports `unspendable: 0`
and echoes the `fxRates` it used; each converted credit records its rate, readable later via the
donation's transaction id. The rate is **not** live — it is whatever you typed, so revisit it if it
drifts far from the real one.

---

## Known residual (safe to ship)

`npm audit` reports 3 high advisories inside Next 15's transitive deps (`postcss`, `sharp`/libvips).
They can only be cleared by moving to **Next 16** (a breaking major, not yet approved). For this
**static mockup** they're not exploitable: no server-side image processing runs (Vercel optimizes
images at the edge) and there's no user-controlled CSS pipeline. Track "upgrade to Next 16" as a
later maintenance item; do it in a dedicated session with the founder (it's a locked-file change —
see `GUARDRAILS.md` / `propose-change`).

## What's NOT set up yet (later roadmap items)

- GitHub **branch protection** (server-side enforcement that only the founder merges to `main`).
  Until then, the merge rule is by convention + the local guardrail hook.
- CI status checks / the `@`-command PR-conversation protocol (deferred — see `ROADMAP.md`).
