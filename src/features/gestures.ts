import { CaptureUpdateAction } from "@excalidraw/excalidraw";
import { totalHeight } from "../core/pages";
import { defineFeature } from "../core/types";
import "./gestures.css";

type S = { oneFingerScroll: boolean; twoFingerUndo: boolean; threeFingerRedo: boolean; pullToAddPage: boolean };

/** Empty space below the last page (px on screen) where the pull starts, and how far to pull. */
const PULL_START = 90;
const PULL_LENGTH = 150;

const MOVE_TOLERANCE = 10;
const MIN_ZOOM = 0.25;
const MAX_ZOOM = 5;

/**
 * Fingers move the page, the Pencil writes:
 *  - one finger drag   → scroll
 *  - two finger pinch  → zoom (with any tool) and move
 *  - two finger tap    → undo, three finger tap → redo
 *
 * Excalidraw blocks pinch-zoom while drawing in pen mode, so for drawing tools
 * Handnote takes over touches completely and Excalidraw never sees them.
 */
export default defineFeature<S>({
  id: "gestures",
  name: "Finger gestures",
  description:
    "Scroll with one finger, pinch to zoom, two-finger tap to undo, three-finger tap to redo. On the last page, swipe up past the end and let go to add a page.",
  defaults: { oneFingerScroll: true, twoFingerUndo: true, threeFingerRedo: true, pullToAddPage: true },
  settings: [
    { key: "oneFingerScroll", type: "toggle", name: "One finger scrolls" },
    { key: "twoFingerUndo", type: "toggle", name: "Two-finger tap to undo" },
    { key: "threeFingerRedo", type: "toggle", name: "Three-finger tap to redo" },
    { key: "pullToAddPage", type: "toggle", name: "Swipe up past the last page to add a page" },
  ],
  setup(ctx, s) {
    type T = { sx: number; sy: number; x: number; y: number; t: number };
    const touches = new Map<number, T>();
    let panning = false;
    let tap: { start: number; count: number; moved: boolean } | null = null;
    let pinch: { dist: number; zoom: number; cx: number; cy: number } | null = null;

    // Tools where fingers only navigate. (Select and text keep fingers for themselves.)
    const owns = () => {
      const type = ctx.api.getAppState().activeTool.type;
      return type === "freedraw" || type === "eraser" || type === "hand" || type === "laser";
    };

    const rel = (x: number, y: number) => {
      const r = ctx.root.getBoundingClientRect();
      return { x: x - r.left, y: y - r.top };
    };

    const centre = () => {
      const pts = [...touches.values()];
      const c = pts.reduce((a, p) => ({ x: a.x + p.x / pts.length, y: a.y + p.y / pts.length }), { x: 0, y: 0 });
      const d = pts.length >= 2 ? Math.hypot(pts[0].x - pts[1].x, pts[0].y - pts[1].y) : 0;
      return { ...rel(c.x, c.y), d };
    };

    const startPinch = () => {
      const c = centre();
      pinch = { dist: Math.max(1, c.d), zoom: ctx.api.getAppState().zoom.value, cx: c.x, cy: c.y };
    };

    // Swipe-up-to-add-page hint, shown in the empty space under the last page.
    const hint = document.createElement("div");
    hint.className = "hn-pull-hint";
    hint.innerHTML = `<span class="hn-pull-ring"><span class="hn-pull-plus">+</span></span><span class="hn-pull-text">Pull up to add a page</span>`;
    ctx.root.appendChild(hint);
    let pullArmed = false;
    const pullProgress = () => {
      const bottom = ctx.toScreen(0, totalHeight(ctx.state.pages)).y;
      const gap = ctx.root.clientHeight - bottom;
      return { bottom, p: Math.max(0, Math.min(1, (gap - PULL_START) / PULL_LENGTH)), gap };
    };
    const showPull = () => {
      if (!s().pullToAddPage) return;
      const { bottom, p, gap } = pullProgress();
      const visible = gap > PULL_START * 0.6;
      hint.classList.toggle("is-visible", visible);
      hint.classList.toggle("is-armed", p >= 1);
      hint.style.top = `${Math.max(bottom + 24, 0)}px`;
      hint.style.setProperty("--hn-pull", String(p));
      const text = hint.querySelector(".hn-pull-text")!;
      text.textContent = p >= 1 ? "Let go to add a page" : "Pull up to add a page";
      if (p >= 1 && !pullArmed && navigator.vibrate) navigator.vibrate(8);
      pullArmed = p >= 1;
    };
    const hidePull = () => {
      hint.classList.remove("is-visible", "is-armed");
      pullArmed = false;
    };

    const view = (zoom: number, scrollX: number, scrollY: number) =>
      ctx.api.updateScene({
        appState: { zoom: { value: zoom as never }, scrollX, scrollY },
        captureUpdate: CaptureUpdateAction.NEVER,
      });

    /** Window capture: runs first, does the work. */
    const onDown = (e: PointerEvent) => {
      if (e.pointerType !== "touch" || !ctx.root.contains(e.target as Node)) return;
      if ((e.target as HTMLElement).tagName !== "CANVAS" || ctx.claimedTouches.has(e.pointerId)) return;
      touches.set(e.pointerId, { sx: e.clientX, sy: e.clientY, x: e.clientX, y: e.clientY, t: e.timeStamp });
      panning = false;
      if (touches.size === 1) tap = { start: e.timeStamp, count: 1, moved: false };
      else if (tap && e.timeStamp - tap.start < 250) tap.count = touches.size;
      else tap = null;
      if (touches.size >= 2) startPinch();
    };

    const onMove = (e: PointerEvent) => {
      const t = touches.get(e.pointerId);
      if (!t) return;
      const dx = e.clientX - t.x;
      const dy = e.clientY - t.y;
      t.x = e.clientX;
      t.y = e.clientY;
      if (Math.hypot(t.x - t.sx, t.y - t.sy) > MOVE_TOLERANCE && tap) tap.moved = true;
      if (ctx.state.modal || !owns()) return;

      const st = ctx.api.getAppState();
      if (touches.size >= 2 && pinch) {
        const c = centre();
        const z1 = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, pinch.zoom * (c.d / pinch.dist)));
        // The scene point that was under the fingers stays under the fingers (zoom + move together).
        const anchorX = pinch.cx / st.zoom.value - st.scrollX;
        const anchorY = pinch.cy / st.zoom.value - st.scrollY;
        pinch.cx = c.x;
        pinch.cy = c.y;
        view(z1, c.x / z1 - anchorX, c.y / z1 - anchorY);
        return;
      }
      if (touches.size === 1 && s().oneFingerScroll) {
        if (panning || Math.hypot(t.x - t.sx, t.y - t.sy) > MOVE_TOLERANCE) {
          panning = true;
          view(st.zoom.value, st.scrollX + dx / st.zoom.value, st.scrollY + dy / st.zoom.value);
          showPull();
        }
      }
    };

    const onUp = (e: PointerEvent) => {
      if (!touches.has(e.pointerId)) return;
      if (tap && !tap.moved && e.timeStamp - tap.start < 350 && touches.size === tap.count) {
        if (tap.count === 2 && s().twoFingerUndo) ctx.undo();
        if (tap.count === 3 && s().threeFingerRedo) ctx.redo();
        tap = null;
      }
      touches.delete(e.pointerId);
      if (touches.size >= 2) startPinch();
      else pinch = null;
      if (!touches.size) {
        if (panning && pullArmed && s().pullToAddPage) {
          ctx.addPage();
          hint.classList.add("is-added");
          setTimeout(() => hint.classList.remove("is-added"), 600);
        }
        hidePull();
        panning = false;
        tap = null;
      }
    };

    /** Root capture: keeps Excalidraw from also reacting to the same fingers. */
    const block = (e: PointerEvent) => {
      if (e.pointerType === "touch" && (owns() || ctx.claimedTouches.has(e.pointerId)) && (e.target as HTMLElement)?.tagName === "CANVAS")
        e.stopPropagation();
    };
    const blockTouch = (e: TouchEvent) => {
      if (owns()) e.stopPropagation();
    };

    window.addEventListener("pointerdown", onDown, true);
    window.addEventListener("pointermove", onMove, true);
    window.addEventListener("pointerup", onUp, true);
    window.addEventListener("pointercancel", onUp, true);
    for (const t of ["pointerdown", "pointermove", "pointerup"] as const) ctx.root.addEventListener(t, block, true);
    ctx.root.addEventListener("touchstart", blockTouch, true);
    ctx.root.addEventListener("touchmove", blockTouch, true);
    return () => {
      hint.remove();
      window.removeEventListener("pointerdown", onDown, true);
      window.removeEventListener("pointermove", onMove, true);
      window.removeEventListener("pointerup", onUp, true);
      window.removeEventListener("pointercancel", onUp, true);
      for (const t of ["pointerdown", "pointermove", "pointerup"] as const) ctx.root.removeEventListener(t, block, true);
      ctx.root.removeEventListener("touchstart", blockTouch, true);
      ctx.root.removeEventListener("touchmove", blockTouch, true);
    };
  },
});
