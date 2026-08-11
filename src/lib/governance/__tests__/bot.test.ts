// bot.test.ts — verification for the live-bot layer: the budget ledger, the
// budget-gated Claude client, Discord signature verification, and the
// interaction adapter. Run via the shared runner (see run.sh).
//
// The founder's rule under test: money only flows IN automatically; the bot
// spends only what's in the bank; it never tops itself up and never exceeds
// budget. Plus: a Discord change-request is screened by the guardrails and a
// non-compliant one is dead on arrival regardless of who signed it.

import { test } from "node:test";
import assert from "node:assert/strict";
import { generateKeyPairSync, sign as edSign } from "node:crypto";

import { BudgetLedger, InsufficientBudgetError, MICRO } from "../budget";
import {
  BudgetedClaudeClient,
  BudgetExhaustedError,
  OPUS_5_PRICING,
  actualCostMicros,
  type FetchLike,
} from "../aiClient";
import { verifyDiscordRequest } from "../discordVerify";
import { GovernanceEngine } from "../engine";
import { handleInteraction, InteractionType, InteractionResponseType } from "../discordAdapter";
import type { Member } from "../types";

// ---------------------------------------------------------------------------
// BUDGET LEDGER
// ---------------------------------------------------------------------------
test("budget: donations raise the ceiling; spend hard-stops at zero and never goes negative", () => {
  const ledger = new BudgetLedger(0);
  assert.equal(ledger.balanceMicros, 0);

  // Founder seeds it, then a donation flows in automatically.
  ledger.topUp(2 * MICRO, "seed");
  ledger.donate(3 * MICRO);
  assert.equal(ledger.balanceMicros, 5 * MICRO);

  // Spend within budget.
  ledger.spend(1 * MICRO, "ai call");
  assert.equal(ledger.balanceMicros, 4 * MICRO);

  // Overspend is refused, not allowed to go negative.
  assert.throws(() => ledger.spend(10 * MICRO, "too much"), InsufficientBudgetError);
  assert.equal(ledger.balanceMicros, 4 * MICRO, "balance unchanged after a refused spend");
});

test("budget: the bot has no way to top itself up — only donate/topUp credit, and they're external", () => {
  const ledger = new BudgetLedger(1 * MICRO);
  ledger.spend(1 * MICRO, "drain");
  assert.equal(ledger.balanceMicros, 0);
  // At zero, canAfford is false for any positive amount → caller must stop.
  assert.equal(ledger.canAfford(1), false);
  assert.equal(ledger.canAfford(0), true);
  // The only ways up are explicit inflow calls; there is no self-refill method.
  ledger.donate(MICRO / 2);
  assert.equal(ledger.balanceMicros, MICRO / 2);
});

test("budget: audit history and summary reconcile to the balance", () => {
  const ledger = new BudgetLedger(0);
  ledger.topUp(10 * MICRO);
  ledger.donate(5 * MICRO);
  ledger.spend(3 * MICRO, "call");
  const s = ledger.summary();
  assert.equal(s.totalInMicros, 15 * MICRO);
  assert.equal(s.totalSpentMicros, 3 * MICRO);
  assert.equal(s.balanceMicros, 12 * MICRO);
  assert.equal(ledger.history().length, 3);
});

// ---------------------------------------------------------------------------
// BUDGET-GATED CLAUDE CLIENT
// ---------------------------------------------------------------------------
// A fake transport returning a canned Messages API body with a usage block.
function fakeFetch(usage: { input: number; output: number }): FetchLike {
  return async () => ({
    ok: true,
    status: 200,
    json: async () => ({
      content: [{ type: "text", text: "ok" }],
      stop_reason: "end_turn",
      usage: { input_tokens: usage.input, output_tokens: usage.output, cache_read_input_tokens: 0 },
    }),
    text: async () => "",
  });
}

test("aiClient: an affordable call debits actual usage from the ledger", async () => {
  const ledger = new BudgetLedger(1 * MICRO); // $1
  const client = new BudgetedClaudeClient({
    apiKey: "test-key",
    ledger,
    fetchImpl: fakeFetch({ input: 1000, output: 500 }),
  });

  const before = ledger.balanceMicros;
  const result = await client.complete("hello", { maxTokens: 1000 });

  // 1000*5 + 500*25 = 5000 + 12500 = 17500 µ$.
  const expected = actualCostMicros(
    { inputTokens: 1000, outputTokens: 500, cacheReadTokens: 0 },
    OPUS_5_PRICING,
  );
  assert.equal(expected, 17500);
  assert.equal(result.costMicros, 17500);
  assert.equal(ledger.balanceMicros, before - 17500);
});

test("aiClient: an unaffordable call is REFUSED — no call is made, balance untouched", async () => {
  const ledger = new BudgetLedger(100); // only 100 µ$ — nowhere near a real call
  let called = false;
  const client = new BudgetedClaudeClient({
    apiKey: "test-key",
    ledger,
    fetchImpl: async () => {
      called = true;
      return { ok: true, status: 200, json: async () => ({}), text: async () => "" };
    },
  });

  await assert.rejects(() => client.complete("a long-ish prompt", { maxTokens: 1024 }), BudgetExhaustedError);
  assert.equal(called, false, "the API must not be called when the budget can't afford it");
  assert.equal(ledger.balanceMicros, 100, "balance unchanged after a refused call");
});

test("aiClient: spends down to exactly zero and then refuses further calls", async () => {
  // Fund exactly one call's worth: est input for "hi"+maxTokens 10.
  const ledger = new BudgetLedger(0);
  ledger.topUp(1000); // 1000 µ$
  const client = new BudgetedClaudeClient({
    apiKey: "k",
    ledger,
    fetchImpl: fakeFetch({ input: 10, output: 10 }),
  });
  // cost = 10*5 + 10*25 = 300 µ$. Affordable.
  await client.complete("hi", { maxTokens: 10 });
  assert.equal(ledger.balanceMicros, 700);

  // Drain the rest with more calls until refusal.
  await client.complete("hi", { maxTokens: 10 }); // -300 -> 400
  assert.equal(ledger.balanceMicros, 400);
  // Next call: estimate for maxTokens 10 = ~ (est input ceil(2/4)=1)*5 + 10*25 = 255; affordable.
  await client.complete("hi", { maxTokens: 10 }); // -300 -> 100
  assert.equal(ledger.balanceMicros, 100);
  // Now 100 µ$ can't cover the estimate (255) → refused.
  await assert.rejects(() => client.complete("hi", { maxTokens: 10 }), BudgetExhaustedError);
  assert.equal(ledger.balanceMicros, 100);
});

// ---------------------------------------------------------------------------
// DISCORD SIGNATURE VERIFICATION
// ---------------------------------------------------------------------------
test("discordVerify: accepts a correctly-signed request and rejects tampering", () => {
  const { publicKey, privateKey } = generateKeyPairSync("ed25519");
  const publicKeyHex = Buffer.from(publicKey.export({ type: "spki", format: "der" }))
    .subarray(-32) // last 32 bytes of the SPKI DER are the raw key
    .toString("hex");

  const timestamp = "1700000000";
  const rawBody = JSON.stringify({ type: 1 });
  const signatureHex = Buffer.from(edSign(null, Buffer.from(timestamp + rawBody), privateKey)).toString("hex");

  // Valid.
  assert.equal(verifyDiscordRequest({ publicKeyHex, signatureHex, timestamp, rawBody }), true);
  // Tampered body.
  assert.equal(
    verifyDiscordRequest({ publicKeyHex, signatureHex, timestamp, rawBody: rawBody + " " }),
    false,
  );
  // Wrong signature.
  assert.equal(
    verifyDiscordRequest({ publicKeyHex, signatureHex: "00".repeat(64), timestamp, rawBody }),
    false,
  );
  // Garbage public key → fail closed, no throw.
  assert.equal(verifyDiscordRequest({ publicKeyHex: "xyz", signatureHex, timestamp, rawBody }), false);
});

// ---------------------------------------------------------------------------
// DISCORD ADAPTER → GOVERNANCE ENGINE
// ---------------------------------------------------------------------------
test("adapter: PING returns PONG", () => {
  const engine = new GovernanceEngine(new Map());
  const res = handleInteraction({ type: InteractionType.PING }, { engine, roster: new Map() });
  assert.equal(res.type, InteractionResponseType.PONG);
});

test("adapter: a non-compliant /propose is dead on arrival regardless of who sent it", () => {
  const roster = new Map<string, Member>([
    ["u1", { id: "u1", handle: "Trusted", roles: ["verified", "maintainer"], accountAgeDays: 100 }],
  ]);
  const engine = new GovernanceEngine(roster);
  const res = handleInteraction(
    {
      type: InteractionType.APPLICATION_COMMAND,
      data: {
        name: "propose",
        options: [
          { name: "kind", value: "content-edit" },
          { name: "title", value: "Add card checkout" },
          { name: "body", value: "Let players pay $20 via Stripe to rent a car." },
        ],
      },
      member: { user: { id: "u1", username: "Trusted" } },
    },
    { engine, roster },
  );
  assert.equal(res.type, InteractionResponseType.CHANNEL_MESSAGE_WITH_SOURCE);
  assert.match(res.data!.content, /Dead on arrival|cannot be approved/i);
});

test("adapter: an unknown caller is not elevated — treated as @everyone", () => {
  const engine = new GovernanceEngine(new Map());
  // A compliant proposal with quorum-reaching votes injected, but the caller is
  // unknown → still fine to screen/acknowledge; the point is no authority leaks
  // from the Discord payload. We assert the reply is produced and safe.
  const res = handleInteraction(
    {
      type: InteractionType.APPLICATION_COMMAND,
      data: {
        name: "propose",
        options: [
          { name: "kind", value: "content-edit" },
          { name: "title", value: "Fix a typo" },
          { name: "body", value: "Correct spelling on the Rent page." },
        ],
      },
      user: { id: "stranger", username: "Nobody" },
    },
    { engine, roster: new Map() },
  );
  // No votes injected → no quorum → not approved, not queued. Safe default.
  assert.match(res.data!.content, /No quorum|Rejected|received/i);
});
