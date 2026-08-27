import { Easing, Interactive, interpolate, useCurrentFrame } from "remotion";
import { body } from "../fonts";

/**
 * The label in the lower band: one quiet line naming what the shot shows.
 *
 * Deliberately not a headline. An earlier version stacked a 46px marketing line over a mono
 * list of feature words, which competed with the product for attention and read as an ad. The
 * UI is the argument here — the label only has to tell a muted viewer what they're looking at,
 * so it sits at body scale in a muted tone with no rule, gradient or eyebrow.
 *
 * Optically centred in the 244px band below <Stage>, on the same 96px left margin as the shot.
 */
export const SceneCaption: React.FC<{ label: string }> = ({ label }) => {
  const frame = useCurrentFrame();

  return (
    <Interactive.Div
      name="Scene label"
      style={{
        position: "absolute",
        left: 96,
        bottom: 96,
        maxWidth: 1300,
        fontFamily: body,
        fontSize: 36,
        fontWeight: 400,
        letterSpacing: -0.5,
        color: "#b0b0bd",
        opacity: interpolate(frame, [10, 30], [0, 1], {
          extrapolateLeft: "clamp",
          extrapolateRight: "clamp",
          easing: Easing.bezier(0.16, 1, 0.3, 1),
        }),
        translate: interpolate(frame, [10, 30], ["0px 10px", "0px 0px"], {
          extrapolateLeft: "clamp",
          extrapolateRight: "clamp",
          easing: Easing.bezier(0.16, 1, 0.3, 1),
        }),
      }}
    >
      {label}
    </Interactive.Div>
  );
};
