import { AbsoluteFill } from "remotion";

/**
 * The stage every scene sits on: the product's own `--bg` (#060609) with the blue/violet
 * bloom the marketing shell uses, plus a faint grid so motion has something to read against.
 */
export const Backdrop: React.FC<{ children?: React.ReactNode }> = ({
  children,
}) => {
  return (
    <AbsoluteFill name="Backdrop" style={{ backgroundColor: "#060609" }}>
      <AbsoluteFill
        name="Grid"
        style={{
          opacity: 0.4,
          backgroundImage:
            "linear-gradient(rgba(255,255,255,0.028) 1px, transparent 1px), linear-gradient(90deg, rgba(255,255,255,0.028) 1px, transparent 1px)",
          backgroundSize: "72px 72px",
        }}
      />
      <AbsoluteFill
        name="Violet bloom"
        style={{
          background:
            "radial-gradient(58% 44% at 78% 8%, rgba(169,116,255,0.20), transparent 68%)",
        }}
      />
      <AbsoluteFill
        name="Blue bloom"
        style={{
          background:
            "radial-gradient(62% 50% at 14% 96%, rgba(91,140,255,0.16), transparent 70%)",
        }}
      />
      {children}
    </AbsoluteFill>
  );
};
