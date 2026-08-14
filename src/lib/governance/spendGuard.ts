// spendGuard.ts — the thing that makes the donation balance actually BINDING.
//
// Until now the two halves of the money model never touched:
//   * donations credited a DURABLE per-currency balance (budgetStore.ts, Redis),
//   * the build loop debited an OPTIONAL IN-MEMORY BudgetLedger (budget.ts) —
//     and scripts/ai-build.mjs passed none, so real builds spent uncapped
//     (FOLLOWUPS.md item 1).
// A SpendGuard is the adapter between them: one async interface the build loop
// pre-checks and debits against, with an in-memory implementation for tests and
// a durable one for CI. Donated money is now the ceiling in fact, not just on
// paper.
//
// COMPLIANCE.md: this only ever DEBITS AI-token spend from donated upkeep
// funds. It cannot pay anyone, price a rental, or gate gameplay — and it has no
// path to increase a balance at all.
//
// Contract, deliberately non-throwing (the build loop must stop cleanly, not
// crash mid-build): spend() debits what it can, clamps at zero, and reports the
// shortfall. canAfford() is the gate that should prevent a shortfall ever
// happening; a shortfall means the estimate was wrong, not that overspend was
// permitted.

import { BudgetLedger, InsufficientBudgetError, MICRO, fmtUsd } from "./budget";
import { DEFAULT_CURRENCY, type BudgetStore } from "./budgetStore";

// A cost that isn't a positive finite number debits NOTHING. Without this a
// NaN — say, from a malformed usage block in an API response — propagates
// straight into the arithmetic and turns the stored balance into NaN, which
// then compares false against every check and silently disables the ceiling.
function sanitizeCost(amountMicros: number): number {
  if (!Number.isFinite(amountMicros) || amountMicros <= 0) return 0;
  return Math.ceil(amountMicros);
}

export interface SpendOutcome {
  debitedMicros: number; // what actually came out
  balanceMicros: number; // what's left afterwards
  shortfall: boolean; // true = the cost exceeded the balance; we clamped
}

export interface SpendGuard {
  readonly currency: string;
  // Gate BEFORE an AI call. False → do not make the call.
  canAfford(amountMicros: number): Promise<boolean>;
  // Debit AFTER the call, from real usage. Never throws, never goes negative.
  spend(amountMicros: number, detail: string): Promise<SpendOutcome>;
  balance(): Promise<number>;
  // Cumulative debits made through THIS guard — for the build report.
  totalSpentMicros(): number;
}

// --- in-memory (tests, local runs) -----------------------------------------
// Wraps the pure BudgetLedger so the same build loop drives both. Translates
// the ledger's throwing overspend into the clamped contract above.
export function ledgerGuard(ledger: BudgetLedger, currency = DEFAULT_CURRENCY): SpendGuard {
  let spent = 0;
  return {
    currency,
    async canAfford(amountMicros) {
      return ledger.canAfford(amountMicros);
    },
    async spend(amountMicros, detail) {
      const cost = sanitizeCost(amountMicros);
      if (cost === 0) return { debitedMicros: 0, balanceMicros: ledger.balanceMicros, shortfall: false };
      try {
        ledger.spend(cost, detail);
        spent += cost;
        return { debitedMicros: cost, balanceMicros: ledger.balanceMicros, shortfall: false };
      } catch (e) {
        if (!(e instanceof InsufficientBudgetError)) throw e;
        // Drain to zero rather than leave phantom credit behind.
        const remaining = ledger.balanceMicros;
        if (remaining > 0) ledger.spend(remaining, `${detail}: partial at zero`);
        spent += remaining;
        return { debitedMicros: remaining, balanceMicros: 0, shortfall: true };
      }
    },
    async balance() {
      return ledger.balanceMicros;
    },
    totalSpentMicros: () => spent,
  };
}

// --- durable (CI builds) ---------------------------------------------------
// Backed by the Redis store donations credit. Spends from ONE currency.
//
// KNOWN LIMITATION — non-spendable balances: the store holds a balance PER
// currency, and this guard debits `currency` (default USD) only. The founder's
// PayPal is CZK-based, so a donation PayPal reports in CZK lands in a CZK
// balance that AI spend cannot draw on, and a build refuses as if broke while
// the treasury shows funds. No FX conversion is done deliberately — inventing a
// rate would misstate real money. See FOLLOWUPS.md item 4.
export function storeGuard(store: BudgetStore, currency = DEFAULT_CURRENCY): SpendGuard {
  let spent = 0;
  return {
    currency,
    async canAfford(amountMicros) {
      if (!Number.isFinite(amountMicros) || amountMicros < 0) return false;
      return (await store.getBalanceMicros(currency)) >= amountMicros;
    },
    async spend(amountMicros, _detail) {
      const cost = sanitizeCost(amountMicros);
      if (cost === 0) return { debitedMicros: 0, balanceMicros: await store.getBalanceMicros(currency), shortfall: false };
      const first = await store.spend(cost, currency);
      if (first.ok) {
        spent += cost;
        return { debitedMicros: cost, balanceMicros: first.balanceMicros, shortfall: false };
      }
      // Couldn't afford the full cost: the store refused without debiting, so
      // take what's actually there and stop at zero.
      const remaining = first.balanceMicros;
      if (remaining > 0) {
        const drain = await store.spend(remaining, currency);
        spent += remaining;
        return { debitedMicros: remaining, balanceMicros: drain.balanceMicros, shortfall: true };
      }
      return { debitedMicros: 0, balanceMicros: remaining, shortfall: true };
    },
    async balance() {
      return store.getBalanceMicros(currency);
    },
    totalSpentMicros: () => spent,
  };
}

// One-line spend report for the build PR body / CI log.
export async function describeSpend(guard: SpendGuard): Promise<string> {
  const spent = guard.totalSpentMicros();
  const left = await guard.balance();
  const unit = guard.currency === "USD" ? fmtUsd : (m: number) => `${(m / MICRO).toFixed(4)} ${guard.currency}`;
  return `Spent ${unit(spent)} of donated funds; ${unit(left)} remaining.`;
}
