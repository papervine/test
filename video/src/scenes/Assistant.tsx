import { Easing, Interactive, interpolate, useCurrentFrame } from "remotion";
import { Backdrop } from "../components/Backdrop";
import { BrowserFrame } from "../components/BrowserFrame";
import { CodePanel, PLAIN, PUNC, STR, TAG } from "../components/CodePanel";
import { DocsSidebar } from "../components/DocsSidebar";
import { SceneCaption } from "../components/SceneCaption";
import { Stage } from "../components/Stage";
import { typed } from "../lib/typing";
import { body, mono } from "../fonts";

/**
 * Two panes on one horizontal track: the assistant answering inside the docs site, then a
 * slide to a *customer's* product — deliberately light, so it reads as somebody else's app —
 * where the same assistant is installed with one script tag.
 */
export const Assistant: React.FC = () => {
  const frame = useCurrentFrame();

  return (
    <Backdrop>
      <Stage>
      <div
        style={{
          position: "absolute",
          left: 0,
          top: 0,
          width: 1728,
          height: 748,
          overflow: "hidden",
        }}
      >
        <div
          style={{
            position: "absolute",
            left: 0,
            top: 0,
            width: 3536,
            height: 748,
            display: "flex",
            gap: 80,
            translate: interpolate(frame, [198, 244], ["0px 0px", "-1808px 0px"], {
              extrapolateLeft: "clamp",
              extrapolateRight: "clamp",
              easing: Easing.bezier(0.65, 0, 0.35, 1),
            }),
          }}
        >
          {/* Pane one — the assistant on the docs site */}
          <div style={{ width: 1728, height: 748, flexShrink: 0 }}>
            <BrowserFrame url="docs.acme.com/reader-auth">
              <div style={{ position: "absolute", inset: 0, display: "flex" }}>
                <DocsSidebar
                  width={272}
                  groups={[
                    {
                      group: "Reader access",
                      items: [
                        { label: "Reader authentication", active: true },
                        { label: "Groups" },
                        { label: "Your IdP" },
                      ],
                    },
                    {
                      group: "Search & AI",
                      items: [
                        { label: "Search" },
                        { label: "AI assistant" },
                        { label: "The widget" },
                      ],
                    },
                  ]}
                />
                <div style={{ flex: 1, padding: "36px 44px" }}>
                  <div
                    style={{
                      fontFamily: body,
                      fontSize: 46,
                      fontWeight: 600,
                      letterSpacing: -1.5,
                      color: "#ececf1",
                    }}
                  >
                    Reader authentication
                  </div>
                  {[560, 610, 520, 580, 400, 540, 596, 480, 350].map((width, index) => (
                    <div
                      key={width}
                      style={{
                        width,
                        height: 13,
                        marginTop: index === 0 ? 26 : 15,
                        borderRadius: 7,
                        backgroundColor: "rgba(255,255,255,0.06)",
                      }}
                    />
                  ))}
                </div>

                {/* Assistant drawer */}
                <div
                  style={{
                    width: 560,
                    flexShrink: 0,
                    display: "flex",
                    flexDirection: "column",
                    borderLeft: "1px solid rgba(255,255,255,0.08)",
                    backgroundColor: "rgba(255,255,255,0.02)",
                  }}
                >
                  <div
                    style={{
                      display: "flex",
                      alignItems: "center",
                      gap: 12,
                      padding: "18px 22px",
                      borderBottom: "1px solid rgba(255,255,255,0.06)",
                    }}
                  >
                    <span
                      style={{
                        width: 28,
                        height: 28,
                        borderRadius: 9,
                        background: "linear-gradient(140deg, #5b8cff, #a974ff)",
                      }}
                    />
                    <span
                      style={{
                        fontFamily: body,
                        fontSize: 20,
                        fontWeight: 600,
                        color: "#ececf1",
                      }}
                    >
                      Ask these docs
                    </span>
                  </div>

                  <div
                    style={{
                      flex: 1,
                      padding: 22,
                      display: "flex",
                      flexDirection: "column",
                      gap: 18,
                    }}
                  >
                    <div
                      style={{
                        alignSelf: "flex-end",
                        maxWidth: 400,
                        padding: "14px 17px",
                        borderRadius: 15,
                        backgroundColor: "rgba(91,140,255,0.14)",
                        fontFamily: body,
                        fontSize: 19,
                        lineHeight: 1.6,
                        color: "#ececf1",
                      }}
                    >
                      {typed("How do I gate a page to staff only?", frame, 14, 2)}
                    </div>

                    <div
                      style={{
                        maxWidth: 460,
                        fontFamily: body,
                        fontSize: 19,
                        lineHeight: 1.72,
                        color: "#c8c8d4",
                        opacity: interpolate(frame, [86, 100], [0, 1], {
                          extrapolateLeft: "clamp",
                          extrapolateRight: "clamp",
                          easing: Easing.bezier(0.16, 1, 0.3, 1),
                        }),
                      }}
                    >
                      {typed(
                        "Add groups: [\"staff\"] to that page's frontmatter — readers outside the group never see it in the navigation.",
                        frame,
                        90,
                        0.7,
                      )}
                    </div>

                    <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
                      {["reader-auth.mdx", "navigation.mdx"].map((citation, index) => (
                        <span
                          key={citation}
                          style={{
                            display: "flex",
                            alignItems: "center",
                            gap: 8,
                            padding: "7px 13px",
                            borderRadius: 999,
                            border: "1px solid rgba(91,140,255,0.35)",
                            backgroundColor: "rgba(91,140,255,0.10)",
                            fontFamily: mono,
                            fontSize: 16,
                            color: "#5b8cff",
                            opacity: interpolate(
                              frame,
                              [168 + index * 11, 186 + index * 11],
                              [0, 1],
                              {
                                extrapolateLeft: "clamp",
                                extrapolateRight: "clamp",
                                easing: Easing.bezier(0.16, 1, 0.3, 1),
                              },
                            ),
                          }}
                        >
                          ↳ {citation}
                        </span>
                      ))}
                    </div>
                  </div>
                </div>
              </div>
            </BrowserFrame>
          </div>

          {/* Pane two — the same assistant, inside somebody else's product */}
          <div style={{ width: 1728, height: 748, flexShrink: 0 }}>
            <BrowserFrame url="app.acme.com/settings" tone="light">
              <div style={{ position: "absolute", inset: 0, padding: "38px 46px" }}>
                <div
                  style={{
                    fontFamily: body,
                    fontSize: 40,
                    fontWeight: 600,
                    letterSpacing: -1.2,
                    color: "#1b1b21",
                  }}
                >
                  Acme · Workspace settings
                </div>
                <div style={{ marginTop: 28, display: "flex", gap: 18 }}>
                  {[0, 1, 2].map((card) => (
                    <div
                      key={card}
                      style={{
                        flex: 1,
                        height: 150,
                        borderRadius: 14,
                        border: "1px solid rgba(0,0,0,0.08)",
                        backgroundColor: "rgba(0,0,0,0.02)",
                      }}
                    />
                  ))}
                </div>
                <div style={{ marginTop: 20, display: "flex", flexDirection: "column", gap: 14 }}>
                  {[900, 1180, 1040].map((width) => (
                    <div
                      key={width}
                      style={{
                        width,
                        height: 13,
                        borderRadius: 7,
                        backgroundColor: "rgba(0,0,0,0.06)",
                      }}
                    />
                  ))}
                </div>

                {/* The widget, installed */}
                <div
                  style={{
                    position: "absolute",
                    right: 40,
                    bottom: 36,
                    display: "flex",
                    flexDirection: "column",
                    alignItems: "flex-end",
                    gap: 14,
                  }}
                >
                  <Interactive.Div
                    name="Widget panel"
                    style={{
                      width: 400,
                      padding: 20,
                      borderRadius: 16,
                      backgroundColor: "#ffffff",
                      boxShadow: "0 28px 60px rgba(0,0,0,0.20)",
                      opacity: interpolate(frame, [262, 284], [0, 1], {
                        extrapolateLeft: "clamp",
                        extrapolateRight: "clamp",
                        easing: Easing.bezier(0.16, 1, 0.3, 1),
                      }),
                      translate: interpolate(frame, [262, 288], ["0px 20px", "0px 0px"], {
                        extrapolateLeft: "clamp",
                        extrapolateRight: "clamp",
                        easing: Easing.bezier(0.16, 1, 0.3, 1),
                      }),
                    }}
                  >
                    <div
                      style={{
                        fontFamily: body,
                        fontSize: 17,
                        fontWeight: 600,
                        color: "#1b1b21",
                      }}
                    >
                      Ask Acme docs
                    </div>
                    <div
                      style={{
                        marginTop: 12,
                        fontFamily: body,
                        fontSize: 17,
                        lineHeight: 1.6,
                        color: "#4a4a55",
                      }}
                    >
                      Where do I rotate an API key?
                    </div>
                    <div
                      style={{
                        marginTop: 14,
                        paddingTop: 14,
                        borderTop: "1px solid rgba(0,0,0,0.08)",
                        fontFamily: mono,
                        fontSize: 14,
                        color: "#5b8cff",
                      }}
                    >
                      ↳ security/api-keys.mdx
                    </div>
                  </Interactive.Div>

                  <div
                    style={{
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "center",
                      width: 68,
                      height: 68,
                      borderRadius: 999,
                      background: "linear-gradient(140deg, #5b8cff, #a974ff)",
                      boxShadow: "0 16px 40px rgba(91,140,255,0.45)",
                      fontSize: 30,
                    }}
                  >
                    <span style={{ color: "#ffffff" }}>✦</span>
                  </div>
                </div>

                {/* The install, in full */}
                <div
                  style={{
                    position: "absolute",
                    left: 46,
                    bottom: 36,
                    width: 720,
                    opacity: interpolate(frame, [286, 308], [0, 1], {
                      extrapolateLeft: "clamp",
                      extrapolateRight: "clamp",
                      easing: Easing.bezier(0.16, 1, 0.3, 1),
                    }),
                    translate: interpolate(frame, [286, 312], ["0px 18px", "0px 0px"], {
                      extrapolateLeft: "clamp",
                      extrapolateRight: "clamp",
                      easing: Easing.bezier(0.16, 1, 0.3, 1),
                    }),
                  }}
                >
                  <div
                    style={{
                      borderRadius: 14,
                      overflow: "hidden",
                      backgroundColor: "#0d0d16",
                      boxShadow: "0 22px 50px rgba(0,0,0,0.28)",
                    }}
                  >
                  <CodePanel
                    filename="one script tag"
                    fontSize={18}
                    lines={[
                      [
                        ["<", PUNC],
                        ["script", TAG],
                        [" src=", PLAIN],
                        ['"https://papervine.io/widget.js"', STR],
                      ],
                      [
                        ["        data-widget-id=", PLAIN],
                        ['"wid_acme_docs"', STR],
                        ["></", PUNC],
                        ["script", TAG],
                        [">", PUNC],
                      ],
                    ]}
                  />
                  </div>
                </div>
              </div>
            </BrowserFrame>
            </div>
          </div>
        </div>
      </Stage>

      <SceneCaption label="Answers grounded in your docs, with citations" />
    </Backdrop>
  );
};
