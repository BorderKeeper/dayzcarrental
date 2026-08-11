import type { Metadata } from "next";
import DemoNotice from "@/components/DemoNotice";
import { SITE } from "@/data/site";

export const metadata: Metadata = {
  title: "Become a Maintainer — DayzCarRental.com",
  description:
    "Help govern the AI maintainer that runs the fleet — propose changes and vote with the community in Discord.",
};

export default function MaintainerPage() {
  return (
    <div>
      <h1>Become a Maintainer</h1>
      <DemoNotice>
        Maintainer governance is being built out in phases — join Discord to help shape it.
      </DemoNotice>

      <div className="panel panel--plain">
        <p>
          Maintainers steer the <strong>AI maintainer</strong> — the bot that keeps
          DayzCarRental.com running day to day. You don&apos;t need to code. You need judgment and a
          few minutes to weigh in on decisions.
        </p>
      </div>

      <div className="panel">
        <h2>How governance works</h2>
        <ol className="stack" style={{ paddingLeft: 18 }}>
          <li>
            <strong>Anyone proposes.</strong> A change — new server, price tweak, policy, content —
            is posted as a proposal in Discord.
          </li>
          <li>
            <strong>The community votes with emoji reactions.</strong> Maintainers react to approve
            or reject.
          </li>
          <li>
            <strong>Quorum + majority decides.</strong> If enough maintainers vote and the majority
            approves, the AI carries out the action.
          </li>
          <li>
            <strong>Founder override / veto.</strong> A founder safety check can veto anything —
            especially early on, and always for money or deployment actions.
          </li>
          <li>
            <strong>Everything is logged.</strong> Actions are audited so the community can see what
            was decided and done.
          </li>
        </ol>
        <p className="small muted">
          Financial and deployment powers stay <strong>disabled</strong> until later phases add spend
          caps, allow-lists, and audit controls. Early maintainers focus on content and operations.
        </p>
      </div>

      <div className="panel" style={{ textAlign: "center" }}>
        <h2 style={{ border: "none" }}>Ready to help govern the fleet?</h2>
        <p>Introduce yourself in the <strong>#maintainers</strong> channel and grab the role.</p>
        <a className="btn btn--big" href={SITE.discordInvite} target="_blank" rel="noopener noreferrer">
          Join our Discord &raquo;
        </a>
      </div>
    </div>
  );
}
