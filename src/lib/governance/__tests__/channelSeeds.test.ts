// channelSeeds.test.ts — C-03. Run via run.sh.
//
// 21 of 24 channels had never had a message in them, so a verified newcomer
// landed in empty rooms and concluded the project was abandoned.
//
// These pins are the first thing that newcomer reads, which makes a wrong
// claim here more expensive than a wrong claim anywhere else on the site: it
// is read at the exact moment someone is deciding whether this is real. So
// the tests below check the CONTENT, not just that it exists.

import { test } from "node:test";
import assert from "node:assert/strict";

import { CHANNEL_SEEDS } from "../../../data/channelSeeds";

const seed = (name: string) => {
  const s = CHANNEL_SEEDS.find((x) => x.channel === name);
  assert.ok(s, `no seed for #${name}`);
  return s!.content;
};
const all = CHANNEL_SEEDS.map((s) => s.content).join("\n\n");

// ---------------------------------------------------------------------------
// SHAPE
// ---------------------------------------------------------------------------
test("C-03: every player-facing channel gets a pin", () => {
  // The ones a newcomer reaches first. Missing any of these leaves an empty
  // room exactly where it costs most.
  for (const name of ["general", "rent-a-car", "donate-a-car", "server-status", "support", "lobby"]) {
    assert.ok(
      CHANNEL_SEEDS.some((s) => s.channel === name),
      `#${name} has no seed`,
    );
  }
});

test("C-03: no duplicate channels, and nothing empty", () => {
  const names = CHANNEL_SEEDS.map((s) => s.channel);
  assert.equal(new Set(names).size, names.length, "a channel is seeded twice");
  for (const s of CHANNEL_SEEDS) {
    assert.ok(s.content.trim().length > 80, `#${s.channel} is too thin to be worth pinning`);
    // Discord hard-caps a message at 2000 characters.
    assert.ok(s.content.length <= 2000, `#${s.channel} exceeds Discord's 2000-char limit`);
  }
});

test("C-03: the channels people ask questions in say who answers and how fast", () => {
  // The audit's actual ask. An unanswered question in a quiet channel is what
  // makes someone leave, so the pin has to set the expectation up front.
  for (const name of ["rent-a-car", "donate-a-car", "support", "contributor-hub", "lobby"]) {
    assert.match(seed(name), /small (volunteer )?crew/i, `#${name} doesn't say who answers`);
    assert.match(seed(name), /same day/i, `#${name} doesn't say how long`);
  }
});

// ---------------------------------------------------------------------------
// HONESTY — the content must not oversell a project this early
// ---------------------------------------------------------------------------
test("C-03: #rent-a-car admits no server is covered yet", () => {
  // Promising a fleet that doesn't exist is C-01 all over again, in Discord.
  const c = seed("rent-a-car");
  assert.match(c, /we're early|isn't listed|only has cars once/i);
  assert.match(c, /in-game items/i, "must state the payment model");
  assert.match(c, /no real money/i);
});

test("C-03: #server-status explains why a server might be absent", () => {
  assert.match(seed("server-status"), /at least one runner/i);
});

test("C-03: #recovery is honest that nothing is built behind it", () => {
  // The audit found #recovery was "a chat channel backed by nothing". It still
  // is; saying so beats implying a ticket system exists.
  assert.match(seed("recovery"), /no ticket system/i);
});

test("C-03: the money rules are stated where money is discussed", () => {
  const t = seed("treasury");
  assert.match(t, /buy nothing in-game/i);
  assert.match(t, /nobody is paid real money/i);
  assert.match(t, /up to a day/i, "sets the donation-visibility expectation (C-07)");
});

test("C-03: #proposals warns the screener is fallible before it rejects anyone", () => {
  // C-08's lesson, delivered before the accusation rather than after.
  const p = seed("proposals");
  assert.match(p, /does get things wrong/i);
  assert.match(p, /isn't an accusation/i);
});

test("C-03: #vote explains the two things that surprise voters", () => {
  const v = seed("vote");
  assert.match(v, /doesn't count toward quorum/i, "abstains not counting is a real surprise");
  assert.match(v, /misconfiguration on our side/i, "E-02's lesson, where a confused voter reads it");
});

test("C-03: #contributor-hub says roles aren't self-serve", () => {
  // The exact wrong claim the site made before C-02 was fixed.
  const c = seed("contributor-hub");
  assert.match(c, /aren't self-serve|not self-serve/i);
  assert.match(c, /runner/i);
  assert.match(c, /maintainer/i);
});

test("C-03: #safehouse-admin tells runners a vote can overrule them", () => {
  // E-08's decision. Finding this out for the first time by being overruled is
  // how a runner leaves.
  assert.match(seed("safehouse-admin"), /can overturn|community vote/i);
});

test("C-03: deposit protection is stated where a renter will look for it", () => {
  assert.match(seed("rent-a-car"), /deposit is waived/i);
  assert.match(seed("support"), /deposit/i);
});

test("C-03: nothing claims a fleet, server or runner that exists yet", () => {
  // A blanket guard against the tone drifting on a later edit.
  assert.doesNotMatch(all, /\bour fleet of \d/i);
  assert.doesNotMatch(all, /available on \d+ servers/i);
  assert.doesNotMatch(all, /24\/7|instantly|guaranteed/i);
});

test("C-03: links point at real pages", () => {
  const paths = [...all.matchAll(/dayzcarrental\.com(\/[a-z-]*)?/g)].map((m) => m[1] ?? "/");
  const real = new Set(["/", "/donate", "/donate-a-car", "/list-your-server", "/runner", "/maintainer", "/governance"]);
  for (const p of paths) assert.ok(real.has(p), `pin links to ${p}, which isn't a page`);
});
