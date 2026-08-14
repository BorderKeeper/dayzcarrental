// budgetStore.ts — durable persistence for the bot's budget, with idempotent
// donation credits.
//
// The BudgetLedger (budget.ts) is an in-memory model — perfect for the engine
// and tests, but a serverless webhook gets a fresh process on every cold start,
// so the running balance must live in a DURABLE store. This module defines the
// minimal interface the /api/paypal route needs, plus an in-memory reference
// implementation for tests.
//
// IDEMPOTENCY is the critical property: PayPal re-delivers webhooks (retries,
// at-least-once delivery), so applying the same donation event twice must NOT
// double-credit. We key on the PayPal event id and record which ids have been
// applied.
//
// PRODUCTION NOTE (founder action, see BOT.md §6): the in-memory store here
// resets on every cold start and is NOT suitable for production — a real
// deployment must back this interface with a durable KV/DB (e.g. Vercel KV /
// Upstash Redis / Postgres). The interface is deliberately tiny so that swap is
// a small, well-scoped change.

import { MICRO, fmtUsd } from "./budget";

// Donations are recorded per currency (the founder's PayPal is CZK-based and
// PayPal converts USD gifts to it), so the store tracks a micro-units balance
// keyed by ISO currency code rather than assuming USD. Spend (AI tokens) is a
// separate USD concern handled by BudgetLedger, not here.
export interface BudgetStore {
  // Total micro-units held in a given currency (default USD for back-compat).
  getBalanceMicros(currency?: string): Promise<number>;
  // All currency balances, ISO code -> micro-units. For the treasury display.
  getBalances(): Promise<Record<string, number>>;
  // Apply a donation exactly once, keyed by the PayPal event id. `currency`
  // defaults to USD. Returns whether it was newly applied (false = already
  // seen → no double-credit) and the resulting balance for that currency.
  // `memo` is stored alongside the idempotency key as a durable audit note —
  // used to record an FX conversion (fxRates.ts) so the rate that booked a
  // donation is recoverable later. It never affects the credit itself.
  applyDonation(
    eventId: string,
    amountMicros: number,
    currency?: string,
    memo?: string,
  ): Promise<{ applied: boolean; balanceMicros: number; currency: string }>;
  // Read back the audit memo a donation was booked with, or null if that id was
  // never applied. This is what makes an FX conversion recoverable after the
  // fact rather than a number that appeared in the balance.
  getDonationMemo(eventId: string): Promise<string | null>;
  // Founder top-up (seed funding). Not idempotency-keyed; call intentionally.
  topUp(amountMicros: number, currency?: string): Promise<number>;
  // Debit for AI spend (USD), hard-stopping at zero (false if unaffordable).
  spend(amountMicros: number, currency?: string): Promise<{ ok: boolean; balanceMicros: number }>;
}

export const DEFAULT_CURRENCY = "USD";

// In-memory reference implementation. Deterministic, dependency-free — used by
// tests and as the interface contract. NOT durable across processes.
export class InMemoryBudgetStore implements BudgetStore {
  private balances = new Map<string, number>();
  // eventId -> audit memo ("1" when there is nothing to note).
  private appliedEventIds = new Map<string, string>();

  constructor(openingMicros = 0, currency = DEFAULT_CURRENCY) {
    if (openingMicros > 0) this.balances.set(currency, Math.floor(openingMicros));
  }

  async getBalanceMicros(currency = DEFAULT_CURRENCY): Promise<number> {
    return this.balances.get(currency) ?? 0;
  }

  async getBalances(): Promise<Record<string, number>> {
    return Object.fromEntries(this.balances);
  }

  async applyDonation(eventId: string, amountMicros: number, currency = DEFAULT_CURRENCY, memo = "1") {
    if (!eventId || !Number.isFinite(amountMicros) || amountMicros <= 0) {
      return { applied: false, balanceMicros: await this.getBalanceMicros(currency), currency };
    }
    if (this.appliedEventIds.has(eventId)) {
      return { applied: false, balanceMicros: await this.getBalanceMicros(currency), currency };
    }
    this.appliedEventIds.set(eventId, memo);
    const next = (this.balances.get(currency) ?? 0) + Math.floor(amountMicros);
    this.balances.set(currency, next);
    return { applied: true, balanceMicros: next, currency };
  }

  async getDonationMemo(eventId: string): Promise<string | null> {
    return this.appliedEventIds.get(eventId) ?? null;
  }

  async topUp(amountMicros: number, currency = DEFAULT_CURRENCY): Promise<number> {
    if (Number.isFinite(amountMicros) && amountMicros > 0) {
      this.balances.set(currency, (this.balances.get(currency) ?? 0) + Math.floor(amountMicros));
    }
    return this.getBalanceMicros(currency);
  }

  async spend(amountMicros: number, currency = DEFAULT_CURRENCY): Promise<{ ok: boolean; balanceMicros: number }> {
    // A non-finite cost must never reach the arithmetic — `bal - NaN` is NaN,
    // and a NaN balance compares false against every guard, silently disabling
    // the ceiling this store exists to enforce.
    const cost = Number.isFinite(amountMicros) ? Math.ceil(Math.max(0, amountMicros)) : 0;
    const bal = this.balances.get(currency) ?? 0;
    if (cost > bal) return { ok: false, balanceMicros: bal };
    this.balances.set(currency, bal - cost);
    return { ok: true, balanceMicros: bal - cost };
  }
}

// Human-readable one-liner for logging / the treasury display.
export async function describeBalance(store: BudgetStore): Promise<string> {
  return `Budget balance: ${fmtUsd(await store.getBalanceMicros())}`;
}

export { MICRO };
