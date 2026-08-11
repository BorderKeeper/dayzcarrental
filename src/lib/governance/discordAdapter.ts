// discordAdapter.ts — turn a verified Discord interaction into a governance
// action, and shape the reply. Bridge between the (untrusted) Discord surface
// and the governance engine.
//
// Trust model (CLAUDE.md): a Discord interaction is UNTRUSTED DATA. A change
// request is a *proposal*, screened by the same compliance + prompt-injection
// gate as everything else. The bot adheres to signed-off requests only within
// the guardrails — a violation is dead on arrival no matter who sent it. The
// bot never merges, deploys, or moves money; an approved change becomes a PR
// the founder merges.
//
// Two commands:
//   /propose  → screen; if dead-on-arrival, ephemeral refusal (no vote post);
//               else post a PUBLIC vote message (embed encodes the proposal;
//               that message IS the store) with ✅/❌/🤷 seeded.
//   /tally    → read a vote message + its reactions, resolve eligible voters,
//               run the engine, post the outcome. Slow (several API calls) so
//               it uses the deferred-response pattern.
//
// Because posting/reading Discord requires async API calls that can exceed
// Discord's 3s ack window, handlers return an immediate `response` plus an
// optional `deferred` thunk the route runs after flushing the ack.

import type { Member, Proposal } from "./types";
import { GovernanceEngine } from "./engine";
import { screenProposal } from "./screen";
import { DiscordApiClient, VOTE_EMOJI } from "./discordApi";
import { proposalEmbed, collectAndTally, type RoleMap } from "./voteTally";

// --- Discord protocol constants -------------------------------------------
export const InteractionType = { PING: 1, APPLICATION_COMMAND: 2, MESSAGE_COMPONENT: 3 } as const;
export const InteractionResponseType = {
  PONG: 1,
  CHANNEL_MESSAGE_WITH_SOURCE: 4,
  DEFERRED_CHANNEL_MESSAGE_WITH_SOURCE: 5,
} as const;

export interface DiscordInteraction {
  type: number;
  application_id?: string;
  token?: string; // interaction token (for deferred follow-up edits)
  channel_id?: string;
  data?: {
    name?: string;
    options?: { name: string; value: string | number | boolean }[];
  };
  member?: { user?: { id?: string; username?: string } };
  user?: { id?: string; username?: string };
}

export interface DiscordResponse {
  type: number;
  data?: { content?: string; embeds?: any[]; flags?: number };
}

// What a handler returns: the immediate reply Discord gets, plus optional async
// work to run *after* the reply is flushed (deferred pattern).
export interface HandledInteraction {
  response: DiscordResponse;
  deferred?: () => Promise<void>;
}

const EPHEMERAL = 1 << 6;

export interface AdapterConfig {
  // Present when the bot is fully wired (token/guild/roleMap set in env).
  // Absent → the endpoint runs in screen-only mode (no vote posts/tallies).
  discord?: DiscordApiClient;
  guildId?: string;
  roleMap?: RoleMap;
  voteChannelId?: string; // where public vote posts go (defaults to the invoking channel)
  nowMs: number;
  roster: Map<string, Member>;
}

function opts(interaction: DiscordInteraction): Record<string, string> {
  const out: Record<string, string> = {};
  for (const o of interaction.data?.options ?? []) out[o.name] = String(o.value);
  return out;
}

function resolveAuthor(interaction: DiscordInteraction, roster: Map<string, Member>): Member {
  const u = interaction.member?.user ?? interaction.user ?? {};
  const id = u.id ?? "unknown";
  const known = roster.get(id);
  if (known) return known;
  return { id, handle: u.username ?? "unknown", roles: ["everyone"], accountAgeDays: 0 };
}

// Entry point. PING → PONG (required for registration & heartbeats).
export function handleInteraction(interaction: DiscordInteraction, cfg: AdapterConfig): HandledInteraction {
  if (interaction.type === InteractionType.PING) {
    return { response: { type: InteractionResponseType.PONG } };
  }
  if (interaction.type === InteractionType.APPLICATION_COMMAND) {
    switch (interaction.data?.name) {
      case "propose":
        return handlePropose(interaction, cfg);
      case "tally":
        return handleTally(interaction, cfg);
      default:
        return { response: reply(`Unknown command '${interaction.data?.name ?? ""}'. Try /propose or /tally.`) };
    }
  }
  return { response: reply("Unsupported interaction.") };
}

// /propose kind:<action> title:<text> body:<text>
function handlePropose(interaction: DiscordInteraction, cfg: AdapterConfig): HandledInteraction {
  const o = opts(interaction);
  const author = resolveAuthor(interaction, cfg.roster);
  const proposal: Proposal = {
    // Deterministic-ish id from author + title; the vote message id is the real key.
    id: `discord-${author.id}-${(o.title ?? "p").toLowerCase().replace(/[^a-z0-9]+/g, "-").slice(0, 40)}`,
    authorId: author.id,
    actionKind: o.kind ?? "content-edit",
    title: o.title ?? "(untitled)",
    rawBody: o.body ?? "",
  };

  // Screen FIRST. A dead-on-arrival proposal never becomes a public vote post —
  // it gets an ephemeral refusal only the proposer sees.
  const screen = screenProposal(proposal);
  if (!screen.ok) {
    const why = screen.reasons.map((r) => r.detail).join(" | ");
    return {
      response: reply(
        `**Proposal rejected — dead on arrival.**\nIt conflicts with COMPLIANCE.md or is unsafe, so it will not be put to a vote:\n> ${why}`,
      ),
    };
  }

  // Compliant → post a PUBLIC vote message. If the bot isn't fully wired
  // (no discord client), fall back to the screen-only acknowledgement.
  if (!cfg.discord) {
    const engine = new GovernanceEngine(cfg.roster);
    const outcome = engine.run(proposal, []);
    return { response: reply(`**Proposal received:** ${proposal.title}\n${outcome.summary}`) };
  }

  const channelId = cfg.voteChannelId || interaction.channel_id || "";
  // Defer: acknowledge ephemerally now, post the public vote message after.
  return {
    response: {
      type: InteractionResponseType.DEFERRED_CHANNEL_MESSAGE_WITH_SOURCE,
      data: { flags: EPHEMERAL },
    },
    deferred: async () => {
      const discord = cfg.discord!;
      const embed = proposalEmbed(proposal);
      const posted = await discord.createMessage(channelId, {
        content: "🗳️ **New proposal up for a vote** — react below.",
        embeds: [embed],
      });
      // Seed the three reactions (best-effort; a failure just means voters add them).
      for (const e of [VOTE_EMOJI.approve, VOTE_EMOJI.reject, VOTE_EMOJI.abstain]) {
        try {
          await discord.addReaction(posted.channel_id, posted.id, e);
        } catch {
          /* non-fatal */
        }
      }
      await editOriginal(
        discord,
        interaction,
        `Posted your proposal for a vote here: https://discord.com/channels/${cfg.guildId}/${posted.channel_id}/${posted.id}\n` +
          `Run \`/tally message:${posted.id}\` after the voting window to count it.`,
      );
    },
  };
}

// /tally message:<messageId> [channel:<channelId>]
function handleTally(interaction: DiscordInteraction, cfg: AdapterConfig): HandledInteraction {
  const o = opts(interaction);
  const messageId = o.message;
  const channelId = o.channel || cfg.voteChannelId || interaction.channel_id || "";

  if (!cfg.discord || !cfg.guildId || !cfg.roleMap) {
    return { response: reply("Vote tallying isn't configured yet (bot token / guild / role map not set).") };
  }
  if (!messageId) {
    return { response: reply("Usage: `/tally message:<vote message id>`.") };
  }

  return {
    response: { type: InteractionResponseType.DEFERRED_CHANNEL_MESSAGE_WITH_SOURCE },
    deferred: async () => {
      const discord = cfg.discord!;
      const result = await collectAndTally(channelId, messageId, {
        discord,
        guildId: cfg.guildId!,
        roleMap: cfg.roleMap!,
        nowMs: cfg.nowMs,
      });
      if ("error" in result) {
        await editOriginal(discord, interaction, `Couldn't tally: ${result.error}`);
        return;
      }
      // Post the outcome publicly in the vote channel (the audit record), and
      // confirm to the caller.
      await discord.createMessage(channelId, {
        content: `🗳️ **Vote result — ${result.proposal.title}**\n${result.outcomeSummary}`,
      });
      await editOriginal(discord, interaction, `Tallied. Decision: **${result.decision}**. Posted the result in the channel.`);
    },
  };
}

async function editOriginal(discord: DiscordApiClient, interaction: DiscordInteraction, content: string): Promise<void> {
  if (!interaction.application_id || !interaction.token) return;
  try {
    await discord.editOriginalInteractionResponse(interaction.application_id, interaction.token, { content });
  } catch {
    /* the deferred edit is best-effort; the public post is the real record */
  }
}

function reply(content: string): DiscordResponse {
  return { type: InteractionResponseType.CHANNEL_MESSAGE_WITH_SOURCE, data: { content, flags: EPHEMERAL } };
}
