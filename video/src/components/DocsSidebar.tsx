import { body } from "../fonts";

export type NavItem = {
  label: string;
  active?: boolean;
  /** 0 = fully hidden, 1 = fully present. Drives the reader-auth nav-hiding beat. */
  presence?: number;
  badge?: "GET" | "POST" | "DEL";
};

export type NavGroup = { group: string; items: NavItem[] };

const BADGE_COLOR: Record<string, string> = {
  GET: "#5b8cff",
  POST: "#7ee0b8",
  DEL: "#ff7a7a",
};

/**
 * The docs navigation as the renderer builds it: group headings in caps, indented page rows,
 * the active row carrying the brand tint. `presence` exists so a scene can dissolve a row out
 * of the list — reader-gated pages don't render as locked rows, they aren't in the nav at all.
 */
export const DocsSidebar: React.FC<{
  groups: NavGroup[];
  tone?: "dark" | "light";
  width?: number;
  /** Row metrics, so a scene that shows the nav as its subject can render it larger. */
  rowHeight?: number;
  labelSize?: number;
}> = ({ groups, tone = "dark", width = 260, rowHeight = 36, labelSize = 17 }) => {
  return (
    <div
      style={{
        width,
        flexShrink: 0,
        padding: "26px 22px",
        borderRight:
          tone === "dark"
            ? "1px solid rgba(255,255,255,0.06)"
            : "1px solid rgba(0,0,0,0.07)",
        fontFamily: body,
      }}
    >
      {groups.map((group) => (
        <div key={group.group} style={{ marginBottom: 26 }}>
          <div
            style={{
              marginBottom: 12,
              fontSize: 13,
              fontWeight: 600,
              letterSpacing: 1.6,
              textTransform: "uppercase",
              color: tone === "dark" ? "#6b6b7b" : "#8a8a99",
            }}
          >
            {group.group}
          </div>
          {group.items.map((item) => (
            <div
              key={item.label}
              style={{
                display: "flex",
                alignItems: "center",
                gap: 8,
                height: (item.presence ?? 1) * rowHeight,
                marginBottom: (item.presence ?? 1) * 2,
                paddingLeft: 10,
                paddingRight: 8,
                borderRadius: 8,
                overflow: "hidden",
                opacity: item.presence ?? 1,
                fontSize: labelSize,
                color: item.active
                  ? "#5b8cff"
                  : tone === "dark"
                    ? "#a8a8b6"
                    : "#4a4a55",
                backgroundColor: item.active
                  ? "rgba(91,140,255,0.10)"
                  : "transparent",
              }}
            >
              {item.badge ? (
                <span
                  style={{
                    flexShrink: 0,
                    padding: "2px 6px",
                    borderRadius: 5,
                    fontSize: 11,
                    fontWeight: 600,
                    letterSpacing: 0.4,
                    color: BADGE_COLOR[item.badge],
                    backgroundColor: `${BADGE_COLOR[item.badge]}1f`,
                  }}
                >
                  {item.badge}
                </span>
              ) : null}
              {item.label}
            </div>
          ))}
        </div>
      ))}
    </div>
  );
};
