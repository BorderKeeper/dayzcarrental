// /api/treasury — read-only budget balance (treasury transparency).
//
// Exposes the AI maintainer's upkeep budget balance so donations are
// observable: after a donation the number should rise. This is the Phase-3
// "public ledger" direction in ROADMAP.md, in miniature. Read-only — no way to
// mutate the balance here; that only happens via a verified PayPal webhook
// (credit) or AI spend (debit).
//
// Reads from the durable Upstash store when configured, else the in-memory
// fallback (which reads 0 on a cold start). No secrets exposed — just a total.

import { NextResponse } from "next/server";
import { RedisBudgetStore, upstashFromEnv } from "@/lib/governance/redisBudgetStore";
import { InMemoryBudgetStore } from "@/lib/governance/budgetStore";
import { fmtUsd, MICRO } from "@/lib/governance/budget";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  const upstash = upstashFromEnv();
  const store = upstash ? new RedisBudgetStore(upstash) : new InMemoryBudgetStore(0);
  let micros = 0;
  try {
    micros = await store.getBalanceMicros();
  } catch {
    // Store unreachable → report unknown rather than a misleading 0.
    return NextResponse.json({ ok: false, durable: !!upstash, error: "budget store unavailable" }, { status: 200 });
  }
  return NextResponse.json({
    ok: true,
    durable: !!upstash,
    balanceUsd: fmtUsd(micros),
    balanceMicros: micros,
    note: "AI maintainer upkeep budget, funded by voluntary donations. Not spendable on gameplay.",
  });
}
