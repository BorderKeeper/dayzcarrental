import type { Metadata } from "next";
import DemoNotice from "@/components/DemoNotice";
import TreasuryBalance from "@/components/TreasuryBalance";
import { SITE } from "@/data/site";

export const metadata: Metadata = {
  title: "Donate — DayzCarRental.com",
  description: "Support DayzCarRental.com upkeep with a voluntary PayPal donation.",
};

// The live donate URL comes from NEXT_PUBLIC_PAYPAL_DONATE_URL when set (a
// PayPal hosted-button / donation link the founder creates in the PayPal
// dashboard — sandbox for testing, live for production), falling back to the
// placeholder in site.ts. NEXT_PUBLIC_ so it's available in the client bundle;
// it's a public checkout URL, not a secret.
const DONATE_URL = process.env.NEXT_PUBLIC_PAYPAL_DONATE_URL || SITE.paypalDonate;
const IS_PLACEHOLDER = DONATE_URL.includes("REPLACE_ME");

export default function DonatePage() {
  return (
    <div>
      <h1>Donate</h1>
      {/* This page ALWAYS carries a notice. The old logic showed one only while
          the button was fake and dropped it the moment the button could charge
          real money — inverted relative to risk. Both branches below render. */}
      {IS_PLACEHOLDER ? (
        <DemoNotice>
          The donate button below isn&apos;t wired to a real PayPal link yet — set
          NEXT_PUBLIC_PAYPAL_DONATE_URL to your PayPal donation link.
        </DemoNotice>
      ) : (
        <div className="notice notice--money" role="note">
          <strong>This button takes real money.</strong> The rest of the site is a mockup, but this
          donation is a genuine PayPal payment and will actually leave your account. It is{" "}
          <strong>entirely voluntary</strong>, funds upkeep only, and buys you nothing in-game — no
          car, no priority, no advantage.
        </div>
      )}

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
        <a className="btn btn--big" href={DONATE_URL} target="_blank" rel="noopener noreferrer">
          Donate with PayPal &raquo;
        </a>
        <p className="small muted" style={{ marginTop: 12 }}>
          You&apos;ll be taken to PayPal to complete a secure donation. The upkeep figure below is
          reconciled against PayPal on a schedule, so{" "}
          <strong>allow up to about 24 hours for a donation to show up here</strong> — PayPal itself
          can take a few hours to publish a transaction. If it hasn&apos;t appeared after a day,
          say so in Discord and we&apos;ll chase it. Your PayPal receipt is the record of payment;
          this counter is only a transparency display.
        </p>
        <TreasuryBalance />
      </div>
    </div>
  );
}
