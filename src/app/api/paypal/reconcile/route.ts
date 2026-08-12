// /api/paypal/reconcile — the donation poller (webhook backstop).
//
// Vercel Cron hits this on a schedule (vercel.json). It reads the last N days
// of PayPal's own transaction ledger and credits any completed donation the
// webhook missed. Because both channels key idempotency on the PayPal
// transaction id, a donation seen twice credits ONCE — so this is safe to run
// alongside a working /api/paypal, and safe to re-run by hand.
//
// Env (founder-provisioned, never in the repo — CLAUDE.md rule 2):
//   - PAYPAL_CLIENT_ID / PAYPAL_CLIENT_SECRET   (app must have Transaction Search enabled)
//   - PAYPAL_ENV = "live" | "sandbox"           (default live)
//   - CRON_SECRET                               (Vercel Cron sends it as a Bearer token)
//   - REDIS_URL                                 (durable store; required — see below)
//   - PAYPAL_RECONCILE_DAYS                     (optional lookback, default 7, max 31)
//
// Fails closed on every axis: no CRON_SECRET → 503 (never leave a
// budget-mutating endpoint open), bad token → 401, no durable store → 503,
// PayPal error → 502 with the reason. `?dry=1` reports what it WOULD credit
// without touching the balance.

import { NextResponse } from "next/server";
import { timingSafeEqual } from "node:crypto";
import { listDonations, reconcileWindow, type PaypalCreds } from "@/lib/governance/paypalTransactions";
import { RedisBudgetStore, upstashFromEnv } from "@/lib/governance/redisBudgetStore";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const DEFAULT_LOOKBACK_DAYS = 7;

// Constant-time compare; length mismatch short-circuits (lengths aren't secret).
function secretMatches(presented: string, expected: string): boolean {
  const a = Buffer.from(presented);
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}

async function handle(request: Request): Promise<NextResponse> {
  const cronSecret = process.env.CRON_SECRET;
  if (!cronSecret) {
    return NextResponse.json({ error: "Reconcile not configured (CRON_SECRET unset)" }, { status: 503 });
  }
  const presented = (request.headers.get("authorization") ?? "").replace(/^Bearer\s+/i, "");
  if (!presented || !secretMatches(presented, cronSecret)) {
    return new NextResponse("unauthorized", { status: 401 });
  }

  const clientId = process.env.PAYPAL_CLIENT_ID;
  const clientSecret = process.env.PAYPAL_CLIENT_SECRET;
  if (!clientId || !clientSecret) {
    return NextResponse.json({ error: "Donations not configured" }, { status: 503 });
  }
  const creds: PaypalCreds = {
    clientId,
    clientSecret,
    env: process.env.PAYPAL_ENV === "sandbox" ? "sandbox" : "live",
  };

  // The whole point is a balance that survives cold starts. Crediting the
  // in-memory fallback would discard the applied-id set with the process, so
  // refuse rather than pretend.
  const redis = upstashFromEnv();
  if (!redis) {
    return NextResponse.json({ error: "Reconcile requires a durable store (REDIS_URL unset)" }, { status: 503 });
  }
  const store = new RedisBudgetStore(redis);

  const days = Number.parseInt(process.env.PAYPAL_RECONCILE_DAYS ?? "", 10) || DEFAULT_LOOKBACK_DAYS;
  const window = reconcileWindow(days);
  const dryRun = new URL(request.url).searchParams.get("dry") === "1";

  let donations;
  try {
    donations = await listDonations(creds, window);
  } catch (err) {
    return NextResponse.json(
      { ok: false, error: err instanceof Error ? err.message : "PayPal transaction search failed" },
      { status: 502 },
    );
  }

  // Credit each; `applied: false` means some channel already booked it.
  const credited: { transactionId: string; currency: string; amountMicros: number; time: string }[] = [];
  let alreadyApplied = 0;
  for (const d of donations) {
    if (dryRun) {
      credited.push(d);
      continue;
    }
    const { applied } = await store.applyDonation(d.transactionId, d.amountMicros, d.currency);
    if (applied) credited.push(d);
    else alreadyApplied++;
  }

  return NextResponse.json({
    ok: true,
    dryRun,
    window,
    scanned: donations.length,
    credited,
    alreadyApplied,
    balancesMicros: await store.getBalances(),
  });
}

// Vercel Cron issues a GET; POST is here for a manual `curl -X POST` run.
export async function GET(request: Request) {
  return handle(request);
}
export async function POST(request: Request) {
  return handle(request);
}
