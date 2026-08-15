"use client";

import { useState } from "react";
import type { Vehicle } from "@/data/vehicles";
import { mapUrl, formatCoords, type Safehouse } from "@/data/types";

interface Props {
  vehicle: Vehicle;
  // Approved pickup points for the chosen server. Passed in rather than looked
  // up, so this component works the same against live and sandbox data.
  safehouses: Safehouse[];
  serverName: string;
  isSandbox: boolean;
  onClose: () => void;
}

type Step = 1 | 2 | 3 | 4;

// Multi-step rent request. Pure client-side mockup: validates and shows a
// "request received (demo)" confirmation. Nothing is submitted.
export default function RentFlow({ vehicle, safehouses, serverName, isSandbox, onClose }: Props) {
  const [step, setStep] = useState<Step>(1);

  // A sandbox server the visitor typed in has no curated safehouses, so pickup
  // falls back to free text. Without this the demo dead-ends at step 1 with no
  // radio button to select and a validation error that can never be satisfied.
  const freeTextPickup = safehouses.length === 0;
  const [pickupNote, setPickupNote] = useState("");

  const [safehouseId, setSafehouseId] = useState("");
  const [days, setDays] = useState("2");
  const [agreed, setAgreed] = useState(false);
  const [contactType, setContactType] = useState<"discord" | "email">("discord");
  const [contact, setContact] = useState("");
  const [errors, setErrors] = useState<string[]>([]);
  const [sending, setSending] = useState(false);
  const [recorded, setRecorded] = useState(false);

  const chosenSafehouse: Safehouse | undefined = safehouses.find((s) => s.id === safehouseId);

  async function next() {
    const errs: string[] = [];
    if (step === 1 && !freeTextPickup && !safehouseId) errs.push("Please choose a pickup safehouse.");
    if (step === 1 && freeTextPickup && !pickupNote.trim())
      errs.push("Tell us roughly where you'd like to pick the car up.");
    if (step === 1) {
      const d = Number(days);
      if (!Number.isFinite(d) || d < 1) errs.push("Enter how many days you want the car (1 or more).");
    }
    if (step === 2 && !agreed) errs.push("You must agree to the payment and deposit terms.");
    if (step === 3) {
      if (!contact.trim()) errs.push("Enter an email or Discord handle so we can reach you.");
      if (contactType === "email" && contact && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(contact))
        errs.push("That doesn't look like a valid email address.");
    }
    setErrors(errs);
    if (errs.length > 0) return;

    // Step 3 is where someone hands over a contact handle — the highest-intent
    // moment in the funnel, and it used to be dropped on the floor (F-08).
    // Sandbox is exempt: it's a demo against invented servers, and recording
    // interest in a server that doesn't exist would poison the real list.
    if (step === 3 && !isSandbox) {
      setSending(true);
      const res = await submitInterest();
      setSending(false);
      if (!res.ok) {
        setErrors([res.detail]);
        return;
      }
      setRecorded(true);
    }
    setStep((s) => Math.min(4, (s + 1) as Step) as Step);
  }

  async function submitInterest(): Promise<{ ok: true } | { ok: false; detail: string }> {
    const pickup = chosenSafehouse ? `${chosenSafehouse.name} (${chosenSafehouse.area})` : pickupNote;
    try {
      const res = await fetch("/api/intake", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          kind: "rental-interest",
          contactType,
          contact: contact.trim(),
          serverName,
          detail: `Wants the ${vehicle.name} for ${days} day(s). Pickup: ${pickup}.`,
        }),
      });
      const data = await res.json().catch(() => null);
      if (res.ok && data?.ok) return { ok: true };
      return { ok: false, detail: data?.detail ?? "We couldn't record that just now. Try again, or say hello in Discord." };
    } catch {
      return { ok: false, detail: "We couldn't reach the server. Try again, or say hello in Discord." };
    }
  }

  function back() {
    setErrors([]);
    setStep((s) => Math.max(1, (s - 1) as Step) as Step);
  }

  return (
    <div className="panel" role="dialog" aria-modal="true" aria-label={`Rent the ${vehicle.name}`}>
      <div className="row" style={{ justifyContent: "space-between" }}>
        <h2 className="panel__title" style={{ border: "none" }}>
          Rent the {vehicle.name}
        </h2>
        <button className="btn btn--secondary" onClick={onClose}>
          &times; Cancel
        </button>
      </div>
      <p className="small muted">
        Server: <strong>{serverName}</strong>
      </p>

      <ol className="steps">
        <li className={step === 1 ? "active" : step > 1 ? "done" : ""}>1. Pickup</li>
        <li className={step === 2 ? "active" : step > 2 ? "done" : ""}>2. Terms</li>
        <li className={step === 3 ? "active" : step > 3 ? "done" : ""}>3. Contact</li>
        <li className={step === 4 ? "active" : ""}>4. Done</li>
      </ol>

      {errors.length > 0 && (
        <div className="notice" style={{ borderColor: "#a11", background: "#fbe4e4" }}>
          <ul style={{ margin: 0, paddingLeft: 18 }}>
            {errors.map((e) => (
              <li key={e} className="field-error" style={{ marginTop: 0 }}>
                {e}
              </li>
            ))}
          </ul>
        </div>
      )}

      {step === 1 && (
        <div className="stack">
          <h3>{freeTextPickup ? "Where would you like to pick it up?" : "Choose an approved safehouse for pickup"}</h3>
          {freeTextPickup ? (
            <div>
              <label htmlFor="pickup-note">Pickup spot</label>
              <input
                id="pickup-note"
                type="text"
                placeholder="e.g. the green barn north of Novy Sobor"
                value={pickupNote}
                onChange={(e) => setPickupNote(e.target.value)}
              />
              <div className="field-hint">
                We don&apos;t have curated safehouses on {serverName} yet, so a runner would agree a
                spot with you directly.
              </div>
            </div>
          ) : (
            <ul className="option-list">
              {safehouses.map((s) => (
                <li key={s.id}>
                  <label>
                    <input
                      type="radio"
                      name="safehouse"
                      value={s.id}
                      checked={safehouseId === s.id}
                      onChange={() => setSafehouseId(s.id)}
                    />
                    <span>
                      <span className="opt-name">{s.name}</span>{" "}
                      <span className="opt-note">— {s.area}</span>
                      <br />
                      <span className="opt-note">
                        Coords {formatCoords(s)} ·{" "}
                        <a href={mapUrl(s)} target="_blank" rel="noopener noreferrer">
                          view on DayZ map &raquo;
                        </a>
                      </span>
                    </span>
                  </label>
                </li>
              ))}
            </ul>
          )}
          <div>
            <label htmlFor="days">How many days?</label>
            <input
              id="days"
              type="number"
              min={1}
              value={days}
              onChange={(e) => setDays(e.target.value)}
              style={{ maxWidth: 120 }}
            />
            <div className="field-hint">Billed per day in-game. Deposit is returned if the car comes back on time.</div>
          </div>
        </div>
      )}

      {step === 2 && (
        <div className="stack">
          <h3>Payment &amp; deposit terms</h3>
          <div className="panel panel--plain">
            <ul style={{ margin: 0, paddingLeft: 18 }}>
              <li>
                <strong>Per day:</strong> {vehicle.pricePerDay}
              </li>
              <li>
                <strong>Days requested:</strong> {days}
              </li>
              <li>
                <strong>Refundable deposit:</strong> {vehicle.deposit}
              </li>
            </ul>
          </div>
          <p className="small muted">
            Payment is made in <strong>approved in-game ways</strong> (item barter — the exact
            accepted goods are still being finalized). A runner will confirm the handoff and the
            lock code. Your deposit is <strong>forfeit if the vehicle isn&apos;t returned within the
            agreed days</strong>.
          </p>
          <label style={{ fontWeight: "normal" }}>
            <input
              type="checkbox"
              checked={agreed}
              onChange={(e) => setAgreed(e.target.checked)}
              style={{ width: "auto", marginRight: 6 }}
            />
            I agree to pay in approved in-game ways and understand the deposit is lost if I return
            the car late.
          </label>
        </div>
      )}

      {step === 3 && (
        <div className="stack">
          <h3>How should we reach you?</h3>
          <p className="small muted">
            {isSandbox
              ? "This is the sample version — nothing you type here is sent or stored."
              : "We keep this and the details above so a runner can reach you about this rental. Only the crew sees it, it's never published, and it isn't used for anything else."}
          </p>
          <div className="row">
            <label style={{ fontWeight: "normal", margin: 0 }}>
              <input
                type="radio"
                name="contactType"
                checked={contactType === "discord"}
                onChange={() => setContactType("discord")}
                style={{ width: "auto", marginRight: 6 }}
              />
              Discord
            </label>
            <label style={{ fontWeight: "normal", margin: 0 }}>
              <input
                type="radio"
                name="contactType"
                checked={contactType === "email"}
                onChange={() => setContactType("email")}
                style={{ width: "auto", marginRight: 6 }}
              />
              Email
            </label>
          </div>
          <div>
            <label htmlFor="contact">{contactType === "discord" ? "Discord handle" : "Email address"}</label>
            <input
              id="contact"
              type={contactType === "email" ? "email" : "text"}
              placeholder={contactType === "discord" ? "survivor#0001 or @survivor" : "you@example.com"}
              value={contact}
              onChange={(e) => setContact(e.target.value)}
            />
          </div>
        </div>
      )}

      {step === 4 && (
        <div className="stack">
          <div className="notice notice--success">
            {isSandbox ? (
              <>
                <strong>Request received (demo).</strong> This is the sample version —{" "}
                {serverName} isn&apos;t a real server and nothing was sent.
              </>
            ) : recorded ? (
              <>
                <strong>Got it — you&apos;re on the list.</strong> We&apos;ve recorded your details
                and a runner will get in touch. Renting isn&apos;t automated yet, so this is a real
                person reading a real list, not an instant booking.
              </>
            ) : (
              <>
                <strong>Request noted.</strong> We couldn&apos;t record it just now — the quickest
                route is to say hello in Discord.
              </>
            )}
          </div>
          <div className="panel panel--plain">
            <h3>Your (mock) rental request</h3>
            <ul style={{ margin: 0, paddingLeft: 18 }}>
              <li>
                <strong>Vehicle:</strong> {vehicle.name}
              </li>
              <li>
                <strong>Server:</strong> {serverName}
              </li>
              <li>
                <strong>Pickup:</strong>{" "}
                {chosenSafehouse ? (
                  <>
                    {chosenSafehouse.name} ({chosenSafehouse.area}) — coords{" "}
                    {formatCoords(chosenSafehouse)} ·{" "}
                    <a href={mapUrl(chosenSafehouse)} target="_blank" rel="noopener noreferrer">
                      map
                    </a>
                  </>
                ) : (
                  pickupNote
                )}
              </li>
              <li>
                <strong>Duration:</strong> {days} day(s)
              </li>
              <li>
                <strong>Per day:</strong> {vehicle.pricePerDay}
              </li>
              <li>
                <strong>Deposit:</strong> {vehicle.deposit}
              </li>
              <li>
                <strong>Contact:</strong> {contact} ({contactType})
              </li>
            </ul>
          </div>
          <p className="small muted">
            No money changed hands and nothing was charged — rentals are paid in-game, to a runner.
          </p>
          <button className="btn" onClick={onClose}>
            Back to listings
          </button>
        </div>
      )}

      {step < 4 && (
        <div className="row" style={{ marginTop: 14 }}>
          {step > 1 && (
            <button className="btn btn--secondary" onClick={back}>
              &laquo; Back
            </button>
          )}
          <button className="btn" onClick={next} disabled={sending}>
            {sending ? "Sending…" : step === 3 ? "Submit request" : "Continue »"}
          </button>
        </div>
      )}
    </div>
  );
}
