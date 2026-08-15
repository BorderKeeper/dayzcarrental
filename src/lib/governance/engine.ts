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

import type { Member, Proposal, Vote, Outcome, Decision, Tally } from "./types";
import { screenProposal } from "./screen";
import { tallyVotes, tallyPasses } from "./vote";
import { findAction, effectiveQuorum } from "./config";
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
      `✅${tally.approve} ❌${tally.reject} 🤷${tally.abstain} (quorum ${tally.quorumMet ? "met" : "NOT met"})` +
        (tally.excluded.total > 0
          ? ` — ${tally.excluded.total} excluded (${tally.excluded.unverified} unverified, ` +
            `${tally.excluded.tooYoung} too young, ${tally.excluded.unknown} unknown)`
          : ""),
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


  private summarize(decision: Decision, t: Tally, effect: string): string {
    const votes = `✅${t.approve}/❌${t.reject}/🤷${t.abstain}`;
    const excluded = excludedNote(t);
    switch (decision) {
      case "approved":
        return `Approved (${votes}). Action queued as ${effect} for the founder to merge. No money moves, nothing deploys.${excluded}`;
      case "rejected":
        return `Rejected (${votes}). Status quo stands.${excluded}`;
      case "no-quorum": {
        // "re-run when more weigh in" left people guessing how many more, on a
        // server that may not yet HAVE that many eligible voters (F-02). Say
        // the number, and say that abstains don't count toward it.
        const need = effectiveQuorum();
        const short = need - t.eligibleBallots;
        return (
          `No quorum (${votes}). Needs ${need} eligible ✅/❌ ballot${need === 1 ? "" : "s"} ` +
          `and got ${t.eligibleBallots} — ${short} more to go. 🤷 doesn't count toward quorum.${excluded}`
        );
      }
      case "founder-vetoed":
        return `Founder veto (${votes}). Overridden regardless of tally.`;
      case "dead-on-arrival":
        return `Dead on arrival.`;
    }
  }
}

// Spell out ballots that were cast but not counted. Silence here is the failure
// mode E-02 describes: a misconfigured role map makes every voter resolve as
// unverified, the tally reads "No quorum (✅0/❌0/🤷0)", and it is indis-
// tinguishable from nobody caring. If people voted and weren't counted, say so.
function excludedNote(t: Tally): string {
  if (t.excluded.total === 0) return "";
  const parts: string[] = [];
  if (t.excluded.unverified > 0) parts.push(`${t.excluded.unverified} not @Verified`);
  if (t.excluded.tooYoung > 0) parts.push(`${t.excluded.tooYoung} below the account-age gate`);
  if (t.excluded.unknown > 0) parts.push(`${t.excluded.unknown} not resolvable as members`);
  const hint =
    t.excluded.unverified > 0 && t.approve + t.reject + t.abstain === 0
      ? " If those voters *are* verified, DISCORD_ROLE_MAP is probably wrong — check it before re-running."
      : "";
  return ` ${t.excluded.total} ballot(s) were not counted: ${parts.join(", ")}.${hint}`;
}
