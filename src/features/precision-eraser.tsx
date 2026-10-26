import { useEffect, useRef } from "react";
import type { HandnoteContext } from "../core/context";
import { defineFeature } from "../core/types";
import { eraseAlong } from "./precision-geometry";
import "./precision-eraser.css";

type S = { size: number };
const ID = "precision-eraser";

const SIZES = [8, 14, 22, 34];

function SizePanel({ ctx }: { ctx: HandnoteContext }) {
  const { size } = ctx.featureSettings<S>(ID);
  return (
    <>
      <div className="hn-panel-title">Precision eraser</div>
      <div className="hn-label">Size</div>
      <div className="hn-row">
        {SIZES.map((s) => (
          <button
            key={s}
            className={`hn-width ${size === s ? "is-active" : ""}`}
            aria-label={`Eraser size ${s}`}
            onClick={() => ctx.updateFeatureSettings(ID, { size: s })}
          >
            <span className="hn-eraser-dot" style={{ width: Math.min(28, s * 0.8), height: Math.min(28, s * 0.8) }} />
          </button>
        ))}
      </div>
    </>
  );
}

/** The ring that follows the Pencil (hover on supported iPads, and while erasing). */
function Cursor({ ctx, settings }: { ctx: HandnoteContext; settings: S }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const show = (e: PointerEvent) => {
      const el = ref.current;
      if (!el) return;
      const on = ctx.state.tool === ID && e.pointerType !== "touch";
      el.style.display = on ? "block" : "none";
      if (!on) return;
      const rect = ctx.root.getBoundingClientRect();
      el.style.transform = `translate(${e.clientX - rect.left}px, ${e.clientY - rect.top}px)`;
    };
    const hide = () => ref.current && (ref.current.style.display = "none");
    window.addEventListener("pointermove", show, true);
    window.addEventListener("pointerdown", show, true);
    ctx.root.addEventListener("pointerleave", hide);
    return () => {
      window.removeEventListener("pointermove", show, true);
      window.removeEventListener("pointerdown", show, true);
      ctx.root.removeEventListener("pointerleave", hide);
    };
  }, [ctx]);
  const d = settings.size;
  return <div ref={ref} className="hn-eraser-cursor" style={{ width: d, height: d, marginLeft: -d / 2, marginTop: -d / 2 }} />;
}

export default defineFeature<S>({
  id: ID,
  name: "Precision eraser",
  description: "Erases only the part of a stroke you rub over (the object eraser removes whole strokes).",
  defaults: { size: 14 },
  tools: [
    {
      id: ID,
      label: "Precision eraser",
      icon: "eraser",
      order: 30,
      // Excalidraw's eraser mode: fingers still scroll; the Pencil is handled here instead.
      activate: (c) => c.api.setActiveTool({ type: "eraser", locked: true }),
      Panel: SizePanel,
    },
  ],
  setup(ctx, s) {
    let active: { id: number; last: { x: number; y: number }; changed: boolean } | null = null;

    const erase = (clientX: number, clientY: number) => {
      if (!active) return;
      const p = ctx.toScene(clientX, clientY);
      const r = s().size / 2 / ctx.api.getAppState().zoom.value;
      const res = eraseAlong(ctx.elements(true), active.last, p, r);
      active.last = p;
      if (res) {
        active.changed = true;
        ctx.replaceElements(res.next, "later");
      }
    };

    const onDown = (e: PointerEvent) => {
      if (ctx.state.tool !== ID || e.pointerType === "touch" || !e.isTrusted) return;
      if ((e.target as HTMLElement)?.tagName !== "CANVAS") return;
      e.stopImmediatePropagation();
      e.preventDefault();
      const p = ctx.toScene(e.clientX, e.clientY);
      active = { id: e.pointerId, last: p, changed: false };
      erase(e.clientX, e.clientY);
    };
    const onMove = (e: PointerEvent) => {
      if (!active || e.pointerId !== active.id) return;
      e.stopImmediatePropagation();
      // Use every sample the Pencil produced, not just one per frame.
      const samples = typeof e.getCoalescedEvents === "function" ? e.getCoalescedEvents() : [];
      for (const ev of samples.length ? samples : [e]) erase(ev.clientX, ev.clientY);
    };
    const onUp = (e: PointerEvent) => {
      if (!active || e.pointerId !== active.id) return;
      e.stopImmediatePropagation();
      if (active.changed) ctx.replaceElements(ctx.elements(true), "now"); // one undo step per stroke
      active = null;
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
  Overlay: Cursor,
});
