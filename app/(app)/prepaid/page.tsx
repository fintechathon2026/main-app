import type { Metadata } from "next";
import { PrepaidScreen } from "@/src/ui/screens/prepaid";

export const metadata: Metadata = { title: "Prepaid" };

export default function PrepaidPage() {
  return <PrepaidScreen />;
}
