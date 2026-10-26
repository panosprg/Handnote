/**
 * The pen pipeline: every Pencil/mouse stroke drawn with an ink tool passes
 * through here before Excalidraw sees it.
 *
 * It listens on `window` in the capture phase (which runs before Excalidraw's
 * own listeners), lets registered filters change each point, and re-dispatches
 * an identical synthetic event carrying the changed point. Just before the
 * stroke is committed, filters may also rewrite the finished stroke (smoothing,
 * straightening, shape snapping); because that happens before Excalidraw
 * finalises it, the result is one clean undo step.
 *
 * Features add filters with `ctx.pen.addFilter(...)`.
 */
import type { HandnoteContext, El } from "./context";

export interface PenPoint {
  /** client (screen) coordinates */
  x: number;
  y: number;
  pressure: number;
  /** seconds */
  t: number;
}

export interface StrokeFilter {
  /** Change a point, or return null to drop it (e.g. after a shape snapped). */
  point?(p: PenPoint): PenPoint | null;
  /** Rewrite the finished stroke just before it is committed. Mutate `el` via ctx helpers. */
  finish?(el: El, held: boolean): void;
  /** Stroke ended or was cancelled. */
  dispose?(): void;
}

export interface PenFilter {
  id: string;
  /** Lower runs first. */
  order: number;
  /** Return a per-stroke filter, or null to stay out of this stroke. */
  start(e: PointerEvent, ctx: HandnoteContext): StrokeFilter | null;
}

interface Active {
  pointerId: number;
  target: EventTarget;
  filters: StrokeFilter[];
  last: PenPoint;
  dropping: boolean;
}

export class PenPipeline {
  private filters: PenFilter[] = [];
  private active: Active | null = null;

  constructor(private ctx: HandnoteContext) {
    ctx.root.addEventListener("pointerdown", this.onDown, true);
    window.addEventListener("pointermove", this.onMove, true);
    window.addEventListener("pointerup", this.onUp, true);
    window.addEventListener("pointercancel", this.onCancel, true);
  }

  destroy() {
    this.ctx.root.removeEventListener("pointerdown", this.onDown, true);
    window.removeEventListener("pointermove", this.onMove, true);
    window.removeEventListener("pointerup", this.onUp, true);
    window.removeEventListener("pointercancel", this.onCancel, true);
  }

  addFilter(f: PenFilter): () => void {
    this.filters = [...this.filters.filter((x) => x.id !== f.id), f].sort((a, b) => a.order - b.order);
    return () => {
      this.filters = this.filters.filter((x) => x !== f);
    };
  }

  /** The stroke currently being drawn (Excalidraw's new element), if any. */
  current(): El | null {
    const el = this.ctx.api.getAppState().newElement as unknown as El | null;
    return el && el.type === "freedraw" ? el : null;
  }

  /** Stop forwarding the current stroke's points (it stays as it is now). */
  freeze() {
    if (this.active) this.active.dropping = true;
  }

  private run(p: PenPoint): PenPoint | null {
    let cur: PenPoint | null = p;
    for (const f of this.active!.filters) {
      if (!cur) break;
      if (f.point) cur = f.point(cur);
    }
    return cur;
  }

  private onDown = (e: PointerEvent) => {
    if (!e.isTrusted || e.pointerType === "touch" || e.button !== 0) return;
    if ((e.target as HTMLElement)?.tagName !== "CANVAS") return;
    if (this.ctx.api.getAppState().activeTool.type !== "freedraw") return;
    const filters = this.filters.map((f) => f.start(e, this.ctx)).filter((f): f is StrokeFilter => !!f);
    if (!filters.length) return;

    this.active = {
      pointerId: e.pointerId,
      target: e.target!,
      filters,
      last: { x: e.clientX, y: e.clientY, pressure: e.pressure, t: e.timeStamp / 1000 },
      dropping: false,
    };
    const p = this.run(this.active.last) ?? this.active.last;
    this.active.last = p;
    e.stopImmediatePropagation();
    this.redispatch(e, "pointerdown", p);
  };

  private onMove = (e: PointerEvent) => {
    const a = this.active;
    if (!a || !e.isTrusted || e.pointerId !== a.pointerId) return;
    e.stopImmediatePropagation();
    if (a.dropping) return;
    const p = this.run({ x: e.clientX, y: e.clientY, pressure: e.pressure, t: e.timeStamp / 1000 });
    if (!p) return;
    a.last = p;
    this.redispatch(e, "pointermove", p);
  };

  private onUp = (e: PointerEvent) => {
    const a = this.active;
    if (!a || !e.isTrusted || e.pointerId !== a.pointerId) return;
    e.stopImmediatePropagation();
    this.active = null;

    let end = a.last;
    const el = this.current();
    if (el) {
      for (const f of a.filters) {
        try {
          f.finish?.(el, a.dropping);
        } catch (err) {
          console.error("Handnote: stroke filter failed", err);
        }
      }
      // Excalidraw appends the pointer-up position as a final point: make it the stroke's real end.
      const pts = el.points;
      if (pts && pts.length) {
        const [px, py] = pts[pts.length - 1];
        const s = this.ctx.toClient(el.x + px, el.y + py);
        end = { ...end, x: s.x, y: s.y };
      }
    }
    a.filters.forEach((f) => f.dispose?.());
    this.redispatch(e, "pointerup", end);
  };

  private onCancel = (e: PointerEvent) => {
    if (this.active && e.pointerId === this.active.pointerId) {
      this.active.filters.forEach((f) => f.dispose?.());
      this.active = null;
    }
  };

  private redispatch(e: PointerEvent, type: string, p: PenPoint) {
    const dx = p.x - e.clientX;
    const dy = p.y - e.clientY;
    const synthetic = new PointerEvent(type, {
      bubbles: true,
      cancelable: true,
      composed: true,
      clientX: p.x,
      clientY: p.y,
      screenX: e.screenX + dx,
      screenY: e.screenY + dy,
      pointerId: e.pointerId,
      pointerType: e.pointerType,
      isPrimary: e.isPrimary,
      pressure: p.pressure,
      tiltX: e.tiltX,
      tiltY: e.tiltY,
      twist: e.twist,
      width: e.width,
      height: e.height,
      button: e.button,
      buttons: e.buttons,
      ctrlKey: e.ctrlKey,
      shiftKey: e.shiftKey,
      altKey: e.altKey,
      metaKey: e.metaKey,
    });
    (type === "pointerdown" ? e.target ?? window : this.active?.target ?? e.target ?? window).dispatchEvent(synthetic);
  }
}
