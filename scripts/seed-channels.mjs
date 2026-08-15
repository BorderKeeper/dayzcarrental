// scripts/seed-channels.mjs — pin a "what this channel is for" message in each
// channel that has never had one.
//
// 21 of 24 channels had never had a message posted in them, including
// #rent-a-car, whose own topic promises "how to rent". A verified newcomer
// landed in a set of empty rooms and correctly concluded the project was
// abandoned (C-03).
//
// The content lives in src/data/channelSeeds.ts so it's reviewable in a diff
// rather than buried in a script.
//
//   DISCORD_BOT_TOKEN=... DISCORD_GUILD_ID=... \
//     node --import ./scripts/ts-loader.mjs scripts/seed-channels.mjs
//
// PowerShell:
//   $env:DISCORD_BOT_TOKEN="..."; $env:DISCORD_GUILD_ID="..."
//   node --import ./scripts/ts-loader.mjs scripts/seed-channels.mjs
//
// --dry-run   print what would be posted, touch nothing. Do this first.
// --force     post again even where the bot already pinned something.
//
// IDEMPOTENT by default: before posting it reads the channel's pins and skips
// any channel where this bot already pinned a message. Re-running after adding
// one seed posts only that one — a script that duplicates every pin on the
// second run is a script nobody runs twice.
//
// Channels are matched by NAME, so there are no ids to collect. A name with no
// matching channel is reported rather than skipped silently — that usually
// means a channel was renamed and a seed is now pointing at nothing.
//
// Permissions the bot needs in each target channel: View Channel, Send
// Messages, and Manage Messages (to pin).

import { CHANNEL_SEEDS } from "../src/data/channelSeeds.ts";

const API = "https://discord.com/api/v10";
const token = process.env.DISCORD_BOT_TOKEN;
const guildId = process.env.DISCORD_GUILD_ID;
const dryRun = process.argv.includes("--dry-run");
const force = process.argv.includes("--force");

const missing = [
  ["DISCORD_BOT_TOKEN", token],
  ["DISCORD_GUILD_ID", guildId],
].filter(([, v]) => !v);
if (missing.length > 0) {
  console.error(`Missing: ${missing.map(([k]) => k).join(", ")}.`);
  process.exitCode = 1;
} else {
  process.exitCode = await main();
}

async function main() {
  const headers = { authorization: `Bot ${token}`, "content-type": "application/json" };
  const call = async (path, init) => {
    const res = await fetch(`${API}${path}`, { ...init, headers });
    const body = res.status === 204 ? null : await res.json().catch(() => null);
    return { ok: res.ok, status: res.status, body };
  };

  // --- resolve names -> ids -------------------------------------------------
  const channels = await call(`/guilds/${guildId}/channels`);
  if (!channels.ok) {
    console.error(`Could not list channels (HTTP ${channels.status}).`);
    if (channels.status === 403) console.error("→ the bot lacks access to this guild.");
    if (channels.status === 401) console.error("→ check DISCORD_BOT_TOKEN.");
    return 1;
  }
  // type 0 = text channel. Others (voice, category, forum) can't take a pin.
  const byName = new Map(channels.body.filter((c) => c.type === 0).map((c) => [c.name, c]));

  let posted = 0;
  let skipped = 0;
  let failed = 0;

  for (const seed of CHANNEL_SEEDS) {
    const channel = byName.get(seed.channel);
    if (!channel) {
      // Louder than a skip: a seed pointing at nothing is a rename we missed.
      console.log(`  MISS  #${seed.channel} — no such text channel in this guild`);
      failed++;
      continue;
    }

    if (dryRun) {
      const firstLine = seed.content.split("\n")[0];
      console.log(`  would post to #${seed.channel}: ${firstLine}`);
      posted++;
      continue;
    }

    if (!force) {
      // Discord is mid-migration on pins: the newer paginated
      // /messages/pins sits alongside the classic /pins, and which one a guild
      // answers on varies. Try the new shape, fall back to the old, and treat
      // "couldn't tell" as "go ahead" — a duplicate pin is a smaller problem
      // than skipping every channel because a 404 was read as "already done".
      let pins = await call(`/channels/${channel.id}/messages/pins`);
      if (!pins.ok) pins = await call(`/channels/${channel.id}/pins`);
      const items = Array.isArray(pins.body) ? pins.body : (pins.body?.items ?? []);
      if (pins.ok && items.some((p) => (p.message ?? p)?.author?.bot)) {
        console.log(`  skip  #${seed.channel} — already pinned`);
        skipped++;
        continue;
      }
    }

    const sent = await call(`/channels/${channel.id}/messages`, {
      method: "POST",
      body: JSON.stringify({ content: seed.content }),
    });
    if (!sent.ok) {
      console.log(`  FAIL  #${seed.channel} — HTTP ${sent.status} posting`);
      if (sent.status === 403) console.log(`        → bot can't post in #${seed.channel}`);
      failed++;
      continue;
    }

    let pin = await call(`/channels/${channel.id}/messages/pins/${sent.body.id}`, { method: "PUT" });
    if (!pin.ok) pin = await call(`/channels/${channel.id}/pins/${sent.body.id}`, { method: "PUT" });
    // The message is the point; the pin is a nice-to-have. Posting but failing
    // to pin is still a win, so say so and carry on.
    console.log(pin.ok ? `  ok    #${seed.channel} — posted and pinned` : `  ok    #${seed.channel} — posted (pin failed: needs Manage Messages)`);
    posted++;
  }

  console.log(
    dryRun
      ? `\nDry run: ${posted} message(s) would be posted, ${failed} channel(s) not found.`
      : `\n${posted} posted, ${skipped} already done, ${failed} failed.`,
  );
  return failed === 0 ? 0 : 1;
}
