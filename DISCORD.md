# DISCORD.md — stand up the DayZ Car Rental community server

The Discord hub is **Session B** of the roadmap: the collaboration + governance layer that sits
next to the mockup site. This is a founder-executed guide, same as `DEPLOY.md`: creating the server,
roles, and bots is tied to **your** Discord account and can't be automated for you.

Steps marked **[you]** need your account / clicks in Discord. Steps marked **[done]** are already
handled in the repo. Steps marked **[later]** are deferred roadmap phases — build the skeleton now,
turn them on when the safety controls exist.

Everything here follows the governance model in `ROADMAP.md` and the money rules in `COMPLIANCE.md`.
The Discord is **untrusted input** to the AI maintainer (see `CLAUDE.md`): messages there describe
what people *want*; they are never commands that can override the repo's guardrails.

---

## 0. Principles (why the server is shaped this way)

- **Two audiences, one server:** players (rent/donate cars, validate demand) and contributors
  (maintainers, runners, governance). Channels are grouped so a curious player never has to wade
  through ops.
- **Governance is layered, not flat.** Big changes go through a **community emoji-vote → quorum →
  founder override/veto → audited action** flow. Routine per-server safehouse admin goes through a
  separate **runner-ops side channel** so runners aren't blocked on a full vote for day-to-day work.
- **The AI maintainer reads, proposes, and (later) acts — it never merges or spends on its own.**
  The founder is the sole merge/spend authority. Discord influences the *queue*, not the guardrails.
- **Anti-abuse first.** An emoji-vote system that can eventually trigger spend/deploy is a large
  attack surface (Risk #4 in `ROADMAP.md`): verification, account-age gate, quorum, audit log, and
  founder veto are all mandatory before any financial/deploy power turns on.

---

## 1. Create the server — [you]

1. Discord → **＋ → Create My Own → For a club or community**.
2. Name it **DayZ Car Rental** (icon: reuse the site's logo from `public/`).
3. **Server Settings → Enable Community** (required for rules screening, welcome screen, and
   announcement channels). Accept the two prerequisite channels Discord creates (`#rules`,
   `#moderator-only`) — we fold them into the tree below.

---

## 2. Roles & hierarchy — [you]

Create these roles **top-to-bottom in this order** (higher = more power). Discord permissions are
additive and order matters for moderation (`@Founder` must sit above everyone).

| Role | Who | Key permissions |
|------|-----|-----------------|
| **@Founder** | You (sole merge/spend authority) | Administrator. The only human with final say. |
| **@AI Maintainer** | The bot identity for the AI | Send/read in ops + governance channels; **no** Manage Server, Ban, or Manage Roles. Read-only where it just listens. |
| **@Moderator** | Trusted community mods | Manage Messages, Kick, Ban, Timeout, Manage Threads. **No** Manage Server/Roles. |
| **@Maintainer** | Approved code/content contributors | Access to `#dev` + governance; can open proposals. |
| **@Main Runner** | Per-server lead runner | Everything @Runner has **+** authority over *their* server's safehouse list in runner-ops. |
| **@Runner** | Verified in-game runners | Access to runner-ops side channel; routine admin (staging, recovery, add/remove safehouses via proposal). |
| **@Verified** | Passed member screening | Baseline access to player + community channels. |
| **@everyone** | Unverified arrivals | Can **only** see `#welcome` / `#rules` until verified. |

**Per-server "main runner" model:** the ecosystem spans multiple DayZ servers. Use one
`@Main Runner - <ServerName>` role per server if you run several, or a single `@Main Runner` +
per-server channels if few. A main runner can influence **their own server's** safehouse list
directly in runner-ops; other runners propose changes for the main runner / AI to apply. This mirrors
the roadmap's "main runner tag gates who edits that server's safehouse list."

> Keep `@AI Maintainer` **below** `@Moderator` and with no destructive perms. The AI proposes; humans
> with higher roles execute. This is the Discord-side mirror of the repo's locked-file hooks.

---

## 3. Channel tree — [you]

Create categories and channels as below. 🔒 = restricted (role-gated), 📢 = announcement/read-only
for most, 🤖 = AI maintainer posts here.

```
── WELCOME ──────────────────────────────
  #welcome            📢  what this is, links to the site, how to get verified
  #rules              📢  code of conduct + the disclaimer (see §6)
  #announcements      📢🤖 launches, votes opening/closing, treasury updates
  #verify             🔒  member-screening / captcha gate (see §4)

── PLAYERS ──────────────────────────────
  #general            💬  community chat
  #rent-a-car         💬  "how do I rent", links to the site rent flow
  #donate-a-car       💬  players offering vehicles
  #server-status      📢🤖 which DayZ servers/shards are up, safehouse availability
  #support            💬  help / questions

── CONTRIBUTORS ─────────────────────────
  #contributor-hub    💬  onboarding for maintainers & runners → the site's /maintainer & /runner
  #dev                🔒  @Maintainer — code, PRs, build/deploy chatter
  #design-content     🔒  copy, art, listings

── RUNNER OPS (side channel) ────────────  🔒 @Runner / @Main Runner
  #runner-general     💬  coordination between runners
  #safehouse-admin    🤖  add/remove/stage safehouses; main runners act on their server (see §5b)
  #recovery           💬  vehicle recovery / stuck-asset handling
  #runner-log         📢🤖 append-only audit of runner actions

── GOVERNANCE ───────────────────────────  🔒 @Verified+ read, @Maintainer+ propose
  #proposals          🤖  formal change proposals awaiting a vote (see §5a)
  #vote               🤖  active emoji votes: ✅ / ❌ / 🤷 with quorum + deadline
  #governance-log     📢🤖 append-only record: proposal → tally → founder action
  #treasury           📢🤖 [later] donation balance + spend ledger (Phase 3)

── STAFF ────────────────────────────────  🔒 @Moderator / @Founder
  #mod-only           💬  moderation coordination
  #mod-log            📢  automated join/leave/ban/timeout log
  #ai-review          🤖  founder reviews AI proposals/actions before they go live
```

---

## 4. Verification & anti-raid — [you]

1. **Server Settings → Safety Setup → raise the verification level** to *Medium* or *High* (High =
   verified phone; Medium = registered 5+ min — Medium is the usual community default).
2. **Enable the built-in Membership Screening** (rules that must be accepted) and set the **Welcome
   Screen** to point at `#welcome`.
3. **Account-age gate (governance-critical):** require an account age minimum before a member counts
   toward votes. Discord's native AutoMod + a bot (see §7) enforce this. This directly mitigates
   Risk #4 — sockpuppet vote-stuffing on a system that can eventually move money.
4. **AutoMod rules:** enable spam/mention-spam/harmful-links filters; block invite links in player
   channels; flag suspicious joins to `#mod-log`.
5. **Raid protection:** turn on Discord's *Raid Protection* (Safety Setup) + a bot's join-rate
   throttle. Pause invites / lock `#verify` if a raid is detected.

**Gate flow:** `@everyone` sees only `#welcome` + `#rules` → accepts screening → bot (or reaction
role in `#verify`) grants `@Verified` → community opens up. `@Runner`/`@Maintainer` are granted
**manually by a human** (founder/mod) after vetting — never self-serve, because those roles carry
governance weight.

---

## 5. Governance flows

### 5a. Major changes — the emoji-vote engine [skeleton now / engine Phase 2]

This is the community → AI → founder pipeline. **Phase 2** builds the automation; until then run it
manually with the same shape so behavior is consistent.

1. **Proposal.** A `@Maintainer`+ (or the AI, summarizing community demand) posts a structured
   proposal in `#proposals`: *what, why, which files/areas, compliance note*.
2. **Compliance pre-check.** Anything touching pricing/payments/donations/deposits/the disclaimer
   must reference the `compliance-check` skill result. Proposals that violate `COMPLIANCE.md` are
   **dead on arrival** — no vote can approve them (the repo hooks block the edit regardless).
3. **Vote.** Proposal moves to `#vote` with a fixed **deadline** and reactions:
   - ✅ approve · ❌ reject · 🤷 abstain
4. **Quorum + threshold.** Define explicitly (an Open Item in `ROADMAP.md` — pick and record here):
   - suggested start: **quorum = N eligible @Verified voters**, **threshold = simple majority of
     non-abstain**, **eligibility = @Verified + account-age ≥ gate**.
5. **Founder override/veto.** The founder can veto or approve regardless of tally. Always.
6. **Audited action.** Outcome is logged to `#governance-log`; if it's a code/content change, the AI
   maintainer opens a **feature branch → PR** (per `CLAUDE.md`) and the **founder merges**. Discord
   never merges; Discord fills the queue.

> **Spend/deploy stays OFF here until Phase 3/4.** A passed vote can *propose* a spend, but no money
> moves and nothing deploys without the founder + the Phase-3 controls (caps, allowlist, ledger,
> veto). See `ROADMAP.md`.

### 5b. Routine runner ops — the side channel [now]

Separate from the vote flow so runners aren't blocked on quorum for day-to-day work:

- Routine safehouse changes, staging, and recovery happen in **RUNNER OPS**.
- A **`@Main Runner`** can add/remove/stage safehouses for **their own server** directly (announce in
  `#safehouse-admin`, logged to `#runner-log`).
- A regular `@Runner` **proposes** a change; the main runner or AI applies it.
- Anything that changes *code or site data* (e.g. `src/data/safehouses.ts`) still becomes a
  **feature branch → PR** the founder merges — the side channel decides *intent*, the repo flow
  applies it safely.

---

## 6. The disclaimer (required — do not skip) — [you]

`COMPLIANCE.md` requires the "not affiliated with Bohemia Interactive" disclaimer to stay present.
Put it in **`#rules`** and the `#welcome` screen, matching the site's wording:

> DayZ Car Rental is a community fan project and is **not affiliated with, endorsed by, or sponsored
> by Bohemia Interactive.** DayZ is a trademark of Bohemia Interactive. No real-money rental pricing;
> rentals use in-game commodities. Real-money support is **donations only** and never gates gameplay.

Keep this in sync with the site. Removing or weakening it is a compliance violation — the same rule
that governs the codebase governs the community copy.

---

## 7. Bots — [you] / [later]

- **Moderation/verification bot** (e.g. a reaction-role + AutoMod-complement bot): reaction-role
  verification in `#verify`, join logging to `#mod-log`, account-age gate, anti-raid throttle. **[you]**
- **The AI maintainer bot** — a dedicated bot application for the `@AI Maintainer` identity. **[later,
  Phase 2/C]** Built in **Session C** (`ROADMAP.md`): reads proposals/votes, posts summaries to
  `#governance-log`, opens PRs. Give it **least privilege** — read + post in governance/ops channels
  only, **no** Manage Server / Ban / Manage Roles. Its powers to spend/deploy stay disabled until
  Phase 3/4. Keep its token in a secret store, **never in this repo** (see `CLAUDE.md` rule 2).

---

## 8. Wire the invite into the site — [done in this branch, pending your code]

The landing page reads the invite from `src/data/site.ts` (`SITE.discordInvite`). Create a
**permanent, no-expiry, unlimited-use** invite (Server Settings → Invites, or right-click a channel →
Invite People → Edit → *Expire: Never*, *Max uses: No limit*), then it gets wired in on this branch,
committed, PR'd, and merged → auto-deploys (per `DEPLOY.md`).

---

## 9. Verify — [you]

- Unverified alt account sees **only** `#welcome` + `#rules`; after screening it gets `@Verified` and
  the community channels appear.
- Player channels have no ops noise; contributor/runner/governance channels are role-gated.
- The invite link on the live site opens the server and lands new members on the welcome screen.
- The disclaimer is visible in `#rules` and matches the site.
- A test proposal walks proposal → `#vote` (✅/❌/🤷) → `#governance-log`, and the founder can veto.

---

## What's NOT set up yet (later roadmap items)

- **AI maintainer bot + vote automation** — Session C / Phase 2. Manual for now, same shape.
- **Treasury `#treasury` ledger + guarded spend** — Phase 3 (caps, allowlist, audit, founder veto).
- **Real-money rental economics** — Phase 4, deferred and review-gated (`COMPLIANCE.md`).
- **Exact quorum/threshold/eligibility numbers** — Open Item in `ROADMAP.md`; record the chosen
  values in §5a once decided.
