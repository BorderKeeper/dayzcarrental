"use client";

import type { GameServer } from "@/data/types";
import { CUSTOM_SERVER } from "@/data/constants";

export { CUSTOM_SERVER };

interface Props {
  servers: GameServer[];
  value: string; // server id, or CUSTOM_SERVER while typing a new one
  onChange: (serverId: string) => void;
  customName: string;
  onCustomNameChange: (name: string) => void;
  id?: string;
  label?: string;
  // Whether "Other / not listed" is offered. Donating a car on an unlisted
  // server is a useful lead, so that form keeps it. Renting on one is not — see
  // the note in RentBrowser.
  allowCustom?: boolean;
  // Shown in place of the dropdown when there are no servers at all.
  emptyNote?: React.ReactNode;
}

// Reused by Rent and Donate-a-car: pick a listed server or type your own.
export default function ServerSelect({
  servers,
  value,
  onChange,
  customName,
  onCustomNameChange,
  id = "server",
  label = "Which server do you play on?",
  allowCustom = true,
  emptyNote,
}: Props) {
  if (servers.length === 0 && !allowCustom) {
    return <>{emptyNote}</>;
  }

  return (
    <div>
      <label htmlFor={id}>{label}</label>
      <select id={id} value={value} onChange={(e) => onChange(e.target.value)}>
        <option value="">— select a server —</option>
        {servers.map((s) => (
          <option key={s.id} value={s.id}>
            {s.name} ({s.map} · {s.mode})
          </option>
        ))}
        {allowCustom && <option value={CUSTOM_SERVER}>Other / not listed — type it in…</option>}
      </select>
      {value === CUSTOM_SERVER && (
        <div style={{ marginTop: 8 }}>
          <label htmlFor={`${id}-custom`}>Server name</label>
          <input
            id={`${id}-custom`}
            type="text"
            placeholder="e.g. My Community Server — Chernarus PvE"
            value={customName}
            onChange={(e) => onCustomNameChange(e.target.value)}
          />
        </div>
      )}
    </div>
  );
}
