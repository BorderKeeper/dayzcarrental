import type { Metadata } from "next";
import ServerRequestForm from "@/components/ServerRequestForm";
import { SITE } from "@/data/site";

export const metadata: Metadata = {
  title: "List Your Server — DayzCarRental.com",
  description: "Run a DayZ server and want a car rental service on it? Tell us and we'll set it up.",
};

export default function ListYourServerPage() {
  return (
    <div>
      <h1>List Your Server</h1>

      <div className="panel panel--plain">
        <p>
          Run a DayZ server? A rental fleet gives your players a reason to co-operate — someone has
          to find the cars, someone has to fix them, and someone has to get them where they&apos;re
          needed. It costs you nothing and no real money changes hands anywhere in it.
        </p>
      </div>

      <div className="panel">
        <h2>What actually happens</h2>
        <ol className="stack" style={{ paddingLeft: 18 }}>
          <li>
            <strong>You tell us about the server</strong> using the form below.
          </li>
          <li>
            <strong>We talk about runners.</strong> This is the real question. A server needs at
            least one <a href="/runner">runner</a> — a volunteer who stages cars and hands over lock
            codes. Often that&apos;s you or someone already on your server.
          </li>
          <li>
            <strong>We add the server and its safehouses</strong>, and your runner keeps that list
            current themselves — no vote, no waiting on us.
          </li>
        </ol>
        <p className="small muted">
          Days, not weeks — and no, you don&apos;t need to learn how the governance system works.
          That&apos;s for changing the rules, not for getting listed.
        </p>
      </div>

      <div className="panel">
        <h2>Tell us about your server</h2>
        <ServerRequestForm />
      </div>

      <div className="panel" style={{ textAlign: "center" }}>
        <h2 style={{ border: "none" }}>Rather just talk?</h2>
        <p>Come and say hello — we&apos;re a small crew and we answer.</p>
        <a className="btn btn--big" href={SITE.discordInvite} target="_blank" rel="noopener noreferrer">
          Join our Discord &raquo;
        </a>
      </div>
    </div>
  );
}
