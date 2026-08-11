// booking.ts — the rental + car-donation intake model, in-game-commodity only.
//
// This is the operational counterpart to the governance vote engine: it is how
// the RENTER and DONOR personas interact with the ecosystem, and how the
// classic conflict (two players want the same car on the same days) resolves
// deterministically without founder aid.
//
// COMPLIANCE.md is honored structurally, not just by convention:
//   * rentals are priced in an in-game COMMODITY only — the type system has no
//     field for a fiat amount, so a real-money rental price is unrepresentable,
//   * the deposit is an in-game commodity too, refundable unless the car is not
//     returned within the agreed days,
//   * car donations are voluntary vehicle contributions — never tied to money.
//
// Like the rest of the engine this is a pure model: it records intents and
// resolves overlaps; it does not talk to a game server.

export type Commodity = "ammo" | "food" | "fuel" | "medical" | "tools";

// A price/deposit is always an in-game commodity quantity. There is
// deliberately NO monetary field here — real-money rental pricing is
// unrepresentable, enforcing COMPLIANCE.md at the type level.
export interface CommodityAmount {
  commodity: Commodity;
  qty: number;
}

export interface DonatedCar {
  id: string;
  donorId: string;
  serverId: string;
  model: string;
  // Donation is a voluntary vehicle contribution. No money, ever.
  acceptedByRunnerId?: string;
  staged: boolean; // made road-worthy + parked at a safehouse
}

export interface RentalRequest {
  renterId: string;
  carId: string;
  serverId: string;
  startDay: number; // in-game day index (integers keep this deterministic)
  endDay: number; // inclusive
}

export interface Rental extends RentalRequest {
  id: string;
  pricePerDay: CommodityAmount;
  deposit: CommodityAmount;
}

export type BookingResult =
  | { status: "booked"; rental: Rental }
  | { status: "conflict"; reason: string; conflictsWith: string }
  | { status: "rejected"; reason: string };

// Two [start,end] inclusive day ranges overlap?
function overlaps(a: { startDay: number; endDay: number }, b: { startDay: number; endDay: number }): boolean {
  return a.startDay <= b.endDay && b.startDay <= a.endDay;
}

export class RentalLedger {
  private rentals: Rental[] = [];
  private seq = 0;
  private cars: Map<string, DonatedCar>;

  constructor(cars: Map<string, DonatedCar>) {
    this.cars = cars;
  }

  // Accept a car donation into the fleet. A runner stages it; only staged cars
  // are rentable. Voluntary, no money — the donor gets nothing but goodwill.
  stageDonation(carId: string, runnerId: string): boolean {
    const car = this.cars.get(carId);
    if (!car) return false;
    car.acceptedByRunnerId = runnerId;
    car.staged = true;
    return true;
  }

  // Book a rental. Rejects fiat-free by construction; rejects unstaged cars;
  // and resolves the double-booking conflict FIRST-COME on overlapping days.
  // The earlier confirmed rental wins; the later request is told what it clashes
  // with so the two players (and a runner) can pick different days or another
  // car — no founder needed.
  book(req: RentalRequest, pricePerDay: CommodityAmount, deposit: CommodityAmount): BookingResult {
    if (req.endDay < req.startDay) {
      return { status: "rejected", reason: "endDay is before startDay." };
    }
    const car = this.cars.get(req.carId);
    if (!car) return { status: "rejected", reason: `Unknown car '${req.carId}'.` };
    if (!car.staged) return { status: "rejected", reason: "Car is not staged/road-worthy yet." };
    if (car.serverId !== req.serverId) {
      return { status: "rejected", reason: "Car is not on that server." };
    }

    const clash = this.rentals.find((r) => r.carId === req.carId && overlaps(r, req));
    if (clash) {
      return {
        status: "conflict",
        reason: `Car '${req.carId}' is already booked days ${clash.startDay}-${clash.endDay}. First booking wins; choose other days or another car.`,
        conflictsWith: clash.id,
      };
    }

    const rental: Rental = { ...req, id: `rental-${++this.seq}`, pricePerDay, deposit };
    this.rentals.push(rental);
    return { status: "booked", rental };
  }

  // Return a car. Deposit is refunded (in-game commodity) unless the car came
  // back after the agreed end day — then it is forfeit, per COMPLIANCE.md #3.
  closeRental(rentalId: string, returnedOnDay: number): { refunded: boolean; deposit: CommodityAmount } | null {
    const idx = this.rentals.findIndex((r) => r.id === rentalId);
    if (idx === -1) return null;
    const rental = this.rentals[idx];
    this.rentals.splice(idx, 1);
    const onTime = returnedOnDay <= rental.endDay;
    return { refunded: onTime, deposit: rental.deposit };
  }

  active(): Rental[] {
    return this.rentals.map((r) => ({ ...r }));
  }
}
