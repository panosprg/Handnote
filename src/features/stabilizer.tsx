import type { El, HandnoteContext } from "../core/context";
import type { PenPoint } from "../core/pen";
import { defineFeature } from "../core/types";

type S = { writing: number; highlighter: number };

/* ------------------------------------------------------------------ */
/* Live part: a light 1€ filter. Kept light on purpose: heavy live     */
/* smoothing lags behind the Pencil and cuts the corners of letters.   */
/* ------------------------------------------------------------------ */

class LowPass {
  y: number | null = null;
  filter(x: number, a: number) {
    this.y = this.y === null ? x : a * x + (1 - a) * this.y;
    return this.y;
  }
}

class OneEuro {
  private x = new LowPass();
  private dx = new LowPass();
  private lastT: number | null = null;
  constructor(private minCutoff: number, private beta: number) {}
  private alpha(cutoff: number, dt: number) {
    const tau = 1 / (2 * Math.PI * cutoff);
    return 1 / (1 + tau / dt);
  }
  filter(v: number, t: number) {
    const dt = this.lastT === null ? 1 / 120 : Math.max(1e-3, t - this.lastT);
    this.lastT = t;
    const prev = this.x.y;
    const speed = this.dx.filter(prev === null ? 0 : (v - prev) / dt, this.alpha(1, dt));
    return this.x.filter(v, this.alpha(this.minCutoff + this.beta * Math.abs(speed), dt));
  }
}

const lerp = (a: number, b: number, t: number) => a + (b - a) * t;

/* ------------------------------------------------------------------ */
/* After-lift part: Savitzky–Golay smoothing. It looks at points on    */
/* both sides of each point (no lag), so it removes tremor while       */
/* keeping the shape: an "o" stays round, an "n" keeps its arch.       */
/* ------------------------------------------------------------------ */

function resample(pts: [number, number][], pr: number[], step: number) {
  const out: [number, number][] = [pts[0]];
  const outP: number[] = [pr[0] ?? 0.5];
  let carry = 0;
  for (let i = 1; i < pts.length; i++) {
    const [x0, y0] = pts[i - 1];
    const [x1, y1] = pts[i];
    const seg = Math.hypot(x1 - x0, y1 - y0);
    let d = step - carry;
    while (d <= seg) {
      const t = d / seg;
      out.push([x0 + (x1 - x0) * t, y0 + (y1 - y0) * t]);
      outP.push(lerp(pr[i - 1] ?? 0.5, pr[i] ?? 0.5, t));
      d += step;
    }
    carry = seg - (d - step);
  }
  const last = pts[pts.length - 1];
  const tail = out[out.length - 1];
  if (Math.hypot(last[0] - tail[0], last[1] - tail[1]) > step * 0.25) {
    out.push(last);
    outP.push(pr[pr.length - 1] ?? 0.5);
  }
  return { pts: out, pr: outP };
}

/** Quadratic Savitzky–Golay smoothing with half-window m; the window shrinks near the ends. */
export function savitzkyGolay(pts: [number, number][], m: number): [number, number][] {
  const n = pts.length;
  return pts.map((p, i) => {
    const k = Math.min(m, i, n - 1 - i);
    if (k < 1) return p;
    const norm = (2 * k - 1) * (2 * k + 1) * (2 * k + 3);
    let sx = 0, sy = 0;
    for (let j = -k; j <= k; j++) {
      const c = (3 * (3 * k * k + 3 * k - 1) - 15 * j * j) / norm;
      sx += c * pts[i + j][0];
      sy += c * pts[i + j][1];
    }
    return [sx, sy];
  });
}

export function cleanStroke(ctx: HandnoteContext, el: El, strength: number) {
  const pts = ctx.strokePoints(el);
  if (pts.length < 5 || strength <= 0) return;
  const zoom = ctx.api.getAppState().zoom.value;
  const s = strength / 100;
  const step = 1.2 / zoom; // resample every ~1.2 screen px
  const pr = el.pressures && el.pressures.length === pts.length ? [...el.pressures] : pts.map(() => 0.5);
  const r = resample(pts, pr, step);
  if (r.pts.length < 5) return;
  const halfWindowPx = 0.8 + 3.2 * s; // how much wobble gets ironed out, in screen pixels
  const m = Math.max(1, Math.round(halfWindowPx / 1.2));
  const smoothed = savitzkyGolay(r.pts, m);
  ctx.setStrokePoints(el, smoothed, el.simulatePressure ? undefined : r.pr);
}

export default defineFeature<S>({
  id: "stabilizer",
  name: "Stroke stabilization",
  description:
    "Removes hand wobble without changing the shape of your letters: a light touch while you write, then a shape-preserving clean-up when you lift the Pencil.",
  defaults: { writing: 35, highlighter: 60 },
  settings: [
    { key: "writing", type: "slider", name: "Pens and pencil", min: 0, max: 100, step: 5 },
    { key: "highlighter", type: "slider", name: "Highlighter", min: 0, max: 100, step: 5 },
  ],
  setup(ctx, s) {
    return ctx.pen.addFilter({
      id: "stabilizer",
      order: 50,
      start: () => {
        const level = ctx.state.tool === "highlighter" ? s().highlighter : s().writing;
        if (level <= 0) return null;
        const k = level / 100;
        const fx = new OneEuro(lerp(12, 3, k), lerp(0.05, 0.015, k));
        const fy = new OneEuro(lerp(12, 3, k), lerp(0.05, 0.015, k));
        return {
          point: (p: PenPoint) => ({ ...p, x: fx.filter(p.x, p.t), y: fy.filter(p.y, p.t) }),
          finish: (el, held) => {
            if (!held) cleanStroke(ctx, el, level);
          },
        };
      },
    });
  },
  InkPanelSection({ ctx, settings }) {
    const key = ctx.inkTarget() === "highlighter" ? "highlighter" : "writing";
    const v = settings[key];
    return (
      <>
        <div className="hn-label">
          Stabilization <span className="hn-value">{v === 0 ? "Off" : v}</span>
        </div>
        <input
          className="hn-slider"
          type="range"
          min={0}
          max={100}
          step={5}
          value={v}
          onChange={(e) => ctx.updateFeatureSettings("stabilizer", { [key]: Number(e.target.value) })}
        />
      </>
    );
  },
});
