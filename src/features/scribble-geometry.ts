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

  const dense = len >= 4 * extent;
  return dense && (revX >= 4 || revY >= 6);
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
