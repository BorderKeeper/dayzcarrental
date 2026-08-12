// /api/paypal — the donation webhook endpoint.
//
// PayPal POSTs here when a donation completes. The flow (COMPLIANCE.md: real
// money is donations only, funding upkeep incl. AI tokens):
//   1. verify the webhook signature with PayPal (reject if not genuine),
//   2. extract the USD amount from a completed capture/sale event,
//   3. idempotently credit the bot's budget store (PayPal re-delivers; the
//      event id is the idempotency key so we never double-credit).
//
// Node.js runtime; needs the raw body for verification. Secrets/config come
// from the environment, NEVER the repo (CLAUDE.md rule 2):
//   - PAYPAL_CLIENT_ID / PAYPAL_CLIENT_SECRET  (mint the verify token)
//   - PAYPAL_WEBHOOK_ID                         (binds the signature)
//   - PAYPAL_ENV = "live" | "sandbox"           (default live)
//
// Fails closed: with PayPal not configured it 503s; an unverifiable delivery
// 401s and credits nothing. Uses an in-memory store by default — a durable
// store is a founder-provisioned swap (see BOT.md §6 / FOLLOWUPS.md).

import { NextResponse } from "next/server";
import { verifyPaypalWebhook, extractDonation, type PaypalConfig } from "@/lib/governance/paypalVerify";
import { InMemoryBudgetStore, type BudgetStore } from "@/lib/governance/budgetStore";
import { RedisBudgetStore, upstashFromEnv } from "@/lib/governance/redisBudgetStore";
import { fmtUsd } from "@/lib/governance/budget";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Pick the store: durable Upstash Redis when its env vars are present
// (survives cold starts, real idempotency), else the in-memory fallback (warm
// instance only — fine for a sandbox smoke test, not production). Resolved per
// request so setting the env + redeploying flips it on with no code change.
function pickStore(): { store: BudgetStore; durable: boolean } {
  const upstash = upstashFromEnv();
  if (upstash) return { store: new RedisBudgetStore(upstash), durable: true };
  return { store: memoryFallback, durable: false };
}
const memoryFallback: BudgetStore = new InMemoryBudgetStore(0);

export async function POST(request: Request) {
  const clientId = process.env.PAYPAL_CLIENT_ID;
  const clientSecret = process.env.PAYPAL_CLIENT_SECRET;
  const webhookId = process.env.PAYPAL_WEBHOOK_ID;
  if (!clientId || !clientSecret || !webhookId) {
    return NextResponse.json({ error: "Donations not configured" }, { status: 503 });
  }

  const cfg: PaypalConfig = {
    clientId,
    clientSecret,
    webhookId,
    env: process.env.PAYPAL_ENV === "sandbox" ? "sandbox" : "live",
  };

  const rawBody = await request.text(); // exact bytes — required for verification
  const h = request.headers;
  const verified = await verifyPaypalWebhook(
    cfg,
    {
      transmissionId: h.get("paypal-transmission-id") ?? "",
      transmissionTime: h.get("paypal-transmission-time") ?? "",
      transmissionSig: h.get("paypal-transmission-sig") ?? "",
      certUrl: h.get("paypal-cert-url") ?? "",
      authAlgo: h.get("paypal-auth-algo") ?? "",
    },
    rawBody,
  );
  if (!verified) {
    return new NextResponse("invalid webhook signature", { status: 401 });
  }

  let event: any;
  try {
    event = JSON.parse(rawBody);
  } catch {
    return new NextResponse("bad request", { status: 400 });
  }

  const donation = extractDonation(event);
  if (!donation) {
    // Verified, but not a completed USD payment we credit (e.g. a non-payment
    // event, a refund, or a non-USD amount). Acknowledge so PayPal stops
    // retrying; credit nothing.
    return NextResponse.json({ ok: true, credited: false });
  }

  const { store, durable } = pickStore();
  const { applied, balanceMicros } = await store.applyDonation(donation.eventId, donation.amountMicros);
  return NextResponse.json({
    ok: true,
    credited: applied, // false = already applied (idempotent re-delivery)
    durable, // false = in-memory fallback (balance won't persist across cold starts)
    balance: fmtUsd(balanceMicros),
  });
}
