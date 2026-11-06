import { exportToCanvas, getCommonBounds } from "@excalidraw/excalidraw";
import { PDFDocument } from "pdf-lib";
import type { HandnoteContext, El } from "./context";
import { pageRects, type PageRect } from "./pages";
import type { Template } from "./settings";
import { drawTemplate } from "./templates";
import { ANNOTATE_FEATURE, drawLegend, legends, LEGEND_H, type Category } from "./categories";
import { buildAnnotatedPdf } from "./pdf-annotate";

const SCALE = 2; // ~192 dpi: sharp on paper, reasonable file size

/**
 * Room around elements when drawing them: Excalidraw measures a stroke by its centre line,
 * so without this a stroke's outer half is cut off, and a perfectly straight one (a straightened
 * highlight) has no height at all and disappears.
 */
export function inkPadding(els: { strokeWidth?: unknown; type?: unknown }[]): number {
  const widest = Math.max(0, ...els.map((e) => Number(e.strokeWidth) || 0));
  return Math.ceil(widest * 4.5) + 2;
}

function intersects(el: El, r: PageRect) {
  const [x1, y1, x2, y2] = getCommonBounds([el] as never);
  return x2 >= r.x && x1 <= r.x + r.w && y2 >= r.y && y1 <= r.y + r.h;
}

/** Renders one page (paper + ink) to a canvas at print resolution. */
const loadImage = (src: string) =>
  new Promise<HTMLImageElement>((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error("page image failed to load"));
    img.src = src;
  });

/** The colour key for each page in exports (empty when it's switched off). */
export function exportLegends(ctx: HandnoteContext): Category[][] {
  if (!ctx.isEnabled(ANNOTATE_FEATURE)) return [];
  if (ctx.featureSettings<{ legendInExports?: boolean }>(ANNOTATE_FEATURE).legendInExports === false) return [];
  return legends(ctx);
}

export async function renderPage(ctx: HandnoteContext, r: PageRect, template: Template, legend: Category[] = []): Promise<HTMLCanvasElement> {
  const page = document.createElement("canvas");
  page.width = Math.round(r.w * SCALE);
  page.height = Math.round((r.h + (legend.length ? LEGEND_H : 0)) * SCALE);
  const g = page.getContext("2d")!;
  const bg = ctx.state.pageImages[r.index];
  if (bg) {
    g.drawImage(await loadImage(bg), 0, 0, page.width, page.height);
  } else {
    drawTemplate(g, template, r.w, r.h, SCALE);
  }
  // Ink is laid on like real ink: a highlighter over text leaves the text black.
  g.globalCompositeOperation = "multiply";

  // The colour key goes under the page (the page grows; nothing on it is covered).
  const withLegend = () => {
    if (!legend.length) return page;
    g.globalCompositeOperation = "source-over";
    g.save();
    g.translate(0, r.h * SCALE);
    g.scale(SCALE, SCALE);
    drawLegend(g, legend, r.w);
    g.restore();
    return page;
  };
  const els = ctx.elements().filter((e) => intersects(e, r));
  if (!els.length) return withLegend();
  const [minX, minY] = getCommonBounds(els as never);
  const pad = inkPadding(els);
  const ink = await exportToCanvas({
    elements: els as never,
    appState: { exportBackground: false, viewBackgroundColor: "transparent", exportWithDarkMode: false, theme: "light" } as never,
    files: ctx.api.getFiles(),
    exportPadding: pad,
    getDimensions: (w: number, h: number) => ({ width: w * SCALE, height: h * SCALE, scale: SCALE }),
  });
  if (ink.width > 0 && ink.height > 0) g.drawImage(ink, (minX - pad - r.x) * SCALE, (minY - pad - r.y) * SCALE);
  return withLegend();
}

const toJpeg = (c: HTMLCanvasElement) =>
  new Promise<Uint8Array>((resolve, reject) =>
    c.toBlob(
      (b) => (b ? b.arrayBuffer().then((a) => resolve(new Uint8Array(a)), reject) : reject(new Error("could not encode page"))),
      "image/jpeg",
      0.92,
    ),
  );

/**
 * The notebook as a PDF, one PDF page per notebook page (or only `only`, 0-based).
 * With `original` (the untouched PDF a notebook was made from) the PDF's own pages are
 * kept, with the annotations added to them, instead of pictures of the pages.
 */
export async function exportPdf(ctx: HandnoteContext, only?: number[], original?: Uint8Array | null): Promise<Uint8Array> {
  const legend = exportLegends(ctx);
  if (original) {
    try {
      return await buildAnnotatedPdf(ctx, original, {
        only,
        legend: legend.length > 0,
        renderExtraPage: (r) => renderPage(ctx, r, ctx.pageTemplate(r.index), legend[r.index]),
      });
    } catch (e) {
      // A PDF pdf-lib can't edit (encrypted, broken): fall back to pictures of the pages.
      console.warn("Handnote: couldn't add to the original PDF, exporting page images instead", e);
    }
  }
  const doc = await PDFDocument.create();
  for (const r of pageRects(ctx.state.pages)) {
    if (only && !only.includes(r.index)) continue;
    const canvas = await renderPage(ctx, r, ctx.pageTemplate(r.index), legend[r.index]);
    const img = await doc.embedJpg(await toJpeg(canvas));
    const h = (canvas.height / canvas.width) * r.w;
    const page = doc.addPage([r.w * 0.75, h * 0.75]); // CSS px → PDF points
    page.drawImage(img, { x: 0, y: 0, width: r.w * 0.75, height: h * 0.75 });
  }
  return doc.save();
}

