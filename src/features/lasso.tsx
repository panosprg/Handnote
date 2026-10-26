import { useEffect, useState } from "react";
import { CaptureUpdateAction, getCommonBounds } from "@excalidraw/excalidraw";
import type { El, HandnoteContext } from "../core/context";
import { isInkElement } from "../core/tools";
import { defineFeature } from "../core/types";
import "./lasso.css";

const ID = "lasso";

type P = [number, number];

function inside(p: P, poly: P[]): boolean {
  let c = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [xi, yi] = poly[i];
    const [xj, yj] = poly[j];
    if (yi > p[1] !== yj > p[1] && p[0] < ((xj - xi) * (p[1] - yi)) / (yj - yi) + xi) c = !c;
  }
  return c;
}

/** Which elements a lasso loop (scene coordinates) catches. */
export function lassoHits(els: El[], poly: P[]): El[] {
  return els.filter((el) => {
    if (el.isDeleted || el.locked) return false;
    if (isInkElement(el) && el.points?.length) {
      const pts = el.points.map(([x, y]) => [el.x + x, el.y + y] as P);
      return pts.filter((p) => inside(p, poly)).length / pts.length >= 0.5;
    }
    return inside([el.x + el.width / 2, el.y + el.height / 2], poly);
  });
}

/** Draws the dashed loop while the Pencil goes round. */
function LassoTrail({ ctx }: { ctx: HandnoteContext }) {
  const [pts, setPts] = useState<string | null>(null);
  useEffect(() => ctx.events.on("lassoTrail" as never, ((p: string | null) => setPts(p)) as never), [ctx]);
  if (!pts) return null;
  return (
    <svg className="hn-lasso-trail" aria-hidden>
      <polyline points={pts} />
    </svg>
  );
}

export default defineFeature({
  id: ID,
  name: "Lasso select",
  description: "Draw a loop around writing to select it. Then drag it to move it, or use the rectangle select for boxes.",
  defaults: {},
  tools: [
    {
      id: ID,
      label: "Lasso",
      icon: "lasso",
      order: 40,
      activate: (c) => c.api.setActiveTool({ type: "selection" }),
    },
  ],
  setup(ctx) {
    let loop: { id: number; pts: P[]; screen: string[] } | null = null;

    const onDown = (e: PointerEvent) => {
      if (ctx.state.tool !== ID || e.pointerType === "touch" || !e.isTrusted) return;
      if ((e.target as HTMLElement)?.tagName !== "CANVAS") return;
      const st = ctx.api.getAppState();
      const p = ctx.toScene(e.clientX, e.clientY);
      // Pressing inside the current selection: let Excalidraw drag it.
      const selected = ctx.elements().filter((el) => st.selectedElementIds[el.id]);
      if (selected.length) {
        const [x1, y1, x2, y2] = getCommonBounds(selected as never);
        const pad = 14 / st.zoom.value;
        if (p.x >= x1 - pad && p.x <= x2 + pad && p.y >= y1 - pad && p.y <= y2 + pad) return;
      }
      e.stopImmediatePropagation();
      e.preventDefault();
      const r = ctx.root.getBoundingClientRect();
      loop = { id: e.pointerId, pts: [[p.x, p.y]], screen: [`${e.clientX - r.left},${e.clientY - r.top}`] };
      ctx.events.emit("lassoTrail" as never, loop.screen.join(" ") as never);
    };

    const onMove = (e: PointerEvent) => {
      if (!loop || e.pointerId !== loop.id) return;
      e.stopImmediatePropagation();
      const p = ctx.toScene(e.clientX, e.clientY);
      const r = ctx.root.getBoundingClientRect();
      loop.pts.push([p.x, p.y]);
      loop.screen.push(`${e.clientX - r.left},${e.clientY - r.top}`);
      ctx.events.emit("lassoTrail" as never, loop.screen.join(" ") as never);
    };

    const onUp = (e: PointerEvent) => {
      if (!loop || e.pointerId !== loop.id) return;
      e.stopImmediatePropagation();
      const poly = loop.pts;
      loop = null;
      ctx.events.emit("lassoTrail" as never, null as never);
      const hits = poly.length > 3 ? lassoHits(ctx.elements(), poly) : [];
      ctx.api.updateScene({
        appState: {
          selectedElementIds: Object.fromEntries(hits.map((h) => [h.id, true])) as never,
          selectedGroupIds: {},
          editingGroupId: null,
        },
        captureUpdate: CaptureUpdateAction.NEVER,
      });
      ctx.events.emit("selectionMade" as never);
    };

    ctx.root.addEventListener("pointerdown", onDown, true);
    window.addEventListener("pointermove", onMove, true);
    window.addEventListener("pointerup", onUp, true);
    window.addEventListener("pointercancel", onUp, true);
    return () => {
      ctx.root.removeEventListener("pointerdown", onDown, true);
      window.removeEventListener("pointermove", onMove, true);
      window.removeEventListener("pointerup", onUp, true);
      window.removeEventListener("pointercancel", onUp, true);
    };
  },
  Overlay: LassoTrail,
});
