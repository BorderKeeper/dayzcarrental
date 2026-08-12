// redisBudgetStore.ts — a durable BudgetStore backed by Upstash Redis over its
// REST API.
//
// The in-memory store (budgetStore.ts) resets on every serverless cold start,
// so credited donations would vanish. This implementation persists the balance
// and the applied-event set in Redis, so donations survive restarts and the
// idempotency guard actually holds across invocations.
//
// package.json is LOCKED, so we can't add `@upstash/redis` — instead we call
// Upstash's REST API directly with raw `fetch` (auth: Bearer token). That's
// zero-dependency and runtime-agnostic. The connection comes from env vars that
// Vercel's Upstash/KV integration injects; we accept both the `KV_REST_API_*`
// and `UPSTASH_REDIS_REST_*` naming so it works however the integration names
// them. Injectable fetch → unit-testable against a stubbed Upstash.
//
// Idempotency: a donation credit is a `SET applied:<eventId> 1 NX` (create only
// if absent) followed by `INCRBY balance <micros>` ONLY when the SET created
// the key. Redis executes each command atomically, so a re-delivered event
// whose key already exists never increments the balance.

import type { BudgetStore } from "./budgetStore";

const BALANCE_KEY = "dcr:budget:balance_micros";
const APPLIED_PREFIX = "dcr:budget:applied:";

export interface UpstashConfig {
  url: string; // REST base, e.g. https://xxx.upstash.io
  token: string; // REST bearer token
  fetchImpl?: (url: string, init?: any) => Promise<{ ok: boolean; status: number; json: () => Promise<any>; text: () => Promise<string> }>;
}

// Resolve Upstash REST config from the env var names Vercel may inject. Returns
// null if none are present (caller falls back to the in-memory store).
export function upstashFromEnv(env: Record<string, string | undefined> = process.env): UpstashConfig | null {
  const url = env.KV_REST_API_URL ?? env.UPSTASH_REDIS_REST_URL;
  const token = env.KV_REST_API_TOKEN ?? env.UPSTASH_REDIS_REST_TOKEN;
  if (!url || !token) return null;
  return { url, token };
}

export class RedisBudgetStore implements BudgetStore {
  private cfg: UpstashConfig;
  private fetchImpl: NonNullable<UpstashConfig["fetchImpl"]>;

  constructor(cfg: UpstashConfig) {
    this.cfg = cfg;
    this.fetchImpl = cfg.fetchImpl ?? ((url, init) => fetch(url, init) as any);
  }

  // Run one Redis command via the Upstash REST API. Command is an array like
  // ["INCRBY", key, "5"]. Returns the parsed `result` field.
  private async cmd(args: (string | number)[]): Promise<any> {
    const res = await this.fetchImpl(this.cfg.url, {
      method: "POST",
      headers: { authorization: `Bearer ${this.cfg.token}`, "content-type": "application/json" },
      body: JSON.stringify(args.map(String)),
    });
    if (!res.ok) throw new Error(`Upstash error ${res.status}: ${(await res.text()).slice(0, 200)}`);
    const data = await res.json();
    if (data && typeof data === "object" && "error" in data && data.error) {
      throw new Error(`Upstash command error: ${data.error}`);
    }
    return data?.result;
  }

  async getBalanceMicros(): Promise<number> {
    const v = await this.cmd(["GET", BALANCE_KEY]);
    const n = Number.parseInt(String(v ?? "0"), 10);
    return Number.isFinite(n) && n > 0 ? n : 0;
  }

  async applyDonation(eventId: string, amountMicros: number): Promise<{ applied: boolean; balanceMicros: number }> {
    if (!eventId || !Number.isFinite(amountMicros) || amountMicros <= 0) {
      return { applied: false, balanceMicros: await this.getBalanceMicros() };
    }
    // SET NX returns "OK" if it created the key, null if it already existed.
    const created = await this.cmd(["SET", APPLIED_PREFIX + eventId, "1", "NX"]);
    if (created !== "OK") {
      // Already applied this event → idempotent no-op, no increment.
      return { applied: false, balanceMicros: await this.getBalanceMicros() };
    }
    const newBalance = await this.cmd(["INCRBY", BALANCE_KEY, Math.floor(amountMicros)]);
    return { applied: true, balanceMicros: Number.parseInt(String(newBalance), 10) };
  }

  async topUp(amountMicros: number): Promise<number> {
    if (!Number.isFinite(amountMicros) || amountMicros <= 0) return this.getBalanceMicros();
    const newBalance = await this.cmd(["INCRBY", BALANCE_KEY, Math.floor(amountMicros)]);
    return Number.parseInt(String(newBalance), 10);
  }

  async spend(amountMicros: number): Promise<{ ok: boolean; balanceMicros: number }> {
    const cost = Math.ceil(Math.max(0, amountMicros));
    // Read-modify-write with a guard. INCRBY is atomic, but "don't go below
    // zero" isn't a single Redis op without a Lua script; we read, check, then
    // DECRBY. For this workload (one spender: the AI builder, serialized per
    // build) the race window is negligible, and a DECRBY that would cross zero
    // is corrected by clamping. Documented tradeoff.
    const balance = await this.getBalanceMicros();
    if (cost > balance) return { ok: false, balanceMicros: balance };
    const after = await this.cmd(["DECRBY", BALANCE_KEY, cost]);
    let n = Number.parseInt(String(after), 10);
    if (n < 0) {
      // A concurrent spend pushed us negative — clamp back to 0.
      await this.cmd(["SET", BALANCE_KEY, "0"]);
      n = 0;
    }
    return { ok: true, balanceMicros: n };
  }
}
