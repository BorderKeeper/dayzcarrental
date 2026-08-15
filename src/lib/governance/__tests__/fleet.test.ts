// fleet.test.ts — the live/sandbox data split. Run via run.sh.
//
// The rule this file defends: a live page must NEVER render invented data. An
// unconfigured, unreachable, empty or corrupt store yields an empty fleet, and
// the UI has a real empty state for that. Falling back to the sandbox fixtures
// would put "Chernarus Official #1234" on the live site, which is exactly the
// problem the split exists to solve (C-10).

import { test } from "node:test";
import assert from "node:assert/strict";

import { loadLiveFleet, FLEET_KEYS } from "../../../data/liveStore";
import { SANDBOX_FLEET } from "../../../data/sandbox";
import { safehousesFor, vehicleIdsFor, serverName } from "../../../data/types";
import { CUSTOM_SERVER } from "../../../data/constants";
import { VEHICLES } from "../../../data/vehicles";

const SERVER = { id: "srv-1", name: "Real Server", map: "Chernarus", mode: "PvE" };
const HOUSE = { id: "h1", name: "A barn", area: "North", map: "chernarusplus", x: 100, y: 200 };

// A fake Redis that answers GETs from a plain map, and records what was asked.
function fakeRedis(store: Record<string, string>, asked: string[][] = []) {
  return async (commands: (string | number)[][]) => {
    for (const c of commands) asked.push(c.map(String));
    return commands.map((c) => (c[0] === "GET" ? (store[String(c[1])] ?? null) : null));
  };
}

// ---------------------------------------------------------------------------
// LIVE: the happy path
// ---------------------------------------------------------------------------
test("live: loads servers, safehouses and staged cars from Redis", async () => {
  const asked: string[][] = [];
  const fleet = await loadLiveFleet({
    url: "redis://x",
    run: fakeRedis(
      {
        [FLEET_KEYS.servers]: JSON.stringify([SERVER]),
        [FLEET_KEYS.safehousesFor("srv-1")]: JSON.stringify([HOUSE]),
        [FLEET_KEYS.vehiclesFor("srv-1")]: JSON.stringify(["sarka-120"]),
      },
      asked,
    ),
  });

  assert.equal(fleet.mode, "live");
  assert.equal(fleet.servers.length, 1);
  assert.equal(serverName(fleet, "srv-1"), "Real Server");
  assert.deepEqual(safehousesFor(fleet, "srv-1"), [HOUSE]);
  assert.deepEqual(vehicleIdsFor(fleet, "srv-1"), ["sarka-120"]);
  // Only the keys it needs — no wildcard scans.
  assert.ok(asked.every((c) => c[0] === "GET"));
});

// ---------------------------------------------------------------------------
// LIVE: every failure mode degrades to EMPTY, never to fixtures
// ---------------------------------------------------------------------------
test("live: no store configured yields an empty fleet, not sample data", async () => {
  const fleet = await loadLiveFleet({ url: null });
  assert.deepEqual(fleet.servers, []);
  assert.notEqual(fleet.servers.length, SANDBOX_FLEET.servers.length);
});

test("live: an empty store yields an empty fleet", async () => {
  const fleet = await loadLiveFleet({ url: "redis://x", run: fakeRedis({}) });
  assert.deepEqual(fleet.servers, []);
});

test("live: an unreachable store yields an empty fleet rather than throwing", async () => {
  const fleet = await loadLiveFleet({
    url: "redis://x",
    run: async () => {
      throw new Error("ECONNREFUSED");
    },
  });
  assert.deepEqual(fleet.servers, []);
  assert.deepEqual(fleet.safehouses, {});
});

test("live: a corrupt server list yields an empty fleet", async () => {
  const fleet = await loadLiveFleet({
    url: "redis://x",
    run: fakeRedis({ [FLEET_KEYS.servers]: "{not json" }),
  });
  assert.deepEqual(fleet.servers, []);
});

test("live: one corrupt safehouse key degrades that server only", async () => {
  const fleet = await loadLiveFleet({
    url: "redis://x",
    run: fakeRedis({
      [FLEET_KEYS.servers]: JSON.stringify([SERVER, { ...SERVER, id: "srv-2", name: "Second" }]),
      [FLEET_KEYS.safehousesFor("srv-1")]: "[[[",
      [FLEET_KEYS.safehousesFor("srv-2")]: JSON.stringify([HOUSE]),
      [FLEET_KEYS.vehiclesFor("srv-2")]: JSON.stringify(["sarka-120"]),
    }),
  });
  assert.equal(fleet.servers.length, 2, "a bad key must not lose the whole page");
  assert.deepEqual(safehousesFor(fleet, "srv-1"), []);
  assert.deepEqual(safehousesFor(fleet, "srv-2"), [HOUSE]);
});

test("live: server entries missing an id or name are dropped", async () => {
  const fleet = await loadLiveFleet({
    url: "redis://x",
    run: fakeRedis({
      [FLEET_KEYS.servers]: JSON.stringify([SERVER, { id: "no-name" }, { name: "no id" }]),
    }),
  });
  assert.equal(fleet.servers.length, 1);
  assert.equal(fleet.servers[0].id, "srv-1");
});

// ---------------------------------------------------------------------------
// The C-01 guarantee
// ---------------------------------------------------------------------------
test("an unknown server has no safehouses AND no staged cars", async () => {
  // Both must be empty. If vehicleIdsFor defaulted to "the whole catalogue",
  // a made-up server would advertise a fleet and then trap the renter at
  // pickup with nothing to select — the original C-01 bug.
  const fleet = await loadLiveFleet({
    url: "redis://x",
    run: fakeRedis({ [FLEET_KEYS.servers]: JSON.stringify([SERVER]) }),
  });
  assert.deepEqual(vehicleIdsFor(fleet, "__custom"), []);
  assert.deepEqual(safehousesFor(fleet, "__custom"), []);
});

// ---------------------------------------------------------------------------
// SANDBOX fixtures stay self-consistent
// ---------------------------------------------------------------------------
test("sandbox: every server has safehouses and only real catalogue vehicles", () => {
  const catalogue = new Set(VEHICLES.map((v) => v.id));
  assert.ok(SANDBOX_FLEET.servers.length > 0);
  for (const s of SANDBOX_FLEET.servers) {
    assert.ok(safehousesFor(SANDBOX_FLEET, s.id).length > 0, `${s.id} has no safehouses`);
    const ids = vehicleIdsFor(SANDBOX_FLEET, s.id);
    assert.ok(ids.length > 0, `${s.id} stages no cars`);
    for (const id of ids) assert.ok(catalogue.has(id), `${s.id} stages unknown vehicle '${id}'`);
  }
});

test("sandbox: fixtures are tagged as sandbox so a page can never mislabel them", () => {
  assert.equal(SANDBOX_FLEET.mode, "sandbox");
});

// The live/sandbox asymmetry is deliberate and easy to "tidy away" by accident,
// so it's pinned here. Sandbox stages cars on a typed-in server (that's how the
// demo reaches RentFlow's free-text pickup); live stages none (that's C-01).
test("sandbox: a typed-in server stages cars but has no safehouses", () => {
  assert.ok(vehicleIdsFor(SANDBOX_FLEET, CUSTOM_SERVER).length > 0, "demo would dead-end with no cars");
  assert.deepEqual(
    safehousesFor(SANDBOX_FLEET, CUSTOM_SERVER),
    [],
    "no safehouses is what triggers the free-text pickup path",
  );
});
