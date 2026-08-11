"use client";

import { useState } from "react";
import DemoNotice from "@/components/DemoNotice";
import ServerSelect from "@/components/ServerSelect";
import VehicleCard from "@/components/VehicleCard";
import RentFlow from "@/components/RentFlow";
import { VEHICLES, type Vehicle } from "@/data/vehicles";
import { SERVERS } from "@/data/servers";

export default function RentPage() {
  const [serverId, setServerId] = useState("");
  const [customServer, setCustomServer] = useState("");
  const [renting, setRenting] = useState<Vehicle | null>(null);

  const serverChosen = serverId !== "" && (serverId !== "__custom" || customServer.trim() !== "");
  const serverName =
    serverId === "__custom"
      ? customServer.trim()
      : SERVERS.find((s) => s.id === serverId)?.name ?? "";

  return (
    <div>
      <h1>Rent a Car</h1>
      <DemoNotice />

      {!renting && (
        <div className="panel">
          <ServerSelect
            value={serverId}
            onChange={setServerId}
            customName={customServer}
            onCustomNameChange={setCustomServer}
            label="First, pick the server you play on:"
          />
          <p className="small muted" style={{ marginTop: 8 }}>
            Cars are staged at approved safehouses per server. Rentals are billed{" "}
            <strong>per day in in-game items</strong>, with a refundable deposit — bigger vehicles
            cost more and carry a larger deposit.
          </p>
        </div>
      )}

      {renting ? (
        <RentFlow
          vehicle={renting}
          serverId={serverId}
          serverName={serverName}
          onClose={() => setRenting(null)}
        />
      ) : !serverChosen ? (
        <div className="notice">
          Choose a server above to see the cars available for rent there.
        </div>
      ) : (
        <>
          <h2>Available on {serverName}</h2>
          <div className="vehicle-grid">
            {VEHICLES.map((v) => (
              <VehicleCard key={v.id} vehicle={v} onRent={setRenting} />
            ))}
          </div>
        </>
      )}
    </div>
  );
}
