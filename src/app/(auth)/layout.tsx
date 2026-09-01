import { headers } from "next/headers";
import { PlatformShell } from "@/components/platform/PlatformShell";
import { Brand } from "@/components/Brand";
import { marketingHostFor } from "@/lib/tenant-host";
import { MagicCard } from "@/components/platform/MagicCard";

// Centered auth shell (login/signup/onboarding) — no docs chrome, no app rail.
// Wears the full platform atmosphere (glow + prismatic burst + grain): these pages are sparse
// and marketing-adjacent, so they can carry the landing's look at full strength — and the
// backdrop here is the shader burst, which leans toward the cursor.
export default async function AuthLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  // These pages live on the APP host, where "/" is the dashboard resolver — it bounces a
  // logged-out visitor straight back to /login, so the brand link looked broken. Point it at the
  // marketing apex instead.
  const h = await headers();
  const host = h.get("host") ?? "";
  const proto = h.get("x-forwarded-proto") ?? (host.includes("localhost") ? "http" : "https");
  const home = host ? `${proto}://${marketingHostFor(host)}/` : "/";

  return (
    <PlatformShell variant="auth">
      <div className="flex min-h-screen flex-col items-center justify-center px-4">
        {/* A plain <a>, not <Link>: this crosses from the app host to the apex, and a soft RSC
            nav resolves against the current route tree and skips the Host rewrite (CLAUDE.md).
            The cross-context hop has to be a real navigation. */}
        <a href={home} className="mb-8 flex items-center">
          <Brand size="lg" priority />
        </a>
        {/* The card lights up under the cursor (MagicCard). Applied to the shared shell rather
            than to one form, so login, signup, the password flows, onboarding and accept-invite
            all behave the same — these pages are sparse and marketing-adjacent, which is
            exactly where the flourish belongs. */}
        <MagicCard className="w-full max-w-sm rounded-2xl border border-[rgba(var(--ink-rgb),0.06)] bg-[rgba(var(--ink-rgb),0.02)] p-7 shadow-[0_20px_60px_-30px_rgba(120,120,255,0.35)]">
          {children}
        </MagicCard>
      </div>
    </PlatformShell>
  );
}
