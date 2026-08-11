// budget.ts — the AI maintainer bot's spending ledger.
//
// The founder's rule, enforced structurally: money only ever flows IN
// automatically (an initial founder top-up, then donations); the bot spends
// only what is in the bank; the bot never tops itself up and never exceeds
// budget. The donation balance *is* the ceiling — spend hard-stops at zero.
//
// COMPLIANCE.md alignment: this funds *upkeep* — "voluntary PayPal donations
// fund upkeep (hosting, AI tokens, tools)" — which is exactly what donations
// are allowed to pay for. It does NOT gate gameplay, price a rental, or pay
// anyone real money. The ledger only ever debits AI-token spend; it has no
// path to a rental, a payout, or a per-player advantage.
//
// Pure and dependency-free. Amounts are integer **micro-USD** (1 USD =
// 1_000_000 µ$) so there is no floating-point drift across thousands of small
// per-request debits. The ledger is append-only: every credit and debit is an
// entry, and the balance is their sum — so the treasury is auditable, matching
// the Phase-3 "public ledger" direction in ROADMAP.md.

export const MICRO = 1_000_000; // micro-USD per USD

export type LedgerReason =
  | "founder-topup" // initial / manual founder credit
  | "donation" // automatic inflow from a donation
  | "ai-spend"; // debit for an AI API call

export interface LedgerEntry {
  seq: number;
  // Positive = credit (money in), negative = debit (money spent).
  amountMicros: number;
  reason: LedgerReason;
  detail: string;
  // Running balance immediately after this entry, for easy auditing.
  balanceMicros: number;
}

// Thrown when the bot tries to spend more than the bank holds. Callers should
// treat this as "stop", never as "top up and retry".
export class InsufficientBudgetError extends Error {
  readonly balanceMicros: number;
  readonly requestedMicros: number;
  constructor(balanceMicros: number, requestedMicros: number) {
    super(
      `Insufficient budget: balance ${fmtUsd(balanceMicros)}, need ${fmtUsd(requestedMicros)}. ` +
        `The bot spends only what donations have funded; it does not top itself up.`,
    );
    this.name = "InsufficientBudgetError";
    this.balanceMicros = balanceMicros;
    this.requestedMicros = requestedMicros;
  }
}

export function fmtUsd(micros: number): string {
  return `$${(micros / MICRO).toFixed(4)}`;
}

export class BudgetLedger {
  private entries: LedgerEntry[] = [];
  private balance = 0; // micro-USD; never negative by construction

  constructor(openingTopupMicros = 0) {
    if (openingTopupMicros > 0) {
      this.credit(openingTopupMicros, "founder-topup", "Opening balance");
    }
  }

  get balanceMicros(): number {
    return this.balance;
  }

  // Money in. The ONLY way the balance rises. `donate` and `topUp` are thin
  // wrappers so the audit trail records intent. There is deliberately no
  // "auto top-up from anywhere the bot controls" — a donation is an external
  // event the bot records, never one it initiates.
  private credit(amountMicros: number, reason: LedgerReason, detail: string): LedgerEntry {
    if (!Number.isFinite(amountMicros) || amountMicros <= 0) {
      throw new Error("Credit amount must be a positive number of micro-USD.");
    }
    this.balance += Math.floor(amountMicros);
    return this.record(Math.floor(amountMicros), reason, detail);
  }

  // A donation flows automatically into the bot's account (COMPLIANCE.md: real
  // money is donations only, funding upkeep incl. AI tokens).
  donate(amountMicros: number, detail = "PayPal donation"): LedgerEntry {
    return this.credit(amountMicros, "donation", detail);
  }

  // A founder top-up — the initial funding the founder seeds, before donations
  // are flowing.
  topUp(amountMicros: number, detail = "Founder top-up"): LedgerEntry {
    return this.credit(amountMicros, "founder-topup", detail);
  }

  // Can the bank afford this spend right now? Callers MUST check before an AI
  // call and refuse if false — the bot never runs a call it can't pay for.
  canAfford(amountMicros: number): boolean {
    return amountMicros >= 0 && this.balance >= amountMicros;
  }

  // Spend. Hard-stops at zero: throws InsufficientBudgetError rather than going
  // negative, so the bot can never overspend the donated pool.
  spend(amountMicros: number, detail: string): LedgerEntry {
    if (!Number.isFinite(amountMicros) || amountMicros < 0) {
      throw new Error("Spend amount must be a non-negative number of micro-USD.");
    }
    const cost = Math.ceil(amountMicros); // round spend UP so we never under-charge the bank
    if (cost > this.balance) {
      throw new InsufficientBudgetError(this.balance, cost);
    }
    this.balance -= cost;
    return this.record(-cost, "ai-spend", detail);
  }

  private record(amountMicros: number, reason: LedgerReason, detail: string): LedgerEntry {
    const entry: LedgerEntry = {
      seq: this.entries.length + 1,
      amountMicros,
      reason,
      detail,
      balanceMicros: this.balance,
    };
    this.entries.push(entry);
    return entry;
  }

  // Read-only audit snapshot (copy, so history can't be mutated).
  history(): LedgerEntry[] {
    return this.entries.map((e) => ({ ...e }));
  }

  // Totals for a treasury display.
  summary(): { balanceMicros: number; totalInMicros: number; totalSpentMicros: number } {
    let totalIn = 0;
    let totalSpent = 0;
    for (const e of this.entries) {
      if (e.amountMicros > 0) totalIn += e.amountMicros;
      else totalSpent += -e.amountMicros;
    }
    return { balanceMicros: this.balance, totalInMicros: totalIn, totalSpentMicros: totalSpent };
  }
}
