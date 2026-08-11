// Mock list of servers players can filter by. In the mockup these are
// hard-coded; forms also allow typing in a server that isn't listed.

export interface GameServer {
  id: string;
  name: string;
  map: string;
  mode: string; // PvP / PvE / etc.
}

export const SERVERS: GameServer[] = [
  { id: "cherno-official-1234", name: "Chernarus Official #1234", map: "Chernarus", mode: "PvP" },
  { id: "livonia-pve-community", name: "Livonia Community PvE", map: "Livonia", mode: "PvE" },
  { id: "cherno-hardcore-77", name: "Chernarus Hardcore #77", map: "Chernarus", mode: "PvP (1PP)" },
  { id: "sakhal-frostbite", name: "Sakhal Frostbite RP", map: "Sakhal", mode: "RP / PvE" },
  { id: "livonia-official-0420", name: "Livonia Official #0420", map: "Livonia", mode: "PvP" },
];
