import { Easing, Interactive, interpolate, useCurrentFrame } from "remotion";
import { Backdrop } from "../components/Backdrop";
import { SceneCaption } from "../components/SceneCaption";
import { Stage } from "../components/Stage";
import { body, mono } from "../fonts";

const HUMAN_STATS = [
  ["Page views", "48,210", "+12% this week"],
  ["Searches", "6,340", "top: “rate limits”"],
  ["Median read", "2m 14s", "across 38 pages"],
];

const AGENT_STATS = [
  ["Agent fetches", "19,884", "+61% this week"],
  ["llms.txt hits", "4,127", "12 distinct crawlers"],
  ["MCP tool calls", "1,806", "search_docs · read_page"],
];

const TOP_PAGES = [
  ["/quickstart", "12,480"],
  ["/api-reference/create-site", "8,120"],
  ["/rate-limits", "6,905"],
  ["/reader-auth", "4,220"],
  ["/authoring", "3,014"],
];

const TOP_AGENTS = [
  ["ClaudeBot", "7,102"],
  ["ChatGPT-User", "5,908"],
  ["PerplexityBot", "3,410"],
  ["Googlebot", "2,464"],
  ["GPTBot", "1,000"],
];

/**
 * The same site, measured twice. The toggle is the whole idea: docs analytics that only counts
 * humans is now measuring a shrinking fraction of the readership.
 */
export const Analytics: React.FC = () => {
  const frame = useCurrentFrame();

  return (
    <Backdrop>
      <Stage>
        <div
          style={{
            width: 1728,
            height: 700,
            display: "flex",
            flexDirection: "column",
            borderRadius: 20,
            overflow: "hidden",
            border: "1px solid rgba(255,255,255,0.09)",
            backgroundColor: "#0a0a12",
            boxShadow: "0 40px 90px rgba(0,0,0,0.55)",
          }}
        >
          {/* Header + the toggle */}
          <div
            style={{
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
              padding: "22px 30px",
              borderBottom: "1px solid rgba(255,255,255,0.06)",
            }}
          >
            <div style={{ display: "flex", alignItems: "baseline", gap: 16 }}>
              <span
                style={{
                  fontFamily: body,
                  fontSize: 26,
                  fontWeight: 600,
                  color: "#ececf1",
                }}
              >
                Analytics
              </span>
              <span
                style={{ fontFamily: mono, fontSize: 18, color: "#6b6b7b" }}
              >
                docs.acme.com · last 7 days
              </span>
            </div>

            <div
              style={{
                position: "relative",
                display: "flex",
                padding: 5,
                borderRadius: 12,
                border: "1px solid rgba(255,255,255,0.09)",
                backgroundColor: "rgba(255,255,255,0.03)",
              }}
            >
              <Interactive.Div
                name="Toggle thumb"
                style={{
                  position: "absolute",
                  top: 5,
                  left: 5,
                  width: 132,
                  height: 42,
                  borderRadius: 9,
                  background: "linear-gradient(110deg, #5b8cff, #a974ff)",
                  translate: interpolate(
                    frame,
                    [104, 126],
                    ["0px 0px", "132px 0px"],
                    {
                      extrapolateLeft: "clamp",
                      extrapolateRight: "clamp",
                      easing: Easing.spring({ damping: 18 }),
                    },
                  ),
                }}
              />
              {["Humans", "Agents"].map((label, index) => (
                <div
                  key={label}
                  style={{
                    position: "relative",
                    width: 132,
                    height: 42,
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    fontFamily: body,
                    fontSize: 19,
                    fontWeight: 600,
                    color:
                      (frame < 115 ? 0 : 1) === index ? "#ffffff" : "#8a8a99",
                  }}
                >
                  {label}
                </div>
              ))}
            </div>
          </div>

          <div style={{ flex: 1, display: "flex", padding: 30, gap: 34 }}>
            {/* Chart column */}
            <div style={{ flex: 1, display: "flex", flexDirection: "column" }}>
              <div style={{ display: "flex", gap: 18 }}>
                {(frame < 115 ? HUMAN_STATS : AGENT_STATS).map((stat) => (
                  <div
                    key={stat[0]}
                    style={{
                      flex: 1,
                      padding: "16px 18px",
                      borderRadius: 14,
                      border: "1px solid rgba(255,255,255,0.07)",
                      backgroundColor: "rgba(255,255,255,0.022)",
                    }}
                  >
                    <div
                      style={{
                        fontFamily: body,
                        fontSize: 17,
                        color: "#8a8a99",
                      }}
                    >
                      {stat[0]}
                    </div>
                    <div
                      style={{
                        marginTop: 6,
                        fontFamily: body,
                        fontSize: 34,
                        fontWeight: 600,
                        letterSpacing: -1,
                        color: "#ececf1",
                      }}
                    >
                      {stat[1]}
                    </div>
                    <div
                      style={{
                        marginTop: 4,
                        fontFamily: mono,
                        fontSize: 15,
                        color: "#6b6b7b",
                      }}
                    >
                      {stat[2]}
                    </div>
                  </div>
                ))}
              </div>

              <div style={{ position: "relative", flex: 1, marginTop: 26 }}>
                <svg
                  width="100%"
                  height="100%"
                  viewBox="0 0 1020 300"
                  preserveAspectRatio="none"
                >
                  <defs>
                    <linearGradient id="humanFill" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="0%" stopColor="#5b8cff" stopOpacity="0.34" />
                      <stop offset="100%" stopColor="#5b8cff" stopOpacity="0" />
                    </linearGradient>
                    <linearGradient id="agentFill" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="0%" stopColor="#a974ff" stopOpacity="0.34" />
                      <stop offset="100%" stopColor="#a974ff" stopOpacity="0" />
                    </linearGradient>
                  </defs>

                  {[60, 130, 200, 270].map((y) => (
                    <line
                      key={y}
                      x1="0"
                      y1={y}
                      x2="1020"
                      y2={y}
                      stroke="rgba(255,255,255,0.055)"
                      strokeWidth="1"
                    />
                  ))}

                  {/* Humans */}
                  <g
                    style={{
                      opacity: interpolate(frame, [104, 124], [1, 0], {
                        extrapolateLeft: "clamp",
                        extrapolateRight: "clamp",
                        easing: Easing.linear,
                      }),
                    }}
                  >
                    <path
                      d="M0,232 C90,214 150,186 230,196 C310,206 370,140 450,150 C530,160 590,112 670,100 C750,88 830,124 910,88 L1020,68 L1020,300 L0,300 Z"
                      fill="url(#humanFill)"
                    />
                    <path
                      d="M0,232 C90,214 150,186 230,196 C310,206 370,140 450,150 C530,160 590,112 670,100 C750,88 830,124 910,88 L1020,68"
                      fill="none"
                      stroke="#5b8cff"
                      strokeWidth="3"
                      strokeLinecap="round"
                      strokeDasharray="1500"
                      strokeDashoffset={interpolate(frame, [26, 92], [1500, 0], {
                        extrapolateLeft: "clamp",
                        extrapolateRight: "clamp",
                        easing: Easing.bezier(0.16, 1, 0.3, 1),
                      })}
                    />
                  </g>

                  {/* Agents */}
                  <g
                    style={{
                      opacity: interpolate(frame, [110, 132], [0, 1], {
                        extrapolateLeft: "clamp",
                        extrapolateRight: "clamp",
                        easing: Easing.linear,
                      }),
                    }}
                  >
                    <path
                      d="M0,278 C90,272 150,258 230,250 C310,242 370,216 450,192 C530,168 590,132 670,108 C750,84 830,58 910,36 L1020,18 L1020,300 L0,300 Z"
                      fill="url(#agentFill)"
                    />
                    <path
                      d="M0,278 C90,272 150,258 230,250 C310,242 370,216 450,192 C530,168 590,132 670,108 C750,84 830,58 910,36 L1020,18"
                      fill="none"
                      stroke="#a974ff"
                      strokeWidth="3"
                      strokeLinecap="round"
                      strokeDasharray="1500"
                      strokeDashoffset={interpolate(frame, [116, 176], [1500, 0], {
                        extrapolateLeft: "clamp",
                        extrapolateRight: "clamp",
                        easing: Easing.bezier(0.16, 1, 0.3, 1),
                      })}
                    />
                  </g>
                </svg>
              </div>

              <div
                style={{
                  display: "flex",
                  justifyContent: "space-between",
                  marginTop: 12,
                  fontFamily: mono,
                  fontSize: 16,
                  color: "#6b6b7b",
                }}
              >
                {["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"].map((day) => (
                  <span key={day}>{day}</span>
                ))}
              </div>
            </div>

            {/* Leaderboard column */}
            <div
              style={{
                width: 560,
                flexShrink: 0,
                padding: "20px 22px",
                borderRadius: 16,
                border: "1px solid rgba(255,255,255,0.07)",
                backgroundColor: "rgba(255,255,255,0.022)",
              }}
            >
              <div
                style={{
                  fontFamily: body,
                  fontSize: 15,
                  fontWeight: 600,
                  letterSpacing: 1.4,
                  textTransform: "uppercase",
                  color: "#6b6b7b",
                }}
              >
                {frame < 115 ? "Top pages" : "Top agents"}
              </div>
              {(frame < 115 ? TOP_PAGES : TOP_AGENTS).map((row, index) => (
                <div
                  key={row[0]}
                  style={{
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "space-between",
                    marginTop: 18,
                    paddingBottom: 14,
                    borderBottom:
                      index === 4 ? "none" : "1px solid rgba(255,255,255,0.055)",
                  }}
                >
                  <span
                    style={{
                      fontFamily: mono,
                      fontSize: 19,
                      color: "#c8c8d4",
                    }}
                  >
                    {row[0]}
                  </span>
                  <span
                    style={{
                      fontFamily: mono,
                      fontSize: 19,
                      color: frame < 115 ? "#5b8cff" : "#a974ff",
                    }}
                  >
                    {row[1]}
                  </span>
                </div>
              ))}
            </div>
          </div>
        </div>
      </Stage>

      <SceneCaption label="Traffic from people, and from agents" />
    </Backdrop>
  );
};
