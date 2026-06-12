// The site switcher's little avatar square (SiteMark) used to be a single hardcoded
// blue→violet gradient for *every* site, so a list of sites was a wall of identical
// purple chips. Derive a distinct gradient per site instead, keyed off a stable string
// (the slug — unique within an org and immutable, unlike the display name).
//
// Pure + deterministic so it's the same on the server and client (no hydration drift)
// and unit-testable. Returns a CSS `linear-gradient(...)` for an inline `background`
// (Tailwind can't generate arbitrary classes from a runtime value).

// FNV-1a over the key → a hue in [0,360). Math.imul keeps it 32-bit; well-spread for
// the short slugs we feed it, so adjacent sites rarely collide on a similar hue.
function hashHue(key: string): number {
  let h = 2166136261;
  for (let i = 0; i < key.length; i++) {
    h ^= key.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return Math.abs(h) % 360;
}

// A diagonal two-stop gradient. Saturation/lightness are tuned to sit on the dark glass
// UI and keep the bold white initial legible across the hue wheel; the second stop is a
// nudged hue + darker for depth (matches the original blue→violet feel, just per-site).
export function siteMarkGradient(key: string): string {
  const hue = hashHue(key);
  const from = `hsl(${hue} 68% 56%)`;
  const to = `hsl(${(hue + 42) % 360} 70% 46%)`;
  return `linear-gradient(135deg, ${from}, ${to})`;
}
