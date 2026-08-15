import type { Metadata } from "next";
import RentBrowser from "@/components/RentBrowser";
import { getFleet } from "@/data/fleet";

export const metadata: Metadata = {
  title: "Rent a Car (sample data) — DayzCarRental.com",
  description: "Try the rental flow against invented servers and safehouses.",
};

// Same component as the live page; only the Fleet differs.
export default async function SandboxRentPage() {
  const fleet = await getFleet("sandbox");
  return <RentBrowser fleet={fleet} />;
}
