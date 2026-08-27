import { Easing, interpolate, useCurrentFrame } from "remotion";

/**
 * The fixed rectangle every product shot lives in: 1728×748 inset from the top-left, which
 * leaves the bottom strip clear for <SceneCaption>. Keeping the box identical across scenes
 * is what makes the cuts feel like one continuous product rather than twelve slides.
 *
 * It also carries the shared entrance — a small rise and scale-up on the first 20 frames.
 */
export const Stage: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const frame = useCurrentFrame();

  return (
    <div
      style={{
        position: "absolute",
        left: 96,
        top: 88,
        width: 1728,
        height: 748,
        opacity: interpolate(frame, [0, 16], [0, 1], {
          extrapolateLeft: "clamp",
          extrapolateRight: "clamp",
          easing: Easing.bezier(0.16, 1, 0.3, 1),
        }),
        scale: interpolate(frame, [0, 22], [0.972, 1], {
          extrapolateLeft: "clamp",
          extrapolateRight: "clamp",
          easing: Easing.bezier(0.16, 1, 0.3, 1),
          output: "perceptual-scale",
        }),
        translate: interpolate(frame, [0, 22], ["0px 22px", "0px 0px"], {
          extrapolateLeft: "clamp",
          extrapolateRight: "clamp",
          easing: Easing.bezier(0.16, 1, 0.3, 1),
        }),
      }}
    >
      {children}
    </div>
  );
};
