// runnerAuthority.test.ts — E-03 and E-04. Run via run.sh.
//
//   E-03  A main runner acting on HER OWN server got back
//         {status: "proposed", needsApprovalBy: "main-runner"} — she was
//         waiting on herself. RunnerOps was correct all along; nothing outside
//         test files ever CONSTRUCTED it, so the assignments map was always
//         empty in production and every routine change escalated to the
//         founder — precisely what the side channel exists to prevent.
//
//   E-04  A runner pulled a car out of service mid-rental. The rental kept
//         running, nobody was told, and the renter later forfeited a deposit
//         (a real rifle and optic) for a car that had been taken from them.

import { test } from "node:test";
import assert from "node:assert/strict";

import { RunnerOps } from "../runnerOps";
import { AuditLog } from "../audit";
import { RentalLedger, type DonatedCar, type CommodityAmount } from "../booking";
import { loadMainRunnerAssignments, FLEET_KEYS } from "../../../data/liveStore";
import { handleInteraction, InteractionType } from "../discordAdapter";
import type { Member } from "../types";

const AMMO: CommodityAmount = { commodity: "ammo", qty: 60 };
const RIFLE: CommodityAmount = { commodity: "tools", qty: 1 };

function member(id: string, roles: Member["roles"]): Member {
  return { id, handle: id, roles, accountAgeDays: 400 };
}

// ---------------------------------------------------------------------------
// E-03 — per-server authority actually works once assignments are populated
// ---------------------------------------------------------------------------
test("E-03: a main runner assigned to her server applies changes directly", () => {
  const nadia = member("nadia", ["everyone", "verified", "main-runner"]);
  const ops = new RunnerOps(
    new Map([[nadia.id, nadia]]),
    new Map([["srv-1", ["nadia"]]]), // the map production never had
    new AuditLog(),
  );

  const res = ops.submit({ requesterId: "nadia", serverId: "srv-1", op: "add", safehouseName: "Green barn" });
  assert.equal(res.status, "applied", "the main runner must not wait on her own approval");
});

test("E-03: the same runner is only a proposer on a server she doesn't lead", () => {
  const nadia = member("nadia", ["everyone", "verified", "main-runner"]);
  const ops = new RunnerOps(
    new Map([[nadia.id, nadia]]),
    new Map([["srv-1", ["nadia"]]]),
    new AuditLog(),
  );
  const res = ops.submit({ requesterId: "nadia", serverId: "srv-2", op: "add", safehouseName: "Elsewhere" });
  assert.equal(res.status, "proposed", "main-runner authority is per-server, not global");
});

test("E-03: an empty assignments map reproduces the original bug exactly", () => {
  // This is what production did on every request: no assignments, so even the
  // server's own lead fell through to "proposed".
  const nadia = member("nadia", ["everyone", "verified", "main-runner"]);
  const ops = new RunnerOps(new Map([[nadia.id, nadia]]), new Map(), new AuditLog());
  const res = ops.submit({ requesterId: "nadia", serverId: "srv-1", op: "add", safehouseName: "Green barn" });
  assert.equal(res.status, "proposed");
});

test("E-03: assignments load from the fleet store, per server", async () => {
  const store: Record<string, string> = {
    [FLEET_KEYS.mainRunnersFor("srv-1")]: JSON.stringify(["900000000000000001"]),
    [FLEET_KEYS.mainRunnersFor("srv-2")]: JSON.stringify([]),
  };
  const run = async (cmds: (string | number)[][]) => cmds.map((c) => store[String(c[1])] ?? null);

  const a = await loadMainRunnerAssignments(["srv-1", "srv-2", "srv-3"], { url: "redis://x", run });
  assert.deepEqual(a.get("srv-1"), ["900000000000000001"]);
  assert.equal(a.has("srv-2"), false, "an empty list is not an assignment");
  assert.equal(a.has("srv-3"), false, "a missing key is not an assignment");
});

test("E-03: an unreachable store yields no assignments rather than throwing", async () => {
  const a = await loadMainRunnerAssignments(["srv-1"], {
    url: "redis://x",
    run: async () => {
      throw new Error("ECONNREFUSED");
    },
  });
  assert.equal(a.size, 0);
});

// --- the command surface that finally constructs it ------------------------
function safehouseInteraction(userId: string, roleIds: string[], op = "add", server = "srv-1") {
  return {
    type: InteractionType.APPLICATION_COMMAND,
    application_id: "app1",
    token: "itok",
    channel_id: "c1",
    data: {
      name: "safehouse",
      options: [
        { name: "op", value: op },
        { name: "server", value: server },
        { name: "name", value: "Green barn" },
      ],
    },
    member: { user: { id: userId, username: "nadia" }, roles: roleIds },
  };
}

const MAIN_RUNNER_ROLE = "323456789012345678";

function safehouseCfg(assignments: Map<string, string[]>, sent: string[]) {
  return {
    discord: {
      editOriginalInteractionResponse: async (_a: string, _t: string, body: { content: string }) => {
        sent.push("EDIT:" + body.content);
      },
      createMessage: async (_c: string, body: { content: string }) => {
        sent.push("POST:" + body.content);
        return { id: "m", channel_id: "c1" };
      },
    } as any,
    guildId: "g1",
    roleMap: { [MAIN_RUNNER_ROLE]: "main-runner" as const },
    voteChannelId: "c1",
    nowMs: 1_700_000_000_000,
    roster: new Map<string, Member>(),
    runnerOpsFor: async (serverId: string, requester: Member) => {
      const audit = new AuditLog();
      return {
        ops: new RunnerOps(new Map([[requester.id, requester]]), assignments, audit),
        assigned: (assignments.get(serverId) ?? []).length > 0,
        audit,
      };
    },
  };
}

test("E-03: /safehouse lets an assigned main runner apply, and announces it", async () => {
  const sent: string[] = [];
  const { deferred } = handleInteraction(
    safehouseInteraction("900000000000000001", [MAIN_RUNNER_ROLE]),
    safehouseCfg(new Map([["srv-1", ["900000000000000001"]]]), sent),
  );
  await deferred!();
  const all = sent.join("\n");
  assert.match(all, /Applied/);
  assert.ok(
    sent.some((s) => s.startsWith("POST:") && /Runner-ops/.test(s)),
    "an applied change must be announced publicly",
  );
});

test("E-03: an unassigned server says nobody leads it, not just 'proposed'", async () => {
  const sent: string[] = [];
  const { deferred } = handleInteraction(
    safehouseInteraction("900000000000000001", [MAIN_RUNNER_ROLE]),
    safehouseCfg(new Map(), sent),
  );
  await deferred!();
  const all = sent.join("\n");
  assert.match(all, /Proposed/);
  // Without this the runner can't tell "you're not the lead here" from
  // "the store was never seeded".
  assert.match(all, /No main runner is assigned/);
  assert.ok(!sent.some((s) => s.startsWith("POST:")), "nothing is announced until it's applied");
});

test("E-03: a non-runner is denied outright", async () => {
  const sent: string[] = [];
  const { deferred } = handleInteraction(
    safehouseInteraction("900000000000000009", []), // no roles
    safehouseCfg(new Map([["srv-1", ["900000000000000001"]]]), sent),
  );
  await deferred!();
  assert.match(sent.join("\n"), /Denied/);
});

test("E-03: an unknown op is rejected before any I/O", () => {
  const sent: string[] = [];
  const { response, deferred } = handleInteraction(
    safehouseInteraction("900000000000000001", [MAIN_RUNNER_ROLE], "demolish"),
    safehouseCfg(new Map(), sent),
  );
  assert.equal(deferred, undefined);
  assert.match(response.data!.content!, /must be one of/);
});

// ---------------------------------------------------------------------------
// E-04 — a renter never pays for a car that was taken away from them
// ---------------------------------------------------------------------------
function ledgerWithBookedCar() {
  const cars = new Map<string, DonatedCar>([
    ["car-ada-1", { id: "car-ada-1", donorId: "d1", serverId: "srv-1", model: "Ada 4x4", staged: true }],
  ]);
  const ledger = new RentalLedger(cars);
  const booked = ledger.book(
    { renterId: "renter-1", carId: "car-ada-1", serverId: "srv-1", startDay: 5, endDay: 7 },
    AMMO,
    RIFLE,
  );
  assert.equal(booked.status, "booked");
  return { ledger, cars };
}

test("E-04: de-staging a car mid-rental is blocked, and names who it would strand", () => {
  const { ledger, cars } = ledgerWithBookedCar();
  const res = ledger.takeOutOfService("car-ada-1", "runner-1", { onDay: 6 });

  assert.equal(res.status, "blocked");
  if (res.status !== "blocked") return;
  assert.equal(res.affected.length, 1);
  assert.match(res.detail, /renter-1/);
  assert.match(res.detail, /days 5-7/);
  assert.equal(cars.get("car-ada-1")!.staged, true, "the car must stay staged when the pull is refused");
});

test("E-04: forcing it through waives the deposit — the renter doesn't pay for it", () => {
  const { ledger, cars } = ledgerWithBookedCar();
  const res = ledger.takeOutOfService("car-ada-1", "runner-1", { onDay: 6, force: true, reason: "burned out" });

  assert.equal(res.status, "withdrawn");
  assert.equal(cars.get("car-ada-1")!.staged, false);

  // The original bug: returned late, {refunded: false}, deposit gone.
  const closed = ledger.closeRental(ledger.active()[0]?.id ?? "rental-1", 99);
  assert.ok(closed);
  assert.equal(closed!.refunded, true, "a waived deposit must be refunded however late the return is");
  assert.equal(closed!.waived, true);
  assert.match(closed!.reason ?? "", /burned out/);
});

test("E-04: a normal late return still forfeits the deposit", () => {
  // The waiver must not become a loophole — COMPLIANCE.md #3 still stands.
  const { ledger } = ledgerWithBookedCar();
  const closed = ledger.closeRental(ledger.active()[0].id, 99);
  assert.equal(closed!.refunded, false);
  assert.equal(closed!.waived, false);
});

test("E-04: an on-time return is refunded, unchanged", () => {
  const { ledger } = ledgerWithBookedCar();
  const closed = ledger.closeRental(ledger.active()[0].id, 7);
  assert.equal(closed!.refunded, true);
  assert.equal(closed!.waived, false);
});

test("E-04: a car with no active rental is withdrawn without ceremony", () => {
  const cars = new Map<string, DonatedCar>([
    ["car-idle", { id: "car-idle", donorId: "d1", serverId: "srv-1", model: "Olga", staged: true }],
  ]);
  const ledger = new RentalLedger(cars);
  const res = ledger.takeOutOfService("car-idle", "runner-1");
  assert.equal(res.status, "withdrawn");
  assert.equal(cars.get("car-idle")!.staged, false);
  if (res.status === "withdrawn") assert.equal(res.affected.length, 0);
});

test("E-04: a withdrawn car can't be booked, and comes back on returnToService", () => {
  const { ledger } = ledgerWithBookedCar();
  ledger.takeOutOfService("car-ada-1", "runner-1", { onDay: 6, force: true });

  const blocked = ledger.book(
    { renterId: "renter-2", carId: "car-ada-1", serverId: "srv-1", startDay: 20, endDay: 22 },
    AMMO,
    RIFLE,
  );
  assert.equal(blocked.status, "rejected");

  assert.equal(ledger.returnToService("car-ada-1", "runner-1"), true);
  const ok = ledger.book(
    { renterId: "renter-2", carId: "car-ada-1", serverId: "srv-1", startDay: 20, endDay: 22 },
    AMMO,
    RIFLE,
  );
  assert.equal(ok.status, "booked");
});

test("E-04: taking an unknown car out of service is reported, not silently ignored", () => {
  const ledger = new RentalLedger(new Map());
  const res = ledger.takeOutOfService("nope", "runner-1");
  assert.equal(res.status, "unknown-car");
});

test("E-04: activeRentalsForCar only counts rentals covering the day in question", () => {
  const { ledger } = ledgerWithBookedCar();
  assert.equal(ledger.activeRentalsForCar("car-ada-1", 6).length, 1);
  assert.equal(ledger.activeRentalsForCar("car-ada-1", 99).length, 0, "a finished window isn't active");
  assert.equal(ledger.activeRentalsForCar("car-ada-1").length, 1, "no day given = every open rental");
});
