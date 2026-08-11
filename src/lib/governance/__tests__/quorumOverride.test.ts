// quorumOverride.test.ts — verify the TEMPORARY, env-gated quorum override.
//
// Rules under test (config.ts effectiveQuorum):
//   * default (no env) = the real policy quorum, 3 (GOVERNANCE.md §3),
//   * a set override lowers quorum for a live approval test,
//   * it is CLAMPED to [1, 3] — it can only lower quorum, never raise or zero it,
//   * garbage input falls back to the real quorum,
//   * lowering quorum does NOT weaken the account-age gate, the compliance
//     screen, or the majority threshold — only the ballot count needed.

import { test } from "node:test";
import assert from "node:assert/strict";

import { GOVERNANCE, effectiveQuorum } from "../config";
import { GovernanceEngine } from "../engine";
import type { Member, Proposal, Vote } from "../types";

function withEnv(value: string | undefined, fn: () => void) {
  const prev = process.env.GOVERNANCE_QUORUM_OVERRIDE;
  if (value === undefined) delete process.env.GOVERNANCE_QUORUM_OVERRIDE;
  else process.env.GOVERNANCE_QUORUM_OVERRIDE = value;
  try {
    fn();
  } finally {
    if (prev === undefined) delete process.env.GOVERNANCE_QUORUM_OVERRIDE;
    else process.env.GOVERNANCE_QUORUM_OVERRIDE = prev;
  }
}

test("effectiveQuorum: defaults to the real policy quorum (3) with no override", () => {
  withEnv(undefined, () => assert.equal(effectiveQuorum(), GOVERNANCE.quorumMinBallots));
});

test("effectiveQuorum: honors a valid lower override, clamps out-of-range and garbage", () => {
  withEnv("1", () => assert.equal(effectiveQuorum(), 1));
  withEnv("2", () => assert.equal(effectiveQuorum(), 2));
  // Can't raise above the real quorum…
  withEnv("99", () => assert.equal(effectiveQuorum(), GOVERNANCE.quorumMinBallots));
  // …can't go to zero or negative…
  withEnv("0", () => assert.equal(effectiveQuorum(), 1));
  withEnv("-5", () => assert.equal(effectiveQuorum(), 1));
  // …garbage falls back to the real quorum.
  withEnv("abc", () => assert.equal(effectiveQuorum(), GOVERNANCE.quorumMinBallots));
});

test("engine: with override=1, a single ELIGIBLE approve reaches quorum and approves", () => {
  const members = new Map<string, Member>([
    ["v1", { id: "v1", handle: "Solo", roles: ["verified"], accountAgeDays: 300 }],
  ]);
  const engine = new GovernanceEngine(members);
  const proposal: Proposal = {
    id: "p-solo",
    authorId: "v1",
    actionKind: "content-edit",
    title: "Tiny copy fix",
    rawBody: "Fix a typo.",
  };
  const oneVote: Vote[] = [{ memberId: "v1", ballot: "approve" }];

  withEnv("1", () => {
    const out = engine.run(proposal, oneVote);
    assert.equal(out.decision, "approved");
    assert.equal(out.effect, "queue-pr");
  });
  // And with the override gone, the same single vote is back to no-quorum.
  withEnv(undefined, () => {
    const out = engine.run({ ...proposal, id: "p-solo-2" }, oneVote);
    assert.equal(out.decision, "no-quorum");
  });
});

test("override does NOT weaken other guardrails: ineligible voter and compliance still hold at quorum 1", () => {
  const members = new Map<string, Member>([
    // Verified but 1-day-old → fails the account-age gate regardless of quorum.
    ["sock", { id: "sock", handle: "Sock", roles: ["verified"], accountAgeDays: 1 }],
  ]);
  const engine = new GovernanceEngine(members);

  withEnv("1", () => {
    // Sockpuppet's single approve is dropped as ineligible → no eligible ballots.
    const out = engine.run(
      { id: "p-age", authorId: "sock", actionKind: "content-edit", title: "x", rawBody: "y" },
      [{ memberId: "sock", ballot: "approve" }],
    );
    assert.equal(out.decision, "no-quorum");

    // A non-compliant proposal is still dead on arrival even at quorum 1.
    const dead = engine.run(
      {
        id: "p-rmt",
        authorId: "sock",
        actionKind: "content-edit",
        title: "add $20 stripe checkout to rent a car",
        rawBody: "real money rental",
      },
      [],
    );
    assert.equal(dead.decision, "dead-on-arrival");
  });
});
