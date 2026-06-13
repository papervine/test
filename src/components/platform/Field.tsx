import { Input } from "@/components/ui/input";

// Labeled text input in the platform theme. A thin composition over the shadcn <Input>
// primitive (quiet `.db-input` fill, violet focus glow) plus a wrapping <label> for
// implicit association. Shared by every auth + app form; spreads native <input> props, so
// it works for controlled inputs (value/onChange) and uncontrolled server-action forms
// (name/defaultValue) alike.
export function Field({
  label,
  hint,
  className = "",
  ...input
}: {
  label: string;
  hint?: React.ReactNode;
} & React.InputHTMLAttributes<HTMLInputElement>) {
  return (
    <label className="block">
      <span className="mb-1 block text-sm font-medium text-[var(--muted)]">
        {label}
      </span>
      <Input className={className} {...input} />
      {hint}
    </label>
  );
}
