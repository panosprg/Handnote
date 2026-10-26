import { useEffect, useRef } from "react";
import type { HandnoteContext } from "../core/context";
import { inkPx, INK_TOOLS, type InkToolId } from "../core/settings";
import { defineFeature } from "../core/types";
import "./cursor.css";

type S = { showInkDot: boolean };

/**
 * Shows where the Pencil tip is: a ring for the erasers (exactly the area they
 * erase) and a small dot in the ink colour for pens, while the Pencil hovers
 * (iPads with Pencil hover) or touches.
 */
function Cursor({ ctx, settings }: { ctx: HandnoteContext; settings: S }) {
  const ref = useRef<HTMLDivElement>(null);
  const live = useRef(settings);
  live.current = settings;

  useEffect(() => {
    const el = ref.current!;
    const hide = () => (el.style.display = "none");

    const show = (e: PointerEvent) => {
      if (e.pointerType === "touch" || ctx.state.modal) return hide();
      const tool = ctx.state.tool;
      const rect = ctx.root.getBoundingClientRect();
      const x = e.clientX - rect.left;
      const y = e.clientY - rect.top;
      if (x < 0 || y < 0 || x > rect.width || y > rect.height) return hide();

      let d = 0;
      let ring = true;
      if (tool === "precision-eraser" || tool === "object-eraser") {
        const s = ctx.featureSettings<{ size: number; objectSize: number }>("erasers");
        d = tool === "object-eraser" ? s.objectSize : s.size;
      } else if (INK_TOOLS.includes(tool as InkToolId) && live.current.showInkDot) {
        // Hover only: while drawing, the ink itself shows where the tip is.
        if (e.buttons !== 0) return hide();
        const cfg = ctx.core[tool as InkToolId];
        const zoom = ctx.api.getAppState().zoom.value;
        // Exactly as wide as the line this pen will draw, at this zoom.
        d = Math.max(2, inkPx(tool as InkToolId, cfg.width, zoom));
        ring = false;
        el.style.background = cfg.color;
        el.style.opacity = String(tool === "highlighter" ? Math.max(0.3, cfg.opacity / 100) : Math.max(0.6, cfg.opacity / 100));
      } else return hide();

      el.className = `hn-cursor ${ring ? "hn-cursor-ring" : tool === "highlighter" ? "hn-cursor-dot hn-cursor-hl" : "hn-cursor-dot"}`;
      if (ring) {
        el.style.background = "";
        el.style.opacity = "";
      }
      el.style.width = el.style.height = `${d}px`;
      el.style.transform = `translate(${x - d / 2}px, ${y - d / 2}px)`;
      el.style.display = "block";
    };

    window.addEventListener("pointermove", show, true);
    window.addEventListener("pointerdown", show, true);
    ctx.root.addEventListener("pointerleave", hide);
    const offState = ctx.events.on("state", hide);
    return () => {
      window.removeEventListener("pointermove", show, true);
      window.removeEventListener("pointerdown", show, true);
      ctx.root.removeEventListener("pointerleave", hide);
      offState();
    };
  }, [ctx]);

  return <div ref={ref} className="hn-cursor" style={{ display: "none" }} />;
}

export default defineFeature<S>({
  id: "cursor",
  name: "Pencil tip indicator",
  description: "A ring under the Pencil for the erasers, and a dot in the ink colour when the Pencil hovers over the page.",
  defaults: { showInkDot: true },
  settings: [{ key: "showInkDot", type: "toggle", name: "Show the dot for pens while hovering" }],
  Overlay: Cursor,
});
