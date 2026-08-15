// intake.ts — capture the two moments where someone tells us exactly what we
// need to know, and we used to throw it away.
//
//   rental-interest  A player finished the rent flow, or asked about a server
//                    we don't cover. They handed over a contact handle at the
//                    highest-intent moment in the funnel and it was dropped
//                    client-side (F-08). The roadmap listed a waitlist; none
//                    existed.
//   car-donation     Someone found a spare vehicle and offered it to the fleet.
//                    Same shape of loss: they told us where a real car is and
//                    the form forgot it the moment the page closed.
//   server-request   A server owner wants their server listed. There was no
//                    entry point at all — the only real path was a Discord
//                    proposal needing a manually-granted role, three eligible
//                    voters and a 48-hour window (C-06). That is a
//                    constitutional amendment for what should be routine
//                    runner-ops admin.
//
// PRIVACY. These records contain a contact handle a person volunteered, which
// makes them the most sensitive data this project holds — more so than the
// treasury, which is just a number. So:
//   * only what a runner needs to make contact is stored, nothing derived,
//     no IP addresses, no fingerprinting;
//   * there is deliberately NO read endpoint. Entries are read by the founder
//     from Redis directly. A public list of "players who want to rent, with
//     their Discord handles" is a gift to anyone scraping;
//   * the forms say plainly what is kept and who sees it.
//
// Stored as a capped Redis list so a flood can't grow unboundedly.

import { redisPipeline } from "../lib/governance/redisClient";
import { redisUrlFromEnv } from "../lib/governance/redisBudgetStore";

export type IntakeKind = "rental-interest" | "server-request" | "car-donation";

export const INTAKE_KINDS: IntakeKind[] = ["rental-interest", "server-request", "car-donation"];

export interface IntakeEntry {
  kind: IntakeKind;
  // How to reach them, exactly as typed. The label says which sort it is so a
  // runner doesn't have to guess whether "survivor" is a handle or a name.
  contactType: "discord" | "email";
  contact: string;
  // Free-text context: which server, which car, what they're asking for.
  serverName?: string;
  detail?: string;
  receivedAt: string; // ISO 8601
}

// Length caps applied before anything is stored. A form field is untrusted
// input (CLAUDE.md); these bound what a hostile submitter can push into Redis.
export const LIMITS = { contact: 100, serverName: 120, detail: 1000 } as const;

// Keep the most recent N. Past that the oldest fall off — this is a lead list
// someone works through, not an archive of record.
const MAX_ENTRIES = 500;

const KEY_PREFIX = "dcr:intake:";
export const intakeKey = (kind: IntakeKind) => KEY_PREFIX + kind;
const throttleKey = (fingerprint: string) => `dcr:intake:throttle:${fingerprint}`;

export interface IntakeDeps {
  url?: string | null;
  run?: (commands: (string | number)[][]) => Promise<unknown[]>;
}

function resolveRun(deps: IntakeDeps) {
  const url = deps.url === undefined ? redisUrlFromEnv() : deps.url;
  return deps.run ?? (url ? (cmds: (string | number)[][]) => redisPipeline(url, cmds) : null);
}

const clean = (v: unknown, max: number): string => String(v ?? "").trim().slice(0, max);

export type IntakeResult =
  | { ok: true }
  | { ok: false; reason: "invalid"; detail: string }
  | { ok: false; reason: "throttled"; detail: string }
  | { ok: false; reason: "unavailable"; detail: string };

// Validate a submission. Split out from the write so the rules are testable
// without a store, and so the API route and any future caller share them.
export function validateIntake(input: Partial<IntakeEntry>): { ok: true; entry: IntakeEntry } | { ok: false; detail: string } {
  const kind = input.kind;
  if (!kind || !INTAKE_KINDS.includes(kind)) {
    return { ok: false, detail: "Unknown request type." };
  }
  const contactType = input.contactType === "email" ? "email" : "discord";
  const contact = clean(input.contact, LIMITS.contact);
  if (!contact) {
    return { ok: false, detail: "Tell us how to reach you — a Discord handle or an email address." };
  }
  if (contactType === "email" && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(contact)) {
    return { ok: false, detail: "That doesn't look like a valid email address." };
  }

  const serverName = clean(input.serverName, LIMITS.serverName);
  if (kind === "server-request" && !serverName) {
    return { ok: false, detail: "Which server should we list? Give us its name." };
  }

  return {
    ok: true,
    entry: {
      kind,
      contactType,
      contact,
      serverName: serverName || undefined,
      detail: clean(input.detail, LIMITS.detail) || undefined,
      receivedAt: new Date().toISOString(),
    },
  };
}

// Read a kind's entries, oldest first (the order they arrived, which is the
// order to work them).
//
// There is no HTTP route for this and there must not be: a public list of
// people who want to rent, with their handles, is a gift to anyone scraping.
// It is reachable only from scripts/intake.mjs, which needs REDIS_URL.
export async function readIntake(kind: IntakeKind, deps: IntakeDeps = {}): Promise<IntakeEntry[]> {
  const run = resolveRun(deps);
  if (!run) return [];
  try {
    const [raw] = await run([["LRANGE", intakeKey(kind), 0, -1]]);
    const rows = Array.isArray(raw) ? raw : [];
    return rows
      .map((r) => {
        try {
          return JSON.parse(String(r)) as IntakeEntry;
        } catch {
          // One unreadable row must not hide every other lead.
          return null;
        }
      })
      .filter((e): e is IntakeEntry => e !== null);
  } catch (e) {
    console.error("[intake] could not read:", (e as Error).message);
    return [];
  }
}

// Remove one entry once it's been dealt with, so the list is a work queue
// rather than an ever-growing pile. Matched by exact stored value — LREM with
// count 1 removes a single occurrence, so two identical submissions from the
// same person don't both vanish when you handle one.
export async function removeIntake(kind: IntakeKind, entry: IntakeEntry, deps: IntakeDeps = {}): Promise<boolean> {
  const run = resolveRun(deps);
  if (!run) return false;
  try {
    const [removed] = await run([["LREM", intakeKey(kind), 1, JSON.stringify(entry)]]);
    return Number.parseInt(String(removed ?? "0"), 10) > 0;
  } catch (e) {
    console.error("[intake] could not remove:", (e as Error).message);
    return false;
  }
}

// Record an entry. `fingerprint` is a coarse per-submitter key used only to
// rate-limit; it is never stored with the entry.
export async function recordIntake(
  input: Partial<IntakeEntry>,
  fingerprint: string,
  deps: IntakeDeps = {},
): Promise<IntakeResult> {
  const validated = validateIntake(input);
  if (!validated.ok) return { ok: false, reason: "invalid", detail: validated.detail };

  const run = resolveRun(deps);
  if (!run) {
    // Better to say "we couldn't take that" than to accept it into a void and
    // leave someone believing a runner will be in touch.
    return { ok: false, reason: "unavailable", detail: "We can't record that right now — try Discord instead." };
  }

  try {
    // This endpoint is public and writes to a store, so it needs a limit. INCR
    // with an expiry is the cheapest correct one: first hit sets the counter,
    // EXPIRE starts the window, and the value tells us how many in that window.
    const [count] = await run([["INCR", throttleKey(fingerprint)]]);
    const n = Number.parseInt(String(count ?? "1"), 10);
    if (n === 1) await run([["EXPIRE", throttleKey(fingerprint), 3600]]);
    if (n > 5) {
      return { ok: false, reason: "throttled", detail: "That's a few requests in a row — give it an hour, or say hello in Discord." };
    }

    await run([
      ["RPUSH", intakeKey(validated.entry.kind), JSON.stringify(validated.entry)],
      // Trim to the newest MAX_ENTRIES. Negative indices count from the end.
      ["LTRIM", intakeKey(validated.entry.kind), -MAX_ENTRIES, -1],
    ]);
    return { ok: true };
  } catch (e) {
    console.error("[intake] could not record:", (e as Error).message);
    return { ok: false, reason: "unavailable", detail: "We can't record that right now — try Discord instead." };
  }
}
