/**
 * Page templates (paper), described once as simple shapes in page units and drawn
 * three ways: as an SVG background on screen, as small previews in the paper
 * picker, and onto a canvas for PDF export / print. So what you see is what prints.
 */
import type { Template } from "./settings";

type Colour = "line" | "strong" | "margin" | "dot" | "label";
type Shape =
  | { k: "line"; x1: number; y1: number; x2: number; y2: number; c: Colour }
  | { k: "rect"; x: number; y: number; w: number; h: number; r: number; c: Colour }
  | { k: "ellipse"; cx: number; cy: number; rx: number; ry: number; c: Colour }
  | { k: "dot"; x: number; y: number; r: number; c: Colour }
  | { k: "text"; x: number; y: number; t: string; c: Colour };

export type Palette = Record<Colour, string>;
export const LIGHT: Palette = {
  line: "rgba(70,110,170,0.18)",
  strong: "rgba(70,110,170,0.42)",
  margin: "rgba(220,80,80,0.34)",
  dot: "rgba(60,60,70,0.28)",
  label: "rgba(70,90,120,0.55)",
};
export const DARK: Palette = {
  line: "rgba(140,170,220,0.16)",
  strong: "rgba(140,170,220,0.38)",
  margin: "rgba(240,110,110,0.34)",
  dot: "rgba(220,220,230,0.22)",
  label: "rgba(180,190,210,0.55)",
};
/** A little stronger on paper. */
export const PRINT: Palette = {
  line: "rgba(70,110,170,0.28)",
  strong: "rgba(70,110,170,0.55)",
  margin: "rgba(220,80,80,0.45)",
  dot: "rgba(60,60,70,0.4)",
  label: "rgba(70,90,120,0.7)",
};

const LINE_STEP = 32;
const GRID_STEP = 24;
const LABEL_SIZE = 10;

function hLines(out: Shape[], x1: number, x2: number, y1: number, y2: number, step = LINE_STEP, c: Colour = "line") {
  for (let y = y1; y <= y2; y += step) out.push({ k: "line", x1, y1: y, x2, y2: y, c });
}
function grid(out: Shape[], x1: number, x2: number, y1: number, y2: number, step = GRID_STEP) {
  for (let y = y1; y <= y2; y += step) out.push({ k: "line", x1, y1: y, x2, y2: y, c: "line" });
  for (let x = x1; x <= x2; x += step) out.push({ k: "line", x1: x, y1, x2: x, y2, c: "line" });
}
function dots(out: Shape[], w: number, h: number, step = GRID_STEP) {
  for (let y = step; y < h; y += step) for (let x = step; x < w; x += step) out.push({ k: "dot", x, y, r: 1.3, c: "dot" });
}
const label = (out: Shape[], x: number, y: number, t: string) => out.push({ k: "text", x, y, t, c: "label" });

/** The shapes of one template on a page of w × h (page units = CSS px at 100%). */
export function templateShapes(t: Template, w: number, h: number): Shape[] {
  const s: Shape[] = [];
  switch (t) {
    case "blank":
      break;
    case "lined":
      hLines(s, 0, w, LINE_STEP, h - 1);
      break;
    case "grid":
      grid(s, 0, w, GRID_STEP, h - 1);
      break;
    case "dots":
      dots(s, w, h);
      break;
    case "cornell": {
      // Header (topic, date) · cue column · notes · summary at the bottom.
      const head = 96;
      const cue = Math.round(w * 0.3);
      const sum = Math.round(h * 0.8);
      label(s, 24, 30, "TOPIC");
      label(s, Math.round(w * 0.68), 30, "DATE");
      s.push({ k: "line", x1: 24, y1: 66, x2: Math.round(w * 0.64), y2: 66, c: "line" });
      s.push({ k: "line", x1: Math.round(w * 0.68), y1: 66, x2: w - 24, y2: 66, c: "line" });
      s.push({ k: "line", x1: 0, y1: head, x2: w, y2: head, c: "strong" });
      hLines(s, 0, w, head + LINE_STEP, sum - 8);
      s.push({ k: "line", x1: cue, y1: head, x2: cue, y2: sum, c: "strong" });
      s.push({ k: "line", x1: 0, y1: sum, x2: w, y2: sum, c: "strong" });
      hLines(s, 0, w, sum + LINE_STEP + 8, h - 16);
      label(s, 12, head + 16, "CUES");
      label(s, cue + 12, head + 16, "NOTES");
      label(s, 12, sum + 16, "SUMMARY");
      break;
    }
    case "lecture": {
      // A header box for the course, date and topic, then ruled lines with a margin.
      s.push({ k: "rect", x: 24, y: 24, w: w - 48, h: 100, r: 10, c: "strong" });
      label(s, 40, 46, "COURSE");
      s.push({ k: "line", x1: 40, y1: 70, x2: Math.round(w * 0.58), y2: 70, c: "line" });
      label(s, Math.round(w * 0.62), 46, "DATE");
      s.push({ k: "line", x1: Math.round(w * 0.62), y1: 70, x2: w - 40, y2: 70, c: "line" });
      label(s, 40, 88, "TOPIC");
      s.push({ k: "line", x1: 40, y1: 110, x2: w - 40, y2: 110, c: "line" });
      hLines(s, 0, w, 168, h - 1);
      s.push({ k: "line", x1: 80, y1: 140, x2: 80, y2: h, c: "margin" });
      break;
    }
    case "twocol": {
      // Lines on the left for explanations, grid on the right for working.
      const mid = Math.round(w / 2);
      hLines(s, 0, mid, LINE_STEP, h - 1);
      grid(s, mid, w, GRID_STEP, h - 1);
      s.push({ k: "line", x1: mid, y1: 0, x2: mid, y2: h, c: "strong" });
      break;
    }
    case "revision": {
      // Key terms · formulas · summary · questions to review, each a lined box.
      const m = 24;
      const g = 16;
      const mid = Math.round(w / 2);
      label(s, m, 30, "TOPIC");
      s.push({ k: "line", x1: m, y1: 62, x2: w - m, y2: 62, c: "line" });
      const top = 84;
      const row1 = Math.round(h * 0.42);
      const row2 = Math.round(h * 0.72);
      const boxes: [number, number, number, number, string][] = [
        [m, top, mid - g / 2, row1, "KEY TERMS"],
        [mid + g / 2, top, w - m, row1, "FORMULAS"],
        [m, row1 + g, w - m, row2, "SUMMARY"],
        [m, row2 + g, w - m, h - m, "QUESTIONS TO REVIEW"],
      ];
      for (const [x1, y1, x2, y2, name] of boxes) {
        s.push({ k: "rect", x: x1, y: y1, w: x2 - x1, h: y2 - y1, r: 12, c: "strong" });
        label(s, x1 + 12, y1 + 18, name);
        hLines(s, x1 + 12, x2 - 12, y1 + 44, y2 - 10);
      }
      break;
    }
    case "mindmap": {
      dots(s, w, h);
      s.push({ k: "ellipse", cx: w / 2, cy: h / 2, rx: 120, ry: 64, c: "strong" });
      break;
    }
    case "isometric": {
      const step = GRID_STEP;
      const rowH = step * Math.sin(Math.PI / 3);
      for (let row = 1, y = rowH; y < h; row++, y += rowH)
        for (let x = row % 2 ? step / 2 : step; x < w; x += step) s.push({ k: "dot", x, y, r: 1.3, c: "dot" });
      break;
    }
  }
  return s;
}

const f = (n: number) => Math.round(n * 10) / 10;

/** An SVG of the template (no paper colour: the sheet behind provides it). */
export function templateSvg(t: Template, w: number, h: number, p: Palette, preview = false): string {
  const shapes = templateShapes(t, w, h).filter((sh) => !(preview && sh.k === "text"));
  // Previews are tiny: keep lines a hairline wide whatever the scale, and dots visible.
  const ve = preview ? ' vector-effect="non-scaling-stroke"' : "";
  const sw = preview ? 0.8 : 1;
  // Lines and dots are merged into one path per colour: small and fast.
  const lines = new Map<Colour, string[]>();
  const dotPaths = new Map<Colour, string[]>();
  const rest: string[] = [];
  for (const sh of shapes) {
    if (sh.k === "line") {
      const arr = lines.get(sh.c) ?? [];
      // Horizontal/vertical lines sit on the half pixel so they're crisp.
      const hx = sh.x1 === sh.x2 ? 0.5 : 0;
      const hy = sh.y1 === sh.y2 ? -0.5 : 0;
      arr.push(`M${f(sh.x1 + hx)} ${f(sh.y1 + hy)}L${f(sh.x2 + hx)} ${f(sh.y2 + hy)}`);
      lines.set(sh.c, arr);
    } else if (sh.k === "dot") {
      const arr = dotPaths.get(sh.c) ?? [];
      const r = preview ? sh.r * 2.6 : sh.r;
      arr.push(`M${f(sh.x - r)} ${f(sh.y)}a${r} ${r} 0 1 0 ${f(2 * r)} 0a${r} ${r} 0 1 0 ${f(-2 * r)} 0`);
      dotPaths.set(sh.c, arr);
    } else if (sh.k === "rect") {
      rest.push(
        `<rect x="${f(sh.x + 0.5)}" y="${f(sh.y + 0.5)}" width="${f(sh.w)}" height="${f(sh.h)}" rx="${sh.r}" fill="none" stroke="${p[sh.c]}" stroke-width="${sw}"${ve}/>`,
      );
    } else if (sh.k === "ellipse") {
      rest.push(`<ellipse cx="${f(sh.cx)}" cy="${f(sh.cy)}" rx="${sh.rx}" ry="${sh.ry}" fill="none" stroke="${p[sh.c]}" stroke-width="${sw * 1.2}"${ve}/>`);
    } else {
      rest.push(
        `<text x="${f(sh.x)}" y="${f(sh.y)}" fill="${p[sh.c]}" font-family="-apple-system,Helvetica,Arial,sans-serif" font-size="${LABEL_SIZE}" font-weight="600" letter-spacing="1">${sh.t}</text>`,
      );
    }
  }
  const body = [
    ...[...lines].map(([c, d]) => `<path d="${d.join("")}" stroke="${p[c]}" stroke-width="${sw}" fill="none"${ve}/>`),
    ...[...dotPaths].map(([c, d]) => `<path d="${d.join("")}" fill="${p[c]}"/>`),
    ...rest,
  ].join("");
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}">${body}</svg>`;
}

const cache = new Map<string, string>();
/** CSS background-image value for a page (cached: pages with the same paper share it). */
export function templateCss(t: Template, w: number, h: number, dark: boolean): string {
  if (t === "blank") return "none";
  const key = `${t}|${w}|${h}|${dark ? 1 : 0}`;
  let v = cache.get(key);
  if (!v) {
    v = `url("data:image/svg+xml;charset=utf-8,${encodeURIComponent(templateSvg(t, w, h, dark ? DARK : LIGHT))}")`;
    if (cache.size > 64) cache.clear();
    cache.set(key, v);
  }
  return v;
}

/** Draws the template on a canvas (paper colour first) at `scale` px per page unit. */
export function drawTemplate(g: CanvasRenderingContext2D, t: Template, w: number, h: number, scale: number, p: Palette = PRINT) {
  g.save();
  g.fillStyle = "#ffffff";
  g.fillRect(0, 0, w * scale, h * scale);
  g.scale(scale, scale);
  g.lineWidth = 1;
  for (const sh of templateShapes(t, w, h)) {
    if (sh.k === "line") {
      g.strokeStyle = p[sh.c];
      g.beginPath();
      g.moveTo(sh.x1, sh.y1);
      g.lineTo(sh.x2, sh.y2);
      g.stroke();
    } else if (sh.k === "dot") {
      g.fillStyle = p[sh.c];
      g.beginPath();
      g.arc(sh.x, sh.y, sh.r, 0, 2 * Math.PI);
      g.fill();
    } else if (sh.k === "rect") {
      g.strokeStyle = p[sh.c];
      g.beginPath();
      g.roundRect(sh.x, sh.y, sh.w, sh.h, sh.r);
      g.stroke();
    } else if (sh.k === "ellipse") {
      g.strokeStyle = p[sh.c];
      g.lineWidth = 1.2;
      g.beginPath();
      g.ellipse(sh.cx, sh.cy, sh.rx, sh.ry, 0, 0, 2 * Math.PI);
      g.stroke();
      g.lineWidth = 1;
    } else {
      g.fillStyle = p[sh.c];
      g.font = `600 ${LABEL_SIZE}px -apple-system, Helvetica, Arial, sans-serif`;
      g.fillText(sh.t.split("").join(String.fromCharCode(8202)), sh.x, sh.y);
    }
  }
  g.restore();
}

/** Stronger colours for the small previews in the paper picker. */
const boost = (p: Palette): Palette =>
  Object.fromEntries(
    Object.entries(p).map(([k, v]) => [k, v.replace(/[\d.]+\)$/, (a) => `${Math.min(1, parseFloat(a) * 2.2)})`)]),
  ) as Palette;

/** A preview of the template: a half-size page, so lines are spaced like on screen but the layout is the same. */
export function templatePreviewCss(t: Template, dark: boolean): string {
  if (t === "blank") return "none";
  const key = `preview|${t}|${dark ? 1 : 0}`;
  let v = cache.get(key);
  if (!v) {
    v = `url("data:image/svg+xml;charset=utf-8,${encodeURIComponent(templateSvg(t, 397, 561, boost(dark ? DARK : LIGHT), true))}")`;
    cache.set(key, v);
  }
  return v;
}
