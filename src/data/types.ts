// Shared shapes for the rental fleet, plus the pure helpers the UI needs.
//
// These types are the contract between the two data sources:
//
//   sandbox — hardcoded fixtures in sandbox.ts. Invented servers and
//             safehouses, used to demo the site end to end. Served only under
//             /sandbox, always behind a banner saying so.
//   live    — real data from Redis (liveStore.ts), curated by runners. Starts
//             empty and stays empty until someone seeds it.
//
// Everything here must stay plain, serialisable data: a server component loads
// a Fleet and hands it to client components as props, so no methods, no class
// instances, no Dates.

export type FleetMode = "live" | "sandbox";

export type MapSlug = "chernarusplus" | "livonia" | "sakhal";

export interface GameServer {
  id: string;
  name: string;
  map: string;
  mode: string; // PvP / PvE / RP etc.
}

export interface Safehouse {
  id: string;
  name: string;
  area: string; // in-game region
  map: MapSlug;
  x: number; // in-game easting (meters)
  y: number; // in-game northing (meters)
}

// One complete picture of what can be rented where.
//
// The vehicle *catalogue* is not in here on purpose: DayZ car models are the
// same on every server, so they stay static repo data (vehicles.ts). What
// varies per server — and therefore lives with the fleet — is which of those
// cars are actually staged and where they're picked up.
export interface Fleet {
  mode: FleetMode;
  servers: GameServer[];
  // serverId -> approved pickup safehouses.
  safehouses: Record<string, Safehouse[]>;
  // serverId -> ids of vehicles staged on that server. An absent entry means
  // "nothing staged", not "everything" — being wrong in that direction would
  // advertise cars that don't exist, which is the C-01 trap.
  vehicleIds: Record<string, string[]>;
}

export const EMPTY_FLEET: Fleet = { mode: "live", servers: [], safehouses: {}, vehicleIds: {} };

// Build a permalink to a pickup spot on the dayz.xam.nu interactive map.
// Hash format is `#x;y;zoom`.
export function mapUrl(s: Safehouse, zoom = 6): string {
  return `https://dayz.xam.nu/${s.map}#${s.x};${s.y};${zoom}`;
}

// Format coordinates the way players read them off the map/DayZ debug: "X / Y".
export function formatCoords(s: Safehouse): string {
  return `${s.x} / ${s.y}`;
}

export function safehousesFor(fleet: Fleet, serverId: string): Safehouse[] {
  return fleet.safehouses[serverId] ?? [];
}

export function vehicleIdsFor(fleet: Fleet, serverId: string): string[] {
  return fleet.vehicleIds[serverId] ?? [];
}

export function serverName(fleet: Fleet, serverId: string): string {
  return fleet.servers.find((s) => s.id === serverId)?.name ?? "";
}
