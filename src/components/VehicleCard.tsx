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
  // Fall back to a labeled placeholder box if the image file is missing.
  const [imgOk, setImgOk] = useState(true);

  return (
    <div className="vcard">
      <div className="vcard__img">
        {imgOk ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={vehicle.image}
            alt={`${vehicle.name} with a survivor standing next to it`}
            onError={() => setImgOk(false)}
          />
        ) : (
          <span>
            [ photo of {vehicle.name} ]<br />
            drop image at
            <br />
            public{vehicle.image}
          </span>
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
