import DemoNotice from "@/components/DemoNotice";
import RentBrowser from "@/components/RentBrowser";
import { getFleet } from "@/data/fleet";

// Server component: loads the LIVE fleet from Redis and hands it to the client
// browser as props. The sandbox equivalent lives at /sandbox and differs only
// in which Fleet it passes down — see src/data/fleet.ts.
export const dynamic = "force-dynamic";

export default async function RentPage() {
  const fleet = await getFleet("live");
  return (
    <div>
      <DemoNotice />
      <RentBrowser fleet={fleet} />
    </div>
  );
}
