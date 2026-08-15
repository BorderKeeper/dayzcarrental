"use client";

import { useState } from "react";
import type { Vehicle } from "@/data/vehicles";

interface Props {
  vehicle: Vehicle;
  onRent: (vehicle: Vehicle) => void;
}

const SIZE_LABEL: Record<Vehicle["size"], string> = {
  small: "Small",
  medium: "Medium",
  large: "Large",
};

export default function VehicleCard({ vehicle, onRent }: Props) {
  // Fall back to a labelled box if the image is missing.
  const [imgOk, setImgOk] = useState(true);

  return (
    <div className="vcard">
      <div className="vcard__img vcard__img--art">
        {imgOk ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={vehicle.image}
            // These are drawings, not photographs — say so, rather than
            // describing a survivor standing next to a car that isn't there.
            alt={`Illustration of a ${vehicle.type.toLowerCase()}`}
            onError={() => setImgOk(false)}
          />
        ) : (
          // The old fallback printed "drop image at public/vehicles/…" — a
          // developer note leaking into a page players see.
          <span>{vehicle.type}</span>
        )}
      </div>
      <div className="vcard__body">
        <div className="row" style={{ justifyContent: "space-between" }}>
          <h3 style={{ margin: 0 }}>{vehicle.name}</h3>
          <span className={`tag tag--${vehicle.size}`}>{SIZE_LABEL[vehicle.size]}</span>
        </div>
        <div className="muted small">{vehicle.type}</div>
        <ul className="vcard__specs">
          <li>
            <span className="k">Seats:</span> {vehicle.seats}
          </li>
          <li>
            <span className="k">Cargo:</span> ~{vehicle.cargoSlots} slots — {vehicle.cargoNote}
          </li>
          <li>
            <span className="k">Top speed:</span> {vehicle.topSpeed}
          </li>
          <li>
            <span className="k">Per day:</span> <span className="price">{vehicle.pricePerDay}</span>
          </li>
          <li>
            <span className="k">Deposit:</span> {vehicle.deposit}
          </li>
        </ul>
        <p className="small muted" style={{ flex: 1 }}>
          {vehicle.notes}
        </p>
        <button className="btn" onClick={() => onRent(vehicle)}>
          Rent this car &raquo;
        </button>
      </div>
    </div>
  );
}
