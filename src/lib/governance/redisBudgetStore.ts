// redisBudgetStore.ts — a durable BudgetStore backed by Redis over the RESP
// wire protocol (redisClient.ts), connecting via REDIS_URL.
//
// The in-memory store (budgetStore.ts) resets on every serverless cold start,
// so credited donations would vanish. This persists the balance and the
// applied-event set in Redis so donations survive restarts and the idempotency
// guard holds across invocations.
//
// package.json is LOCKED, so we can't `npm install redis` — we speak RESP
// directly over node:net/tls (see redisClient.ts). Connection is REDIS_URL,
// the standard var Vercel's Redis integration provides.
//
// Idempotency: a donation credit is `SET applied:<eventId> 1 NX` (create only
// if absent) then `INCRBY balance <micros>` ONLY when the SET created the key.
// A re-delivered event whose key already exists never increments the balance.

import type { BudgetStore } from "./budgetStore";
import { redisPipeline, type SocketFactory } from "./redisClient";

const BALANCE_KEY = "dcr:budget:balance_micros";
const APPLIED_PREFIX = "dcr:budget:applied:";

export interface RedisConfig {
  url: string; // REDIS_URL (redis:// or rediss://)
  socketFactory?: SocketFactory; // injectable for tests
}

// Resolve the Redis connection URL from env. Returns null if absent (caller
// falls back to the in-memory store). Accepts REDIS_URL (Vercel Redis) and the
// common KV_URL alias.
export function redisUrlFromEnv(env: Record<string, string | undefined> = process.env): string | null {
  return env.REDIS_URL ?? env.KV_URL ?? null;
}

// Back-compat shim: the old name some callers imported. Now returns a RedisConfig
// (url form) when REDIS_URL is present, else null.
export function upstashFromEnv(env: Record<string, string | undefined> = process.env): RedisConfig | null {
  const url = redisUrlFromEnv(env);
  return url ? { url } : null;
}

export class RedisBudgetStore implements BudgetStore {
  private url: string;
  private socketFactory?: SocketFactory;

  constructor(cfg: RedisConfig) {
    this.url = cfg.url;
    this.socketFactory = cfg.socketFactory;
  }

  private run(...commands: (string | number)[][]): Promise<any[]> {
    return redisPipeline(this.url, commands, { socketFactory: this.socketFactory });
  }

  async getBalanceMicros(): Promise<number> {
    const [v] = await this.run(["GET", BALANCE_KEY]);
    const n = Number.parseInt(String(v ?? "0"), 10);
    return Number.isFinite(n) && n > 0 ? n : 0;
  }

  async applyDonation(eventId: string, amountMicros: number): Promise<{ applied: boolean; balanceMicros: number }> {
    if (!eventId || !Number.isFinite(amountMicros) || amountMicros <= 0) {
      return { applied: false, balanceMicros: await this.getBalanceMicros() };
    }
    // SET NX → "OK" if it created the key, null if it already existed.
    const [created] = await this.run(["SET", APPLIED_PREFIX + eventId, "1", "NX"]);
    if (created !== "OK") {
      return { applied: false, balanceMicros: await this.getBalanceMicros() };
    }
    const [newBalance] = await this.run(["INCRBY", BALANCE_KEY, Math.floor(amountMicros)]);
    return { applied: true, balanceMicros: Number.parseInt(String(newBalance), 10) };
  }

  async topUp(amountMicros: number): Promise<number> {
    if (!Number.isFinite(amountMicros) || amountMicros <= 0) return this.getBalanceMicros();
    const [newBalance] = await this.run(["INCRBY", BALANCE_KEY, Math.floor(amountMicros)]);
    return Number.parseInt(String(newBalance), 10);
  }

  async spend(amountMicros: number): Promise<{ ok: boolean; balanceMicros: number }> {
    const cost = Math.ceil(Math.max(0, amountMicros));
    // Read-check-write. INCRBY/DECRBY are atomic, but "don't cross zero" isn't a
    // single op without Lua. The only spender (the AI builder, serialized per
    // build) makes the race window negligible; a DECRBY that crosses zero is
    // clamped back. Documented tradeoff.
    const balance = await this.getBalanceMicros();
    if (cost > balance) return { ok: false, balanceMicros: balance };
    const [after] = await this.run(["DECRBY", BALANCE_KEY, cost]);
    let n = Number.parseInt(String(after), 10);
    if (n < 0) {
      await this.run(["SET", BALANCE_KEY, "0"]);
      n = 0;
    }
    return { ok: true, balanceMicros: n };
  }
}
