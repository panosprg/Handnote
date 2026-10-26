import { defineFeature } from "../core/types";
import { recognizeShape } from "./shapes";

type S = { holdMs: number };

const SNAP_TOOLS = new Set(["pen", "ballpoint", "pencil"]);

/**
 * Draw a line or shape and keep the Pencil still at the end: it snaps into a
 * clean line, angle, triangle, rectangle, circle or ellipse (like Goodnotes).
 */
export default defineFeature<S>({
  id: "shape-snap",
  name: "Hold to snap shapes",
  description: "Draw a line or shape, then hold the Pencil still at the end: it becomes a clean, straight version.",
  defaults: { holdMs: 500 },
  settings: [{ key: "holdMs", type: "slider", name: "Hold time (ms)", min: 300, max: 1000, step: 50 }],
  setup(ctx, s) {
    return ctx.pen.addFilter({
      id: "shape-snap",
      order: 20,
      start: (e) => {
        if (!SNAP_TOOLS.has(ctx.state.tool)) return null;
        let last = { x: e.clientX, y: e.clientY };
        let travelled = 0;
        let timer: number | null = null;
        let snapped = false;

        const trySnap = () => {
          timer = null;
          const el = ctx.pen.current();
          if (!el) return;
          const zoom = ctx.api.getAppState().zoom.value;
          const shape = recognizeShape(ctx.strokePoints(el), 1 / zoom);
          if (!shape) return;
          ctx.setStrokePoints(el, shape.points, shape.points.map(() => 0.55));
          ctx.pen.freeze();
          snapped = true;
          navigator.vibrate?.(8);
        };

        return {
          point: (p) => {
            if (snapped) return null;
            const d = Math.hypot(p.x - last.x, p.y - last.y);
            if (d > 2.5) {
              travelled += d;
              last = { x: p.x, y: p.y };
              if (timer !== null) window.clearTimeout(timer);
              timer = travelled > 18 ? window.setTimeout(trySnap, s().holdMs) : null;
            }
            return p;
          },
          dispose: () => {
            if (timer !== null) window.clearTimeout(timer);
          },
        };
      },
    });
  },
});
