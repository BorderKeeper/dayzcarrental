// paypalReconcile.test.ts — the donation poller that backstops the webhook.
//
//   node --test src/lib/governance/__tests__/paypalReconcile.test.ts
//
// The properties that matter, all offline (injected fetch, in-memory store):
//   1. Only real inbound money is credited — not currency-conversion legs,
//      not pending/denied rows, not money we SENT. (On a CZK account taking
//      USD gifts, failing this counts one $1 donation two or three times.)
//   2. Pagination is followed, so a busy window isn't silently truncated.
//   3. A donation seen by BOTH the webhook and the poller credits ONCE.

import { test } from "node:test";
import assert from "node:assert/strict";

import {
  extractDonationsFromTransactions,
  listDonations,
  reconcileWindow,
  isoSeconds,
  MAX_WINDOW_DAYS,
  type PaypalCreds,
} from "../paypalTransactions";
import { extractDonation } from "../paypalVerify";
import { InMemoryBudgetStore } from "../budgetStore";
import { MICRO } from "../budget";
import type { FetchLike } from "../aiClient";

// A ledger row in PayPal's Transaction Search shape.
function row(info: Record<string, unknown>) {
  return { transaction_info: info };
}
const donationRow = (id: string, value: string, currency = "USD") =>
  row({
    transaction_id: id,
    transaction_event_code: "T0000",
    transaction_status: "S",
    transaction_initiation_date: "2026-08-12T05:31:00+0000",
    transaction_amount: { currency_code: currency, value },
  });

// ---------------------------------------------------------------------------
// SCOPE GUARDS
// ---------------------------------------------------------------------------
test("reconcile: credits a settled inbound payment", () => {
  const found = extractDonationsFromTransactions({ transaction_details: [donationRow("TXN1", "1.00")] });
  assert.equal(found.length, 1);
  assert.deepEqual(found[0], {
    transactionId: "TXN1",
    amountMicros: 1 * MICRO,
    currency: "USD",
    time: "2026-08-12T05:31:00+0000",
  });
});

test("reconcile: ignores currency-conversion legs (the double-count trap on a CZK account)", () => {
  // One $1 USD gift into a CZK account: the payment, then PayPal's conversion
  // out of USD and into CZK. Only the payment is a donation.
  const found = extractDonationsFromTransactions({
    transaction_details: [
      donationRow("TXN1", "1.00"),
      row({
        transaction_id: "CONV-OUT",
        transaction_event_code: "T0200",
        transaction_status: "S",
        transaction_amount: { currency_code: "USD", value: "-0.68" },
      }),
      row({
        transaction_id: "CONV-IN",
        transaction_event_code: "T0200",
        transaction_status: "S",
        transaction_amount: { currency_code: "CZK", value: "14.20" },
      }),
    ],
  });
  assert.deepEqual(
    found.map((d) => d.transactionId),
    ["TXN1"],
    "only the T00xx payment counts",
  );
});

test("reconcile: ignores pending, denied, reversed, outbound and malformed rows", () => {
  const found = extractDonationsFromTransactions({
    transaction_details: [
      row({ transaction_id: "P", transaction_event_code: "T0000", transaction_status: "P", transaction_amount: { currency_code: "USD", value: "5.00" } }),
      row({ transaction_id: "D", transaction_event_code: "T0000", transaction_status: "D", transaction_amount: { currency_code: "USD", value: "5.00" } }),
      row({ transaction_id: "V", transaction_event_code: "T0000", transaction_status: "V", transaction_amount: { currency_code: "USD", value: "5.00" } }),
      // Money we sent out (negative T00xx), a refund, and a withdrawal.
      row({ transaction_id: "OUT", transaction_event_code: "T0000", transaction_status: "S", transaction_amount: { currency_code: "USD", value: "-5.00" } }),
      row({ transaction_id: "REFUND", transaction_event_code: "T1107", transaction_status: "S", transaction_amount: { currency_code: "USD", value: "5.00" } }),
      row({ transaction_id: "WITHDRAW", transaction_event_code: "T0400", transaction_status: "S", transaction_amount: { currency_code: "USD", value: "5.00" } }),
      // Missing id / amount / currency.
      row({ transaction_event_code: "T0000", transaction_status: "S", transaction_amount: { currency_code: "USD", value: "5.00" } }),
      row({ transaction_id: "NOAMT", transaction_event_code: "T0000", transaction_status: "S" }),
    ],
  });
  assert.deepEqual(found, [], "nothing here is an inbound settled donation");
});

test("reconcile: survives an empty or malformed payload", () => {
  assert.deepEqual(extractDonationsFromTransactions({}), []);
  assert.deepEqual(extractDonationsFromTransactions({ transaction_details: null }), []);
  assert.deepEqual(extractDonationsFromTransactions(undefined), []);
});

// ---------------------------------------------------------------------------
// WINDOW + PAGINATION
// ---------------------------------------------------------------------------
test("reconcile: window is RFC3339 without millis and clamped to PayPal's 31 days", () => {
  const now = new Date("2026-08-12T06:00:00.000Z");
  const w = reconcileWindow(7, now);
  assert.equal(w.endDate, "2026-08-12T06:00:00Z");
  assert.equal(w.startDate, "2026-08-05T06:00:00Z");
  assert.ok(!w.startDate.includes("."), "no fractional seconds — PayPal rejects some forms");

  const tooWide = reconcileWindow(365, now);
  assert.equal(tooWide.startDate, isoSeconds(new Date(now.getTime() - MAX_WINDOW_DAYS * 864e5)));
});

test("reconcile: follows pagination instead of truncating at page 1", async () => {
  const pages: Record<string, any> = {
    "1": { total_pages: 2, transaction_details: [donationRow("TXN1", "1.00")] },
    "2": { total_pages: 2, transaction_details: [donationRow("TXN2", "2.00")] },
  };
  const seen: string[] = [];
  const fetchImpl: FetchLike = async (url) => {
    if (url.endsWith("/v1/oauth2/token")) {
      return { ok: true, status: 200, json: async () => ({ access_token: "tok" }), text: async () => "" };
    }
    const page = new URL(url).searchParams.get("page") ?? "1";
    seen.push(page);
    return { ok: true, status: 200, json: async () => pages[page], text: async () => "" };
  };
  const creds: PaypalCreds = { clientId: "id", clientSecret: "s", env: "sandbox", fetchImpl };

  const found = await listDonations(creds, reconcileWindow(7));
  assert.deepEqual(seen, ["1", "2"]);
  assert.deepEqual(
    found.map((d) => d.transactionId),
    ["TXN1", "TXN2"],
  );
});

test("reconcile: a PayPal error surfaces instead of silently reconciling nothing", async () => {
  const fetchImpl: FetchLike = async (url) => {
    if (url.endsWith("/v1/oauth2/token")) {
      return { ok: true, status: 200, json: async () => ({ access_token: "tok" }), text: async () => "" };
    }
    return { ok: false, status: 403, json: async () => ({}), text: async () => "NOT_AUTHORIZED" };
  };
  const creds: PaypalCreds = { clientId: "id", clientSecret: "s", env: "sandbox", fetchImpl };

  await assert.rejects(
    () => listDonations(creds, reconcileWindow(7)),
    // The 403 hint names the missing app feature — the actual setup mistake.
    /403.*Transaction Search/s,
  );
});

// ---------------------------------------------------------------------------
// THE CROSS-CHANNEL GUARANTEE
// ---------------------------------------------------------------------------
test("webhook + poller see the same donation and credit it exactly ONCE", async () => {
  const store = new InMemoryBudgetStore(0);

  // The webhook's view: resource.id IS the capture/transaction id.
  const fromWebhook = extractDonation({
    id: "WH-EVENT-ID", // delivery id — deliberately NOT the key
    event_type: "PAYMENT.CAPTURE.COMPLETED",
    resource: { id: "TXN1", amount: { value: "1.00", currency_code: "USD" } },
  })!;
  assert.equal(fromWebhook.eventId, "TXN1", "keys on the transaction, not the delivery");

  // The poller's view of the same money.
  const [fromLedger] = extractDonationsFromTransactions({
    transaction_details: [donationRow("TXN1", "1.00")],
  });

  const a = await store.applyDonation(fromWebhook.eventId, fromWebhook.amountMicros, fromWebhook.currency);
  const b = await store.applyDonation(fromLedger.transactionId, fromLedger.amountMicros, fromLedger.currency);

  assert.equal(a.applied, true);
  assert.equal(b.applied, false, "the poller must not re-credit what the webhook already booked");
  assert.equal(await store.getBalanceMicros("USD"), 1 * MICRO);
});

test("webhook still keys on the event id when the payload carries no resource id", () => {
  const d = extractDonation({
    id: "evt-legacy",
    event_type: "PAYMENT.SALE.COMPLETED",
    resource: { amount: { value: "12.50", currency: "USD" } },
  });
  assert.equal(d?.eventId, "evt-legacy");
});
