// redisStore.test.ts — verify the durable RedisBudgetStore against a stubbed
// Upstash REST endpoint (an in-memory map that mimics GET/SET-NX/INCRBY/DECRBY).
// The point: donations persist and stay idempotent across "restarts" (a new
// store instance over the same backing map), which the in-memory store can't do.

import { test } from "node:test";
import assert from "node:assert/strict";

import { RedisBudgetStore, upstashFromEnv, type UpstashConfig } from "../redisBudgetStore";
import { MICRO } from "../budget";

// A tiny fake Upstash: one shared map = one "database". Returns a fetchImpl that
// executes the subset of commands the store uses. Sharing the map across store
// instances simulates persistence across cold starts.
function fakeUpstash(db: Map<string, string>): UpstashConfig["fetchImpl"] {
  return async (_url, init) => {
    const args: string[] = JSON.parse((init as any).body);
    const [op, key, val] = args;
    let result: any = null;
    switch (op) {
      case "GET":
        result = db.has(key) ? db.get(key) : null;
        break;
      case "SET":
        if (args[3] === "NX") {
          if (db.has(key)) result = null; // already exists → NX fails
          else {
            db.set(key, val);
            result = "OK";
          }
        } else {
          db.set(key, val);
          result = "OK";
        }
        break;
      case "INCRBY": {
        const cur = Number.parseInt(db.get(key) ?? "0", 10);
        const next = cur + Number.parseInt(val, 10);
        db.set(key, String(next));
        result = next;
        break;
      }
      case "DECRBY": {
        const cur = Number.parseInt(db.get(key) ?? "0", 10);
        const next = cur - Number.parseInt(val, 10);
        db.set(key, String(next));
        result = next;
        break;
      }
    }
    return { ok: true, status: 200, json: async () => ({ result }), text: async () => "" };
  };
}

function storeOn(db: Map<string, string>): RedisBudgetStore {
  return new RedisBudgetStore({ url: "https://fake.upstash.io", token: "t", fetchImpl: fakeUpstash(db) });
}

test("upstashFromEnv: resolves both KV_* and UPSTASH_* names; null when absent", () => {
  assert.deepEqual(upstashFromEnv({ KV_REST_API_URL: "u", KV_REST_API_TOKEN: "t" }), { url: "u", token: "t" });
  assert.deepEqual(
    upstashFromEnv({ UPSTASH_REDIS_REST_URL: "u2", UPSTASH_REDIS_REST_TOKEN: "t2" }),
    { url: "u2", token: "t2" },
  );
  assert.equal(upstashFromEnv({}), null);
});

test("redis store: donation credits, and a re-delivered event is idempotent", async () => {
  const db = new Map<string, string>();
  const store = storeOn(db);

  const first = await store.applyDonation("evt-1", 5 * MICRO);
  assert.equal(first.applied, true);
  assert.equal(first.balanceMicros, 5 * MICRO);

  const dup = await store.applyDonation("evt-1", 5 * MICRO); // PayPal retry
  assert.equal(dup.applied, false);
  assert.equal(dup.balanceMicros, 5 * MICRO);

  const second = await store.applyDonation("evt-2", 3 * MICRO);
  assert.equal(second.applied, true);
  assert.equal(second.balanceMicros, 8 * MICRO);
});

test("redis store: balance PERSISTS across a fresh store instance (cold-start sim)", async () => {
  const db = new Map<string, string>(); // the durable backing store
  await storeOn(db).applyDonation("evt-1", 10 * MICRO);

  // New instance = new serverless invocation. In-memory would be 0 here; Redis
  // reads the persisted value.
  const revived = storeOn(db);
  assert.equal(await revived.getBalanceMicros(), 10 * MICRO);
  // And idempotency still holds against the persisted applied-set.
  const dup = await revived.applyDonation("evt-1", 10 * MICRO);
  assert.equal(dup.applied, false);
  assert.equal(dup.balanceMicros, 10 * MICRO);
});

test("redis store: spend debits and hard-stops at zero", async () => {
  const db = new Map<string, string>();
  const store = storeOn(db);
  await store.topUp(5 * MICRO);

  const ok = await store.spend(2 * MICRO);
  assert.equal(ok.ok, true);
  assert.equal(ok.balanceMicros, 3 * MICRO);

  const tooMuch = await store.spend(100 * MICRO);
  assert.equal(tooMuch.ok, false);
  assert.equal(tooMuch.balanceMicros, 3 * MICRO, "balance unchanged after refused spend");
});
