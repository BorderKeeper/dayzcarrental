import type { Metadata } from "next";
import Link from "next/link";
import "./globals.css";
import TopNav from "@/components/TopNav";
import { SITE } from "@/data/site";

export const metadata: Metadata = {
  title: "DayzCarRental.com — community car rentals for DayZ",
  description:
    "Rent, donate, and run cars in DayZ. A community-run mockup: rent vehicles from approved safehouses, donate a car, or join as a maintainer or runner.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>
        <div className="site">
          <header className="masthead">
            <Link href="/" className="brand">
              DayzCarRental<span className="dot">.com</span>
            </Link>
            <div className="tagline">{SITE.tagline}</div>
          </header>
          <TopNav />
          <main className="content">{children}</main>
          <footer className="footer">
            <p>
              &copy; 2026 {SITE.name} &middot; A community mockup &middot;{" "}
              <a href={`mailto:${SITE.contactEmail}`}>{SITE.contactEmail}</a>
            </p>
            <p className="small">jan is awesome</p>
            <p className="small">
              This is a non-commercial fan project and is <strong>not affiliated with or
              endorsed by Bohemia Interactive</strong>. DayZ is a trademark of Bohemia Interactive
              a.s. Rentals are paid in in-game items only; real-money contributions are voluntary
              donations toward upkeep.
            </p>
          </footer>
        </div>
      </body>
    </html>
  );
}
