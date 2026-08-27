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
import { body, display } from "../fonts";

/**
 * The name, planted between the premise and the demo. The wordmark reveals with a clip-path
 * wipe rather than a fade so it reads as being written, matching the "grows itself" line.
 */
export const Brand: React.FC = () => {
  const frame = useCurrentFrame();

  return (
    <Backdrop>
      <AbsoluteFill
        name="Brand"
        style={{
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          justifyContent: "center",
          gap: 40,
        }}
      >
        <Interactive.Div
          name="Logo bloom"
          style={{
            position: "absolute",
            width: 720,
            height: 720,
            borderRadius: 999,
            background:
              "radial-gradient(circle, rgba(169,116,255,0.30), transparent 62%)",
            opacity: interpolate(frame, [0, 30, 70, 120], [0, 1, 0.72, 0.95], {
              extrapolateLeft: "clamp",
              extrapolateRight: "clamp",
              easing: [
                Easing.bezier(0.16, 1, 0.3, 1),
                Easing.linear,
                Easing.linear,
              ],
            }),
            scale: interpolate(frame, [0, 60], [0.7, 1.08], {
              extrapolateLeft: "clamp",
              extrapolateRight: "clamp",
              easing: Easing.bezier(0.16, 1, 0.3, 1),
              output: "perceptual-scale",
            }),
          }}
        />

        <div style={{ display: "flex", alignItems: "center", gap: 34 }}>
          <Img
            name="Logo mark"
            src={staticFile("papervine-logo.png")}
            style={{
              width: 132,
              height: 132,
              borderRadius: 30,
              scale: interpolate(frame, [0, 26], [0.55, 1], {
                extrapolateLeft: "clamp",
                extrapolateRight: "clamp",
                easing: Easing.spring({ damping: 14 }),
                output: "perceptual-scale",
              }),
              opacity: interpolate(frame, [0, 12], [0, 1], {
                extrapolateLeft: "clamp",
                extrapolateRight: "clamp",
                easing: Easing.bezier(0.16, 1, 0.3, 1),
              }),
            }}
          />
          <Interactive.Div
            name="Wordmark"
            style={{
              backgroundImage: "linear-gradient(100deg, #5b8cff, #a974ff 72%)",
              WebkitBackgroundClip: "text",
              backgroundClip: "text",
              color: "transparent",
              fontFamily: display,
              fontSize: 116,
              fontWeight: 700,
              letterSpacing: -4,
              // interpolate() takes at most three string components, so the wipe edge is
              // interpolated as a number and the inset() assembled around it.
              clipPath: `inset(-20% ${interpolate(frame, [14, 46], [100, 0], {
                extrapolateLeft: "clamp",
                extrapolateRight: "clamp",
                easing: Easing.bezier(0.16, 1, 0.3, 1),
              })}% -20% 0%)`,
            }}
          >
            Papervine
          </Interactive.Div>
        </div>

        <Interactive.Div
          name="Tagline"
          style={{
            fontFamily: body,
            fontSize: 46,
            fontWeight: 400,
            letterSpacing: -1,
            color: "#8a8a99",
            opacity: interpolate(frame, [46, 68], [0, 1], {
              extrapolateLeft: "clamp",
              extrapolateRight: "clamp",
              easing: Easing.bezier(0.16, 1, 0.3, 1),
            }),
            translate: interpolate(frame, [46, 68], ["0px 16px", "0px 0px"], {
              extrapolateLeft: "clamp",
              extrapolateRight: "clamp",
              easing: Easing.bezier(0.16, 1, 0.3, 1),
            }),
          }}
        >
          Documentation that grows itself.
        </Interactive.Div>
      </AbsoluteFill>
    </Backdrop>
  );
};
