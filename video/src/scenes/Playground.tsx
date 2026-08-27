import { Easing, Interactive, interpolate, useCurrentFrame } from "remotion";
import { Backdrop } from "../components/Backdrop";
import { BrowserFrame } from "../components/BrowserFrame";
import { DocsSidebar } from "../components/DocsSidebar";
import { SceneCaption } from "../components/SceneCaption";
import { Stage } from "../components/Stage";
import { body, mono } from "../fonts";

const PARAMS = [
  ["name", "string", "required", "Display name for the site."],
  ["slug", "string", "required", "Subdomain to serve it on."],
  ["repo", "string", "optional", "Git remote to sync from."],
];

const RESPONSE = [
  "{",
  '  "id": "site_8Fq2xK",',
  '  "slug": "acme-docs",',
  '  "url": "acme-docs.papervine.io",',
  '  "status": "live"',
  "}",
];

/**
 * The OpenAPI beat: a spec file drops into the repo and the navigation grows endpoint pages,
 * each with schemas and a live Try it panel. The response streams in line by line so the
 * "live" claim is shown rather than asserted.
 */
export const Playground: React.FC = () => {
  const frame = useCurrentFrame();

  return (
    <Backdrop>
      <Stage>
        <BrowserFrame url="docs.acme.com/api-reference/create-site">
          <div style={{ position: "absolute", inset: 0, display: "flex" }}>
            <DocsSidebar
              width={300}
              groups={[
                {
                  group: "API reference",
                  items: [
                    { label: "Overview" },
                    { label: "List sites", badge: "GET", presence: interpolate(frame, [40, 62], [0, 1], { extrapolateLeft: "clamp", extrapolateRight: "clamp", easing: Easing.bezier(0.16, 1, 0.3, 1) }) },
                    { label: "Create a site", badge: "POST", active: true, presence: interpolate(frame, [52, 74], [0, 1], { extrapolateLeft: "clamp", extrapolateRight: "clamp", easing: Easing.bezier(0.16, 1, 0.3, 1) }) },
                    { label: "Delete a site", badge: "DEL", presence: interpolate(frame, [64, 86], [0, 1], { extrapolateLeft: "clamp", extrapolateRight: "clamp", easing: Easing.bezier(0.16, 1, 0.3, 1) }) },
                  ],
                },
              ]}
            />

            {/* The spec file that generated them */}
            <Interactive.Div
              name="Spec chip"
              style={{
                position: "absolute",
                left: 34,
                top: 300,
                display: "flex",
                alignItems: "center",
                gap: 10,
                padding: "9px 15px",
                borderRadius: 10,
                border: "1px solid rgba(169,116,255,0.35)",
                backgroundColor: "#140f1f",
                fontFamily: mono,
                fontSize: 18,
                color: "#a974ff",
                opacity: interpolate(frame, [6, 24, 40, 56], [0, 1, 1, 0], {
                  extrapolateLeft: "clamp",
                  extrapolateRight: "clamp",
                  easing: [Easing.bezier(0.16, 1, 0.3, 1), Easing.linear, Easing.linear],
                }),
                translate: interpolate(frame, [6, 44], ["-40px 60px", "0px 0px"], {
                  extrapolateLeft: "clamp",
                  extrapolateRight: "clamp",
                  easing: Easing.bezier(0.16, 1, 0.3, 1),
                }),
              }}
            >
              openapi.yaml
            </Interactive.Div>

            <div style={{ flex: 1, padding: "34px 44px", display: "flex", gap: 34 }}>
              {/* Reference column */}
              <div style={{ flex: 1 }}>
                <div style={{ display: "flex", alignItems: "center", gap: 14 }}>
                  <span
                    style={{
                      padding: "5px 12px",
                      borderRadius: 7,
                      fontFamily: mono,
                      fontSize: 17,
                      fontWeight: 500,
                      color: "#7ee0b8",
                      backgroundColor: "rgba(126,224,184,0.14)",
                    }}
                  >
                    POST
                  </span>
                  <span
                    style={{ fontFamily: mono, fontSize: 26, color: "#ececf1" }}
                  >
                    /v1/sites
                  </span>
                </div>
                <div
                  style={{
                    marginTop: 18,
                    fontFamily: body,
                    fontSize: 40,
                    fontWeight: 600,
                    letterSpacing: -1.2,
                    color: "#ececf1",
                  }}
                >
                  Create a site
                </div>
                <div
                  style={{
                    marginTop: 26,
                    fontFamily: body,
                    fontSize: 15,
                    fontWeight: 600,
                    letterSpacing: 1.4,
                    textTransform: "uppercase",
                    color: "#6b6b7b",
                  }}
                >
                  Body parameters
                </div>
                {PARAMS.map((param, index) => (
                  <div
                    key={param[0]}
                    style={{
                      marginTop: 14,
                      paddingBottom: 14,
                      borderBottom: "1px solid rgba(255,255,255,0.06)",
                      opacity: interpolate(
                        frame,
                        [78 + index * 12, 100 + index * 12],
                        [0, 1],
                        {
                          extrapolateLeft: "clamp",
                          extrapolateRight: "clamp",
                          easing: Easing.bezier(0.16, 1, 0.3, 1),
                        },
                      ),
                    }}
                  >
                    <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
                      <span
                        style={{ fontFamily: mono, fontSize: 21, color: "#5b8cff" }}
                      >
                        {param[0]}
                      </span>
                      <span
                        style={{ fontFamily: mono, fontSize: 17, color: "#6b6b7b" }}
                      >
                        {param[1]}
                      </span>
                      <span
                        style={{
                          fontFamily: mono,
                          fontSize: 15,
                          color: param[2] === "required" ? "#ff9d7a" : "#6b6b7b",
                        }}
                      >
                        {param[2]}
                      </span>
                    </div>
                    <div
                      style={{
                        marginTop: 6,
                        fontFamily: body,
                        fontSize: 18,
                        color: "#8a8a99",
                      }}
                    >
                      {param[3]}
                    </div>
                  </div>
                ))}

                <div
                  style={{
                    marginTop: 24,
                    fontFamily: body,
                    fontSize: 15,
                    fontWeight: 600,
                    letterSpacing: 1.4,
                    textTransform: "uppercase",
                    color: "#6b6b7b",
                    opacity: interpolate(frame, [118, 140], [0, 1], {
                      extrapolateLeft: "clamp",
                      extrapolateRight: "clamp",
                      easing: Easing.bezier(0.16, 1, 0.3, 1),
                    }),
                  }}
                >
                  Response · 200
                </div>
                {[
                  ["id", "string"],
                  ["slug", "string"],
                  ["url", "string"],
                ].map((field, index) => (
                  <div
                    key={field[0]}
                    style={{
                      display: "flex",
                      alignItems: "center",
                      gap: 12,
                      marginTop: 12,
                      opacity: interpolate(
                        frame,
                        [126 + index * 9, 146 + index * 9],
                        [0, 1],
                        {
                          extrapolateLeft: "clamp",
                          extrapolateRight: "clamp",
                          easing: Easing.bezier(0.16, 1, 0.3, 1),
                        },
                      ),
                    }}
                  >
                    <span
                      style={{ fontFamily: mono, fontSize: 19, color: "#7ee0b8" }}
                    >
                      {field[0]}
                    </span>
                    <span
                      style={{ fontFamily: mono, fontSize: 17, color: "#6b6b7b" }}
                    >
                      {field[1]}
                    </span>
                  </div>
                ))}
              </div>

              {/* Try it panel */}
              <div
                style={{
                  width: 468,
                  flexShrink: 0,
                  display: "flex",
                  flexDirection: "column",
                  gap: 16,
                  padding: 22,
                  borderRadius: 16,
                  border: "1px solid rgba(255,255,255,0.09)",
                  backgroundColor: "rgba(255,255,255,0.025)",
                  opacity: interpolate(frame, [92, 116], [0, 1], {
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
                    justifyContent: "space-between",
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
                    Try it
                  </span>
                  <span
                    style={{ fontFamily: mono, fontSize: 16, color: "#6b6b7b" }}
                  >
                    live request
                  </span>
                </div>

                <Interactive.Div
                  name="Send button"
                  style={{
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    height: 48,
                    borderRadius: 11,
                    background: "linear-gradient(110deg, #5b8cff, #a974ff)",
                    fontFamily: body,
                    fontSize: 19,
                    fontWeight: 600,
                    color: "#ffffff",
                    scale: interpolate(frame, [138, 146, 156], [1, 0.965, 1], {
                      extrapolateLeft: "clamp",
                      extrapolateRight: "clamp",
                      easing: [Easing.bezier(0.4, 0, 1, 1), Easing.bezier(0, 0, 0.2, 1)],
                      output: "perceptual-scale",
                    }),
                  }}
                >
                  {frame < 150 ? "Send request" : frame < 178 ? "Sending…" : "Send request"}
                </Interactive.Div>

                <div
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: 12,
                    opacity: interpolate(frame, [178, 194], [0, 1], {
                      extrapolateLeft: "clamp",
                      extrapolateRight: "clamp",
                      easing: Easing.bezier(0.16, 1, 0.3, 1),
                    }),
                  }}
                >
                  <span
                    style={{
                      padding: "4px 11px",
                      borderRadius: 6,
                      fontFamily: mono,
                      fontSize: 17,
                      color: "#7ee0b8",
                      backgroundColor: "rgba(126,224,184,0.14)",
                    }}
                  >
                    200 OK
                  </span>
                  <span
                    style={{ fontFamily: mono, fontSize: 16, color: "#6b6b7b" }}
                  >
                    412 ms
                  </span>
                </div>

                <div
                  style={{
                    flex: 1,
                    padding: "16px 18px",
                    borderRadius: 12,
                    border: "1px solid rgba(255,255,255,0.07)",
                    backgroundColor: "rgba(0,0,0,0.35)",
                    fontFamily: mono,
                    fontSize: 18,
                    lineHeight: 1.75,
                  }}
                >
                  {RESPONSE.map((line, index) => (
                    <div
                      key={line}
                      style={{
                        color: index === 0 || index === 5 ? "#6b6b7b" : "#7ee0b8",
                        opacity: interpolate(
                          frame,
                          [192 + index * 9, 204 + index * 9],
                          [0, 1],
                          {
                            extrapolateLeft: "clamp",
                            extrapolateRight: "clamp",
                            easing: Easing.linear,
                          },
                        ),
                      }}
                    >
                      {line}
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </div>
        </BrowserFrame>
      </Stage>

      <SceneCaption label="Endpoint pages generated from your OpenAPI spec" />
    </Backdrop>
  );
};
