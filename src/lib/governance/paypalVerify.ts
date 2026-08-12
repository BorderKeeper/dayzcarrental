// paypalVerify.ts — verify a PayPal donation webhook and extract the amount.
//
// This is the trigger for the donation → budget inflow (COMPLIANCE.md: real
// money is donations only, funding upkeep incl. AI tokens). A PayPal webhook
// hits /api/paypal; we MUST verify it genuinely came from PayPal before
// crediting anything — otherwise anyone could POST a fake "donation" and inflate
// the bot's budget. PayPal verification is a server-side API call
// (/v1/notifications/verify-webhook-signature) authenticated with an OAuth
// token minted from the app's client id/secret; no local crypto needed.
//
// Raw fetch, no SDK (package.json is locked). Transport injected for tests.
// Secrets (client id/secret, webhook id) come from the environment, never the
// repo (CLAUDE.md rule 2).

import type { FetchLike } from "./aiClient";
import { MICRO } from "./budget";

// PayPal environments. Sandbox for testing, live for production.
export const PAYPAL_BASE = {
  live: "https://api-m.paypal.com",
  sandbox: "https://api-m.sandbox.paypal.com",
} as const;
export type PaypalEnv = keyof typeof PAYPAL_BASE;

export interface PaypalConfig {
  clientId: string;
  clientSecret: string;
  webhookId: string; // the configured webhook's id (PayPal binds signatures to it)
  env?: PaypalEnv; // default "live"
  fetchImpl?: FetchLike;
}

// The signature headers PayPal sends on every webhook delivery.
export interface PaypalSignatureHeaders {
  transmissionId: string; // paypal-transmission-id
  transmissionTime: string; // paypal-transmission-time
  transmissionSig: string; // paypal-transmission-sig
  certUrl: string; // paypal-cert-url
  authAlgo: string; // paypal-auth-algo
}

function base(cfg: PaypalConfig): string {
  return PAYPAL_BASE[cfg.env ?? "live"];
}
function fetcher(cfg: PaypalConfig): FetchLike {
  return cfg.fetchImpl ?? ((url, init) => fetch(url, init) as unknown as ReturnType<FetchLike>);
}

// Mint an OAuth access token from client credentials.
export async function getAccessToken(cfg: PaypalConfig): Promise<string> {
  const auth = Buffer.from(`${cfg.clientId}:${cfg.clientSecret}`).toString("base64");
  const res = await fetcher(cfg)(`${base(cfg)}/v1/oauth2/token`, {
    method: "POST",
    headers: { authorization: `Basic ${auth}`, "content-type": "application/x-www-form-urlencoded" },
    body: "grant_type=client_credentials",
  });
  if (!res.ok) throw new Error(`PayPal token error ${res.status}: ${(await res.text()).slice(0, 200)}`);
  const data = await res.json();
  if (!data?.access_token) throw new Error("PayPal token response missing access_token.");
  return data.access_token;
}

// Verify a webhook delivery. rawBody MUST be the exact bytes PayPal sent —
// re-serialized JSON changes the signed payload and fails verification. Returns
// true only when PayPal reports "SUCCESS". Any error → false (fail closed).
export async function verifyPaypalWebhook(
  cfg: PaypalConfig,
  headers: PaypalSignatureHeaders,
  rawBody: string,
): Promise<boolean> {
  try {
    const token = await getAccessToken(cfg);
    // The verify endpoint takes the headers + the webhook id + the event body
    // (as a parsed object). PayPal recomputes the signature server-side.
    const res = await fetcher(cfg)(`${base(cfg)}/v1/notifications/verify-webhook-signature`, {
      method: "POST",
      headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
      body: JSON.stringify({
        transmission_id: headers.transmissionId,
        transmission_time: headers.transmissionTime,
        cert_url: headers.certUrl,
        auth_algo: headers.authAlgo,
        transmission_sig: headers.transmissionSig,
        webhook_id: cfg.webhookId,
        webhook_event: JSON.parse(rawBody),
      }),
    });
    if (!res.ok) return false;
    const data = await res.json();
    return data?.verification_status === "SUCCESS";
  } catch {
    return false;
  }
}

// A donation extracted from a verified event. Currency-agnostic: we record the
// SETTLED amount in whatever currency PayPal reports (the founder's account is
// CZK-based, and PayPal converts USD donations to it), rather than assuming USD
// or mis-converting. `micros` is micro-units of `currency`.
//
// The amount is NET of PayPal's fee — see extractDonation() for why.
export interface ExtractedDonation {
  eventId: string; // idempotency key — the transaction id when PayPal sends one
  amountMicros: number; // micro-units of `currency` (value * 1e6)
  currency: string; // ISO code as PayPal reported it, e.g. "USD" | "CZK"
}

// Event types that mean "money actually completed moving". PayPal fires
// different ones depending on the payment path (REST capture vs. checkout sale
// vs. no-code payment links), so we accept the completed variants.
const CREDIT_TYPES = new Set([
  "PAYMENT.CAPTURE.COMPLETED",
  "PAYMENT.SALE.COMPLETED",
]);

// Extract the settled donation from a verified PayPal event, in WHATEVER
// currency PayPal reports (the account may be non-USD and PayPal converts).
// Returns null only if it's not a completed payment we should credit, or the
// amount/currency can't be read. Currency is recorded, not converted.
export function extractDonation(event: any): ExtractedDonation | null {
  const type = event?.event_type;
  if (!CREDIT_TYPES.has(type)) return null;

  // Credit the NET amount, not the gross. PayPal's fee (~$0.32 on a $1 gift —
  // a third of it) never reaches the account, and this balance is a hard
  // spending ceiling for real AI tokens: crediting gross would authorise spend
  // the account cannot actually cover. Three shapes, in order of preference:
  //   1. capture — seller_receivable_breakdown.net_amount is already gross-fee,
  //   2. sale    — amount.total/value minus transaction_fee,
  //   3. neither — fall back to the gross amount. Slightly generous beats
  //      dropping a real donation on the floor.
  const r = event?.resource;
  let value: unknown;
  let currency: unknown;
  let feeValue = 0;

  const netAmount = r?.seller_receivable_breakdown?.net_amount;
  if (netAmount?.value && (netAmount.currency_code ?? netAmount.currency)) {
    value = netAmount.value;
    currency = netAmount.currency_code ?? netAmount.currency;
  } else {
    const amount = r?.amount;
    value = amount?.value ?? amount?.total;
    currency = amount?.currency_code ?? amount?.currency;
    // v1 sale reports the fee separately, as a positive amount to subtract.
    const parsedFee = Number.parseFloat(String(r?.transaction_fee?.value ?? "0"));
    if (Number.isFinite(parsedFee)) feeValue = Math.abs(parsedFee);
  }
  if (!value || !currency) return null;

  const gross = Number.parseFloat(String(value));
  if (!Number.isFinite(gross)) return null;
  const num = gross - feeValue;
  // A donation wholly consumed by fees credits nothing rather than 0 or less.
  if (num <= 0) return null;

  // Idempotency key. Prefer the TRANSACTION id (`resource.id` — the capture or
  // sale id) over the delivery's event id, because the reconciler
  // (paypalTransactions.ts) sees the same donation as `transaction_id` and must
  // dedupe against it. Two channels, one key, one credit. Falls back to the
  // event id for shapes that carry no resource id.
  const eventId = String(event?.resource?.id ?? event?.id ?? "");
  if (!eventId) return null;

  // Micro-units of the reported currency (PayPal values are 2dp; exact).
  return { eventId, amountMicros: Math.round(num * MICRO), currency: String(currency) };
}
