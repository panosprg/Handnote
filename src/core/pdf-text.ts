/**
 * The text of an imported PDF: every word with its box on the page, so the
 * highlighter can snap to words and search can find and show them.
 *
 * Boxes are in CSS px relative to the page's top-left corner (the same units as
 * the notebook page), and stored next to the page images as `text.json`.
 */

export interface PdfWord {
  /** the word */
  t: string;
  x: number;
  y: number;
  w: number;
  h: number;
  /** line number on the page (words of one line share it) */
  l: number;
}

export interface PdfText {
  version: 1;
  pages: PdfWord[][];
}

/* ------------------------------------------------------------------ */
/* Extraction (pdf.js)                                                 */
/* ------------------------------------------------------------------ */

let measureCtx: CanvasRenderingContext2D | null = null;
function charWidths(s: string): number[] {
  measureCtx ??= document.createElement("canvas").getContext("2d");
  if (!measureCtx) return [...s].map(() => 1);
  measureCtx.font = "100px sans-serif";
  return [...s].map((c) => Math.max(1, measureCtx!.measureText(c).width));
}

interface Fragment {
  t: string;
  x: number;
  y: number;
  w: number;
  h: number;
  /** whitespace (or the end of the text run) right before / after it */
  openStart: boolean;
  openEnd: boolean;
  eol: boolean;
}

const round = (v: number) => Math.round(v * 10) / 10;

/**
 * The words of one pdf.js page. `page` is a pdf.js PDFPageProxy, `viewport` its
 * viewport at 96/72 (CSS px), `util` is pdfjs.Util (for the transform maths).
 */
export async function extractPageWords(page: any, viewport: any, util: any): Promise<PdfWord[]> {
  const content = await page.getTextContent();
  const frags: Fragment[] = [];
  for (const item of content.items as any[]) {
    if (typeof item?.str !== "string") continue;
    if (!item.str.trim()) {
      // A run of spaces between two runs: the next word starts fresh.
      if (frags.length) frags[frags.length - 1].openEnd = true;
      if (item.hasEOL && frags.length) frags[frags.length - 1].eol = true;
      continue;
    }
    const tx = util.transform(viewport.transform, item.transform);
    const size = Math.hypot(tx[2], tx[3]);
    // Rotated text (sideways labels, watermarks) is left out.
    if (!size || Math.abs(tx[1]) > 0.01 * size || Math.abs(tx[2]) > 0.01 * size) continue;
    const width = (item.width ?? 0) * viewport.scale;
    if (width <= 0) continue;
    const top = tx[5] - size * 0.85;
    const h = size * 1.1;
    const chars = [...item.str];
    const cw = charWidths(item.str);
    const k = width / cw.reduce((a, b) => a + b, 0);
    const xAt: number[] = [tx[4]];
    cw.forEach((w) => xAt.push(xAt[xAt.length - 1] + w * k));
    const str = chars.join("");
    // Character index → position (chars, not UTF-16 units, so Greek/emoji line up).
    const unit: number[] = [];
    chars.forEach((c, i) => {
      for (let u = 0; u < c.length; u++) unit.push(i);
    });
    unit.push(chars.length);
    for (const m of str.matchAll(/\S+/g)) {
      const a = unit[m.index!];
      const b = unit[m.index! + m[0].length];
      frags.push({
        t: m[0],
        x: xAt[a],
        y: top,
        w: xAt[b] - xAt[a],
        h,
        // A word at the very start/end of a run may continue in the next run (glued below).
        openStart: a > 0,
        openEnd: b < chars.length,
        eol: false,
      });
    }
    if (item.hasEOL && frags.length) frags[frags.length - 1].eol = true;
  }

  // Some PDFs write one letter (or syllable) per run: glue touching pieces back into words.
  const words: PdfWord[] = [];
  let line = 0;
  let prev: Fragment | null = null;
  for (const f of frags) {
    const cur = words[words.length - 1];
    const sameLine = prev && Math.abs(f.y - prev.y) < 0.5 * Math.min(f.h, prev.h) && !prev.eol;
    const gap = prev ? f.x - (prev.x + prev.w) : 0;
    if (prev && cur && sameLine && !prev.openEnd && !f.openStart && gap > -0.3 * f.h && gap < 0.12 * f.h) {
      const right = Math.max(cur.x + cur.w, f.x + f.w);
      cur.t += f.t;
      cur.y = Math.min(cur.y, f.y);
      cur.h = Math.max(cur.h, f.h);
      cur.w = right - cur.x;
    } else {
      if (prev && (!sameLine || gap < -f.h)) line++;
      words.push({ t: f.t, x: f.x, y: f.y, w: f.w, h: f.h, l: line });
    }
    prev = f;
  }
  return words.map((w) => ({ t: w.t, x: round(w.x), y: round(w.y), w: round(w.w), h: round(w.h), l: w.l }));
}

/** Compact form for text.json: [text, x, y, w, h, line]. */
export function packText(t: PdfText): string {
  return JSON.stringify({ version: 1, pages: t.pages.map((p) => p.map((w) => [w.t, w.x, w.y, w.w, w.h, w.l])) });
}

export function unpackText(raw: string): PdfText | null {
  try {
    const j = JSON.parse(raw);
    if (j?.version !== 1 || !Array.isArray(j.pages)) return null;
    return {
      version: 1,
      pages: j.pages.map((p: unknown[]) =>
        (p as [string, number, number, number, number, number][]).map(([t, x, y, w, h, l]) => ({ t, x, y, w, h, l })),
      ),
    };
  } catch {
    return null;
  }
}

/* ------------------------------------------------------------------ */
/* Geometry                                                            */
/* ------------------------------------------------------------------ */

export interface Box {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** One box per line for a run of words (what a highlight or a search hit covers). */
export function lineBoxes(words: PdfWord[]): (Box & { text: string })[] {
  const out: (Box & { text: string; l: number })[] = [];
  for (const w of words) {
    const cur = out[out.length - 1];
    // Same line and next to each other (not a word far away in another column).
    if (cur && cur.l === w.l && w.x - (cur.x + cur.w) < 3 * w.h && w.x >= cur.x) {
      const right = Math.max(cur.x + cur.w, w.x + w.w);
      const bottom = Math.max(cur.y + cur.h, w.y + w.h);
      cur.y = Math.min(cur.y, w.y);
      cur.w = right - cur.x;
      cur.h = bottom - cur.y;
      cur.text += " " + w.t;
    } else {
      out.push({ x: w.x, y: w.y, w: w.w, h: w.h, text: w.t, l: w.l });
    }
  }
  return out.map(({ l: _l, ...b }) => b);
}

/**
 * The words a highlighter stroke covers (stroke points relative to the page).
 * A word counts when the stroke runs through at least `cover` of its width,
 * within its height. Returns [] for strokes that aren't over a line of text.
 */
export function wordsUnderStroke(words: PdfWord[], pts: [number, number][], cover = 0.45): PdfWord[] {
  if (pts.length < 2 || !words.length) return [];
  const xs = pts.map((p) => p[0]);
  const ys = pts.map((p) => p[1]);
  const minX = Math.min(...xs), maxX = Math.max(...xs), minY = Math.min(...ys), maxY = Math.max(...ys);
  const hits = words.filter((w) => {
    if (w.x > maxX || w.x + w.w < minX) return false;
    const padY = w.h * 0.15;
    if (w.y - padY > maxY || w.y + w.h + padY < minY) return false;
    // How much of the word's width the stroke passes over, inside the word's band.
    const spans: [number, number][] = [];
    for (let i = 1; i < pts.length; i++) {
      const [x1, y1] = pts[i - 1];
      const [x2, y2] = pts[i];
      const mid = (y1 + y2) / 2;
      if (mid < w.y - padY || mid > w.y + w.h + padY) continue;
      const a = Math.max(w.x, Math.min(x1, x2));
      const b = Math.min(w.x + w.w, Math.max(x1, x2));
      if (b > a) spans.push([a, b]);
    }
    spans.sort((p, q) => p[0] - q[0]);
    let covered = 0;
    let end = -Infinity;
    for (const [a, b] of spans) {
      if (b <= end) continue;
      covered += b - Math.max(a, end);
      end = b;
    }
    return covered >= cover * w.w;
  });
  if (!hits.length) return [];
  // A highlighter stroke over text is roughly one line tall; a big loop or a scribble isn't a highlight of words.
  const lineH = Math.max(...hits.map((w) => w.h));
  const lines = new Set(hits.map((w) => w.l));
  if (maxY - minY > lineH * (lines.size + 0.8)) return [];
  return hits;
}

/* ------------------------------------------------------------------ */
/* Search                                                              */
/* ------------------------------------------------------------------ */

/** Lower case, no accents (so "ορισμος" finds "ορισμός", "resume" finds "résumé"). */
export const fold = (s: string) =>
  s
    .normalize("NFD")
    .replace(/\p{M}+/gu, "")
    .toLowerCase()
    .replace(/[‘’]/g, "'")
    .replace(/[“”]/g, '"')
    .replace(/[‐-―]/g, "-");

export interface SearchHit {
  page: number;
  /** indexes into that page's words */
  from: number;
  to: number;
  boxes: Box[];
}

/** Every place `query` occurs (across word and line breaks, hyphenated line ends included). */
export function searchText(text: PdfText, query: string): SearchHit[] {
  const q = fold(query).replace(/\s+/g, " ").trim();
  if (!q) return [];
  const qNoSpace = q.replace(/ /g, "");
  const hits: SearchHit[] = [];
  text.pages.forEach((words, page) => {
    // Page text without spaces, with each character's word, so "data base" also finds "data-\nbase" etc.
    let s = "";
    const owner: number[] = [];
    words.forEach((w, i) => {
      let t = fold(w.t);
      // "infor-" at the end of a line + "mation" on the next = "information"
      const next = words[i + 1];
      if (t.endsWith("-") && next && next.l !== w.l) t = t.slice(0, -1);
      for (let c = 0; c < t.length; c++) {
        s += t[c];
        owner.push(i);
      }
    });
    if (!s) return;
    let at = s.indexOf(qNoSpace);
    while (at !== -1) {
      const from = owner[at];
      const to = owner[at + qNoSpace.length - 1];
      hits.push({ page, from, to, boxes: lineBoxes(words.slice(from, to + 1)) });
      at = s.indexOf(qNoSpace, at + Math.max(1, qNoSpace.length));
    }
  });
  return hits;
}
