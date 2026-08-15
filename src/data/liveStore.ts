// liveStore.ts — the REAL fleet: servers, safehouses and what's staged where,
// read from Redis.
//
// Why Redis rather than repo files: a roster change is runner-ops, not a
// constitutional amendment. Routing "add a safehouse" through vote → AI build →
// PR → founder merge is the overkill audit finding E-03 describes, and it means
// a main runner can't act on their own server. This data is expected to change
// often and to be edited by trusted runners directly. The PR/merge gate still
// guards code and policy, which is what it's for.
//
// No new dependency: redisClient.ts speaks RESP over node:net/tls, because
// package.json is LOCKED (GUARDRAILS.md).
//
// Failure posture: an unconfigured, unreachable or empty store yields an EMPTY
// fleet — never fixtures. Falling back to sandbox data here would put invented
// servers on the live site, which is precisely the thing C-10 is about. Empty
// is honest; the UI has a real empty state for it.

// Relative, not "@/..." — the test runner's resolve hook doesn't understand
// tsconfig path aliases, and this module is covered by fleet.test.ts.
import { redisPipeline } from "../lib/governance/redisClient";
import { redisUrlFromEnv } from "../lib/governance/redisBudgetStore";
import type { Fleet, GameServer, Safehouse } from "./types";

const SERVERS_KEY = "dcr:fleet:servers";
const SAFEHOUSES_PREFIX = "dcr:fleet:safehouses:";
const VEHICLES_PREFIX = "dcr:fleet:vehicles:";

export const FLEET_KEYS = {
  servers: SERVERS_KEY,
  safehousesFor: (serverId: string) => SAFEHOUSES_PREFIX + serverId,
  vehiclesFor: (serverId: string) => VEHICLES_PREFIX + serverId,
};

// Parse a JSON array out of a Redis reply, tolerating absence and junk. A
// corrupt key degrades that one server rather than taking down the page.
function parseArray<T>(reply: unknown, what: string): T[] {
  if (reply == null) return [];
  try {
    const parsed = JSON.parse(String(reply));
    return Array.isArray(parsed) ? (parsed as T[]) : [];
  } catch {
    console.error(`[fleet] ${what} is not valid JSON; treating as empty.`);
    return [];
  }
}

export interface LoadOptions {
  url?: string | null;
  // Injectable so this is testable without a Redis server.
  run?: (commands: (string | number)[][]) => Promise<unknown[]>;
}

// Load the whole live fleet. Two round trips: the server list, then one
// pipelined batch for every server's safehouses and staged vehicles.
export async function loadLiveFleet(opts: LoadOptions = {}): Promise<Fleet> {
  const empty: Fleet = { mode: "live", servers: [], safehouses: {}, vehicleIds: {} };

  const url = opts.url === undefined ? redisUrlFromEnv() : opts.url;
  const run = opts.run ?? (url ? (cmds: (string | number)[][]) => redisPipeline(url, cmds) : null);
  if (!run) return empty; // no store configured → genuinely nothing live yet

  try {
    const [serversRaw] = await run([["GET", SERVERS_KEY]]);
    const servers = parseArray<GameServer>(serversRaw, SERVERS_KEY).filter(
      (s) => s && typeof s.id === "string" && typeof s.name === "string",
    );
    if (servers.length === 0) return empty;

    const commands: (string | number)[][] = [];
    for (const s of servers) {
      commands.push(["GET", FLEET_KEYS.safehousesFor(s.id)]);
      commands.push(["GET", FLEET_KEYS.vehiclesFor(s.id)]);
    }
    const replies = await run(commands);

    const safehouses: Record<string, Safehouse[]> = {};
    const vehicleIds: Record<string, string[]> = {};
    servers.forEach((s, i) => {
      safehouses[s.id] = parseArray<Safehouse>(replies[i * 2], FLEET_KEYS.safehousesFor(s.id));
      vehicleIds[s.id] = parseArray<string>(replies[i * 2 + 1], FLEET_KEYS.vehiclesFor(s.id)).filter(
        (v) => typeof v === "string",
      );
    });

    return { mode: "live", servers, safehouses, vehicleIds };
  } catch (e) {
    // Loud in the logs, empty on the page. Never mock data.
    console.error("[fleet] could not load the live fleet from Redis:", (e as Error).message);
    return empty;
  }
}
