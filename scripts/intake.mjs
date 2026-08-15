// scripts/intake.mjs — read the leads the site has collected, and clear them
// once handled.
//
// #rent-a-car, #donate-a-car and /list-your-server all promise that a runner
// will get in touch. That promise is only true if somebody can see the list.
// Entries go into Redis (src/data/intake.ts) and, deliberately, there is no
// HTTP route to read them — a public list of players who want to rent, with
// their Discord handles, is a gift to anyone scraping. This script is the only
// way in, and it needs REDIS_URL.
//
//   node --import ./scripts/ts-loader.mjs scripts/intake.mjs
//   node --import ./scripts/ts-loader.mjs scripts/intake.mjs rental-interest
//   node --import ./scripts/ts-loader.mjs scripts/intake.mjs rental-interest --done 1
//
// PowerShell:
//   $env:REDIS_URL="..."
//   node --import ./scripts/ts-loader.mjs scripts/intake.mjs
//
// --done <n>   remove entry n of the listed kind, once you've replied to them.
// --json       raw JSON, for piping somewhere else.
//
// PRIVACY: this prints contact details people gave us on the understanding
// that only the crew would see them. Don't paste the output into a public
// channel, an issue, or a screenshot.

import { INTAKE_KINDS, readIntake, removeIntake } from "../src/data/intake.ts";

const args = process.argv.slice(2);
const asJson = args.includes("--json");
const doneAt = args.indexOf("--done");
const doneIdx = doneAt === -1 ? null : Number.parseInt(args[doneAt + 1] ?? "", 10);
// The value after --done is not a positional. Without skipping it,
// `intake.mjs --done 1` read "1" as the kind and complained about an unknown
// kind rather than about the missing one — refusing correctly, for the wrong
// stated reason.
// Guard the -1 case: `doneAt + 1` would be 0 and swallow the first positional,
// so `intake.mjs server-request` listed every kind instead of that one.
const skipAt = doneAt === -1 ? -1 : doneAt + 1;
const kindArg = args.find((a, i) => !a.startsWith("--") && i !== skipAt);

// Helpers are declared BEFORE main() runs. `const` is not hoisted into scope
// the way `function` is, so calling main() above these put them in the temporal
// dead zone and the script died on its first real run.
const age = (iso) => {
  const ms = Date.now() - new Date(iso).getTime();
  if (!Number.isFinite(ms)) return "unknown age";
  const h = Math.floor(ms / 3_600_000);
  if (h < 1) return "just now";
  if (h < 48) return `${h}h ago`;
  return `${Math.floor(h / 24)}d ago`;
};

const LABEL = {
  "rental-interest": "Wants to rent",
  "server-request": "Wants their server listed",
  "car-donation": "Offering a car",
};

if (!process.env.REDIS_URL && !process.env.KV_URL) {
  console.error("REDIS_URL is not set — that's where the leads live.");
  process.exitCode = 1;
} else if (kindArg && !INTAKE_KINDS.includes(kindArg)) {
  console.error(`Unknown kind '${kindArg}'. One of: ${INTAKE_KINDS.join(", ")}`);
  process.exitCode = 1;
} else {
  process.exitCode = await main();
}

async function main() {
  const kinds = kindArg ? [kindArg] : INTAKE_KINDS;

  // --done needs an unambiguous target, and the numbering is per kind.
  if (doneIdx !== null) {
    if (!kindArg) {
      console.error("--done needs a kind, so the number means something: intake.mjs rental-interest --done 1");
      return 1;
    }
    const entries = await readIntake(kindArg);
    const entry = entries[doneIdx - 1];
    if (!entry) {
      console.error(`No entry ${doneIdx} in ${kindArg} (there ${entries.length === 1 ? "is" : "are"} ${entries.length}).`);
      return 1;
    }
    const ok = await removeIntake(kindArg, entry);
    console.log(ok ? `Removed ${kindArg} #${doneIdx} (${entry.contact}).` : "Nothing removed — it may already be gone.");
    return ok ? 0 : 1;
  }

  let total = 0;
  for (const kind of kinds) {
    const entries = await readIntake(kind);
    total += entries.length;
    if (asJson) continue;

    console.log(`\n=== ${LABEL[kind] ?? kind} — ${entries.length} ===`);
    if (entries.length === 0) {
      console.log("  (nothing yet)");
      continue;
    }
    entries.forEach((e, i) => {
      // Oldest first: the top of the list is who has been waiting longest.
      console.log(`\n  ${i + 1}. ${e.contact}  (${e.contactType})  · ${age(e.receivedAt)}`);
      if (e.serverName) console.log(`     server: ${e.serverName}`);
      if (e.detail) console.log(`     ${e.detail}`);
    });
    console.log(`\n  Handled one? node --import ./scripts/ts-loader.mjs scripts/intake.mjs ${kind} --done <n>`);
  }

  if (asJson) {
    const out = {};
    for (const kind of kinds) out[kind] = await readIntake(kind);
    console.log(JSON.stringify(out, null, 2));
    return 0;
  }

  console.log(
    total === 0
      ? "\nNothing waiting. Entries appear here when someone uses the rent flow, the car-donation form, or /list-your-server."
      : `\n${total} person/people waiting on a reply. Oldest first.`,
  );
  return 0;
}
