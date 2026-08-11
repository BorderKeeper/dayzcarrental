import type { Metadata } from "next";
import DemoNotice from "@/components/DemoNotice";
import DonateCarForm from "@/components/DonateCarForm";

export const metadata: Metadata = {
  title: "Donate a Car — DayzCarRental.com",
  description: "Found a spare vehicle? Donate it to the community fleet and name your barter.",
};

export default function DonateCarPage() {
  return (
    <div>
      <h1>Donate a Car</h1>
      <DemoNotice />
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
        <DonateCarForm />
      </div>
    </div>
  );
}
