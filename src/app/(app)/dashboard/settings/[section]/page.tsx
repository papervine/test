import { notFound } from "next/navigation";
import { ChevronRight } from "lucide-react";
import { SETTINGS_SLUGS, settingsLabel } from "@/lib/settings-nav";

// Placeholder surface for every Settings nav item. Content is scaffolded per-surface
// later — for now this just proves the route exists and the breadcrumb/title render.
// Unknown slugs 404 rather than rendering an empty shell.
export default async function SettingsSectionPage({
  params,
}: {
  params: Promise<{ section: string }>;
}) {
  const { section } = await params;
  if (!SETTINGS_SLUGS.includes(section)) notFound();
  const label = settingsLabel(section)!;

  return (
    <div className="px-8 py-6">
      <nav className="flex items-center gap-1.5 text-sm text-[var(--muted)]">
        <span>Settings</span>
        <ChevronRight className="h-3.5 w-3.5" />
        <span className="text-[var(--fg)]">{label}</span>
      </nav>

      <h1 className="mt-6 text-xl font-semibold">{label}</h1>
      <p className="mt-2 text-sm text-[var(--muted)]">
        This surface isn’t built yet.
      </p>
    </div>
  );
}
