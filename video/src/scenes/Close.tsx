import {
  AbsoluteFill,
  Easing,
  Img,
  Interactive,
  interpolate,
  staticFile,
  useCurrentFrame,
} from "remotion";
import { Backdrop } from "../components/Backdrop";
import { body, display, mono } from "../fonts";

/**
 * The ask. Back to black and back to type — the last thing on screen should be the claim and
 * the domain, with nothing competing for the eye.
 */
export const Close: React.FC = () => {
  const frame = useCurrentFrame();

  return (
    <Backdrop>
      <AbsoluteFill
        name="Close"
        style={{
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          justifyContent: "center",
          gap: 34,
        }}
      >
        <Interactive.Div
          name="Closing bloom"
          style={{
            position: "absolute",
            width: 900,
            height: 900,
            borderRadius: 999,
            background:
              "radial-gradient(circle, rgba(91,140,255,0.22), transparent 62%)",
            opacity: interpolate(frame, [0, 40, 130, 200], [0, 0.9, 0.62, 1], {
              extrapolateLeft: "clamp",
              extrapolateRight: "clamp",
              easing: [Easing.bezier(0.16, 1, 0.3, 1), Easing.linear, Easing.linear],
            }),
          }}
        />

        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 18,
            opacity: interpolate(frame, [0, 20], [0, 1], {
              extrapolateLeft: "clamp",
              extrapolateRight: "clamp",
              easing: Easing.bezier(0.16, 1, 0.3, 1),
            }),
          }}
        >
          <Img
            name="Logo mark"
            src={staticFile("papervine-logo.png")}
            style={{ width: 56, height: 56, borderRadius: 14 }}
          />
          <span
            style={{
              backgroundImage: "linear-gradient(100deg, #5b8cff, #a974ff 72%)",
              WebkitBackgroundClip: "text",
              backgroundClip: "text",
              color: "transparent",
              fontFamily: display,
              fontSize: 50,
              fontWeight: 700,
              letterSpacing: -1.6,
            }}
          >
            Papervine
          </span>
        </div>

        <Interactive.Div
          name="Closing line"
          style={{
            maxWidth: 1300,
            textAlign: "center",
            fontFamily: display,
            fontSize: 88,
            fontWeight: 500,
            lineHeight: 1.1,
            letterSpacing: -3,
            color: "#ececf1",
            opacity: interpolate(frame, [18, 44], [0, 1], {
              extrapolateLeft: "clamp",
              extrapolateRight: "clamp",
              easing: Easing.bezier(0.16, 1, 0.3, 1),
            }),
            translate: interpolate(frame, [18, 48], ["0px 26px", "0px 0px"], {
              extrapolateLeft: "clamp",
              extrapolateRight: "clamp",
              easing: Easing.bezier(0.16, 1, 0.3, 1),
            }),
          }}
        >
          Make your docs a
          <br />
          competitive advantage.
        </Interactive.Div>

        <Interactive.Div
          name="CTA"
          style={{
            marginTop: 12,
            padding: "20px 44px",
            borderRadius: 16,
            background: "linear-gradient(110deg, #5b8cff, #a974ff)",
            boxShadow: "0 20px 50px rgba(91,140,255,0.35)",
            fontFamily: body,
            fontSize: 34,
            fontWeight: 600,
            color: "#ffffff",
            opacity: interpolate(frame, [52, 74], [0, 1], {
              extrapolateLeft: "clamp",
              extrapolateRight: "clamp",
              easing: Easing.bezier(0.16, 1, 0.3, 1),
            }),
            scale: interpolate(frame, [52, 84], [0.92, 1], {
              extrapolateLeft: "clamp",
              extrapolateRight: "clamp",
              easing: Easing.spring({ damping: 14 }),
              output: "perceptual-scale",
            }),
          }}
        >
          papervine.io
        </Interactive.Div>

        <Interactive.Div
          name="Footer line"
          style={{
            marginTop: 8,
            fontFamily: mono,
            fontSize: 24,
            color: "#8a8a99",
            opacity: interpolate(frame, [78, 100], [0, 1], {
              extrapolateLeft: "clamp",
              extrapolateRight: "clamp",
              easing: Easing.bezier(0.16, 1, 0.3, 1),
            }),
          }}
        >
          open source · docs.json-native · free to start
        </Interactive.Div>
      </AbsoluteFill>
    </Backdrop>
  );
};
