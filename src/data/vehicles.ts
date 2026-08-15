// Mock DayZ vehicle catalog for the rental listings.
//
// Prices + deposits are expressed as IN-GAME COMMODITY (per the locked
// EULA-safe money model — real money is donations only). Values are
// clearly-labeled MOCK estimates; refine cargo/speed against the wiki
// (https://dayz.fandom.com/wiki/Vehicles) when real images are added.
//
// `image` points at /public/vehicles/<file>. Drop a "player standing next to
// the car" photo there; until then a styled placeholder box renders.

export interface Vehicle {
  id: string;
  name: string;
  type: string;
  seats: number;
  cargoSlots: number; // approximate inventory slots across attached storage
  cargoNote: string;
  topSpeed: string; // km/h, approximate
  pricePerDay: string; // in-game commodity per rental day
  deposit: string; // in-game commodity, forfeit if returned late
  image: string;
  notes: string;
  size: "small" | "medium" | "large";
}

export const VEHICLES: Vehicle[] = [
  {
    id: "sarka-120",
    name: "Sarka 120",
    type: "Compact sedan",
    seats: 4,
    cargoSlots: 30,
    cargoNote: "Small trunk — light loadouts and loot runs.",
    topSpeed: "~110 km/h",
    pricePerDay: "1 stack of ammo (e.g. 60 rds 7.62x39)",
    deposit: "1 assault rifle + 1 full mag",
    image: "/vehicles/sarka-120.svg",
    notes: "Cheapest option. Fragile, but easy to run — needs battery, spark plug, and 4 wheels.",
    size: "small",
  },
  {
    id: "olga-24",
    name: "Olga 24",
    type: "Compact hatchback",
    seats: 4,
    cargoSlots: 40,
    cargoNote: "Modest cargo — a bit more room than the Sarka.",
    topSpeed: "~100 km/h",
    pricePerDay: "1 stack of ammo + 1 canned food",
    deposit: "1 assault rifle + 2 full mags",
    image: "/vehicles/olga-24.svg",
    notes: "Rugged little runabout. Needs battery, spark plug, radiator, and 4 wheels.",
    size: "small",
  },
  {
    id: "gunter-2",
    name: "Gunter 2 (VW Golf)",
    type: "Sport hatchback",
    seats: 4,
    cargoSlots: 40,
    cargoNote: "Medium cargo with the best speed in class.",
    topSpeed: "~120 km/h",
    pricePerDay: "2 stacks of ammo",
    deposit: "1 rifle + optic",
    image: "/vehicles/gunter-2.svg",
    notes: "Fastest of the small cars — great for quick garage runs. Same parts as the Olga.",
    size: "medium",
  },
  {
    id: "ada-4x4",
    name: "Ada 4x4 (Niva)",
    type: "Offroad 4x4",
    seats: 4,
    cargoSlots: 50,
    cargoNote: "Good cargo and handles terrain most cars can't.",
    topSpeed: "~90 km/h",
    pricePerDay: "3 stacks of ammo + fuel jerry can",
    deposit: "1 rifle + optic + 3 mags",
    image: "/vehicles/ada-4x4.svg",
    notes: "Best all-rounder for rough maps (Livonia/Sakhal). Needs battery, spark plug, radiator, 4 wheels.",
    size: "medium",
  },
  {
    id: "m3s-truck",
    name: "M3S Truck (V3S)",
    type: "Heavy cargo truck",
    seats: 2,
    cargoSlots: 120,
    cargoNote: "Massive bed — base-building hauls and group loot.",
    topSpeed: "~60 km/h",
    pricePerDay: "5 stacks of ammo + 2 fuel jerry cans",
    deposit: "2 rifles + optics",
    image: "/vehicles/m3s-truck.svg",
    notes: "The hauler. Slow but enormous storage. Needs battery, spark plug, 2 truck batteries slot, 6 wheels.",
    size: "large",
  },
];

export function getVehicle(id: string): Vehicle | undefined {
  return VEHICLES.find((v) => v.id === id);
}
