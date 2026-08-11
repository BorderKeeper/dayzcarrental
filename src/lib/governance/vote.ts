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

import type { Member, Vote, Tally, Ballot } from "./types";
import { GOVERNANCE, effectiveQuorum } from "./config";

// Is a member eligible to have their ballot counted at all?
export function isEligible(m: Member | undefined): boolean {
  if (!m) return false;
  const { requireVerified, minAccountAgeDays } = GOVERNANCE.eligibility;
  // Founder is always eligible (final say regardless). Everyone else must clear
  // the @Verified + account-age gate.
  if (m.roles.includes("founder")) return true;
  if (requireVerified && !m.roles.includes("verified")) return false;
  if (m.accountAgeDays < minAccountAgeDays) return false;
  return true;
}

// Reduce a set of votes to a tally, counting only eligible members. Later
// ballots by the same member overwrite earlier ones (matches how a Discord
// reaction is a member's single current choice, not an append log).
export function tallyVotes(votes: Vote[], members: Map<string, Member>): Tally {
  const latest = new Map<string, Ballot>();
  for (const v of votes) {
    const m = members.get(v.memberId);
    if (!isEligible(m)) continue; // ineligible ballots are silently dropped
    latest.set(v.memberId, v.ballot);
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

  return { approve, reject, abstain, eligibleBallots, quorumMet, approvalRatio };
}

// Does a tally pass on its own (before founder override)?
// Needs quorum AND strictly more than the threshold ratio — ties fail, because
// a change requires positive consent; the status quo wins a tie.
export function tallyPasses(t: Tally): boolean {
  return t.quorumMet && t.approvalRatio > GOVERNANCE.approvalThreshold;
}
