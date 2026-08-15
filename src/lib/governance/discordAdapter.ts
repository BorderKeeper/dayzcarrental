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

import type { Member, Proposal, Role } from "./types";
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
  // Discord sends the invoking guild member's role IDs inline, so authorising a
  // command needs no extra API round-trip.
  member?: { user?: { id?: string; username?: string }; roles?: string[] };
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
  // Problems found parsing DISCORD_ROLE_MAP. Non-empty means a tally would be
  // meaningless, so /tally reports the misconfiguration instead of running and
  // blaming the community for "no quorum".
  roleMapProblems?: string[];
  // Fired when a /tally resolves to "approved" — the route wires this to the
  // GitHub repository_dispatch that kicks off the AI feature-builder workflow.
  // Returns a short human status line to append to the outcome post. Optional:
  // absent → approvals are reported but no build is triggered.
  onApproved?: (proposal: Proposal) => Promise<string>;
}

function opts(interaction: DiscordInteraction): Record<string, string> {
  const out: Record<string, string> = {};
  for (const o of interaction.data?.options ?? []) out[o.name] = String(o.value);
  return out;
}

// Roles allowed to tally ANY proposal. Everyone else may only tally their own.
const TALLY_ROLES: Role[] = ["founder", "moderator", "maintainer"];

// Map the invoking member's guild role IDs through the role map.
function callerRoles(interaction: DiscordInteraction, roleMap: RoleMap | undefined): Role[] {
  const roles: Role[] = ["everyone"];
  for (const rid of interaction.member?.roles ?? []) {
    const mapped = roleMap?.[rid];
    if (mapped && !roles.includes(mapped)) roles.push(mapped);
  }
  return roles;
}

function callerId(interaction: DiscordInteraction): string {
  return interaction.member?.user?.id ?? interaction.user?.id ?? "";
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
//
// Access control matters here more than anywhere else in the bot: an approved
// tally fires the AI feature-builder, which spends the real donation balance.
// Before this, the handler checked NOTHING about the caller — any stranger
// could re-run it on the same vote and mint a fresh build, PR and public post
// each time. Two independent limits now apply:
//   1. only the proposal's author or a mod/maintainer/founder may tally it, and
//   2. the dispatch itself is claimed once per proposal (see the route), so
//      even an authorised double-run is a no-op.
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
  // A broken role map makes every tally report "no quorum" no matter how people
  // voted. Say that plainly instead of running one and blaming the community.
  if (cfg.roleMapProblems && cfg.roleMapProblems.length > 0) {
    return {
      response: reply(
        "**Can't tally — the server's role map is misconfigured.**\n" +
          "Votes would be counted as zero regardless of how people reacted, so this is refusing " +
          "rather than reporting a false result. Ask the founder to fix `DISCORD_ROLE_MAP`:\n> " +
          cfg.roleMapProblems.join("\n> "),
      ),
    };
  }

  const invoker = callerId(interaction);
  const roles = callerRoles(interaction, cfg.roleMap);
  const privileged = roles.some((r) => TALLY_ROLES.includes(r));

  return {
    response: { type: InteractionResponseType.DEFERRED_CHANNEL_MESSAGE_WITH_SOURCE },
    deferred: async () => {
      const discord = cfg.discord!;
      try {
        const result = await collectAndTally(channelId, messageId, {
          discord,
          guildId: cfg.guildId!,
          roleMap: cfg.roleMap!,
          nowMs: cfg.nowMs,
          // Runs once the proposal is known, before any reactions are read.
          authorize: (proposal) => {
            if (privileged) return null;
            if (invoker && proposal.authorId && invoker === proposal.authorId) return null;
            return (
              "only the person who opened this proposal, or a moderator/maintainer, can tally it. " +
              "Ask in the proposal thread if you think it's ready to count."
            );
          },
        });
        if ("error" in result) {
          await editOriginal(discord, interaction, `Couldn't tally: ${result.error}`);
          return;
        }
        // On approval, kick off the AI feature-builder (if wired). It only ever
        // opens a PR the founder merges — never auto-merges, never deploys.
        let buildLine = "";
        if (result.decision === "approved" && cfg.onApproved) {
          try {
            buildLine = "\n" + (await cfg.onApproved(result.proposal));
          } catch {
            buildLine = "\n⚠️ Approved, but the AI build trigger failed — kick it off manually.";
          }
        }

        // Post the outcome publicly in the vote channel (the audit record), and
        // confirm to the caller.
        await discord.createMessage(channelId, {
          content: `🗳️ **Vote result — ${result.proposal.title}**\n${result.outcomeSummary}${buildLine}`,
        });
        await editOriginal(discord, interaction, `Tallied. Decision: **${result.decision}**. Posted the result in the channel.`);
      } catch (e) {
        // Nothing above may throw past this point. A deferred handler that
        // throws never edits the original response, so Discord leaves the user
        // staring at a "thinking…" spinner forever (a bad message id did
        // exactly that). Always land on a real reply.
        await editOriginal(
          discord,
          interaction,
          `Couldn't tally: ${(e as Error)?.message ?? "unexpected error"}. ` +
            "Check the message id is a vote post in this channel, then try again.",
        );
      }
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
