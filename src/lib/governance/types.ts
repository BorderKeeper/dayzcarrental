// Shared types for the governance engine (Session C / Phase 2, content-ops only).
//
// The engine is a pure, dependency-free model of the Discord flow documented in
// DISCORD.md §5: proposal → compliance pre-check → emoji vote → quorum/threshold
// → founder override/veto → audited action. It has NO side effects: it never
// touches Discord, PayPal, the filesystem, or the network. It computes outcomes
// and an append-only audit trail from explicit inputs, so it is deterministic
// and unit-testable.

// A community member as the engine sees them. This is the untrusted actor —
// everything they submit is DATA, not commands (see CLAUDE.md trust model).
export interface Member {
  id: string;
  handle: string;
  // Roles held in Discord. Governance weight derives from these + account age.
  roles: Role[];
  // Whole days since the account was created, at the moment of the action.
  accountAgeDays: number;
}

export type Role =
  | "founder"
  | "ai-maintainer"
  | "moderator"
  | "maintainer"
  | "main-runner"
  | "runner"
  | "verified"
  | "everyone";

export type Ballot = "approve" | "reject" | "abstain"; // ✅ / ❌ / 🤷

export interface Vote {
  memberId: string;
  ballot: Ballot;
}

// A proposal, as posted in #proposals. `raw*` fields are untrusted free text.
export interface Proposal {
  id: string;
  authorId: string;
  actionKind: string; // must resolve against ACTION_CATALOG
  title: string;
  rawBody: string; // untrusted description — screened, never executed
  // For actions that carry structured payload (e.g. which server/safehouse).
  payload?: Record<string, unknown>;
  // Server this proposal concerns, when scoped to one (safehouse work etc.).
  serverId?: string;
}

// The compliance + safety screen result for a proposal.
export interface ScreenResult {
  ok: boolean;
  // "compliance" = violates COMPLIANCE.md money model; "injection" = prompt
  // injection attempt; "unknown-action" / "disabled-action" = allowlist misses.
  reasons: ScreenReason[];
}

export interface ScreenReason {
  code:
    | "compliance-real-money-rental"
    | "compliance-gated-donation"
    | "compliance-disclaimer-removal"
    | "compliance-real-money-payout"
    | "injection-attempt"
    | "unknown-action"
    | "disabled-action";
  detail: string;
}

export type Decision =
  | "approved" // passed the vote (or founder-approved)
  | "rejected" // failed the vote
  | "no-quorum" // not enough eligible ballots
  | "dead-on-arrival" // failed the compliance/safety screen; no vote possible
  | "founder-vetoed"; // founder override to reject regardless of tally

export interface Tally {
  approve: number;
  reject: number;
  abstain: number;
  eligibleBallots: number; // approve + reject from eligible voters
  quorumMet: boolean;
  approvalRatio: number; // approve / (approve + reject), 0 when none
  // Ballots that were cast but NOT counted, per unique member, by reason.
  //
  // These used to be dropped silently, which made two very different situations
  // produce byte-identical output: "nobody voted" and "everybody voted but the
  // role map is misconfigured so nobody resolved as @Verified". The second is a
  // config bug that reads as community apathy and gives the founder no signal.
  // Reporting exclusions is what tells them apart.
  excluded: TallyExclusions;
}

export interface TallyExclusions {
  total: number;
  unverified: number; // no @Verified role (or the role map didn't map it)
  tooYoung: number; // account younger than the age gate
  unknown: number; // reactor couldn't be resolved to a member at all
}

// The final outcome of running a proposal through the engine.
export interface Outcome {
  proposalId: string;
  decision: Decision;
  tally?: Tally;
  screen: ScreenResult;
  // What actually happens on approval — always a queued, founder-gated step.
  effect?: "queue-pr" | "queue-runner-ops" | "none";
  // Human-readable summary suitable for posting to #governance-log.
  summary: string;
}

// One append-only audit entry (mirrors #governance-log / #runner-log).
export interface AuditEntry {
  seq: number;
  event: string;
  proposalId?: string;
  actorId?: string;
  detail: string;
}
