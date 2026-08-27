import { AbsoluteFill, Easing, interpolate, useCurrentFrame } from "remotion";
import { Backdrop } from "../components/Backdrop";
import { BrowserFrame } from "../components/BrowserFrame";
import { DocsSidebar } from "../components/DocsSidebar";
import { SceneCaption } from "../components/SceneCaption";
import { Stage } from "../components/Stage";
import { body, mono } from "../fonts";

/**
 * One docs page, rendered twice — once dark, once light — with the light copy revealed through
 * an expanding circle clipped to the appearance toggle. Cheaper than animating every colour,
 * and it reads as the real view transition rather than a cross-fade.
 */
const DocsBody: React.FC<{ tone: "dark" | "light"; frame: number }> = ({
  tone,
  frame,
}) => {
  return (
    <div style={{ position: "absolute", inset: 0, display: "flex" }}>
      <DocsSidebar
        tone={tone}
        width={300}
        groups={[
          {
            group: "Get started",
            items: [
              { label: "Introduction" },
              { label: "Quickstart" },
              { label: "Migrating in" },
            ],
          },
          {
            group: "Write your docs",
            items: [
              { label: "Authoring" },
              { label: "Components", active: true },
              { label: "Navigation" },
            ],
          },
          {
            group: "Publish",
            items: [{ label: "Custom domain" }],
          },
        ]}
      />

      <div style={{ flex: 1, position: "relative", overflow: "hidden" }}>
        {/* The appearance toggle the reveal is anchored to */}
        <div
          style={{
            position: "absolute",
            right: 34,
            top: 26,
            zIndex: 3,
            display: "flex",
            alignItems: "center",
            gap: 8,
            padding: "7px 12px",
            borderRadius: 999,
            border:
              tone === "dark"
                ? "1px solid rgba(255,255,255,0.10)"
                : "1px solid rgba(0,0,0,0.10)",
            fontFamily: mono,
            fontSize: 15,
            color: tone === "dark" ? "#8a8a99" : "#61616c",
          }}
        >
          {tone === "dark" ? "◑ dark" : "◐ light"}
        </div>

        <div
          style={{
            padding: "40px 56px",
            translate: interpolate(frame, [64, 186], ["0px 0px", "0px -168px"], {
              extrapolateLeft: "clamp",
              extrapolateRight: "clamp",
              easing: Easing.bezier(0.4, 0, 0.2, 1),
            }),
          }}
        >
          <div
            style={{
              fontFamily: mono,
              fontSize: 17,
              letterSpacing: 1.2,
              textTransform: "uppercase",
              backgroundImage: "linear-gradient(90deg, #5b8cff, #a974ff)",
              WebkitBackgroundClip: "text",
              backgroundClip: "text",
              color: "transparent",
            }}
          >
            Write your docs
          </div>
          <div
            style={{
              marginTop: 14,
              fontFamily: body,
              fontSize: 54,
              fontWeight: 600,
              letterSpacing: -1.8,
              color: tone === "dark" ? "#ececf1" : "#1b1b21",
            }}
          >
            Components
          </div>
          <div
            style={{
              marginTop: 18,
              maxWidth: 720,
              fontFamily: body,
              fontSize: 21,
              lineHeight: 1.7,
              color: tone === "dark" ? "#8a8a99" : "#61616c",
            }}
          >
            Markdown with components when you need them. An unknown component
            renders its children instead of breaking the page.
          </div>

          {/* CardGroup */}
          <div style={{ marginTop: 30, display: "flex", gap: 18 }}>
            {["Cards & columns", "Callouts"].map((card, index) => (
              <div
                key={card}
                style={{
                  flex: 1,
                  padding: "22px 24px",
                  borderRadius: 14,
                  border:
                    tone === "dark"
                      ? "1px solid rgba(255,255,255,0.08)"
                      : "1px solid rgba(0,0,0,0.09)",
                  backgroundColor:
                    tone === "dark"
                      ? "rgba(255,255,255,0.025)"
                      : "rgba(0,0,0,0.02)",
                  opacity: interpolate(
                    frame,
                    [40 + index * 14, 66 + index * 14],
                    [0, 1],
                    {
                      extrapolateLeft: "clamp",
                      extrapolateRight: "clamp",
                      easing: Easing.bezier(0.16, 1, 0.3, 1),
                    },
                  ),
                  translate: interpolate(
                    frame,
                    [40 + index * 14, 66 + index * 14],
                    ["0px 20px", "0px 0px"],
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
                    width: 34,
                    height: 34,
                    borderRadius: 10,
                    background:
                      "linear-gradient(140deg, rgba(91,140,255,0.30), rgba(169,116,255,0.30))",
                  }}
                />
                <div
                  style={{
                    marginTop: 14,
                    fontFamily: body,
                    fontSize: 21,
                    fontWeight: 600,
                    color: tone === "dark" ? "#ececf1" : "#1b1b21",
                  }}
                >
                  {card}
                </div>
                <div
                  style={{
                    marginTop: 8,
                    fontFamily: body,
                    fontSize: 18,
                    lineHeight: 1.6,
                    color: tone === "dark" ? "#8a8a99" : "#61616c",
                  }}
                >
                  Grids, icons and links, in one tag.
                </div>
              </div>
            ))}
          </div>

          {/* Tabs + code */}
          <div
            style={{
              marginTop: 40,
              fontFamily: body,
              fontSize: 28,
              fontWeight: 600,
              letterSpacing: -0.6,
              color: tone === "dark" ? "#ececf1" : "#1b1b21",
            }}
          >
            Tabs
          </div>
          <div
            style={{
              marginTop: 18,
              borderRadius: 14,
              overflow: "hidden",
              border:
                tone === "dark"
                  ? "1px solid rgba(255,255,255,0.08)"
                  : "1px solid rgba(0,0,0,0.09)",
            }}
          >
            <div
              style={{
                display: "flex",
                gap: 4,
                padding: "10px 12px",
                borderBottom:
                  tone === "dark"
                    ? "1px solid rgba(255,255,255,0.06)"
                    : "1px solid rgba(0,0,0,0.07)",
              }}
            >
              {["npm", "pnpm", "yarn"].map((tab, index) => (
                <div
                  key={tab}
                  style={{
                    padding: "7px 16px",
                    borderRadius: 8,
                    fontFamily: mono,
                    fontSize: 17,
                    color:
                      index ===
                      (frame < 214 ? 0 : 1)
                        ? "#5b8cff"
                        : tone === "dark"
                          ? "#8a8a99"
                          : "#61616c",
                    backgroundColor:
                      index === (frame < 214 ? 0 : 1)
                        ? "rgba(91,140,255,0.12)"
                        : "transparent",
                  }}
                >
                  {tab}
                </div>
              ))}
            </div>
            <div
              style={{
                padding: "20px 22px",
                fontFamily: mono,
                fontSize: 20,
                backgroundColor:
                  tone === "dark" ? "rgba(255,255,255,0.02)" : "rgba(0,0,0,0.02)",
              }}
            >
              <span style={{ color: "#a974ff" }}>
                {frame < 214 ? "npm" : "pnpm"}
              </span>
              <span style={{ color: tone === "dark" ? "#ececf1" : "#1b1b21" }}>
                {" "}
                install{" "}
              </span>
              <span style={{ color: "#7ee0b8" }}>papervine</span>
            </div>
          </div>

          {/* Accordion */}
          <div
            style={{
              marginTop: 22,
              display: "flex",
              alignItems: "center",
              gap: 14,
              padding: "18px 22px",
              borderRadius: 14,
              border:
                tone === "dark"
                  ? "1px solid rgba(255,255,255,0.08)"
                  : "1px solid rgba(0,0,0,0.09)",
              fontFamily: body,
              fontSize: 21,
              color: tone === "dark" ? "#ececf1" : "#1b1b21",
            }}
          >
            <span style={{ color: "#5b8cff" }}>▸</span>
            What happens to a component I haven&apos;t defined?
          </div>
          <div
            style={{
              marginTop: 12,
              display: "flex",
              alignItems: "center",
              gap: 14,
              padding: "18px 22px",
              borderRadius: 14,
              border:
                tone === "dark"
                  ? "1px solid rgba(255,255,255,0.08)"
                  : "1px solid rgba(0,0,0,0.09)",
              fontFamily: body,
              fontSize: 21,
              color: tone === "dark" ? "#ececf1" : "#1b1b21",
            }}
          >
            <span style={{ color: "#5b8cff" }}>▸</span>
            Can I use my own React components?
          </div>

          <div
            style={{
              marginTop: 34,
              paddingTop: 22,
              borderTop:
                tone === "dark"
                  ? "1px solid rgba(255,255,255,0.06)"
                  : "1px solid rgba(0,0,0,0.07)",
              display: "flex",
              alignItems: "center",
              gap: 16,
              fontFamily: body,
              fontSize: 18,
              color: tone === "dark" ? "#8a8a99" : "#61616c",
            }}
          >
            Was this page helpful?
            <span
              style={{
                padding: "6px 14px",
                borderRadius: 999,
                border:
                  tone === "dark"
                    ? "1px solid rgba(255,255,255,0.10)"
                    : "1px solid rgba(0,0,0,0.10)",
              }}
            >
              Yes
            </span>
            <span
              style={{
                padding: "6px 14px",
                borderRadius: 999,
                border:
                  tone === "dark"
                    ? "1px solid rgba(255,255,255,0.10)"
                    : "1px solid rgba(0,0,0,0.10)",
              }}
            >
              No
            </span>
            <span style={{ marginLeft: "auto", fontFamily: mono, fontSize: 16 }}>
              Edit this page →
            </span>
          </div>
        </div>
      </div>
    </div>
  );
};

export const Site: React.FC = () => {
  const frame = useCurrentFrame();

  return (
    <Backdrop>
      <Stage>
        <BrowserFrame url="docs.acme.com/components">
          <DocsBody tone="dark" frame={frame} />
          {/* The light appearance, revealed from the toggle and put away again */}
          <AbsoluteFill
            name="Light appearance"
            style={{
              backgroundColor: "#f7f7f9",
              // Remotion's string interpolation takes at most three components, so the radius
              // is interpolated as a number and the circle() is assembled around it.
              clipPath: `circle(${interpolate(
                frame,
                [228, 262, 288, 320],
                [0, 1850, 1850, 0],
                {
                  extrapolateLeft: "clamp",
                  extrapolateRight: "clamp",
                  easing: [
                    Easing.bezier(0.16, 1, 0.3, 1),
                    Easing.linear,
                    Easing.bezier(0.7, 0, 0.84, 0),
                  ],
                },
              )}px at 1649px 42px)`,
            }}
          >
            <DocsBody tone="light" frame={frame} />
          </AbsoluteFill>
        </BrowserFrame>
      </Stage>

      <SceneCaption label="Navigation, components, and both appearances" />
    </Backdrop>
  );
};
