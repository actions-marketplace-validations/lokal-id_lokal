import type React from "react";
import { AbsoluteFill, useCurrentFrame } from "remotion";
import { COPY, type Lang } from "../copy";
import { LokalMark } from "../parts";
import { C, MONO, SANS, tween } from "../theme";

const Glow = () => (
  <AbsoluteFill style={{ background: "radial-gradient(800px 460px at 50% 40%, rgba(229,38,46,.22), transparent 70%)" }} />
);

export const HookScene: React.FC<{ readonly lang: Lang }> = ({ lang }) => {
  const frame = useCurrentFrame();
  const t = COPY[lang];
  return (
    <AbsoluteFill style={{ backgroundColor: C.bg, fontFamily: SANS, alignItems: "center", justifyContent: "center" }}>
      <Glow />
      <div style={{ textAlign: "center", padding: "0 120px" }}>
        <div
          style={{
            whiteSpace: "pre-line",
            color: C.fg,
            fontSize: 68,
            fontWeight: 800,
            lineHeight: 1.08,
            letterSpacing: -1.8,
            opacity: tween(frame, [0, 14], [0, 1]),
            translate: `0 ${tween(frame, [0, 18], [18, 0])}px`,
          }}
        >
          {t.hook}
        </div>
        <div
          style={{
            marginTop: 26,
            color: C.dim,
            fontSize: 30,
            fontWeight: 500,
            opacity: tween(frame, [16, 30], [0, 1]),
            translate: `0 ${tween(frame, [16, 34], [12, 0])}px`,
          }}
        >
          {t.hookSub}
        </div>
      </div>
    </AbsoluteFill>
  );
};

export const OutroScene: React.FC<{ readonly lang: Lang }> = ({ lang }) => {
  const frame = useCurrentFrame();
  const t = COPY[lang];
  return (
    <AbsoluteFill style={{ backgroundColor: C.bg, fontFamily: SANS, alignItems: "center", justifyContent: "center" }}>
      <Glow />
      <div style={{ display: "flex", flexDirection: "column", alignItems: "center" }}>
        <LokalMark size={96} style={{ scale: String(tween(frame, [0, 16], [0.7, 1])), opacity: tween(frame, [0, 10], [0, 1]) }} />
        <div style={{ marginTop: 26, color: C.fg, fontSize: 60, fontWeight: 800, letterSpacing: -1.4, opacity: tween(frame, [6, 18], [0, 1]) }}>{t.outroTitle}</div>
        <div style={{ marginTop: 22, display: "flex", flexDirection: "column", gap: 12, alignItems: "center" }}>
          {t.outroPoints.map((p, i) => (
            <div
              key={p}
              style={{
                color: "#c9d1db",
                fontSize: 27,
                fontWeight: 500,
                opacity: tween(frame, [16 + i * 6, 28 + i * 6], [0, 1]),
                translate: `0 ${tween(frame, [16 + i * 6, 30 + i * 6], [10, 0])}px`,
              }}
            >
              <span style={{ color: C.green, marginRight: 12 }}>✓</span>
              {p}
            </div>
          ))}
        </div>
        <div
          style={{
            marginTop: 40,
            fontFamily: MONO,
            fontSize: 26,
            color: "#fff",
            padding: "12px 22px",
            borderRadius: 12,
            background: "rgba(229,38,46,.16)",
            border: "1px solid rgba(229,38,46,.5)",
            opacity: tween(frame, [36, 48], [0, 1]),
          }}
        >
          github.com/lokal-id/lokal
        </div>
      </div>
    </AbsoluteFill>
  );
};
