import { Easing, Interactive, interpolate, useCurrentFrame } from "remotion";
import { Backdrop } from "../components/Backdrop";
import { BrowserFrame } from "../components/BrowserFrame";
import { SceneCaption } from "../components/SceneCaption";
import { Stage } from "../components/Stage";
import { typed } from "../lib/typing";
import { body, mono } from "../fonts";

const FILES = [
  ["docs.json", 0],
  ["index.mdx", 0],
  ["guides/", 0],
  ["quickstart.mdx", 1],
  ["rate-limits.mdx", 1],
  ["api-reference/", 0],
  ["openapi.yaml", 1],
];

/**
 * The browser editor: file tree, document, agent panel. Three claims share this scene —
 * live collaboration (two labelled remote carets), an editing agent that drafts with the docs
 * as context, and publishing as either a commit or a pull request.
 */
export const Editor: React.FC = () => {
  const frame = useCurrentFrame();

  return (
    <Backdrop>
      <Stage>
        <BrowserFrame url="app.papervine.io/acme/docs · editor">
          <div style={{ position: "absolute", inset: 0, display: "flex", flexDirection: "column" }}>
            {/* Editor toolbar */}
            <div
              style={{
                display: "flex",
                alignItems: "center",
                gap: 14,
                flexShrink: 0,
                padding: "0 22px",
                height: 62,
                borderBottom: "1px solid rgba(255,255,255,0.06)",
              }}
            >
              <span style={{ fontFamily: mono, fontSize: 17, color: "#8a8a99" }}>
                guides / rate-limits.mdx
              </span>
              <span
                style={{
                  padding: "3px 9px",
                  borderRadius: 6,
                  fontFamily: mono,
                  fontSize: 14,
                  color: "#ffb86b",
                  backgroundColor: "rgba(255,184,107,0.12)",
                }}
              >
                draft
              </span>

              <div style={{ marginLeft: "auto", display: "flex", alignItems: "center", gap: 10 }}>
                <div
                  style={{
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    width: 34,
                    height: 34,
                    borderRadius: 999,
                    border: "2px solid #0a0a12",
                    backgroundColor: "#5b8cff",
                    fontFamily: body,
                    fontSize: 15,
                    fontWeight: 600,
                    color: "#0a0a12",
                  }}
                >
                  D
                </div>
                <div
                  style={{
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    width: 34,
                    height: 34,
                    borderRadius: 999,
                    marginLeft: -18,
                    border: "2px solid #0a0a12",
                    backgroundColor: "#7ee0b8",
                    fontFamily: body,
                    fontSize: 15,
                    fontWeight: 600,
                    color: "#0a0a12",
                  }}
                >
                  S
                </div>
                <Interactive.Div
                  name="Publish button"
                  style={{
                    marginLeft: 12,
                    padding: "9px 20px",
                    borderRadius: 10,
                    background: "linear-gradient(110deg, #5b8cff, #a974ff)",
                    fontFamily: body,
                    fontSize: 18,
                    fontWeight: 600,
                    color: "#ffffff",
                    scale: interpolate(frame, [316, 324, 334], [1, 0.96, 1], {
                      extrapolateLeft: "clamp",
                      extrapolateRight: "clamp",
                      easing: [Easing.bezier(0.4, 0, 1, 1), Easing.bezier(0, 0, 0.2, 1)],
                      output: "perceptual-scale",
                    }),
                  }}
                >
                  Publish
                </Interactive.Div>
              </div>
            </div>

            <div style={{ flex: 1, display: "flex", minHeight: 0 }}>
              {/* File tree */}
              <div
                style={{
                  width: 248,
                  flexShrink: 0,
                  padding: "20px 18px",
                  borderRight: "1px solid rgba(255,255,255,0.06)",
                }}
              >
                {FILES.map(([name, depth], index) => (
                  <div
                    key={String(name)}
                    style={{
                      padding: "8px 10px",
                      paddingLeft: 10 + Number(depth) * 18,
                      borderRadius: 8,
                      fontFamily: mono,
                      fontSize: 17,
                      color: name === "rate-limits.mdx" ? "#ececf1" : "#8a8a99",
                      backgroundColor:
                        name === "rate-limits.mdx"
                          ? "rgba(91,140,255,0.10)"
                          : "transparent",
                      opacity: interpolate(
                        frame,
                        [12 + index * 4, 28 + index * 4],
                        [0, 1],
                        {
                          extrapolateLeft: "clamp",
                          extrapolateRight: "clamp",
                          easing: Easing.bezier(0.16, 1, 0.3, 1),
                        },
                      ),
                    }}
                  >
                    {name}
                  </div>
                ))}
              </div>

              {/* Document */}
              <div style={{ flex: 1, position: "relative", padding: "34px 40px" }}>
                <div
                  style={{
                    fontFamily: body,
                    fontSize: 44,
                    fontWeight: 600,
                    letterSpacing: -1.4,
                    color: "#ececf1",
                  }}
                >
                  Rate limits
                </div>
                <div
                  style={{
                    marginTop: 20,
                    maxWidth: 620,
                    fontFamily: body,
                    fontSize: 20,
                    lineHeight: 1.75,
                    color: "#a8a8b6",
                  }}
                >
                  Every API token is metered per minute. Reads and writes share
                  one budget, and the ceiling is the same on every plan.
                </div>

                {/* The block the agent drafts */}
                <div
                  style={{
                    marginTop: 26,
                    maxWidth: 620,
                    padding: "18px 20px",
                    borderRadius: 12,
                    borderLeft: "3px solid #7ee0b8",
                    backgroundColor: "rgba(126,224,184,0.07)",
                    opacity: interpolate(frame, [238, 268], [0, 1], {
                      extrapolateLeft: "clamp",
                      extrapolateRight: "clamp",
                      easing: Easing.bezier(0.16, 1, 0.3, 1),
                    }),
                    translate: interpolate(frame, [238, 272], ["0px 16px", "0px 0px"], {
                      extrapolateLeft: "clamp",
                      extrapolateRight: "clamp",
                      easing: Easing.bezier(0.16, 1, 0.3, 1),
                    }),
                  }}
                >
                  <div
                    style={{
                      fontFamily: mono,
                      fontSize: 15,
                      letterSpacing: 1,
                      textTransform: "uppercase",
                      color: "#7ee0b8",
                    }}
                  >
                    Note
                  </div>
                  <div
                    style={{
                      marginTop: 8,
                      fontFamily: body,
                      fontSize: 20,
                      lineHeight: 1.7,
                      color: "#ececf1",
                    }}
                  >
                    Sustained traffic above 1,000 requests per minute returns
                    <span style={{ fontFamily: mono, color: "#ffb86b" }}> 429 </span>
                    with a <span style={{ fontFamily: mono }}>Retry-After</span> header.
                  </div>
                </div>

                <div
                  style={{
                    marginTop: 26,
                    maxWidth: 620,
                    fontFamily: body,
                    fontSize: 20,
                    lineHeight: 1.75,
                    color: "#a8a8b6",
                  }}
                >
                  Batch endpoints count as a single request, so prefer them when
                  backfilling.
                </div>

                {/* Remote carets — two other people, live in the same document */}
                <Interactive.Div
                  name="Caret · Dana"
                  style={{
                    position: "absolute",
                    left: 40,
                    top: 116,
                    display: "flex",
                    flexDirection: "column",
                    gap: 0,
                    translate: interpolate(
                      frame,
                      [40, 120, 200, 300],
                      ["320px 0px", "520px 0px", "180px 34px", "440px 34px"],
                      {
                        extrapolateLeft: "clamp",
                        extrapolateRight: "clamp",
                        easing: [
                          Easing.bezier(0.5, 0, 0.5, 1),
                          Easing.bezier(0.5, 0, 0.5, 1),
                          Easing.bezier(0.5, 0, 0.5, 1),
                        ],
                      },
                    ),
                  }}
                >
                  <span
                    style={{
                      alignSelf: "flex-start",
                      padding: "2px 8px",
                      borderRadius: 5,
                      backgroundColor: "#5b8cff",
                      fontFamily: body,
                      fontSize: 14,
                      fontWeight: 600,
                      color: "#0a0a12",
                    }}
                  >
                    Dana
                  </span>
                  <span
                    style={{ width: 2, height: 30, backgroundColor: "#5b8cff" }}
                  />
                </Interactive.Div>

                <Interactive.Div
                  name="Caret · Sam"
                  style={{
                    position: "absolute",
                    left: 40,
                    top: 186,
                    display: "flex",
                    flexDirection: "column",
                    translate: interpolate(
                      frame,
                      [60, 160, 260, 340],
                      ["120px 0px", "300px 0px", "460px 32px", "240px 0px"],
                      {
                        extrapolateLeft: "clamp",
                        extrapolateRight: "clamp",
                        easing: [
                          Easing.bezier(0.5, 0, 0.5, 1),
                          Easing.bezier(0.5, 0, 0.5, 1),
                          Easing.bezier(0.5, 0, 0.5, 1),
                        ],
                      },
                    ),
                  }}
                >
                  <span
                    style={{
                      alignSelf: "flex-start",
                      padding: "2px 8px",
                      borderRadius: 5,
                      backgroundColor: "#7ee0b8",
                      fontFamily: body,
                      fontSize: 14,
                      fontWeight: 600,
                      color: "#0a0a12",
                    }}
                  >
                    Sam
                  </span>
                  <span
                    style={{ width: 2, height: 30, backgroundColor: "#7ee0b8" }}
                  />
                </Interactive.Div>
              </div>

              {/* Agent panel */}
              <div
                style={{
                  width: 424,
                  flexShrink: 0,
                  display: "flex",
                  flexDirection: "column",
                  borderLeft: "1px solid rgba(255,255,255,0.06)",
                  backgroundColor: "rgba(255,255,255,0.015)",
                }}
              >
                <div
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: 10,
                    padding: "18px 20px",
                    borderBottom: "1px solid rgba(255,255,255,0.06)",
                  }}
                >
                  <span
                    style={{
                      width: 26,
                      height: 26,
                      borderRadius: 8,
                      background: "linear-gradient(140deg, #5b8cff, #a974ff)",
                    }}
                  />
                  <span
                    style={{
                      fontFamily: body,
                      fontSize: 19,
                      fontWeight: 600,
                      color: "#ececf1",
                    }}
                  >
                    Editing agent
                  </span>
                </div>

                <div style={{ flex: 1, padding: 20, display: "flex", flexDirection: "column", gap: 16 }}>
                  <div
                    style={{
                      alignSelf: "flex-end",
                      maxWidth: 320,
                      padding: "13px 16px",
                      borderRadius: 14,
                      backgroundColor: "rgba(91,140,255,0.14)",
                      fontFamily: body,
                      fontSize: 18,
                      lineHeight: 1.6,
                      color: "#ececf1",
                    }}
                  >
                    {typed("Add a note about the rate limit ceiling.", frame, 70, 3)}
                  </div>

                  <div
                    style={{
                      maxWidth: 340,
                      padding: "13px 16px",
                      borderRadius: 14,
                      border: "1px solid rgba(255,255,255,0.08)",
                      backgroundColor: "rgba(255,255,255,0.03)",
                      fontFamily: body,
                      fontSize: 18,
                      lineHeight: 1.6,
                      color: "#a8a8b6",
                      opacity: interpolate(frame, [196, 214], [0, 1], {
                        extrapolateLeft: "clamp",
                        extrapolateRight: "clamp",
                        easing: Easing.bezier(0.16, 1, 0.3, 1),
                      }),
                    }}
                  >
                    {typed(
                      "Added a Note under Rate limits — 1,000 req/min, 429 with Retry-After. Pulled the ceiling from openapi.yaml.",
                      frame,
                      206,
                      1,
                    )}
                  </div>
                </div>

                <div
                  style={{
                    margin: 20,
                    padding: "13px 16px",
                    borderRadius: 12,
                    border: "1px solid rgba(255,255,255,0.08)",
                    fontFamily: body,
                    fontSize: 17,
                    color: "#6b6b7b",
                  }}
                >
                  Ask for an edit…
                </div>
              </div>
            </div>
          </div>

          {/* Publish menu */}
          <div
            style={{
              position: "absolute",
              right: 22,
              top: 70,
              width: 330,
              padding: 8,
              borderRadius: 14,
              border: "1px solid rgba(255,255,255,0.12)",
              backgroundColor: "#12121c",
              boxShadow: "0 30px 70px rgba(0,0,0,0.6)",
              opacity: interpolate(frame, [328, 344], [0, 1], {
                extrapolateLeft: "clamp",
                extrapolateRight: "clamp",
                easing: Easing.bezier(0.16, 1, 0.3, 1),
              }),
              scale: interpolate(frame, [328, 350], [0.94, 1], {
                extrapolateLeft: "clamp",
                extrapolateRight: "clamp",
                easing: Easing.spring({ damping: 15 }),
                output: "perceptual-scale",
              }),
            }}
          >
            {[
              ["Commit to main", "Live in seconds"],
              ["Open a pull request", "Review it like code"],
            ].map((option, index) => (
              <div
                key={option[0]}
                style={{
                  padding: "14px 14px",
                  borderRadius: 10,
                  backgroundColor:
                    index === 1 ? "rgba(91,140,255,0.10)" : "transparent",
                }}
              >
                <div
                  style={{
                    fontFamily: body,
                    fontSize: 19,
                    fontWeight: 600,
                    color: "#ececf1",
                  }}
                >
                  {option[0]}
                </div>
                <div
                  style={{
                    marginTop: 4,
                    fontFamily: body,
                    fontSize: 16,
                    color: "#8a8a99",
                  }}
                >
                  {option[1]}
                </div>
              </div>
            ))}
          </div>
        </BrowserFrame>
      </Stage>

      <SceneCaption label="Browser editing, live collaboration, and an editing agent" />
    </Backdrop>
  );
};
