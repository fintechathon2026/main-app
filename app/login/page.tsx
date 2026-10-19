import type { Metadata } from "next";
import { Suspense } from "react";
import { LoginScreen } from "@/src/ui/screens/login";

export const metadata: Metadata = { title: "Sign in" };

export default function LoginPage() {
  return (
    <Suspense>
      <LoginScreen />
    </Suspense>
  );
}
