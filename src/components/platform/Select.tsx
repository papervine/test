import { ChevronsUpDown } from "lucide-react";

// Styled native <select> in the platform theme — a quiet `.db-input` fill with our own
// chevron (appearance-none drops the OS arrow) and an optional leading icon overlaid in
// the trigger (native <option>s can't render icons, so the icon lives on the control).
// Native on purpose: keyboard + a11y for free, and it matches the Git settings dropdowns.
export function Select({
  icon,
  className = "",
  children,
  ...props
}: {
  icon?: React.ReactNode;
} & React.SelectHTMLAttributes<HTMLSelectElement>) {
  return (
    <div className="relative">
      {icon && (
        <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-[var(--muted)]">
          {icon}
        </span>
      )}
      <select
        {...props}
        className={`db-input w-full appearance-none rounded-lg py-2.5 pr-9 text-sm [&>option]:bg-[#16161c] [&>option]:text-[var(--fg)] ${
          icon ? "pl-9" : "pl-3"
        } ${className}`}
      >
        {children}
      </select>
      <ChevronsUpDown className="pointer-events-none absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 text-[var(--muted)]" />
    </div>
  );
}
