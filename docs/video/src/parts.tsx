import type React from "react";
import { Img, staticFile } from "remotion";
import { C, MONO, SANS } from "./theme";

const TOKEN = /(\[[A-Z]+_\d+\]|\b\d{4}-\d{4}-\d{4}\b|\b\d{16}\b|Budi Santoso|Siti Rahmawati)/g;

/**
 * A line of chat text. Placeholders get the extension's highlight (red tint, dotted underline); with `real`, real
 * values are marked the way a leak or a restore should read.
 */
export const RichLine: React.FC<{
  readonly text: string;
  readonly real?: "leak" | "restored";
  readonly highlight?: number; // 0–1, how strongly placeholders are highlighted
  readonly onDark?: boolean;
  readonly style?: React.CSSProperties;
}> = ({ text, real, highlight = 1, onDark = false, style }) => (
  <div style={{ whiteSpace: "pre", ...style }}>
    {text.split(TOKEN).map((part, i) => {
      if (i % 2 === 0) return <span key={i}>{part}</span>;
      if (part.startsWith("[")) {
        return (
          <span
            key={i}
            style={{
              backgroundColor: `rgba(229,38,46,${0.16 * highlight})`,
              textDecoration: highlight > 0.05 ? "underline dotted" : "none",
              textDecorationColor: C.red,
              textUnderlineOffset: 3,
              borderRadius: 3,
            }}
          >
            {part}
          </span>
        );
      }
      const leak = real === "leak";
      return (
        <span
          key={i}
          style={{
            backgroundColor: leak ? (onDark ? "rgba(248,81,73,.22)" : C.leakBg) : real === "restored" ? C.greenBg : "transparent",
            color: leak ? (onDark ? "#ffb3ab" : "#b42318") : real === "restored" ? "#116329" : undefined,
            borderRadius: 3,
            fontWeight: real ? 600 : undefined,
          }}
        >
          {part}
        </span>
      );
    })}
  </div>
);

export const LokalMark: React.FC<{ readonly size: number; readonly style?: React.CSSProperties }> = ({ size, style }) => (
  <Img src={staticFile("lokal-mark.svg")} style={{ width: size, height: size, ...style }} />
);

/** The extension's toast: dark card, Lokal mark, bottom right of the page. */
export const Toast: React.FC<{ readonly text: string; readonly style?: React.CSSProperties }> = ({ text, style }) => (
  <div
    style={{
      position: "absolute",
      display: "flex",
      gap: 12,
      alignItems: "center",
      padding: "12px 16px 12px 12px",
      background: "#111827",
      color: "#fff",
      borderRadius: 12,
      boxShadow: "0 10px 30px rgba(0,0,0,.35)",
      fontFamily: SANS,
      fontSize: 17,
      lineHeight: 1.35,
      maxWidth: 420,
      ...style,
    }}
  >
    <LokalMark size={26} style={{ flex: "none" }} />
    <span>{text}</span>
  </div>
);

export const Cursor: React.FC<{ readonly x: number; readonly y: number; readonly press?: number }> = ({ x, y, press = 0 }) => (
  <svg
    width={30}
    height={30}
    viewBox="0 0 24 24"
    style={{ position: "absolute", left: x - 3, top: y - 2, scale: String(1 - press * 0.15), transformOrigin: "3px 2px", filter: "drop-shadow(0 2px 3px rgba(0,0,0,.4))" }}
  >
    <path d="M3 2l7.5 19 2.6-7.9L21 10.5z" fill="#fff" stroke="#111" strokeWidth={1.4} strokeLinejoin="round" />
  </svg>
);

export const Keycap: React.FC<{ readonly keys: string[]; readonly style?: React.CSSProperties }> = ({ keys, style }) => (
  <div style={{ position: "absolute", display: "flex", gap: 8, ...style }}>
    {keys.map((k) => (
      <div
        key={k}
        style={{
          fontFamily: MONO,
          fontSize: 22,
          fontWeight: 600,
          color: C.fg,
          background: "#1b212b",
          border: `1px solid ${C.line}`,
          borderBottomWidth: 4,
          borderRadius: 10,
          padding: "8px 14px",
        }}
      >
        {k}
      </div>
    ))}
  </div>
);
