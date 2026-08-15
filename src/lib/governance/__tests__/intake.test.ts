// intake.test.ts — F-08 and C-06. Run via run.sh.
//
//   F-08  The rent flow asked for a contact handle at the highest-intent
//         moment in the funnel and dropped it client-side. The roadmap listed
//         a waitlist; none existed.
//   C-06  A server owner — the audience that brings players — had no entry
//         point at all.
//
// The records here hold a contact handle a person volunteered, which makes
// them the most sensitive thing this project stores. Several tests below exist
// to pin that: what's kept, what's capped, and what is never written down.

import { test } from "node:test";
import assert from "node:assert/strict";

import { recordIntake, validateIntake, intakeKey, LIMITS, INTAKE_KINDS } from "../../../data/intake";

// A fake Redis that records commands and answers INCR from a counter.
function fakeRedis() {
  const commands: string[][] = [];
  const counters = new Map<string, number>();
  const run = async (cmds: (string | number)[][]) => {
    const out: unknown[] = [];
    for (const c of cmds) {
      const cmd = c.map(String);
      commands.push(cmd);
      if (cmd[0] === "INCR") {
        const n = (counters.get(cmd[1]) ?? 0) + 1;
        counters.set(cmd[1], n);
        out.push(n);
      } else out.push("OK");
    }
    return out;
  };
  return { run, commands };
}

const valid = {
  kind: "rental-interest" as const,
  contactType: "discord" as const,
  contact: "survivor#0001",
  serverName: "Real Server",
  detail: "Wants the Ada 4x4 for 2 day(s).",
};

// ---------------------------------------------------------------------------
// VALIDATION
// ---------------------------------------------------------------------------
test("intake: a complete rental interest validates", () => {
  const res = validateIntake(valid);
  assert.equal(res.ok, true);
});

test("intake: a contact handle is required — that's the whole point", () => {
  const res = validateIntake({ ...valid, contact: "   " });
  assert.equal(res.ok, false);
  if (!res.ok) assert.match(res.detail, /how to reach you/i);
});

test("intake: an email contact is checked, a discord handle is not", () => {
  assert.equal(validateIntake({ ...valid, contactType: "email", contact: "nope" }).ok, false);
  assert.equal(validateIntake({ ...valid, contactType: "email", contact: "a@b.co" }).ok, true);
  // Discord handles have no reliable shape; rejecting on a guess would lock
  // people out of the one field that matters.
  assert.equal(validateIntake({ ...valid, contactType: "discord", contact: "@weird~name" }).ok, true);
});

test("C-06: a server request must name the server", () => {
  const res = validateIntake({ ...valid, kind: "server-request", serverName: "" });
  assert.equal(res.ok, false);
  if (!res.ok) assert.match(res.detail, /which server/i);
});

test("intake: an unknown kind is refused", () => {
  assert.equal(validateIntake({ ...valid, kind: "give-me-your-data" as never }).ok, false);
});

test("intake: every declared kind is actually accepted", () => {
  for (const kind of INTAKE_KINDS) {
    const res = validateIntake({ ...valid, kind, serverName: "Some Server" });
    assert.equal(res.ok, true, `${kind} should validate`);
  }
});

test("intake: oversized fields are capped, not rejected", () => {
  // Truncating beats refusing: someone who pastes an essay still gets recorded,
  // and Redis is protected from an unbounded write either way.
  const res = validateIntake({ ...valid, contact: "x".repeat(5000), detail: "y".repeat(50_000) });
  assert.equal(res.ok, true);
  if (res.ok) {
    assert.equal(res.entry.contact.length, LIMITS.contact);
    assert.equal(res.entry.detail!.length, LIMITS.detail);
  }
});

test("intake: whitespace is trimmed so a handle isn't stored with padding", () => {
  const res = validateIntake({ ...valid, contact: "  survivor#0001  " });
  assert.ok(res.ok && res.entry.contact === "survivor#0001");
});

// ---------------------------------------------------------------------------
// STORAGE + PRIVACY
// ---------------------------------------------------------------------------
test("F-08: a valid submission is appended to its kind's list", async () => {
  const { run, commands } = fakeRedis();
  const res = await recordIntake(valid, "1.2.3.4", { url: "redis://x", run });
  assert.deepEqual(res, { ok: true });

  const push = commands.find((c) => c[0] === "RPUSH");
  assert.ok(push, "expected an RPUSH");
  assert.equal(push![1], intakeKey("rental-interest"));
  const stored = JSON.parse(push![2]);
  assert.equal(stored.contact, "survivor#0001");
  assert.ok(stored.receivedAt, "needs a timestamp so a stale lead is obvious");
});

test("privacy: the stored record contains no fingerprint or IP", async () => {
  const { run, commands } = fakeRedis();
  await recordIntake(valid, "203.0.113.9", { url: "redis://x", run });
  const stored = commands.find((c) => c[0] === "RPUSH")![2];
  assert.doesNotMatch(stored, /203\.0\.113\.9/, "the rate-limit key must never be stored with the entry");
  assert.deepEqual(Object.keys(JSON.parse(stored)).sort(), [
    "contact",
    "contactType",
    "detail",
    "kind",
    "receivedAt",
    "serverName",
  ]);
});

test("intake: the list is trimmed so a flood can't grow it without bound", async () => {
  const { run, commands } = fakeRedis();
  await recordIntake(valid, "1.2.3.4", { url: "redis://x", run });
  const trim = commands.find((c) => c[0] === "LTRIM");
  assert.ok(trim, "expected an LTRIM alongside the RPUSH");
  assert.equal(trim![1], intakeKey("rental-interest"));
});

test("intake: repeated submissions from one source are throttled", async () => {
  const { run } = fakeRedis();
  const deps = { url: "redis://x", run };
  for (let i = 0; i < 5; i++) {
    assert.deepEqual(await recordIntake(valid, "1.2.3.4", deps), { ok: true }, `submission ${i + 1}`);
  }
  const sixth = await recordIntake(valid, "1.2.3.4", deps);
  assert.equal(sixth.ok, false);
  if (!sixth.ok) assert.equal(sixth.reason, "throttled");

  // A different submitter is unaffected — the limit is per source, not global.
  assert.deepEqual(await recordIntake(valid, "5.6.7.8", deps), { ok: true });
});

test("intake: an invalid submission never reaches the store", async () => {
  const { run, commands } = fakeRedis();
  await recordIntake({ ...valid, contact: "" }, "1.2.3.4", { url: "redis://x", run });
  assert.equal(commands.filter((c) => c[0] === "RPUSH").length, 0);
});

test("intake: with no store configured it says so rather than accepting into a void", async () => {
  const res = await recordIntake(valid, "1.2.3.4", { url: null });
  assert.equal(res.ok, false);
  // Silently succeeding would leave someone believing a runner will be in touch.
  if (!res.ok) assert.equal(res.reason, "unavailable");
});

test("intake: an unreachable store reports unavailable rather than throwing", async () => {
  const res = await recordIntake(valid, "1.2.3.4", {
    url: "redis://x",
    run: async () => {
      throw new Error("ECONNREFUSED");
    },
  });
  assert.equal(res.ok, false);
  if (!res.ok) assert.equal(res.reason, "unavailable");
});

test("intake: each kind lands in its own list", async () => {
  const { run, commands } = fakeRedis();
  await recordIntake({ ...valid, kind: "server-request", serverName: "Mine" }, "a", { url: "redis://x", run });
  await recordIntake({ ...valid, kind: "car-donation" }, "b", { url: "redis://x", run });
  const keys = commands.filter((c) => c[0] === "RPUSH").map((c) => c[1]);
  assert.deepEqual(keys, [intakeKey("server-request"), intakeKey("car-donation")]);
});
