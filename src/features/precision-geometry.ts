import { newElementWith } from "@excalidraw/excalidraw";
import type { El } from "../core/context";

type P = { x: number; y: number };

function distToSegment(p: P, a: P, b: P): number {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const len2 = dx * dx + dy * dy;
  let t = len2 ? ((p.x - a.x) * dx + (p.y - a.y) * dy) / len2 : 0;
  t = Math.max(0, Math.min(1, t));
  return Math.hypot(p.x - (a.x + t * dx), p.y - (a.y + t * dy));
}

function segmentsIntersect(p1: P, p2: P, p3: P, p4: P): boolean {
  const d = (a: P, b: P, c: P) => (b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x);
  const d1 = d(p3, p4, p1), d2 = d(p3, p4, p2), d3 = d(p1, p2, p3), d4 = d(p1, p2, p4);
  return ((d1 > 0 && d2 < 0) || (d1 < 0 && d2 > 0)) && ((d3 > 0 && d4 < 0) || (d3 < 0 && d4 > 0));
}

function segToSeg(a: P, b: P, c: P, d: P): number {
  if (segmentsIntersect(a, b, c, d)) return 0;
  return Math.min(distToSegment(a, c, d), distToSegment(b, c, d), distToSegment(c, a, b), distToSegment(d, a, b));
}

const randomId = () =>
  Array.from(crypto.getRandomValues(new Uint8Array(12)), (b) => (b % 36).toString(36)).join("");
const randomInt = () => Math.floor(Math.random() * 2 ** 31);

function buildPiece(el: El, pts: P[], pressures: number[], keepId: boolean): El {
  const ox = pts[0].x;
  const oy = pts[0].y;
  const rel = pts.map((p) => [p.x - ox, p.y - oy] as [number, number]);
  const xs = rel.map((p) => p[0]);
  const ys = rel.map((p) => p[1]);
  const patch = {
    x: ox,
    y: oy,
    points: rel,
    pressures,
    width: Math.max(...xs) - Math.min(...xs),
    height: Math.max(...ys) - Math.min(...ys),
    lastCommittedPoint: rel[rel.length - 1],
  };
  const next = newElementWith(el as never, patch as never) as unknown as El;
  if (keepId) return next;
  return { ...next, id: randomId(), seed: randomInt(), versionNonce: randomInt(), index: null } as El;
}

/**
 * Erase everything within `r` of the eraser's path segment a→b.
 * Strokes are split into the pieces that survive. Returns null if nothing changed.
 */
export function eraseAlong(all: El[], a: P, b: P, r: number): { next: El[]; removed: number } | null {
  const minX = Math.min(a.x, b.x) - r, maxX = Math.max(a.x, b.x) + r;
  const minY = Math.min(a.y, b.y) - r, maxY = Math.max(a.y, b.y) + r;
  let changed = false;
  let removed = 0;
  const next: El[] = [];

  for (const el of all) {
    if (el.isDeleted || el.type !== "freedraw" || !el.points || el.points.length < 2) {
      next.push(el);
      continue;
    }
    // Cheap reject on bounding boxes (points can be left/above the origin).
    const pxs = el.points.map((p) => el.x + p[0]);
    const pys = el.points.map((p) => el.y + p[1]);
    if (Math.max(...pxs) < minX || Math.min(...pxs) > maxX || Math.max(...pys) < minY || Math.min(...pys) > maxY) {
      next.push(el);
      continue;
    }

    const pts: P[] = pxs.map((x, i) => ({ x, y: pys[i] }));
    const hasPressure = !!el.pressures && el.pressures.length === pts.length;
    // Ink has visible thickness: count it as part of the eraser radius.
    const reach = r + el.strokeWidth * 1.5;
    const keep = pts.map((p) => distToSegment(p, a, b) > reach);

    const runs: number[][] = [];
    let cur: number[] = [];
    for (let i = 0; i < pts.length; i++) {
      if (!keep[i]) {
        if (cur.length) runs.push(cur);
        cur = [];
        continue;
      }
      // Both ends survive but the line between them is crossed: cut there.
      if (cur.length && segToSeg(pts[i - 1], pts[i], a, b) <= reach) {
        runs.push(cur);
        cur = [];
      }
      cur.push(i);
    }
    if (cur.length) runs.push(cur);

    if (runs.length === 1 && runs[0].length === pts.length) {
      next.push(el);
      continue;
    }

    changed = true;
    const pieces = runs.filter((run) => run.length >= 2);
    if (!pieces.length) {
      next.push(newElementWith(el as never, { isDeleted: true } as never) as unknown as El);
      removed++;
      continue;
    }
    pieces.forEach((run, i) => {
      next.push(
        buildPiece(
          el,
          run.map((j) => pts[j]),
          hasPressure ? run.map((j) => el.pressures![j]) : [],
          i === 0,
        ),
      );
    });
  }
  return changed ? { next, removed } : null;
}
