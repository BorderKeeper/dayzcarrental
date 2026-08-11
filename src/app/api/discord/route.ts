// /api/discord — the serverless webhook endpoint for the AI maintainer bot.
//
// Verifies the Ed25519 signature against the RAW body, answers PING, and routes
// slash commands (/propose, /tally) through the governance engine.
//
// Runs on the Node.js runtime (node:crypto). Secrets/config come from the
// environment and are NEVER in the repo (CLAUDE.md rule 2):
//   - DISCORD_PUBLIC_KEY  (verifies inbound signatures; required)
//   - DISCORD_BOT_TOKEN   (read reactions/roles, post messages; enables voting)
//   - DISCORD_GUILD_ID    (the server; required for /tally)
//   - DISCORD_ROLE_MAP    (JSON: {"<roleId>":"verified", ...}; per-server)
//   - DISCORD_VOTE_CHANNEL_ID (optional; where public vote posts go)
//
// With only DISCORD_PUBLIC_KEY set, the endpoint runs in screen-only mode:
// /propose is compliance-screened and acknowledged, but no public vote post or
// tally happens until the bot token + guild + role map are configured.

import { NextResponse, after } from "next/server";
import { verifyDiscordRequest } from "@/lib/governance/discordVerify";
import { handleInteraction, type DiscordInteraction } from "@/lib/governance/discordAdapter";
import { DiscordApiClient } from "@/lib/governance/discordApi";
import type { Member, Role } from "@/lib/governance/types";
import type { RoleMap } from "@/lib/governance/voteTally";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Parse DISCORD_ROLE_MAP (roleId -> governance Role). Invalid JSON → empty map.
function parseRoleMap(raw: string | undefined): RoleMap {
  if (!raw) return {};
  try {
    const obj = JSON.parse(raw);
    const valid: Role[] = ["founder", "moderator", "maintainer", "main-runner", "runner", "verified"];
    const out: RoleMap = {};
    for (const [rid, role] of Object.entries(obj)) {
      if (typeof role === "string" && (valid as string[]).includes(role)) out[rid] = role as Role;
    }
    return out;
  } catch {
    return {};
  }
}

export async function POST(request: Request) {
  const publicKeyHex = process.env.DISCORD_PUBLIC_KEY;
  if (!publicKeyHex) {
    return NextResponse.json({ error: "Bot not configured" }, { status: 503 });
  }

  const signatureHex = request.headers.get("x-signature-ed25519") ?? "";
  const timestamp = request.headers.get("x-signature-timestamp") ?? "";
  const rawBody = await request.text();

  if (!verifyDiscordRequest({ publicKeyHex, signatureHex, timestamp, rawBody })) {
    return new NextResponse("invalid request signature", { status: 401 });
  }

  let interaction: DiscordInteraction;
  try {
    interaction = JSON.parse(rawBody);
  } catch {
    return new NextResponse("bad request", { status: 400 });
  }

  // Build the adapter config from env. Bot token + guild + role map together
  // enable the public vote-post + tally flow; without them we're screen-only.
  const token = process.env.DISCORD_BOT_TOKEN;
  const guildId = process.env.DISCORD_GUILD_ID;
  const roleMap = parseRoleMap(process.env.DISCORD_ROLE_MAP);
  const voteChannelId = process.env.DISCORD_VOTE_CHANNEL_ID;
  const discord = token ? new DiscordApiClient({ token }) : undefined;

  // Roster stays empty here — eligibility for votes is derived per-reactor at
  // tally time (roles via API + roleMap, age via snowflake), which is the
  // authoritative source. The roster only matters for the screen-only fallback.
  const roster = new Map<string, Member>();

  const handled = handleInteraction(interaction, {
    discord,
    guildId,
    roleMap,
    voteChannelId,
    nowMs: Date.now(),
    roster,
  });

  // Run any deferred Discord work AFTER the response is flushed, so we ack
  // within Discord's 3s window and do the slow API calls in the background.
  if (handled.deferred) {
    after(handled.deferred());
  }

  return NextResponse.json(handled.response);
}
