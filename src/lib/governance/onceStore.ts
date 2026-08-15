// onceStore.ts — "has this already happened?" claims, backed by Redis.
//
// Motivation: /tally on an approved proposal fires a GitHub repository_dispatch
// that runs the AI feature-builder, which spends the real donation balance.
// The dispatch had no idempotency key, so re-running /tally on the same vote
// produced another build, another PR and another public post every time. The
// caller check in discordAdapter narrows *who* can do that; this makes it a
// no-op even for someone allowed to run the command (a double-click, a Discord
// retry, or a genuinely ambiguous "did that work?" re-run).
//
// Same primitive the donation ledger already relies on: `SET key val NX` is
// atomic in Redis, so exactly one caller sees "OK" and every later one sees
// null. No new dependency — redisClient.ts speaks RESP directly, because
// package.json is LOCKED (GUARDRAILS.md).

import { redisPipeline, type SocketFactory } from "./redisClient";
import { redisUrlFromEnv } from "./redisBudgetStore";

const ONCE_PREFIX = "dcr:once:";

// Claims expire so a proposal isn't blocked forever by a build that failed and
// genuinely needs re-running. 30 days is far longer than any voting window.
const DEFAULT_TTL_SECONDS = 60 * 60 * 24 * 30;

export interface OnceStore {
  // True if THIS call created the claim (i.e. you own the work). False if
  // someone already claimed it.
  claim(key: string, memo?: string): Promise<boolean>;
}

export class RedisOnceStore implements OnceStore {
  // Declared explicitly rather than as constructor parameter properties: the
  // test runner strips types without transforming, and parameter properties
  // need a real transform (ERR_UNSUPPORTED_TYPESCRIPT_SYNTAX).
  private url: string;
  private ttlSeconds: number;
  private socketFactory?: SocketFactory;

  constructor(url: string, ttlSeconds: number = DEFAULT_TTL_SECONDS, socketFactory?: SocketFactory) {
    this.url = url;
    this.ttlSeconds = ttlSeconds;
    this.socketFactory = socketFactory;
  }

  async claim(key: string, memo = "1"): Promise<boolean> {
    const [created] = await redisPipeline(
      this.url,
      [["SET", ONCE_PREFIX + key, memo, "NX", "EX", this.ttlSeconds]],
      { socketFactory: this.socketFactory },
    );
    return created === "OK";
  }
}

// In-process fallback for when REDIS_URL isn't configured. Honest about its
// limits: a serverless cold start wipes it, so it stops an accidental
// double-click within one instance but nothing more. It is NOT the protection
// that matters — that's the Redis store plus the caller check.
export class InMemoryOnceStore implements OnceStore {
  private seen = new Set<string>();
  async claim(key: string): Promise<boolean> {
    if (this.seen.has(key)) return false;
    this.seen.add(key);
    return true;
  }
}

// Module-scope so it survives across invocations on a warm serverless instance.
const memoryFallback = new InMemoryOnceStore();

export function onceStoreFromEnv(env: Record<string, string | undefined> = process.env): OnceStore {
  const url = redisUrlFromEnv(env);
  return url ? new RedisOnceStore(url) : memoryFallback;
}
