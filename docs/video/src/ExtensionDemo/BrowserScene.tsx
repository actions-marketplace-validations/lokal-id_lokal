import { measureText } from "@remotion/layout-utils";
import type React from "react";
import { AbsoluteFill, interpolate, useCurrentFrame } from "remotion";
import { COPY, type Lang } from "../copy";
import { Cursor, Keycap, LokalMark, RichLine, Toast } from "../parts";
import { C, EASE, MONO, SANS, tween, window01 } from "../theme";

// The browser window and the chat page inside it, in composition pixels.
const WIN = { x: 100, y: 104, w: 1080, h: 586 };
const PAGE_TOP = WIN.y + 46;
const COL = { x: 250, w: 780 };
const CHAT_FONT = 17;
const REPLY = { x: COL.x + 44, y: 312, line: 30 };
const INPUT = { x: COL.x, y: 584, w: COL.w, h: 88 };
const SEND = { x: INPUT.x + INPUT.w - 34, y: INPUT.y + INPUT.h - 34 };
const COPY_BTN = { x: REPLY.x + 14, y: REPLY.y + 3 * REPLY.line + 22 };

// Beats of this scene, in frames at 30 fps.
export const BEAT = {
  paste: 46, // Ctrl+V
  masked: 84, // masked text lands in the editor
  send: 196,
  replyStart: 236,
  replyEnd: 316,
  hover: 352,
  copy: 470,
  end: 600,
};
const STEP_STARTS = [0, 92, 200, 340, 452];

/** Where the cursor is at `frame`: eased moves between waypoints. */
function cursorAt(frame: number, points: Array<[number, number, number]>) {
  let [, x, y] = points[0]!;
  for (let i = 1; i < points.length; i++) {
    const [f0, x0, y0] = points[i - 1]!;
    const [f1, x1, y1] = points[i]!;
    if (frame <= f0) break;
    const p = interpolate(frame, [f0, f1], [0, 1], { extrapolateLeft: "clamp", extrapolateRight: "clamp", easing: EASE });
    x = x0 + (x1 - x0) * p;
    y = y0 + (y1 - y0) * p;
  }
  return { x, y };
}

const press = (frame: number, at: number) =>
  interpolate(frame, [at - 3, at, at + 5], [0, 1, 0], { extrapolateLeft: "clamp", extrapolateRight: "clamp" });

export const BrowserScene: React.FC<{ readonly lang: Lang }> = ({ lang }) => {
  const frame = useCurrentFrame();
  const t = COPY[lang];

  // Where [NAME_1] sits in the second reply line, for the hover.
  const line = t.reply[1];
  const before = line.slice(0, line.indexOf("[NAME_1]"));
  const font = { fontFamily: SANS, fontSize: CHAT_FONT, fontWeight: "400" as const };
  const nameX = REPLY.x + measureText({ text: before, ...font }).width + measureText({ text: "[NAME_1]", ...font }).width / 2;
  const nameY = REPLY.y + REPLY.line + 12;

  const cursor = cursorAt(frame, [
    [0, 980, 700],
    [36, INPUT.x + 260, INPUT.y + 40],
    [170, INPUT.x + 260, INPUT.y + 40],
    [192, SEND.x, SEND.y],
    [320, SEND.x, SEND.y],
    [348, nameX, nameY],
    [440, nameX, nameY],
    [466, COPY_BTN.x, COPY_BTN.y],
  ]);

  const step = STEP_STARTS.filter((s) => frame >= s).length - 1;
  const stepOpacity = Math.min(...STEP_STARTS.map((s, i) => (i === step ? tween(frame, [s, s + 10], [0, 1]) : 1)));

  const sent = frame >= BEAT.send;
  const editorText = frame >= BEAT.masked && !sent ? t.masked : null;
  const replyChars = Math.round(tween(frame, [BEAT.replyStart, BEAT.replyEnd], [0, t.reply.join("\n").length]));
  const replyLines = t.reply.join("\n").slice(0, replyChars).split("\n");
  // Camera: point (fx, fy) of the page is shown at the screen point (640, 390), magnified z times. In on the
  // composer while pasting, on the conversation while it answers, out again for the copy.
  const k = (input: number[], output: number[]) =>
    interpolate(frame, input, output, { extrapolateLeft: "clamp", extrapolateRight: "clamp", easing: EASE });
  const camFrames = [20, 50, 186, 214, 330, 360, 452, 482];
  const cam = {
    z: k(camFrames, [1, 1.32, 1.32, 1.22, 1.22, 1.38, 1.38, 1]),
    fx: k(camFrames, [640, 640, 640, 640, 640, 560, 560, 640]),
    fy: k(camFrames, [390, 548, 548, 300, 300, 345, 345, 390]),
  };
  const clipboardIn = window01(frame, BEAT.paste + 2, BEAT.masked + 6, 10);

  return (
    <AbsoluteFill style={{ backgroundColor: C.bg, fontFamily: SANS }}>
      <AbsoluteFill style={{ background: "radial-gradient(900px 420px at 50% 0%, rgba(229,38,46,.18), transparent 70%)" }} />

      <div style={{ position: "absolute", inset: 0, transformOrigin: "0 0", translate: `${640 - cam.fx * cam.z}px ${390 - cam.fy * cam.z}px`, scale: String(cam.z) }}>
      {/* Browser window */}
      <div style={{ position: "absolute", left: WIN.x, top: WIN.y, width: WIN.w, height: WIN.h, borderRadius: 14, overflow: "hidden", background: "#fff", boxShadow: "0 30px 80px rgba(0,0,0,.55)", border: "1px solid #2a313c" }}>
        <div style={{ height: 46, background: "#eceff3", display: "flex", alignItems: "center", gap: 10, padding: "0 16px", borderBottom: "1px solid #dde1e6" }}>
          {["#ff5f57", "#febc2e", "#28c840"].map((c) => (
            <div key={c} style={{ width: 12, height: 12, borderRadius: 99, background: c }} />
          ))}
          <div style={{ marginLeft: 16, flex: 1, height: 28, borderRadius: 8, background: "#fff", border: "1px solid #dde1e6", display: "flex", alignItems: "center", padding: "0 12px", color: "#5b6573", fontSize: 14 }}>
            asisten.contoh/chat
          </div>
          <div style={{ position: "relative", marginLeft: 6 }}>
            <LokalMark size={24} />
            {frame >= BEAT.masked ? (
              <div style={{ position: "absolute", right: -8, bottom: -6, minWidth: 16, height: 16, padding: "0 4px", borderRadius: 8, background: "#111827", color: "#fff", fontSize: 11, fontWeight: 700, display: "grid", placeItems: "center", scale: String(tween(frame, [BEAT.masked, BEAT.masked + 8], [0.4, 1])) }}>
                6
              </div>
            ) : null}
          </div>
        </div>

        <div style={{ position: "absolute", left: 24, top: 66, display: "flex", alignItems: "center", gap: 10, color: "#1f2937", fontWeight: 700, fontSize: 17 }}>
          <div style={{ width: 26, height: 26, borderRadius: 8, background: "linear-gradient(135deg,#6366f1,#22d3ee)" }} />
          Asisten AI
        </div>
      </div>

      {/* Chat page content, in composition coordinates */}
      <div style={{ position: "absolute", inset: 0, color: "#1f2937", fontSize: CHAT_FONT, lineHeight: `${REPLY.line - 8}px` }}>
        {sent ? (
          <div
            style={{
              position: "absolute",
              right: 1280 - (COL.x + COL.w),
              top: PAGE_TOP + 26,
              background: "#f1f3f6",
              borderRadius: 18,
              padding: "12px 18px",
              opacity: tween(frame, [BEAT.send, BEAT.send + 8], [0, 1]),
              translate: `0 ${tween(frame, [BEAT.send, BEAT.send + 10], [10, 0])}px`,
            }}
          >
            {t.masked.map((l) => (
              <RichLine key={l} text={l} />
            ))}
          </div>
        ) : null}

        {frame >= BEAT.send + 14 ? (
          <>
            <div style={{ position: "absolute", left: COL.x, top: REPLY.y - 4, width: 30, height: 30, borderRadius: 9, background: "linear-gradient(135deg,#6366f1,#22d3ee)" }} />
            {frame < BEAT.replyStart ? (
              <div style={{ position: "absolute", left: REPLY.x, top: REPLY.y + 6, display: "flex", gap: 6 }}>
                {[0, 1, 2].map((i) => (
                  <div key={i} style={{ width: 8, height: 8, borderRadius: 9, background: "#9aa3af", opacity: 0.35 + 0.65 * Math.abs(Math.sin((frame - i * 5) / 6)) }} />
                ))}
              </div>
            ) : (
              <div style={{ position: "absolute", left: REPLY.x, top: REPLY.y }}>
                {replyLines.map((l, i) => (
                  <RichLine key={i} text={l} style={{ height: REPLY.line, lineHeight: `${REPLY.line}px` }} />
                ))}
              </div>
            )}
            {frame >= BEAT.replyEnd ? (
              <div
                style={{
                  position: "absolute",
                  left: COPY_BTN.x - 14,
                  top: COPY_BTN.y - 15,
                  height: 30,
                  padding: "0 10px",
                  display: "flex",
                  alignItems: "center",
                  gap: 6,
                  borderRadius: 8,
                  color: "#4b5563",
                  fontSize: 14,
                  background: frame >= BEAT.copy - 20 ? "#eef0f3" : "transparent",
                  scale: String(1 - press(frame, BEAT.copy) * 0.08),
                  opacity: tween(frame, [BEAT.replyEnd, BEAT.replyEnd + 8], [0, 1]),
                }}
              >
                <svg width={16} height={16} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
                  <rect x="9" y="9" width="12" height="12" rx="2" />
                  <path d="M5 15V5a2 2 0 0 1 2-2h10" />
                </svg>
                {lang === "id" ? "Salin" : "Copy"}
              </div>
            ) : null}
          </>
        ) : null}

        {/* Composer */}
        <div style={{ position: "absolute", left: INPUT.x, top: INPUT.y, width: INPUT.w, height: INPUT.h, borderRadius: 20, border: `1.5px solid ${frame >= 30 && !sent ? "#b8c0cc" : "#dde1e6"}`, background: "#fff", boxShadow: "0 4px 18px rgba(15,23,42,.06)" }}>
          <div style={{ position: "absolute", left: 20, top: 12, fontSize: 15.5, lineHeight: "21px", color: editorText ? "#1f2937" : "#9aa3af" }}>
            {editorText ? (
              <div style={{ opacity: tween(frame, [BEAT.masked, BEAT.masked + 8], [0, 1]) }}>
                {editorText.map((l) => (
                  <RichLine key={l} text={l} highlight={tween(frame, [BEAT.masked + 6, BEAT.masked + 20], [0, 1])} />
                ))}
              </div>
            ) : (
              <div style={{ paddingTop: 20 }}>{t.placeholder}</div>
            )}
          </div>
          <div style={{ position: "absolute", left: INPUT.w - 52, top: INPUT.h - 52, width: 36, height: 36, borderRadius: 99, background: editorText ? "#111827" : "#d1d5db", display: "grid", placeItems: "center", scale: String(1 - press(frame, BEAT.send) * 0.12) }}>
            <svg width={18} height={18} viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth={2.6} strokeLinecap="round" strokeLinejoin="round">
              <path d="M12 19V5M5 12l7-7 7 7" />
            </svg>
          </div>
        </div>
      </div>

      {/* The clipboard: what you pasted, on your machine */}
      <div
        style={{
          position: "absolute",
          left: INPUT.x + 30,
          top: INPUT.y - 150,
          padding: "14px 18px",
          borderRadius: 14,
          background: "#161b22",
          border: `1px solid ${C.line}`,
          boxShadow: "0 18px 50px rgba(0,0,0,.5)",
          color: C.fg,
          fontSize: 15,
          lineHeight: "22px",
          opacity: clipboardIn,
          translate: `0 ${tween(frame, [BEAT.masked - 6, BEAT.masked + 6], [0, 60])}px`,
          scale: String(tween(frame, [BEAT.masked - 6, BEAT.masked + 6], [1, 0.9])),
        }}
      >
        <div style={{ fontFamily: MONO, fontSize: 12, letterSpacing: 1.2, color: C.dim, marginBottom: 6 }}>CLIPBOARD</div>
        {t.pasted.map((l) => (
          <RichLine key={l} text={l} real="leak" onDark style={{ color: C.fg }} />
        ))}
      </div>
      <Keycap keys={["Ctrl", "V"]} style={{ left: INPUT.x + 300, top: INPUT.y + 100, opacity: window01(frame, BEAT.paste - 10, BEAT.paste + 30, 6) }} />

      {/* Tooltip on hover, as the extension draws it */}
      <div
        style={{
          position: "absolute",
          left: nameX - 20,
          top: nameY - 72,
          padding: "8px 12px",
          background: "#111827",
          color: "#fff",
          borderRadius: 10,
          boxShadow: "0 10px 30px rgba(0,0,0,.35)",
          opacity: window01(frame, BEAT.hover, 444, 6),
        }}
      >
        <div style={{ fontSize: 12, color: "#9ca3af" }}>{t.reveal}</div>
        <div style={{ fontFamily: MONO, fontWeight: 600, fontSize: 16 }}>Budi Santoso</div>
      </div>

      {/* Pasted elsewhere: the real values are back */}
      <div
        style={{
          position: "absolute",
          left: 540,
          top: 372,
          width: 690,
          borderRadius: 14,
          overflow: "hidden",
          background: "#fffdf5",
          boxShadow: "0 30px 70px rgba(0,0,0,.55)",
          border: "1px solid #e5dcc0",
          opacity: tween(frame, [BEAT.copy + 30, BEAT.copy + 42], [0, 1]),
          translate: `${tween(frame, [BEAT.copy + 30, BEAT.copy + 46], [60, 0])}px 0`,
        }}
      >
        <div style={{ height: 36, background: "#f4ecd2", display: "flex", alignItems: "center", padding: "0 14px", fontSize: 14, fontWeight: 600, color: "#6b5b2a" }}>{t.notes}</div>
        <div style={{ padding: "16px 20px", fontSize: 17, lineHeight: "30px", color: "#1f2937" }}>
          {t.restored.map((l) => (
            <RichLine key={l} text={l} real="restored" />
          ))}
        </div>
      </div>

      <Cursor x={cursor.x} y={cursor.y} press={Math.max(press(frame, BEAT.send), press(frame, BEAT.copy))} />
      </div>

      <Toast text={t.toastMasked} style={{ right: 28, bottom: 28, opacity: window01(frame, BEAT.masked + 4, BEAT.send - 4, 8) }} />
      <Toast text={t.toastCopied} style={{ right: 28, bottom: 28, opacity: window01(frame, BEAT.copy + 4, BEAT.copy + 60, 8) }} />

      {/* Step caption */}
      <div style={{ position: "absolute", top: 30, left: 0, right: 0, display: "flex", justifyContent: "center", opacity: stepOpacity, translate: `0 ${(1 - stepOpacity) * 8}px` }}>
        <div style={{ display: "flex", alignItems: "center", gap: 14, padding: "10px 22px 10px 12px", borderRadius: 999, background: "rgba(17,21,28,.94)", boxShadow: "0 10px 30px rgba(0,0,0,.45)", border: `1px solid ${C.line}` }}>
          <div style={{ width: 34, height: 34, borderRadius: 999, background: C.red, color: "#fff", fontWeight: 800, fontSize: 19, display: "grid", placeItems: "center" }}>{step + 1}</div>
          <div style={{ color: C.fg, fontSize: 28, fontWeight: 600, letterSpacing: -0.3 }}>{t.steps[step]}</div>
        </div>
      </div>

    </AbsoluteFill>
  );
};
