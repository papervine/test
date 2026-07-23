import { ChevronRight } from "lucide-react";

// Shared breadcrumb header for the Autopilot surfaces (SPEC §10.2): "Autopilot › {page}".
// The rail already carries the "Trialing" badge, and the top-right is owned by the floating
// env badge, so the header stays just the breadcrumb. Scaffold chrome only — no live "Things
// to do"/Search top bar yet.
export function AutomateHeader({ page }: { page: string }) {
  return (
    <nav className="flex items-center gap-1.5 text-sm text-[var(--muted)]">
      <span>Autopilot</span>
      <ChevronRight className="h-3.5 w-3.5" />
      <span className="text-[var(--fg)]">{page}</span>
    </nav>
  );
}
