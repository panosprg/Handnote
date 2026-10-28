import { loadPdfJs, normalizePath, type App, type TFile } from "obsidian";
import type { PagesInfo } from "./core/pages";
import { emptyNote, type PdfPageAsset } from "./data";

const RENDER_SCALE = 2; // page images at ~192 dpi

/**
 * Turns a PDF into a notebook: each PDF page becomes a page of the notebook
 * with the PDF page as its locked background image, ready to write on.
 * The notebook goes in `dest.folder`, its page images in `dest.attachments/<name> pages`
 * (both inside the Handnote folder, so nothing is scattered around the vault).
 */
export async function importPdf(
  app: App,
  pdf: TFile,
  dest: { folder: string; attachments: string },
  onProgress?: (done: number, total: number) => void,
): Promise<TFile> {
  const pdfjs = await loadPdfJs();
  const data = new Uint8Array(await app.vault.readBinary(pdf));
  const doc = await pdfjs.getDocument({ data }).promise;
  const total: number = doc.numPages;

  const folder = dest.folder && dest.folder !== "/" ? normalizePath(dest.folder) + "/" : "";
  let base = pdf.basename;
  for (
    let i = 2;
    app.vault.getAbstractFileByPath(normalizePath(`${folder}${base}.handnote`)) ||
    app.vault.getAbstractFileByPath(normalizePath(`${dest.attachments}/${base} pages`));
    i++
  )
    base = `${pdf.basename} (${i})`;
  await ensureFolder(app, folder || "/");
  const assetDir = normalizePath(`${dest.attachments}/${base} pages`);
  await ensureFolder(app, assetDir);

  const sizes: PagesInfo["sizes"] = [];
  const assets: PdfPageAsset[] = [];
  for (let n = 1; n <= total; n++) {
    const page = await doc.getPage(n);
    const vp1 = page.getViewport({ scale: 96 / 72 }); // PDF points → CSS px
    const vp = page.getViewport({ scale: (96 / 72) * RENDER_SCALE });
    const canvas = document.createElement("canvas");
    canvas.width = Math.ceil(vp.width);
    canvas.height = Math.ceil(vp.height);
    const g = canvas.getContext("2d")!;
    g.fillStyle = "#ffffff";
    g.fillRect(0, 0, canvas.width, canvas.height);
    await page.render({ canvasContext: g, viewport: vp }).promise;
    const blob: Blob = await new Promise((res, rej) => canvas.toBlob((b) => (b ? res(b) : rej(new Error("render failed"))), "image/jpeg", 0.9));
    const path = normalizePath(`${assetDir}/page ${String(n).padStart(3, "0")}.jpg`);
    const existing = app.vault.getFileByPath(path);
    if (existing) await app.vault.modifyBinary(existing, await blob.arrayBuffer());
    else await app.vault.createBinary(path, await blob.arrayBuffer());
    sizes.push({ w: Math.round(vp1.width), h: Math.round(vp1.height) });
    assets.push({ fileId: `hnpdf-${Date.now().toString(36)}-${n}`, path });
    page.cleanup?.();
    onProgress?.(n, total);
  }

  const pages: PagesInfo = { sizes };
  // The PDF pages are drawn as the paper itself (see Paper.tsx), not as objects you could move or erase.
  return app.vault.create(normalizePath(`${folder}${base}.handnote`), emptyNote("blank", { pages, pdf: { source: pdf.path, assets } }));
}

/** Creates a folder and any missing parents. */
export async function ensureFolder(app: App, path: string) {
  let current = "";
  for (const part of normalizePath(path).split("/").filter(Boolean)) {
    current = current ? `${current}/${part}` : part;
    if (!app.vault.getAbstractFileByPath(current)) await app.vault.createFolder(current);
  }
}
