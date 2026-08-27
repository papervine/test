import { body, mono } from "../fonts";

/**
 * macOS-style window chrome, matching the product mock on the marketing home: three traffic
 * lights and a mono URL over a #0a0a12 body with a 1px gradient edge.
 *
 * `tone="light"` is the same chrome in the light appearance — used only where a scene needs
 * to show a *customer's* site next to ours (the widget beat) or the appearance toggle firing.
 */
export const BrowserFrame: React.FC<{
  url: string;
  tone?: "dark" | "light";
  children?: React.ReactNode;
}> = ({ url, tone = "dark", children }) => {
  return (
    <div
      style={{
        width: "100%",
        height: "100%",
        display: "flex",
        flexDirection: "column",
        overflow: "hidden",
        borderRadius: 18,
        border:
          tone === "dark"
            ? "1px solid rgba(255,255,255,0.09)"
            : "1px solid rgba(0,0,0,0.10)",
        backgroundColor: tone === "dark" ? "#0a0a12" : "#f7f7f9",
        boxShadow:
          tone === "dark"
            ? "0 40px 90px rgba(0,0,0,0.55), 0 0 0 1px rgba(169,116,255,0.10)"
            : "0 40px 90px rgba(0,0,0,0.35)",
        fontFamily: body,
      }}
    >
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 9,
          flexShrink: 0,
          padding: "14px 18px",
          borderBottom:
            tone === "dark"
              ? "1px solid rgba(255,255,255,0.06)"
              : "1px solid rgba(0,0,0,0.07)",
        }}
      >
        <div
          style={{
            width: 12,
            height: 12,
            borderRadius: 6,
            backgroundColor: "#ff5f57",
          }}
        />
        <div
          style={{
            width: 12,
            height: 12,
            borderRadius: 6,
            backgroundColor: "#febc2e",
          }}
        />
        <div
          style={{
            width: 12,
            height: 12,
            borderRadius: 6,
            backgroundColor: "#28c840",
          }}
        />
        <div
          style={{
            marginLeft: 14,
            padding: "5px 14px",
            borderRadius: 8,
            fontFamily: mono,
            fontSize: 17,
            letterSpacing: -0.2,
            color: tone === "dark" ? "#8a8a99" : "#61616c",
            backgroundColor:
              tone === "dark" ? "rgba(255,255,255,0.04)" : "rgba(0,0,0,0.04)",
          }}
        >
          {url}
        </div>
      </div>
      <div style={{ position: "relative", flex: 1, overflow: "hidden" }}>
        {children}
      </div>
    </div>
  );
};
