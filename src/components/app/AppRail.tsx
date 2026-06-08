"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { Home, BarChart3, Settings, FileEdit } from "lucide-react";
import { signOut } from "@/lib/auth-client";

const NAV = [
  { href: "/dashboard", label: "Home", icon: Home },
  { href: "/dashboard/analytics", label: "Analytics", icon: BarChart3 },
  { href: "/dashboard/settings", label: "Settings", icon: Settings },
];

// Deferred incumbent surfaces (SPEC §15 non-goals / later) — shown disabled so the
// IA matches the product target without pretending these work yet.
const SOON = [{ label: "Editor", icon: FileEdit }];

export function AppRail({
  orgName,
  userName,
}: {
  orgName: string;
  userName: string;
}) {
  const pathname = usePathname();
  const router = useRouter();

  async function handleSignOut() {
    await signOut();
    router.push("/login");
  }

  return (
    <aside className="flex w-60 shrink-0 flex-col border-r border-neutral-800 bg-neutral-950 px-3 py-4">
      <div className="flex items-center gap-2 px-2 pb-4">
        <span className="flex h-6 w-6 items-center justify-center rounded bg-emerald-500 text-xs font-bold text-neutral-950">
          {orgName.charAt(0).toUpperCase()}
        </span>
        <span className="truncate text-sm font-medium">{orgName}</span>
      </div>

      <nav className="flex flex-col gap-1">
        {NAV.map(({ href, label, icon: Icon }) => {
          const active = pathname === href;
          return (
            <Link
              key={href}
              href={href}
              className={`flex items-center gap-2 rounded-md px-2 py-1.5 text-sm ${
                active
                  ? "bg-neutral-800 text-emerald-400"
                  : "text-neutral-300 hover:bg-neutral-900"
              }`}
            >
              <Icon className="h-4 w-4" />
              {label}
            </Link>
          );
        })}
        {SOON.map(({ label, icon: Icon }) => (
          <span
            key={label}
            className="flex items-center gap-2 rounded-md px-2 py-1.5 text-sm text-neutral-600"
          >
            <Icon className="h-4 w-4" />
            {label}
            <span className="ml-auto rounded bg-neutral-800 px-1.5 py-0.5 text-[10px] text-neutral-400">
              Soon
            </span>
          </span>
        ))}
      </nav>

      <div className="mt-auto flex items-center justify-between px-2 pt-4 text-sm">
        <span className="truncate text-neutral-400">{userName}</span>
        <button onClick={handleSignOut} className="text-neutral-400 hover:text-neutral-100">
          Sign out
        </button>
      </div>
    </aside>
  );
}
