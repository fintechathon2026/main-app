import Link from "next/link";

export default function NotFound() {
  return (
    <main className="grid min-h-dvh place-items-center px-6 text-center">
      <div>
        <p className="text-[20px] font-semibold">This page does not exist.</p>
        <p className="mt-1 text-[15px] text-muted">Nothing was changed.</p>
        <Link
          href="/"
          className="mt-6 inline-flex min-h-11 items-center rounded-full bg-ink px-5 text-[15px] font-semibold text-page hover:opacity-90"
        >
          Go to Home
        </Link>
      </div>
    </main>
  );
}
