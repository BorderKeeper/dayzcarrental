import type { Metadata } from "next";
import DemoNotice from "@/components/DemoNotice";
import { SITE } from "@/data/site";
import { GOVERNANCE, ACTION_CATALOG } from "@/lib/governance";

export const metadata: Metadata = {
  title: "How Governance Works — DayzCarRental.com",
  description:
    "The community proposes, votes with emoji, and the AI maintainer queues a PR for the founder to merge. Money and deploy powers stay disabled until later phases.",
};

// This page reads the SAME values the governance engine enforces
// (src/lib/governance/config.ts), so the public description and the actual
// rules can't drift apart. See GOVERNANCE.md for the full model.
export default function GovernancePage() {
  const enabled = ACTION_CATALOG.filter((a) => a.enabled);
  const disabled = ACTION_CATALOG.filter((a) => !a.enabled);

  return (
    <div>
      <h1>How Governance Works</h1>
      <DemoNotice>
        This describes the live model the community runs in Discord. The vote engine that automates it
        is being built in phases — see the numbers below, which come straight from the engine config.
      </DemoNotice>

      <div className="panel">
        <h2>Proposal → vote → PR</h2>
        <ol className="stack" style={{ paddingLeft: 18 }}>
          <li>
            <strong>Anyone proposes</strong> a change in Discord — new server, site copy, a policy note.
          </li>
          <li>
            <strong>Compliance pre-check.</strong> Anything touching money, donations, deposits, or the
            Bohemia disclaimer is checked against our locked rules first. Violations are{" "}
            <strong>dead on arrival</strong> — no vote can approve them.
          </li>
          <li>
            <strong>The community votes</strong> with emoji: ✅ approve · ❌ reject · 🤷 abstain.
          </li>
          <li>
            <strong>Quorum + majority decides.</strong> See the thresholds below.
          </li>
          <li>
            <strong>Founder override / veto</strong> can stop anything, always.
          </li>
          <li>
            <strong>Audited action.</strong> On approval the AI maintainer opens a feature branch → PR;
            the <strong>founder merges</strong>. Discord fills the queue; it never merges or spends.
          </li>
        </ol>
      </div>

      <div className="panel">
        <h2>The current vote rules</h2>
        <ul className="stack" style={{ paddingLeft: 18 }}>
          <li>
            <strong>Who can vote:</strong> verified members whose account is at least{" "}
            <strong>{GOVERNANCE.eligibility.minAccountAgeDays} days</strong> old (blocks throwaway
            sockpuppets).
          </li>
          <li>
            <strong>Quorum:</strong> at least <strong>{GOVERNANCE.quorumMinBallots}</strong> eligible
            ✅/❌ ballots, or the proposal fails as &ldquo;no quorum.&rdquo;
          </li>
          <li>
            <strong>Threshold:</strong> a simple majority of non-abstain ballots (ties fail — the status
            quo wins).
          </li>
          <li>
            <strong>Voting window:</strong> {GOVERNANCE.voteWindowHours} hours.
          </li>
        </ul>
      </div>

      <div className="panel">
        <h2>What a vote can (and can&apos;t) do</h2>
        <p className="small muted">
          The AI maintainer will only ever queue actions on this allow-list — and only the enabled
          ones. Financial and deploy powers are built but <strong>disabled</strong> until later phases
          add spend caps, allow-lists, a public ledger, and audit controls.
        </p>
        <p>
          <strong>Enabled now (content &amp; ops):</strong>
        </p>
        <ul className="stack" style={{ paddingLeft: 18 }}>
          {enabled.map((a) => (
            <li key={a.kind}>{a.label}</li>
          ))}
        </ul>
        <p>
          <strong>Disabled until later phases (founder-driven only):</strong>
        </p>
        <ul className="stack" style={{ paddingLeft: 18 }}>
          {disabled.map((a) => (
            <li key={a.kind} className="muted">
              {a.label}
              {a.note ? <span className="small"> — {a.note}</span> : null}
            </li>
          ))}
        </ul>
      </div>

      <div className="panel" style={{ textAlign: "center" }}>
        <h2 style={{ border: "none" }}>Want a say in how the fleet is run?</h2>
        <p>
          Join Discord, get verified, and weigh in on the next proposal in <strong>#vote</strong>.
        </p>
        <a className="btn btn--big" href={SITE.discordInvite} target="_blank" rel="noopener noreferrer">
          Join our Discord &raquo;
        </a>
      </div>
    </div>
  );
}
