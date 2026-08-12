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

import { DEFAULT_CURRENCY, type BudgetStore } from "./budgetStore";
import { redisPipeline, type SocketFactory } from "./redisClient";

// Balance is per-currency: dcr:budget:balance:<CUR>. A set of seen currencies
// lets the treasury display enumerate them. Applied-event ids dedupe donations.
const BALANCE_PREFIX = "dcr:budget:balance:";
const CURRENCIES_KEY = "dcr:budget:currencies";
const APPLIED_PREFIX = "dcr:budget:applied:";
const balKey = (cur: string) => BALANCE_PREFIX + cur;

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

  async getBalanceMicros(currency = DEFAULT_CURRENCY): Promise<number> {
    const [v] = await this.run(["GET", balKey(currency)]);
    const n = Number.parseInt(String(v ?? "0"), 10);
    return Number.isFinite(n) && n > 0 ? n : 0;
  }

  async getBalances(): Promise<Record<string, number>> {
    const [members] = await this.run(["SMEMBERS", CURRENCIES_KEY]);
    const currencies: string[] = Array.isArray(members) ? members.map(String) : [];
    const out: Record<string, number> = {};
    for (const cur of currencies) out[cur] = await this.getBalanceMicros(cur);
    return out;
  }

  async applyDonation(eventId: string, amountMicros: number, currency = DEFAULT_CURRENCY) {
    if (!eventId || !Number.isFinite(amountMicros) || amountMicros <= 0) {
      return { applied: false, balanceMicros: await this.getBalanceMicros(currency), currency };
    }
    // SET NX → "OK" if it created the key, null if it already existed.
    const [created] = await this.run(["SET", APPLIED_PREFIX + eventId, "1", "NX"]);
    if (created !== "OK") {
      return { applied: false, balanceMicros: await this.getBalanceMicros(currency), currency };
    }
    const [newBalance] = await this.run(
      ["INCRBY", balKey(currency), Math.floor(amountMicros)],
      ["SADD", CURRENCIES_KEY, currency],
    );
    return { applied: true, balanceMicros: Number.parseInt(String(newBalance), 10), currency };
  }

  async topUp(amountMicros: number, currency = DEFAULT_CURRENCY): Promise<number> {
    if (!Number.isFinite(amountMicros) || amountMicros <= 0) return this.getBalanceMicros(currency);
    const [newBalance] = await this.run(
      ["INCRBY", balKey(currency), Math.floor(amountMicros)],
      ["SADD", CURRENCIES_KEY, currency],
    );
    return Number.parseInt(String(newBalance), 10);
  }

  async spend(amountMicros: number, currency = DEFAULT_CURRENCY): Promise<{ ok: boolean; balanceMicros: number }> {
    const cost = Math.ceil(Math.max(0, amountMicros));
    // Read-check-write; the only spender (AI builder) is serialized, so the
    // race window is negligible; a DECRBY crossing zero is clamped back.
    const balance = await this.getBalanceMicros(currency);
    if (cost > balance) return { ok: false, balanceMicros: balance };
    const [after] = await this.run(["DECRBY", balKey(currency), cost]);
    let n = Number.parseInt(String(after), 10);
    if (n < 0) {
      await this.run(["SET", balKey(currency), "0"]);
      n = 0;
    }
    return { ok: true, balanceMicros: n };
  }
}
