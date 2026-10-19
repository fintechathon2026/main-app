import type { Metadata } from "next";
import { SubscriptionsScreen } from "@/src/ui/screens/subscriptions";

export const metadata: Metadata = { title: "Subscriptions" };

export default function SubscriptionsPage() {
  return <SubscriptionsScreen />;
}
