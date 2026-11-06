/**
 * Writes a PDF notebook's annotations into a copy of its original PDF:
 *  - the original pages stay as they are (text stays sharp, selectable and searchable),
 *  - highlights snapped to words become real PDF highlight annotations (Preview, Goodnotes,
 *    Acrobat and Obsidian see them; their comment says what the colour means, e.g. "Evidence: …"),
 *  - handwriting, freehand highlights, shapes and text are laid on top as images,
 *  - the colour key is added under each page (the page grows at the bottom, nothing is covered),
 *  - pages added in the notebook after the PDF's own pages are appended.
 *
 * Always built from the untouched original, so writing again never doubles anything.
 */
import { exportToCanvas, getCommonBounds } from "@excalidraw/excalidraw";
import {
  BlendMode,
  PDFDocument,
  PDFHexString,
  PDFName,
  PDFString,
  type PDFPage,
} from "pdf-lib";

import type { El, HandnoteContext } from "./context";
import {
  categories,
  highlightColor,
  isHighlight,
  isTextHighlight,
  labelFor,
  legends,
  LEGEND_H,
  legendCanvas,
  onPaper,
  type Category,
} from "./categories";
import { pageRects, type PageRect } from "./pages";
import { inkPadding } from "./export";

const SCALE = 2; // ink images at ~192 dpi
/** Set on PDFs Handnote wrote into, so an annotated PDF is never mistaken for the original. */
export const ANNOTATED_MARK = "HandnoteAnnotated";

export async function isAnnotated(bytes: Uint8Array): Promise<boolean> {
  try {
    const doc = await PDFDocument.load(bytes, { updateMetadata: false, ignoreEncryption: true });
    return !!doc.catalog.get(PDFName.of(ANNOTATED_MARK));
  } catch {
    return false;
  }
}

function onPageRect(e: El, r: PageRect) {
  const [x1, y1, x2, y2] = getCommonBounds([e] as never);
  return x2 >= r.x && x1 <= r.x + r.w && y2 >= r.y && y1 <= r.y + r.h;
}

/** Elements drawn as one image, with where it sits (scene coordinates). */
async function renderLayer(ctx: HandnoteContext, els: El[]) {
  if (!els.length) return null;
  const [minX, minY, maxX, maxY] = getCommonBounds(els as never);
  const pad = inkPadding(els);
  const canvas = await exportToCanvas({
    elements: els as never,
    appState: { exportBackground: false, viewBackgroundColor: "transparent", exportWithDarkMode: false, theme: "light" } as never,
    files: ctx.api.getFiles(),
    exportPadding: pad,
    getDimensions: (w: number, h: number) => ({ width: w * SCALE, height: h * SCALE, scale: SCALE }),
  });
  if (!canvas.width || !canvas.height) return null;
  return { canvas, x: minX - pad, y: minY - pad, w: maxX - minX + 2 * pad, h: maxY - minY + 2 * pad };
}

const toPng = (c: HTMLCanvasElement) =>
  new Promise<Uint8Array>((resolve, reject) =>
    c.toBlob((b) => (b ? b.arrayBuffer().then((a) => resolve(new Uint8Array(a)), reject) : reject(new Error("could not encode image"))), "image/png"),
  );

/* ------------------------------------------------------------------ */
/* Page geometry (rotated pages included)                              */
/* ------------------------------------------------------------------ */

/**
 * How a page is shown vs. how it's stored. The notebook sees the page as displayed
 * (rotation applied, top-left origin, CSS px); PDF drawing happens in the page's own
 * unrotated space (bottom-left origin, points).
 */
class PageSpace {
  readonly rot: number;
  readonly box: { x: number; y: number; width: number; height: number };
  /** displayed size in points */
  readonly dispW: number;
  readonly dispH: number;
  /** points per notebook px */
  readonly kx: number;
  readonly ky: number;

  constructor(
    readonly page: PDFPage,
    readonly r: PageRect,
  ) {
    this.rot = (((page.getRotation().angle ?? 0) % 360) + 360) % 360;
    this.box = page.getCropBox();
    const turned = this.rot === 90 || this.rot === 270;
    this.dispW = turned ? this.box.height : this.box.width;
    this.dispH = turned ? this.box.width : this.box.height;
    this.kx = this.dispW / r.w;
    this.ky = this.dispH / r.h;
  }

  /** Displayed point (points from the top-left) → PDF user space. */
  user(u: number, v: number): [number, number] {
    const { x, y, width: w, height: h } = this.box;
    switch (this.rot) {
      case 90:
        return [x + v, y + u];
      case 180:
        return [x + w - u, y + v];
      case 270:
        return [x + w - v, y + h - u];
      default:
        return [x + u, y + h - v];
    }
  }

  /** Scene point → PDF user space. */
  scene(sx: number, sy: number): [number, number] {
    return this.user((sx - this.r.x) * this.kx, (sy - this.r.y) * this.ky);
  }

  /** A displayed rectangle → the same rectangle in user space (rotation turns w/h). */
  rect(u: number, v: number, w: number, h: number) {
    const [ax, ay] = this.user(u, v);
    const [bx, by] = this.user(u + w, v + h);
    return { x: Math.min(ax, bx), y: Math.min(ay, by), width: Math.abs(bx - ax), height: Math.abs(by - ay) };
  }

  /** An image drawn the way the page is displayed, turned to the page's stored orientation. */
  unrotate(src: HTMLCanvasElement): HTMLCanvasElement {
    if (!this.rot) return src;
    const turned = this.rot === 90 || this.rot === 270;
    const out = document.createElement("canvas");
    out.width = turned ? src.height : src.width;
    out.height = turned ? src.width : src.height;
    const g = out.getContext("2d")!;
    if (this.rot === 90) g.setTransform(0, -1, 1, 0, 0, src.width);
    else if (this.rot === 180) g.setTransform(-1, 0, 0, -1, src.width, src.height);
    else g.setTransform(0, 1, -1, 0, src.height, 0);
    g.drawImage(src, 0, 0);
    return out;
  }

  /** Grow the page by `pts` at its displayed bottom edge (for the colour key). */
  growBottom(pts: number) {
    const { x, y, width: w, height: h } = this.box;
    const grown =
      this.rot === 90
        ? [x, y, w + pts, h]
        : this.rot === 180
          ? [x, y, w, h + pts]
          : this.rot === 270
            ? [x - pts, y, w + pts, h]
            : [x, y - pts, w, h + pts];
    const m = this.page.getMediaBox();
    const mx1 = Math.min(m.x, grown[0]);
    const my1 = Math.min(m.y, grown[1]);
    const mx2 = Math.max(m.x + m.width, grown[0] + grown[2]);
    const my2 = Math.max(m.y + m.height, grown[1] + grown[3]);
    this.page.setMediaBox(mx1, my1, mx2 - mx1, my2 - my1);
    this.page.setCropBox(grown[0], grown[1], grown[2], grown[3]);
  }
}

/* ------------------------------------------------------------------ */
/* Pieces                                                              */
/* ------------------------------------------------------------------ */

async function drawLayer(doc: PDFDocument, sp: PageSpace, layer: Awaited<ReturnType<typeof renderLayer>>, blend?: BlendMode) {
  if (!layer) return;
  const img = await doc.embedPng(await toPng(sp.unrotate(layer.canvas)));
  const at = sp.rect((layer.x - sp.r.x) * sp.kx, (layer.y - sp.r.y) * sp.ky, layer.w * sp.kx, layer.h * sp.ky);
  sp.page.drawImage(img, { ...at, ...(blend ? { blendMode: blend } : {}) });
}

/** A real PDF highlight annotation over the words of one snapped highlight. */
function addHighlight(doc: PDFDocument, sp: PageSpace, el: El, list: Category[]) {
  const color = highlightColor(el);
  const [cr, cg, cb] = onPaper(color, el.opacity ?? 100);
  const u = (el.x - sp.r.x) * sp.kx;
  const v = (el.y - sp.r.y) * sp.ky;
  const w = el.width * sp.kx;
  const h = el.height * sp.ky;
  // Corners as displayed: upper-left, upper-right, lower-left, lower-right (the order PDF viewers expect).
  const q = [sp.user(u, v), sp.user(u + w, v), sp.user(u, v + h), sp.user(u + w, v + h)];
  const xs = q.map((p) => p[0]);
  const ys = q.map((p) => p[1]);
  const rect = [Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys)];
  const f = (n: number) => n.toFixed(2);
  const fill = `/GS0 gs ${f(cr)} ${f(cg)} ${f(cb)} rg ${f(q[0][0])} ${f(q[0][1])} m ${f(q[1][0])} ${f(q[1][1])} l ${f(q[3][0])} ${f(q[3][1])} l ${f(q[2][0])} ${f(q[2][1])} l h f`;
  const gs = doc.context.obj({ Type: "ExtGState", BM: "Multiply", CA: 1, ca: 1 });
  const ap = doc.context.stream(fill, {
    Type: "XObject",
    Subtype: "Form",
    BBox: rect,
    Resources: { ExtGState: { GS0: doc.context.register(gs) } },
  });
  const label = labelFor(list, color);
  const text = String((el.customData as { text?: string } | undefined)?.text ?? "");
  const annot = doc.context.obj({
    Type: "Annot",
    Subtype: "Highlight",
    Rect: rect,
    QuadPoints: q.flat(),
    C: [cr, cg, cb],
    CA: 1,
    F: 4, // print it
    NM: PDFString.of(`handnote-${el.id}`),
    T: PDFHexString.fromText("Handnote"),
    Contents: PDFHexString.fromText(label ? `${label}: ${text}` : text),
    ...(label ? { Subj: PDFHexString.fromText(label) } : {}),
    AP: { N: doc.context.register(ap) },
  });
  sp.page.node.addAnnot(doc.context.register(annot));
}

/* ------------------------------------------------------------------ */
/* The whole PDF                                                       */
/* ------------------------------------------------------------------ */

export interface AnnotateOptions {
  /** Only these notebook pages (0-based), e.g. to print a range. */
  only?: number[];
  /** Colour key under each page that has meanings on it. */
  legend: boolean;
  /** Draws a notebook page that has no PDF page under it (pages added in the notebook). */
  renderExtraPage(r: PageRect): Promise<HTMLCanvasElement>;
}

export async function buildAnnotatedPdf(ctx: HandnoteContext, original: Uint8Array, opts: AnnotateOptions): Promise<Uint8Array> {
  const doc = await PDFDocument.load(original, { updateMetadata: false });
  const pdfPages = doc.getPages();
  const list = categories(ctx);
  const legendItems = opts.legend ? legends(ctx) : [];
  const els = ctx.elements().filter((e) => !e.isDeleted);
  const rects = pageRects(ctx.state.pages);
  /** notebook page → page in the finished PDF */
  const out = new Map<number, number>();

  for (const r of rects) {
    const page = pdfPages[r.index];
    const legend = legendItems[r.index] ?? [];
    if (opts.only && !opts.only.includes(r.index)) continue;
    if (!page) {
      // A page added in the notebook: drawn like an export, appended at the end.
      const canvas = await opts.renderExtraPage(r);
      const img = await doc.embedPng(await toPng(canvas));
      const p = doc.addPage([r.w * 0.75, (canvas.height / canvas.width) * r.w * 0.75]);
      p.drawImage(img, { x: 0, y: 0, width: p.getWidth(), height: p.getHeight() });
      out.set(r.index, doc.getPageCount() - 1);
      continue;
    }
    out.set(r.index, r.index);
    const sp = new PageSpace(page, r);
    const mine = els.filter((e) => onPageRect(e, r));
    // Freehand highlights go on like real highlighter ink (multiply), then pens on top.
    await drawLayer(doc, sp, await renderLayer(ctx, mine.filter((e) => isHighlight(e) && !isTextHighlight(e))), BlendMode.Multiply);
    await drawLayer(doc, sp, await renderLayer(ctx, mine.filter((e) => !isHighlight(e))));
    for (const e of mine.filter(isTextHighlight)) addHighlight(doc, sp, e, list);
    if (legend.length) {
      const strip = LEGEND_H * sp.ky;
      sp.growBottom(strip);
      const img = await doc.embedPng(await toPng(sp.unrotate(legendCanvas(legend, r.w, SCALE * 1.5))));
      page.drawImage(img, sp.rect(0, sp.dispH, sp.dispW, strip));
    }
  }

  if (opts.only) {
    const wanted = new Set(out.values());
    for (let i = doc.getPageCount() - 1; i >= 0; i--) if (!wanted.has(i)) doc.removePage(i);
  }
  doc.catalog.set(PDFName.of(ANNOTATED_MARK), PDFString.of(new Date().toISOString()));
  return doc.save();
}
