import { mono } from "../fonts";

/** A syntax-coloured run of code. Colours are chosen to read at 1080p, not to match a theme. */
export type Token = [text: string, color: string];
export type CodeLine = Token[];

/** Token palette — the plain/muted pair are the product's `--fg` / `--muted`. */
export const PUNC = "#6b6b7b";
export const KEY = "#5b8cff";
export const STR = "#7ee0b8";
export const NUM = "#ffb86b";
export const TAG = "#a974ff";
export const COMMENT = "#55556a";
export const PLAIN = "#ececf1";

/**
 * A code surface that can reveal itself character by character across the whole block:
 * pass `visibleChars` from a `typed()`-style counter and lines fill in as if being written.
 * Line boxes always render, so nothing reflows as text arrives.
 */
export const CodePanel: React.FC<{
  filename?: string;
  lines: CodeLine[];
  visibleChars?: number;
  fontSize?: number;
  highlightLine?: number;
  highlightAlpha?: number;
}> = ({
  filename,
  lines,
  visibleChars = Number.MAX_SAFE_INTEGER,
  fontSize = 20,
  highlightLine = -1,
  highlightAlpha = 0,
}) => {
  let budget = visibleChars;

  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        overflow: "hidden",
        borderRadius: 14,
        border: "1px solid rgba(255,255,255,0.08)",
        backgroundColor: "rgba(255,255,255,0.022)",
      }}
    >
      {filename ? (
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 10,
            padding: "11px 18px",
            borderBottom: "1px solid rgba(255,255,255,0.06)",
            fontFamily: mono,
            fontSize: fontSize - 4,
            color: "#8a8a99",
          }}
        >
          <div
            style={{
              width: 7,
              height: 7,
              borderRadius: 4,
              backgroundColor: "#a974ff",
            }}
          />
          {filename}
        </div>
      ) : null}
      <div style={{ padding: "16px 18px" }}>
        {lines.map((tokens, lineIndex) => {
          const isHighlighted = lineIndex === highlightLine;
          return (
            <div
              // Line order is the identity here — these are static source lines.
              key={lineIndex}
              style={{
                display: "flex",
                minHeight: fontSize * 1.62,
                alignItems: "center",
                borderRadius: 6,
                margin: "0 -8px",
                padding: "0 8px",
                fontFamily: mono,
                fontSize,
                lineHeight: 1.62,
                whiteSpace: "pre",
                backgroundColor: isHighlighted
                  ? `rgba(91,140,255,${highlightAlpha * 0.16})`
                  : "transparent",
                boxShadow: isHighlighted
                  ? `inset 2px 0 0 rgba(91,140,255,${highlightAlpha})`
                  : "none",
              }}
            >
              {tokens.map((token, tokenIndex) => {
                const take = Math.max(0, Math.min(token[0].length, budget));
                budget -= token[0].length;
                if (take === 0) {
                  return null;
                }
                return (
                  <span
                    // Token position within the line is stable.
                    key={tokenIndex}
                    style={{ color: token[1] }}
                  >
                    {token[0].slice(0, take)}
                  </span>
                );
              })}
            </div>
          );
        })}
      </div>
    </div>
  );
};
