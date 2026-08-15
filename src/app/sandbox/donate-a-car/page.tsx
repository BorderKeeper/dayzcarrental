import type { Metadata } from "next";
import DonateCarForm from "@/components/DonateCarForm";
import { getFleet } from "@/data/fleet";

export const metadata: Metadata = {
  title: "Donate a Car (sample data) — DayzCarRental.com",
  description: "Try the car-donation form against invented servers.",
};

export default async function SandboxDonateCarPage() {
  const fleet = await getFleet("sandbox");
  return (
    <div>
      <h1>Donate a Car</h1>
      <div className="panel panel--plain">
        <p>
          Got a spare car sitting in a field? Add it to the community fleet. Tell us where it is and
          how to run it, and a <strong>runner</strong> will collect it, get it road-worthy, and stage
          it at a safehouse for the next survivor to rent. You can name a bit of barter in return, or
          just pay it forward.
        </p>
      </div>
      <div className="panel">
        <h2>Car details</h2>
        <DonateCarForm servers={fleet.servers} />
      </div>
    </div>
  );
}
