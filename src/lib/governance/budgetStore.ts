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

export interface BudgetStore {
  // Current balance in micro-USD.
  getBalanceMicros(): Promise<number>;
  // Apply a donation exactly once, keyed by the PayPal event id. Returns
  // whether it was newly applied (false = already seen, no double-credit).
  applyDonation(eventId: string, amountMicros: number): Promise<{ applied: boolean; balanceMicros: number }>;
  // Founder top-up (seed funding). Not idempotency-keyed; call intentionally.
  topUp(amountMicros: number): Promise<number>;
  // Debit for AI spend, hard-stopping at zero (returns false if unaffordable).
  spend(amountMicros: number): Promise<{ ok: boolean; balanceMicros: number }>;
}

// In-memory reference implementation. Deterministic, dependency-free — used by
// tests and as the interface contract. NOT durable across processes.
export class InMemoryBudgetStore implements BudgetStore {
  private balance: number;
  private appliedEventIds = new Set<string>();

  constructor(openingMicros = 0) {
    this.balance = Math.max(0, Math.floor(openingMicros));
  }

  async getBalanceMicros(): Promise<number> {
    return this.balance;
  }

  async applyDonation(eventId: string, amountMicros: number): Promise<{ applied: boolean; balanceMicros: number }> {
    if (!eventId) return { applied: false, balanceMicros: this.balance };
    if (this.appliedEventIds.has(eventId)) {
      // Already credited this event — idempotent no-op.
      return { applied: false, balanceMicros: this.balance };
    }
    if (!Number.isFinite(amountMicros) || amountMicros <= 0) {
      return { applied: false, balanceMicros: this.balance };
    }
    this.appliedEventIds.add(eventId);
    this.balance += Math.floor(amountMicros);
    return { applied: true, balanceMicros: this.balance };
  }

  async topUp(amountMicros: number): Promise<number> {
    if (Number.isFinite(amountMicros) && amountMicros > 0) this.balance += Math.floor(amountMicros);
    return this.balance;
  }

  async spend(amountMicros: number): Promise<{ ok: boolean; balanceMicros: number }> {
    const cost = Math.ceil(Math.max(0, amountMicros));
    if (cost > this.balance) return { ok: false, balanceMicros: this.balance };
    this.balance -= cost;
    return { ok: true, balanceMicros: this.balance };
  }
}

// Human-readable one-liner for logging / the treasury display.
export async function describeBalance(store: BudgetStore): Promise<string> {
  return `Budget balance: ${fmtUsd(await store.getBalanceMicros())}`;
}

export { MICRO };
