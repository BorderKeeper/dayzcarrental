// Governance engine configuration — the concrete values for the Session C /
// Phase 2 "AI maintainer (content/ops only)" flow described in ROADMAP.md and
// DISCORD.md §5. These numbers were the "Open Item" in ROADMAP.md; they are
// recorded here (and mirrored in GOVERNANCE.md) as the chosen starting values.
//
// IMPORTANT — read alongside COMPLIANCE.md and CLAUDE.md:
//   * This is the SITE's mockup model of the flow. COMPLIANCE.md is the locked
//     source of truth; nothing here can amend it.
//   * SPEND and DEPLOY powers stay OFF (see ACTION_CATALOG). A passed vote can
//     only ever queue a content/ops PR for the founder to merge — never move
//     money and never deploy. Those flip on in Phase 3/4, founder-driven.

// Voting parameters. Deliberately conservative to blunt Risk #4 in ROADMAP.md
// (sockpuppet vote-stuffing on a system that can eventually move money).
export const GOVERNANCE = {
  // Eligibility: who counts as a voter at all.
  eligibility: {
    // A member must hold @Verified (passed Discord member screening).
    requireVerified: true,
    // …and their account must be at least this old. Mirrors the DISCORD.md
    // account-age gate. Blocks day-old sockpuppets from swinging a vote.
    minAccountAgeDays: 7,
  },

  // Quorum: the minimum number of *eligible* voters who must cast a
  // non-abstain (✅/❌) vote for the tally to count at all. Below quorum the
  // proposal fails as "no quorum" regardless of the ratio.
  quorumMinBallots: 3,

  // Threshold: simple majority of non-abstain ballots. 0.5 means "more ✅ than
  // ❌"; ties fail (a change needs positive consent, the status quo wins ties).
  approvalThreshold: 0.5,

  // How long a vote stays open (informational for the mockup; the engine takes
  // an explicit deadline/now so it stays deterministic and testable).
  voteWindowHours: 48,
} as const;

// The action allowlist. The governance engine will ONLY ever queue actions
// whose kind is listed here AND flagged enabled. Everything financial or
// deploy-related is present but DISABLED, so the shape is built now and the
// power turns on later (founder-driven, Phase 3/4) — never by a Discord vote.
export interface ActionSpec {
  kind: string;
  label: string;
  enabled: boolean; // if false, a passed vote still cannot execute it
  // The safe outcome of a passed content/ops action is always the same:
  // open a feature branch → PR for the founder to merge. Never a direct write.
  effect: "queue-pr" | "queue-runner-ops" | "disabled-needs-founder";
  note?: string;
}

export const ACTION_CATALOG: readonly ActionSpec[] = [
  {
    kind: "content-edit",
    label: "Edit site copy / listings / non-locked docs",
    enabled: true,
    effect: "queue-pr",
  },
  {
    kind: "server-add",
    label: "Add a DayZ server to the supported list",
    enabled: true,
    effect: "queue-pr",
  },
  {
    kind: "safehouse-change",
    label: "Add/remove/stage a safehouse (routine → runner-ops side channel)",
    enabled: true,
    effect: "queue-runner-ops",
    note: "Routine runner work; does not need a full community vote (see runner-ops).",
  },
  {
    kind: "policy-note",
    label: "Publish a non-binding community policy note",
    enabled: true,
    effect: "queue-pr",
  },
  // ---- present but DISABLED until Phase 3/4 (founder-driven only) ----------
  {
    kind: "treasury-spend",
    label: "Spend from the donation treasury",
    enabled: false,
    effect: "disabled-needs-founder",
    note: "Phase 3. Needs caps + allowlist + ledger + founder veto before it can turn on.",
  },
  {
    kind: "deploy",
    label: "Deploy the site",
    enabled: false,
    effect: "disabled-needs-founder",
    note: "Phase 3+. Needs CI + human approval before it can turn on.",
  },
  {
    kind: "real-money-rental",
    label: "Enable real-money rental pricing/checkout",
    enabled: false,
    effect: "disabled-needs-founder",
    note: "PROHIBITED by COMPLIANCE.md. Cannot be enabled by any vote; founder + legal review only.",
  },
] as const;

export function findAction(kind: string): ActionSpec | undefined {
  return ACTION_CATALOG.find((a) => a.kind === kind);
}
