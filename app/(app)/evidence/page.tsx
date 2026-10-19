import type { Metadata } from "next";
import { EvidenceScreen } from "@/src/ui/screens/evidence";

export const metadata: Metadata = { title: "Evidence" };

export default function EvidencePage() {
  return <EvidenceScreen />;
}
