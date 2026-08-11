// discordAdapter.ts — turn a verified Discord interaction into a governance
// action, and shape the reply. This is the bridge between the (untrusted)
// Discord surface and the governance engine.
//
// Trust model (CLAUDE.md): a Discord interaction is UNTRUSTED DATA. A change
// request from a user is a *proposal*, screened by the same compliance +
// prompt-injection gate as everything else (screen.ts / engine.ts). The bot
// adheres to signed-off requests only within the guardrails — a request that
// violates COMPLIANCE.md is dead on arrival no matter who sent it or how it's
// phrased. The bot never merges and never spends game/real money here; on an
// approved change it opens a PR for the founder (queue-pr), per the roadmap.
//
// Interaction/response type constants are from Discord's documented API (they
// are protocol numbers, not secrets).

import type { Member, Proposal, Vote } from "./types";
import { GovernanceEngine } from "./engine";

// --- Discord protocol constants -------------------------------------------
export const InteractionType = { PING: 1, APPLICATION_COMMAND: 2, MESSAGE_COMPONENT: 3 } as const;
export const InteractionResponseType = {
  PONG: 1,
  CHANNEL_MESSAGE_WITH_SOURCE: 4,
  DEFERRED_CHANNEL_MESSAGE_WITH_SOURCE: 5,
} as const;

// The minimal shape of the interaction fields we read. Everything here is
// attacker-controlled except what the signature already authenticated (that
// the payload genuinely came from Discord — not that its *content* is trusted).
export interface DiscordInteraction {
  type: number;
  data?: {
    name?: string; // slash command name, e.g. "propose"
    options?: { name: string; value: string | number | boolean }[];
  };
  member?: { user?: { id?: string; username?: string } };
  user?: { id?: string; username?: string };
}

export interface DiscordResponse {
  type: number;
  data?: { content: string; flags?: number };
}

const EPHEMERAL = 1 << 6; // reply only the caller sees

// Map a slash-command option list to a simple record.
function opts(interaction: DiscordInteraction): Record<string, string> {
  const out: Record<string, string> = {};
  for (const o of interaction.data?.options ?? []) out[o.name] = String(o.value);
  return out;
}

// Resolve the caller into a governance Member using the roster we're given.
// A user we don't know is treated as bare @everyone (ineligible to vote,
// can't run privileged actions) — never elevated on the strength of a Discord
// payload alone.
function resolveMember(interaction: DiscordInteraction, roster: Map<string, Member>): Member {
  const u = interaction.member?.user ?? interaction.user ?? {};
  const id = u.id ?? "unknown";
  const known = roster.get(id);
  if (known) return known;
  return { id, handle: u.username ?? "unknown", roles: ["everyone"], accountAgeDays: 0 };
}

export interface AdapterConfig {
  engine: GovernanceEngine;
  roster: Map<string, Member>;
  // How votes are sourced for a proposal in the manual/skeleton phase. In the
  // live vote engine (later) this reads reactions; here it's injected so the
  // adapter stays pure and testable.
  votesFor?: (proposalId: string) => Vote[];
}

// Handle one interaction, returning the JSON Discord expects. PING → PONG is
// required for endpoint registration and heartbeats.
export function handleInteraction(interaction: DiscordInteraction, cfg: AdapterConfig): DiscordResponse {
  if (interaction.type === InteractionType.PING) {
    return { type: InteractionResponseType.PONG };
  }

  if (interaction.type === InteractionType.APPLICATION_COMMAND) {
    const name = interaction.data?.name;
    if (name === "propose") {
      return handlePropose(interaction, cfg);
    }
    return reply(`Unknown command '${name ?? ""}'. Try /propose.`);
  }

  return reply("Unsupported interaction.");
}

// /propose kind:<action> title:<text> body:<text>
// Screens + (in skeleton mode) tallies any injected votes, then reports the
// outcome. On approval the effect is a queued PR — the founder still merges.
function handlePropose(interaction: DiscordInteraction, cfg: AdapterConfig): DiscordResponse {
  const o = opts(interaction);
  const author = resolveMember(interaction, cfg.roster);

  const proposal: Proposal = {
    id: `discord-${o.id ?? interaction.data?.name ?? "p"}-${author.id}`,
    authorId: author.id,
    actionKind: o.kind ?? "content-edit",
    title: o.title ?? "(untitled)",
    rawBody: o.body ?? "",
  };

  const votes = cfg.votesFor ? cfg.votesFor(proposal.id) : [];
  const outcome = cfg.engine.run(proposal, votes);

  // The reply is ephemeral: it's an acknowledgement to the proposer, not a
  // channel-wide announcement. The authoritative record is #governance-log
  // (the engine's audit trail).
  const lines = [`**Proposal received:** ${proposal.title}`, outcome.summary];
  if (outcome.decision === "dead-on-arrival") {
    lines.push("This cannot be approved — it conflicts with COMPLIANCE.md or is unsafe. Not queued.");
  } else if (outcome.decision === "approved") {
    lines.push("Queued for the founder to review and merge. No money moves, nothing deploys.");
  }
  return reply(lines.join("\n"));
}

function reply(content: string): DiscordResponse {
  return {
    type: InteractionResponseType.CHANNEL_MESSAGE_WITH_SOURCE,
    data: { content, flags: EPHEMERAL },
  };
}
