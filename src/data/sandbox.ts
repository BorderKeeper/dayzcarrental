// SANDBOX FIXTURES — every server, safehouse and coordinate below is INVENTED.
//
// None of these servers exist. "Chernarus Official #1234" is not a real server;
// a DayZ player who reads it on the live site recognises nothing and concludes
// the whole site is fake rather than early. That is why this data is confined
// to /sandbox, always behind a banner that says it's sample data, and never
// rendered on a live page.
//
// It exists so the site can be demonstrated end to end — pick a server, see a
// fleet, walk the four-step rent flow — without needing real runners staged on
// a real server first.
//
// Real data lives in Redis and is loaded by liveStore.ts. Do not add anything
// here expecting it to show up for players.

import { VEHICLES } from "./vehicles";
import { CUSTOM_SERVER } from "./constants";
import type { Fleet, GameServer, Safehouse } from "./types";

const SANDBOX_SERVERS: GameServer[] = [
  { id: "cherno-official-1234", name: "Chernarus Official #1234", map: "Chernarus", mode: "PvP" },
  { id: "livonia-pve-community", name: "Livonia Community PvE", map: "Livonia", mode: "PvE" },
  { id: "cherno-hardcore-77", name: "Chernarus Hardcore #77", map: "Chernarus", mode: "PvP (1PP)" },
  { id: "sakhal-frostbite", name: "Sakhal Frostbite RP", map: "Sakhal", mode: "RP / PvE" },
  { id: "livonia-official-0420", name: "Livonia Official #0420", map: "Livonia", mode: "PvP" },
];

// Coordinates are approximate real landmark positions, so the map deep-links
// land somewhere plausible. The safehouses themselves are still invented.
const SANDBOX_SAFEHOUSES: Record<string, Safehouse[]> = {
  "cherno-official-1234": [
    { id: "green-mountain", name: "Green Mountain relay", area: "Central Chernarus", map: "chernarusplus", x: 3720, y: 5980 },
    { id: "kamensk-mil", name: "Kamensk barn", area: "North Chernarus", map: "chernarusplus", x: 7900, y: 14400 },
    { id: "cherno-docks", name: "Chernogorsk dockside garage", area: "South coast", map: "chernarusplus", x: 6680, y: 2260 },
  ],
  "livonia-pve-community": [
    { id: "topolin-farm", name: "Topolin farmhouse", area: "North Livonia", map: "livonia", x: 2680, y: 11380 },
    { id: "nadbor-church", name: "Nadbor church lot", area: "South Livonia", map: "livonia", x: 5820, y: 2600 },
  ],
  "cherno-hardcore-77": [
    { id: "myshkino-tents", name: "Myshkino tent city", area: "West Chernarus", map: "chernarusplus", x: 2020, y: 7490 },
    { id: "novy-sobor", name: "Novy Sobor garage", area: "Central Chernarus", map: "chernarusplus", x: 7080, y: 7710 },
  ],
  "sakhal-frostbite": [
    { id: "frost-harbor", name: "Frostbite harbor shed", area: "Sakhal coast", map: "sakhal", x: 4920, y: 3010 },
  ],
  "livonia-official-0420": [
    { id: "sitnik-depot", name: "Sitnik fuel depot", area: "East Livonia", map: "livonia", x: 9480, y: 5820 },
    { id: "lukow-airfield", name: "Lukow airfield hangar", area: "Central Livonia", map: "livonia", x: 5520, y: 6280 },
  ],
};

// In the sandbox every server stages the whole catalogue, so the demo always
// has something to show.
const ALL_VEHICLE_IDS = VEHICLES.map((v) => v.id);

export const SANDBOX_FLEET: Fleet = {
  mode: "sandbox",
  servers: SANDBOX_SERVERS,
  // The typed-in server deliberately gets NO safehouses. That's what an
  // uncurated server really looks like, and it's how the demo exercises the
  // free-text pickup path in RentFlow.
  safehouses: SANDBOX_SAFEHOUSES,
  vehicleIds: {
    ...Object.fromEntries(SANDBOX_SERVERS.map((s) => [s.id, ALL_VEHICLE_IDS])),
    // Sandbox only. On LIVE a typed-in server stages nothing, because
    // advertising a fleet nobody can collect is the C-01 trap.
    [CUSTOM_SERVER]: ALL_VEHICLE_IDS,
  },
};
