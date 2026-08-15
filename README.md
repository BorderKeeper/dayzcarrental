# DayzCarRental.com

A community car-rental service for **DayZ**. Players rent vehicles from other players, pay in
**in-game items** — ammo, fuel, food, tools — and leave a refundable in-game deposit. Volunteer
**runners** stage the cars at agreed safehouses and hand over the lock codes.

No real money is involved in renting anything. Ever. That's not a slogan, it's enforced in the
code: the rental model has no field a currency amount could go in.

> This is a non-commercial fan project. It is **not affiliated with or endorsed by Bohemia
> Interactive**. DayZ is a trademark of Bohemia Interactive a.s.

**Status: early.** The site is a working mockup. The live server list starts empty and fills up as
real servers get runners — see [Sample data vs live](#sample-data-vs-live) below.

---

## Run it

You need Node 18.18+ (24 recommended — the test runner uses its TypeScript support).

```bash
npm install
npm run dev      # http://localhost:3000
npm run build    # production build; CI runs this on every PR
```

That's the whole setup. There's no database to provision and no API keys to get — everything
external is optional and the app degrades honestly without it.

### Tests

```bash
./src/lib/governance/__tests__/run.sh
```

Runs on Linux, macOS and Windows (Git Bash). No test framework to install — it's `node:test` plus
Node's type stripping.

---

## Sample data vs live

Two versions of the site, deliberately:

| | Data | Where |
|---|---|---|
| **Live** | Real servers, safehouses and staged cars, from Redis | `/` |
| **Sandbox** | Invented sample data, hardcoded | `/sandbox` |

Every `/sandbox` page carries a banner saying the data is made up, and the tree is `noindex` so the
fake servers never turn up in a search result. If the live store is empty or unreachable, the live
site says so — it **never** falls back to sample data, because a visitor seeing invented servers
presented as real is worse than a visitor seeing an honest empty state.

To put real data in the live store you need `REDIS_URL` set:

```bash
node --import ./scripts/ts-loader.mjs scripts/fleet.mjs show
node --import ./scripts/ts-loader.mjs scripts/fleet.mjs seed my-fleet.json
```

---

## How it's built

Next.js 15 (App Router, TypeScript). Deliberately dependency-light: no UI framework, no ORM, no
Redis client library. Where something external is needed it's spoken directly — Redis over its wire
protocol using `node:net`, HTTP APIs with `fetch`, signature checks with `node:crypto`.

```
src/app/          routes; /sandbox mirrors the live tree with sample data
src/components/   React components, shared by both trees
src/data/         vehicle catalogue, sandbox fixtures, live store, seed script
src/lib/governance/  the decision engine: voting, screening, booking, budget
scripts/          fleet seeding + the AI build entrypoint
```

The interesting part is `src/lib/governance`. It's a pure model — no I/O, no clock, no network —
which is why it can be exercised by scripted multi-user conversations in tests.

---

## Who runs it

Unusually: an **AI maintainer** does most of the code changes, taking direction from Discord
volunteers, with a human founder as the only person who can merge.

That's why the top-level docs read the way they do. `CLAUDE.md`, `COMPLIANCE.md` and
`GUARDRAILS.md` are written **at the AI**, describing what it may not do — they're guardrails, not
contributor guidelines, and you can safely skip them unless you're curious.

**Humans are very welcome here.** If you want to help:

- **Play DayZ and want cars on your server?** That's the most useful thing — it needs a runner, not
  a developer. Say hello in Discord.
- **Want to write code?** Open an issue or a PR. Normal GitHub workflow; nothing special expected.
- **Want to shape decisions?** The community votes on proposals in Discord (`/help` in the server
  explains the commands). See `GOVERNANCE.md`.

The one thing to know before opening a PR: some files are locked and CI will reject changes to
them from the AI. That restriction is on the AI, not on you — but if you're touching
`COMPLIANCE.md` or anything in `.claude/`, say why in the PR so the founder can review it properly.

## The money rules, in short

Read `COMPLIANCE.md` for the authoritative version. The short form:

- Renting is **in-game commodity only**. Never real money.
- Real money exists only as **voluntary donations** toward upkeep — hosting and AI tokens. Donations
  buy nothing in-game: no car, no priority, no advantage.
- Deposits are in-game items, refundable, forfeit only if you don't bring the car back in time.
- Nobody gets paid real money for in-game work.

## More

- `GOVERNANCE.md` — how proposals and votes actually work
- `BOT.md` — the Discord bot: setup, commands, environment
- `DISCORD.md` — server layout and roles
- `ROADMAP.md` — what's built, what's next, and the known risks
- `DEPLOY.md` — hosting
