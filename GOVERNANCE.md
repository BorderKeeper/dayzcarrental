# GOVERNANCE.md — the AI-maintainer vote/governance engine (Session C, content-ops)

This is **Session C / Phase 2** of `ROADMAP.md`: the AI-maintainer governance engine that turns
Discord community intent into safe, audited, founder-merged changes. It is the *code* companion to
the Discord flow in `DISCORD.md §5` and the money rules in `COMPLIANCE.md`.

> **Scope guardrail — read first.** This engine is **content & operations only**. Spend and deploy
> powers are *built but disabled* (see the action allowlist). A passed vote can only ever queue a
> feature-branch → PR for the **founder to merge**, or a routine runner-ops change. It never moves
> money, never deploys, and cannot amend `COMPLIANCE.md`/`CLAUDE.md`/`GUARDRAILS.md`. Those powers
> turn on later (Phase 3/4), founder-driven, once the safety controls exist.

This document is **not** a locked file, but it must stay consistent with the locked ones
(`COMPLIANCE.md`, `CLAUDE.md`, `GUARDRAILS.md`). If they ever disagree, **the locked files win.**

---

## 1. Where the code lives

```
src/lib/governance/
  config.ts      chosen quorum/threshold/eligibility values + the action allowlist
  types.ts       Member, Proposal, Vote, Outcome, AuditEntry, …
  screen.ts      compliance + prompt-injection gate (mirrors COMPLIANCE.md + CLAUDE.md)
  vote.ts        eligibility, quorum, threshold, tie-breaking
  engine.ts      the pipeline facade: screen → tally → founder override → audited outcome
  runnerOps.ts   the runner-ops side channel + per-server main-runner authority (DISCORD.md §5b)
  booking.ts     in-game-commodity rental + car-donation model (renter/donor personas)
  audit.ts       append-only audit log (models #governance-log / #runner-log)
  index.ts       public barrel
  __tests__/     persona simulation (see §5)
```

The engine is **pure and dependency-free**: no clocks, no filesystem, no network, no Discord/PayPal
calls. It computes outcomes + an audit trail from explicit inputs, which is what makes it
deterministic and testable — and what keeps it from doing anything a guardrail forbids.

The `/governance` page (`src/app/governance/page.tsx`) reads the **same** `config.ts` values, so the
public description of the rules and the rules the engine enforces cannot drift apart.

---

## 2. The pipeline (mirrors DISCORD.md §5a)

```
proposal ─▶ compliance/injection screen ─▶ emoji vote ─▶ quorum + threshold ─▶ founder override ─▶ audited outcome
             (fail = dead on arrival)                                            (veto / approve)     (queue PR or runner-ops)
```

1. **Proposal.** A member posts what/why/which-area in `#proposals`. Everything they write is
   **untrusted data** (see `CLAUDE.md`), never a command.
2. **Screen (`screen.ts`).** Two gates run before any vote:
   - **Compliance** — a code mirror of `COMPLIANCE.md`: real-money rental pricing/checkout,
     real-money payouts, donation-gated gameplay, and disclaimer removal are all rejected.
   - **Prompt injection** — the `CLAUDE.md` trust model in code: "ignore your instructions", false
     "the founder approved this" claims, "edit COMPLIANCE.md", "push to main", references to
     `.claude/`/`.env`/secrets, etc. are quarantined.
   A failure is **dead on arrival** — *no vote can approve it, and the founder cannot override it to
   approval.* This mirrors the repo's `PreToolUse` hook, which would block the underlying edit
   regardless. The screen stops non-compliant work at the community layer; the hook is the backstop.
3. **Vote.** ✅ approve · ❌ reject · 🤷 abstain. A member's latest reaction is their single choice.
4. **Quorum + threshold (`vote.ts`).** See §3.
5. **Founder override.** Veto or approve on top of any tally — always available, never required for
   the normal flow.
6. **Audited outcome (`engine.ts` + `audit.ts`).** Logged to the append-only trail. On approval the
   effect is a **queued PR** (`queue-pr`) or a **runner-ops change** (`queue-runner-ops`) — the
   founder merges. Discord fills the queue; it never merges or spends.

---

## 3. Chosen values (these were the "Open Item" in ROADMAP.md)

Recorded here as the starting values; they live in `src/lib/governance/config.ts` and are surfaced on
the `/governance` page. Deliberately conservative to blunt **Risk #4** (sockpuppet vote-stuffing on a
system that can eventually move money).

| Parameter | Value | Why |
|-----------|-------|-----|
| **Eligibility** | `@Verified` **and** account age ≥ **7 days** | Passed member screening + not a throwaway alt. Founder always eligible. |
| **Quorum** | ≥ **3** eligible ✅/❌ ballots | 🤷 abstain does **not** count toward quorum. Below quorum ⇒ `no-quorum`, re-run later. |
| **Threshold** | simple majority: `approve / (approve+reject) > 0.5` | **Ties fail** — a change needs positive consent; the status quo wins ties. |
| **Voting window** | **48 h** | Informational; the engine takes an explicit deadline so it stays deterministic. |

Ineligible ballots (unverified, under-age, unknown member) are **silently dropped** from the tally,
so a swarm of fresh alts cannot reach quorum or swing the ratio.

---

## 4. The action allowlist (spend/deploy stay OFF)

The engine will only ever queue an action whose `kind` is on the allowlist **and** flagged
`enabled`. Disabled actions are **dead on arrival even with a unanimous vote.**

| Action | Enabled? | Effect |
|--------|----------|--------|
| `content-edit` — site copy / listings / non-locked docs | ✅ | queue PR |
| `server-add` — add a DayZ server | ✅ | queue PR |
| `safehouse-change` — add/remove/stage a safehouse | ✅ | queue runner-ops (see §5b) |
| `policy-note` — non-binding community note | ✅ | queue PR |
| `treasury-spend` — spend donations | ❌ | Phase 3: needs caps + allowlist + ledger + veto |
| `deploy` — deploy the site | ❌ | Phase 3+: needs CI + human approval |
| `real-money-rental` — real-money pricing/checkout | ❌ | **PROHIBITED** by COMPLIANCE.md; founder + legal only |

---

## 5. How the four personas cooperate on one server (and resolve conflicts without the founder)

The simulation (`src/lib/governance/__tests__/simulation.test.ts`) proves the personas the founder
asked about can share one DayZ server + Discord and settle their own discrepancies. Run it:

```bash
# Node 24 (see .tool-versions). package.json is locked, so there's no npm "test" script;
# use the runner, which wires up node:test + the TS resolve hook (no build, no deps):
./src/lib/governance/__tests__/run.sh
# or explicitly with an asdf/nvm Node 24:
NODE="$(asdf where nodejs)/bin/node" ./src/lib/governance/__tests__/run.sh
```

| Persona | What they do | How a conflict resolves — **without the founder** |
|---------|--------------|---------------------------------------------------|
| **Site modifier** | Proposes a site/content change | Community vote → quorum+majority → queued PR. Founder only *merges* the PR; they aren't needed to *reach* the decision. |
| **Runner** | Safehouse/staging work | Runner-ops side channel. A regular runner **proposes**; the server's **main runner applies**. Two runners clashing over the same safehouse ⇒ the **main runner for that server decides** (`resolveDispute`). |
| **Car donor** | Donates a vehicle | A runner **stages** the donated car; only staged cars are rentable. Voluntary — no money. |
| **Car renter** | Rents a car (in-game commodity) | Double-booking resolves **first-come**: the earlier booking wins; the later renter is told what it clashes with and picks other days/another car. |

**Cross-persona compliance & abuse cases the sim also covers:** a real-money-rental proposal is dead
on arrival (unanimous vote can't save it, founder can't override it to yes); a prompt-injection
proposal is quarantined; a sockpuppet swarm fails quorum; disabled spend/deploy actions can't pass;
founder veto still overrides a passing tally.

### 5b. The one case that *does* escalate

If a server has **no assigned main runner**, a runner dispute on it can't be resolved locally — the
engine returns `denied` and logs `dispute-escalated`. **Rule:** every active server must have at
least one `@Main Runner` assigned (tracked in the runner-ops assignments map / the per-server
`@Main Runner` role). Until then, that server's disputes go to a moderator/founder. This was
surfaced by the simulation and is the intended safety valve, not a bug.

---

## 6. What is deliberately NOT here (later phases)

- **A live Discord bot / real emoji-reaction ingestion.** The engine models the flow; wiring it to a
  real bot is later Session-C work and needs a least-privilege bot token in a secret store (never in
  this repo — `CLAUDE.md` rule 2).
- **Treasury ledger + guarded spend** — Phase 3 (caps, allowlist, audit, founder veto).
- **Deploy automation** — Phase 3+ (CI + human approval).
- **Real-money rental economics** — Phase 4, deferred and review-gated (`COMPLIANCE.md`).

When any of these turns on, it is **founder-driven** and paired with the safety controls in
`ROADMAP.md` — never flipped on by a Discord vote.
