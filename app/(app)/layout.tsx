import { AuthGate } from "@/src/ui/auth/gate";
import { AppShell } from "@/src/ui/shell/app-shell";

export default function AppLayout({ children }: LayoutProps<"/">) {
  return (
    <AuthGate>
      <AppShell>{children}</AppShell>
    </AuthGate>
  );
}
