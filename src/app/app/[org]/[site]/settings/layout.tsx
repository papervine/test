import { SettingsNav } from "@/components/app/SettingsNav";

// Adds the Settings subnav as a second sidebar inside the (app) shell. The outer
// layout already supplies the AppRail + session gate; this just splits the content
// pane into [subnav | surface].
export default function SettingsLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <div className="flex min-h-screen">
      <SettingsNav />
      <div className="flex-1 overflow-auto">{children}</div>
    </div>
  );
}
