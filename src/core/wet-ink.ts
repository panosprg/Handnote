/**
 * Wet ink: the stroke being written is drawn on a small canvas of its own,
 * straight from the Pencil events, instead of going through Excalidraw (which
 * re-renders through React on every movement). Only when the Pencil lifts is the
 * finished stroke handed to Excalidraw, as one element and one undo step.
 *
 * The outline is computed with exactly the same perfect-freehand settings
 * Excalidraw uses, so the stroke doesn't change shape when it is committed.
 */
import { getStroke } from "perfect-freehand";
import type { El, HandnoteContext } from "./context";

/** Same options as Excalidraw 0.18 (getFreedrawOutlinePoints). */
export function freedrawOutline(el: El, last: boolean): number[][] {
  const pts = el.points ?? [];
  const input = el.simulatePressure
    ? pts.map(([x, y]) => [x, y])
    : pts.length
      ? pts.map(([x, y], i) => [x, y, el.pressures?.[i] ?? 0.5])
      : [[0, 0, 0.5]];
  return getStroke(input, {
    simulatePressure: !!el.simulatePressure,
    size: (el.strokeWidth as number) * 4.25,
    thinning: 0.6,
    smoothing: 0.5,
    streamline: 0.5,
    easing: (t) => Math.sin((t * Math.PI) / 2),
    last,
  });
}

/** The quadratic path Excalidraw draws through the outline. */
function outlinePath(path: Path2D, outline: number[][]) {
  if (!outline.length) return;
  const mid = (a: number[], b: number[]) => [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
  path.moveTo(outline[0][0], outline[0][1]);
  for (let i = 0; i < outline.length; i++) {
    const p = outline[i];
    const next = outline[(i + 1) % outline.length];
    const m = mid(p, next);
    path.quadraticCurveTo(p[0], p[1], m[0], m[1]);
  }
  path.closePath();
}

export class WetInk {
  private canvas: HTMLCanvasElement | null = null;
  private frame: number | null = null;
  private el: El | null = null;

  constructor(private ctx: HandnoteContext) {}

  private ensureCanvas(): HTMLCanvasElement | null {
    const host = this.ctx.root.querySelector(".excalidraw__canvas-wrapper") as HTMLElement | null;
    if (!host) return null;
    if (!this.canvas || this.canvas.parentElement !== host) {
      this.canvas?.remove();
      const c = document.createElement("canvas");
      c.className = "hn-wet";
      host.appendChild(c);
      this.canvas = c;
    }
    return this.canvas;
  }

  /** Start showing `el` (a stroke not yet in the scene). It is re-read every frame. */
  begin(el: El) {
    this.el = el;
    const c = this.ensureCanvas();
    if (!c) return;
    // Same size as Excalidraw's own canvas (its wrapper has no size of its own).
    const ref = (this.ctx.root.querySelector("canvas.excalidraw__canvas.static") as HTMLCanvasElement | null) ?? this.ctx.root;
    const dpr = window.devicePixelRatio || 1;
    const w = ref.clientWidth;
    const h = ref.clientHeight;
    if (c.width !== Math.round(w * dpr) || c.height !== Math.round(h * dpr)) {
      c.width = Math.round(w * dpr);
      c.height = Math.round(h * dpr);
      c.style.width = `${w}px`;
      c.style.height = `${h}px`;
    }
    c.style.display = "block";
    this.request();
  }

  /** Something changed: draw on the next frame (at most once per frame). */
  request() {
    if (this.frame === null) this.frame = requestAnimationFrame(this.draw);
  }

  private draw = () => {
    this.frame = null;
    const c = this.canvas;
    const el = this.el;
    if (!c) return;
    const g = c.getContext("2d");
    if (!g) return;
    g.setTransform(1, 0, 0, 1, 0, 0);
    g.clearRect(0, 0, c.width, c.height);
    if (!el || el.isDeleted || !(el.points as unknown[] | undefined)?.length) return;
    const st = this.ctx.api.getAppState();
    const s = (window.devicePixelRatio || 1) * st.zoom.value;
    g.setTransform(s, 0, 0, s, (el.x + st.scrollX) * s, (el.y + st.scrollY) * s);
    const tool = this.ctx.state.tool;
    if (tool === "dotted" || tool === "dashed") {
      // Same look as the Excalidraw line it becomes: width + 0.5, Excalidraw's dash pattern.
      const sw = el.strokeWidth as number;
      g.globalAlpha = ((el.opacity as number) ?? 100) / 100;
      g.strokeStyle = el.strokeColor as string;
      g.lineWidth = sw + 0.5;
      g.lineCap = "round";
      g.lineJoin = "round";
      g.setLineDash(tool === "dashed" ? [8, 8 + sw] : [1.5, 6 + sw]);
      g.beginPath();
      (el.points as [number, number][]).forEach(([x, y], i) => (i ? g.lineTo(x, y) : g.moveTo(x, y)));
      g.stroke();
      g.setLineDash([]);
      return;
    }
    const path = new Path2D();
    outlinePath(path, freedrawOutline(el, false));
    g.globalAlpha = ((el.opacity as number) ?? 100) / 100;
    g.fillStyle = el.strokeColor as string;
    g.fill(path);
  };

  /**
   * The stroke was committed (or cancelled). The wet copy stays up until
   * Excalidraw has painted the real one, so nothing blinks.
   */
  end(committed: boolean) {
    this.el = null;
    if (this.frame !== null) cancelAnimationFrame(this.frame);
    this.frame = null;
    const clear = () => {
      if (this.el) return; // a new stroke already started
      const c = this.canvas;
      const g = c?.getContext("2d");
      if (!c || !g) return;
      g.setTransform(1, 0, 0, 1, 0, 0);
      g.clearRect(0, 0, c.width, c.height);
    };
    if (!committed) return clear();
    requestAnimationFrame(() => requestAnimationFrame(clear));
  }

  destroy() {
    if (this.frame !== null) cancelAnimationFrame(this.frame);
    this.canvas?.remove();
    this.canvas = null;
  }
}

let counter = 0;
const randomId = () => `hn${Date.now().toString(36)}${(counter++).toString(36)}${Math.random().toString(36).slice(2, 8)}`;

/** A new freedraw element, the way Excalidraw would create it, from the current pen settings. */
export function newStroke(ctx: HandnoteContext, x: number, y: number, pressure: number, simulatePressure = pressure === 0.5): El {
  const st = ctx.api.getAppState() as unknown as Record<string, unknown>;
  return {
    id: randomId(),
    type: "freedraw",
    x,
    y,
    width: 0,
    height: 0,
    angle: 0,
    strokeColor: st.currentItemStrokeColor,
    backgroundColor: st.currentItemBackgroundColor ?? "transparent",
    fillStyle: st.currentItemFillStyle ?? "solid",
    strokeWidth: st.currentItemStrokeWidth,
    strokeStyle: st.currentItemStrokeStyle ?? "solid",
    roughness: st.currentItemRoughness ?? 0,
    opacity: st.currentItemOpacity ?? 100,
    groupIds: [],
    frameId: null,
    index: null,
    roundness: null,
    seed: Math.floor(Math.random() * 2 ** 31),
    version: 1,
    versionNonce: Math.floor(Math.random() * 2 ** 31),
    isDeleted: false,
    boundElements: null,
    updated: Date.now(),
    link: null,
    locked: false,
    points: [[0, 0]],
    pressures: simulatePressure ? [] : [pressure],
    simulatePressure,
    lastCommittedPoint: null,
  } as unknown as El;
}

/** Append a point (scene coordinates) to a stroke that is not in the scene yet. */
export function appendPoint(el: El, x: number, y: number, pressure: number) {
  const pts = el.points as [number, number][];
  const px = x - el.x;
  const py = y - el.y;
  const last = pts[pts.length - 1];
  if (last && last[0] === px && last[1] === py) return;
  pts.push([px, py]);
  if (!el.simulatePressure) (el.pressures as number[]).push(pressure);
}

/** Width/height/lastCommittedPoint, as Excalidraw sets them when a stroke finishes. */
export function finalizeStroke(el: El) {
  const pts = el.points as [number, number][];
  const xs = pts.map((p) => p[0]);
  const ys = pts.map((p) => p[1]);
  // Excalidraw normalises so the first point is at the element's x/y; keep the same convention.
  (el as Record<string, unknown>).width = Math.max(...xs) - Math.min(...xs);
  (el as Record<string, unknown>).height = Math.max(...ys) - Math.min(...ys);
  (el as Record<string, unknown>).lastCommittedPoint = pts[pts.length - 1];
  (el as Record<string, unknown>).updated = Date.now();
}
