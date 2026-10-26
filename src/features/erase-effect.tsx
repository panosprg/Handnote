import { useEffect, useState } from "react";
import type { El, HandnoteContext } from "../core/context";
import { defineFeature } from "../core/types";
import "./erase-effect.css";

type S = { style: string; duration: number };

interface Ghost {
  key: number;
  points: string;
  color: string;
  width: number;
  opacity: number;
  transform: string;
}

/** Same colour change Excalidraw applies in dark mode: invert(93%) hue-rotate(180deg). */
function darkModeColor(hex: string): string {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex.trim());
  if (!m) return hex;
  const n = parseInt(m[1], 16);
  let [r, g, b] = [(n >> 16) & 255, (n >> 8) & 255, n & 255].map((c) => c * 0.07 + (255 - c) * 0.93);
  // hue-rotate(180deg) matrix
  const R = -0.574 * r + 1.43 * g + 0.144 * b;
  const G = 0.426 * r + 0.43 * g + 0.144 * b;
  const B = 0.426 * r + 1.43 * g - 0.856 * b;
  [r, g, b] = [R, G, B].map((c) => Math.max(0, Math.min(255, Math.round(c))));
  return `rgb(${r},${g},${b})`;
}

function EraseEffect({ ctx, settings }: { ctx: HandnoteContext; settings: S }) {
  const [ghosts, setGhosts] = useState<Ghost[]>([]);

  useEffect(() => {
    let seq = 0;
    return ctx.events.on("erased", (els: El[]) => {
      if (settings.style === "none") return;
      const st = ctx.api.getAppState();
      const z = st.zoom.value;
      const dark = ctx.root.classList.contains("hn-dark");
      const fresh: Ghost[] = els
        .filter((e) => e.type === "freedraw" && e.points && e.points.length > 1)
        .map((e) => {
          const cx = e.x + e.width / 2;
          const cy = e.y + e.height / 2;
          const rot = e.angle ? ` rotate(${(e.angle * 180) / Math.PI} ${cx} ${cy})` : "";
          return {
            key: ++seq,
            points: e.points!.map(([px, py]) => `${(e.x + px).toFixed(1)},${(e.y + py).toFixed(1)}`).join(" "),
            color: dark ? darkModeColor(e.strokeColor) : e.strokeColor,
            width: Math.max(1.2, e.strokeWidth * 3.6),
            opacity: e.opacity / 100,
            transform: `translate(${st.scrollX * z} ${st.scrollY * z}) scale(${z})${rot}`,
          };
        });
      if (!fresh.length) return;
      setGhosts((g) => [...g, ...fresh]);
      const keys = new Set(fresh.map((f) => f.key));
      window.setTimeout(() => setGhosts((g) => g.filter((x) => !keys.has(x.key))), settings.duration + 80);
    });
  }, [ctx, settings.style, settings.duration]);

  return (
    <>
      {ghosts.map((g) => (
        <svg
          key={g.key}
          className={`hn-ghost hn-ghost-${settings.style}`}
          style={{ animationDuration: `${settings.duration}ms` }}
          aria-hidden
        >
          <g transform={g.transform}>
            <polyline
              points={g.points}
              pathLength={1}
              fill="none"
              stroke={g.color}
              strokeOpacity={g.opacity}
              strokeWidth={g.width}
              strokeLinecap="round"
              strokeLinejoin="round"
              style={{ animationDuration: `${settings.duration}ms` }}
            />
          </g>
        </svg>
      ))}
    </>
  );
}

export default defineFeature<S>({
  id: "erase-effect",
  name: "Erase animation",
  description: "Erased strokes blur and un-draw themselves instead of vanishing.",
  defaults: { style: "retract", duration: 650 },
  settings: [
    { key: "style", type: "dropdown", name: "Style", options: { retract: "Blur and un-draw", fade: "Blur and fade", none: "None" } },
    { key: "duration", type: "slider", name: "Duration (ms)", min: 300, max: 1200, step: 50 },
  ],
  Overlay: EraseEffect,
});
