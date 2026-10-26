/**
 * Shape recognition for "hold to snap": a rough line, angle, triangle,
 * rectangle, circle or ellipse becomes a clean one. Pure geometry.
 */
type Pt = [number, number];

const dist = (a: Pt, b: Pt) => Math.hypot(a[0] - b[0], a[1] - b[1]);

function perpDist(p: Pt, a: Pt, b: Pt) {
  const l = dist(a, b);
  if (!l) return dist(p, a);
  return Math.abs((b[0] - a[0]) * (a[1] - p[1]) - (a[0] - p[0]) * (b[1] - a[1])) / l;
}

/** Ramer–Douglas–Peucker simplification. */
export function rdp(pts: Pt[], eps: number): Pt[] {
  if (pts.length < 3) return pts.slice();
  let maxD = 0;
  let idx = 0;
  for (let i = 1; i < pts.length - 1; i++) {
    const d = perpDist(pts[i], pts[0], pts[pts.length - 1]);
    if (d > maxD) [maxD, idx] = [d, i];
  }
  if (maxD <= eps) return [pts[0], pts[pts.length - 1]];
  return [...rdp(pts.slice(0, idx + 1), eps).slice(0, -1), ...rdp(pts.slice(idx), eps)];
}

function densify(poly: Pt[], step: number): Pt[] {
  const out: Pt[] = [];
  for (let i = 1; i < poly.length; i++) {
    const [a, b] = [poly[i - 1], poly[i]];
    const n = Math.max(1, Math.ceil(dist(a, b) / step));
    for (let k = 0; k < n; k++) out.push([a[0] + ((b[0] - a[0]) * k) / n, a[1] + ((b[1] - a[1]) * k) / n]);
  }
  out.push(poly[poly.length - 1]);
  return out;
}

function angleAt(a: Pt, b: Pt, c: Pt) {
  const v1 = [a[0] - b[0], a[1] - b[1]];
  const v2 = [c[0] - b[0], c[1] - b[1]];
  const cos = (v1[0] * v2[0] + v1[1] * v2[1]) / (Math.hypot(v1[0], v1[1]) * Math.hypot(v2[0], v2[1]) || 1);
  return (Math.acos(Math.max(-1, Math.min(1, cos))) * 180) / Math.PI;
}

export type ShapeKind = "line" | "angle" | "triangle" | "rectangle" | "polygon" | "circle" | "ellipse";

/**
 * @param pts stroke in scene units
 * @param px  size of one screen pixel in scene units (1 / zoom)
 */
export function recognizeShape(pts: Pt[], px: number): { kind: ShapeKind; points: Pt[] } | null {
  if (pts.length < 4) return null;
  let len = 0;
  for (let i = 1; i < pts.length; i++) len += dist(pts[i - 1], pts[i]);
  if (len < 14 * px) return null;

  const xs = pts.map((p) => p[0]);
  const ys = pts.map((p) => p[1]);
  const [x1, x2, y1, y2] = [Math.min(...xs), Math.max(...xs), Math.min(...ys), Math.max(...ys)];
  const w = x2 - x1;
  const h = y2 - y1;
  const size = Math.max(w, h);
  const step = 2.5 * px;
  const closed = dist(pts[0], pts[pts.length - 1]) < Math.max(0.2 * size, 10 * px) && len > 2.2 * size;

  if (!closed) {
    const simple = rdp(pts, Math.max(3 * px, 0.06 * size));
    if (simple.length === 2) return { kind: "line", points: densify(simple, step) };
    if (simple.length === 3 && angleAt(simple[0], simple[1], simple[2]) < 160) {
      return { kind: "angle", points: densify(simple, step) };
    }
    return null;
  }

  // Closed shapes: try polygons first, then round shapes.
  const ring = rdp(pts, Math.max(3 * px, 0.08 * size));
  if (dist(ring[0], ring[ring.length - 1]) < Math.max(0.2 * size, 10 * px)) ring.pop();
  const centre: Pt = [(x1 + x2) / 2, (y1 + y2) / 2];
  const rx = w / 2;
  const ry = h / 2;

  // How well an ellipse fits: average |normalised radius - 1|.
  const ellipseError =
    rx && ry
      ? pts.reduce((s, p) => s + Math.abs(Math.hypot((p[0] - centre[0]) / rx, (p[1] - centre[1]) / ry) - 1), 0) / pts.length
      : 1;

  if (ring.length === 3) {
    return { kind: "triangle", points: densify([...ring, ring[0]], step) };
  }
  if (ring.length === 4 && ellipseError > 0.08) {
    const angles = ring.map((p, i) => angleAt(ring[(i + 3) % 4], p, ring[(i + 1) % 4]));
    const square = angles.every((a) => Math.abs(a - 90) < 22);
    const edgeAngles = ring.map((p, i) => {
      const q = ring[(i + 1) % 4];
      const a = (Math.atan2(q[1] - p[1], q[0] - p[0]) * 180) / Math.PI;
      return Math.min(Math.abs(((a % 90) + 90) % 90), 90 - Math.abs(((a % 90) + 90) % 90));
    });
    if (square && edgeAngles.every((a) => a < 14)) {
      const r: Pt[] = [[x1, y1], [x2, y1], [x2, y2], [x1, y2], [x1, y1]];
      return { kind: "rectangle", points: densify(r, step) };
    }
    return { kind: "polygon", points: densify([...ring, ring[0]], step) };
  }
  if (ellipseError < 0.2 && rx > 0 && ry > 0) {
    const round = Math.abs(rx - ry) / Math.max(rx, ry) < 0.15;
    const [a, b] = round ? [(rx + ry) / 2, (rx + ry) / 2] : [rx, ry];
    // Start where the user started, so the snapped shape doesn't jump around.
    const start = Math.atan2((pts[0][1] - centre[1]) / b, (pts[0][0] - centre[0]) / a);
    const n = Math.max(48, Math.ceil((2 * Math.PI * Math.max(a, b)) / step));
    const out: Pt[] = [];
    for (let i = 0; i <= n; i++) {
      const t = start + (i / n) * 2 * Math.PI;
      out.push([centre[0] + a * Math.cos(t), centre[1] + b * Math.sin(t)]);
    }
    return { kind: round ? "circle" : "ellipse", points: out };
  }
  if (ring.length >= 5 && ring.length <= 8) {
    return { kind: "polygon", points: densify([...ring, ring[0]], step) };
  }
  return null;
}
