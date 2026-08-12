# BOT.md — take the AI maintainer bot live (founder-executed)

This is the **last piece before shipping**: wiring the modeled governance engine to a real Discord
bot so community members can request changes, and giving the bot a **donation-funded, hard-capped
budget**. Like `DEPLOY.md` and `DISCORD.md`, the steps that touch **your** accounts and **secrets**
can't be automated for you — they're marked **[you]**. Steps marked **[done]** already exist in the
repo.

Everything here obeys the same rules as the rest of the project (`CLAUDE.md`, `COMPLIANCE.md`,
`GUARDRAILS.md`, `GOVERNANCE.md`). The bot **adheres to signed-off change requests only within the
guardrails** — a request that violates `COMPLIANCE.md` is dead on arrival no matter who sends it or
how it's phrased. The bot **never merges, never deploys, and never moves game or real money**; on an
approved change it opens a PR for **you** to merge.

---

## 0. The money rule this implements (read first)

Your instruction, enforced structurally in code:

- **Money only flows IN automatically.** You seed an initial top-up; after that, **donations flow
  into the bot's budget account**. That inflow is just donations going where donations go.
- **The bot spends only what's in the bank.** The donation balance **is** the ceiling. Spend
  **hard-stops at zero** (`src/lib/governance/budget.ts`).
- **The bot never tops itself up and never exceeds budget.** There is no self-refill path in the
  code; the only credit methods are `topUp` (you) and `donate` (an external event the bot records).

This is compliant: `COMPLIANCE.md` says *"voluntary PayPal donations fund upkeep (hosting, AI tokens,
tools)."* Funding the **AI-token budget** from donations is upkeep — it does **not** gate gameplay,
price a rental, or pay anyone. The ledger has no path to a rental, a payout, or a per-player
advantage. **[done]**

---

## 1. What's already built [done]

In `src/lib/governance/`:

- **`budget.ts`** — the hard-capped, inflow-only ledger (integer micro-USD; append-only audit).
- **`aiClient.ts`** — a budget-gated Claude client over raw `fetch` (no SDK dependency, since
  `package.json` is locked). It estimates a call's worst-case cost, **refuses** if the bank can't
  afford it (no call is made), and debits **actual** token usage after. Model: `claude-opus-5`.
- **`discordVerify.ts`** — Ed25519 signature verification via `node:crypto` (no dependency).
- **`discordAdapter.ts`** — maps verified `/propose` and `/tally` slash commands to governance
  actions. Unknown callers are treated as `@everyone` (never elevated by the payload).
- **`discordApi.ts`** — authenticated Discord REST helpers (read reactions/roles, post messages,
  edit the deferred interaction response) over raw `fetch`, no dependency.
- **`snowflake.ts`** — derives a reactor's account age from their Discord user ID (no API call).
- **`voteTally.ts`** — the vote-counting flow: `/propose` posts a **public** vote message whose
  embed encodes the proposal (**the message is the store — no database**); `/tally` reads it back
  plus its ✅/❌/🤷 reactions, resolves each reactor to a governance `Member` (age from the
  snowflake, roles via the API + your role map), and runs the engine.
- **`src/app/api/discord/route.ts`** — the serverless webhook endpoint (`/api/discord`) on the
  Node.js runtime. Verifies the signature against the raw body, answers Discord's `PING`, routes
  commands, and runs slow work (posting/tallying) after the ack via `after()`. **Fails closed** if
  `DISCORD_PUBLIC_KEY` is unset (503).

Covered by tests in `src/lib/governance/__tests__/bot.test.ts` and `voteTally.test.ts` (run with
`NODE="$(asdf where nodejs)/bin/node" ./src/lib/governance/__tests__/run.sh`).

**Two modes, chosen automatically by which env vars are set:**
- **Screen-only** (just `DISCORD_PUBLIC_KEY`): `/propose` is compliance-screened and acknowledged,
  but nothing is posted publicly and `/tally` reports "not configured." Safe default.
- **Full voting** (also `DISCORD_BOT_TOKEN` + `DISCORD_GUILD_ID` + `DISCORD_ROLE_MAP`): `/propose`
  posts a public vote message; `/tally` counts real reactions with real eligibility. See §5.

---

## 2. Create the bot application & secrets [you]

1. **Discord Developer Portal → your application** (the `ClaudeDayzCarRental` app from Session B, or a
   new one). Under **General Information**, copy the **Public Key** — this is the value for
   `DISCORD_PUBLIC_KEY`. It is *not* a secret (it only verifies inbound signatures), but we still keep
   it in env, never hard-coded.
2. Under **Bot**, keep the token **least-privilege** — the webhook flow needs **no** privileged
   gateway intents. Store the token in your secret store; **never** put it in the repo (`CLAUDE.md`
   rule 2).
3. Get an **Anthropic API key** for the bot (its own key, so you can budget/rotate it independently).

Set these as environment variables **in Vercel** (Project → Settings → Environment Variables), not in
the repo:

| Variable | What | Secret? |
|----------|------|---------|
| `DISCORD_PUBLIC_KEY` | App public key (verifies inbound signatures) | No, but env-sourced |
| `ANTHROPIC_API_KEY` | The bot's Claude key | **Yes** |
| `DISCORD_BOT_TOKEN` | Bot token — read reactions/roles, post vote + result messages (enables voting) | **Yes** |
| `DISCORD_GUILD_ID` | Your server ID (for member-role lookups at tally time) | No |
| `DISCORD_ROLE_MAP` | JSON mapping server role IDs → governance roles, e.g. `{"<verifiedRoleId>":"verified","<runnerRoleId>":"runner"}` | No |
| `DISCORD_VOTE_CHANNEL_ID` | *(optional)* channel for public vote posts; defaults to the invoking channel | No |

> These are read at runtime by `src/app/api/discord/route.ts` and the AI client. `.env*` files are
> **locked** (`GUARDRAILS.md`) — set them in Vercel's dashboard, not in a committed file.

---

## 3. Point Discord at the endpoint [you]

1. Deploy the site (per `DEPLOY.md`). The endpoint is `https://dayzcarrental.com/api/discord` (or the
   `*.vercel.app` URL).
2. Developer Portal → your app → **General Information → Interactions Endpoint URL** → paste that URL
   → **Save**. Discord immediately sends a signed `PING`; if verification is wired correctly it saves.
   If it rejects, check that `DISCORD_PUBLIC_KEY` is set in the deployed environment.

---

## 4. Register the `/propose` and `/tally` commands [you]

Registering slash commands is a one-time authenticated call to Discord's API with **your** bot token.
Do it from your own shell (keep the `-d` JSON on one line to avoid the "invalid JSON" trap). Register
as a **guild** command (`/applications/$APP_ID/guilds/$GUILD_ID/commands`) for instant availability
while testing; global commands take ~1h to propagate.

```bash
# /propose
curl -X POST "https://discord.com/api/v10/applications/$APP_ID/guilds/$GUILD_ID/commands" \
  -H "Authorization: Bot $BOT_TOKEN" -H "Content-Type: application/json" \
  -d '{"name":"propose","description":"Propose a change (goes through the governance guardrails)","options":[{"name":"kind","description":"content-edit, server-add, policy-note, or safehouse-change","type":3,"required":true},{"name":"title","description":"Short title","type":3,"required":true},{"name":"body","description":"What and why","type":3,"required":true}]}'

# /tally
curl -X POST "https://discord.com/api/v10/applications/$APP_ID/guilds/$GUILD_ID/commands" \
  -H "Authorization: Bot $BOT_TOKEN" -H "Content-Type: application/json" \
  -d '{"name":"tally","description":"Count the votes on a proposal and post the outcome","options":[{"name":"message","description":"The vote message ID to tally","type":3,"required":true},{"name":"channel","description":"Channel ID of the vote message (defaults to here)","type":3,"required":false}]}'
```

---

## 5. Turn on real vote counting [you]  ✅ built

The vote flow is built and tested (`voteTally.ts`, `discordApi.ts`, `snowflake.ts`). To activate it,
set the voting env vars from §2 (`DISCORD_BOT_TOKEN`, `DISCORD_GUILD_ID`, `DISCORD_ROLE_MAP`) in
Vercel and redeploy. Then:

**How it runs live:**
1. A member runs `/propose kind:… title:… body:…`.
2. The bot **screens** it. Non-compliant → ephemeral "dead on arrival," **no public post**.
3. Compliant → the bot posts a **public vote message** in the vote channel with the proposal embed
   and seeds ✅/❌/🤷. That message *is* the store — no database.
4. Members react during the voting window.
5. Anyone runs `/tally message:<the vote message id>`. The bot reads the reactions, resolves each
   reactor's eligibility (**account age from their Discord ID; roles via `DISCORD_ROLE_MAP`**), runs
   the engine, and posts the outcome publicly.

**Building `DISCORD_ROLE_MAP`:** turn on Developer Mode in Discord, right-click each governance role
(Server Settings → Roles → right-click → Copy Role ID), and map it to the governance role name:

```json
{"<VerifiedRoleId>":"verified","<RunnerRoleId>":"runner","<MainRunnerRoleId>":"main-runner","<MaintainerRoleId>":"maintainer","<ModeratorRoleId>":"moderator","<FounderRoleId>":"founder"}
```

Only roles that carry governance weight need mapping; anything unmapped just isn't granted. At
minimum map `verified` (that plus the 7-day account-age gate is what makes a reactor an eligible
voter).

> **Eligibility, quorum, threshold** are fixed in `GOVERNANCE.md §3` (@Verified + account-age ≥ 7d,
> quorum 3, simple majority). The vote flow feeds real reactions into that same engine — the sockpuppet
> and unverified-reactor cases are covered by `voteTally.test.ts`.

> **Why `/tally` is manual (not automatic at a deadline):** a serverless webhook has no background
> scheduler. A `/tally` command is the simplest fit. If you later want auto-close at the deadline,
> that needs a scheduled trigger (e.g. Vercel Cron) — a small follow-up, not a rearchitecture.

### 5a. Temporarily lowering quorum for a live approval test [you]

To verify the **approval** path end-to-end without gathering 3 voters, set a **temporary** env var
in Vercel and redeploy:

```
GOVERNANCE_QUORUM_OVERRIDE=1
```

Then a single eligible ✅ (a @Verified account ≥ 7 days old — you) will reach quorum and the tally
flips to **Approved → queued as a PR**. **Revert by deleting the env var and redeploying** — the code
default stays **3**, so you're just removing the override.

Guardrails on the override, so it can't be abused or forgotten:
- **Server-only** — it is not a `NEXT_PUBLIC_` var, so it never reaches the browser bundle; the public
  `/governance` page keeps showing the real quorum of 3.
- **Clamped to `[1, 3]`** — it can only *lower* quorum for testing, never raise it or set it to zero.
- **Weakens nothing else** — the compliance screen, the 7-day account-age gate, and the majority
  threshold all still apply. A sockpuppet or non-compliant proposal is refused even at quorum 1
  (covered by `quorumOverride.test.ts`).

> This is a **test aid, not a policy change.** Remove it once you've confirmed the approval path.
> Leaving it on would let a single voter carry a proposal — still only a *queued PR you must merge*
> (no money/deploy), but not the intended governance.

---

## 6. Fund the budget & wire donations → budget [you]

### 6a. Seed it
Call `topUp` once with your initial funding (an amount you choose). In the live wiring this is a
startup step; the ledger records it as `founder-topup`.

### 6b. Donations flow in automatically  ✅ built (`/api/paypal`)

`COMPLIANCE.md`-compliant path: **a PayPal donation webhook credits the bot's budget account.** The
verification, USD amount extraction, and idempotent credit are built (`paypalVerify.ts`,
`budgetStore.ts`, `/api/paypal/route.ts`, tested in `donations.test.ts`). The bot then spends against
the raised ceiling — it **cannot** spend past it and **cannot** top itself up.

**Founder steps to turn it on:**

1. **PayPal REST app** — PayPal Developer dashboard → Apps & Credentials → create/enable a REST app.
   Copy the **Client ID** and **Secret**. Set in Vercel (Production):
   - `PAYPAL_CLIENT_ID`, `PAYPAL_CLIENT_SECRET` (**secrets**)
   - `PAYPAL_ENV` = `live` (or `sandbox` for testing)
2. **Webhook** — in the same app, add a webhook with URL `https://dayzcarrental.com/api/paypal`,
   subscribed to **`PAYMENT.CAPTURE.COMPLETED`** (and optionally `PAYMENT.SALE.COMPLETED`). Copy the
   generated **Webhook ID** → set `PAYPAL_WEBHOOK_ID` in Vercel. (The endpoint verifies every delivery
   against this id; an unverifiable POST is rejected 401 and credits nothing.)
3. **Durable store** — ✅ built (`redisBudgetStore.ts`). The balance is stored in **Upstash Redis**
   via its REST API (no dependency added). To turn it on: Vercel → **Storage** → add **Upstash Redis**
   (a.k.a. "KV") → **connect it to the `dayzcarrental` project**. That auto-injects the connection env
   vars (`KV_REST_API_URL` + `KV_REST_API_TOKEN`, or `UPSTASH_REDIS_REST_URL`/`_TOKEN` — the route
   accepts either naming). With those present, `/api/paypal` uses the durable store automatically;
   without them it falls back to an in-memory store (warm-instance only — the response's `durable:
   false` flags that). Donations are credited idempotently by PayPal event id, so re-delivery never
   double-credits, and the balance survives cold starts.
4. **Donate button** — ✅ built (`/donate`). The button links to `NEXT_PUBLIC_PAYPAL_DONATE_URL`
   (a PayPal hosted-button / donation link you create in the PayPal dashboard — **sandbox** for
   testing, **live** later). Set it in Vercel; until it's set the page shows a placeholder notice.
   The `/donate` page also shows the **live upkeep balance** (via `/api/treasury`, read-only), so you
   can watch it rise after a donation.
5. **Redeploy.**

**Test (sandbox):** a real sandbox donation through the donate button produces a genuinely-signed
webhook → `/api/paypal` responds `credited: true` + the new balance, and the `/donate` page balance
rises on refresh. A re-delivered event shows `credited: false` (idempotent). **Note:** PayPal's
built-in *webhook simulator* sends an unsigned/test payload that our verifier correctly rejects (401)
— use a real sandbox checkout to test, not the simulator.

**Only USD completed payments are credited** — other currencies and non-payment events are verified
but ignored rather than mis-converted (a deliberate safe refusal; extend `extractDonation` if you add
currencies).

> **What stays off (by design):** the bot never *pulls* money, never initiates a top-up, and never
> exceeds budget. Automatic *inflow* is fine; autonomous *spend decisions beyond the balance* do not
> exist in the code. This matches Phase 3's "capped, allowlisted, logged, vetoable" direction in
> `ROADMAP.md` — with the extra-strong property that the cap is simply "what donors have given."

> **Connect it to the AI builder:** once the durable store is live, pass the funded budget into the
> Actions build path so AI feature-builds are budget-capped (removes the uncapped-spend caveat noted
> in `FOLLOWUPS.md`). Small follow-up.

---

## 7. Verify [you]

- Saving the Interactions Endpoint URL succeeds (Discord's `PING` verified).
- `/propose kind:content-edit title:"typo" body:"fix spelling"` returns an ephemeral acknowledgement.
- `/propose` with a **real-money rental** or **injection** body returns **dead on arrival** — the
  guardrails hold from the Discord side just as they do in the repo.
- With the budget at zero, the bot **refuses** AI calls (`BudgetExhaustedError`) instead of
  overspending; a `donate(...)` raises the ceiling and calls resume.
- No secrets appear in the repo or in any committed file.

---

## What's NOT built yet (the remaining founder-executed integration)

- **PayPal verification + ledger persistence** — the donation-webhook verifier and a durable store
  for the ledger (it's in-memory in the mockup). The ledger *API* and the compliance/spend rules are
  done and tested.
- **Live reaction-vote ingestion** — `votesFor(...)` reading `#vote` reactions (step 5).
- **Deploy powers stay off** — the bot opens PRs; the founder merges. Deploy automation is Phase 3+.

When you're back, I can build the PayPal verifier + ledger persistence and the reaction-vote source —
both are ordinary `src/` work that fits the existing tests and guardrails.
