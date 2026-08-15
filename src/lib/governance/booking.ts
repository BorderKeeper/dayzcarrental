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
  // Set when the car was pulled out of service DURING this rental. The renter
  // then can't be held to the return deadline for a car they no longer have,
  // so the deposit is refunded regardless of when (or whether) it comes back.
  // In this game a deposit is a real rifle and optic — forfeiting one for
  // something outside the renter's control is the kind of incident that ends a
  // community's trust in a single afternoon.
  depositWaived?: boolean;
  waivedReason?: string;
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
  //
  // The one exception is a car withdrawn from service mid-rental: the renter
  // couldn't return it on time because it was taken from them, so a waiver set
  // by takeOutOfService overrides lateness.
  closeRental(
    rentalId: string,
    returnedOnDay: number,
  ): { refunded: boolean; deposit: CommodityAmount; waived: boolean; reason?: string } | null {
    const idx = this.rentals.findIndex((r) => r.id === rentalId);
    if (idx === -1) return null;
    const rental = this.rentals[idx];
    this.rentals.splice(idx, 1);
    const onTime = returnedOnDay <= rental.endDay;
    const waived = rental.depositWaived === true;
    return {
      refunded: onTime || waived,
      deposit: rental.deposit,
      waived,
      reason: waived ? rental.waivedReason : undefined,
    };
  }

  // Rentals currently running over a given day. A car with one of these must
  // not silently vanish from under its renter.
  activeRentalsForCar(carId: string, onDay?: number): Rental[] {
    return this.rentals
      .filter((r) => r.carId === carId && (onDay === undefined || (r.startDay <= onDay && onDay <= r.endDay)))
      .map((r) => ({ ...r }));
  }

  // Pull a car out of the rentable fleet (destroyed, glitched, stuck, or just
  // needing work).
  //
  // Previously there was no method for this at all: a runner flipped
  // `car.staged` on the shared map, the active rental kept running, nobody was
  // told, and the renter later forfeited their deposit for a car that had been
  // taken away from them.
  //
  // So it REFUSES by default while a rental is running, and names who is
  // affected so a human can talk to them. Sometimes a car genuinely has to go
  // (it burned), and blocking outright would just push runners back to editing
  // state by hand — so `force` is allowed, but it waives the deposit on every
  // affected rental as a condition of being used. The renter is never the one
  // who pays for this.
  takeOutOfService(
    carId: string,
    runnerId: string,
    opts: { force?: boolean; reason?: string; onDay?: number } = {},
  ):
    | { status: "unknown-car"; detail: string }
    | { status: "blocked"; affected: Rental[]; detail: string }
    | { status: "withdrawn"; affected: Rental[]; detail: string } {
    const car = this.cars.get(carId);
    if (!car) return { status: "unknown-car", detail: `Unknown car '${carId}'.` };

    const affected = this.rentals.filter(
      (r) => r.carId === carId && (opts.onDay === undefined || (r.startDay <= opts.onDay && opts.onDay <= r.endDay)),
    );

    if (affected.length > 0 && !opts.force) {
      const who = affected.map((r) => `${r.renterId} (days ${r.startDay}-${r.endDay})`).join(", ");
      return {
        status: "blocked",
        affected: affected.map((r) => ({ ...r })),
        detail:
          `Car '${carId}' is out on an active rental to ${who}. ` +
          `Taking it out of service now would strand them and put their deposit at risk. ` +
          `Talk to them first, or re-run with force to withdraw it anyway — that automatically waives their deposit.`,
      };
    }

    const reason = opts.reason?.trim() || "taken out of service by a runner";
    for (const r of affected) {
      r.depositWaived = true;
      r.waivedReason = reason;
    }
    car.staged = false;
    return {
      status: "withdrawn",
      affected: affected.map((r) => ({ ...r })),
      detail:
        affected.length === 0
          ? `Car '${carId}' withdrawn by ${runnerId} (${reason}). No active rentals.`
          : `Car '${carId}' withdrawn by ${runnerId} (${reason}). ` +
            `${affected.length} active rental(s) affected — deposits waived, tell the renter(s).`,
    };
  }

  // Put a repaired/recovered car back in the fleet.
  returnToService(carId: string, runnerId: string): boolean {
    const car = this.cars.get(carId);
    if (!car) return false;
    car.acceptedByRunnerId = runnerId;
    car.staged = true;
    return true;
  }

  active(): Rental[] {
    return this.rentals.map((r) => ({ ...r }));
  }
}
