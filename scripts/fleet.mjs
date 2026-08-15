// scripts/fleet.mjs — read and seed the LIVE fleet in Redis.
//
// The live site reads servers, safehouses and staged cars from Redis
// (src/data/liveStore.ts). Until something is written there, / shows an honest
// "no servers are covered yet" and /sandbox shows the invented demo data. This
// script is how real data gets in.
//
// Run with Node 24 (type-stripping) + the TS resolve hook, so it shares the
// exact key names the app reads — the two can't drift:
//
//   node --import ./scripts/ts-loader.mjs scripts/fleet.mjs show
//   node --import ./scripts/ts-loader.mjs scripts/fleet.mjs seed fleet.json
//   node --import ./scripts/ts-loader.mjs scripts/fleet.mjs clear
//
// Needs REDIS_URL in the environment — the same store the donation balance
// uses. Nothing here touches money keys.
//
// fleet.json shape:
//   {
//     "servers": [ { "id", "name", "map", "mode" } ],
//     "safehouses": { "<serverId>": [ { "id","name","area","map","x","y" } ] },
//     "vehicleIds": { "<serverId>": [ "ada-4x4", "olga-24" ] }
//   }
// `map` on a safehouse must be one of: chernarusplus | livonia | sakhal.
// `vehicleIds` must match ids in src/data/vehicles.ts — anything else renders
// as nothing, since the catalogue is filtered by id.

import { readFile } from "node:fs/promises";
import { redisPipeline } from "../src/lib/governance/redisClient.ts";
import { FLEET_KEYS } from "../src/data/liveStore.ts";
import { VEHICLES } from "../src/data/vehicles.ts";

const MAPS = new Set(["chernarusplus", "livonia", "sakhal"]);

const url = process.env.REDIS_URL ?? process.env.KV_URL;
if (!url) {
  console.error("REDIS_URL is not set. This script only talks to the live store.");
  process.exit(1);
}

const run = (commands) => redisPipeline(url, commands);
const [, , cmd, file] = process.argv;

// --- validation -------------------------------------------------------------
// Fail before writing, not halfway through: a partial seed leaves the live site
// advertising servers whose safehouses never landed.
function validate(doc) {
  const problems = [];
  const servers = Array.isArray(doc?.servers) ? doc.servers : null;
  if (!servers) return ["`servers` must be an array."];

  const ids = new Set();
  const catalogue = new Set(VEHICLES.map((v) => v.id));

  for (const s of servers) {
    if (!s?.id || typeof s.id !== "string") problems.push(`A server is missing a string 'id'.`);
    else if (ids.has(s.id)) problems.push(`Duplicate server id '${s.id}'.`);
    else ids.add(s.id);
    for (const f of ["name", "map", "mode"]) {
      if (typeof s?.[f] !== "string") problems.push(`Server '${s?.id}' is missing '${f}'.`);
    }
  }

  for (const [sid, list] of Object.entries(doc.safehouses ?? {})) {
    if (!ids.has(sid)) problems.push(`safehouses['${sid}'] has no matching server.`);
    if (!Array.isArray(list)) {
      problems.push(`safehouses['${sid}'] must be an array.`);
      continue;
    }
    for (const h of list) {
      for (const f of ["id", "name", "area"]) {
        if (typeof h?.[f] !== "string") problems.push(`Safehouse in '${sid}' is missing '${f}'.`);
      }
      if (!MAPS.has(h?.map)) problems.push(`Safehouse '${h?.id}' has map '${h?.map}'; expected one of ${[...MAPS].join(", ")}.`);
      for (const f of ["x", "y"]) {
        if (!Number.isFinite(h?.[f])) problems.push(`Safehouse '${h?.id}' needs a numeric '${f}'.`);
      }
    }
  }

  for (const [sid, list] of Object.entries(doc.vehicleIds ?? {})) {
    if (!ids.has(sid)) problems.push(`vehicleIds['${sid}'] has no matching server.`);
    if (!Array.isArray(list)) {
      problems.push(`vehicleIds['${sid}'] must be an array.`);
      continue;
    }
    for (const v of list) {
      if (!catalogue.has(v)) problems.push(`vehicleIds['${sid}'] lists unknown vehicle '${v}'.`);
    }
  }
  return problems;
}

// --- commands ---------------------------------------------------------------
async function show() {
  const [raw] = await run([["GET", FLEET_KEYS.servers]]);
  const servers = raw ? JSON.parse(String(raw)) : [];
  if (servers.length === 0) {
    console.log("No live servers. The site shows its empty state; /sandbox still demos the flow.");
    return;
  }
  for (const s of servers) {
    const [h, v] = await run([
      ["GET", FLEET_KEYS.safehousesFor(s.id)],
      ["GET", FLEET_KEYS.vehiclesFor(s.id)],
    ]);
    const houses = h ? JSON.parse(String(h)) : [];
    const cars = v ? JSON.parse(String(v)) : [];
    console.log(`${s.name}  [${s.id}]  ${s.map} · ${s.mode}`);
    console.log(`   safehouses: ${houses.length ? houses.map((x) => x.name).join(", ") : "(none)"}`);
    console.log(`   staged cars: ${cars.length ? cars.join(", ") : "(none)"}`);
  }
}

async function seed(path) {
  if (!path) {
    console.error("Usage: fleet.mjs seed <fleet.json>");
    process.exit(1);
  }
  const doc = JSON.parse(await readFile(path, "utf8"));
  const problems = validate(doc);
  if (problems.length > 0) {
    console.error(`Refusing to seed — ${problems.length} problem(s):`);
    for (const p of problems) console.error("  - " + p);
    process.exit(1);
  }

  const commands = [["SET", FLEET_KEYS.servers, JSON.stringify(doc.servers)]];
  for (const s of doc.servers) {
    commands.push(["SET", FLEET_KEYS.safehousesFor(s.id), JSON.stringify(doc.safehouses?.[s.id] ?? [])]);
    commands.push(["SET", FLEET_KEYS.vehiclesFor(s.id), JSON.stringify(doc.vehicleIds?.[s.id] ?? [])]);
  }
  await run(commands);
  console.log(`Seeded ${doc.servers.length} server(s). The live site will pick this up immediately.`);
}

async function clear() {
  const [raw] = await run([["GET", FLEET_KEYS.servers]]);
  const servers = raw ? JSON.parse(String(raw)) : [];
  const commands = [["DEL", FLEET_KEYS.servers]];
  for (const s of servers) {
    commands.push(["DEL", FLEET_KEYS.safehousesFor(s.id)]);
    commands.push(["DEL", FLEET_KEYS.vehiclesFor(s.id)]);
  }
  await run(commands);
  console.log("Cleared the live fleet. The site falls back to its empty state, not to sample data.");
}

switch (cmd) {
  case "show":
    await show();
    break;
  case "seed":
    await seed(file);
    break;
  case "clear":
    await clear();
    break;
  default:
    console.error("Usage: fleet.mjs <show|seed <file.json>|clear>");
    process.exit(1);
}
