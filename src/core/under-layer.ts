/**
 * Highlights that never cover text.
 *
 * Highlights used to be drawn by Excalidraw on the same canvas as the ink and kept
 * readable with a CSS "multiply" blend. iPad Safari doesn't apply that blend here (it
 * isolates the canvas from the paper below — see WebKit bug 286619), so highlights
 * came out as a flat yellow film over PDF text.
 *
 * Now (light mode) this layer sits under the ink and draws, for the visible pages:
 * the PDF page image, then the highlights with the canvas's own multiply — which every
 * browser supports. Text under a highlight keeps its full darkness, and ink is drawn
 * on top as usual. Excalidraw skips highlights on screen (scripts/excalidraw-patch.mjs)
 * but still includes them in exports.
 */
import type { El, HandnoteContext } from "./context";
import { pageRects } from "./pages";
import { freedrawOutline } from "./wet-ink";

const isHighlight = (e: El) => !e.isDeleted && (e.customData as { hn?: string } | undefined)?.hn === "hl";

function outlinePath(outline: number[][]) {
  const path = new Path2D();
  if (!outline.length) return path;
  path.moveTo(outline[0][0], outline[0][1]);
  for (let i = 0; i < outline.length; i++) {
    const p = outline[i];
    const n = outline[(i + 1) % outline.length];
    path.quadraticCurveTo(p[0], p[1], (p[0] + n[0]) / 2, (p[1] + n[1]) / 2);
  }
  path.closePath();
  return path;
}

export class UnderLayer {
  canvas: HTMLCanvasElement | null = null;
  private frame: number | null = null;
  private images = new Map<string, HTMLImageElement>();
  private paths = new Map<string, { version: number; path: Path2D }>();
  private live: El | null = null;
  private on = false;
  private offs: (() => void)[] = [];

  constructor(private ctx: HandnoteContext) {
    const ev = ctx.events;
    this.offs.push(
      ev.on("change", () => this.request()),
      ev.on("scroll", () => {
        if (!ctx.fastView?.active) this.request();
      }),
      ev.on("state", () => this.request()),
    );
    const ro = new ResizeObserver(() => this.request());
    ro.observe(ctx.root);
    this.offs.push(() => ro.disconnect());
    this.request();
  }

  /** On in light mode (dark mode keeps Excalidraw's own highlight drawing). */
  get active() {
    return this.on;
  }

  /** The highlight being written right now (drawn here, under the ink, not on the wet layer). */
  setLive(el: El | null) {
    this.live = el;
    this.request();
  }

  request() {
    if (this.frame === null) this.frame = requestAnimationFrame(this.draw);
  }

  private image(src: string) {
    let img = this.images.get(src);
    if (!img) {
      img = new Image();
      img.onload = () => this.request();
      img.src = src;
      this.images.set(src, img);
    }
    return img.complete && img.naturalWidth ? img : null;
  }

  private ensureCanvas() {
    const stat = this.ctx.root.querySelector<HTMLCanvasElement>("canvas.excalidraw__canvas.static");
    if (!stat) return null;
    if (!this.canvas || this.canvas.parentElement !== stat.parentElement) {
      this.canvas?.remove();
      const c = document.createElement("canvas");
      c.className = "hn-under";
      stat.parentElement!.insertBefore(c, stat);
      this.canvas = c;
    }
    return { c: this.canvas, stat };
  }

  private setOn(on: boolean) {
    if (on === this.on) return;
    this.on = on;
    (globalThis as { __hnHideHighlights?: boolean }).__hnHideHighlights = on;
    this.ctx.root.classList.toggle("hn-under-on", on);
    // Make Excalidraw redraw without (or with) the highlights.
    this.ctx.api.updateScene({ appState: {} as never });
  }

  private draw = () => {
    this.frame = null;
    const ctx = this.ctx;
    this.setOn(ctx.root.classList.contains("hn-light"));
    const found = this.ensureCanvas();
    if (!found) return;
    const { c, stat } = found;
    if (!this.on) {
      c.style.display = "none";
      return;
    }
    if (ctx.fastView?.active) return; // moving: the snapshot handles it; redrawn when it stops
    c.style.display = "block";
    const dpr = window.devicePixelRatio || 1;
    const w = stat.clientWidth;
    const h = stat.clientHeight;
    if (c.width !== Math.round(w * dpr) || c.height !== Math.round(h * dpr)) {
      c.width = Math.round(w * dpr);
      c.height = Math.round(h * dpr);
      c.style.width = `${w}px`;
      c.style.height = `${h}px`;
    }
    c.style.transform = "";
    const g = c.getContext("2d")!;
    g.setTransform(1, 0, 0, 1, 0, 0);
    g.clearRect(0, 0, c.width, c.height);

    const v = ctx.view();
    const s = dpr * v.zoom;
    g.setTransform(s, 0, 0, s, v.scrollX * s, v.scrollY * s);
    // visible scene area
    const x1 = -v.scrollX;
    const y1 = -v.scrollY;
    const x2 = x1 + w / v.zoom;
    const y2 = y1 + h / v.zoom;

    // 1. PDF pages (the DOM copies are hidden while this layer is on)
    const imgs = ctx.state.pageImages;
    for (const r of pageRects(ctx.state.pages)) {
      if (r.y > y2 || r.y + r.h < y1 || r.x > x2 || r.x + r.w < x1) continue;
      const src = imgs[r.index];
      if (!src) continue;
      const img = this.image(src);
      if (img) g.drawImage(img, r.x, r.y, r.w, r.h);
    }

    // 2. Highlights, multiplied onto whatever is under them (text stays dark).
    g.globalCompositeOperation = "multiply";
    const els = ctx.elements().filter(isHighlight);
    if (this.live && !els.some((e) => e.id === this.live!.id)) els.push(this.live);
    const seen = new Set<string>();
    for (const el of els) {
      seen.add(el.id);
      const bx = el.x as number;
      const by = el.y as number;
      const pad = (el.strokeWidth as number) * 4;
      if (bx + (el.width as number) + pad < x1 || bx - pad > x2 || by + (el.height as number) + pad < y1 || by - pad > y2) {
        if (el !== this.live) continue;
      }
      g.save();
      g.translate(bx, by);
      g.globalAlpha = ((el.opacity as number) ?? 100) / 100;
      if (el.type === "rectangle") {
        // Word highlights on PDFs: a filled rounded box (Excalidraw's adaptive corner radius).
        const w = el.width as number;
        const h = el.height as number;
        const m = Math.min(Math.abs(w), Math.abs(h));
        const r = el.roundness ? (m <= 128 ? m * 0.25 : 32) : 0;
        g.fillStyle = el.backgroundColor as string;
        g.beginPath();
        g.roundRect(0, 0, w, h, r);
        g.fill();
      } else {
        let p = this.paths.get(el.id);
        if (!p || p.version !== el.version || el === this.live) {
          p = { version: el.version as number, path: outlinePath(freedrawOutline(el, el !== this.live)) };
          if (el !== this.live) this.paths.set(el.id, p);
        }
        g.fillStyle = el.strokeColor as string;
        g.fill(p.path);
      }
      g.restore();
    }
    g.globalCompositeOperation = "source-over";
    for (const id of this.paths.keys()) if (!seen.has(id)) this.paths.delete(id);
  };

  destroy() {
    if (this.frame !== null) cancelAnimationFrame(this.frame);
    this.offs.forEach((o) => o());
    this.canvas?.remove();
    (globalThis as { __hnHideHighlights?: boolean }).__hnHideHighlights = false;
  }
}
