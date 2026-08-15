"use client";

import { useState } from "react";
import Link from "next/link";
import ServerSelect, { CUSTOM_SERVER } from "@/components/ServerSelect";
import VehicleCard from "@/components/VehicleCard";
import RentFlow from "@/components/RentFlow";
import { VEHICLES, type Vehicle } from "@/data/vehicles";
import { SITE } from "@/data/site";
import { safehousesFor, serverName as nameOf, vehicleIdsFor, type Fleet } from "@/data/types";

// The rent flow's browse step. Takes its Fleet as a prop so the ROUTE decides
// whether this is live data or sandbox fixtures — see src/data/fleet.ts.
export default function RentBrowser({ fleet }: { fleet: Fleet }) {
  const [serverId, setServerId] = useState("");
  const [customServer, setCustomServer] = useState("");
  const [renting, setRenting] = useState<Vehicle | null>(null);

  const isSandbox = fleet.mode === "sandbox";
  const isCustom = serverId === CUSTOM_SERVER;
  const serverChosen = serverId !== "" && (!isCustom || customServer.trim() !== "");
  const serverName = isCustom ? customServer.trim() : nameOf(fleet, serverId);

  // Only cars actually staged on the chosen server. Previously every server —
  // including one the visitor typed in themselves — rendered the entire
  // catalogue, promising a fleet that did not exist for them (C-01).
  const staged = vehicleIdsFor(fleet, serverId);
  const available = VEHICLES.filter((v) => staged.includes(v.id));
  const safehouses = safehousesFor(fleet, serverId);

  return (
    <div>
      <h1>Rent a Car</h1>

      {!renting && (
        <div className="panel">
          <ServerSelect
            servers={fleet.servers}
            value={serverId}
            onChange={setServerId}
            customName={customServer}
            onCustomNameChange={setCustomServer}
            label="First, pick the server you play on:"
            // In the sandbox a made-up server still demos the whole flow. On
            // live it would advertise a fleet nobody can collect, so it's off.
            allowCustom={isSandbox}
            emptyNote={
              <div className="notice">
                <strong>No servers are covered yet.</strong> We&apos;re recruiting runners to stage
                cars — until a server has one, there&apos;s nothing to rent. If you play somewhere
                you&apos;d like covered,{" "}
                <a href={SITE.discordInvite} target="_blank" rel="noopener noreferrer">
                  tell us in Discord
                </a>
                . You can also{" "}
                <Link href="/sandbox">look around the sample version</Link> to see how renting will
                work.
              </div>
            }
          />
          {fleet.servers.length > 0 && (
            <p className="small muted" style={{ marginTop: 8 }}>
              Cars are staged at approved safehouses per server. Rentals are billed{" "}
              <strong>per day in in-game items</strong>, with a refundable deposit — bigger vehicles
              cost more and carry a larger deposit.
            </p>
          )}
        </div>
      )}

      {renting ? (
        <RentFlow
          vehicle={renting}
          safehouses={safehouses}
          serverName={serverName}
          isSandbox={isSandbox}
          onClose={() => setRenting(null)}
        />
      ) : !serverChosen ? (
        fleet.servers.length > 0 && (
          <div className="notice">Choose a server above to see the cars available for rent there.</div>
        )
      ) : available.length === 0 ? (
        // The honest version of C-01's dead end: say the server isn't covered
        // instead of showing a fleet and then trapping them at pickup.
        <div className="notice">
          <strong>No cars are staged on {serverName} yet.</strong> A server needs a runner before
          anything can be rented there.{" "}
          <a href={SITE.discordInvite} target="_blank" rel="noopener noreferrer">
            Ask in Discord
          </a>{" "}
          — if you play there regularly, you could be that runner.
        </div>
      ) : (
        <>
          <h2>Available on {serverName}</h2>
          <div className="vehicle-grid">
            {available.map((v) => (
              <VehicleCard key={v.id} vehicle={v} onRent={setRenting} />
            ))}
          </div>
        </>
      )}
    </div>
  );
}
