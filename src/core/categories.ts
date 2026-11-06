/**
 * Highlight meanings: each highlighter colour can stand for something
 * ("yellow = Evidence"). Kept per notebook (each PDF can use its own key),
 * starting from the defaults in the settings. Used by the highlighter panel,
 * the legend under each page, export and "write into the PDF".
 */
import type { El, HandnoteContext } from "./context";
import { pageRects, type PageRect } from "./pages";

export interface Category {
  color: string;
  label: string;
}

export const DEFAULT_CATEGORIES: Category[] = [
  { color: "#ffe066", label: "Evidence" },
  { color: "#b2f2bb", label: "Key idea" },
  { color: "#a5d8ff", label: "Definition" },
  { color: "#fcc2d7", label: "Question" },
];

/** Notebook meta key the categories are saved under. */
export const CATEGORIES_KEY = "highlightCategories";
/** Feature that owns the default categories (in its settings). */
export const ANNOTATE_FEATURE = "pdf-annotate";

const norm = (c: string) => (c ?? "").toLowerCase();

export const isHighlight = (e: El) => !e.isDeleted && (e.customData as { hn?: string } | undefined)?.hn === "hl";
/** A highlight snapped to PDF words (a box) rather than a freehand stroke. */
export const isTextHighlight = (e: El) => isHighlight(e) && e.type === "rectangle";
export const highlightColor = (e: El) => norm((e.type === "rectangle" ? e.backgroundColor : e.strokeColor) as string);

export function categories(ctx: HandnoteContext): Category[] {
  const own = ctx.state.meta?.[CATEGORIES_KEY] as Category[] | undefined;
  if (Array.isArray(own)) return own;
  const d = ctx.featureSettings<{ defaultCategories?: Category[] }>(ANNOTATE_FEATURE).defaultCategories;
  return Array.isArray(d) ? d : DEFAULT_CATEGORIES;
}

export function setCategories(ctx: HandnoteContext, list: Category[]) {
  // One meaning per colour; empty names are dropped.
  const seen = new Set<string>();
  const clean = list
    .map((c) => ({ color: norm(c.color), label: c.label }))
    .filter((c) => c.color && !seen.has(c.color) && seen.add(c.color));
  ctx.setMeta(CATEGORIES_KEY, clean);
}

export function labelFor(list: Category[], color: string): string | undefined {
  const c = norm(color);
  return list.find((x) => x.color === c && x.label.trim())?.label.trim();
}

function onPage(e: El, r: PageRect) {
  const cy = e.y + Math.max(0, e.height) / 2;
  const cx = e.x + Math.max(0, e.width) / 2;
  return cy >= r.y && cy <= r.y + r.h && cx >= r.x - 40 && cx <= r.x + r.w + 40;
}

/** The meanings used on each page, in the order of the key. Pages with none get []. */
export function legends(ctx: HandnoteContext, els: readonly El[] = ctx.elements()): Category[][] {
  const list = categories(ctx).filter((c) => c.label.trim());
  const rects = pageRects(ctx.state.pages);
  const used = rects.map(() => new Set<string>());
  for (const e of els) {
    if (!isHighlight(e)) continue;
    const r = rects.find((r) => onPage(e, r));
    if (r) used[r.index].add(highlightColor(e));
  }
  return used.map((u) => list.filter((c) => u.has(c.color)));
}

/** Height of the key added under a page in exports (CSS px). */
export const LEGEND_H = 30;

/**
 * Draws the key: a coloured mark and its name for each meaning, on one line
 * (wrapping if it doesn't fit). `g` is already scaled so 1 unit = 1 CSS px.
 */
export function drawLegend(g: CanvasRenderingContext2D, items: Category[], w: number, h = LEGEND_H) {
  g.save();
  g.fillStyle = "#ffffff";
  g.fillRect(0, 0, w, h);
  g.strokeStyle = "#dee2e6";
  g.lineWidth = 1;
  g.beginPath();
  g.moveTo(24, 0.5);
  g.lineTo(w - 24, 0.5);
  g.stroke();
  g.font = "11px -apple-system, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif";
  g.textBaseline = "middle";
  let x = 24;
  const y = h / 2 + 1;
  for (const c of items) {
    const tw = g.measureText(c.label).width;
    if (x + 22 + tw > w - 24) break;
    g.fillStyle = c.color;
    roundRect(g, x, y - 6, 16, 12, 3);
    g.fill();
    g.fillStyle = "#343a40";
    g.fillText(c.label, x + 21, y);
    x += 21 + tw + 18;
  }
  g.restore();
}

function roundRect(g: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  g.beginPath();
  g.moveTo(x + r, y);
  g.arcTo(x + w, y, x + w, y + h, r);
  g.arcTo(x + w, y + h, x, y + h, r);
  g.arcTo(x, y + h, x, y, r);
  g.arcTo(x, y, x + w, y, r);
  g.closePath();
}

/** A legend as its own image (PNG-ready canvas) at `scale`. */
export function legendCanvas(items: Category[], w: number, scale: number): HTMLCanvasElement {
  const c = document.createElement("canvas");
  c.width = Math.round(w * scale);
  c.height = Math.round(LEGEND_H * scale);
  const g = c.getContext("2d")!;
  g.scale(scale, scale);
  drawLegend(g, items, w);
  return c;
}

/** What a translucent highlighter colour looks like on white paper (for PDF annotations). */
export function onPaper(color: string, opacity: number): [number, number, number] {
  const hex = norm(color).replace("#", "");
  const full = hex.length === 3 ? hex.split("").map((c) => c + c).join("") : hex.padEnd(6, "0");
  const a = Math.max(0, Math.min(1, opacity / 100));
  return [0, 2, 4].map((i) => {
    const v = parseInt(full.slice(i, i + 2), 16) / 255;
    return 1 - a * (1 - v);
  }) as [number, number, number];
}
