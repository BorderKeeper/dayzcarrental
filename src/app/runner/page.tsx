import type { Metadata } from "next";
import DemoNotice from "@/components/DemoNotice";
import { SITE } from "@/data/site";

export const metadata: Metadata = {
  title: "Become a Runner — DayzCarRental.com",
  description:
    "Runners move cars from safehouses to renters, share lock codes, and recover returned and donated vehicles.",
};

export default function RunnerPage() {
  return (
    <div>
      <h1>Become a Runner</h1>
      <DemoNotice>Runners are the boots on the ground — join Discord to get set up on a server.</DemoNotice>

      <div className="panel panel--plain">
        <p>
          Runners are the operators who make rentals real in-game. If you know your way around a map
          and like the logistics side of DayZ, this is the role for you.
        </p>
      </div>

      <div className="panel">
        <h2>What a runner does</h2>
        <ul className="stack" style={{ paddingLeft: 18 }}>
          <li>
            <strong>Transport cars</strong> from safehouses to the garage or pickup point the renter
            selected.
          </li>
          <li>
            <strong>Communicate lock codes</strong> to renters once payment is confirmed.
          </li>
          <li>
            <strong>Retrieve returned cars</strong> when a rental ends, and check the deposit terms.
          </li>
          <li>
            <strong>Collect donated cars</strong>, get them road-worthy, and stage them for the next
            renter.
          </li>
        </ul>
      </div>

      <div className="panel">
        <h2>Main runners &amp; safehouse admin</h2>
        <p>
          Each server has its own set of approved safehouses. Runners keep that list current in a
          dedicated <strong>runner-ops</strong> channel — separate from the big AI-governance votes —
          handling routine admin like adding or removing safehouses.
        </p>
        <p className="small muted">
          Trusted runners can earn a per-server <strong>&ldquo;main runner&rdquo; tag</strong> that
          lets them influence that server&apos;s safehouse list directly, without a full community
          vote.
        </p>
      </div>

      <div className="panel" style={{ textAlign: "center" }}>
        <h2 style={{ border: "none" }}>Want to run cars on your server?</h2>
        <p>Hop into the <strong>#runners</strong> channel and tell us which servers you play.</p>
        <a className="btn btn--big" href={SITE.discordInvite} target="_blank" rel="noopener noreferrer">
          Join our Discord &raquo;
        </a>
      </div>
    </div>
  );
}
