// Mock "approved safehouse" pickup locations, keyed by server id.
// In the live system these are curated by runners in the Discord runner-ops
// channel (see ROADMAP.md). Here they're static mock data.
//
// Each safehouse carries in-game map coordinates (x, y) and the map slug used
// by the dayz.xam.nu interactive map, so the UI can deep-link to the exact
// pickup spot. Coordinates are approximate landmark positions (mock data).

export type MapSlug = "chernarusplus" | "livonia" | "sakhal";

export interface Safehouse {
  id: string;
  name: string;
  area: string; // in-game region
  map: MapSlug;
  x: number; // in-game easting (meters)
  y: number; // in-game northing (meters)
}

// Build a permalink to the pickup spot on the dayz.xam.nu interactive map.
// Hash format is `#x;y;zoom`.
export function mapUrl(s: Safehouse, zoom = 6): string {
  return `https://dayz.xam.nu/${s.map}#${s.x};${s.y};${zoom}`;
}

// Format coordinates the way players read them off the map/DayZ debug: "X / Y".
export function formatCoords(s: Safehouse): string {
  return `${s.x} / ${s.y}`;
}

export const SAFEHOUSES: Record<string, Safehouse[]> = {
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

export function getSafehouses(serverId: string): Safehouse[] {
  return SAFEHOUSES[serverId] ?? [];
}
