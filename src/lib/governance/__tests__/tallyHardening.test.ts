// tallyHardening.test.ts — regression cover for the three ways /tally used to
// fail badly. Run via run.sh.
//
//   E-01  anyone could re-run /tally on someone else's vote, and each run fired
//         a fresh AI build against the real donation balance.
//   E-02  an unparseable or wrong role map silently produced an empty map, so
//         every tally reported "No quorum (✅0/❌0/🤷0)" no matter how people
//         voted — indistinguishable from apathy, and nothing was logged.
//   E-07  /tally on a nonexistent message threw inside the deferred handler, so
//         Discord showed a "thinking…" spinner forever.

import { test } from "node:test";
import assert from "node:assert/strict";

import { parseRoleMap } from "../roleMap";
import { tallyVotes } from "../vote";
import { GovernanceEngine } from "../engine";
import { InMemoryOnceStore } from "../onceStore";
import { handleInteraction, InteractionType, InteractionResponseType } from "../discordAdapter";
import { proposalEmbed, type RoleMap } from "../voteTally";
import { DiscordApiClient, type DiscordMessage } from "../discordApi";
import type { FetchLike } from "../aiClient";
import type { Member, Proposal, Vote } from "../types";

// ---------------------------------------------------------------------------
// E-02a — the role map names its own failures
// ---------------------------------------------------------------------------
test("roleMap: an unset map is a reported problem, not a silent empty map", () => {
  for (const raw of [undefined, "", "   "]) {
    const { map, problems } = parseRoleMap(raw);
    assert.deepEqual(map, {});
    assert.ok(problems.length > 0, `expected a problem for ${JSON.stringify(raw)}`);
    assert.match(problems[0], /not set/i);
  }
});

test("roleMap: malformed JSON is reported, not swallowed", () => {
  const { map, problems } = parseRoleMap('{"123456789012345678": "verified"');
  assert.deepEqual(map, {});
  assert.match(problems.join(" "), /not valid JSON/i);
});

test("roleMap: a capitalised role name is caught and corrected by name", () => {
  // The exact typo that produced a byte-identical "no quorum" reply before.
  const { map, problems } = parseRoleMap('{"123456789012345678": "Verified"}');
  assert.deepEqual(map, {});
  assert.match(problems.join(" "), /Did you mean 'verified'/);
});

test("roleMap: a non-snowflake role id can never match, and says so", () => {
  const { map, problems } = parseRoleMap('{"R_VERIFIED": "verified"}');
  assert.deepEqual(map, {});
  assert.match(problems.join(" "), /not a Discord role id/i);
});

test("roleMap: a map with no 'verified' role is flagged — no ballot could count", () => {
  const { map, problems } = parseRoleMap('{"123456789012345678": "runner"}');
  assert.deepEqual(map, { "123456789012345678": "runner" });
  assert.match(problems.join(" "), /No role is mapped to 'verified'/);
});

test("roleMap: a correct map parses clean with no problems", () => {
  const { map, problems } = parseRoleMap('{"123456789012345678":"verified","223456789012345678":"moderator"}');
  assert.deepEqual(map, { "123456789012345678": "verified", "223456789012345678": "moderator" });
  assert.deepEqual(problems, []);
});

// ---------------------------------------------------------------------------
// E-02b — excluded ballots are counted and explained
// ---------------------------------------------------------------------------
test("tally: eight unverified ✅ votes report as excluded, not as an empty room", () => {
  const members = new Map<string, Member>();
  const votes: Vote[] = [];
  for (let i = 0; i < 8; i++) {
    const id = `u${i}`;
    // Long-standing accounts, but no @Verified role — exactly what a broken
    // role map looks like from the engine's side.
    members.set(id, { id, handle: id, roles: ["everyone"], accountAgeDays: 400 });
    votes.push({ memberId: id, ballot: "approve" });
  }

  const t = tallyVotes(votes, members);
  assert.equal(t.approve, 0);
  assert.equal(t.excluded.total, 8);
  assert.equal(t.excluded.unverified, 8);
  assert.equal(t.excluded.tooYoung, 0);

  const outcome = new GovernanceEngine(members).run(
    { id: "p1", authorId: "u0", actionKind: "policy-note", title: "A note", rawBody: "Harmless." },
    votes,
  );
  assert.equal(outcome.decision, "no-quorum");
  // The whole point: the summary must NOT be byte-identical to a real empty vote.
  assert.match(outcome.summary, /8 ballot\(s\) were not counted/);
  assert.match(outcome.summary, /not @Verified/);
  assert.match(outcome.summary, /DISCORD_ROLE_MAP is probably wrong/);
});

// F-02 — on a young server quorum may be unreachable, so saying how far short
// the vote fell is the difference between "keep going" and "this is hopeless".
test("F-02: a no-quorum result says how many more ballots are needed", () => {
  const members = new Map<string, Member>([
    ["v1", { id: "v1", handle: "v1", roles: ["everyone", "verified"], accountAgeDays: 400 }],
  ]);
  const outcome = new GovernanceEngine(members).run(
    { id: "p3", authorId: "v1", actionKind: "policy-note", title: "A note", rawBody: "Harmless." },
    [{ memberId: "v1", ballot: "approve" }],
  );
  assert.equal(outcome.decision, "no-quorum");
  assert.match(outcome.summary, /Needs 3 eligible/);
  assert.match(outcome.summary, /got 1/);
  assert.match(outcome.summary, /2 more to go/);
  // Abstains not counting toward quorum is a real surprise; name it.
  assert.match(outcome.summary, /doesn't count toward quorum/);
});

test("tally: one member reacting several times is one excluded person, not three", () => {
  const members = new Map<string, Member>([
    ["u1", { id: "u1", handle: "u1", roles: ["everyone"], accountAgeDays: 400 }],
  ]);
  const t = tallyVotes(
    [
      { memberId: "u1", ballot: "approve" },
      { memberId: "u1", ballot: "reject" },
      { memberId: "u1", ballot: "abstain" },
    ],
    members,
  );
  assert.equal(t.excluded.total, 1);
});

test("tally: a clean vote reports no exclusions and no extra noise", () => {
  const members = new Map<string, Member>();
  const votes: Vote[] = [];
  for (let i = 0; i < 3; i++) {
    const id = `v${i}`;
    members.set(id, { id, handle: id, roles: ["everyone", "verified"], accountAgeDays: 400 });
    votes.push({ memberId: id, ballot: "approve" });
  }
  const outcome = new GovernanceEngine(members).run(
    { id: "p2", authorId: "v0", actionKind: "policy-note", title: "A note", rawBody: "Harmless." },
    votes,
  );
  assert.equal(outcome.decision, "approved");
  assert.doesNotMatch(outcome.summary, /not counted/);
});

// ---------------------------------------------------------------------------
// E-01a — only the author or a mod may tally
// ---------------------------------------------------------------------------
const VERIFIED_ROLE = "123456789012345678";
const MOD_ROLE = "223456789012345678";
const ROLE_MAP: RoleMap = { [VERIFIED_ROLE]: "verified", [MOD_ROLE]: "moderator" };

const PROPOSAL: Proposal = {
  id: "discord-900000000000000001-add-a-server",
  authorId: "900000000000000001",
  actionKind: "policy-note",
  title: "A note",
  rawBody: "Harmless.",
};

const NOW = 1_700_000_000_000;
const DISCORD_EPOCH_MS = 1_420_070_400_000;

// A snowflake for an account created `days` ago, so it clears the 7-day gate.
let SEQ = 0;
function oldAccount(days: number): string {
  const ms = NOW - days * 86_400_000;
  return (((BigInt(ms) - BigInt(DISCORD_EPOCH_MS)) << BigInt(22)) | BigInt(SEQ++)).toString();
}

// Three long-standing verified approvers — enough to clear quorum (3) so the
// vote genuinely resolves to "approved" and the build path is exercised.
const APPROVERS = [oldAccount(300), oldAccount(300), oldAccount(300)];

// Stub Discord that serves the vote message and records what got posted.
function stubDiscord(
  posted: string[],
  opts: { messageThrows?: boolean; approvers?: string[] } = {},
): DiscordApiClient {
  const msg: DiscordMessage = { id: "m1", channel_id: "c1", content: "", embeds: [proposalEmbed(PROPOSAL)] };
  const approvers = opts.approvers ?? [];
  const fetchImpl: FetchLike = async (url: string, init?: any) => {
    const path = new URL(url).pathname;
    const ok = (body: any) => ({ ok: true, status: 200, json: async () => body, text: async () => "" });

    if (/\/channels\/[^/]+\/messages\/[^/]+$/.test(path) && (!init || init.method === "GET")) {
      if (opts.messageThrows) return { ok: false, status: 404, json: async () => ({}), text: async () => "Unknown Message" };
      return ok(msg);
    }
    const react = path.match(/\/messages\/[^/]+\/reactions\/([^/]+)$/);
    if (react) {
      return ok(decodeURIComponent(react[1]) === "✅" ? approvers.map((id) => ({ id, username: id })) : []);
    }
    if (/\/guilds\/[^/]+\/members\//.test(path)) {
      const uid = path.split("/").pop()!;
      return ok({ roles: approvers.includes(uid) ? [VERIFIED_ROLE] : [] });
    }
    if (path.endsWith("/messages") && init?.method === "POST") {
      posted.push(String(JSON.parse(init.body ?? "{}").content ?? ""));
      return ok({ id: "posted", channel_id: "c1" });
    }
    // The deferred follow-up edit (what the caller actually sees).
    if (path.includes("/webhooks/")) {
      posted.push("EDIT:" + String(JSON.parse(init.body ?? "{}").content ?? ""));
      return ok({});
    }
    return { ok: false, status: 404, json: async () => ({}), text: async () => "not stubbed: " + path };
  };
  return new DiscordApiClient({ token: "test", fetchImpl });
}

function tallyInteraction(userId: string, roleIds: string[] = []) {
  return {
    type: InteractionType.APPLICATION_COMMAND,
    application_id: "app1",
    token: "itok",
    channel_id: "c1",
    data: { name: "tally", options: [{ name: "message", value: "m1" }] },
    member: { user: { id: userId, username: "u" }, roles: roleIds },
  };
}

function cfg(discord: DiscordApiClient, extra: Record<string, unknown> = {}) {
  return {
    discord,
    guildId: "g1",
    roleMap: ROLE_MAP,
    voteChannelId: "c1",
    nowMs: 1_700_000_000_000,
    roster: new Map<string, Member>(),
    roleMapProblems: [] as string[],
    ...extra,
  };
}

test("tally: a stranger who didn't write the proposal is refused", async () => {
  const posted: string[] = [];
  const { deferred } = handleInteraction(tallyInteraction("999999999999999999"), cfg(stubDiscord(posted)));
  await deferred!();
  const all = posted.join("\n");
  assert.match(all, /only the person who opened this proposal/i);
  // Crucially: no public outcome post, so no build could have been dispatched.
  assert.ok(!posted.some((p) => !p.startsWith("EDIT:")), "a refused tally must not post publicly");
});

test("tally: the proposal's own author may tally it", async () => {
  const posted: string[] = [];
  const { deferred } = handleInteraction(tallyInteraction(PROPOSAL.authorId), cfg(stubDiscord(posted)));
  await deferred!();
  assert.doesNotMatch(posted.join("\n"), /only the person who opened/i);
  assert.ok(posted.some((p) => p.includes("Vote result")), "expected a public outcome post");
});

test("tally: a moderator may tally anyone's proposal", async () => {
  const posted: string[] = [];
  const { deferred } = handleInteraction(
    tallyInteraction("999999999999999999", [MOD_ROLE]),
    cfg(stubDiscord(posted)),
  );
  await deferred!();
  assert.doesNotMatch(posted.join("\n"), /only the person who opened/i);
  assert.ok(posted.some((p) => p.includes("Vote result")));
});

test("tally: a broken role map refuses up front instead of reporting a false 'no quorum'", () => {
  const posted: string[] = [];
  const { response, deferred } = handleInteraction(
    tallyInteraction(PROPOSAL.authorId),
    cfg(stubDiscord(posted), { roleMapProblems: ["DISCORD_ROLE_MAP is not valid JSON: bang."] }),
  );
  assert.equal(response.type, InteractionResponseType.CHANNEL_MESSAGE_WITH_SOURCE);
  assert.equal(deferred, undefined, "must not run a tally it knows is meaningless");
  assert.match(response.data!.content!, /role map is misconfigured/i);
  assert.match(response.data!.content!, /not valid JSON/);
});

// ---------------------------------------------------------------------------
// E-01b — the build dispatch is claimed once per proposal
// ---------------------------------------------------------------------------
test("once: only the first claim wins; repeats are no-ops", async () => {
  const store = new InMemoryOnceStore();
  assert.equal(await store.claim("ai-build:p1"), true);
  assert.equal(await store.claim("ai-build:p1"), false);
  assert.equal(await store.claim("ai-build:p1"), false);
  // A different proposal is unaffected.
  assert.equal(await store.claim("ai-build:p2"), true);
});

test("tally: four runs on the same approved vote dispatch exactly one build", async () => {
  const store = new InMemoryOnceStore();
  let dispatches = 0;
  const onApproved = async (p: Proposal) => {
    if (!(await store.claim(`ai-build:${p.id}`))) return "already building";
    dispatches++;
    return "building";
  };

  // This is E-01 as reported: the same vote tallied over and over. Three
  // verified approvers clear quorum, so every run really does reach "approved".
  const decisions: string[] = [];
  for (let i = 0; i < 4; i++) {
    const posted: string[] = [];
    const { deferred } = handleInteraction(
      tallyInteraction(PROPOSAL.authorId),
      cfg(stubDiscord(posted, { approvers: APPROVERS }), { onApproved }),
    );
    await deferred!();
    decisions.push(posted.join("\n"));
  }

  assert.ok(
    decisions.every((d) => /Approved/.test(d)),
    "fixture should approve on every run, else this proves nothing",
  );
  assert.equal(dispatches, 1, "four tallies of one proposal must mint exactly one build");
  // Runs 2-4 should say so rather than silently doing nothing.
  assert.match(decisions[1], /already building/);
});

// ---------------------------------------------------------------------------
// E-07 — a bad message id must not hang the caller forever
// ---------------------------------------------------------------------------
test("tally: a nonexistent message ends in a real reply, not a permanent spinner", async () => {
  const posted: string[] = [];
  const { deferred } = handleInteraction(
    tallyInteraction(PROPOSAL.authorId),
    cfg(stubDiscord(posted, { messageThrows: true })),
  );
  // Must not reject — an escaping throw is exactly what left the spinner up.
  await assert.doesNotReject(deferred!());
  assert.ok(
    posted.some((p) => p.startsWith("EDIT:") && /Couldn't tally/i.test(p)),
    `expected an error reply to the caller, got: ${JSON.stringify(posted)}`,
  );
});
