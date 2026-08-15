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
import { dispatchAiBuild } from "@/lib/governance/githubDispatch";
import { onceStoreFromEnv } from "@/lib/governance/onceStore";
import { RunnerOps } from "@/lib/governance/runnerOps";
import { AuditLog } from "@/lib/governance/audit";
import { loadMainRunnerAssignments } from "@/data/liveStore";
import { parseRoleMap } from "@/lib/governance/roleMap";
import type { Member, Proposal } from "@/lib/governance/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

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
  const { map: roleMap, problems: roleMapProblems } = parseRoleMap(process.env.DISCORD_ROLE_MAP);
  const voteChannelId = process.env.DISCORD_VOTE_CHANNEL_ID;
  const discord = token ? new DiscordApiClient({ token }) : undefined;

  // Fail LOUDLY. Only log once the bot is otherwise wired — before that, an
  // absent role map is the expected screen-only state, not a misconfiguration.
  if (token && guildId && roleMapProblems.length > 0) {
    console.error("[governance] DISCORD_ROLE_MAP problems:", roleMapProblems.join(" "));
  }

  // Roster stays empty here — eligibility for votes is derived per-reactor at
  // tally time (roles via API + roleMap, age via snowflake), which is the
  // authoritative source. The roster only matters for the screen-only fallback.
  const roster = new Map<string, Member>();

  // If a GitHub dispatch token is configured, an APPROVED vote fires the AI
  // feature-builder workflow (repository_dispatch). Absent → approvals are just
  // reported. The builder only ever opens a PR the founder merges.
  const ghToken = process.env.GITHUB_DISPATCH_TOKEN;
  const ghOwner = process.env.GITHUB_REPO_OWNER ?? "BorderKeeper";
  const ghRepo = process.env.GITHUB_REPO_NAME ?? "dayzcarrental";
  //
  // The dispatch is claimed ONCE per proposal before it fires. Re-running
  // /tally on the same vote used to mint a fresh build, PR and public post
  // every time, each one spending the real donation balance. Now the second
  // and later runs report the existing build instead of starting another.
  const once = onceStoreFromEnv();
  const onApproved = ghToken
    ? async (proposal: Proposal): Promise<string> => {
        let claimed: boolean;
        try {
          claimed = await once.claim(`ai-build:${proposal.id}`);
        } catch (e) {
          // Can't prove this is the first run → don't spend. A missed build is
          // recoverable by hand; a duplicate one costs money and opens a
          // duplicate PR.
          console.error("[governance] idempotency claim failed:", (e as Error).message);
          return "⚠️ Approved, but the build wasn't started (couldn't check whether it had already run). Kick it off manually.";
        }
        if (!claimed) {
          return "ℹ️ Approved — the AI maintainer was already building this proposal, so no second build was started.";
        }
        const okDispatch = await dispatchAiBuild(
          {
            proposalId: proposal.id,
            title: proposal.title,
            actionKind: proposal.actionKind,
            body: proposal.rawBody,
          },
          { token: ghToken, owner: ghOwner, repo: ghRepo },
        );
        return okDispatch
          ? "🤖 The AI maintainer is building this now — a PR will open for the founder to review."
          : "⚠️ Approved, but the AI build trigger failed — kick it off manually.";
      }
    : undefined;

  const handled = handleInteraction(interaction, {
    discord,
    guildId,
    roleMap,
    voteChannelId,
    nowMs: Date.now(),
    roster,
    roleMapProblems,
    onApproved,
    // E-03: RunnerOps existed and was tested, but nothing outside test files
    // ever constructed it, so per-server authority did nothing and a main
    // runner ended up waiting on her own approval. This is that construction.
    // Assignments are read per request so a promotion takes effect immediately
    // rather than after the next cold start.
    runnerOpsFor: async (serverId, requester) => {
      const assignments = await loadMainRunnerAssignments([serverId]);
      const members = new Map<string, Member>([[requester.id, requester]]);
      return {
        ops: new RunnerOps(members, assignments, new AuditLog()),
        assigned: (assignments.get(serverId) ?? []).length > 0,
      };
    },
  });

  // Run any deferred Discord work AFTER the response is flushed, so we ack
  // within Discord's 3s window and do the slow API calls in the background.
  if (handled.deferred) {
    after(handled.deferred());
  }

  return NextResponse.json(handled.response);
}
