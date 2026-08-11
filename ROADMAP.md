# DayZ Car Rental Ecosystem — Roadmap

Founding go-to-market document for a community-run ecosystem around renting cars in **DayZ**:
a mockup **website** to attract maintainers + validate demand, a **Discord** hub for
collaboration/ops, an **AI maintainer** governed by Discord majority-vote + founder override,
and a **PayPal-funded treasury** (donations now; rental/payouts later, gated on legal review).

## Decisions locked (2026-08-11)
- **Money model:** Hybrid / phased — donation-only at launch; rental+payout designed on paper;
  real economics enabled only after legal + payment-processor review.
- **AI authority:** Full execution *with limits* — full content/ops execution from day one;
  spend + deploy powers built but disabled until Phase 3/4 safety controls exist.
- **Website stack:** Next.js + Vercel.
- **Launch goal:** Both — recruit maintainers AND validate player demand.

## Monetization strategy (updated)
- Build as a **mockup first**; if it gains traction, apply to Bohemia's server monetization
  program (https://old.bohemia.net/monetization).
- **Constraint learned:** Bohemia approval is **cosmetic / non-gameplay-affecting only** and, for
  DayZ, applies only to **private shard servers** (not public hive / the mod). A rented car is a
  functional gameplay asset, so **real-money rentals are likely prohibited even with approval.**
  Donations *are* explicitly allowed (if free access remains). Approval pairs best with running
  our own approved private shard.
- **Primary compliant model → in-game commodity payment for rentals + optional real-money
  donations** (upkeep/AI tokens). Real-money rental/payouts remain a *deferred, review-gated*
  possibility only, not the plan of record.

## Top risks driving the phasing
1. **RMT vs. DayZ/Bohemia EULA** — real-money car rentals likely prohibited (gameplay-affecting).
   Default to in-game-commodity rentals + optional donations; Bohemia approval + own private shard
   if traction. Existential risk; keep framing conservative.
2. **PayPal freeze risk** for payout marketplaces — donations-only PayPal now; Stripe Connect /
   Open Collective / entity for real payouts later.
3. **Money-transmission licensing** when collecting rent to pay runners — paper legal design first.
4. **Emoji-vote AI with spend/deploy = large attack surface** — caps, quorum, account-age gate,
   audit log, founder veto; financial/deploy powers stay off until controls exist.
5. Single-founder point of failure; T&S/moderation; volunteer duty-of-care; legal entity/taxes.

## Phases
- **Phase 0 — Foundations:** domain, GitHub org, Next.js scaffold, Vercel, Discord skeleton,
  donation-only PayPal, **Charter** (governance + money principles), draft legal framing.
- **Phase 1 — Mockup site + Discord launch:** dual-audience landing page (players + contributors),
  mock car listings/photos, waitlist, donate CTA, Discord onboarding; drive traffic; recruit.
- **Phase 2 — AI maintainer (content/ops only):** vote engine (proposal → emoji vote →
  quorum/majority → founder override/veto → audited action), anti-abuse basics. No spend/deploy.
  Includes a **secondary "runner-ops" side channel** — separate from the major-change vote flow —
  where runners handle routine admin (adding/removing safehouses, staging, recovery) without a full
  community vote. Runners with a per-server **"main runner" tag** can influence that server's
  safehouse list directly.
- **Phase 3 — Treasury transparency + guarded AI spend:** public ledger; capped, allowlisted,
  logged, vetoable spend; optional deploy behind CI + human approval.
- **Phase 4 — Rental economics:** default = **in-game commodity payment + optional donations**
  (compliant now). Real-money rental/payouts remain deferred, enabled only after Bohemia approval
  + legal design + real processor; founder approval required for any financial/payout structure.

## Repo guardrails (in place as of the mockup)
Because the codebase is AI-maintained under direction from Discord volunteers, the repo defends
itself deterministically: a `PreToolUse` hook (`.claude/hooks/guard.js`) + `permissions.deny` in
`.claude/settings.json` hard-block edits to locked files (compliance, config, secrets, CI, and the
guardrails themselves), dangerous shell, and unsafe git; `CLAUDE.md`/`COMPLIANCE.md` set the
untrusted-input trust model and money rules; `propose-change` + `compliance-check` skills encode the
safe workflow. Flow is **feature branch → PR → founder merges**. Full detail in `GUARDRAILS.md`.

**Deferred guardrail work (later):** CI/CD guardrails (GitHub branch protection, required status
checks, signed/verified commits, CODEOWNERS) and a structured **`@`-command PR-conversation
protocol** for maintainers to iron out intent with the AI on each PR before the founder merges.

## Follow-up sessions
- **A — Website** (Next.js + Vercel mockup, dual-audience, mock data, contributor onboarding).
- **B — Discord server** (channels/roles, verification/anti-raid, moderation, human governance flow).
  Includes a dedicated **runner-ops side channel** for safehouse admin + routine runner work,
  distinct from the big AI-governance vote channel; per-server **"main runner"** role gates who can
  edit that server's safehouse list.
- **C — AI maintainer + PayPal automation** (action allowlist, vote/quorum/override engine,
  anti-abuse + prompt-injection defenses, spend caps + audit log, treasury ledger, deferred processor).

## Open items
Legal entity vs. informal community & jurisdiction · backup-admin/succession · whether payouts ever
go live or it stays donation-only permanently · exact voting rules (quorum, threshold, eligibility,
override mechanics).

_Full rationale in the session plan file: `~/.claude/plans/i-would-like-to-frolicking-scott.md`_
