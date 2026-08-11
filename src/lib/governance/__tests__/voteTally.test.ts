// voteTally.test.ts — verification for the vote-counting flow:
// snowflake account-age, reactor→Member resolution, embed round-trip, and a
// full tally against a STUBBED Discord (no network). Run via run.sh.
//
// The point: real ✅/❌/🤷 reactions now drive the engine, and the same
// eligibility/quorum/threshold rules (GOVERNANCE.md §3) apply — sockpuppets
// and unverified reactors don't count.

import { test } from "node:test";
import assert from "node:assert/strict";

import { snowflakeCreatedAtMs, accountAgeDays, DISCORD_EPOCH_MS } from "../snowflake";
import { DiscordApiClient, type DiscordMessage } from "../discordApi";
import type { FetchLike } from "../aiClient";
import { proposalEmbed, proposalFromMessage, collectAndTally, type RoleMap } from "../voteTally";
import type { Proposal } from "../types";

// A snowflake whose timestamp we control: id = ((ms - EPOCH) << 22) | seq.
// `seq` occupies the low 22 bits (worker/increment in real snowflakes) so two
// accounts created the same millisecond still get distinct IDs — real Discord
// users always differ even when they joined the same day.
let SEQ = 0;
function snowflakeForMs(ms: number, seq = SEQ++): string {
  return (((BigInt(ms) - BigInt(DISCORD_EPOCH_MS)) << BigInt(22)) | BigInt(seq)).toString();
}

// ---------------------------------------------------------------------------
// SNOWFLAKE → ACCOUNT AGE
// ---------------------------------------------------------------------------
test("snowflake: decodes creation time and computes account age in days", () => {
  const createdMs = 1_600_000_000_000; // arbitrary post-epoch instant
  const id = snowflakeForMs(createdMs);
  assert.equal(snowflakeCreatedAtMs(id), createdMs);

  const now = createdMs + 10 * 86_400_000; // 10 days later
  assert.equal(accountAgeDays(id, now), 10);

  // A brand-new account (created "now") is 0 days old → below the 7-day gate.
  assert.equal(accountAgeDays(snowflakeForMs(now), now), 0);
});

// ---------------------------------------------------------------------------
// EMBED ROUND-TRIP (the message-as-store)
// ---------------------------------------------------------------------------
test("embed: a proposal survives encode → message → decode", () => {
  const p: Proposal = {
    id: "discord-u1-add-a-server",
    authorId: "u1",
    actionKind: "server-add",
    title: "Add a server",
    rawBody: "Add Sakhal Frostbite to the list.",
  };
  const embed = proposalEmbed(p);
  const msg: DiscordMessage = { id: "m1", channel_id: "c1", content: "", embeds: [embed] };
  const back = proposalFromMessage(msg);
  assert.ok(back);
  assert.equal(back!.id, p.id);
  assert.equal(back!.actionKind, p.actionKind);
  assert.equal(back!.title, p.title);
  assert.equal(back!.rawBody, p.rawBody);
});

test("embed: a non-proposal message decodes to null", () => {
  const msg: DiscordMessage = { id: "m1", channel_id: "c1", content: "just chatting", embeds: [] };
  assert.equal(proposalFromMessage(msg), null);
});

// ---------------------------------------------------------------------------
// FULL TALLY against a stubbed Discord
// ---------------------------------------------------------------------------
// Build a stub Discord that serves a canned vote message, canned reactor lists
// per emoji, and canned per-user role IDs. No network.
function stubDiscord(opts: {
  message: DiscordMessage;
  reactors: Record<string, { id: string; username?: string; bot?: boolean }[]>; // emoji -> users
  memberRoles: Record<string, string[]>; // userId -> role IDs
}): DiscordApiClient {
  const fetchImpl: FetchLike = async (url: string, init?: any) => {
    const u = new URL(url);
    const path = u.pathname;
    const ok = (body: any) => ({ ok: true, status: 200, json: async () => body, text: async () => "" });

    // GET message
    const msgMatch = path.match(/\/channels\/[^/]+\/messages\/([^/]+)$/);
    if (msgMatch && (!init || init.method === "GET")) return ok(opts.message);

    // GET reactions for an emoji
    const reactMatch = path.match(/\/messages\/[^/]+\/reactions\/([^/]+)$/);
    if (reactMatch) {
      const emoji = decodeURIComponent(reactMatch[1]);
      return ok(opts.reactors[emoji] ?? []);
    }

    // GET guild member
    const memberMatch = path.match(/\/guilds\/[^/]+\/members\/([^/]+)$/);
    if (memberMatch) {
      const uid = memberMatch[1];
      return ok({ roles: opts.memberRoles[uid] ?? [] });
    }

    // POST message (outcome post) — accept
    if (path.endsWith("/messages") && init?.method === "POST") return ok({ id: "posted", channel_id: "c1" });

    return { ok: false, status: 404, json: async () => ({}), text: async () => "not stubbed: " + path };
  };
  return new DiscordApiClient({ token: "test", fetchImpl });
}

test("tally: eligible ✅ votes reach quorum and approve; a sockpuppet ❌ is ignored", async () => {
  const NOW = 1_700_000_000_000;
  const old = (days: number) => snowflakeForMs(NOW - days * 86_400_000);

  // Three verified, old voters approve; one day-old verified sockpuppet rejects.
  const va = old(300), vb = old(300), vc = old(300), sock = snowflakeForMs(NOW - 86_400_000); // 1 day
  const proposal: Proposal = {
    id: "discord-x-add-note",
    authorId: "x",
    actionKind: "policy-note",
    title: "Publish a note",
    rawBody: "A harmless community note.",
  };
  const msg: DiscordMessage = { id: "m1", channel_id: "c1", content: "", embeds: [proposalEmbed(proposal)] };

  const roleMap: RoleMap = { R_VERIFIED: "verified" };
  const discord = stubDiscord({
    message: msg,
    reactors: {
      "✅": [{ id: va, username: "A" }, { id: vb, username: "B" }, { id: vc, username: "C" }],
      "❌": [{ id: sock, username: "Sock" }],
      "🤷": [{ id: "botself", username: "Bot", bot: true }], // bot-seeded, must be ignored
    },
    memberRoles: {
      [va]: ["R_VERIFIED"],
      [vb]: ["R_VERIFIED"],
      [vc]: ["R_VERIFIED"],
      [sock]: ["R_VERIFIED"], // verified but too new → ineligible
    },
  });

  const result = await collectAndTally("c1", "m1", { discord, guildId: "g1", roleMap, nowMs: NOW });
  assert.ok(!("error" in result));
  if ("error" in result) return;
  // 3 eligible ✅, 0 eligible ❌ (sock dropped) → quorum met, approved.
  assert.equal(result.decision, "approved");
  assert.match(result.outcomeSummary, /Approved/);
});

test("tally: unverified reactors don't count → no quorum", async () => {
  const NOW = 1_700_000_000_000;
  const old = (days: number) => snowflakeForMs(NOW - days * 86_400_000);
  const proposal: Proposal = {
    id: "discord-y-note",
    authorId: "y",
    actionKind: "policy-note",
    title: "Another note",
    rawBody: "Fine.",
  };
  const msg: DiscordMessage = { id: "m2", channel_id: "c1", content: "", embeds: [proposalEmbed(proposal)] };
  // Three old accounts approve, but none hold @Verified → all ineligible.
  const discord = stubDiscord({
    message: msg,
    reactors: { "✅": [{ id: old(300) }, { id: old(300) }, { id: old(300) }], "❌": [], "🤷": [] },
    memberRoles: {}, // no roles for anyone
  });
  const result = await collectAndTally("c1", "m2", { discord, guildId: "g1", roleMap: { R_VERIFIED: "verified" }, nowMs: NOW });
  assert.ok(!("error" in result));
  if ("error" in result) return;
  assert.equal(result.decision, "no-quorum");
});

test("tally: reporting on a non-proposal message returns a clear error", async () => {
  const discord = stubDiscord({
    message: { id: "m3", channel_id: "c1", content: "hi", embeds: [] },
    reactors: {},
    memberRoles: {},
  });
  const result = await collectAndTally("c1", "m3", { discord, guildId: "g1", roleMap: {}, nowMs: 1 });
  assert.ok("error" in result);
});
