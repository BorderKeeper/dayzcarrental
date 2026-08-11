// Shared cast for the persona simulation tests. Four personas the user asked us
// to prove can cooperate on ONE server + Discord without founder aid:
//
//   * SITE MODIFIER  — a community member who wants to change the website
//     (goes through the proposal → vote → PR flow).
//   * RUNNER         — an in-game operator doing safehouse/staging work
//     (goes through the runner-ops side channel; main-runner authority).
//   * CAR DONOR      — a player donating a vehicle into the fleet.
//   * CAR RENTER     — a player renting a car (in-game commodity only).
//
// Plus supporting cast: a founder (present but must NOT be needed to resolve the
// core scenarios), verified voters, a fresh sockpuppet, and a bad actor who
// tries prompt injection / compliance violations.

import type { Member } from "../types";

export const CAST: Record<string, Member> = {
  // The four requested personas ---------------------------------------------
  siteModifier: { id: "u-site", handle: "PixelPatcher", roles: ["verified", "maintainer"], accountAgeDays: 120 },
  runner: { id: "u-run", handle: "RoadDog", roles: ["verified", "runner"], accountAgeDays: 90 },
  donor: { id: "u-don", handle: "GenerousGus", roles: ["verified"], accountAgeDays: 45 },
  renter: { id: "u-rent", handle: "SurvivorSam", roles: ["verified"], accountAgeDays: 30 },

  // Second renter, so we can force the double-booking conflict.
  renter2: { id: "u-rent2", handle: "LootLarry", roles: ["verified"], accountAgeDays: 22 },

  // Runners for the main-runner authority + dispute scenarios.
  mainRunner: { id: "u-main", handle: "ConvoyCarla", roles: ["verified", "runner", "main-runner"], accountAgeDays: 200 },
  runnerB: { id: "u-runB", handle: "GreaseGary", roles: ["verified", "runner"], accountAgeDays: 60 },

  // A pool of verified voters to reach quorum.
  voterA: { id: "u-va", handle: "VoterAnna", roles: ["verified"], accountAgeDays: 300 },
  voterB: { id: "u-vb", handle: "VoterBen", roles: ["verified"], accountAgeDays: 300 },
  voterC: { id: "u-vc", handle: "VoterCleo", roles: ["verified"], accountAgeDays: 300 },
  voterD: { id: "u-vd", handle: "VoterDan", roles: ["verified"], accountAgeDays: 300 },

  // A fresh sockpuppet: verified but under the account-age gate → ineligible.
  sockpuppet: { id: "u-sock", handle: "TotallyRealGuy", roles: ["verified"], accountAgeDays: 1 },

  // A bad actor who tries injection / compliance-violating proposals.
  badActor: { id: "u-bad", handle: "SlyStranger", roles: ["verified", "maintainer"], accountAgeDays: 15 },

  // The founder — present, but the core scenarios must resolve WITHOUT them.
  founder: { id: "u-founder", handle: "TheFounder", roles: ["founder"], accountAgeDays: 999 },
};

// Build the member map the engine consumes.
export function memberMap(...members: Member[]): Map<string, Member> {
  const m = new Map<string, Member>();
  for (const x of members) m.set(x.id, x);
  return m;
}

// The whole cast, as a map (most tests just use this).
export function allMembers(): Map<string, Member> {
  return memberMap(...Object.values(CAST));
}

// The single shared DayZ server the personas cooperate on.
export const SERVER_ID = "cherno-official-1234";
