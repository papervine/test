import { redirect } from "next/navigation";
import { FIRST_SETTINGS_SLUG, settingsHref } from "@/lib/settings-nav";

// Bare /dashboard/settings lands on the first surface (Domain setup), matching the
// breadcrumb in the design (Admin › Settings › Domain setup).
export default function SettingsIndex() {
  redirect(settingsHref(FIRST_SETTINGS_SLUG));
}
