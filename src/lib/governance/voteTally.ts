// voteTally.ts — collect ✅/❌/🤷 reactions on a proposal's vote message and
// run them through the governance engine.
//
// Design: the Discord message IS the store (serverless — no DB). `/propose`
// posts a public vote message whose embed encodes the proposal; `/tally` reads
// that message back plus its reactions, resolves each reactor into a governance
// Member (account age from the snowflake, roles via the Discord API + a
// server-specific role map), and feeds the ✅/❌/🤷 tallies into the existing
// vote engine. Eligibility, quorum, and threshold are unchanged (GOVERNANCE.md
// §3) — this just supplies real voters instead of an empty list.
//
// Role IDs are per-server, so the role map is injected (from env at the route),
// never hard-coded. The Discord client is injected too, so this is fully
// unit-testable with a stub.

import type { Member, Proposal, Role, Vote } from "./types";
import { GovernanceEngine } from "./engine";
import { accountAgeDays } from "./snowflake";
import { DiscordApiClient, VOTE_EMOJI, type DiscordMessage } from "./discordApi";

// serverRoleId -> governance Role. Only roles that carry governance weight need
// mapping; anything unmapped just isn't granted.
export type RoleMap = Record<string, Role>;

// --- embed <-> proposal (the message-as-store) ----------------------------
// We encode the proposal into an embed with named fields so /tally can read it
// back without a database. `id`/`kind` are machine fields; title/body are human.
export function proposalEmbed(p: Proposal): {
  title: string;
  description: string;
  fields: { name: string; value: string }[];
} {
  return {
    title: `📋 Proposal: ${p.title}`.slice(0, 256),
    description: (p.rawBody || "(no description)").slice(0, 2000),
    fields: [
      { name: "id", value: p.id.slice(0, 1024) },
      { name: "kind", value: p.actionKind.slice(0, 1024) },
      // Recorded so /tally can tell the proposal's author from a passer-by.
      // Without it the reconstructed proposal has no owner and the command has
      // nobody to authorise against.
      { name: "author", value: (p.authorId || "unknown").slice(0, 1024) },
      { name: "vote", value: "React ✅ approve · ❌ reject · 🤷 abstain" },
    ],
  };
}

// Reconstruct the proposal from a vote message's embed. Returns null if the
// message isn't a recognizable vote post (so /tally can report a clear error).
export function proposalFromMessage(msg: DiscordMessage): Proposal | null {
  const embed = msg.embeds?.[0];
  if (!embed) return null;
  const field = (name: string) => embed.fields?.find((f) => f.name === name)?.value;
  const id = field("id");
  const kind = field("kind");
  if (!id || !kind) return null;
  const title = (embed.title ?? "").replace(/^📋 Proposal:\s*/, "");
  return { id, authorId: authorIdFrom(field("author"), id), actionKind: kind, title, rawBody: embed.description ?? "" };
}

// The author comes from the embed's `author` field. Vote posts created before
// that field existed don't carry it — recover the id from the proposal id,
// which handlePropose builds as `discord-<authorId>-<title-slug>`.
function authorIdFrom(authorField: string | undefined, proposalId: string): string {
  if (authorField && authorField !== "unknown") return authorField;
  const m = /^discord-(\d+)-/.exec(proposalId);
  return m ? m[1] : "";
}

// Resolve one reactor into a governance Member: account age from the snowflake,
// roles by mapping their guild role IDs through the role map. Always @everyone
// as a baseline; @verified etc. only if the map grants them.
export async function resolveMember(
  discord: DiscordApiClient,
  guildId: string,
  userId: string,
  handle: string,
  roleMap: RoleMap,
  nowMs: number,
): Promise<Member> {
  let roleIds: string[] = [];
  try {
    roleIds = await discord.getGuildMemberRoleIds(guildId, userId);
  } catch {
    // Not a guild member (or left) → no roles; treated as @everyone.
    roleIds = [];
  }
  const roles: Role[] = ["everyone"];
  for (const rid of roleIds) {
    const mapped = roleMap[rid];
    if (mapped && !roles.includes(mapped)) roles.push(mapped);
  }
  return { id: userId, handle, roles, accountAgeDays: accountAgeDays(userId, nowMs) };
}

export interface TallyDeps {
  discord: DiscordApiClient;
  guildId: string;
  roleMap: RoleMap;
  nowMs: number;
  // Optional gate, called once the proposal is known but BEFORE any reactions
  // are read. Returns a refusal message, or null to proceed. Placed here so an
  // unauthorised caller costs one API read rather than a full tally, a public
  // post, and an AI build dispatch.
  authorize?: (proposal: Proposal) => string | null;
}

export interface TallyResult {
  proposal: Proposal;
  outcomeSummary: string;
  decision: string;
}

// Collect the votes on a posted vote message and run the engine.
//   1. read the message back (embed → proposal),
//   2. for each vote emoji, list reactors (skip bots — the bot seeded them),
//   3. resolve each reactor to a Member; a user reacting with several emoji has
//      their LAST-processed emoji win (mirrors tallyVotes' latest-wins), so we
//      process approve→reject→abstain and let the engine dedupe by memberId,
//   4. run the engine and format the outcome.
export async function collectAndTally(
  channelId: string,
  messageId: string,
  deps: TallyDeps,
): Promise<TallyResult | { error: string }> {
  const msg = await deps.discord.getMessage(channelId, messageId);
  const proposal = proposalFromMessage(msg);
  if (!proposal) {
    return { error: "That message isn't a proposal vote post (no proposal embed found)." };
  }

  const refusal = deps.authorize?.(proposal);
  if (refusal) return { error: refusal };

  const members = new Map<string, Member>();
  const votes: Vote[] = [];

  // Process in a fixed order; tallyVotes keeps the LAST ballot per member, so a
  // member who reacted with multiple emoji resolves to abstain > reject >
  // approve by array order below. That's deliberate: reacting 🤷 alongside a
  // stance reads as "actually, abstain."
  const order: { ballot: Vote["ballot"]; emoji: string }[] = [
    { ballot: "approve", emoji: VOTE_EMOJI.approve },
    { ballot: "reject", emoji: VOTE_EMOJI.reject },
    { ballot: "abstain", emoji: VOTE_EMOJI.abstain },
  ];

  for (const { ballot, emoji } of order) {
    let reactors: import("./discordApi").DiscordUser[];
    try {
      reactors = await deps.discord.getReactionUsers(channelId, messageId, emoji);
    } catch {
      reactors = [];
    }
    for (const u of reactors) {
      if (u.bot) continue; // the bot seeded the emoji; don't count it
      if (!members.has(u.id)) {
        members.set(u.id, await resolveMember(deps.discord, deps.guildId, u.id, u.username ?? u.id, deps.roleMap, deps.nowMs));
      }
      votes.push({ memberId: u.id, ballot });
    }
  }

  const engine = new GovernanceEngine(members);
  const outcome = engine.run(proposal, votes);
  return { proposal, outcomeSummary: outcome.summary, decision: outcome.decision };
}
