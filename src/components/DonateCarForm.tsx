"use client";

import { useState } from "react";
import ServerSelect, { CUSTOM_SERVER } from "@/components/ServerSelect";
import type { GameServer } from "@/data/types";

// Client-side mockup form: validates and shows a demo confirmation.
//
// Unlike renting, "Other / not listed" stays available here whatever the server
// list looks like: a donated car on a server we don't cover yet is still a
// useful lead — it's often the reason a server becomes covered.
export default function DonateCarForm({ servers, isSandbox = false }: { servers: GameServer[]; isSandbox?: boolean }) {
  const [serverId, setServerId] = useState("");
  const [customServer, setCustomServer] = useState("");
  const [vehicle, setVehicle] = useState("");
  const [location, setLocation] = useState("");
  const [howToRun, setHowToRun] = useState("");
  const [barter, setBarter] = useState("");
  const [notes, setNotes] = useState("");
  const [contact, setContact] = useState("");
  const [errors, setErrors] = useState<string[]>([]);
  const [submitted, setSubmitted] = useState(false);
  const [sending, setSending] = useState(false);
  const [recorded, setRecorded] = useState(false);

  const serverName =
    serverId === CUSTOM_SERVER
      ? customServer.trim()
      : servers.find((s) => s.id === serverId)?.name ?? "";

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    const errs: string[] = [];
    if (!serverName) errs.push("Pick or type the server the car is on.");
    if (!vehicle.trim()) errs.push("Tell us which car it is.");
    if (!location.trim()) errs.push("Describe where the car is located.");
    if (!contact.trim()) errs.push("Leave an email or Discord handle so a runner can coordinate.");
    setErrors(errs);
    if (errs.length > 0) return;

    // Sandbox is a demo against invented servers; recording a car on one would
    // send a runner looking for something that doesn't exist.
    if (isSandbox) {
      setSubmitted(true);
      return;
    }

    setSending(true);
    try {
      const res = await fetch("/api/intake", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          kind: "car-donation",
          contactType: contact.includes("@") ? "email" : "discord",
          contact: contact.trim(),
          serverName,
          detail: [
            `Car: ${vehicle.trim()}`,
            `Where: ${location.trim()}`,
            howToRun.trim() && `To run it: ${howToRun.trim()}`,
            barter.trim() && `Barter wanted: ${barter.trim()}`,
            notes.trim() && `Notes: ${notes.trim()}`,
          ]
            .filter(Boolean)
            .join(" — "),
        }),
      });
      const data = await res.json().catch(() => null);
      if (res.ok && data?.ok) setRecorded(true);
      else {
        setErrors([data?.detail ?? "We couldn't record that just now. Try again, or ask in Discord."]);
        return;
      }
    } catch {
      setErrors(["We couldn't reach the server. Try again, or ask in Discord."]);
      return;
    } finally {
      setSending(false);
    }
    setSubmitted(true);
  }

  if (submitted) {
    return (
      <div className="stack">
        <div className="notice notice--success">
          {isSandbox ? (
            <>
              <strong>Thanks — donation logged (demo).</strong> {serverName} isn&apos;t a real
              server, so nothing was sent.
            </>
          ) : recorded ? (
            <>
              <strong>Thanks — we&apos;ve got it.</strong> A runner will contact you to arrange
              pickup of the {vehicle} on {serverName} and sort out any barter.
            </>
          ) : (
            <>
              <strong>Noted.</strong> We couldn&apos;t record it just now — the quickest route is to
              say hello in Discord.
            </>
          )}
        </div>
        <button className="btn" onClick={() => { setSubmitted(false); setRecorded(false); }}>
          Donate another car
        </button>
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

      <ServerSelect
        servers={servers}
        value={serverId}
        onChange={setServerId}
        customName={customServer}
        onCustomNameChange={setCustomServer}
        label="Which server is the car on?"
      />

      <div>
        <label htmlFor="vehicle">Which car is it?</label>
        <input
          id="vehicle"
          type="text"
          placeholder="e.g. Ada 4x4, M3S truck, Gunter…"
          value={vehicle}
          onChange={(e) => setVehicle(e.target.value)}
        />
      </div>

      <div>
        <label htmlFor="location">Where is it?</label>
        <input
          id="location"
          type="text"
          placeholder="e.g. barn NE of Novaya Petrovka, behind the red house"
          value={location}
          onChange={(e) => setLocation(e.target.value)}
        />
        <div className="field-hint">Grid coordinates or a clear landmark both work.</div>
      </div>

      <div>
        <label htmlFor="howToRun">How do you run it? What&apos;s it missing?</label>
        <textarea
          id="howToRun"
          placeholder="e.g. has battery + spark plug, needs 2 wheels and a radiator. Half a tank of fuel."
          value={howToRun}
          onChange={(e) => setHowToRun(e.target.value)}
        />
      </div>

      <div>
        <label htmlFor="barter">Barter you&apos;d like in return (optional)</label>
        <input
          id="barter"
          type="text"
          placeholder="e.g. some ammo, a rifle, or just paying it forward"
          value={barter}
          onChange={(e) => setBarter(e.target.value)}
        />
        <div className="field-hint">In-game items only. Donations are voluntary — no obligation.</div>
      </div>

      <div>
        <label htmlFor="notes">Anything else? (optional)</label>
        <textarea
          id="notes"
          placeholder="Lock code arrangements, best times to meet, PvP hotspot warnings…"
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
        />
      </div>

      <div>
        <label htmlFor="donor-contact">Your email or Discord</label>
        <input
          id="donor-contact"
          type="text"
          placeholder="survivor#0001 or you@example.com"
          value={contact}
          onChange={(e) => setContact(e.target.value)}
        />
      </div>

      <div>
        <button className="btn btn--big" type="submit">
          Donate this car &raquo;
        </button>
      </div>
    </form>
  );
}
