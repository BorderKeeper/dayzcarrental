// The one place a page asks "what can be rented?".
//
// Server components call getFleet(mode) and pass the result down as props, so
// the mode is decided by the ROUTE (/ is live, /sandbox is sample data) and
// never by a client-side flag that could drift or be toggled by accident.

import { SANDBOX_FLEET } from "./sandbox";
import { loadLiveFleet } from "./liveStore";
import type { Fleet, FleetMode } from "./types";

export async function getFleet(mode: FleetMode): Promise<Fleet> {
  return mode === "sandbox" ? SANDBOX_FLEET : loadLiveFleet();
}
