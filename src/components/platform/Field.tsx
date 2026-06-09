// Labeled text input in the platform theme — quiet fill, violet focus glow (`.db-input`).
// Shared by every auth + app form. Spreads native <input> props, so it works for both
// controlled inputs (value/onChange) and uncontrolled, server-action forms (name/defaultValue).
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
      <span className="mb-1 block text-sm text-[var(--muted)]">{label}</span>
      <input
        {...input}
        className={`db-input w-full rounded-lg px-3 py-2 text-sm ${className}`}
      />
      {hint}
    </label>
  );
}
