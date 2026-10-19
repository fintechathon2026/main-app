import { Nav } from "../_components/nav";

export default function AppLayout({ children }: LayoutProps<"/">) {
  return (
    <div className="flex min-h-dvh">
      <Nav />
      <main className="mx-auto w-full max-w-5xl flex-1 px-4 pb-24 pt-6 md:px-8 md:pb-10">{children}</main>
    </div>
  );
}
