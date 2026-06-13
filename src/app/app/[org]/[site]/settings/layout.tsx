import { SettingsNav } from "@/components/app/SettingsNav";

// Adds the Settings subnav as a second sidebar inside the (app) shell. The outer
// layout already supplies the AppRail + session gate; this just splits the content
// pane into [subnav | surface].
export default function SettingsLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  // Column on mobile (SettingsNav is a horizontal pill strip above the surface), row on
  // desktop (SettingsNav is a second sidebar beside it). min-w-0 lets wide settings content
  // shrink instead of overflowing.
  return (
    <div className="flex min-h-screen flex-col lg:flex-row">
      <SettingsNav />
      <div className="min-w-0 flex-1 overflow-auto">{children}</div>
    </div>
  );
}
