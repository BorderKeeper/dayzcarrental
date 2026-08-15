"use client";

import { useState } from "react";
import { SITE } from "@/data/site";

// C-06: a server owner is the audience that brings players, and had no way in.
// The only real path was a Discord proposal needing a manually-granted role,
// three eligible voters and a 48-hour window — a constitutional amendment for
// what should be routine runner-ops admin. This is the front door.
export default function ServerRequestForm() {
  const [serverName, setServerName] = useState("");
  const [map, setMap] = useState("");
  const [contactType, setContactType] = useState<"discord" | "email">("discord");
  const [contact, setContact] = useState("");
  const [detail, setDetail] = useState("");
  const [errors, setErrors] = useState<string[]>([]);
  const [sending, setSending] = useState(false);
  const [done, setDone] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    const errs: string[] = [];
    if (!serverName.trim()) errs.push("Tell us the server's name.");
    if (!contact.trim()) errs.push("Leave a Discord handle or email so we can reach you.");
    if (contactType === "email" && contact && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(contact))
      errs.push("That doesn't look like a valid email address.");
    setErrors(errs);
    if (errs.length > 0) return;

    setSending(true);
    try {
      const res = await fetch("/api/intake", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          kind: "server-request",
          contactType,
          contact: contact.trim(),
          serverName: serverName.trim(),
          detail: [map.trim() && `Map: ${map.trim()}`, detail.trim()].filter(Boolean).join(" — "),
        }),
      });
      const data = await res.json().catch(() => null);
      if (res.ok && data?.ok) setDone(true);
      else setErrors([data?.detail ?? "We couldn't record that just now. Try again, or ask in Discord."]);
    } catch {
      setErrors(["We couldn't reach the server. Try again, or ask in Discord."]);
    } finally {
      setSending(false);
    }
  }

  if (done) {
    return (
      <div className="stack">
        <div className="notice notice--success">
          <strong>Thanks — we&apos;ve got it.</strong> Someone will come back to you about listing{" "}
          {serverName.trim()}. The main thing we&apos;ll want to work out together is who runs cars
          there — a server needs at least one runner before anything can be rented on it.
        </div>
        <p className="small muted">
          If you&apos;d rather talk it through,{" "}
          <a href={SITE.discordInvite} target="_blank" rel="noopener noreferrer">
            join the Discord
          </a>{" "}
          and say hello.
        </p>
      </div>
    );
  }

  return (
    <form onSubmit={submit} className="stack" noValidate>
      {errors.length > 0 && (
        <div className="notice" style={{ borderColor: "#a11", background: "#fbe4e4" }}>
          <ul style={{ margin: 0, paddingLeft: 18 }}>
            {errors.map((err) => (
              <li key={err} className="field-error" style={{ marginTop: 0 }}>
                {err}
              </li>
            ))}
          </ul>
        </div>
      )}

      <div>
        <label htmlFor="srv-name">Server name</label>
        <input
          id="srv-name"
          type="text"
          placeholder="e.g. Chernarus Survival RP"
          value={serverName}
          onChange={(e) => setServerName(e.target.value)}
        />
      </div>

      <div>
        <label htmlFor="srv-map">Map</label>
        <input
          id="srv-map"
          type="text"
          placeholder="Chernarus, Livonia, Sakhal…"
          value={map}
          onChange={(e) => setMap(e.target.value)}
        />
      </div>

      <div>
        <label>How should we reach you?</label>
        <div className="row">
          <label style={{ fontWeight: "normal", margin: 0 }}>
            <input
              type="radio"
              name="srv-contact-type"
              checked={contactType === "discord"}
              onChange={() => setContactType("discord")}
              style={{ width: "auto", marginRight: 6 }}
            />
            Discord
          </label>
          <label style={{ fontWeight: "normal", margin: 0 }}>
            <input
              type="radio"
              name="srv-contact-type"
              checked={contactType === "email"}
              onChange={() => setContactType("email")}
              style={{ width: "auto", marginRight: 6 }}
            />
            Email
          </label>
        </div>
        <input
          id="srv-contact"
          type={contactType === "email" ? "email" : "text"}
          placeholder={contactType === "discord" ? "survivor#0001 or @survivor" : "you@example.com"}
          value={contact}
          onChange={(e) => setContact(e.target.value)}
        />
      </div>

      <div>
        <label htmlFor="srv-detail">Anything else? (optional)</label>
        <textarea
          id="srv-detail"
          rows={4}
          placeholder="Roughly how many players, PvE or PvP, whether you already have someone who'd run cars…"
          value={detail}
          onChange={(e) => setDetail(e.target.value)}
        />
        <div className="field-hint">
          We keep your contact details so a runner can get back to you. Only the crew sees them,
          they&apos;re never published, and they aren&apos;t used for anything else.
        </div>
      </div>

      <div>
        <button className="btn btn--big" type="submit" disabled={sending}>
          {sending ? "Sending…" : "Ask us to list it »"}
        </button>
      </div>
    </form>
  );
}
