// scripts/register-commands.mjs — register this bot's slash commands with Discord.
//
// Replaces the hand-copied curl blobs. Two reasons:
//
//  1. Quoting. On Windows, PowerShell strips the inner double quotes when it
//     passes '{"name":"propose"}' to curl.exe, so Discord receives {name:propose}
//     and answers "The request body contains invalid JSON" (code 50109). The
//     JSON was never wrong; the shell ate it. Same class of trap as the
//     file:// one in the test runner.
//  2. Drift. The command definitions now live in src/lib/governance/commands.ts
//     next to the handler that reads them, so an option can't be added in one
//     place and forgotten in the other.
//
// Usage (works identically on Windows, macOS and Linux):
//
//   DISCORD_APP_ID=... DISCORD_GUILD_ID=... DISCORD_BOT_TOKEN=... \
//     node --import ./scripts/ts-loader.mjs scripts/register-commands.mjs
//
// In PowerShell, set them first:
//   $env:DISCORD_APP_ID="..."; $env:DISCORD_GUILD_ID="..."; $env:DISCORD_BOT_TOKEN="..."
//   node --import ./scripts/ts-loader.mjs scripts/register-commands.mjs
//
// Registers as GUILD commands (instant). Pass --global for global commands,
// which take about an hour to propagate.
//
// The token comes from the environment and is never written anywhere.

import { COMMANDS } from "../src/lib/governance/commands.ts";

const appId = process.env.DISCORD_APP_ID;
const guildId = process.env.DISCORD_GUILD_ID;
const token = process.env.DISCORD_BOT_TOKEN;
const global = process.argv.includes("--global");

const missing = [
  ["DISCORD_APP_ID", appId],
  ["DISCORD_BOT_TOKEN", token],
  ...(global ? [] : [["DISCORD_GUILD_ID", guildId]]),
].filter(([, v]) => !v);

if (missing.length > 0) {
  console.error(`Missing: ${missing.map(([k]) => k).join(", ")}`);
  console.error("See BOT.md section 4.");
  process.exit(1);
}

const url = global
  ? `https://discord.com/api/v10/applications/${appId}/commands`
  : `https://discord.com/api/v10/applications/${appId}/guilds/${guildId}/commands`;

let failed = 0;
for (const command of COMMANDS) {
  const res = await fetch(url, {
    method: "POST",
    headers: { Authorization: `Bot ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify(command),
  });

  if (res.ok) {
    console.log(`  ok  /${command.name}`);
    continue;
  }
  failed++;
  const body = await res.text();
  console.error(`FAIL  /${command.name} — HTTP ${res.status}: ${body}`);
  if (res.status === 401) console.error("      → check DISCORD_BOT_TOKEN.");
  if (res.status === 403) console.error("      → the bot needs applications.commands in this guild.");
}

console.log(
  failed === 0
    ? `\nRegistered ${COMMANDS.length} command(s) ${global ? "globally (allow ~1h)" : "in guild " + guildId}.`
    : `\n${failed} of ${COMMANDS.length} failed.`,
);
process.exit(failed === 0 ? 0 : 1);
