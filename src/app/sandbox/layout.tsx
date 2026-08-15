import type { Metadata } from "next";
import Link from "next/link";

// Keep the fake servers out of search results. Someone finding "Chernarus
// Official #1234" via Google and landing here would have no idea it's a demo.
export const metadata: Metadata = {
  robots: { index: false, follow: false },
};

// Every page under /sandbox carries this banner. It is deliberately not
// dismissible: a visitor must never be able to end up looking at invented
// servers with nothing on screen telling them so (C-10).
export default function SandboxLayout({ children }: { children: React.ReactNode }) {
  return (
    <div>
      <div className="notice notice--sandbox" role="note">
        <strong>Sample data.</strong> The servers, safehouses and staged cars below are{" "}
        <strong>invented</strong> so you can try the site end to end. Nothing here is a real DayZ
        server and no request is ever sent.{" "}
        <Link href="/" className="sandbox-switch">
          Switch to the live site &raquo;
        </Link>
      </div>
      {children}
    </div>
  );
}
