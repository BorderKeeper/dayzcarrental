// verifyButton.test.ts — C-04. Run via run.sh.
//
// #verify said "React with ✅ below" and no ✅ was ever seeded, so the single
// door into the server had nothing to press.
//
// The important part is WHY the obvious fix was wrong. Seeding the reaction
// would not have worked: this bot is a serverless interactions webhook, and
// Discord delivers message reactions as GATEWAY events which never reach it.
// Newcomers would have clicked and nothing would have happened — a silent
// failure, strictly worse than a visible one. A button arrives as a
// MESSAGE_COMPONENT interaction, which this endpoint does receive.

import { test } from "node:test";
import assert from "node:assert/strict";

import {
  handleInteraction,
  InteractionType,
  InteractionResponseType,
  VERIFY_BUTTON_ID,
  verifyMessage,
} from "../discordAdapter";
import type { Member } from "../types";

const VERIFIED_ROLE = "123456789012345678";
const OTHER_ROLE = "223456789012345678";
const ROLE_MAP = { [VERIFIED_ROLE]: "verified" as const, [OTHER_ROLE]: "moderator" as const };

// Records the role grant and the reply the presser actually sees.
function stub(opts: { grantFails?: number } = {}) {
  const granted: { userId: string; roleId: string }[] = [];
  const said: string[] = [];
  const discord = {
    addGuildMemberRole: async (_g: string, userId: string, roleId: string) => {
      if (opts.grantFails) throw new Error(`Discord add role failed ${opts.grantFails}: nope`);
      granted.push({ userId, roleId });
    },
    editOriginalInteractionResponse: async (_a: string, _t: string, body: { content: string }) => {
      said.push(body.content);
    },
    createMessage: async () => ({ id: "m", channel_id: "c" }),
  } as any;
  return { discord, granted, said };
}

function press(userId: string, roleIds: string[] = [], customId = VERIFY_BUTTON_ID) {
  return {
    type: InteractionType.MESSAGE_COMPONENT,
    application_id: "app1",
    token: "itok",
    channel_id: "c1",
    data: { custom_id: customId },
    member: { user: { id: userId, username: "newcomer" }, roles: roleIds },
  };
}

function cfg(discord: any, extra: Record<string, unknown> = {}) {
  return {
    discord,
    guildId: "g1",
    roleMap: ROLE_MAP,
    nowMs: 1_700_000_000_000,
    roster: new Map<string, Member>(),
    ...extra,
  };
}

// ---------------------------------------------------------------------------
// The message itself
// ---------------------------------------------------------------------------
test("C-04: the posted message carries a real button, not an instruction to react", () => {
  const msg = verifyMessage();
  const row = msg.components[0] as any;
  const button = row.components[0];
  assert.equal(row.type, 1, "action row");
  assert.equal(button.type, 2, "button");
  // The custom_id is what routes the press back to the handler; if these ever
  // disagree the button becomes decorative and the door shuts again.
  assert.equal(button.custom_id, VERIFY_BUTTON_ID);
  assert.doesNotMatch(msg.content, /react with/i, "telling people to react is the bug being fixed");
});

test("C-04: the message links the rules channel when given its id", () => {
  assert.match(verifyMessage("999").content, /<#999>/);
  assert.match(verifyMessage().content, /#rules/);
});

// ---------------------------------------------------------------------------
// Pressing it
// ---------------------------------------------------------------------------
test("C-04: pressing the button grants the verified role", async () => {
  const s = stub();
  const { response, deferred } = handleInteraction(press("900000000000000001"), cfg(s.discord));
  assert.equal(response.type, InteractionResponseType.DEFERRED_CHANNEL_MESSAGE_WITH_SOURCE);
  await deferred!();

  assert.deepEqual(s.granted, [{ userId: "900000000000000001", roleId: VERIFIED_ROLE }]);
  assert.match(s.said.join("\n"), /verified/i);
});

test("C-04: the role id comes from the role map, so it can't grant something else", async () => {
  const s = stub();
  const { deferred } = handleInteraction(press("900000000000000001"), cfg(s.discord));
  await deferred!();
  assert.equal(s.granted[0].roleId, VERIFIED_ROLE, "must be the role mapped to 'verified', not any other");
});

test("C-04: an already-verified member is told so, without a pointless grant", () => {
  const s = stub();
  const { response, deferred } = handleInteraction(press("900000000000000001", [VERIFIED_ROLE]), cfg(s.discord));
  assert.equal(deferred, undefined);
  assert.match(response.data!.content!, /already verified/i);
  assert.deepEqual(s.granted, []);
});

test("C-04: with no role mapped to 'verified', it says so instead of failing silently", () => {
  const s = stub();
  const { response, deferred } = handleInteraction(press("900000000000000001"), cfg(s.discord, { roleMap: {} }));
  assert.equal(deferred, undefined);
  assert.match(response.data!.content!, /no role is mapped to `verified`/i);
  // Blaming the newcomer for our misconfiguration is the C-08 mistake.
  assert.match(response.data!.content!, /on us, not you/i);
});

test("C-04: a 403 names role ORDERING, which Discord's own error never does", async () => {
  const s = stub({ grantFails: 403 });
  const { deferred } = handleInteraction(press("900000000000000001"), cfg(s.discord));
  await assert.doesNotReject(deferred!());
  const said = s.said.join("\n");
  assert.match(said, /a mod can add it by hand/i);
  assert.match(said, /above @Verified/i, "the first thing to check, and the least obvious");
});

test("C-04: an unrelated failure still ends in a reply, not a hung spinner", async () => {
  const s = stub({ grantFails: 500 });
  const { deferred } = handleInteraction(press("900000000000000001"), cfg(s.discord));
  await assert.doesNotReject(deferred!());
  assert.ok(s.said.length > 0, "the presser must always hear back");
});

test("C-04: an unknown component id is refused rather than silently ignored", () => {
  const s = stub();
  const { response } = handleInteraction(press("900000000000000001", [], "something-else"), cfg(s.discord));
  assert.match(response.data!.content!, /isn't wired to anything/i);
});

test("C-04: with the bot unconfigured, the presser gets a human answer", () => {
  const { response } = handleInteraction(press("900000000000000001"), {
    nowMs: 1,
    roster: new Map<string, Member>(),
  });
  assert.match(response.data!.content!, /ask a mod/i);
});
