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
- **`discordAdapter.ts`** — maps a verified `/propose` slash command to a governance proposal,
  screens it, and replies. Unknown callers are treated as `@everyone` (never elevated by the
  payload).
- **`src/app/api/discord/route.ts`** — the serverless webhook endpoint (`/api/discord`) on the
  Node.js runtime. Verifies the signature against the raw body, answers Discord's `PING`, routes
  commands. **Fails closed** if `DISCORD_PUBLIC_KEY` is unset (503).

Covered by tests in `src/lib/governance/__tests__/bot.test.ts` (run with
`NODE="$(asdf where nodejs)/bin/node" ./src/lib/governance/__tests__/run.sh`).

The endpoint ships **inert**: an empty roster and no live vote source, so it safely screens and
acknowledges proposals without granting anyone authority. You connect the real roster + reaction-vote
source when you're ready (step 5).

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

## 4. Register the `/propose` command [you]

Registering slash commands is a one-time authenticated call to Discord's API with **your** bot token.
Do it from your own shell (the `!` prefix runs it in this session so output lands here if you want
help reading it):

```bash
# Fill APP_ID and BOT_TOKEN from the Developer Portal; do NOT paste them into the repo.
curl -X POST "https://discord.com/api/v10/applications/$APP_ID/commands" \
  -H "Authorization: Bot $BOT_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "name": "propose",
    "description": "Propose a change to the site/community (goes through the governance guardrails)",
    "options": [
      {"name": "kind",  "description": "Action kind (content-edit, server-add, policy-note, safehouse-change)", "type": 3, "required": true},
      {"name": "title", "description": "Short title",       "type": 3, "required": true},
      {"name": "body",  "description": "What and why",      "type": 3, "required": true}
    ]
  }'
```

(Register as a **guild** command — `/applications/$APP_ID/guilds/$GUILD_ID/commands` — for instant
availability while testing; global commands take ~1h to propagate.)

---

## 5. Wire the real roster + votes (going live) [you + AI]

The deployed endpoint is inert by default (empty roster, no vote source). To make votes real:

- **Roster:** map Discord user IDs → governance `Member`s (roles + account age). Source this from the
  Discord roles you set up in `DISCORD.md` (@Verified, @Runner, @Main Runner, @Maintainer, @Founder).
- **Vote source:** provide `votesFor(proposalId)` in the adapter config, reading ✅/❌/🤷 reaction
  tallies from the `#vote` channel.

This needs a small amount of live Discord read access (reactions) and is the natural next AI-assisted
task once the endpoint is verified. Until then, the manual-shape flow in `DISCORD.md §5a` stands.

> **Eligibility, quorum, threshold** are already fixed in `GOVERNANCE.md §3`
> (@Verified + account-age ≥ 7d, quorum 3, simple majority). The vote source just needs to feed real
> reactions into that engine.

---

## 6. Fund the budget & wire donations → budget [you]

### 6a. Seed it
Call `topUp` once with your initial funding (an amount you choose). In the live wiring this is a
startup step; the ledger records it as `founder-topup`.

### 6b. Donations flow in automatically
`COMPLIANCE.md`-compliant path: **donations credit the bot's budget account.** There is **no** native
"PayPal donation auto-buys Claude credits" pipe, so the money movement itself is a banking/processor
setup **you** own. The **accounting** is built (`ledger.donate(amountMicros)`); you connect the
trigger:

- **PayPal IPN / webhook** → your endpoint verifies the notification with PayPal → calls
  `ledger.donate(...)` with the donated amount. (Verification + the ledger persistence layer is the
  remaining integration work; the ledger API is ready.)
- The bot then spends against the raised ceiling. It **cannot** spend past it, and **cannot** top
  itself up — it just uses what's in the bank.

> **What stays off (by design):** the bot never *pulls* money, never initiates a top-up, and never
> exceeds budget. Automatic *inflow* is fine; autonomous *spend decisions beyond the balance* do not
> exist in the code. This matches Phase 3's "capped, allowlisted, logged, vetoable" direction in
> `ROADMAP.md` — with the extra-strong property that the cap is simply "what donors have given."

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
