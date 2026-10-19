import type { Metadata } from "next";
import { RulesScreen } from "@/src/ui/screens/rules";

export const metadata: Metadata = { title: "Your rules" };

export default function RulesPage() {
  return <RulesScreen />;
}
