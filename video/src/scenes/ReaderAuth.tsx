import { Easing, Interactive, interpolate, useCurrentFrame } from "remotion";
import { Backdrop } from "../components/Backdrop";
import { CodePanel, KEY, PLAIN, PUNC, STR } from "../components/CodePanel";
import { DocsSidebar } from "../components/DocsSidebar";
import { SceneCaption } from "../components/SceneCaption";
import { Stage } from "../components/Stage";
import { body, mono } from "../fonts";

/**
 * One line of frontmatter, and what it does to the navigation. The gated rows *leave the list*
 * rather than turning into locked rows — that's the actual behaviour, and it's the whole point:
 * a public reader never learns the page exists.
 */
export const ReaderAuth: React.FC = () => {
  const frame = useCurrentFrame();

  return (
    <Backdrop>
      <Stage>
        {/* The frontmatter that does it */}
        <div
          style={{
            position: "absolute",
            left: 0,
            top: 174,
            width: 856,
          }}
        >
          <CodePanel
            filename="guides/on-call.mdx"
            fontSize={27}
            highlightLine={3}
            highlightAlpha={interpolate(frame, [86, 108], [0, 1], {
              extrapolateLeft: "clamp",
              extrapolateRight: "clamp",
              easing: Easing.bezier(0.16, 1, 0.3, 1),
            })}
            visibleChars={interpolate(frame, [14, 96], [0, 150], {
              extrapolateLeft: "clamp",
              extrapolateRight: "clamp",
              easing: Easing.linear,
            })}
            lines={[
              [["---", PUNC]],
              [
                ["title", KEY],
                [": ", PUNC],
                ["On-call runbook", PLAIN],
              ],
              [
                ["description", KEY],
                [": ", PUNC],
                ["Who to page, and when.", PLAIN],
              ],
              [
                ["groups", KEY],
                [": [", PUNC],
                ['"staff"', STR],
                ["]", PUNC],
              ],
              [["---", PUNC]],
            ]}
          />

          <div
            style={{
              marginTop: 34,
              display: "flex",
              alignItems: "center",
              gap: 14,
              opacity: interpolate(frame, [196, 218], [0, 1], {
                extrapolateLeft: "clamp",
                extrapolateRight: "clamp",
                easing: Easing.bezier(0.16, 1, 0.3, 1),
              }),
            }}
          >
            <span
              style={{
                padding: "9px 16px",
                borderRadius: 999,
                border: "1px solid rgba(255,255,255,0.10)",
                backgroundColor: "rgba(255,255,255,0.03)",
                fontFamily: mono,
                fontSize: 19,
                color: "#8a8a99",
              }}
            >
              readers sign in with your IdP
            </span>
            <span
              style={{
                fontFamily: mono,
                fontSize: 19,
                color: "#6b6b7b",
              }}
            >
              SAML · OIDC · signed JWT
            </span>
          </div>
        </div>

        {/* What each reader actually sees */}
        <div
          style={{
            position: "absolute",
            left: 952,
            top: 96,
            width: 776,
            borderRadius: 18,
            overflow: "hidden",
            border: "1px solid rgba(255,255,255,0.09)",
            backgroundColor: "#0a0a12",
            boxShadow: "0 40px 90px rgba(0,0,0,0.55)",
          }}
        >
          <div
            style={{
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
              padding: "18px 24px",
              borderBottom: "1px solid rgba(255,255,255,0.06)",
            }}
          >
            <span
              style={{
                fontFamily: body,
                fontSize: 21,
                fontWeight: 600,
                color: "#ececf1",
              }}
            >
              The navigation this reader gets
            </span>
            <Interactive.Div
              name="Reader pill"
              style={{
                padding: "7px 15px",
                borderRadius: 999,
                fontFamily: mono,
                fontSize: 18,
                color: frame < 132 || frame >= 196 ? "#7ee0b8" : "#ffb86b",
                backgroundColor:
                  frame < 132 || frame >= 196
                    ? "rgba(126,224,184,0.12)"
                    : "rgba(255,184,107,0.12)",
              }}
            >
              {frame < 132 || frame >= 196 ? "group: staff" : "public reader"}
            </Interactive.Div>
          </div>

          <div style={{ padding: "8px 8px 20px" }}>
            <DocsSidebar
              width={772}
              rowHeight={48}
              labelSize={22}
              groups={[
                {
                  group: "Guides",
                  items: [
                    { label: "Quickstart" },
                    { label: "Authoring" },
                    { label: "Navigation" },
                    { label: "Rate limits" },
                    { label: "Custom domain" },
                  ],
                },
                {
                  group: "Internal",
                  items: [
                    {
                      label: "On-call runbook",
                      presence: interpolate(
                        frame,
                        [126, 152, 196, 222],
                        [1, 0, 0, 1],
                        {
                          extrapolateLeft: "clamp",
                          extrapolateRight: "clamp",
                          easing: [
                            Easing.bezier(0.7, 0, 0.84, 0),
                            Easing.linear,
                            Easing.bezier(0.16, 1, 0.3, 1),
                          ],
                        },
                      ),
                    },
                    {
                      label: "Security review",
                      presence: interpolate(
                        frame,
                        [130, 156, 200, 226],
                        [1, 0, 0, 1],
                        {
                          extrapolateLeft: "clamp",
                          extrapolateRight: "clamp",
                          easing: [
                            Easing.bezier(0.7, 0, 0.84, 0),
                            Easing.linear,
                            Easing.bezier(0.16, 1, 0.3, 1),
                          ],
                        },
                      ),
                    },
                    {
                      label: "Incident review",
                      presence: interpolate(
                        frame,
                        [134, 160, 204, 230],
                        [1, 0, 0, 1],
                        {
                          extrapolateLeft: "clamp",
                          extrapolateRight: "clamp",
                          easing: [
                            Easing.bezier(0.7, 0, 0.84, 0),
                            Easing.linear,
                            Easing.bezier(0.16, 1, 0.3, 1),
                          ],
                        },
                      ),
                    },
                  ],
                },
              ]}
            />
            <div
              style={{
                margin: "0 22px",
                paddingTop: 4,
                fontFamily: body,
                fontSize: 18,
                color: "#6b6b7b",
                opacity: interpolate(frame, [154, 174, 196, 210], [0, 1, 1, 0], {
                  extrapolateLeft: "clamp",
                  extrapolateRight: "clamp",
                  easing: [Easing.bezier(0.16, 1, 0.3, 1), Easing.linear, Easing.linear],
                }),
              }}
            >
              Gated pages aren&apos;t locked rows — they aren&apos;t in the list at all.
            </div>
          </div>
        </div>
      </Stage>

      <SceneCaption label="Page-level access control from one line of frontmatter" />
    </Backdrop>
  );
};
