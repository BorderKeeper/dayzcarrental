// scripts/post-verify.mjs — publish the #verify message with its button.
//
// #verify told newcomers to "React with ✅ below" and no ✅ was ever seeded, so
// the single door into the server had nothing to press. Seeding the reaction
// would not have helped: this bot is a serverless interactions webhook and
// Discord delivers reactions as GATEWAY events, which never reach it. A button
// arrives as a MESSAGE_COMPONENT interaction, which does.
//
//   DISCORD_BOT_TOKEN=... DISCORD_VERIFY_CHANNEL_ID=... [DISCORD_RULES_CHANNEL_ID=...] \
//     node --import ./scripts/ts-loader.mjs scripts/post-verify.mjs
//
// PowerShell:
//   $env:DISCORD_BOT_TOKEN="..."; $env:DISCORD_VERIFY_CHANNEL_ID="..."
//   node --import ./scripts/ts-loader.mjs scripts/post-verify.mjs
//
// Safe to re-run: it posts a NEW message each time. Delete the old one by hand
// (the button on it keeps working, so leaving both just looks untidy).
//
// Before this does anything useful the bot needs, in Server Settings → Roles:
//   * the Manage Roles permission, and
//   * its own role ABOVE @Verified in the list.
// Discord refuses the grant otherwise with a 403 that never mentions ordering.

import { verifyMessage } from "../src/lib/governance/discordAdapter.ts";

const token = process.env.DISCORD_BOT_TOKEN;
const channelId = process.env.DISCORD_VERIFY_CHANNEL_ID;
const rulesChannelId = process.env.DISCORD_RULES_CHANNEL_ID;

const missing = [
  ["DISCORD_BOT_TOKEN", token],
  ["DISCORD_VERIFY_CHANNEL_ID", channelId],
].filter(([, v]) => !v);
if (missing.length > 0) {
  console.error(`Missing: ${missing.map(([k]) => k).join(", ")}.`);
  console.error("The #verify channel id is in its URL: discord.com/channels/<guild>/<channel>");
  process.exitCode = 1;
} else {
  const body = verifyMessage(rulesChannelId);
  const res = await fetch(`https://discord.com/api/v10/channels/${channelId}/messages`, {
    method: "POST",
    headers: { authorization: `Bot ${token}`, "content-type": "application/json" },
    body: JSON.stringify(body),
  });

  if (res.ok) {
    const msg = await res.json();
    console.log(`Posted the verify message: ${msg.id}`);
    console.log("\nCheck, in order:");
    console.log("  1. the button renders in #verify;");
    console.log("  2. pressing it as a NON-verified account grants @Verified;");
    console.log("  3. the community channels become visible to that account.");
    console.log("\nIf step 2 answers with a role error, the bot's role is below @Verified.");
  } else {
    const text = await res.text();
    console.error(`Failed (HTTP ${res.status}): ${text.slice(0, 300)}`);
    if (res.status === 403) console.error("→ the bot can't post in that channel. Check its channel permissions.");
    if (res.status === 404) console.error("→ no such channel, or the bot isn't in that guild.");
    process.exitCode = 1;
  }
}
