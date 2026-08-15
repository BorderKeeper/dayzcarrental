// channelSeeds.ts — the pinned "what this channel is for" message for each
// channel.
//
// 21 of 24 channels had never had a message posted in them, including
// #rent-a-car, whose own topic promises "how to rent". A verified newcomer
// landed in a set of empty rooms and correctly concluded the project was
// abandoned (C-03). Empty rooms read as a dead project far more strongly than
// a small one does.
//
// Each pin answers the four questions the audit asked for: what the channel is
// for, what to post, who answers, and how long it takes. The last two matter
// most — an unanswered question in a quiet channel is what makes someone leave.
//
// Honesty rules for this content, since a newcomer reads it before anything
// else and will notice if it oversells:
//   * never claim a fleet, a server or a runner that doesn't exist yet;
//   * never promise a response time this crew can't hold to;
//   * say plainly when something is not built yet.

export interface ChannelSeed {
  // Channel NAME, not id — the script resolves names so the founder doesn't
  // have to collect twenty ids by hand.
  channel: string;
  content: string;
}

// A small crew answering in their own time. Better to say this once, here,
// than to imply a support desk that doesn't exist.
const RESPONSE = "We're a small volunteer crew — usually same day, sometimes a couple. If something's gone quiet, say so again; you're not being ignored.";

export const CHANNEL_SEEDS: ChannelSeed[] = [
  // --- WELCOME -------------------------------------------------------------
  {
    channel: "announcements",
    content: [
      "**📣 What lands here**",
      "",
      "Server additions, new safehouses, changes to how renting works, and anything the community voted on.",
      "",
      "Read-only — questions about anything posted here go in #general, and we'll answer there.",
    ].join("\n"),
  },
  {
    channel: "lobby",
    content: [
      "**👋 Waiting room**",
      "",
      "You can see this before you're verified. Say hello, ask anything, or head to #verify to unlock the rest of the server.",
      "",
      "Nothing here is a test — there's no hazing, no application. Verifying is one button.",
      "",
      RESPONSE,
    ].join("\n"),
  },

  // --- PLAYERS -------------------------------------------------------------
  {
    channel: "general",
    content: [
      "**💬 General chat**",
      "",
      "DayZ talk, war stories, questions that don't fit anywhere else. No topic policing beyond #rules.",
      "",
      "If you're after a car, #rent-a-car is the place. If something's broken, #support.",
    ].join("\n"),
  },
  {
    channel: "rent-a-car",
    content: [
      "**🚗 Renting a car**",
      "",
      "**How it works:** you pick a server and a car on the site, a volunteer *runner* stages it at an agreed safehouse and sends you the lock code. You pay in **in-game items** — ammo, fuel, food — plus a refundable in-game deposit. **No real money, ever.**",
      "",
      "**Start here:** https://dayzcarrental.com — pick your server, pick a car, fill in the form. That reaches a runner.",
      "",
      "**Straight answer about right now:** we're early, and a server only has cars once someone volunteers to run them there. If your server isn't listed, say which one you play on in this channel — that's genuinely the most useful thing you can post.",
      "",
      "**Deposits:** returned when the car comes back on time. If a runner has to pull a car mid-rental, your deposit is waived — you're never out of pocket for our decisions.",
      "",
      RESPONSE,
    ].join("\n"),
  },
  {
    channel: "donate-a-car",
    content: [
      "**🎁 Found a spare car?**",
      "",
      "Add it to the community fleet. Post here or use the form: https://dayzcarrental.com/donate-a-car",
      "",
      "**Tell us:** which server, roughly where the car is, what it still needs (battery, plugs, wheels), and whether you want anything in barter for it. \"Nothing, pay it forward\" is a perfectly good answer.",
      "",
      "A runner collects it, gets it road-worthy, and stages it for the next survivor.",
      "",
      RESPONSE,
    ].join("\n"),
  },
  {
    channel: "server-status",
    content: [
      "**📡 Which servers we cover**",
      "",
      "A server appears here once it has at least one runner staging cars on it. Until then there's nothing to rent there, and we'd rather say so than list it and disappoint you.",
      "",
      "**Want your server covered?** https://dayzcarrental.com/list-your-server, or just ask in #general. The only real requirement is one person willing to run cars — often the person asking.",
    ].join("\n"),
  },
  {
    channel: "support",
    content: [
      "**🛟 Something's wrong**",
      "",
      "Post here if a runner hasn't come back to you, a lock code doesn't work, a deposit looks wrong, or the site is misbehaving.",
      "",
      "**Include if you can:** which server, which car, roughly when, and what you expected to happen.",
      "",
      "**Deposit disputes are read by a human, not a rule.** If a car was taken out of service mid-rental, or something went wrong that wasn't your doing, say so — you're not meant to lose a deposit for our mistake.",
      "",
      RESPONSE,
    ].join("\n"),
  },

  // --- CONTRIBUTORS --------------------------------------------------------
  {
    channel: "contributor-hub",
    content: [
      "**🤝 Want to help run this?**",
      "",
      "This is the front door for both contributor roles. Introduce yourself here and say which you're after — a mod will grant the role after a quick chat. **Roles aren't self-serve**, and that's the only gate: there's no test and no minimum hours.",
      "",
      "**🏃 Runner** — the one we need most. You play on a server, you stage cars at safehouses and pass lock codes to renters. No coding. Details: https://dayzcarrental.com/runner",
      "",
      "**🛠️ Maintainer** — you steer what the project builds by proposing and voting on changes. No coding needed for this either. Details: https://dayzcarrental.com/maintainer",
      "",
      "**Writing code** is a third option and needs no role at all — the repo is public, open a PR: https://github.com/BorderKeeper/dayzcarrental",
      "",
      RESPONSE,
    ].join("\n"),
  },
  {
    channel: "dev",
    content: [
      "**⌨️ Building the thing**",
      "",
      "The site is Next.js + TypeScript. Two commands to run it, no database to provision, no API keys needed: `npm install && npm run dev`.",
      "",
      "Start at the README: https://github.com/BorderKeeper/dayzcarrental",
      "",
      "**Worth knowing:** most code changes here are written by an AI maintainer and merged by the founder. That's an experiment, not a policy — human PRs are welcome and reviewed the same way. Some files are locked against the *AI*; that restriction isn't on you.",
    ].join("\n"),
  },
  {
    channel: "design-content",
    content: [
      "**🎨 How it looks and reads**",
      "",
      "Copy, layout, and artwork. The site is deliberately retro — early-2000s boxy panels — and that's a choice, not an accident.",
      "",
      "**Most wanted right now:** in-game screenshots of the vehicles. The cards currently use simple drawings we made, because the photos we had were lifted from the DayZ wiki and we'd rather own what we ship. A survivor standing next to the car beats a clean shot.",
      "",
      "**One condition:** it has to be *your* screenshot, taken by you in-game.",
    ].join("\n"),
  },

  // --- RUNNER OPS ----------------------------------------------------------
  {
    channel: "runner-general",
    content: [
      "**🏃 Runner chat**",
      "",
      "Coordination between runners: who's covering which server, handovers, and anything that needs a second pair of hands.",
      "",
      "**What a runner actually does:** stage cars at agreed safehouses, pass lock codes once payment is agreed, collect cars when a rental ends, and get donated cars road-worthy.",
      "",
      "**You are not on call.** If you can't cover something, say so here — that's the whole point of having a channel.",
    ].join("\n"),
  },
  {
    channel: "safehouse-admin",
    content: [
      "**🏠 Safehouse list**",
      "",
      "Use `/safehouse op:<add|remove|stage> server:<server id> name:<safehouse>`.",
      "",
      "**If you're the main runner for that server it applies immediately** — no vote, no waiting on the founder. Routine work shouldn't need a quorum.",
      "",
      "If you're not, it's recorded as a proposal for a main runner to apply. If the bot says nobody is assigned to that server yet, tell the founder — that's a config gap, not a rejection.",
      "",
      "**One thing to know:** a community vote can overturn a safehouse change, even on a server you run. It should be rare, and you'll be told rather than finding out. Reasoning is written down in GOVERNANCE.md §5b.",
    ].join("\n"),
  },
  {
    channel: "recovery",
    content: [
      "**🔧 Stuck, wrecked, or missing cars**",
      "",
      "Post the car, the server, roughly where it is, and what happened. Flipped, out of fuel, glitched into terrain, or simply gone.",
      "",
      "**Being honest about the state of this:** there's no ticket system behind this channel yet — it's runners reading and helping each other. If a car is unrecoverable, a runner takes it out of service, and any active rental has its deposit waived automatically. The renter never pays for that.",
    ].join("\n"),
  },
  {
    channel: "runner-log",
    content: [
      "**📋 Runner-ops record**",
      "",
      "Applied safehouse changes get announced here, so anyone can see who changed what and when.",
      "",
      "Read-only — discussion goes in #runner-general.",
    ].join("\n"),
  },

  // --- GOVERNANCE ----------------------------------------------------------
  {
    channel: "proposals",
    content: [
      "**📋 Proposing a change**",
      "",
      "`/propose kind:<type> title:<short title> body:<what and why>` — `/help` lists everything.",
      "",
      "**What proposals are for:** how the project works. Rules, policy, what gets built. Adding a safehouse is *not* a proposal — that's `/safehouse` in #safehouse-admin and needs no vote.",
      "",
      "**Screening:** proposals are checked against the compliance rules first. That check is an automated keyword scan and **it does get things wrong** — if it misreads you, reword it or ask a mod. It isn't an accusation.",
      "",
      "**What can never pass:** anything putting real money on renting, gating gameplay behind donations, or removing the Bohemia disclaimer. No vote can approve those, including a unanimous one.",
    ].join("\n"),
  },
  {
    channel: "vote",
    content: [
      "**🗳️ Voting**",
      "",
      "Proposals appear here. React ✅ approve · ❌ reject · 🤷 abstain.",
      "",
      "**Who counts:** verified members whose account clears a minimum age — a sockpuppet gate, not a judgement about you. **🤷 doesn't count toward quorum.**",
      "",
      "When the window closes, the proposer or a mod runs `/tally message:<id>` and the result is posted here.",
      "",
      "**If a tally says nobody voted and you know people did, say so.** That's a misconfiguration on our side, not apathy on yours, and we'd rather hear about it.",
    ].join("\n"),
  },
  {
    channel: "governance-log",
    content: [
      "**📓 The record**",
      "",
      "Every tally and every runner-ops change writes its trail here: what was proposed, how it was counted, what was decided, and what happened next.",
      "",
      "Read-only, and deliberately dull. If a decision ever looks strange, this is where you check it rather than taking anyone's word.",
    ].join("\n"),
  },
  {
    channel: "treasury",
    content: [
      "**💰 Where the money goes**",
      "",
      "Donations are voluntary and fund upkeep only: hosting, and the AI maintainer's token costs. Live balance: https://dayzcarrental.com/donate",
      "",
      "**Donations buy nothing in-game.** No car, no priority, no advantage. Renting is always paid in in-game items to a runner. That isn't a promise, it's built into the code — the rental model has no field a currency amount could go in.",
      "",
      "**Nobody is paid real money** for in-game work, including the founder and runners.",
      "",
      "Donations can take up to a day to show on the balance — PayPal is slow to publish, and we reconcile on a schedule.",
    ].join("\n"),
  },
];
