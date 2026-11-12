/**
 * Smooth scrolling and zooming.
 *
 * Redrawing every stroke for every finger movement is what made scrolling lag
 * (Excalidraw repaints the whole notebook each time the view changes). While a
 * finger moves the page, Handnote instead moves a snapshot of the ink (a GPU
 * transform, almost free) together with the paper, and only asks Excalidraw for
 * a real redraw when the gesture ends — or mid-gesture, once the snapshot has
 * moved far enough that blank edges would show.
 */
import { CaptureUpdateAction } from "@excalidraw/excalidraw";
import type { HandnoteContext } from "./context";

export interface View {
  zoom: number;
  scrollX: number;
  scrollY: number;
}

/** How far the snapshot may move/scale before a real redraw is done mid-gesture. */
const MAX_SHIFT = 0.3; // of the screen size
const MAX_SCALE = 1.35;

export class FastView {
  private base: View | null = null; // what the snapshot shows
  private target: View | null = null; // where the view should be
  private snap: HTMLCanvasElement | null = null;
  private frame: number | null = null;
  private refreshing = false;

  constructor(
    private ctx: HandnoteContext,
    private paper: (v: View) => void,
  ) {}

  get active() {
    return this.target !== null;
  }

  /** The view as the user sees it right now (mid-gesture: the target). */
  current(): View {
    if (this.target) return this.target;
    const st = this.ctx.api.getAppState();
    return { zoom: st.zoom.value, scrollX: st.scrollX, scrollY: st.scrollY };
  }

  private canvases() {
    return [...this.ctx.root.querySelectorAll<HTMLCanvasElement>("canvas.excalidraw__canvas")];
  }

  private takeSnapshot() {
    const src = this.ctx.root.querySelector<HTMLCanvasElement>("canvas.excalidraw__canvas.static");
    if (!src) return false;
    if (!this.snap) {
      this.snap = document.createElement("canvas");
      this.snap.className = "hn-snapshot";
      src.parentElement!.appendChild(this.snap);
    }
    const s = this.snap;
    if (s.width !== src.width || s.height !== src.height) {
      s.width = src.width;
      s.height = src.height;
    }
    s.style.width = src.style.width || `${src.clientWidth}px`;
    s.style.height = src.style.height || `${src.clientHeight}px`;
    const g = s.getContext("2d")!;
    g.clearRect(0, 0, s.width, s.height);
    g.drawImage(src, 0, 0);
    s.style.transform = "";
    s.style.display = "block";
    return true;
  }

  /** Move the view (during a finger gesture). Applied once per frame. */
  /** Frames shown during the current gesture (performance meter). */
  private frames: { start: number; last: number; n: number; worst: number; loop: number | null } | null = null;
  private countFrames = (t: number) => {
    const f = this.frames;
    if (!f) return;
    if (f.n) f.worst = Math.max(f.worst, t - f.last);
    f.last = t;
    f.n++;
    f.loop = requestAnimationFrame(this.countFrames);
  };

  set(v: View) {
    if (!this.target) {
      if (this.ctx.core.showPerf) {
        const now = performance.now();
        this.frames = { start: now, last: now, n: 0, worst: 0, loop: requestAnimationFrame(this.countFrames) };
      }
      if (!this.takeSnapshot()) {
        this.commitNow(v);
        return;
      }
      this.base = this.current();
      this.ctx.root.classList.add("hn-moving");
      for (const c of this.canvases()) c.style.visibility = "hidden";
    }
    this.target = v;
    if (this.frame === null) this.frame = requestAnimationFrame(this.apply);
  }

  private apply = () => {
    this.frame = null;
    const b = this.base;
    const t = this.target;
    if (!b || !t || !this.snap) return;
    // Screen point p0 of the snapshot moves to p0·k + (scroll − scroll0)·zoom.
    const k = t.zoom / b.zoom;
    const tx = (t.scrollX - b.scrollX) * t.zoom;
    const ty = (t.scrollY - b.scrollY) * t.zoom;
    this.snap.style.transform = `translate(${tx}px, ${ty}px) scale(${k})`;
    // The highlights/PDF layer under the ink moves the same way until it is redrawn.
    for (const layer of [this.ctx.underLayer?.canvas, this.ctx.underLayer?.overCanvas]) {
      if (!layer) continue;
      layer.style.transformOrigin = "0 0";
      layer.style.transform = `translate(${tx}px, ${ty}px) scale(${k})`;
    }
    this.paper(t);
    this.ctx.events.emit("scroll", t.scrollX, t.scrollY, t.zoom);
    const w = this.ctx.root.clientWidth;
    const h = this.ctx.root.clientHeight;
    if (!this.refreshing && (Math.abs(tx) > w * MAX_SHIFT || Math.abs(ty) > h * MAX_SHIFT || k > MAX_SCALE || k < 1 / MAX_SCALE))
      this.refresh();
  };

  /** Mid-gesture: real redraw at the current target, then a fresh snapshot of it. */
  private refresh() {
    const t = this.target;
    if (!t) return;
    this.refreshing = true;
    this.commitNow(t);
    requestAnimationFrame(() =>
      requestAnimationFrame(() => {
        this.refreshing = false;
        if (!this.target) return;
        // The canvas now shows view `t`: snapshot it and carry on from there.
        if (this.takeSnapshot()) this.base = t;
        this.redrawUnder();
        this.apply();
      }),
    );
  }

  /** Redraw the under-layer at the real view now (synchronously, so it matches the ink). */
  private redrawUnder() {
    const u = this.ctx.underLayer;
    if (!u) return;
    const was = this.target;
    this.target = null;
    (u as unknown as { draw: () => void }).draw();
    this.target = was;
  }

  private commitNow(v: View) {
    this.ctx.api.updateScene({
      appState: { zoom: { value: v.zoom as never }, scrollX: v.scrollX, scrollY: v.scrollY },
      captureUpdate: CaptureUpdateAction.NEVER,
    });
  }

  /** The gesture ended: one real redraw, then the snapshot goes away. */
  end(final?: View) {
    if (final && this.target) this.target = final;
    const t = this.target;
    if (!t) return;
    const f = this.frames;
    if (f) {
      if (f.loop !== null) cancelAnimationFrame(f.loop);
      const secs = (f.last - f.start) / 1000;
      if (secs > 0.15) {
        this.ctx.perf.scrollFps = Math.round(f.n / secs);
        this.ctx.perf.scrollWorstFrame = Math.round(f.worst);
      }
      this.frames = null;
    }
    this.ctx.measure("redraw");
    if (this.frame !== null) cancelAnimationFrame(this.frame);
    this.frame = null;
    this.apply();
    this.target = null;
    this.commitNow(t);
    requestAnimationFrame(() =>
      requestAnimationFrame(() => {
        if (this.target) return; // a new gesture started
        for (const c of this.canvases()) c.style.visibility = "";
        if (this.snap) this.snap.style.display = "none";
        this.redrawUnder();
        this.ctx.root.classList.remove("hn-moving");
        this.base = null;
      }),
    );
  }

  destroy() {
    if (this.frame !== null) cancelAnimationFrame(this.frame);
    this.snap?.remove();
  }
}
