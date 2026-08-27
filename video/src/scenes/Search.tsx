import { AbsoluteFill, Easing, Interactive, interpolate, useCurrentFrame } from "remotion";
import { Backdrop } from "../components/Backdrop";
import { BrowserFrame } from "../components/BrowserFrame";
import { DocsSidebar } from "../components/DocsSidebar";
import { SceneCaption } from "../components/SceneCaption";
import { Stage } from "../components/Stage";
import { typed } from "../lib/typing";
import { body, mono } from "../fonts";

const RESULTS = [
  { kind: "page", pre: "", hit: "Reader auth", post: "entication", where: "Reader access" },
  { kind: "heading", pre: "Gating a page to a ", hit: "reader", post: " group", where: "Reader authentication" },
  { kind: "code", pre: "groups: [", hit: "\"staff\"", post: "]", where: "Reader authentication" },
  { kind: "page", pre: "Platform ", hit: "auth", post: "entication", where: "Auth & access" },
];

/**
 * ⌘K over the site: the page recedes behind a blur, the palette springs in, and results land
 * as the query lands. Pages, headings and code blocks are all in the index, so the result list
 * deliberately shows one of each.
 */
export const Search: React.FC = () => {
  const frame = useCurrentFrame();

  return (
    <Backdrop>
      <Stage>
        <BrowserFrame url="docs.acme.com/reader-auth">
          {/* The page underneath, pushed back as the palette takes over */}
          <div
            style={{
              position: "absolute",
              inset: 0,
              display: "flex",
              // `blur(…)` is not a numeric string to interpolate() — the radius is interpolated
              // and the filter assembled around it.
              filter: `blur(${interpolate(frame, [18, 44], [0, 7], {
                extrapolateLeft: "clamp",
                extrapolateRight: "clamp",
                easing: Easing.bezier(0.16, 1, 0.3, 1),
              })}px)`,
              opacity: interpolate(frame, [18, 44], [1, 0.45], {
                extrapolateLeft: "clamp",
                extrapolateRight: "clamp",
                easing: Easing.bezier(0.16, 1, 0.3, 1),
              }),
            }}
          >
            <DocsSidebar
              width={300}
              groups={[
                {
                  group: "Reader access",
                  items: [
                    { label: "Reader authentication", active: true },
                    { label: "Groups & frontmatter" },
                  ],
                },
                {
                  group: "Search & AI",
                  items: [{ label: "Search" }, { label: "AI assistant" }],
                },
              ]}
            />
            <div style={{ flex: 1, padding: "40px 56px" }}>
              <div
                style={{
                  fontFamily: body,
                  fontSize: 54,
                  fontWeight: 600,
                  letterSpacing: -1.8,
                  color: "#ececf1",
                }}
              >
                Reader authentication
              </div>
              {[720, 660, 700, 480, 640, 712, 590, 668, 430, 700, 520].map((width, index) => (
                <div
                  key={width}
                  style={{
                    width,
                    height: 14,
                    marginTop: index === 0 ? 28 : 16,
                    borderRadius: 7,
                    backgroundColor: "rgba(255,255,255,0.07)",
                  }}
                />
              ))}
            </div>
          </div>

          <AbsoluteFill
            name="Scrim"
            style={{
              backgroundColor: "rgba(6,6,9,0.55)",
              opacity: interpolate(frame, [18, 44], [0, 1], {
                extrapolateLeft: "clamp",
                extrapolateRight: "clamp",
                easing: Easing.bezier(0.16, 1, 0.3, 1),
              }),
            }}
          />

          {/* The palette */}
          <Interactive.Div
            name="Search palette"
            style={{
              position: "absolute",
              left: 374,
              top: 128,
              width: 980,
              borderRadius: 18,
              overflow: "hidden",
              border: "1px solid rgba(255,255,255,0.12)",
              backgroundColor: "#0d0d16",
              boxShadow: "0 40px 100px rgba(0,0,0,0.6)",
              opacity: interpolate(frame, [20, 40], [0, 1], {
                extrapolateLeft: "clamp",
                extrapolateRight: "clamp",
                easing: Easing.bezier(0.16, 1, 0.3, 1),
              }),
              scale: interpolate(frame, [20, 48], [0.94, 1], {
                extrapolateLeft: "clamp",
                extrapolateRight: "clamp",
                easing: Easing.spring({ damping: 15 }),
                output: "perceptual-scale",
              }),
              translate: interpolate(frame, [20, 48], ["0px -18px", "0px 0px"], {
                extrapolateLeft: "clamp",
                extrapolateRight: "clamp",
                easing: Easing.bezier(0.16, 1, 0.3, 1),
              }),
            }}
          >
            <div
              style={{
                display: "flex",
                alignItems: "center",
                gap: 16,
                padding: "22px 26px",
                borderBottom: "1px solid rgba(255,255,255,0.08)",
              }}
            >
              <span style={{ fontFamily: mono, fontSize: 24, color: "#5b8cff" }}>
                ⌘K
              </span>
              <span
                style={{
                  fontFamily: body,
                  fontSize: 28,
                  color: "#ececf1",
                }}
              >
                {typed("reader auth", frame, 52, 5)}
              </span>
              <span
                style={{
                  width: 2,
                  height: 28,
                  backgroundColor: "#5b8cff",
                  opacity: interpolate(frame % 24, [0, 11, 12, 23], [1, 1, 0, 0], {
                    extrapolateLeft: "clamp",
                    extrapolateRight: "clamp",
                    easing: [Easing.step0, Easing.step0, Easing.step0],
                  }),
                }}
              />
            </div>

            <div style={{ padding: "12px 12px 8px" }}>
              {RESULTS.map((result, index) => (
                <div
                  key={result.where + result.hit}
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: 16,
                    padding: "16px 18px",
                    borderRadius: 12,
                    backgroundColor:
                      index === 0 ? "rgba(91,140,255,0.10)" : "transparent",
                    opacity: interpolate(
                      frame,
                      [62 + index * 11, 82 + index * 11],
                      [0, 1],
                      {
                        extrapolateLeft: "clamp",
                        extrapolateRight: "clamp",
                        easing: Easing.bezier(0.16, 1, 0.3, 1),
                      },
                    ),
                    translate: interpolate(
                      frame,
                      [62 + index * 11, 82 + index * 11],
                      ["0px 12px", "0px 0px"],
                      {
                        extrapolateLeft: "clamp",
                        extrapolateRight: "clamp",
                        easing: Easing.bezier(0.16, 1, 0.3, 1),
                      },
                    ),
                  }}
                >
                  <span
                    style={{
                      flexShrink: 0,
                      width: 74,
                      fontFamily: mono,
                      fontSize: 14,
                      letterSpacing: 0.6,
                      textTransform: "uppercase",
                      color: "#6b6b7b",
                    }}
                  >
                    {result.kind}
                  </span>
                  <span
                    style={{
                      flex: 1,
                      fontFamily: result.kind === "code" ? mono : body,
                      fontSize: 23,
                      color: "#ececf1",
                    }}
                  >
                    {result.pre}
                    <span
                      style={{
                        color: "#5b8cff",
                        backgroundColor: "rgba(91,140,255,0.14)",
                        borderRadius: 4,
                      }}
                    >
                      {result.hit}
                    </span>
                    {result.post}
                  </span>
                  <span
                    style={{ fontFamily: body, fontSize: 18, color: "#6b6b7b" }}
                  >
                    {result.where}
                  </span>
                </div>
              ))}
            </div>

            <div
              style={{
                display: "flex",
                gap: 24,
                padding: "14px 26px",
                borderTop: "1px solid rgba(255,255,255,0.08)",
                fontFamily: mono,
                fontSize: 16,
                color: "#6b6b7b",
              }}
            >
              <span>↑↓ navigate</span>
              <span>↵ open</span>
              <span>esc close</span>
              <span style={{ marginLeft: "auto", color: "#7ee0b8" }}>
                re-indexed on every sync
              </span>
            </div>
          </Interactive.Div>
        </BrowserFrame>
      </Stage>

      <SceneCaption label="⌘K across every page, heading, and code block" />
    </Backdrop>
  );
};
