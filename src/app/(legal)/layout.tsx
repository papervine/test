import Link from "next/link";
import { PlatformShell } from "@/components/platform/PlatformShell";
import { Brand } from "@/components/Brand";

// Shared frame for the public legal pages (privacy / terms / refund). Wears the
// platform atmosphere like the landing, with a readable centered prose column.
//
// NOTE FOR MAINTAINERS: the legal copy in these pages is a reasonable starter
// template for a multi-tenant SaaS, NOT vetted legal advice. Before relying on it
// for Stripe go-live, have counsel review and fill the [BRACKETED] placeholders
// (governing-law jurisdiction, mailing address, refund window).
export default function LegalLayout({ children }: { children: React.ReactNode }) {
  return (
    <PlatformShell variant="full">
      <div className="mx-auto flex min-h-screen w-full max-w-3xl flex-col px-6">
        <header className="flex items-center justify-between py-6">
          <Link href="/" className="flex items-center">
            <Brand size="md" priority />
          </Link>
          <nav className="flex gap-5 text-sm text-[var(--muted)]">
            <Link href="/privacy" className="hover:text-[var(--fg)]">
              Privacy
            </Link>
            <Link href="/terms" className="hover:text-[var(--fg)]">
              Terms
            </Link>
            <Link href="/refund" className="hover:text-[var(--fg)]">
              Refunds
            </Link>
          </nav>
        </header>

        <main className="legal-prose flex-1 py-8">{children}</main>

        <footer className="border-t border-white/[0.06] py-8 text-sm text-[var(--muted)]">
          © {new Date().getFullYear()} NewNewMedia, LLC. Papervine is a product of
          NewNewMedia, LLC.
        </footer>
      </div>
    </PlatformShell>
  );
}
