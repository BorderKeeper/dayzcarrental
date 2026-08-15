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
import { MICRO } from "@/lib/governance/budget";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  const upstash = upstashFromEnv();
  const store = upstash ? new RedisBudgetStore(upstash) : new InMemoryBudgetStore(0);
  let balances: Record<string, number> = {};
  try {
    balances = await store.getBalances();
  } catch {
    // Store unreachable → report unknown rather than a misleading 0.
    return NextResponse.json({ ok: false, durable: !!upstash, error: "budget store unavailable" }, { status: 200 });
  }
  // Human-readable per-currency totals, e.g. { USD: "$1.45", CZK: "13.83" }.
  //
  // Rounded to cents on purpose: this is a public-facing money figure, and
  // "$1.4534" reads as unfinished. The engine's own `fmtUsd` keeps 4dp because
  // sub-cent precision matters for AI token spend — that is not this. The exact
  // value is still available untouched in `balancesMicros` below.
  const display: Record<string, string> = {};
  for (const [cur, micros] of Object.entries(balances)) {
    const amount = (micros / MICRO).toFixed(2);
    display[cur] = cur === "USD" ? `$${amount}` : amount;
  }
  return NextResponse.json({
    ok: true,
    durable: !!upstash,
    balances: display,
    balancesMicros: balances,
    note: "AI maintainer upkeep budget, funded by voluntary donations. Not spendable on gameplay.",
  });
}
