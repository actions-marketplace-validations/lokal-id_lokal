import { loadFont as loadInter } from "@remotion/google-fonts/Inter";
import { loadFont as loadMono } from "@remotion/google-fonts/JetBrainsMono";
import { Easing, interpolate } from "remotion";

export const SANS = loadInter("normal", {
  weights: ["400", "500", "600", "700", "800"],
  subsets: ["latin"],
}).fontFamily;
export const MONO = loadMono("normal", {
  weights: ["400", "600"],
  subsets: ["latin"],
}).fontFamily;

export const C = {
  bg: "#0a0c10",
  panel: "#11151c",
  line: "#232a35",
  fg: "#e8edf3",
  dim: "#8b95a3",
  red: "#E5262E",
  redSoft: "rgba(229,38,46,.16)",
  leak: "#ff8a80",
  leakBg: "rgba(248,81,73,.16)",
  green: "#3fb950",
  greenText: "#7ee787",
  greenBg: "rgba(63,185,80,.15)",
  tool: "#d2a8ff",
  blue: "#79c0ff",
};

export const EASE = Easing.bezier(0.16, 1, 0.3, 1);

/** interpolate() between two keyframes, clamped, with the house easing. */
export const tween = (
  frame: number,
  [a, b]: [number, number],
  [from, to]: [number, number],
) =>
  interpolate(frame, [a, b], [from, to], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
    easing: EASE,
  });

/** 0 → 1 → 0: visible between `start` and `end`, fading over `fade` frames. */
export const window01 = (frame: number, start: number, end: number, fade = 8) =>
  Math.min(tween(frame, [start, start + fade], [0, 1]), tween(frame, [end - fade, end], [1, 0]));
