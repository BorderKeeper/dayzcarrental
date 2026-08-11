"use client";

import { SERVERS } from "@/data/servers";

interface Props {
  value: string; // server id, or "__custom" while typing a new one
  onChange: (serverId: string) => void;
  customName: string;
  onCustomNameChange: (name: string) => void;
  id?: string;
  label?: string;
}

// Reused by Rent and Donate-a-car: pick a listed server or type your own.
export default function ServerSelect({
  value,
  onChange,
  customName,
  onCustomNameChange,
  id = "server",
  label = "Which server do you play on?",
}: Props) {
  return (
    <div>
      <label htmlFor={id}>{label}</label>
      <select id={id} value={value} onChange={(e) => onChange(e.target.value)}>
        <option value="">— select a server —</option>
        {SERVERS.map((s) => (
          <option key={s.id} value={s.id}>
            {s.name} ({s.map} · {s.mode})
          </option>
        ))}
        <option value="__custom">Other / not listed — type it in…</option>
      </select>
      {value === "__custom" && (
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
