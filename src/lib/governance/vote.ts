// vote.ts — eligibility, quorum, and threshold logic for the emoji-vote engine.
//
// Mirrors DISCORD.md §5a steps 3–5:
//   * eligibility = @Verified + account age ≥ gate (blocks sockpuppets),
//   * quorum      = a minimum number of non-abstain ballots,
//   * threshold   = simple majority of non-abstain ballots (ties fail),
//   * founder override/veto sits on top of any tally.
//
// Pure functions over explicit inputs — no clocks, no I/O — so outcomes are
// deterministic and testable.

import type { Member, Vote, Tally, TallyExclusions, Ballot } from "./types";
import { GOVERNANCE, effectiveQuorum } from "./config";

export type IneligibilityReason = "unknown-member" | "unverified" | "account-too-young";

// Why this member's ballot can't count — or null if it can. Returning the
// reason (rather than a bare boolean) is what lets a tally explain itself: a
// vote that failed because eight people weren't @Verified must not look like a
// vote nobody turned up to.
export function ineligibilityReason(m: Member | undefined): IneligibilityReason | null {
  if (!m) return "unknown-member";
  const { requireVerified, minAccountAgeDays } = GOVERNANCE.eligibility;
  // Founder is always eligible (final say regardless). Everyone else must clear
  // the @Verified + account-age gate.
  if (m.roles.includes("founder")) return null;
  if (requireVerified && !m.roles.includes("verified")) return "unverified";
  if (m.accountAgeDays < minAccountAgeDays) return "account-too-young";
  return null;
}

// Is a member eligible to have their ballot counted at all?
export function isEligible(m: Member | undefined): boolean {
  return ineligibilityReason(m) === null;
}

// Reduce a set of votes to a tally, counting only eligible members. Later
// ballots by the same member overwrite earlier ones (matches how a Discord
// reaction is a member's single current choice, not an append log).
export function tallyVotes(votes: Vote[], members: Map<string, Member>): Tally {
  const latest = new Map<string, Ballot>();
  // Excluded voters are tracked per unique member, not per ballot — one person
  // reacting with three emoji is one excluded person, not three.
  const excludedBy = new Map<string, IneligibilityReason>();
  for (const v of votes) {
    const m = members.get(v.memberId);
    const reason = ineligibilityReason(m);
    if (reason) {
      excludedBy.set(v.memberId, reason);
      continue;
    }
    latest.set(v.memberId, v.ballot);
  }

  const excluded: TallyExclusions = { total: 0, unverified: 0, tooYoung: 0, unknown: 0 };
  for (const reason of excludedBy.values()) {
    excluded.total++;
    if (reason === "unverified") excluded.unverified++;
    else if (reason === "account-too-young") excluded.tooYoung++;
    else excluded.unknown++;
  }

  let approve = 0;
  let reject = 0;
  let abstain = 0;
  for (const ballot of latest.values()) {
    if (ballot === "approve") approve++;
    else if (ballot === "reject") reject++;
    else abstain++;
  }

  const eligibleBallots = approve + reject; // abstain (🤷) does not count toward quorum
  const quorumMet = eligibleBallots >= effectiveQuorum();
  const approvalRatio = eligibleBallots === 0 ? 0 : approve / eligibleBallots;

  return { approve, reject, abstain, eligibleBallots, quorumMet, approvalRatio, excluded };
}

// Does a tally pass on its own (before founder override)?
// Needs quorum AND strictly more than the threshold ratio — ties fail, because
// a change requires positive consent; the status quo wins a tie.
export function tallyPasses(t: Tally): boolean {
  return t.quorumMet && t.approvalRatio > GOVERNANCE.approvalThreshold;
}
