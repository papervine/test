import { Easing, Interactive, interpolate, useCurrentFrame } from "remotion";
import { Backdrop } from "../components/Backdrop";
import { BrowserFrame } from "../components/BrowserFrame";
import { SceneCaption } from "../components/SceneCaption";
import { Stage } from "../components/Stage";
import { typed } from "../lib/typing";
import { body, mono } from "../fonts";

const LLMS_TXT = [
  ["# Acme Docs", "#ececf1"],
  ["", "#8a8a99"],
  ["> Everything you need to integrate Acme.", "#8a8a99"],
  ["", "#8a8a99"],
  ["## Get started", "#a974ff"],
  ["- [Introduction](https://docs.acme.com/index.md)", "#8a8a99"],
  ["- [Quickstart](https://docs.acme.com/quickstart.md)", "#8a8a99"],
  ["", "#8a8a99"],
  ["## API reference", "#a974ff"],
  ["- [Create a site](https://docs.acme.com/api/create-site.md)", "#8a8a99"],
  ["- [Rate limits](https://docs.acme.com/rate-limits.md)", "#8a8a99"],
  ["", "#8a8a99"],
  ["## Reader access", "#a974ff"],
  ["- [Reader auth](https://docs.acme.com/reader-auth.md)", "#8a8a99"],
];

/**
 * The second audience, served directly: `llms.txt` on the left is the site handing an agent a
 * map of itself, and on the right an agent is calling the MCP server rather than scraping HTML.
 */
export const AgentReady: React.FC = () => {
  const frame = useCurrentFrame();

  return (
    <Backdrop>
      <Stage>
        {/* llms.txt, served as plain text */}
        <div
          style={{
            position: "absolute",
            left: 0,
            top: 0,
            width: 812,
            height: 620,
          }}
        >
          <BrowserFrame url="docs.acme.com/llms.txt">
            <div style={{ position: "absolute", inset: 0, padding: "26px 30px" }}>
              {LLMS_TXT.map((line, index) => (
                <div
                  key={String(line[0]) + index}
                  style={{
                    minHeight: 30,
                    fontFamily: mono,
                    fontSize: 19,
                    lineHeight: 1.6,
                    color: String(line[1]),
                    opacity: interpolate(
                      frame,
                      [14 + index * 5, 30 + index * 5],
                      [0, 1],
                      {
                        extrapolateLeft: "clamp",
                        extrapolateRight: "clamp",
                        easing: Easing.bezier(0.16, 1, 0.3, 1),
                      },
                    ),
                  }}
                >
                  {line[0]}
                </div>
              ))}
            </div>
          </BrowserFrame>
        </div>

        {/* An agent working through MCP */}
        <div
          style={{
            position: "absolute",
            left: 868,
            top: 0,
            width: 860,
            height: 620,
            display: "flex",
            flexDirection: "column",
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
              gap: 12,
              padding: "17px 22px",
              borderBottom: "1px solid rgba(255,255,255,0.06)",
            }}
          >
            <span
              style={{
                width: 9,
                height: 9,
                borderRadius: 5,
                backgroundColor: "#7ee0b8",
                boxShadow: "0 0 10px 2px rgba(126,224,184,0.6)",
              }}
            />
            <span style={{ fontFamily: mono, fontSize: 18, color: "#8a8a99" }}>
              your user&apos;s coding agent · mcp
            </span>
          </div>

          <div style={{ flex: 1, padding: 24, display: "flex", flexDirection: "column", gap: 18 }}>
            <div
              style={{
                fontFamily: body,
                fontSize: 21,
                lineHeight: 1.6,
                color: "#ececf1",
              }}
            >
              {typed("Wire up Acme so internal pages stay internal.", frame, 40, 3)}
            </div>

            {/* The tool call */}
            <Interactive.Div
              name="Tool call"
              style={{
                padding: "16px 18px",
                borderRadius: 12,
                border: "1px solid rgba(169,116,255,0.30)",
                backgroundColor: "rgba(169,116,255,0.07)",
                opacity: interpolate(frame, [152, 172], [0, 1], {
                  extrapolateLeft: "clamp",
                  extrapolateRight: "clamp",
                  easing: Easing.bezier(0.16, 1, 0.3, 1),
                }),
                translate: interpolate(frame, [152, 176], ["0px 14px", "0px 0px"], {
                  extrapolateLeft: "clamp",
                  extrapolateRight: "clamp",
                  easing: Easing.bezier(0.16, 1, 0.3, 1),
                }),
              }}
            >
              <div style={{ fontFamily: mono, fontSize: 18, color: "#a974ff" }}>
                → acme_docs.search_docs
              </div>
              <div
                style={{
                  marginTop: 8,
                  fontFamily: mono,
                  fontSize: 18,
                  color: "#8a8a99",
                }}
              >
                {"{ "}
                <span style={{ color: "#5b8cff" }}>&quot;query&quot;</span>
                {": "}
                <span style={{ color: "#7ee0b8" }}>&quot;keep pages internal&quot;</span>
                {" }"}
              </div>
              <div
                style={{
                  marginTop: 12,
                  paddingTop: 12,
                  borderTop: "1px solid rgba(255,255,255,0.07)",
                  fontFamily: mono,
                  fontSize: 18,
                  color: "#7ee0b8",
                  opacity: interpolate(frame, [188, 206], [0, 1], {
                    extrapolateLeft: "clamp",
                    extrapolateRight: "clamp",
                    easing: Easing.bezier(0.16, 1, 0.3, 1),
                  }),
                }}
              >
                ← 3 pages · reader-auth.md, groups.md, navigation.md
              </div>
            </Interactive.Div>

            <div
              style={{
                fontFamily: body,
                fontSize: 20,
                lineHeight: 1.7,
                color: "#a8a8b6",
                opacity: interpolate(frame, [212, 228], [0, 1], {
                  extrapolateLeft: "clamp",
                  extrapolateRight: "clamp",
                  easing: Easing.bezier(0.16, 1, 0.3, 1),
                }),
              }}
            >
              {typed(
                "Acme gates a page with groups: [\"staff\"] — I'll add it to both runbooks.",
                frame,
                214,
                0.6,
              )}
            </div>
          </div>
        </div>

        {/* What ships, by default */}
        <div
          style={{
            position: "absolute",
            left: 0,
            top: 654,
            display: "flex",
            gap: 14,
          }}
        >
          {["/llms.txt", "/llms-full.txt", "per-page .md", "MCP server"].map(
            (chip, index) => (
              <div
                key={chip}
                style={{
                  padding: "9px 18px",
                  borderRadius: 999,
                  border: "1px solid rgba(255,255,255,0.10)",
                  backgroundColor: "rgba(255,255,255,0.03)",
                  fontFamily: mono,
                  fontSize: 19,
                  color: "#8a8a99",
                  opacity: interpolate(
                    frame,
                    [240 + index * 10, 262 + index * 10],
                    [0, 1],
                    {
                      extrapolateLeft: "clamp",
                      extrapolateRight: "clamp",
                      easing: Easing.bezier(0.16, 1, 0.3, 1),
                    },
                  ),
                }}
              >
                {chip}
              </div>
            ),
          )}
        </div>
      </Stage>

      <SceneCaption label="llms.txt and an MCP server, out of the box" />
    </Backdrop>
  );
};
