// snowflake.ts — derive a Discord account's creation time (and age) from its
// user ID, with no API call.
//
// Every Discord snowflake ID encodes its creation timestamp in the high bits:
// `(id >> 22) + DISCORD_EPOCH` gives the millisecond timestamp. We use this to
// compute the account-age gate for vote eligibility (GOVERNANCE.md §3:
// account age ≥ 7 days) directly from the reactor's user ID — the age half of
// eligibility needs no network round-trip.

// Discord epoch: 2015-01-01T00:00:00Z in milliseconds.
export const DISCORD_EPOCH_MS = 1420070400000;

// Creation timestamp (ms since Unix epoch) for a snowflake ID.
// Uses BigInt so the 64-bit id doesn't lose precision as a JS number.
export function snowflakeCreatedAtMs(id: string): number {
  // BigInt so the 64-bit id keeps precision. Constructor form (not `22n`
  // literals) because the locked tsconfig targets es2017.
  const asBig = BigInt(id);
  const ms = (asBig >> BigInt(22)) + BigInt(DISCORD_EPOCH_MS);
  return Number(ms);
}

// Whole days between an account's creation and `nowMs`. `nowMs` is injected
// (never read from a clock here) so the function stays pure and testable.
// Negative inputs are clamped to 0 — a future-dated id just reads as brand new.
export function accountAgeDays(id: string, nowMs: number): number {
  const createdMs = snowflakeCreatedAtMs(id);
  const diffMs = nowMs - createdMs;
  if (diffMs <= 0) return 0;
  return Math.floor(diffMs / 86_400_000); // ms per day
}
