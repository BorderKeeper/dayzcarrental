// donations.test.ts — verification for the PayPal → budget donation inflow.
//
// The founder's money rule under test: donations flow IN automatically and
// credit the bot's budget; nothing else. Plus the security-critical properties:
// a webhook must be VERIFIED before crediting, and re-delivery must be
// IDEMPOTENT (no double-credit). All offline — injected fetch, in-memory store.

import { test } from "node:test";
import assert from "node:assert/strict";

import { verifyPaypalWebhook, extractDonation, getAccessToken, CREDIT_TYPES, type PaypalConfig } from "../paypalVerify";
import { InMemoryBudgetStore } from "../budgetStore";
import { MICRO } from "../budget";
import type { FetchLike } from "../aiClient";

const HEADERS = {
  transmissionId: "t-1",
  transmissionTime: "2026-08-11T00:00:00Z",
  transmissionSig: "sig",
  certUrl: "https://paypal/cert",
  authAlgo: "SHA256withRSA",
};

// Stub PayPal: token endpoint + verify endpoint returning a configurable status.
function stubPaypal(verificationStatus: "SUCCESS" | "FAILURE"): PaypalConfig {
  const fetchImpl: FetchLike = async (url) => {
    const ok = (b: any) => ({ ok: true, status: 200, json: async () => b, text: async () => "" });
    if (url.endsWith("/v1/oauth2/token")) return ok({ access_token: "tok" });
    if (url.endsWith("/v1/notifications/verify-webhook-signature"))
      return ok({ verification_status: verificationStatus });
    return { ok: false, status: 404, json: async () => ({}), text: async () => "nf" };
  };
  return { clientId: "id", clientSecret: "secret", webhookId: "wh-1", env: "sandbox", fetchImpl };
}

// ---------------------------------------------------------------------------
// VERIFICATION
// ---------------------------------------------------------------------------
test("paypal: getAccessToken mints from client credentials", async () => {
  const token = await getAccessToken(stubPaypal("SUCCESS"));
  assert.equal(token, "tok");
});

test("paypal: verify returns true only when PayPal reports SUCCESS", async () => {
  const body = JSON.stringify({ id: "e1", event_type: "PAYMENT.CAPTURE.COMPLETED" });
  assert.equal(await verifyPaypalWebhook(stubPaypal("SUCCESS"), HEADERS, body), true);
  assert.equal(await verifyPaypalWebhook(stubPaypal("FAILURE"), HEADERS, body), false);
});

test("paypal: verify fails closed when the API errors", async () => {
  const cfg: PaypalConfig = {
    clientId: "id",
    clientSecret: "s",
    webhookId: "wh",
    fetchImpl: async () => ({ ok: false, status: 500, json: async () => ({}), text: async () => "boom" }),
  };
  assert.equal(await verifyPaypalWebhook(cfg, HEADERS, "{}"), false);
});

// ---------------------------------------------------------------------------
// AMOUNT EXTRACTION
// ---------------------------------------------------------------------------
test("extractDonation: credits a completed USD capture", () => {
  const d = extractDonation({
    id: "evt-1",
    event_type: "PAYMENT.CAPTURE.COMPLETED",
    resource: { amount: { value: "5.00", currency_code: "USD" } },
  });
  assert.deepEqual(d, { eventId: "evt-1", amountMicros: 5 * MICRO, currency: "USD" });
});

test("extractDonation: credits the settled amount in ANY currency (account may be non-USD)", () => {
  // The founder's PayPal converts USD gifts to CZK; we record the settled CZK
  // amount as-is rather than dropping it.
  const czk = extractDonation({
    id: "evt-czk",
    event_type: "PAYMENT.CAPTURE.COMPLETED",
    resource: { amount: { value: "13.83", currency_code: "CZK" } },
  });
  assert.deepEqual(czk, { eventId: "evt-czk", amountMicros: Math.round(13.83 * MICRO), currency: "CZK" });

  const eur = extractDonation({
    id: "evt-eur",
    event_type: "PAYMENT.CAPTURE.COMPLETED",
    resource: { amount: { value: "5.00", currency_code: "EUR" } },
  });
  assert.deepEqual(eur, { eventId: "evt-eur", amountMicros: 5 * MICRO, currency: "EUR" });
});

test("extractDonation: ignores non-payment events and non-positive/malformed amounts", () => {
  // Wrong event type → ignored.
  assert.equal(
    extractDonation({ id: "e", event_type: "BILLING.SUBSCRIPTION.CREATED", resource: { amount: { value: "5.00", currency_code: "USD" } } }),
    null,
  );
  // Zero / missing → ignored.
  assert.equal(
    extractDonation({ id: "e", event_type: "PAYMENT.CAPTURE.COMPLETED", resource: { amount: { value: "0.00", currency_code: "USD" } } }),
    null,
  );
  assert.equal(extractDonation({ id: "e", event_type: "PAYMENT.CAPTURE.COMPLETED", resource: {} }), null);
});

test("extractDonation: accepts the SALE.COMPLETED shape too", () => {
  const d = extractDonation({
    id: "evt-2",
    event_type: "PAYMENT.SALE.COMPLETED",
    resource: { amount: { total: undefined, value: "12.50", currency: "USD" } },
  });
  assert.deepEqual(d, { eventId: "evt-2", amountMicros: 12_500_000, currency: "USD" });
});

// ---------------------------------------------------------------------------
// IDEMPOTENT CREDIT (the double-credit guard)
// ---------------------------------------------------------------------------
test("budgetStore: a re-delivered donation event credits only once", async () => {
  const store = new InMemoryBudgetStore(0);

  const first = await store.applyDonation("evt-1", 5 * MICRO);
  assert.equal(first.applied, true);
  assert.equal(first.balanceMicros, 5 * MICRO);

  // Same event id again (PayPal retry) → no double-credit.
  const second = await store.applyDonation("evt-1", 5 * MICRO);
  assert.equal(second.applied, false);
  assert.equal(second.balanceMicros, 5 * MICRO);

  // A different event adds normally.
  const third = await store.applyDonation("evt-2", 3 * MICRO);
  assert.equal(third.applied, true);
  assert.equal(third.balanceMicros, 8 * MICRO);
});

test("budgetStore: spend hard-stops at zero; top-up and donation both raise balance", async () => {
  const store = new InMemoryBudgetStore(0);
  await store.topUp(2 * MICRO);
  await store.applyDonation("d1", 3 * MICRO);
  assert.equal(await store.getBalanceMicros(), 5 * MICRO);

  const okSpend = await store.spend(1 * MICRO);
  assert.equal(okSpend.ok, true);
  assert.equal(okSpend.balanceMicros, 4 * MICRO);

  const overspend = await store.spend(100 * MICRO);
  assert.equal(overspend.ok, false);
  assert.equal(overspend.balanceMicros, 4 * MICRO, "balance unchanged after refused spend");
});

// ---------------------------------------------------------------------------
// END-TO-END: verified webhook → extract → idempotent credit
// ---------------------------------------------------------------------------
test("donation flow: verified USD capture credits the store exactly once", async () => {
  const store = new InMemoryBudgetStore(0);
  const cfg = stubPaypal("SUCCESS");
  const event = {
    id: "evt-flow",
    event_type: "PAYMENT.CAPTURE.COMPLETED",
    resource: { amount: { value: "10.00", currency_code: "USD" } },
  };
  const body = JSON.stringify(event);

  assert.equal(await verifyPaypalWebhook(cfg, HEADERS, body), true);
  const d = extractDonation(JSON.parse(body))!;
  assert.ok(d);
  const r1 = await store.applyDonation(d.eventId, d.amountMicros);
  const r2 = await store.applyDonation(d.eventId, d.amountMicros); // retry
  assert.equal(r1.applied, true);
  assert.equal(r2.applied, false);
  assert.equal(await store.getBalanceMicros(), 10 * MICRO);
});

// ---------------------------------------------------------------------------
// The doctor script duplicates CREDIT_TYPES so it can run from a bare checkout
// without the TS loader. That duplication is only safe if it can't drift: a
// doctor checking for the wrong events would clear a webhook that credits
// nothing, which is worse than having no doctor at all.
// ---------------------------------------------------------------------------
test("paypal-doctor checks for exactly the event types the handler credits", async () => {
  const { readFile } = await import("node:fs/promises");
  const src = await readFile(new URL("../../../../scripts/paypal-doctor.mjs", import.meta.url), "utf8");
  const line = src.match(/const CREDIT_TYPES = \[([^\]]*)\]/);
  assert.ok(line, "paypal-doctor.mjs should declare a CREDIT_TYPES array");

  const inScript = line![1]
    .split(",")
    .map((s) => s.trim().replace(/^["']|["']$/g, ""))
    .filter(Boolean)
    .sort();
  assert.deepEqual(inScript, [...CREDIT_TYPES].sort(), "doctor and handler disagree on credited events");
});
