import type React from "react";
import { AbsoluteFill, useCurrentFrame } from "remotion";
import type { Lang } from "../copy";
import { LokalMark } from "../parts";
import { C, MONO, SANS, tween, window01 } from "../theme";

// The README demo: an agent reads a customer CSV without Lokal and with it, and the right-hand panel shows what
// the model provider receives each time. Made-up data. 2 × 240 frames at 30 fps, and it loops.
const COPY = {
  en: {
    without: "Without Lokal",
    with: "With Lokal",
    prompt: "why does the import of pelanggan.csv fail?",
    provider: "Sent to the model provider",
    leak: "Real names, NIK, and phone numbers left your machine",
    safe: "Only placeholders left your machine",
    answer: "Row 2 has a phone number in the nik column. Fixing it.",
    restored: "Real values written back on your machine",
  },
  id: {
    without: "Tanpa Lokal",
    with: "Dengan Lokal",
    prompt: "kenapa import pelanggan.csv gagal?",
    provider: "Terkirim ke penyedia model",
    leak: "Nama, NIK, dan nomor HP asli keluar dari komputermu",
    safe: "Hanya placeholder yang keluar dari komputermu",
    answer: "Baris 2 berisi nomor HP di kolom nik. Saya perbaiki.",
    restored: "Nilai asli ditulis kembali di komputermu",
  },
} as const;

const ROWS_REAL = ["Budi Santoso,3201011508950001,0812-3456-7890", "Siti Aminah,081398765432,3276014503920002"];
const ROWS_MASKED = ["[NAME_1],[NIK_1],[PHONE_1]", "[NAME_2],[PHONE_2],[NIK_2]"];
const PHASE = 240;

const TERM = { x: 40, y: 92, w: 700, h: 352 };
const PROV = { x: 820, y: 92, w: 420, h: 352 };

const Line: React.FC<{ readonly at: number; readonly local: number; readonly children: React.ReactNode; readonly style?: React.CSSProperties }> = ({ at, local, children, style }) => (
  <div style={{ opacity: tween(local, [at, at + 8], [0, 1]), translate: `0 ${tween(local, [at, at + 10], [6, 0])}px`, whiteSpace: "pre", ...style }}>{children}</div>
);

const Row: React.FC<{ readonly text: string; readonly kind: "leak" | "masked"; readonly size?: number }> = ({ text, kind, size = 17 }) => (
  <span
    style={{
      fontSize: size,
      padding: "2px 8px",
      borderRadius: 6,
      background: kind === "leak" ? "rgba(248,81,73,.18)" : "rgba(63,185,80,.15)",
      color: kind === "leak" ? "#ffb3ab" : C.greenText,
    }}
  >
    {text}
  </span>
);

export const AgentDemo: React.FC<{ readonly lang: Lang }> = ({ lang }) => {
  const frame = useCurrentFrame();
  const t = COPY[lang];
  const safe = frame >= PHASE;
  const local = frame % PHASE;
  const accent = safe ? C.green : C.red;
  const fadeAll = window01(local, 0, PHASE, 10);

  // Packets fly from the terminal to the provider while the file is read.
  const packets = [0, 1, 2, 3, 4].map((i) => {
    const start = 64 + i * 7;
    const p = tween(local, [start, start + 30], [0, 1]);
    const on = local >= start && local <= start + 30;
    return { x: TERM.x + TERM.w + 6 + p * (PROV.x - TERM.x - TERM.w - 12), on, i };
  });

  return (
    <AbsoluteFill style={{ backgroundColor: C.bg, fontFamily: SANS }}>
      <AbsoluteFill style={{ background: `radial-gradient(700px 300px at 50% -10%, ${safe ? "rgba(63,185,80,.14)" : "rgba(229,38,46,.18)"}, transparent 70%)` }} />

      <div style={{ opacity: fadeAll }}>
        {/* Phase label */}
        <div style={{ position: "absolute", top: 26, left: 0, right: 0, display: "flex", justifyContent: "center" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 12, padding: "8px 20px 8px 10px", borderRadius: 999, background: "rgba(17,21,28,.94)", border: `1px solid ${accent}55` }}>
            {safe ? (
              <LokalMark size={30} />
            ) : (
              <div style={{ width: 30, height: 30, borderRadius: 8, background: C.red, color: "#fff", display: "grid", placeItems: "center", fontWeight: 800, fontSize: 18 }}>✕</div>
            )}
            <div style={{ color: C.fg, fontSize: 26, fontWeight: 700, letterSpacing: -0.3 }}>{safe ? t.with : t.without}</div>
          </div>
        </div>

        {/* Terminal */}
        <div style={{ position: "absolute", left: TERM.x, top: TERM.y, width: TERM.w, height: TERM.h, borderRadius: 14, background: "#0d1117", border: `1px solid ${C.line}`, overflow: "hidden", boxShadow: "0 24px 60px rgba(0,0,0,.5)" }}>
          <div style={{ height: 40, background: "#161b22", display: "flex", alignItems: "center", gap: 8, padding: "0 14px", borderBottom: `1px solid ${C.line}` }}>
            {["#ff5f57", "#febc2e", "#28c840"].map((c) => (
              <div key={c} style={{ width: 11, height: 11, borderRadius: 99, background: c }} />
            ))}
            <div style={{ flex: 1, textAlign: "center", color: C.dim, fontSize: 14, fontFamily: MONO, marginRight: 50 }}>claude — ~/toko-online</div>
          </div>
          <div style={{ padding: "22px 26px", fontFamily: MONO, fontSize: 17, lineHeight: "32px", color: C.fg }}>
            <Line at={6} local={local} style={{ color: C.blue }}>
              {"> " + t.prompt.slice(0, Math.round(tween(local, [6, 34], [0, t.prompt.length])))}
            </Line>
            <Line at={40} local={local} style={{ color: C.tool }}>
              {safe ? "● lokal · read_file_masked(pelanggan.csv)" : "● Read(pelanggan.csv)"}
            </Line>
            <Line at={50} local={local} style={{ color: C.dim, paddingLeft: 22 }}>nama,nik,telepon</Line>
            {(safe ? ROWS_MASKED : ROWS_REAL).map((r, i) => (
              <Line key={r} at={56 + i * 6} local={local} style={{ paddingLeft: 14 }}>
                <Row text={r} kind={safe ? "masked" : "leak"} />
              </Line>
            ))}
            <Line at={118} local={local}>{"● " + t.answer}</Line>
            {safe ? (
              <>
                <Line at={150} local={local} style={{ color: C.tool }}>● lokal · write_file_unmasked(pelanggan.csv)</Line>
                <Line at={162} local={local} style={{ color: C.green, paddingLeft: 22 }}>{"✓ " + t.restored}</Line>
              </>
            ) : null}
          </div>
        </div>

        {/* Wire and packets */}
        <div style={{ position: "absolute", left: TERM.x + TERM.w, top: TERM.y + 160, width: PROV.x - TERM.x - TERM.w, height: 2, background: `repeating-linear-gradient(90deg, ${C.line} 0 6px, transparent 6px 12px)` }} />
        {packets.map((p) =>
          p.on ? (
            <div key={p.i} style={{ position: "absolute", left: p.x - 7, top: TERM.y + 154, width: 14, height: 14, borderRadius: 4, background: accent, boxShadow: `0 0 14px ${accent}` }} />
          ) : null,
        )}

        {/* What the provider receives */}
        <div style={{ position: "absolute", left: PROV.x, top: PROV.y, width: PROV.w, height: PROV.h, borderRadius: 14, background: "#0f1319", border: `1px solid ${local >= 90 ? accent + "88" : C.line}`, padding: 24, boxShadow: "0 24px 60px rgba(0,0,0,.5)" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 12, color: C.dim, fontSize: 17, fontWeight: 600 }}>
            <svg width={26} height={26} viewBox="0 0 24 24" fill="none" stroke={C.dim} strokeWidth={1.8}>
              <path d="M7 18a5 5 0 1 1 .9-9.9A6 6 0 0 1 19 10a4 4 0 0 1-1 8z" />
            </svg>
            {t.provider}
          </div>
          <div style={{ marginTop: 22, display: "flex", flexDirection: "column", gap: 12, fontFamily: MONO }}>
            <Line at={84} local={local} style={{ color: C.dim, fontSize: 15 }}>nama,nik,telepon</Line>
            {(safe ? ROWS_MASKED : ROWS_REAL).map((r, i) => (
              <Line key={r} at={90 + i * 6} local={local}>
                <Row text={r} kind={safe ? "masked" : "leak"} size={safe ? 17 : 13} />
              </Line>
            ))}
          </div>
          <div
            style={{
              position: "absolute",
              left: 24,
              right: 24,
              bottom: 24,
              padding: "14px 16px",
              borderRadius: 10,
              background: safe ? "rgba(63,185,80,.12)" : "rgba(229,38,46,.14)",
              border: `1px solid ${accent}66`,
              color: safe ? C.greenText : "#ffb3ab",
              fontSize: 17,
              fontWeight: 600,
              lineHeight: 1.35,
              opacity: tween(local, [104, 114], [0, 1]),
              scale: String(tween(local, [104, 116], [0.96, 1])),
            }}
          >
            {(safe ? "✓ " : "⚠ ") + (safe ? t.safe : t.leak)}
          </div>
        </div>
      </div>
    </AbsoluteFill>
  );
};
