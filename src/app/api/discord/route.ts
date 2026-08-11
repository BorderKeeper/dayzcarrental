// /api/discord — the serverless webhook endpoint for the AI maintainer bot.
//
// Discord POSTs interaction events here. This route:
//   1. verifies the Ed25519 signature against the RAW body (reject → 401),
//   2. answers PING with PONG (required for endpoint registration),
//   3. routes slash-command change-requests through the governance engine.
//
// Runs on the Node.js runtime (node:crypto for Ed25519). Secrets come from the
// environment and are NEVER in the repo (CLAUDE.md rule 2):
//   - DISCORD_PUBLIC_KEY  (the app's public key; not secret, but env-sourced)
//   - the Anthropic key / bot token live in env too, used elsewhere.
//
// NOTE: this is the transport shell. It is wired to the governance engine with
// an EMPTY roster and no live vote source by default, so in the mockup it
// safely screens + acknowledges proposals without granting anyone authority.
// The founder connects the real roster + reaction-vote source when the bot goes
// live (see BOT.md). Nothing here merges, deploys, or moves money.

import { NextResponse } from "next/server";
import { verifyDiscordRequest } from "@/lib/governance/discordVerify";
import { GovernanceEngine } from "@/lib/governance/engine";
import { handleInteraction, type DiscordInteraction } from "@/lib/governance/discordAdapter";
import type { Member } from "@/lib/governance/types";

export const runtime = "nodejs"; // node:crypto Ed25519; not edge
export const dynamic = "force-dynamic"; // never statically prerender a webhook

export async function POST(request: Request) {
  const publicKeyHex = process.env.DISCORD_PUBLIC_KEY;
  if (!publicKeyHex) {
    // Fail closed: with no key configured we cannot verify anything.
    return NextResponse.json({ error: "Bot not configured" }, { status: 503 });
  }

  const signatureHex = request.headers.get("x-signature-ed25519") ?? "";
  const timestamp = request.headers.get("x-signature-timestamp") ?? "";
  const rawBody = await request.text(); // exact bytes — required for verification

  const ok = verifyDiscordRequest({ publicKeyHex, signatureHex, timestamp, rawBody });
  if (!ok) {
    return new NextResponse("invalid request signature", { status: 401 });
  }

  let interaction: DiscordInteraction;
  try {
    interaction = JSON.parse(rawBody);
  } catch {
    return new NextResponse("bad request", { status: 400 });
  }

  // Empty roster + no live vote source in the mockup: proposals are screened
  // and acknowledged, but no one is elevated and no tally is fabricated. The
  // founder wires the real roster and reaction-vote source when going live.
  const roster = new Map<string, Member>();
  const engine = new GovernanceEngine(roster);

  const response = handleInteraction(interaction, { engine, roster });
  return NextResponse.json(response);
}
