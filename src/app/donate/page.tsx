import type { Metadata } from "next";
import DemoNotice from "@/components/DemoNotice";
import { SITE } from "@/data/site";

export const metadata: Metadata = {
  title: "Donate — DayzCarRental.com",
  description: "Support DayzCarRental.com upkeep with a voluntary PayPal donation.",
};

export default function DonatePage() {
  return (
    <div>
      <h1>Donate</h1>
      <DemoNotice>The donate button below is a placeholder — wire it to a real PayPal link before launch.</DemoNotice>

      <div className="panel panel--plain">
        <p>
          DayzCarRental.com is a free, community-run project. Donations are{" "}
          <strong>entirely voluntary</strong> and go toward keeping it running — hosting, the AI
          maintainer&apos;s tokens, and community tools.
        </p>
        <p className="small muted">
          Donations do <strong>not</strong> buy in-game cars or advantages. Renting a car is always
          paid in in-game items, in-game. This keeps us on the right side of DayZ&apos;s rules.
        </p>
      </div>

      <div className="panel" style={{ textAlign: "center" }}>
        <h2 style={{ border: "none" }}>Chip in for upkeep</h2>
        <p>Every bit helps keep the fleet on the road.</p>
        <a className="btn btn--big" href={SITE.paypalDonate} target="_blank" rel="noopener noreferrer">
          Donate with PayPal &raquo;
        </a>
        <p className="small muted" style={{ marginTop: 12 }}>
          You&apos;ll be taken to PayPal to complete a secure donation.
        </p>
      </div>
    </div>
  );
}
