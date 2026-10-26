import { CaptureUpdateAction } from "@excalidraw/excalidraw";
import { defineFeature } from "../core/types";

type S = { oneFingerScroll: boolean; twoFingerUndo: boolean };

const MOVE_TOLERANCE = 10;

/**
 * Finger gestures (the Pencil only ever draws):
 *  - one finger drag → scroll the page
 *  - two finger tap  → undo
 * Pinch-zoom is Excalidraw's own.
 */
export default defineFeature<S>({
  id: "gestures",
  name: "Finger gestures",
  description: "One finger scrolls the page, two-finger tap undoes.",
  defaults: { oneFingerScroll: true, twoFingerUndo: true },
  settings: [
    { key: "oneFingerScroll", type: "toggle", name: "One finger scrolls" },
    { key: "twoFingerUndo", type: "toggle", name: "Two-finger tap to undo" },
  ],
  setup(ctx, s) {
    const touches = new Map<number, { sx: number; sy: number; x: number; y: number; t: number }>();
    let panning = false;
    let pair: { start: number; moved: boolean } | null = null;

    const onDown = (e: PointerEvent) => {
      if (e.pointerType !== "touch" || (e.target as HTMLElement)?.tagName !== "CANVAS") return;
      touches.set(e.pointerId, { sx: e.clientX, sy: e.clientY, x: e.clientX, y: e.clientY, t: e.timeStamp });
      if (touches.size === 1) {
        panning = false;
        pair = null;
      } else {
        panning = false;
        const first = [...touches.values()][0];
        pair = touches.size === 2 && e.timeStamp - first.t < 250 ? { start: first.t, moved: false } : null;
      }
    };

    const onMove = (e: PointerEvent) => {
      const t = touches.get(e.pointerId);
      if (!t) return;
      const dx = e.clientX - t.x;
      const dy = e.clientY - t.y;
      t.x = e.clientX;
      t.y = e.clientY;
      const travelled = Math.hypot(t.x - t.sx, t.y - t.sy);
      if (travelled > MOVE_TOLERANCE && pair) pair.moved = true;
      if (touches.size !== 1 || ctx.state.modal || !s().oneFingerScroll) return;
      const type = ctx.api.getAppState().activeTool.type;
      // Hand tool pans by itself; selection uses fingers for selecting.
      if (type === "hand" || type === "selection") return;
      if (panning || travelled > MOVE_TOLERANCE) {
        panning = true;
        const st = ctx.api.getAppState();
        ctx.api.updateScene({
          appState: { scrollX: st.scrollX + dx / st.zoom.value, scrollY: st.scrollY + dy / st.zoom.value },
          captureUpdate: CaptureUpdateAction.NEVER,
        });
      }
    };

    const onUp = (e: PointerEvent) => {
      if (!touches.has(e.pointerId)) return;
      if (pair && touches.size === 2 && !pair.moved && e.timeStamp - pair.start < 350 && s().twoFingerUndo) {
        ctx.undo();
      }
      if (touches.size <= 2) pair = null;
      touches.delete(e.pointerId);
      if (!touches.size) panning = false;
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
