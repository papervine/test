import { redirect } from "next/navigation";
import { FIRST_SETTINGS_SLUG, settingsHref } from "@/lib/settings-nav";

// Bare …/settings lands on the first surface (Domain setup), matching the breadcrumb in
// the design (Admin › Settings › Domain setup).
export default async function SettingsIndex({
  params,
}: {
  params: Promise<{ org: string; site: string }>;
}) {
  const { org, site } = await params;
  redirect(settingsHref(org, site, FIRST_SETTINGS_SLUG));
}
