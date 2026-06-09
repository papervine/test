// The Papervine wordmark: the brand display font (Space Grotesk via --font-brand)
// with the blue→violet gradient fill that the old "D" logomark used to carry.
// Sized by the caller via `className` (e.g. `text-lg`); defaults to inheriting.
export function Wordmark({ className = "" }: { className?: string }) {
  return (
    <span
      className={`font-brand bg-gradient-to-r from-[var(--blue)] to-[var(--violet)] bg-clip-text font-semibold tracking-tight text-transparent ${className}`}
    >
      Papervine
    </span>
  );
}
