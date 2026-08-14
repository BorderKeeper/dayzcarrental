// fxRates.test.ts — founder-set conversion of non-USD donations (FOLLOWUPS item 4).
//
//   node --import ./scripts/ts-loader.mjs --test src/lib/governance/__tests__/fxRates.test.ts
//
// This module converts REAL MONEY into a real spending ceiling, so the
// properties worth pinning are mostly about what it REFUSES to do:
//   1. With no rate set, behaviour is exactly what it was — nothing converts.
//   2. With a rate set, a CZK donation becomes spendable USD, closing the gap.
//   3. A broken rate is ignored, never applied and never treated as zero — a
//      typo must not silently destroy or inflate donated money.
//   4. The rate that booked a donation is recoverable afterwards.
//   5. Converting does not weaken idempotency.

import { test } from "node:test";
import assert from "node:assert/strict";

import {
  fxRatesFromEnv,
  convertToUsdMicros,
  creditDonation,
  describeConversion,
} from "../fxRates";
import { InMemoryBudgetStore } from "../budgetStore";
import { storeGuard } from "../spendGuard";
import { MICRO } from "../budget";

const CZK_RATE = 0.0435; // 1 CZK = 0.0435 USD

// ---------------------------------------------------------------------------
// ENV PARSING — only well-formed, plausible rates are accepted
// ---------------------------------------------------------------------------
test("fxRatesFromEnv reads PAYPAL_FX_<CUR>_USD and ignores everything else", () => {
  const rates = fxRatesFromEnv({
    PAYPAL_FX_CZK_USD: "0.0435",
    PAYPAL_FX_EUR_USD: "1.09",
    PAYPAL_FX_USD_USD: "1", // not a conversion
    PAYPAL_CLIENT_SECRET: "shhh", // unrelated secret must not be parsed as a rate
    FX_GBP_USD: "1.27", // wrong prefix
    PAYPAL_FX_czk_USD: "0.05", // wrong case
  });
  assert.deepEqual(rates, { CZK: 0.0435, EUR: 1.09 });
});

test("a malformed, zero, negative, or implausible rate is ignored, not applied", () => {
  const rates = fxRatesFromEnv({
    PAYPAL_FX_CZK_USD: "not-a-number",
    PAYPAL_FX_EUR_USD: "0",
    PAYPAL_FX_GBP_USD: "-1.5",
    PAYPAL_FX_JPY_USD: "435", // dropped decimal point: 435 USD per yen
    PAYPAL_FX_SEK_USD: "  0.095  ", // whitespace is fine
  });
  assert.deepEqual(rates, { SEK: 0.095 }, "only the sane one survives");
});

// ---------------------------------------------------------------------------
// DEFAULT: inert until the founder sets a rate
// ---------------------------------------------------------------------------
test("with no rate configured, a CZK donation credits natively — unchanged behaviour", async () => {
  const store = new InMemoryBudgetStore(0);
  const credit = await creditDonation(store, "TXN-CZK", 250 * MICRO, "CZK", {});

  assert.equal(credit.applied, true);
  assert.equal(credit.currency, "CZK", "credited in its own currency, as before");
  assert.equal(credit.conversion, null);
  assert.equal(credit.spendable, false, "this is the gap item 4 describes");
  assert.equal(await store.getBalanceMicros("CZK"), 250 * MICRO);
  assert.equal(await store.getBalanceMicros("USD"), 0);
});

test("a USD donation is never touched by conversion", async () => {
  const store = new InMemoryBudgetStore(0);
  const credit = await creditDonation(store, "TXN-USD", 680_000, "USD", { CZK: CZK_RATE });

  assert.equal(credit.conversion, null, "no identity conversion is invented");
  assert.equal(credit.currency, "USD");
  assert.equal(credit.spendable, true);
  assert.equal(await store.getBalanceMicros("USD"), 680_000);
});

// ---------------------------------------------------------------------------
// THE FIX: a configured rate closes the loop
// ---------------------------------------------------------------------------
test("with a founder rate, a CZK donation funds USD AI spend", async () => {
  const store = new InMemoryBudgetStore(0);
  const credit = await creditDonation(store, "TXN-CZK", 250 * MICRO, "CZK", { CZK: CZK_RATE });

  assert.equal(credit.applied, true);
  assert.equal(credit.currency, "USD");
  assert.equal(credit.spendable, true);
  assert.equal(credit.conversion?.rate, CZK_RATE);
  assert.equal(credit.conversion?.fromCurrency, "CZK");

  // 250 CZK * 0.0435 = 10.875 USD, floored to micro-units.
  assert.equal(await store.getBalanceMicros("USD"), 10_875_000);
  assert.equal(await store.getBalanceMicros("CZK"), 0, "no phantom balance left behind");

  // The point of the whole exercise: the AI budget can now draw on it.
  const guard = storeGuard(store, "USD");
  assert.equal(await guard.canAfford(10 * MICRO), true);
});

test("conversion rounds DOWN — the ceiling never exceeds money actually held", async () => {
  const store = new InMemoryBudgetStore(0);
  // 1 CZK * 0.0435 = 43500 micros exactly; use a rate that can't divide evenly.
  await creditDonation(store, "TXN-ODD", 3 * MICRO, "CZK", { CZK: 0.0333333333 });
  const balance = await store.getBalanceMicros("USD");
  assert.equal(balance, Math.floor(3 * MICRO * 0.0333333333));
  assert.ok(balance <= 3 * MICRO * 0.0333333333, "never rounds up into money we don't have");
});

test("a donation too small to register in USD credits nothing, not a phantom zero", async () => {
  const store = new InMemoryBudgetStore(0);
  const credit = await creditDonation(store, "TXN-DUST", 1, "CZK", { CZK: 0.0435 });

  assert.equal(credit.conversion, null, "1 micro-CZK is worth 0 micro-USD");
  assert.equal(credit.currency, "CZK", "falls back to a native credit rather than booking 0 USD");
  assert.equal(await store.getBalanceMicros("USD"), 0);
});

// ---------------------------------------------------------------------------
// AUDIT: the rate that booked a donation is recoverable
// ---------------------------------------------------------------------------
test("the conversion is recorded with the credit and readable afterwards", async () => {
  const store = new InMemoryBudgetStore(0);
  await creditDonation(store, "TXN-CZK", 250 * MICRO, "CZK", { CZK: CZK_RATE });

  const memo = await store.getDonationMemo("TXN-CZK");
  assert.ok(memo, "the credit left an audit note");
  assert.match(memo!, /CZK/);
  assert.match(memo!, /0\.0435/, "the exact rate used is in the record");
  assert.match(memo!, /10\.875000USD/);

  assert.equal(await store.getDonationMemo("NEVER-SEEN"), null);
});

test("a native credit records a plain marker, and unknown ids stay unknown", async () => {
  const store = new InMemoryBudgetStore(0);
  await creditDonation(store, "TXN-USD", 1 * MICRO, "USD", {});
  assert.equal(await store.getDonationMemo("TXN-USD"), "1");
});

// ---------------------------------------------------------------------------
// IDEMPOTENCY still holds through a conversion
// ---------------------------------------------------------------------------
test("converting does not weaken idempotency — one donation, one credit", async () => {
  const store = new InMemoryBudgetStore(0);
  const rates = { CZK: CZK_RATE };

  const first = await creditDonation(store, "TXN-DUP", 100 * MICRO, "CZK", rates);
  const second = await creditDonation(store, "TXN-DUP", 100 * MICRO, "CZK", rates);

  assert.equal(first.applied, true);
  assert.equal(second.applied, false, "the webhook and the reconciler both saw it");
  assert.equal(await store.getBalanceMicros("USD"), 4_350_000, "credited once");
});

// ---------------------------------------------------------------------------
// The pure converter's own edges
// ---------------------------------------------------------------------------
test("convertToUsdMicros refuses unusable input rather than guessing", () => {
  const rates = { CZK: CZK_RATE };
  assert.equal(convertToUsdMicros(100 * MICRO, "USD", rates), null, "already USD");
  assert.equal(convertToUsdMicros(100 * MICRO, "GBP", rates), null, "no rate set");
  assert.equal(convertToUsdMicros(0, "CZK", rates), null);
  assert.equal(convertToUsdMicros(-5, "CZK", rates), null);
  assert.equal(convertToUsdMicros(Number.NaN, "CZK", rates), null);
  assert.equal(convertToUsdMicros(100 * MICRO, "", rates), null);
});

test("describeConversion is a compact, greppable record", () => {
  const c = convertToUsdMicros(250 * MICRO, "CZK", { CZK: CZK_RATE })!;
  assert.equal(describeConversion(c), "fx:250.00CZK@0.0435=10.875000USD");
});
