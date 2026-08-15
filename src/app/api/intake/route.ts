// /api/intake — record a rental-interest or server-listing request.
//
// Write-only by design. There is no GET: a public endpoint listing "players who
// want to rent, with their Discord handles" would be a gift to anyone scraping.
// The founder reads entries from Redis directly (see src/data/intake.ts).
//
// Everything arriving here is UNTRUSTED (CLAUDE.md). It is validated and length
// -capped before it goes anywhere near the store, and it is only ever read back
// as data — nothing here is interpreted as an instruction.

import { NextResponse } from "next/server";
import { recordIntake } from "@/data/intake";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// A coarse key for rate-limiting only, never stored with the entry. Behind
// Vercel, x-forwarded-for's first hop is the client. Absent → everyone shares
// one bucket, which throttles harder rather than not at all.
function fingerprint(request: Request): string {
  const fwd = request.headers.get("x-forwarded-for") ?? "";
  const ip = fwd.split(",")[0]?.trim();
  return ip || request.headers.get("x-real-ip") || "unknown";
}

export async function POST(request: Request) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ ok: false, detail: "Malformed request." }, { status: 400 });
  }
  if (body === null || typeof body !== "object" || Array.isArray(body)) {
    return NextResponse.json({ ok: false, detail: "Malformed request." }, { status: 400 });
  }

  const result = await recordIntake(body as Record<string, unknown>, fingerprint(request));
  if (result.ok) return NextResponse.json({ ok: true });

  const status = result.reason === "invalid" ? 400 : result.reason === "throttled" ? 429 : 503;
  return NextResponse.json({ ok: false, detail: result.detail }, { status });
}
