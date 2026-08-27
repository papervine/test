import { AbsoluteFill, Easing, Interactive, interpolate, useCurrentFrame } from "remotion";
import { Backdrop } from "../components/Backdrop";
import { body, display, mono } from "../fonts";

/**
 * The premise, before any product appears: docs now have a second audience. Pure typography
 * so the first five seconds carry an argument rather than a UI tour.
 */
export const ColdOpen: React.FC = () => {
  const frame = useCurrentFrame();

  return (
    <Backdrop>
      <AbsoluteFill
        name="Cold open"
        style={{
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          justifyContent: "center",
          gap: 44,
        }}
      >
        <Interactive.Div
          name="Kicker"
          style={{
            display: "flex",
            alignItems: "center",
            gap: 12,
            padding: "8px 18px",
            borderRadius: 999,
            border: "1px solid rgba(255,255,255,0.10)",
            fontFamily: mono,
            fontSize: 22,
            color: "#8a8a99",
            opacity: interpolate(frame, [0, 18], [0, 1], {
              extrapolateLeft: "clamp",
              extrapolateRight: "clamp",
              easing: Easing.bezier(0.16, 1, 0.3, 1),
            }),
          }}
        >
          <span
            style={{
              width: 9,
              height: 9,
              borderRadius: 6,
              backgroundColor: "#5b8cff",
              boxShadow: "0 0 12px 3px rgba(91,140,255,0.7)",
            }}
          />
          papervine.io
        </Interactive.Div>

        <Interactive.Div
          name="Premise"
          style={{
            maxWidth: 1420,
            textAlign: "center",
            fontFamily: display,
            fontSize: 104,
            fontWeight: 500,
            lineHeight: 1.06,
            letterSpacing: -3.5,
            color: "#ececf1",
            opacity: interpolate(frame, [6, 30], [0, 1], {
              extrapolateLeft: "clamp",
              extrapolateRight: "clamp",
              easing: Easing.bezier(0.16, 1, 0.3, 1),
            }),
            translate: interpolate(frame, [6, 34], ["0px 30px", "0px 0px"], {
              extrapolateLeft: "clamp",
              extrapolateRight: "clamp",
              easing: Easing.bezier(0.16, 1, 0.3, 1),
            }),
          }}
        >
          Your docs have two
          <br />
          audiences now.
        </Interactive.Div>

        <div style={{ display: "flex", alignItems: "baseline", gap: 26 }}>
          <Interactive.Div
            name="Audience one"
            style={{
              fontFamily: body,
              fontSize: 48,
              fontWeight: 500,
              letterSpacing: -1.2,
              color: "#8a8a99",
              opacity: interpolate(frame, [44, 62], [0, 1], {
                extrapolateLeft: "clamp",
                extrapolateRight: "clamp",
                easing: Easing.bezier(0.16, 1, 0.3, 1),
              }),
              translate: interpolate(frame, [44, 62], ["0px 14px", "0px 0px"], {
                extrapolateLeft: "clamp",
                extrapolateRight: "clamp",
                easing: Easing.bezier(0.16, 1, 0.3, 1),
              }),
            }}
          >
            Your users —
          </Interactive.Div>
          <Interactive.Div
            name="Audience two"
            style={{
              backgroundImage: "linear-gradient(100deg, #5b8cff, #a974ff 72%)",
              WebkitBackgroundClip: "text",
              backgroundClip: "text",
              color: "transparent",
              fontFamily: body,
              fontSize: 48,
              fontWeight: 600,
              letterSpacing: -1.2,
              opacity: interpolate(frame, [70, 90], [0, 1], {
                extrapolateLeft: "clamp",
                extrapolateRight: "clamp",
                easing: Easing.bezier(0.16, 1, 0.3, 1),
              }),
              translate: interpolate(frame, [70, 90], ["0px 14px", "0px 0px"], {
                extrapolateLeft: "clamp",
                extrapolateRight: "clamp",
                easing: Easing.bezier(0.16, 1, 0.3, 1),
              }),
            }}
          >
            and the agents they ask instead.
          </Interactive.Div>
        </div>
      </AbsoluteFill>
    </Backdrop>
  );
};
