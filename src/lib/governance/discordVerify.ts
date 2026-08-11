// discordVerify.ts — verify Discord interaction webhook signatures.
//
// Discord signs every interaction POST with Ed25519. The receiver MUST verify
// the `X-Signature-Ed25519` header against `timestamp + rawBody` using the
// application's public key, and reject on failure with 401 — Discord itself
// tests this during endpoint registration. We do it with node:crypto's native
// Ed25519 support, so there is NO new dependency (package.json is locked).
//
// The public key is Discord's *application public key* — not a secret (it's
// safe to ship), but we still read it from the environment so nothing about
// the bot's identity is hard-coded in the repo.

import { createPublicKey, verify as edVerify } from "node:crypto";

// Discord gives the public key as a 32-byte hex string. node:crypto wants a
// KeyObject; the portable way to build one from raw Ed25519 bytes is via a JWK
// with the 32-byte key base64url-encoded in `x`.
export function publicKeyFromHex(hex: string) {
  const raw = Buffer.from(hex, "hex");
  if (raw.length !== 32) {
    throw new Error(`Discord public key must be 32 bytes (64 hex chars); got ${raw.length} bytes.`);
  }
  return createPublicKey({
    key: { kty: "OKP", crv: "Ed25519", x: raw.toString("base64url") },
    format: "jwk",
  });
}

// Verify a single interaction request. `rawBody` MUST be the exact bytes Discord
// sent — re-serializing parsed JSON changes the bytes and breaks the signature.
export function verifyDiscordRequest(args: {
  publicKeyHex: string;
  signatureHex: string;
  timestamp: string;
  rawBody: string;
}): boolean {
  try {
    const key = publicKeyFromHex(args.publicKeyHex);
    const message = Buffer.from(args.timestamp + args.rawBody, "utf8");
    const signature = Buffer.from(args.signatureHex, "hex");
    if (signature.length !== 64) return false; // Ed25519 signatures are 64 bytes
    return edVerify(null, message, key, signature);
  } catch {
    // Any parse/format error = reject. Fail closed: an unverifiable request is
    // treated as forged.
    return false;
  }
}
