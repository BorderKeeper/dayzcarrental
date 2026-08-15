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

import type { AuditEntry, Member, Proposal, Role } from "./types";
import type { AuditLog } from "./audit";
import { GovernanceEngine } from "./engine";
import { screenProposal } from "./screen";
import { ACTION_CATALOG } from "./config";
import { DiscordApiClient, VOTE_EMOJI } from "./discordApi";
import { proposalEmbed, collectAndTally, type RoleMap } from "./voteTally";
import type { RunnerOps, RunnerActionResult, SafehouseOp } from "./runnerOps";
import { SAFEHOUSE_OPS } from "./commands";

// Shared with the registration script, so what Discord offers in the client and
// what this handler accepts cannot drift apart.
const VALID_SAFEHOUSE_OPS: readonly SafehouseOp[] = SAFEHOUSE_OPS;

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
    // Present on MESSAGE_COMPONENT interactions (button clicks).
    custom_id?: string;
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
  // Where the audit trail goes (#governance-log). Absent → entries are still
  // produced, just not published, which is the pre-existing behaviour.
  governanceLogChannelId?: string;
  // Builds a RunnerOps bound to one server's main-runner assignments, loaded at
  // request time. Injected so this module does no I/O. `assigned` reports
  // whether ANYONE leads that server, which is what separates "you're not the
  // lead" from "nobody is, so this store was never seeded".
  runnerOpsFor?: (
    serverId: string,
    requester: Member,
  ) => Promise<{ ops: RunnerOps; assigned: boolean; audit: AuditLog }>;
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
  if (interaction.type === InteractionType.MESSAGE_COMPONENT) {
    if (interaction.data?.custom_id === VERIFY_BUTTON_ID) return handleVerify(interaction, cfg);
    return { response: reply("That control isn't wired to anything.") };
  }
  if (interaction.type === InteractionType.APPLICATION_COMMAND) {
    switch (interaction.data?.name) {
      case "propose":
        return handlePropose(interaction, cfg);
      case "tally":
        return handleTally(interaction, cfg);
      case "safehouse":
        return handleSafehouse(interaction, cfg);
      case "help":
        return { response: reply(helpText()) };
      default:
        return {
          response: reply(
            `Unknown command '${interaction.data?.name ?? ""}'.\n\n${helpText()}`,
          ),
        };
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
    const why = screen.reasons.map((r) => `> ${r.detail}`).join("\n");
    // This is often someone's FIRST interaction with the bot, and the check is
    // a keyword screen that can be wrong. Say what tripped, say it's automated,
    // and give them somewhere to go — the old wording just told a well-meaning
    // newcomer they were "dead on arrival" and left them there.
    return {
      response: reply(
        `**That proposal didn't pass the automated compliance check**, so it hasn't gone to a vote yet.\n` +
          `${why}\n\n` +
          `This is a keyword check, and it does get things wrong. If it's misread you, ` +
          `reword the proposal and try again, or ask a mod in **#contributor-hub** and they'll sort it out.`,
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
        await postAudit(discord, cfg.governanceLogChannelId, `Audit — ${result.proposal.title}`, result.audit);
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

// The #verify button.
//
// #verify said "React with ✅ below" and no ✅ was ever seeded, so the single
// door into the server had nothing to click (C-04). Seeding the reaction would
// NOT have fixed it: this bot is a serverless interactions webhook, and Discord
// delivers message reactions as GATEWAY events, which never reach it. People
// would have clicked and nothing would have happened — a silent failure, worse
// than a visible one.
//
// A button is the fix that matches the architecture: Discord delivers a button
// press as a MESSAGE_COMPONENT interaction, straight to this endpoint.
export const VERIFY_BUTTON_ID = "dcr:verify";

// The message + button that scripts/post-verify.mjs publishes. Defined here so
// the custom_id can't drift from the handler that answers it.
export function verifyMessage(rulesChannelId?: string): {
  content: string;
  components: unknown[];
} {
  const rules = rulesChannelId ? `<#${rulesChannelId}>` : "#rules";
  return {
    content:
      `**Get verified**\n\n` +
      `Read ${rules}, then press the button below to accept them and unlock the rest of the server.\n\n` +
      `_Runner and Maintainer roles are granted by hand after a quick chat — ask in #contributor-hub once you can see it._`,
    components: [
      {
        type: 1, // action row
        components: [
          { type: 2, style: 3, label: "✅  I accept the rules", custom_id: VERIFY_BUTTON_ID },
        ],
      },
    ],
  };
}

function handleVerify(interaction: DiscordInteraction, cfg: AdapterConfig): HandledInteraction {
  const userId = callerId(interaction);
  if (!cfg.discord || !cfg.guildId) {
    return { response: reply("Verification isn't configured yet — ask a mod to sort you out.") };
  }

  // The @Verified role id comes from the role map, which is already parsed and
  // validated (roleMap.ts). No second env var to set, and no way for the button
  // to grant a role the governance engine doesn't recognise as verified.
  const verifiedRoleId = Object.entries(cfg.roleMap ?? {}).find(([, role]) => role === "verified")?.[0];
  if (!verifiedRoleId) {
    return {
      response: reply(
        "**Can't verify you right now** — no role is mapped to `verified` in this server's config. " +
          "That's on us, not you. Ping a mod and they'll fix it.",
      ),
    };
  }

  // Already verified? Say so plainly rather than pretending to do work.
  if (callerRoles(interaction, cfg.roleMap).includes("verified")) {
    return { response: reply("You're already verified — the community channels should be visible.") };
  }

  return {
    response: { type: InteractionResponseType.DEFERRED_CHANNEL_MESSAGE_WITH_SOURCE, data: { flags: EPHEMERAL } },
    deferred: async () => {
      const discord = cfg.discord!;
      try {
        await discord.addGuildMemberRole(cfg.guildId!, userId, verifiedRoleId);
        await editOriginal(
          discord,
          interaction,
          "✅ **You're verified.** The community channels are open — " +
            "head to #rent-a-car if you're after a car, or #contributor-hub if you'd like to help run things.",
        );
      } catch (e) {
        const msg = (e as Error)?.message ?? "";
        // A 403 here is almost always the bot's role sitting BELOW @Verified in
        // the guild's role list. Discord's error doesn't mention ordering, and
        // it is the first thing to check.
        const hint = /403/.test(msg)
          ? " (For a mod: the bot needs Manage Roles, and its own role must sit above @Verified in Server Settings → Roles.)"
          : "";
        await editOriginal(
          discord,
          interaction,
          `Couldn't give you the role just now — a mod can add it by hand.${hint}`,
        );
        console.error("[verify] could not grant the verified role:", msg);
      }
    },
  };
}

// /safehouse op:<add|remove|stage> server:<serverId> name:<safehouse name>
//
// The runner-ops side channel, finally reachable. RunnerOps has existed and
// been tested since the engine was written, but nothing ever CONSTRUCTED it
// outside test files, so per-server authority did nothing: a main runner acting
// on her own server got back "proposed, awaiting main-runner" — she was waiting
// on herself, and every routine safehouse change escalated to the founder,
// which is exactly what this side channel was built to prevent (E-03).
//
// Assignments come from the fleet store at request time (injected by the route,
// so this module stays free of I/O and testable).
function handleSafehouse(interaction: DiscordInteraction, cfg: AdapterConfig): HandledInteraction {
  const o = opts(interaction);
  const op = (o.op ?? "").toLowerCase();
  const serverId = o.server ?? "";
  const name = o.name ?? "";

  if (!VALID_SAFEHOUSE_OPS.includes(op as SafehouseOp)) {
    return { response: reply(`\`op\` must be one of: ${VALID_SAFEHOUSE_OPS.join(", ")}.`) };
  }
  if (!serverId || !name) {
    return { response: reply("Usage: `/safehouse op:<add|remove|stage> server:<server id> name:<safehouse>`.") };
  }
  if (!cfg.runnerOpsFor || !cfg.discord) {
    return { response: reply("Runner-ops isn't configured yet (bot token / fleet store not set).") };
  }

  const user = interaction.member?.user ?? interaction.user ?? {};
  const requesterId = user.id ?? "";
  const member: Member = {
    id: requesterId,
    handle: user.username ?? requesterId,
    roles: callerRoles(interaction, cfg.roleMap),
    // Age gates the vote flow, not runner-ops: runner roles are granted by a
    // human after vetting, which is a stronger check than account age.
    accountAgeDays: Number.MAX_SAFE_INTEGER,
  };

  return {
    response: { type: InteractionResponseType.DEFERRED_CHANNEL_MESSAGE_WITH_SOURCE, data: { flags: EPHEMERAL } },
    deferred: async () => {
      try {
        const { ops, assigned, audit } = await cfg.runnerOpsFor!(serverId, member);
        const result = ops.submit({ requesterId, serverId, op: op as SafehouseOp, safehouseName: name });

        let note = "";
        if (result.status === "proposed" && !assigned) {
          // Distinguish "you aren't the lead here" from "nobody is" — the
          // second is a store that was never seeded, and without this the
          // runner has no way to tell which wall they hit.
          note =
            `\n\n_No main runner is assigned to \`${serverId}\` yet, so every change there needs the founder. ` +
            `If that's you, ask them to add you._`;
        }
        await editOriginal(cfg.discord!, interaction, formatRunnerResult(result) + note);

        // runnerOps promises changes are "announced + logged". Post applied
        // changes publicly so the server can see who changed what.
        if (result.status === "applied" && cfg.discord && cfg.voteChannelId) {
          await cfg.discord.createMessage(cfg.voteChannelId, { content: `🏠 **Runner-ops** — ${result.detail}` });
        }
        // Runner-ops decisions belong in the same trail as governance ones —
        // "who changed which safehouse" is exactly what GOVERNANCE.md promises.
        await postAudit(cfg.discord!, cfg.governanceLogChannelId, `Runner-ops — ${serverId}`, audit.all());
      } catch (e) {
        await editOriginal(
          cfg.discord!,
          interaction,
          `Couldn't apply that: ${(e as Error)?.message ?? "unexpected error"}.`,
        );
      }
    },
  };
}

// F-04: without this, the entire community-input mechanism was invisible unless
// somebody happened to tell you it existed. Built from ACTION_CATALOG so the
// list of proposable kinds can't drift from what the engine actually accepts.
function helpText(): string {
  const kinds = ACTION_CATALOG.filter((a) => a.enabled).map((a) => `\`${a.kind}\``).join(", ");
  return [
    "**How to get something changed here**",
    "",
    "`/propose kind:<type> title:<short title> body:<what and why>`",
    `  Opens a proposal for the community to vote on. Kinds: ${kinds}.`,
    "  It's screened against the compliance rules first — that check is automated and",
    "  can be wrong, so if it misreads you, reword it or ask a mod.",
    "",
    "`/tally message:<vote message id>`",
    "  Counts the ✅/❌/🤷 reactions and posts the outcome. Only the person who",
    "  opened the proposal, or a mod, can run it.",
    "",
    "`/safehouse op:<add|remove|stage> server:<server id> name:<safehouse>`",
    "  Routine runner work — no vote needed. If you're the main runner for that",
    "  server it applies straight away; otherwise it's recorded for one to approve.",
    "",
    "Votes need a quorum of eligible voters, and eligibility means @Verified plus a",
    "minimum account age. If a tally says nobody voted but you know people did, say",
    "so — that's usually a misconfiguration, not apathy.",
  ].join("\n");
}

function formatRunnerResult(r: RunnerActionResult): string {
  switch (r.status) {
    case "applied":
      return `✅ **Applied.** ${r.detail}. It'll land as a runner-ops change for the founder to merge.`;
    case "proposed":
      return `📋 **Proposed.** ${r.detail}. A main runner for this server (or the founder) applies it.`;
    case "denied":
      return `🚫 **Denied.** ${r.detail}`;
  }
}

// Publish an audit trail to #governance-log.
//
// The engine has always written these entries; nothing ever read them, and they
// died with the engine instance. GOVERNANCE.md promises the community can see
// "proposal → tally → founder action" after the fact, and #governance-log was
// fed by nothing (E-06). This is the feed.
//
// Best-effort by design: the decision has already been posted publicly and is
// the real record, so a logging failure must never turn a successful tally into
// an error the caller sees.
async function postAudit(
  discord: DiscordApiClient,
  channelId: string | undefined,
  heading: string,
  entries: AuditEntry[],
): Promise<void> {
  if (!channelId || entries.length === 0) return;
  const lines = entries.map((e) => {
    const who = e.actorId ? ` · by ${e.actorId}` : "";
    return `\`${String(e.seq).padStart(2, "0")}\` **${e.event}** — ${e.detail}${who}`;
  });
  // Discord hard-caps a message at 2000 chars; trim from the middle rather than
  // dropping the outcome, which is the entry people actually look for.
  let body = lines.join("\n");
  if (body.length > 1800) body = lines.slice(0, 3).join("\n") + "\n…\n" + lines.slice(-3).join("\n");
  try {
    await discord.createMessage(channelId, { content: `📓 **${heading}**\n${body}` });
  } catch {
    /* the public outcome post is the real record; logging is additive */
  }
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
