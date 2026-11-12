/**
 * Select text in an imported PDF, like in Goodnotes: with the "Select text" tool,
 * drag the Pencil over the words (or tap one). The selection follows reading order,
 * across lines. Then Copy, Highlight or Search it. Drag from either end to adjust.
 * Fingers keep scrolling and zooming.
 */
import { useEffect, useState } from "react";
import { convertToExcalidrawElements } from "@excalidraw/excalidraw";
import type { El, HandnoteContext } from "../core/context";
import { pageAt, pageRects } from "../core/pages";
import { lineBoxes, type PdfWord } from "../core/pdf-text";
import { defineFeature } from "../core/types";
import { glassClass, Icon } from "../core/ui";
import "./pdf-select.css";

export const SELECT_TEXT = "pdf-select";

interface Sel {
  page: number;
  /** indexes into the page's words in reading order (a ≤ b not required) */
  a: number;
  b: number;
}

/** A page's words in reading order (line by line, left to right). */
const ordered = new WeakMap<PdfWord[], PdfWord[]>();
export function readingOrder(words: PdfWord[]): PdfWord[] {
  let o = ordered.get(words);
  if (!o) {
    o = [...words].sort((p, q) => p.l - q.l || p.x - q.x);
    ordered.set(words, o);
  }
  return o;
}

/** The word under (or nearest to) a point on the page (page coordinates). */
export function wordAt(words: PdfWord[], x: number, y: number): number {
  let best = -1;
  let bestD = Infinity;
  words.forEach((w, i) => {
    // vertical distance counts much more: stay on the line you're pointing at
    const dy = y < w.y ? w.y - y : y > w.y + w.h ? y - (w.y + w.h) : 0;
    const dx = x < w.x ? w.x - x : x > w.x + w.w ? x - (w.x + w.w) : 0;
    const d = dy * 4 + dx;
    if (d < bestD) [best, bestD] = [i, d];
  });
  return best;
}

/** The selected words as text: spaces between words, hyphenated line ends joined. */
export function selectionText(words: PdfWord[]): string {
  let out = "";
  words.forEach((w, i) => {
    if (i === 0) return void (out = w.t);
    const prev = words[i - 1];
    if (prev.l !== w.l && /[-‐]$/.test(out)) out = out.replace(/[-‐]$/, "") + w.t;
    else out += " " + w.t;
  });
  return out;
}

function selected(ctx: HandnoteContext, s: Sel): PdfWord[] {
  const words = ctx.state.pageText?.[s.page];
  if (!words) return [];
  const o = readingOrder(words);
  return o.slice(Math.min(s.a, s.b), Math.max(s.a, s.b) + 1);
}

async function copyText(text: string) {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    // older iPadOS: fall back to a hidden text field
    const ta = document.body.createEl("textarea");
    ta.value = text;
    ta.setCssStyles({ position: "fixed", opacity: "0", top: "0" });
    ta.select();
    const ok = document.execCommand("copy");
    ta.remove();
    return ok;
  }
}

/** Turns the selection into word highlights in the highlighter's colour (one undo step). */
function highlightSelection(ctx: HandnoteContext, s: Sel) {
  const words = selected(ctx, s);
  const r = pageRects(ctx.state.pages)[s.page];
  if (!words.length || !r) return;
  const hl = ctx.core.highlighter;
  const boxes = convertToExcalidrawElements(
    lineBoxes(words).map((b) => ({
      type: "rectangle",
      x: r.x + b.x - 1,
      y: r.y + b.y,
      width: b.w + 2,
      height: b.h,
      backgroundColor: hl.color,
      strokeColor: "transparent",
      fillStyle: "solid",
      strokeWidth: 1,
      roughness: 0,
      opacity: hl.opacity,
      roundness: { type: 3 },
      customData: { hn: "hl", text: b.text, page: s.page },
    })) as never,
  ) as unknown as El[];
  const all = ctx.elements(true);
  const isPage = (e: El) => (e.customData as { hn?: string } | undefined)?.hn === "pdf-page";
  const isHl = (e: El) => (e.customData as { hn?: string } | undefined)?.hn === "hl";
  // highlights go behind the ink
  ctx.replaceElements(
    [...all.filter(isPage), ...all.filter((e) => !isPage(e) && isHl(e)), ...boxes, ...all.filter((e) => !isPage(e) && !isHl(e))],
    "now",
  );
}

function setSel(ctx: HandnoteContext, s: Sel | null, dragging = false) {
  ctx.events.emit("pdfSelection" as never, { sel: s, dragging } as never);
}

/** The blue selection, its two ends, and the Copy / Highlight / Search bar. */
function SelectionView({ ctx }: { ctx: HandnoteContext }) {
  const [state, setState] = useState<{ sel: Sel | null; dragging: boolean }>({ sel: null, dragging: false });
  const [, tick] = useState(0);
  useEffect(() => {
    const offs = [
      ctx.events.on("pdfSelection" as never, ((v: typeof state) => setState(v)) as never),
      ctx.events.on("scroll", () => tick((t) => t + 1)),
      ctx.events.on("state", () => tick((t) => t + 1)),
    ];
    return () => offs.forEach((o) => o());
  }, [ctx]);
  const s = state.sel;
  if (!s || ctx.state.tool !== SELECT_TEXT) return null;
  const words = selected(ctx, s);
  const r = pageRects(ctx.state.pages)[s.page];
  if (!words.length || !r) return null;
  const z = ctx.view().zoom;
  const boxes = lineBoxes(words).map((b) => {
    const p = ctx.toScreen(r.x + b.x, r.y + b.y);
    return { left: p.x - 1, top: p.y - 1, width: b.w * z + 2, height: b.h * z + 2 };
  });
  const first = boxes[0];
  const last = boxes[boxes.length - 1];
  const barTop = first.top > 64 ? first.top - 52 : last.top + last.height + 10;
  const barLeft = Math.max(8, Math.min(first.left, ctx.root.clientWidth - 330));
  const text = selectionText(words);
  return (
    <>
      {boxes.map((b, i) => (
        <div key={i} className="hn-tsel-box" style={b} />
      ))}
      <div className="hn-tsel-handle" style={{ left: first.left - 1, top: first.top - 7, height: first.height + 7 }} />
      <div className="hn-tsel-handle hn-tsel-handle-end" style={{ left: last.left + last.width - 1, top: last.top, height: last.height + 7 }} />
      {!state.dragging && (
        <div className={`hn-tsel-bar ${glassClass(ctx)}`} style={{ left: barLeft, top: barTop }} onPointerDown={(e) => e.stopPropagation()}>
          <button
            className="hn-tsel-btn"
            onClick={async () => {
              const ok = await copyText(text);
              ctx.toast(ok ? `Copied ${words.length} word${words.length === 1 ? "" : "s"}` : "Couldn't copy");
            }}
          >
            <Icon name="copy" /> Copy
          </button>
          <button
            className="hn-tsel-btn"
            onClick={() => {
              highlightSelection(ctx, s);
              setSel(ctx, null);
              ctx.toast("Highlighted", { label: "Undo", run: () => ctx.undo() });
            }}
          >
            <Icon name="highlighter" /> Highlight
          </button>
          <button
            className="hn-tsel-btn"
            onClick={() => {
              ctx.events.emit("pdfSearchFor" as never, text.slice(0, 80) as never);
              ctx.setState({ panel: "search" });
            }}
          >
            <Icon name="search" /> Search
          </button>
          <button className="hn-tsel-btn hn-tsel-x" aria-label="Clear selection" onClick={() => setSel(ctx, null)}>
            <Icon name="x" />
          </button>
        </div>
      )}
    </>
  );
}

export default defineFeature({
  id: "pdf-select",
  name: "Select PDF text",
  description: "A Select text tool for imported PDFs: drag the Pencil over words to select them, then copy, highlight or search them.",
  defaults: {},
  tools: [
    {
      id: SELECT_TEXT,
      label: "Select text",
      icon: "text-cursor",
      order: 42,
      when: (c) => !!c.state.pageText,
      activate: (c) => c.api.setActiveTool({ type: "selection" }),
    },
  ],
  setup(ctx) {
    let sel: Sel | null = null;
    let drag: { id: number; end: "a" | "b"; moved: boolean; x: number; y: number } | null = null;

    const pagePoint = (e: PointerEvent) => {
      const p = ctx.toScene(e.clientX, e.clientY);
      const page = pageAt(ctx.state.pages, p.y);
      const r = pageRects(ctx.state.pages)[page];
      return { page, x: p.x - (r?.x ?? 0), y: p.y - (r?.y ?? 0) };
    };

    const onDown = (e: PointerEvent) => {
      if (ctx.state.tool !== SELECT_TEXT || e.pointerType === "touch" || !e.isTrusted || e.button !== 0) return;
      if ((e.target as HTMLElement)?.tagName !== "CANVAS") return;
      e.stopImmediatePropagation();
      e.preventDefault();
      const p = pagePoint(e);
      const words = ctx.state.pageText?.[p.page];
      if (!words?.length) {
        sel = null;
        setSel(ctx, null);
        ctx.toast(ctx.state.pageText ? "No text on this page" : "Text can be selected in imported PDFs");
        return;
      }
      const o = readingOrder(words);
      const i = wordAt(o, p.x, p.y);
      // Starting on one end of the current selection adjusts it.
      if (sel && sel.page === p.page) {
        const lo = Math.min(sel.a, sel.b);
        const hi = Math.max(sel.a, sel.b);
        if (i === lo || i === hi) {
          sel = { page: p.page, a: i === lo ? hi : lo, b: i };
          drag = { id: e.pointerId, end: "b", moved: true, x: e.clientX, y: e.clientY };
          setSel(ctx, sel, true);
          return;
        }
      }
      sel = { page: p.page, a: i, b: i };
      drag = { id: e.pointerId, end: "b", moved: false, x: e.clientX, y: e.clientY };
      setSel(ctx, sel, true);
    };

    const onMove = (e: PointerEvent) => {
      if (!drag || e.pointerId !== drag.id || !sel) return;
      e.stopImmediatePropagation();
      if (Math.hypot(e.clientX - drag.x, e.clientY - drag.y) > 4) drag.moved = true;
      const p = pagePoint(e);
      if (p.page !== sel.page) return; // a selection stays on one page
      const words = ctx.state.pageText?.[sel.page];
      if (!words) return;
      const i = wordAt(readingOrder(words), p.x, p.y);
      if (i !== sel.b) {
        sel = { ...sel, b: i };
        setSel(ctx, sel, true);
      }
    };

    const onUp = (e: PointerEvent) => {
      if (!drag || e.pointerId !== drag.id) return;
      e.stopImmediatePropagation();
      drag = null;
      setSel(ctx, sel, false);
    };

    const offTool = ctx.events.on("state", () => {
      if (ctx.state.tool !== SELECT_TEXT && sel) {
        sel = null;
        setSel(ctx, null);
      }
    });
    const offSel = ctx.events.on("pdfSelection" as never, ((v: { sel: Sel | null }) => {
      if (!v.sel) sel = null;
    }) as never);

    ctx.root.addEventListener("pointerdown", onDown, true);
    window.addEventListener("pointermove", onMove, true);
    window.addEventListener("pointerup", onUp, true);
    window.addEventListener("pointercancel", onUp, true);
    return () => {
      offTool();
      offSel();
      ctx.root.removeEventListener("pointerdown", onDown, true);
      window.removeEventListener("pointermove", onMove, true);
      window.removeEventListener("pointerup", onUp, true);
      window.removeEventListener("pointercancel", onUp, true);
    };
  },
  Overlay: SelectionView,
});
