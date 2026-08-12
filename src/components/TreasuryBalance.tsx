"use client";

import { useEffect, useState } from "react";

// Shows the live AI-maintainer upkeep budget balance, read from /api/treasury.
// Lets a donor (and the founder testing the flow) watch the balance rise after
// a donation completes. Read-only; polls once on mount + a manual refresh.
export default function TreasuryBalance() {
  const [state, setState] = useState<{ balance?: string; durable?: boolean; error?: boolean; loading: boolean }>({
    loading: true,
  });

  async function load() {
    setState((s) => ({ ...s, loading: true }));
    try {
      const res = await fetch("/api/treasury", { cache: "no-store" });
      const data = await res.json();
      if (data?.ok) setState({ balance: data.balanceUsd, durable: data.durable, loading: false });
      else setState({ error: true, loading: false });
    } catch {
      setState({ error: true, loading: false });
    }
  }

  useEffect(() => {
    load();
  }, []);

  return (
    <p className="small muted" style={{ marginTop: 12 }}>
      {state.loading
        ? "Checking the upkeep budget…"
        : state.error
          ? "Upkeep budget: unavailable right now."
          : `Current upkeep budget: ${state.balance}`}
      {state.durable === false && !state.loading && !state.error ? " (not yet persisted)" : ""}{" "}
      <a
        href="#"
        onClick={(e) => {
          e.preventDefault();
          load();
        }}
      >
        refresh
      </a>
    </p>
  );
}
