import type { HandnoteContext } from "../core/context";
import { defineFeature } from "../core/types";
import { eraseAlong, eraseObjectsAlong } from "./eraser-geometry";

type S = { size: number; objectSize: number };
const ID = "erasers";
export const ERASER_SIZES = [8, 14, 22, 34];
const PRECISION = "precision-eraser";
const OBJECT = "object-eraser";

function SizePanel({ ctx }: { ctx: HandnoteContext }) {
  const object = ctx.state.tool === OBJECT;
  const s = ctx.featureSettings<S>(ID);
  const key = object ? "objectSize" : "size";
  return (
    <>
      <div className="hn-panel-title">{object ? "Object eraser" : "Precision eraser"}</div>
      <div className="hn-label">Size</div>
      <div className="hn-row">
        {ERASER_SIZES.map((v) => (
          <button
            key={v}
            className={`hn-width ${s[key] === v ? "is-active" : ""}`}
            aria-label={`Eraser size ${v}`}
            onClick={() => ctx.updateFeatureSettings(ID, { [key]: v })}
          >
            <span className="hn-eraser-dot" style={{ width: Math.min(28, v * 0.8), height: Math.min(28, v * 0.8) }} />
          </button>
        ))}
      </div>
    </>
  );
}

/**
 * Both erasers are drawn by Handnote itself (not Excalidraw's eraser), so the
 * ring under the Pencil and the area that gets erased are computed the same way
 * and always line up.
 */
export default defineFeature<S>({
  id: ID,
  name: "Erasers",
  description: "Precision eraser (erases only what you rub over) and object eraser (removes whole strokes).",
  optional: false,
  defaults: { size: 14, objectSize: 14 },
  tools: [
    {
      id: PRECISION,
      label: "Precision eraser",
      icon: "eraser",
      order: 30,
      // Excalidraw's eraser mode keeps fingers scrolling; the Pencil is handled here.
      activate: (c) => c.api.setActiveTool({ type: "eraser", locked: true }),
      Panel: SizePanel,
    },
    {
      id: OBJECT,
      label: "Object eraser",
      icon: "trash-2",
      order: 31,
      activate: (c) => c.api.setActiveTool({ type: "eraser", locked: true }),
      Panel: SizePanel,
    },
  ],
  setup(ctx, s) {
    let active: { id: number; last: { x: number; y: number }; changed: boolean; object: boolean; before: ReturnType<typeof ctx.elements> } | null = null;

    const erase = (clientX: number, clientY: number) => {
      if (!active) return;
      const p = ctx.toScene(clientX, clientY);
      const size = active.object ? s().objectSize : s().size;
      const r = size / 2 / ctx.api.getAppState().zoom.value;
      if (active.object) {
        const res = eraseObjectsAlong(ctx.elements(true), active.last, p, r);
        if (res) {
          ctx.events.emit("erased", res.removed, "eraser");
          ctx.replaceElements(res.next, "later");
          active.changed = true;
        }
      } else {
        const res = eraseAlong(ctx.elements(true), active.last, p, r);
        if (res) {
          ctx.replaceElements(res.next, "later");
          active.changed = true;
        }
      }
      active.last = p;
    };

    const onDown = (e: PointerEvent) => {
      const tool = ctx.state.tool;
      if ((tool !== PRECISION && tool !== OBJECT) || e.pointerType === "touch" || !e.isTrusted) return;
      if ((e.target as HTMLElement)?.tagName !== "CANVAS") return;
      e.stopImmediatePropagation();
      e.preventDefault();
      active = {
        id: e.pointerId,
        last: ctx.toScene(e.clientX, e.clientY),
        changed: false,
        object: tool === OBJECT,
        before: ctx.elements(true),
      };
      erase(e.clientX, e.clientY);
    };
    const onMove = (e: PointerEvent) => {
      if (!active || e.pointerId !== active.id) return;
      e.stopImmediatePropagation();
      const samples = typeof e.getCoalescedEvents === "function" ? e.getCoalescedEvents() : [];
      for (const ev of samples.length ? samples : [e]) erase(ev.clientX, ev.clientY);
    };
    const onUp = (e: PointerEvent) => {
      if (!active || e.pointerId !== active.id) return;
      e.stopImmediatePropagation();
      if (active.changed) ctx.commitFrom(active.before); // one undo step per eraser stroke
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
});
