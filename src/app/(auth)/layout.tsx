import Link from "next/link";
import { PlatformShell } from "@/components/platform/PlatformShell";
import { Wordmark } from "@/components/Wordmark";

// Centered auth shell (login/signup/onboarding) — no docs chrome, no app rail.
// Wears the full platform atmosphere (glow + grid + grain): these pages are sparse
// and marketing-adjacent, so they can carry the landing's look at full strength.
export default function AuthLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <PlatformShell variant="full">
      <div className="flex min-h-screen flex-col items-center justify-center px-4">
        <Link href="/" className="mb-8 flex items-center">
          <Wordmark className="text-2xl" />
        </Link>
        <div className="w-full max-w-sm rounded-2xl border border-[rgba(var(--ink-rgb),0.06)] bg-[rgba(var(--ink-rgb),0.02)] p-7 shadow-[0_20px_60px_-30px_rgba(120,120,255,0.35)]">
          {children}
        </div>
      </div>
    </PlatformShell>
  );
}
