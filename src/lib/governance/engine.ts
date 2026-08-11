// engine.ts — the governance engine facade. Ties together the compliance/
// injection screen, the vote tally, the founder override, and the audit log
// into the single pipeline DISCORD.md §5a describes:
//
//   proposal → compliance pre-check → emoji vote → quorum/threshold →
//   founder override/veto → audited action (queued PR / runner-ops)
//
// The engine NEVER executes anything itself. On approval it returns a queued
// effect ("open a feature branch → PR for the founder to merge"). Money and
// deploy actions are disabled at the allowlist (config.ts), so a passed vote
// can never move money or ship — matching CLAUDE.md rule 4 and ROADMAP.md.

import type { Member, Proposal, Vote, Outcome, Decision } from "./types";
import { screenProposal } from "./screen";
import { tallyVotes, tallyPasses } from "./vote";
import { findAction } from "./config";
import { AuditLog } from "./audit";

export interface RunOptions {
  // A founder decision layered on top of the tally. "veto" rejects regardless
  // of the tally; "approve" force-approves a compliant-but-under-quorum item.
  // The founder can NEVER override a dead-on-arrival (compliance/injection)
  // proposal to approval — the repo hooks would block the edit anyway, and
  // COMPLIANCE.md cannot be amended by anyone in an autonomous session.
  founderOverride?: "veto" | "approve";
  founderId?: string;
}

export class GovernanceEngine {
  readonly audit: AuditLog;
  private members: Map<string, Member>;

  constructor(members: Map<string, Member>, audit?: AuditLog) {
    this.members = members;
    this.audit = audit ?? new AuditLog();
  }

  // Run a proposal + its votes through the full pipeline, returning an Outcome
  // and appending audit entries along the way.
  run(proposal: Proposal, votes: Vote[], opts: RunOptions = {}): Outcome {
    this.audit.append("proposal-opened", `'${proposal.title}' (${proposal.actionKind})`, {
      proposalId: proposal.id,
      actorId: proposal.authorId,
    });

    // 1. Compliance + injection screen. Failure = dead on arrival, no vote.
    const screen = screenProposal(proposal);
    if (!screen.ok) {
      const detail = screen.reasons.map((r) => r.detail).join(" | ");
      this.audit.append("proposal-dead-on-arrival", detail, { proposalId: proposal.id });
      return {
        proposalId: proposal.id,
        decision: "dead-on-arrival",
        screen,
        effect: "none",
        summary: `Dead on arrival — failed the compliance/safety screen: ${detail}`,
      };
    }

    // 2. Tally the eligible votes.
    const tally = tallyVotes(votes, this.members);
    this.audit.append(
      "vote-tallied",
      `✅${tally.approve} ❌${tally.reject} 🤷${tally.abstain} (quorum ${tally.quorumMet ? "met" : "NOT met"})`,
      { proposalId: proposal.id },
    );

    // 3. Founder override sits on top of the tally.
    let decision: Decision;
    if (opts.founderOverride === "veto") {
      decision = "founder-vetoed";
    } else if (opts.founderOverride === "approve") {
      decision = "approved";
      this.audit.append("founder-override-approve", `by ${opts.founderId ?? "founder"}`, {
        proposalId: proposal.id,
        actorId: opts.founderId,
      });
    } else if (!tally.quorumMet) {
      decision = "no-quorum";
    } else {
      decision = tallyPasses(tally) ? "approved" : "rejected";
    }

    // 4. Determine the (always queued, founder-gated) effect of an approval.
    const action = findAction(proposal.actionKind); // known+enabled (screen passed)
    const effect =
      decision === "approved" && action
        ? action.effect === "queue-runner-ops"
          ? "queue-runner-ops"
          : "queue-pr"
        : "none";

    const summary = this.summarize(decision, tally, effect);
    this.audit.append("proposal-decided", `${decision} → ${effect}`, { proposalId: proposal.id });

    return { proposalId: proposal.id, decision, tally, screen, effect, summary };
  }

  private summarize(decision: Decision, t: { approve: number; reject: number; abstain: number }, effect: string): string {
    const votes = `✅${t.approve}/❌${t.reject}/🤷${t.abstain}`;
    switch (decision) {
      case "approved":
        return `Approved (${votes}). Action queued as ${effect} for the founder to merge. No money moves, nothing deploys.`;
      case "rejected":
        return `Rejected (${votes}). Status quo stands.`;
      case "no-quorum":
        return `No quorum (${votes}). Not enough eligible voters; re-run when more weigh in.`;
      case "founder-vetoed":
        return `Founder veto (${votes}). Overridden regardless of tally.`;
      case "dead-on-arrival":
        return `Dead on arrival.`;
    }
  }
}
