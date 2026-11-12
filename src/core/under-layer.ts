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

/** The same colour, clearly darker (so text stands out on the highlight). */
export function darker(color: string, k = 0.55): string {
  const m = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(color.trim());
  if (!m) return color;
  let hex = m[1];
  if (hex.length === 3) hex = hex.split("").map((ch) => ch + ch).join("");
  const n = parseInt(hex, 16);
  const ch = (shift: number) => Math.round(((n >> shift) & 255) * k);
  return `rgb(${ch(16)}, ${ch(8)}, ${ch(0)})`;
}

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
      if (this.overCanvas) this.overCanvas.style.display = "none";
      return;
    }
    if (ctx.fastView?.active) return; // moving: the snapshot handles it; redrawn when it stops
    c.style.display = "block";
    const dpr = window.devicePixelRatio || 1;
    const w = stat.clientWidth;
    const h = stat.clientHeight;
    const v = ctx.view();
    const s = dpr * v.zoom;
    // visible scene area
    const x1 = -v.scrollX;
    const y1 = -v.scrollY;
    const x2 = x1 + w / v.zoom;
    const y2 = y1 + h / v.zoom;
    const visible = (el: El) => {
      const pad = (el.strokeWidth as number) * 4;
      return !((el.x as number) + (el.width as number) + pad < x1 || (el.x as number) - pad > x2 || (el.y as number) + (el.height as number) + pad < y1 || (el.y as number) - pad > y2);
    };
    const els = ctx.elements().filter(isHighlight);
    if (this.live && !els.some((e) => e.id === this.live!.id)) els.push(this.live);
    const visibleHl = els.filter((el) => el === this.live || visible(el));
    const imgs = ctx.state.pageImages;
    const rects = pageRects(ctx.state.pages).filter((r) => !(r.y > y2 || r.y + r.h < y1 || r.x > x2 || r.x + r.w < x1));

    // Nothing that this layer shows changed (e.g. you just wrote a word): don't redraw it.
    // (Redrawing the PDF pages and highlights after every stroke was most of the lag after lifting the Pencil.)
    const view = `${w}x${h}@${dpr}|${v.zoom.toFixed(5)},${v.scrollX.toFixed(2)},${v.scrollY.toFixed(2)}`;
    const sig = [
      view,
      this.darken(),
      rects.map((r) => `${r.index}:${imgs[r.index] ? (this.image(imgs[r.index]!) ? 1 : 0) : "-"}`).join(","),
      visibleHl.map((e) => `${e.id}.${e.version}`).join(","),
      this.live ? `live${(this.live.points as unknown[] | undefined)?.length}` : "",
    ].join("|");
    if (sig !== this.lastSig || c.style.transform) {
      this.lastSig = sig;
      this.drawUnder(c, w, h, dpr, s, v, rects, imgs, els, visibleHl);
    }
    this.drawOver(visibleHl, s, w, h, dpr, v, view);
  };

  private lastSig = "";
  private lastOverSig = "";
  private overKeys = new Set<string>();

  private drawUnder(
    c: HTMLCanvasElement,
    w: number,
    h: number,
    dpr: number,
    s: number,
    v: { scrollX: number; scrollY: number },
    rects: ReturnType<typeof pageRects>,
    imgs: (string | undefined)[],
    els: El[],
    visibleHl: El[],
  ) {
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
    g.setTransform(s, 0, 0, s, v.scrollX * s, v.scrollY * s);

    // 1. PDF pages (the DOM copies are hidden while this layer is on)
    for (const r of rects) {
      const src = imgs[r.index];
      const img = src ? this.image(src) : null;
      if (img) g.drawImage(img, r.x, r.y, r.w, r.h);
    }

    // 2. Highlights, multiplied onto whatever is under them (text stays dark).
    g.globalCompositeOperation = "multiply";
    for (const el of visibleHl) {
      g.save();
      g.translate(el.x as number, el.y as number);
      g.globalAlpha = ((el.opacity as number) ?? 100) / 100;
      g.fillStyle = (el.type === "rectangle" ? el.backgroundColor : el.strokeColor) as string;
      g.fill(this.shapeOf(el, el === this.live));
      g.restore();
    }
    g.globalCompositeOperation = "source-over";

    // 3. PDF text under highlights, darker: each page drawn once more, clipped to all of its
    //    highlights together and multiplied (dark text gets darker, the paper keeps the highlight colour).
    if (this.darken() > 0 && visibleHl.length) {
      for (const r of rects) {
        const src = imgs[r.index];
        const img = src ? this.image(src) : null;
        if (!img) continue;
        const onPage = visibleHl.filter((el) => (el.y as number) < r.y + r.h && (el.y as number) + (el.height as number) > r.y);
        if (!onPage.length) continue;
        const clip = new Path2D();
        for (const el of onPage) clip.addPath(this.shapeOf(el, el === this.live), new DOMMatrix([1, 0, 0, 1, el.x as number, el.y as number]));
        g.save();
        g.clip(clip);
        g.globalCompositeOperation = "multiply";
        g.drawImage(img, r.x, r.y, r.w, r.h);
        g.restore();
      }
    }
    const keep = new Set(els.map((e) => e.id));
    for (const id of this.paths.keys()) if (!keep.has(id)) this.paths.delete(id);
  }

  /** How much darker text under highlights is drawn (0 = off). */
  private darken() {
    return this.ctx.core.darkenUnderHighlights === false ? 0 : 1;
  }

  /** A highlight's shape in its own coordinates (for clipping). */
  private shapeOf(el: El, live = false): Path2D {
    if (el.type === "rectangle") {
      const p = new Path2D();
      const w = el.width as number;
      const h = el.height as number;
      const m = Math.min(Math.abs(w), Math.abs(h));
      p.roundRect(0, 0, w, h, el.roundness ? (m <= 128 ? m * 0.25 : 32) : 0);
      return p;
    }
    if (live) return outlinePath(freedrawOutline(el, false));
    let c = this.paths.get(el.id);
    if (!c || c.version !== el.version) {
      c = { version: el.version as number, path: outlinePath(freedrawOutline(el, true)) };
      this.paths.set(el.id, c);
    }
    return c.path;
  }

  /** Ink under highlights, redrawn darker on a layer just above the ink. */
  overCanvas: HTMLCanvasElement | null = null;
  private inkPaths = new Map<string, { version: number; path: Path2D }>();
  private drawOver(hls: El[], s: number, w: number, h: number, dpr: number, v: { scrollX: number; scrollY: number }, view: string) {
    const stat = this.ctx.root.querySelector<HTMLCanvasElement>("canvas.excalidraw__canvas.static");
    if (!stat) return;
    if (!this.overCanvas || this.overCanvas.parentElement !== stat.parentElement) {
      this.overCanvas?.remove();
      const c = document.createElement("canvas");
      c.className = "hn-over";
      stat.after(c);
      this.overCanvas = c;
    }
    const c = this.overCanvas;
    c.style.display = "block";
    // Which ink lies under a highlight (bounding boxes) — only redraw when that set changes.
    const ink = this.darken() && hls.length
      ? this.ctx
          .elements()
          .filter((e) => e.type === "freedraw" && !e.isDeleted && !isHighlight(e) && (e.points as unknown[] | undefined)?.length)
      : [];
    const pairs: [El, El[]][] = [];
    for (const hl of hls) {
      const hx1 = hl.x as number;
      const hy1 = hl.y as number;
      const hx2 = hx1 + (hl.width as number);
      const hy2 = hy1 + (hl.height as number);
      const pad = (hl.strokeWidth as number) * 4 + 20;
      const under = ink.filter(
        (e) =>
          (e.x as number) < hx2 + pad &&
          (e.x as number) + (e.width as number) > hx1 - pad &&
          (e.y as number) < hy2 + pad &&
          (e.y as number) + (e.height as number) > hy1 - pad,
      );
      if (under.length) pairs.push([hl, under]);
    }
    // What is drawn: one key per (highlight, ink stroke) pair.
    const keys = new Set<string>();
    for (const [hl, u] of pairs) for (const e of u) keys.add(`${hl.id}.${hl.version}|${e.id}.${e.version}.${e.strokeColor}`);
    const resized = c.width !== Math.round(w * dpr) || c.height !== Math.round(h * dpr);
    const prev = this.overKeys;
    // Only new strokes since last time (the usual case: you wrote a word on a highlight):
    // draw just those on top, instead of redrawing everything.
    const onlyAdded =
      !resized && !c.style.transform && view === this.lastOverSig && prev.size > 0 && [...prev].every((k) => keys.has(k));
    if (onlyAdded && keys.size === prev.size) return;
    this.lastOverSig = view;
    this.overKeys = keys;
    if (resized) {
      c.width = Math.round(w * dpr);
      c.height = Math.round(h * dpr);
      c.style.width = `${w}px`;
      c.style.height = `${h}px`;
    }
    c.style.transform = "";
    const g = c.getContext("2d")!;
    g.setTransform(1, 0, 0, 1, 0, 0);
    if (!onlyAdded) g.clearRect(0, 0, c.width, c.height);
    if (!pairs.length) return;
    g.setTransform(s, 0, 0, s, v.scrollX * s, v.scrollY * s);
    for (const [hl, all] of pairs) {
      const under = onlyAdded ? all.filter((e) => !prev.has(`${hl.id}.${hl.version}|${e.id}.${e.version}.${e.strokeColor}`)) : all;
      if (!under.length) continue;
      g.save();
      g.translate(hl.x as number, hl.y as number);
      g.clip(this.shapeOf(hl, hl === this.live));
      g.translate(-(hl.x as number), -(hl.y as number));
      for (const e of under) {
        let p = this.inkPaths.get(e.id);
        if (!p || p.version !== e.version) {
          p = { version: e.version as number, path: outlinePath(freedrawOutline(e, true)) };
          this.inkPaths.set(e.id, p);
        }
        g.save();
        g.translate(e.x as number, e.y as number);
        g.fillStyle = darker(e.strokeColor as string);
        g.fill(p.path);
        g.restore();
      }
      g.restore();
    }
  }

  destroy() {
    if (this.frame !== null) cancelAnimationFrame(this.frame);
    this.offs.forEach((o) => o());
    this.canvas?.remove();
    this.overCanvas?.remove();
    (globalThis as { __hnHideHighlights?: boolean }).__hnHideHighlights = false;
  }
}
