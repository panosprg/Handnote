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
 * With "fast ink" on (the default), the stroke isn't fed to Excalidraw while it
 * is being written at all: it is drawn on its own canvas (see wet-ink.ts) and
 * handed over in one piece when the Pencil lifts. That removes Excalidraw's
 * per-movement React re-render, which is what made writing lag on the iPad.
 *
 * Features add filters with `ctx.pen.addFilter(...)`.
 */
import type { HandnoteContext, El } from "./context";
import { appendPoint, finalizeStroke, newStroke, WetInk } from "./wet-ink";

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
  /** Fast ink only: where the finished stroke goes in the element list (e.g. highlights at the back). */
  place?(all: El[], el: El): El[];
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
  /** Fast ink: the stroke being written, not yet in the scene. */
  wet: El | null;
}

export class PenPipeline {
  private filters: PenFilter[] = [];
  private active: Active | null = null;
  private wetInk: WetInk;

  constructor(private ctx: HandnoteContext) {
    this.wetInk = new WetInk(ctx);
    ctx.root.addEventListener("pointerdown", this.onDown, true);
    ctx.root.addEventListener("touchstart", this.onStylusTouch, { capture: true, passive: false });
    ctx.root.addEventListener("touchmove", this.onStylusTouch, { capture: true, passive: false });
    window.addEventListener("pointermove", this.onMove, true);
    window.addEventListener("pointerup", this.onUp, true);
    window.addEventListener("pointercancel", this.onCancel, true);
  }

  destroy() {
    this.wetInk.destroy();
    this.ctx.root.removeEventListener("pointerdown", this.onDown, true);
    this.ctx.root.removeEventListener("touchstart", this.onStylusTouch, { capture: true });
    this.ctx.root.removeEventListener("touchmove", this.onStylusTouch, { capture: true });
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
    if (this.active?.wet) return this.active.wet;
    const el = this.ctx.api.getAppState().newElement as unknown as El | null;
    return el && el.type === "freedraw" ? el : null;
  }

  /** Stop forwarding the current stroke's points (it stays as it is now). */
  freeze() {
    if (this.active) this.active.dropping = true;
    this.wetInk.request();
  }

  /** Is a stroke being written right now? */
  get writing() {
    return !!this.active;
  }

  private fast() {
    return this.ctx.core.fastInk !== false;
  }

  private run(p: PenPoint): PenPoint | null {
    let cur: PenPoint | null = p;
    for (const f of this.active!.filters) {
      if (!cur) break;
      if (f.point) cur = f.point(cur);
    }
    return cur;
  }

  /**
   * The Apple Pencil also sends touch events. If they aren't cancelled, iPadOS Scribble
   * (handwriting-to-text) holds the Pencil's movements back while it decides whether you're
   * writing into a text field: the ink appears up to a second late, or strokes get cut.
   * Excalidraw does the same on iPad; this makes sure it happens whatever else
   * is listening.
   */
  private onStylusTouch = (e: TouchEvent) => {
    if (!e.cancelable || (e.target as HTMLElement)?.tagName !== "CANVAS") return;
    const stylus = [...Array.from(e.changedTouches)].some((t) => (t as Touch & { touchType?: string }).touchType === "stylus");
    if (stylus || this.active) e.preventDefault();
  };

  private onDown = (e: PointerEvent) => {
    if (!e.isTrusted || e.pointerType === "touch" || e.button !== 0) return;
    if ((e.target as HTMLElement)?.tagName !== "CANVAS") return;
    if (this.ctx.api.getAppState().activeTool.type !== "freedraw") return;
    const filters = this.filters.map((f) => f.start(e, this.ctx)).filter((f): f is StrokeFilter => !!f);
    const fast = this.fast();
    if (!filters.length && !fast) return;

    this.active = {
      pointerId: e.pointerId,
      target: e.target!,
      filters,
      last: { x: e.clientX, y: e.clientY, pressure: e.pressure, t: e.timeStamp / 1000 },
      dropping: false,
      wet: null,
    };
    const p = this.run(this.active.last) ?? this.active.last;
    this.active.last = p;
    e.stopImmediatePropagation();
    if (fast) {
      e.preventDefault();
      const sp = this.ctx.toScene(p.x, p.y);
      this.active.wet = newStroke(this.ctx, sp.x, sp.y, p.pressure);
      this.wetInk.begin(this.active.wet);
      return;
    }
    this.redispatch(e, "pointerdown", p);
  };

  /** Points the browser merged into this event (iPad Pencil reports far more than one per frame). */
  private samples(e: PointerEvent): PointerEvent[] {
    const all = typeof e.getCoalescedEvents === "function" ? e.getCoalescedEvents() : [];
    return all.length ? all : [e];
  }

  private onMove = (e: PointerEvent) => {
    const a = this.active;
    if (!a || !e.isTrusted || e.pointerId !== a.pointerId) return;
    e.stopImmediatePropagation();
    if (a.dropping) return;
    if (a.wet) {
      for (const s of this.samples(e)) {
        if (a.dropping) break;
        const p = this.run({ x: s.clientX, y: s.clientY, pressure: s.pressure, t: s.timeStamp / 1000 });
        if (!p) continue;
        a.last = p;
        const sp = this.ctx.toScene(p.x, p.y);
        appendPoint(a.wet, sp.x, sp.y, p.pressure);
      }
      this.wetInk.request();
      return;
    }
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
    if (a.wet) return this.commit(a);

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
    const a = this.active;
    if (!a || e.pointerId !== a.pointerId) return;
    this.active = null;
    // iPadOS sometimes cancels a Pencil stroke (palm, system gesture): keep what was written.
    if (a.wet) return this.commit(a);
    a.filters.forEach((f) => f.dispose?.());
  };

  /** Fast ink: hand the finished stroke to Excalidraw as one element, one undo step. */
  private commit(a: Active) {
    const el = a.wet!;
    // Like Excalidraw: the lift position is the stroke's last point (also turns a tap into a dot).
    const pts = el.points as [number, number][];
    const lastPt = pts[pts.length - 1];
    pts.push([lastPt[0], lastPt[1]]);
    if (!el.simulatePressure) (el.pressures as number[]).push((el.pressures as number[])[pts.length - 2] ?? a.last.pressure);
    for (const f of a.filters) {
      try {
        f.finish?.(el, a.dropping);
      } catch (err) {
        console.error("Handnote: stroke filter failed", err);
      }
    }
    a.filters.forEach((f) => f.dispose?.());
    if (el.isDeleted) {
      this.wetInk.end(false);
      return;
    }
    finalizeStroke(el);
    let all = [...this.ctx.elements(true), el];
    for (const f of a.filters) {
      if (!f.place) continue;
      try {
        all = f.place(all, el);
      } catch (err) {
        console.error("Handnote: stroke filter failed", err);
      }
    }
    this.ctx.replaceElements(all, "now");
    this.wetInk.end(true);
    const tool = this.ctx.state.tool;
    const stored = this.ctx.elements().find((x) => x.id === el.id) ?? el;
    window.setTimeout(() => this.ctx.events.emit("strokeEnd", stored, tool), 0);
  }

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
