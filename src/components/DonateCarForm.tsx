"use client";

import { useState } from "react";
import ServerSelect, { CUSTOM_SERVER } from "@/components/ServerSelect";
import type { GameServer } from "@/data/types";

// Client-side mockup form: validates and shows a demo confirmation.
//
// Unlike renting, "Other / not listed" stays available here whatever the server
// list looks like: a donated car on a server we don't cover yet is still a
// useful lead — it's often the reason a server becomes covered.
export default function DonateCarForm({ servers }: { servers: GameServer[] }) {
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

  const serverName =
    serverId === CUSTOM_SERVER
      ? customServer.trim()
      : servers.find((s) => s.id === serverId)?.name ?? "";

  function submit(e: React.FormEvent) {
    e.preventDefault();
    const errs: string[] = [];
    if (!serverName) errs.push("Pick or type the server the car is on.");
    if (!vehicle.trim()) errs.push("Tell us which car it is.");
    if (!location.trim()) errs.push("Describe where the car is located.");
    if (!contact.trim()) errs.push("Leave an email or Discord handle so a runner can coordinate.");
    setErrors(errs);
    if (errs.length === 0) setSubmitted(true);
  }

  if (submitted) {
    return (
      <div className="stack">
        <div className="notice notice--success">
          <strong>Thanks — donation logged (demo).</strong> In the live service a runner would
          contact you to arrange pickup of the {vehicle} on {serverName} and sort out any barter.
        </div>
        <p className="small muted">Nothing was actually submitted — this is a mockup.</p>
        <button className="btn" onClick={() => setSubmitted(false)}>
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
