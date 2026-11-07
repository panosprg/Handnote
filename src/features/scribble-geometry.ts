/**
 * Scribble-to-delete: a fast zig-zag drawn over existing ink deletes that ink
 * (and the scribble itself). Pure geometry, no ML.
 */

type Pt = [number, number];

interface Box {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
}

// Minimal structural types so we don't depend on Excalidraw internals.
export interface InkElement {
  id: string;
  type: string;
  x: number;
  y: number;
  width: number;
  height: number;
  isDeleted: boolean;
  points?: readonly (readonly [number, number])[];
}

function boxOf(pts: Pt[]): Box {
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const [x, y] of pts) {
    if (x < minX) minX = x;
    if (y < minY) minY = y;
    if (x > maxX) maxX = x;
    if (y > maxY) maxY = y;
  }
  return { minX, minY, maxX, maxY };
}

/** Counts direction reversals along one axis, ignoring jitter below `minTravel`. */
function reversals(values: number[], minTravel: number): number {
  let count = 0;
  let dir = 0; // -1, 0, 1
  let anchor = values[0];
  for (let i = 1; i < values.length; i++) {
    const d = values[i] - anchor;
    if (Math.abs(d) < minTravel) continue;
    const nd = Math.sign(d);
    if (dir !== 0 && nd !== dir) count++;
    dir = nd;
    anchor = values[i];
  }
  return count;
}

function absPoints(el: InkElement): Pt[] {
  return (el.points ?? []).map(([px, py]) => [el.x + px, el.y + py] as Pt);
}

export function isScribble(el: InkElement): boolean {
  if (el.type !== "freedraw") return false;
  const pts = absPoints(el);
  if (pts.length < 12) return false;
  const b = boxOf(pts);
  const w = b.maxX - b.minX;
  const h = b.maxY - b.minY;
  const extent = Math.max(w, h);
  if (extent < 12) return false;

  let len = 0;
  for (let i = 1; i < pts.length; i++) {
    len += Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]);
  }
  const revX = reversals(pts.map((p) => p[0]), Math.max(4, w * 0.2));
  const revY = reversals(pts.map((p) => p[1]), Math.max(4, h * 0.2));

  // A scribble goes back and forth over the same small area many times. Handwriting
  // (even joined-up "mmm" or "minimum") moves forward and is far less dense.
  const dense = len >= 5 * extent;
  return dense && (revX >= 4 || revY >= 6);
}

type Seg = [number, number, number, number];
const segs = (pts: Pt[]): Seg[] => pts.slice(1).map((p, i) => [pts[i][0], pts[i][1], p[0], p[1]]);
function crosses(a: Seg, b: Seg) {
  const d = (x1: number, y1: number, x2: number, y2: number, x3: number, y3: number) => (x2 - x1) * (y3 - y1) - (y2 - y1) * (x3 - x1);
  const d1 = d(b[0], b[1], b[2], b[3], a[0], a[1]);
  const d2 = d(b[0], b[1], b[2], b[3], a[2], a[3]);
  const d3 = d(a[0], a[1], a[2], a[3], b[0], b[1]);
  const d4 = d(a[0], a[1], a[2], a[3], b[2], b[3]);
  return d1 * d2 < 0 && d3 * d4 < 0;
}

/** How many times the scribble's path crosses this stroke. */
export function crossings(scribble: InkElement, el: InkElement): number {
  const s = segs(absPoints(scribble));
  const e = segs(absPoints(el));
  let n = 0;
  for (const a of s) {
    const ax1 = Math.min(a[0], a[2]), ax2 = Math.max(a[0], a[2]), ay1 = Math.min(a[1], a[3]), ay2 = Math.max(a[1], a[3]);
    for (const b of e) {
      if (Math.max(b[0], b[2]) < ax1 || Math.min(b[0], b[2]) > ax2 || Math.max(b[1], b[3]) < ay1 || Math.min(b[1], b[3]) > ay2) continue;
      if (crosses(a, b)) n++;
    }
  }
  return n;
}

/**
 * The strokes a scribble really deletes — or none, if it doesn't look like you scribbled
 * something out. Rules (so ordinary writing next to other writing never deletes anything):
 *  - the scribble crosses existing ink at least 4 times, and
 *  - that ink fills a fair part of the scribble's area (not a lone i-dot inside a word), and
 *  - only strokes it actually crosses, or that sit completely inside it, are deleted.
 */
export function scribbleDeletes(scribble: InkElement, all: readonly InkElement[]): InkElement[] {
  if (!isScribble(scribble)) return [];
  const candidates = findScribbleTargets(scribble, all);
  if (!candidates.length) return [];
  const b = boxOf(absPoints(scribble));
  const area = Math.max(1, (b.maxX - b.minX) * (b.maxY - b.minY));
  let total = 0;
  const picked: InkElement[] = [];
  let u: Box | null = null;
  for (const el of candidates) {
    const n = el.points?.length ? crossings(scribble, el) : 0;
    total += n;
    const eb = el.points?.length ? boxOf(absPoints(el)) : { minX: el.x, minY: el.y, maxX: el.x + el.width, maxY: el.y + el.height };
    const fullyInside = eb.minX >= b.minX - 2 && eb.maxX <= b.maxX + 2 && eb.minY >= b.minY - 2 && eb.maxY <= b.maxY + 2;
    if (n > 0 || fullyInside) {
      picked.push(el);
      u = u ? { minX: Math.min(u.minX, eb.minX), minY: Math.min(u.minY, eb.minY), maxX: Math.max(u.maxX, eb.maxX), maxY: Math.max(u.maxY, eb.maxY) } : eb;
    }
  }
  if (total < 4 || !u) return [];
  const covered = Math.max(0, Math.min(u.maxX, b.maxX) - Math.max(u.minX, b.minX)) * Math.max(0, Math.min(u.maxY, b.maxY) - Math.max(u.minY, b.minY));
  if (covered / area < 0.3) return [];
  return picked;
}

/** Elements mostly covered by the scribble's bounding box. */
export function findScribbleTargets(scribble: InkElement, all: readonly InkElement[]): InkElement[] {
  const b = boxOf(absPoints(scribble));
  const pad = 4;
  const inBox = (x: number, y: number) =>
    x >= b.minX - pad && x <= b.maxX + pad && y >= b.minY - pad && y <= b.maxY + pad;

  return all.filter((el) => {
    if (el.isDeleted || el.id === scribble.id) return false;
    if ((el.type === "freedraw" || (el.type === "line" && (el as { customData?: { hn?: string } }).customData?.hn === "dash")) && el.points && el.points.length) {
      const pts = absPoints(el);
      const inside = pts.filter(([x, y]) => inBox(x, y)).length;
      return inside / pts.length >= 0.5;
    }
    // Other shapes: at least half of their box lies inside the scribble box.
    const ex1 = Math.min(el.x, el.x + el.width), ex2 = Math.max(el.x, el.x + el.width);
    const ey1 = Math.min(el.y, el.y + el.height), ey2 = Math.max(el.y, el.y + el.height);
    const ow = Math.max(0, Math.min(ex2, b.maxX) - Math.max(ex1, b.minX));
    const oh = Math.max(0, Math.min(ey2, b.maxY) - Math.max(ey1, b.minY));
    const area = Math.max(1, (ex2 - ex1) * (ey2 - ey1));
    return (ow * oh) / area >= 0.5;
  });
}
