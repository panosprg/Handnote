import { exportToCanvas, getCommonBounds } from "@excalidraw/excalidraw";
import { PDFDocument } from "pdf-lib";
import type { HandnoteContext, El } from "./context";
import { pageRects, type PageRect } from "./pages";
import type { Template } from "./settings";

const SCALE = 2; // ~192 dpi: sharp on paper, reasonable file size
const LINE = "rgba(70, 110, 170, 0.28)";
const DOT = "rgba(60, 60, 70, 0.4)";

function drawTemplate(g: CanvasRenderingContext2D, r: PageRect, template: Template) {
  const w = r.w * SCALE;
  const h = r.h * SCALE;
  g.fillStyle = "#ffffff";
  g.fillRect(0, 0, w, h);
  if (template === "blank") return;
  const step = (template === "lined" ? 32 : 24) * SCALE;
  g.strokeStyle = LINE;
  g.fillStyle = DOT;
  g.lineWidth = SCALE;
  if (template === "lined" || template === "grid") {
    for (let y = step; y < h; y += step) {
      g.beginPath();
      g.moveTo(0, y - 0.5);
      g.lineTo(w, y - 0.5);
      g.stroke();
    }
  }
  if (template === "grid") {
    for (let x = step; x < w; x += step) {
      g.beginPath();
      g.moveTo(x - 0.5, 0);
      g.lineTo(x - 0.5, h);
      g.stroke();
    }
  }
  if (template === "dots") {
    for (let y = step; y < h; y += step)
      for (let x = step; x < w; x += step) {
        g.beginPath();
        g.arc(x, y, 1.3 * SCALE, 0, 2 * Math.PI);
        g.fill();
      }
  }
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

export async function renderPage(ctx: HandnoteContext, r: PageRect, template: Template): Promise<HTMLCanvasElement> {
  const page = document.createElement("canvas");
  page.width = Math.round(r.w * SCALE);
  page.height = Math.round(r.h * SCALE);
  const g = page.getContext("2d")!;
  const bg = ctx.state.pageImages[r.index];
  if (bg) {
    g.drawImage(await loadImage(bg), 0, 0, page.width, page.height);
  } else {
    drawTemplate(g, r, template);
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

/** The whole notebook as a PDF, one PDF page per notebook page. */
export async function exportPdf(ctx: HandnoteContext): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  for (const r of pageRects(ctx.state.pages)) {
    const canvas = await renderPage(ctx, r, ctx.state.template);
    const img = await doc.embedJpg(await toJpeg(canvas));
    const page = doc.addPage([r.w * 0.75, r.h * 0.75]); // CSS px → PDF points
    page.drawImage(img, { x: 0, y: 0, width: r.w * 0.75, height: r.h * 0.75 });
  }
  return doc.save();
}

