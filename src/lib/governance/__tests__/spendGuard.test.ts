// spendGuard.test.ts — the donation balance as a BINDING ceiling on AI spend.
//
//   node --import ./scripts/ts-loader.mjs --test src/lib/governance/__tests__/spendGuard.test.ts
//
// The properties that matter:
//   1. A guard debits the same durable balance donations credit — the loop is
//      closed, so $1 donated buys $1 of tokens and not a cent more.
//   2. Spend NEVER drives the balance negative, even when the cost estimate was
//      wrong; it clamps at zero and reports the shortfall.
//   3. Spend survives a cold start — the whole point of the durable store.
//   4. The build loop stops on the pre-check rather than overspending.

import { test } from "node:test";
import assert from "node:assert/strict";

import { ledgerGuard, storeGuard, describeSpend } from "../spendGuard";
import { InMemoryBudgetStore } from "../budgetStore";
import { BudgetLedger, MICRO } from "../budget";

// ---------------------------------------------------------------------------
// THE CLOSED LOOP: donations in, AI spend out, one balance
// ---------------------------------------------------------------------------
test("a donation funds AI spend on the SAME durable balance", async () => {
  const store = new InMemoryBudgetStore(0);
  // What the reconciler does when a real donation lands (net of fees).
  await store.applyDonation("TXN1", 680_000, "USD");

  const guard = storeGuard(store);
  assert.equal(await guard.balance(), 680_000);
  assert.equal(await guard.canAfford(500_000), true);
  assert.equal(await guard.canAfford(700_000), false, "cannot spend more than was donated");

  const out = await guard.spend(500_000, "AI build step");
  assert.equal(out.debitedMicros, 500_000);
  assert.equal(out.shortfall, false);
  assert.equal(await guard.balance(), 180_000);
  assert.equal(guard.totalSpentMicros(), 500_000);
});

test("spend clamps at zero when the estimate was wrong — never negative", async () => {
  const store = new InMemoryBudgetStore(0);
  await store.applyDonation("TXN1", 100_000, "USD");
  const guard = storeGuard(store);

  // A call cost far more than the balance: take what's there, report shortfall.
  const out = await guard.spend(900_000, "runaway step");
  assert.equal(out.debitedMicros, 100_000, "debits only what existed");
  assert.equal(out.balanceMicros, 0);
  assert.equal(out.shortfall, true);
  assert.equal(await guard.balance(), 0, "balance floors at zero, never negative");

  // And a broke guard affords nothing and debits nothing further.
  assert.equal(await guard.canAfford(1), false);
  const again = await guard.spend(50_000, "another step");
  assert.deepEqual(again, { debitedMicros: 0, balanceMicros: 0, shortfall: true });
});

test("spend persists across a cold start (the reason the store is durable)", async () => {
  const store = new InMemoryBudgetStore(0);
  await store.applyDonation("TXN1", 1 * MICRO, "USD");
  await storeGuard(store).spend(400_000, "build step");

  // A fresh guard over the SAME store — as a new serverless invocation sees it.
  const afterColdStart = storeGuard(store);
  assert.equal(await afterColdStart.balance(), 600_000, "the debit survived");
  assert.equal(afterColdStart.totalSpentMicros(), 0, "per-run counter starts fresh");
});

test("the guard never credits — it has no path to raise a balance", async () => {
  const store = new InMemoryBudgetStore(0);
  await store.applyDonation("TXN1", 500_000, "USD");
  const guard = storeGuard(store);

  // Negative and nonsense costs must not become credits.
  await guard.spend(-100_000, "negative cost");
  await guard.spend(Number.NaN, "NaN cost");
  assert.equal(await guard.balance(), 500_000, "balance unchanged, never increased");
  assert.equal(await guard.canAfford(-1), false, "a negative affordability check is not 'yes'");
});

// ---------------------------------------------------------------------------
// CURRENCY: the known limitation, pinned so it can't drift silently
// ---------------------------------------------------------------------------
test("a guard spends only its own currency — CZK donations don't fund USD spend", async () => {
  const store = new InMemoryBudgetStore(0);
  await store.applyDonation("TXN-CZK", 100 * MICRO, "CZK");

  const usd = storeGuard(store, "USD");
  assert.equal(await usd.balance(), 0);
  assert.equal(await usd.canAfford(1), false, "no FX conversion is invented — see FOLLOWUPS.md item 4");

  const czk = storeGuard(store, "CZK");
  assert.equal(await czk.balance(), 100 * MICRO);
});

// ---------------------------------------------------------------------------
// IN-MEMORY GUARD (tests / local runs) — same contract
// ---------------------------------------------------------------------------
test("ledgerGuard honours the same clamped, non-throwing contract", async () => {
  const guard = ledgerGuard(new BudgetLedger(200_000));

  const ok = await guard.spend(50_000, "step");
  assert.equal(ok.shortfall, false);
  assert.equal(ok.balanceMicros, 150_000);

  // BudgetLedger throws on overspend; the guard must translate that into a
  // clamped drain, because a throw mid-build would crash the loop.
  const over = await guard.spend(999_999_999, "runaway step");
  assert.equal(over.debitedMicros, 150_000);
  assert.equal(over.balanceMicros, 0);
  assert.equal(over.shortfall, true);
  assert.equal(await guard.balance(), 0);
});

test("describeSpend reports spend and remainder for the build PR body", async () => {
  const store = new InMemoryBudgetStore(0);
  await store.applyDonation("TXN1", 2 * MICRO, "USD");
  const guard = storeGuard(store);
  await guard.spend(1 * MICRO, "build step");
  assert.equal(await describeSpend(guard), "Spent $1.0000 of donated funds; $1.0000 remaining.");
});
