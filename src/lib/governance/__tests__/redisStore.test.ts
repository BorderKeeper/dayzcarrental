// redisStore.test.ts — verify the durable RedisBudgetStore against a FAKE
// Redis socket that speaks just enough RESP (GET / SET NX / INCRBY / DECRBY /
// AUTH) backed by an in-memory map. Sharing the map across store instances
// simulates persistence across serverless cold starts — the thing the
// in-memory store can't do.
//
// No real network: we inject a socketFactory that returns a scripted duplex.

import { test } from "node:test";
import assert from "node:assert/strict";
import { EventEmitter } from "node:events";

import { RedisBudgetStore, redisUrlFromEnv } from "../redisBudgetStore";
import { parseRedisUrl } from "../redisClient";
import { MICRO } from "../budget";

// Parse a RESP command (array of bulk strings) from the client's write buffer.
// Returns [command, bytesConsumed] or null if incomplete.
function parseCommand(buf: string, off: number): [string[], number] | null {
  if (buf[off] !== "*") return null;
  const l1 = buf.indexOf("\r\n", off);
  if (l1 === -1) return null;
  const n = Number.parseInt(buf.slice(off + 1, l1), 10);
  let p = l1 + 2;
  const args: string[] = [];
  for (let i = 0; i < n; i++) {
    if (buf[p] !== "$") return null;
    const l = buf.indexOf("\r\n", p);
    if (l === -1) return null;
    const len = Number.parseInt(buf.slice(p + 1, l), 10);
    const start = l + 2;
    if (start + len + 2 > buf.length) return null;
    args.push(buf.slice(start, start + len));
    p = start + len + 2;
  }
  return [args, p - off];
}

function encodeReply(v: string | number | null): string {
  if (v === null) return "$-1\r\n";
  if (typeof v === "number") return `:${v}\r\n`;
  if (v === "OK") return "+OK\r\n";
  return `$${Buffer.byteLength(v)}\r\n${v}\r\n`;
}

// A fake socket: on write, parse commands, execute against `db`, emit replies.
function fakeSocketFactory(db: Map<string, string>) {
  return () => {
    const sock: any = new EventEmitter();
    sock.write = (data: string) => {
      let off = 0;
      const out: string[] = [];
      while (off < data.length) {
        const parsed = parseCommand(data, off);
        if (!parsed) break;
        const [args, used] = parsed;
        off += used;
        const op = args[0].toUpperCase();
        if (op === "AUTH") {
          out.push("+OK\r\n");
        } else if (op === "GET") {
          out.push(encodeReply(db.has(args[1]) ? db.get(args[1])! : null));
        } else if (op === "SET") {
          const nx = args[3]?.toUpperCase() === "NX";
          if (nx && db.has(args[1])) out.push(encodeReply(null));
          else {
            db.set(args[1], args[2]);
            out.push(encodeReply("OK"));
          }
        } else if (op === "INCRBY" || op === "DECRBY") {
          const cur = Number.parseInt(db.get(args[1]) ?? "0", 10);
          const delta = Number.parseInt(args[2], 10) * (op === "DECRBY" ? -1 : 1);
          const next = cur + delta;
          db.set(args[1], String(next));
          out.push(encodeReply(next));
        }
      }
      // Deliver replies asynchronously, like a real socket.
      setImmediate(() => sock.emit("data", Buffer.from(out.join(""))));
      return true;
    };
    sock.end = () => {};
    sock.destroy = () => {};
    // Fire connect on next tick so the client writes its commands.
    setImmediate(() => sock.emit("connect"));
    return sock;
  };
}

function storeOn(db: Map<string, string>): RedisBudgetStore {
  return new RedisBudgetStore({ url: "redis://default:pw@localhost:6379", socketFactory: fakeSocketFactory(db) });
}

test("parseRedisUrl: extracts host/port/creds/tls from redis:// and rediss://", () => {
  const a = parseRedisUrl("redis://default:secret@h.example:19660");
  assert.equal(a.host, "h.example");
  assert.equal(a.port, 19660);
  assert.equal(a.username, "default");
  assert.equal(a.password, "secret");
  assert.equal(a.tls, false);
  const b = parseRedisUrl("rediss://h2:6380");
  assert.equal(b.tls, true);
  assert.equal(b.port, 6380);
});

test("redisUrlFromEnv: resolves REDIS_URL / KV_URL; null when absent", () => {
  assert.equal(redisUrlFromEnv({ REDIS_URL: "redis://x" }), "redis://x");
  assert.equal(redisUrlFromEnv({ KV_URL: "redis://y" }), "redis://y");
  assert.equal(redisUrlFromEnv({}), null);
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
  const db = new Map<string, string>();
  await storeOn(db).applyDonation("evt-1", 10 * MICRO);

  const revived = storeOn(db); // new instance, same backing store
  assert.equal(await revived.getBalanceMicros(), 10 * MICRO);
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
