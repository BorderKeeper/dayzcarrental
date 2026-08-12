// paypalTransactions.ts — reconcile donations from PayPal's Transaction Search
// API, as a backstop for the webhook.
//
// WHY THIS EXISTS: /api/paypal (the webhook) is the fast path, but PayPal's
// webhook delivery is at-least-once *at best* — events are documented to lag,
// and no-code pay-link payments (src/data/site.ts `paypalDonate`) don't always
// produce one. A donation that never arrives as a webhook would silently never
// credit the budget. Polling the ledger PayPal itself keeps is the source of
// truth: whatever channel a donation came in through, it shows up here.
//
// COMPLIANCE.md: this only READS completed inbound payments and credits the
// upkeep budget. It moves no money, sets no price, and gates no gameplay.
//
// Scope guards, because this reads a raw account ledger and not a payment event:
//   - status must be "S" (settled; not P/pending, D/denied, V/reversed),
//   - the amount must be POSITIVE (a negative T00xx is money we SENT),
//   - the event code must be T00xx — "payments received and sent". This is the
//     filter that matters most on a non-USD account: a USD gift into the
//     founder's CZK account also emits T0200 currency-conversion legs, and
//     crediting those would inflate the balance by counting one gift 2-3 times.
//
// Idempotency is shared with the webhook path: both key on the PayPal
// TRANSACTION id (`transaction_info.transaction_id` here, `resource.id` there —
// the same id for a capture/sale), so a donation seen by BOTH channels credits
// exactly once. See extractDonation() in paypalVerify.ts.

import { getAccessToken, type PaypalConfig, PAYPAL_BASE } from "./paypalVerify";
import { MICRO } from "./budget";

// The poller doesn't verify signatures, so it needs no webhook id — but it
// reuses getAccessToken(), which takes the full config shape.
export type PaypalCreds = Omit<PaypalConfig, "webhookId">;

const withWebhookId = (c: PaypalCreds): PaypalConfig => ({ ...c, webhookId: "" });
const base = (c: PaypalCreds): string => PAYPAL_BASE[c.env ?? "live"];
const fetcher = (c: PaypalCreds) =>
  c.fetchImpl ?? ((url: string, init: RequestInit) => fetch(url, init) as any);

// PayPal limits a single Transaction Search query to a 31-day window.
export const MAX_WINDOW_DAYS = 31;
// Executed transactions take "a maximum of three hours" to appear in this API,
// so a run can legitimately return nothing for a very recent donation.
export const SETTLEMENT_LAG_HOURS = 3;
// Safety valve: stop paginating rather than loop forever on a bad response.
const MAX_PAGES = 20;

// "Payments received and sent" (T0000 general payment, T0006 checkout, …).
// Everything else — transfers/conversions (T02xx), withdrawals (T04xx),
// refunds and reversals (T11xx) — is deliberately out of scope.
const PAYMENT_CODE_PREFIX = "T00";

// One inbound donation as PayPal's ledger records it.
export interface TransactionDonation {
  transactionId: string; // idempotency key, shared with the webhook path
  amountMicros: number; // micro-units of `currency`, NET of PayPal's fee
  currency: string; // ISO code as PayPal reported it, e.g. "USD" | "CZK"
  time: string; // transaction_initiation_date, for the run report
}

// What a scan actually looked at, so a surprising result is diagnosable: how
// many ledger rows came back vs how many survived the filters below.
export interface ScanResult {
  donations: TransactionDonation[];
  rowsScanned: number; // every row PayPal returned, across all pages
  pages: number; // pages actually fetched
}

// RFC3339 without milliseconds — PayPal rejects some fractional-second forms.
export function isoSeconds(d: Date): string {
  return d.toISOString().replace(/\.\d{3}Z$/, "Z");
}

// The window to reconcile: [now - days, now], clamped to PayPal's 31-day limit.
export function reconcileWindow(days: number, now = new Date()): { startDate: string; endDate: string } {
  const clamped = Math.min(Math.max(Math.floor(days) || 1, 1), MAX_WINDOW_DAYS);
  const start = new Date(now.getTime() - clamped * 24 * 60 * 60 * 1000);
  return { startDate: isoSeconds(start), endDate: isoSeconds(now) };
}

// Pull the creditable donations out of one Transaction Search page. Pure —
// every scope guard above lives here, so the tests can prove them offline.
export function extractDonationsFromTransactions(payload: any): TransactionDonation[] {
  const rows = payload?.transaction_details;
  if (!Array.isArray(rows)) return [];

  const out: TransactionDonation[] = [];
  for (const row of rows) {
    const info = row?.transaction_info;
    if (!info) continue;
    if (info.transaction_status !== "S") continue; // settled only
    if (!String(info.transaction_event_code ?? "").startsWith(PAYMENT_CODE_PREFIX)) continue;

    const amount = info.transaction_amount;
    const gross = Number.parseFloat(String(amount?.value ?? ""));
    const currency = amount?.currency_code;
    if (!Number.isFinite(gross) || gross <= 0) continue; // inbound money only
    if (!currency) continue;

    const transactionId = String(info.transaction_id ?? "");
    if (!transactionId) continue;

    // Credit NET, matching the webhook path: PayPal reports `fee_amount` as a
    // NEGATIVE figure alongside the gross, and the fee never lands in the
    // account. Only subtract a fee denominated in the same currency — a
    // mismatch means we'd be subtracting CZK from USD.
    const fee = info.fee_amount;
    const parsedFee = Number.parseFloat(String(fee?.value ?? "0"));
    const sameCurrency = !fee?.currency_code || fee.currency_code === currency;
    const feeValue = Number.isFinite(parsedFee) && sameCurrency ? Math.abs(parsedFee) : 0;
    const net = gross - feeValue;
    if (net <= 0) continue; // wholly consumed by fees → nothing to credit

    out.push({
      transactionId,
      amountMicros: Math.round(net * MICRO),
      currency: String(currency),
      time: String(info.transaction_initiation_date ?? ""),
    });
  }
  return out;
}

// Fetch one page of the ledger. Throws on a non-2xx so the caller can report
// the failure honestly instead of silently reconciling nothing.
async function fetchPage(
  creds: PaypalCreds,
  token: string,
  window: { startDate: string; endDate: string },
  page: number,
): Promise<any> {
  const qs = new URLSearchParams({
    start_date: window.startDate,
    end_date: window.endDate,
    fields: "transaction_info",
    page_size: "100",
    page: String(page),
  });
  const res = await fetcher(creds)(`${base(creds)}/v1/reporting/transactions?${qs}`, {
    method: "GET",
    headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
  });
  if (!res.ok) {
    const body = (await res.text()).slice(0, 300);
    // 403 here almost always means the app is missing the Transaction Search
    // feature — call it out by name so the fix is obvious in the logs.
    const hint = res.status === 403 ? " (is 'Transaction Search' enabled on the PayPal app?)" : "";
    throw new Error(`PayPal transaction search ${res.status}${hint}: ${body}`);
  }
  return res.json();
}

// List every creditable donation in the window, following pagination. Reports
// the raw row count too: "0 donations out of 0 rows" (an empty window) and
// "0 out of 40" (rows arrived but every one was filtered) are very different
// problems, and the caller can't tell them apart from the donations alone.
export async function listDonations(
  creds: PaypalCreds,
  window: { startDate: string; endDate: string },
): Promise<ScanResult> {
  const token = await getAccessToken(withWebhookId(creds));
  const donations: TransactionDonation[] = [];
  let rowsScanned = 0;
  let pages = 0;
  let page = 1;
  let totalPages = 1;
  do {
    const payload = await fetchPage(creds, token, window, page);
    pages++;
    rowsScanned += Array.isArray(payload?.transaction_details) ? payload.transaction_details.length : 0;
    donations.push(...extractDonationsFromTransactions(payload));
    const reported = Number.parseInt(String(payload?.total_pages ?? "1"), 10);
    totalPages = Number.isFinite(reported) && reported > 0 ? reported : 1;
    page++;
  } while (page <= totalPages && page <= MAX_PAGES);
  return { donations, rowsScanned, pages };
}
