import type { Metadata } from "next";
import { GymTablet } from "./tablet";

export const metadata: Metadata = { title: "Gym tablet (simulated)" };

// The gym's check-in tablet (architecture §24.7, demo only). Staff enter the member's plan number;
// the tablet signs the plan's next session with the merchant key (server side, src/sim). The member
// then confirms in their own app, which adds their signature. Simulated: no real gym.
export default function GymTabletPage() {
  return <GymTablet />;
}
