import { exportToCanvas, getCommonBounds } from "@excalidraw/excalidraw";
import { PDFDocument } from "pdf-lib";
import type { HandnoteContext, El } from "./context";
import { pageRects, type PageRect } from "./pages";
import type { Template } from "./settings";
import { drawTemplate } from "./templates";

const SCALE = 2; // ~192 dpi: sharp on paper, reasonable file size

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

export async function renderPage(ctx: HandnoteContext, r: PageRect, template: Template): Promise<HTMLCanvasElement> {
  const page = document.createElement("canvas");
  page.width = Math.round(r.w * SCALE);
  page.height = Math.round(r.h * SCALE);
  const g = page.getContext("2d")!;
  const bg = ctx.state.pageImages[r.index];
  if (bg) {
    g.drawImage(await loadImage(bg), 0, 0, page.width, page.height);
  } else {
    drawTemplate(g, template, r.w, r.h, SCALE);
  }
  // Ink is laid on like real ink: a highlighter over text leaves the text black.
  g.globalCompositeOperation = "multiply";

  const els = ctx.elements().filter((e) => intersects(e, r));
  if (!els.length) return page;
  const [minX, minY] = getCommonBounds(els as never);
  const ink = await exportToCanvas({
    elements: els as never,
    appState: { exportBackground: false, viewBackgroundColor: "transparent", exportWithDarkMode: false, theme: "light" } as never,
    files: ctx.api.getFiles(),
    exportPadding: 0,
    getDimensions: (w: number, h: number) => ({ width: w * SCALE, height: h * SCALE, scale: SCALE }),
  });
  if (ink.width > 0 && ink.height > 0) g.drawImage(ink, (minX - r.x) * SCALE, (minY - r.y) * SCALE);
  return page;
}

const toJpeg = (c: HTMLCanvasElement) =>
  new Promise<Uint8Array>((resolve, reject) =>
    c.toBlob(
      (b) => (b ? b.arrayBuffer().then((a) => resolve(new Uint8Array(a)), reject) : reject(new Error("could not encode page"))),
      "image/jpeg",
      0.92,
    ),
  );

/** The notebook as a PDF, one PDF page per notebook page (or only `only`, 0-based). */
export async function exportPdf(ctx: HandnoteContext, only?: number[]): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  for (const r of pageRects(ctx.state.pages)) {
    if (only && !only.includes(r.index)) continue;
    const canvas = await renderPage(ctx, r, ctx.pageTemplate(r.index));
    const img = await doc.embedJpg(await toJpeg(canvas));
    const page = doc.addPage([r.w * 0.75, r.h * 0.75]); // CSS px → PDF points
    page.drawImage(img, { x: 0, y: 0, width: r.w * 0.75, height: r.h * 0.75 });
  }
  return doc.save();
}

