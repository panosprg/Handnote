import { defaultPages, pagesForContent, type PagesInfo } from "./core/pages";
import type { Template } from "./core/settings";

/** One rendered page of an imported PDF, stored as an image next to the note. */
export interface PdfPageAsset {
  fileId: string;
  /** vault path of the page image */
  path: string;
}

/**
 * A .handnote file is a normal Excalidraw scene (so it can also be opened at
 * excalidraw.com) with an extra "handnote" block for our own settings.
 */
export interface HandnoteFile {
  type: "excalidraw";
  version: 2;
  source: "obsidian-handnote";
  handnote: {
    version: number;
    template: Template;
    pages: PagesInfo;
    /** notebook cover colour (library) */
    cover?: string;
    /** set when the notebook was made from a PDF */
    pdf?: { source: string; assets: PdfPageAsset[] };
    scrollX?: number;
    scrollY?: number;
    zoom?: number;
  };
  elements: unknown[];
  appState: Record<string, unknown>;
  files: Record<string, unknown>;
}

export const COVER_COLOURS = ["#3b5bdb", "#e8590c", "#2b8a3e", "#c2255c", "#5f3dc4", "#0b7285", "#495057", "#f08c00"];

export function emptyNote(template: Template, extra: Partial<HandnoteFile["handnote"]> = {}): string {
  const file: HandnoteFile = {
    type: "excalidraw",
    version: 2,
    source: "obsidian-handnote",
    handnote: {
      version: FILE_VERSION,
      template,
      pages: defaultPages(1),
      cover: COVER_COLOURS[Math.floor(Math.random() * COVER_COLOURS.length)],
      ...extra,
    },
    elements: [],
    appState: { viewBackgroundColor: "transparent", gridSize: null },
    files: {},
  };
  return JSON.stringify(file, null, 1);
}

/**
 * File format migrations. When the note format changes, bump FILE_VERSION and
 * add a step here (version n → n+1). Old notes upgrade the next time they open.
 */
export const FILE_VERSION = 2;
const FILE_MIGRATIONS: Record<number, (f: any) => any> = {
  // 0.4: notes become notebooks with pages; old infinite notes get enough pages for their content.
  1: (f) => {
    const els: any[] = Array.isArray(f.elements) ? f.elements.filter((e: any) => !e.isDeleted) : [];
    const bottom = els.reduce((m, e) => Math.max(m, (e.y ?? 0) + Math.max(0, e.height ?? 0)), 0);
    return { ...f, handnote: { ...(f.handnote ?? {}), version: 2, pages: pagesForContent(bottom) } };
  },
};

/** Throws if the file isn't valid JSON (the view then refuses to overwrite it). */
export function parseNote(raw: string, fallbackTemplate: Template): HandnoteFile {
  let parsed = raw.trim() ? JSON.parse(raw) : { handnote: { version: FILE_VERSION } };
  for (let v = parsed.handnote?.version ?? 1; v < FILE_VERSION; v++) {
    parsed = FILE_MIGRATIONS[v](parsed);
  }
  const h = parsed.handnote ?? {};
  return {
    type: "excalidraw",
    version: 2,
    source: "obsidian-handnote",
    handnote: {
      version: FILE_VERSION,
      template: h.template ?? fallbackTemplate,
      pages: h.pages?.sizes?.length ? h.pages : defaultPages(1),
      cover: h.cover,
      pdf: h.pdf,
      scrollX: h.scrollX,
      scrollY: h.scrollY,
      zoom: h.zoom,
    },
    elements: Array.isArray(parsed.elements) ? parsed.elements : [],
    appState: parsed.appState ?? {},
    files: parsed.files ?? {},
  };
}
