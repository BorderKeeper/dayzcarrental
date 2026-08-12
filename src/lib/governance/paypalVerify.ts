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
export interface ExtractedDonation {
  eventId: string; // PayPal event id — the idempotency key
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

  // The amount lives at resource.amount for both capture and sale events;
  // `currency_code` (capture) or `currency` (sale) carries the ISO code. For a
  // converted payment PayPal reports the settled amount here in the account's
  // currency (e.g. CZK).
  const amount = event?.resource?.amount ?? event?.resource?.seller_receivable_breakdown?.net_amount;
  const value = amount?.value;
  const currency = amount?.currency_code ?? amount?.currency;
  if (!value || !currency) return null;

  const num = Number.parseFloat(String(value));
  if (!Number.isFinite(num) || num <= 0) return null;

  const eventId = String(event?.id ?? "");
  if (!eventId) return null;

  // Micro-units of the reported currency (PayPal values are 2dp; exact).
  return { eventId, amountMicros: Math.round(num * MICRO), currency: String(currency) };
}
