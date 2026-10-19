import type { Metadata } from "next";
import { ActivityScreen } from "@/src/ui/screens/activity";

export const metadata: Metadata = { title: "Activity" };

export default function ActivityPage() {
  return <ActivityScreen />;
}
