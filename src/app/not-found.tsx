import type { Metadata } from "next";
import Link from "next/link";
import { NAV, SITE } from "@/data/site";

export const metadata: Metadata = {
  title: "Page not found — DayzCarRental.com",
  description: "That page doesn't exist. Here's the way back to the fleet.",
};

// Without this, a mistyped URL renders Next's bare default page: no masthead,
// no nav, no way home.
export default function NotFound() {
  return (
    <div>
      <h1>Page not found</h1>
      <div className="notice">
        That road doesn&apos;t go anywhere. The link may be old, or we may have moved the page.
      </div>

      <div className="panel">
        <h2>Where you probably wanted to go</h2>
        <ul className="stack" style={{ paddingLeft: 18 }}>
          {NAV.map((item) => (
            <li key={item.href}>
              <Link href={item.href}>{item.label}</Link>
            </li>
          ))}
        </ul>
      </div>

      <div className="panel" style={{ textAlign: "center" }}>
        <p>Still stuck? Ask in Discord — someone will point you the right way.</p>
        <a className="btn" href={SITE.discordInvite} target="_blank" rel="noopener noreferrer">
          Join our Discord &raquo;
        </a>
      </div>
    </div>
  );
}
