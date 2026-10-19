import type { Metadata } from "next";
import { Suspense } from "react";
import { AuthCallbackScreen } from "@/src/ui/screens/auth-callback";

export const metadata: Metadata = { title: "Signing in" };

export default function AuthCallbackPage() {
  return (
    <Suspense>
      <AuthCallbackScreen />
    </Suspense>
  );
}
