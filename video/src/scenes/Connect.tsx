import { Easing, Interactive, interpolate, useCurrentFrame } from "remotion";
import { Backdrop } from "../components/Backdrop";
import { BrowserFrame } from "../components/BrowserFrame";
import { CodePanel, KEY, PLAIN, PUNC, STR } from "../components/CodePanel";
import { DocsSidebar } from "../components/DocsSidebar";
import { SceneCaption } from "../components/SceneCaption";
import { Stage } from "../components/Stage";
import { body, mono } from "../fonts";

const TREE = [
  "acme/docs",
  "├── docs.json",
  "├── index.mdx",
  "├── guides/",
  "│   ├── quickstart.mdx",
  "│   └── authoring.mdx",
  "└── api-reference/",
  "    └── openapi.yaml",
];

/**
 * The migration beat: a repo of MDX plus a `docs.json` on the left, the rendered site booting
 * on the right. The config types itself in first so the viewer reads the schema before the
 * site exists — the claim is that this exact file is all it takes.
 */
export const Connect: React.FC = () => {
  const frame = useCurrentFrame();

  return (
    <Backdrop>
      <Stage>
        {/* Left column — the source of truth */}
        <div
          style={{
            position: "absolute",
            left: 0,
            top: 0,
            width: 660,
            height: 748,
            display: "flex",
            flexDirection: "column",
            gap: 22,
          }}
        >
          <div
            style={{
              padding: "20px 24px",
              borderRadius: 14,
              border: "1px solid rgba(255,255,255,0.08)",
              backgroundColor: "rgba(255,255,255,0.022)",
              fontFamily: mono,
              fontSize: 19,
              lineHeight: 1.75,
            }}
          >
            {TREE.map((row, index) => (
              <div
                key={row}
                style={{
                  color: index === 1 ? "#a974ff" : index === 0 ? "#ececf1" : "#8a8a99",
                  opacity: interpolate(
                    frame,
                    [10 + index * 5, 24 + index * 5],
                    [0, 1],
                    {
                      extrapolateLeft: "clamp",
                      extrapolateRight: "clamp",
                      easing: Easing.bezier(0.16, 1, 0.3, 1),
                    },
                  ),
                  translate: interpolate(
                    frame,
                    [10 + index * 5, 24 + index * 5],
                    ["-10px 0px", "0px 0px"],
                    {
                      extrapolateLeft: "clamp",
                      extrapolateRight: "clamp",
                      easing: Easing.bezier(0.16, 1, 0.3, 1),
                    },
                  ),
                }}
              >
                {row}
              </div>
            ))}
          </div>

          <CodePanel
            filename="docs.json"
            fontSize={19}
            visibleChars={interpolate(frame, [46, 200], [0, 250], {
              extrapolateLeft: "clamp",
              extrapolateRight: "clamp",
              easing: Easing.linear,
            })}
            lines={[
              [["{", PUNC]],
              [
                ['  "$schema"', KEY],
                [": ", PUNC],
                ['"https://papervine.io/schema.json"', STR],
                [",", PUNC],
              ],
              [
                ['  "name"', KEY],
                [": ", PUNC],
                ['"Acme Docs"', STR],
                [",", PUNC],
              ],
              [
                ['  "colors"', KEY],
                [": { ", PUNC],
                ['"primary"', KEY],
                [": ", PUNC],
                ['"#5b8cff"', STR],
                [" },", PUNC],
              ],
              [
                ['  "navigation"', KEY],
                [": {", PUNC],
              ],
              [
                ['    "groups"', KEY],
                [": [", PUNC],
              ],
              [
                ["      { ", PUNC],
                ['"group"', KEY],
                [": ", PUNC],
                ['"Get started"', STR],
                [",", PUNC],
              ],
              [
                ['        "pages"', KEY],
                [": [", PUNC],
                ['"index"', STR],
                [", ", PUNC],
                ['"quickstart"', STR],
                ["] }", PUNC],
              ],
              [["    ]", PUNC]],
              [["  }", PUNC]],
              [["}", PLAIN]],
            ]}
          />
        </div>

        {/* The connector — a line that draws across the gap, then commits */}
        <div
          style={{
            position: "absolute",
            left: 676,
            top: 372,
            width: 68,
            height: 2,
            borderRadius: 2,
            zIndex: 5,
            transformOrigin: "left center",
            background: "linear-gradient(90deg, #5b8cff, #a974ff)",
            scale: interpolate(frame, [150, 178], ["0 1", "1 1"], {
              extrapolateLeft: "clamp",
              extrapolateRight: "clamp",
              easing: Easing.bezier(0.16, 1, 0.3, 1),
            }),
          }}
        />
        <Interactive.Div
          name="Connected pill"
          style={{
            position: "absolute",
            left: 620,
            top: 302,
            zIndex: 6,
            display: "flex",
            alignItems: "center",
            gap: 10,
            padding: "8px 16px",
            borderRadius: 999,
            border: "1px solid rgba(126,224,184,0.35)",
            backgroundColor: "#0b1712",
            fontFamily: mono,
            fontSize: 19,
            color: "#7ee0b8",
            opacity: interpolate(frame, [176, 196], [0, 1], {
              extrapolateLeft: "clamp",
              extrapolateRight: "clamp",
              easing: Easing.bezier(0.16, 1, 0.3, 1),
            }),
            scale: interpolate(frame, [176, 200], [0.8, 1], {
              extrapolateLeft: "clamp",
              extrapolateRight: "clamp",
              easing: Easing.spring({ damping: 13 }),
              output: "perceptual-scale",
            }),
          }}
        >
          <span
            style={{
              width: 8,
              height: 8,
              borderRadius: 5,
              backgroundColor: "#7ee0b8",
              boxShadow: "0 0 10px 2px rgba(126,224,184,0.7)",
            }}
          />
          connected
        </Interactive.Div>

        {/* Right column — the site it renders */}
        <div
          style={{
            position: "absolute",
            left: 760,
            top: 0,
            width: 968,
            height: 748,
          }}
        >
          <BrowserFrame url="docs.acme.com">
            {/* Boot skeleton, replaced by the real thing */}
            <div
              style={{
                position: "absolute",
                inset: 0,
                display: "flex",
                flexDirection: "column",
                gap: 18,
                padding: 40,
                opacity: interpolate(frame, [186, 200, 226, 244], [0, 1, 1, 0], {
                  extrapolateLeft: "clamp",
                  extrapolateRight: "clamp",
                  easing: [Easing.linear, Easing.linear, Easing.linear],
                }),
              }}
            >
              {[420, 700, 640, 560, 300].map((width, index) => (
                <div
                  key={width}
                  style={{
                    width,
                    height: index === 0 ? 30 : 14,
                    borderRadius: 7,
                    backgroundColor: "rgba(255,255,255,0.055)",
                  }}
                />
              ))}
            </div>

            <div
              style={{
                position: "absolute",
                inset: 0,
                display: "flex",
                opacity: interpolate(frame, [232, 256], [0, 1], {
                  extrapolateLeft: "clamp",
                  extrapolateRight: "clamp",
                  easing: Easing.bezier(0.16, 1, 0.3, 1),
                }),
              }}
            >
              <DocsSidebar
                width={252}
                groups={[
                  {
                    group: "Get started",
                    items: [
                      { label: "Introduction", active: true },
                      { label: "Quickstart" },
                      { label: "Authoring" },
                    ],
                  },
                  {
                    group: "API reference",
                    items: [
                      { label: "Overview" },
                      { label: "Endpoints" },
                    ],
                  },
                ]}
              />
              <div style={{ flex: 1, padding: "34px 40px" }}>
                <div
                  style={{
                    fontFamily: mono,
                    fontSize: 17,
                    letterSpacing: 1,
                    textTransform: "uppercase",
                    backgroundImage: "linear-gradient(90deg, #5b8cff, #a974ff)",
                    WebkitBackgroundClip: "text",
                    backgroundClip: "text",
                    color: "transparent",
                  }}
                >
                  Get started
                </div>
                <div
                  style={{
                    marginTop: 14,
                    fontFamily: body,
                    fontSize: 46,
                    fontWeight: 600,
                    letterSpacing: -1.4,
                    color: "#ececf1",
                  }}
                >
                  Introduction
                </div>
                <div
                  style={{
                    marginTop: 20,
                    maxWidth: 560,
                    fontFamily: body,
                    fontSize: 20,
                    lineHeight: 1.7,
                    color: "#8a8a99",
                  }}
                >
                  Everything you need to integrate Acme in a single afternoon —
                  guides, an API reference generated from our spec, and an
                  assistant that answers from these pages.
                </div>
                <div style={{ marginTop: 28, display: "flex", gap: 16 }}>
                  {["Quickstart", "API reference"].map((card, index) => (
                    <div
                      key={card}
                      style={{
                        flex: 1,
                        padding: "20px 22px",
                        borderRadius: 12,
                        border: "1px solid rgba(255,255,255,0.08)",
                        backgroundColor: "rgba(255,255,255,0.025)",
                        opacity: interpolate(
                          frame,
                          [252 + index * 12, 274 + index * 12],
                          [0, 1],
                          {
                            extrapolateLeft: "clamp",
                            extrapolateRight: "clamp",
                            easing: Easing.bezier(0.16, 1, 0.3, 1),
                          },
                        ),
                        translate: interpolate(
                          frame,
                          [252 + index * 12, 274 + index * 12],
                          ["0px 14px", "0px 0px"],
                          {
                            extrapolateLeft: "clamp",
                            extrapolateRight: "clamp",
                            easing: Easing.bezier(0.16, 1, 0.3, 1),
                          },
                        ),
                      }}
                    >
                      <div
                        style={{
                          fontFamily: body,
                          fontSize: 20,
                          fontWeight: 600,
                          color: "#ececf1",
                        }}
                      >
                        {card}
                      </div>
                      <div
                        style={{
                          marginTop: 8,
                          fontFamily: body,
                          fontSize: 17,
                          lineHeight: 1.6,
                          color: "#8a8a99",
                        }}
                      >
                        Read it in five minutes.
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </BrowserFrame>
        </div>
      </Stage>

      <SceneCaption label="An existing docs.json repository renders unchanged" />
    </Backdrop>
  );
};
