/**
 * Notebook pages. A note is a stack of fixed-size pages (A4 by default, or the
 * sizes of an imported PDF), laid out top to bottom in scene coordinates.
 */

/** A4 at 96 dpi (CSS pixels). */
export const A4 = { w: 794, h: 1123 };
export const PAGE_GAP = 36;

export interface PagesInfo {
  /** Size of every page, in order. */
  sizes: { w: number; h: number }[];
}

export interface PageRect {
  index: number;
  x: number;
  y: number;
  w: number;
  h: number;
}

export function defaultPages(count = 1): PagesInfo {
  return { sizes: Array.from({ length: count }, () => ({ ...A4 })) };
}

export function pageRects(p: PagesInfo): PageRect[] {
  const maxW = Math.max(...p.sizes.map((s) => s.w));
  let y = 0;
  return p.sizes.map((s, index) => {
    const r = { index, x: (maxW - s.w) / 2, y, w: s.w, h: s.h };
    y += s.h + PAGE_GAP;
    return r;
  });
}

export function totalHeight(p: PagesInfo): number {
  const rects = pageRects(p);
  const last = rects[rects.length - 1];
  return last ? last.y + last.h : 0;
}

export function maxWidth(p: PagesInfo): number {
  return Math.max(...p.sizes.map((s) => s.w));
}

/** Page under a scene point (or the nearest one above it). */
export function pageAt(p: PagesInfo, sceneY: number): number {
  const rects = pageRects(p);
  let idx = 0;
  for (const r of rects) if (sceneY >= r.y - PAGE_GAP / 2) idx = r.index;
  return idx;
}

/** Enough pages to hold existing content (for notes made before pages existed). */
export function pagesForContent(bottom: number): PagesInfo {
  return defaultPages(Math.max(1, Math.ceil((bottom + PAGE_GAP) / (A4.h + PAGE_GAP))));
}
