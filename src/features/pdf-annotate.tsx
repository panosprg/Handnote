/**
 * PDF annotation:
 *  - the highlighter snaps to the words of an imported PDF (and remembers the text),
 *  - each highlighter colour can mean something ("yellow = Evidence"),
 *  - a key under each page shows the meanings used on that page,
 *  - search finds text in the PDF.
 * Writing the annotations into the PDF itself is in core/pdf-annotate.ts (view: saveIntoPdf).
 */
import { useDeferredValue, useEffect, useMemo, useRef, useState, type KeyboardEvent } from "react";
import { convertToExcalidrawElements } from "@excalidraw/excalidraw";

import { useCtxState, type El, type HandnoteContext } from "../core/context";
import {
  ANNOTATE_FEATURE,
  categories,
  legends,
  setCategories,
  type Category,
} from "../core/categories";
import { pageAt, pageRects } from "../core/pages";
import { lineBoxes, searchText, wordsUnderStroke } from "../core/pdf-text";
import { useSettings } from "../core/settings";
import { defineFeature } from "../core/types";
import { glassClass, Icon } from "../core/ui";
import "./pdf-annotate.css";

type S = {
  snap: boolean;
  legend: boolean;
  legendInExports: boolean;
  writeOnClose: boolean;
  defaultCategories?: Category[];
};

/* ------------------------------------------------------------------ */
/* Highlighter → words                                                 */
/* ------------------------------------------------------------------ */

/** The boxes a highlighter stroke becomes when it runs over PDF text (null: not over text). */
export function snapToWords(ctx: HandnoteContext, el: El): El[] | null {
  const text = ctx.state.pageText;
  if (!text) return null;
  const pts = ctx.strokePoints(el);
  if (pts.length < 2) return null;
  const midY = (Math.min(...pts.map((p) => p[1])) + Math.max(...pts.map((p) => p[1]))) / 2;
  const page = pageAt(ctx.state.pages, midY);
  const r = pageRects(ctx.state.pages)[page];
  const words = text[page];
  if (!r || !words?.length) return null;
  const hit = wordsUnderStroke(
    words,
    pts.map(([x, y]) => [x - r.x, y - r.y]),
  );
  if (!hit.length) return null;
  const boxes = lineBoxes(hit);
  const made = convertToExcalidrawElements(
    boxes.map((b) => ({
      type: "rectangle",
      x: r.x + b.x - 1,
      y: r.y + b.y,
      width: b.w + 2,
      height: b.h,
      backgroundColor: el.strokeColor,
      strokeColor: "transparent",
      fillStyle: "solid",
      strokeWidth: 1,
      roughness: 0,
      opacity: el.opacity,
      roundness: { type: 3 },
      customData: { hn: "hl", text: b.text, page },
    })) as never,
  ) as unknown as El[];
  // The first box keeps the stroke's id (so "strokeEnd" and undo still find it).
  return made.map((m, i) => (i === 0 ? ({ ...m, id: el.id } as El) : m));
}

/* ------------------------------------------------------------------ */
/* "What colours mean" (in the highlighter's panel)                    */
/* ------------------------------------------------------------------ */

/** Keeps typing inside our inputs away from Excalidraw's keyboard shortcuts. */
const keepKeys = (e: KeyboardEvent) => e.stopPropagation();

function LabelInput({ value, placeholder, onCommit }: { value: string; placeholder?: string; onCommit(v: string): void }) {
  const [v, setV] = useState(value);
  useEffect(() => setV(value), [value]);
  return (
    <input
      className="hn-meaning-input"
      value={v}
      placeholder={placeholder}
      aria-label="What this colour means"
      onChange={(e) => setV(e.target.value)}
      onBlur={() => v !== value && onCommit(v)}
      onKeyDown={(e) => {
        keepKeys(e);
        if (e.key === "Enter") (e.target as HTMLInputElement).blur();
        if (e.key === "Escape") setV(value);
      }}
    />
  );
}

function Meanings({ ctx }: { ctx: HandnoteContext }) {
  useCtxState(ctx);
  const settings = useSettings(ctx.store);
  const [editing, setEditing] = useState(false);
  if (ctx.inkTarget() !== "highlighter") return null;
  const list = categories(ctx);
  const color = settings.core.highlighter.color.toLowerCase();
  const known = list.some((c) => c.color === color);
  const update = (next: Category[]) => setCategories(ctx, next);

  return (
    <div className="hn-meanings">
      <div className="hn-label">
        What colours mean
        <button className="hn-link" onClick={() => setEditing(!editing)}>
          {editing ? "Done" : "Edit"}
        </button>
      </div>
      {list.map((c, i) => (
        <div key={c.color} className={`hn-meaning ${c.color === color ? "is-active" : ""}`}>
          <button
            className="hn-meaning-swatch"
            style={{ background: c.color }}
            aria-label={`Highlight ${c.label || c.color}`}
            onClick={() => ctx.setInkColor(c.color)}
          />
          {editing ? (
            <>
              <LabelInput value={c.label} onCommit={(v) => update(list.map((x, j) => (j === i ? { ...x, label: v } : x)))} />
              <button className="hn-meaning-x" aria-label={`Remove ${c.label || c.color}`} onClick={() => update(list.filter((_, j) => j !== i))}>
                ×
              </button>
            </>
          ) : (
            <button className="hn-meaning-name" onClick={() => ctx.setInkColor(c.color)}>
              {c.label || <span className="hn-muted">No name</span>}
            </button>
          )}
        </div>
      ))}
      {!known && (
        <div className="hn-meaning is-active">
          <span className="hn-meaning-swatch" style={{ background: color }} aria-hidden />
          <LabelInput
            value=""
            placeholder="Name this colour (e.g. Evidence)"
            onCommit={(v) => v.trim() && update([...list, { color, label: v.trim() }])}
          />
        </div>
      )}
      {editing && (
        <div className="hn-row">
          <button
            className="hn-chip"
            onClick={() => {
              ctx.updateFeatureSettings(ANNOTATE_FEATURE, { defaultCategories: list });
              setEditing(false);
            }}
          >
            <Icon name="bookmark" /> Use for new notebooks
          </button>
        </div>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Key under each page                                                 */
/* ------------------------------------------------------------------ */

/** Follows Excalidraw's scroll and zoom, like the paper. */
function useSceneLayer(ctx: HandnoteContext) {
  const layer = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const place = (x: number, y: number, z: number) => {
      if (layer.current) layer.current.style.transform = `translate(${x * z}px, ${y * z}px) scale(${z})`;
    };
    const st = ctx.api.getAppState();
    place(st.scrollX, st.scrollY, st.zoom.value);
    return ctx.events.on("scroll", place);
  }, [ctx]);
  return layer;
}

function Legend({ ctx }: { ctx: HandnoteContext }) {
  const ui = useCtxState(ctx);
  const layer = useSceneLayer(ctx);
  const [items, setItems] = useState<Category[][]>([]);
  const last = useRef("");

  useEffect(() => {
    let frame = 0;
    const compute = () => {
      frame = 0;
      const next = legends(ctx);
      const key = JSON.stringify(next);
      if (key !== last.current) {
        last.current = key;
        setItems(next);
      }
    };
    compute();
    // "change" fires a lot: work it out at most once a frame.
    const off = ctx.events.on("change", () => {
      if (!frame) frame = requestAnimationFrame(compute);
    });
    return () => {
      off();
      if (frame) cancelAnimationFrame(frame);
    };
  }, [ctx, ui.meta, ui.pages]);

  return (
    <div ref={layer} className="hn-sheets hn-sheets-ui hn-legend-layer" aria-hidden>
      {pageRects(ui.pages).map((r) =>
        items[r.index]?.length ? (
          <div key={r.index} className="hn-legend" style={{ left: r.x, top: r.y + r.h + 4, width: r.w }}>
            {items[r.index].map((c) => (
              <span key={c.color} className="hn-legend-item">
                <span className="hn-legend-swatch" style={{ background: c.color }} />
                {c.label}
              </span>
            ))}
          </div>
        ) : null,
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Search                                                              */
/* ------------------------------------------------------------------ */

const MAX_DRAWN = 1500;

function Search({ ctx }: { ctx: HandnoteContext }) {
  const ui = useCtxState(ctx);
  const layer = useSceneLayer(ctx);
  const input = useRef<HTMLInputElement>(null);
  const [query, setQuery] = useState("");
  const [index, setIndex] = useState(0);
  // "Search" on selected PDF text (pdf-select.tsx) fills in the search box.
  useEffect(() => ctx.events.on("pdfSearchFor" as never, ((q: string) => setQuery(q)) as never), [ctx]);
  const deferred = useDeferredValue(query);
  const open = ui.panel === "search" && !!ui.pageText;

  const hits = useMemo(
    () => (open && ui.pageText ? searchText({ version: 1, pages: ui.pageText }, deferred) : []),
    [open, ui.pageText, deferred],
  );
  const rects = pageRects(ui.pages);

  const go = (i: number) => {
    if (!hits.length) return;
    const n = ((i % hits.length) + hits.length) % hits.length;
    setIndex(n);
    const h = hits[n];
    const r = rects[h.page];
    const b = h.boxes[0];
    if (r && b) ctx.scrollTo(r.x + b.x + b.w / 2, r.y + b.y);
  };

  // New results: jump to the first one on or after the page you're looking at.
  useEffect(() => {
    if (!hits.length) return setIndex(0);
    const here = ctx.currentPage();
    const first = hits.findIndex((h) => h.page >= here);
    go(first < 0 ? 0 : first);
  }, [hits]);

  useEffect(() => {
    if (open) setTimeout(() => input.current?.focus(), 30);
  }, [open]);

  if (!open) return null;
  const close = () => ctx.setState({ panel: null });

  return (
    <>
      <div ref={layer} className="hn-sheets hn-sheets-ui hn-search-layer" aria-hidden>
        {hits.slice(0, MAX_DRAWN).flatMap((h, i) =>
          h.boxes.map((b, j) => (
            <div
              key={`${i}-${j}`}
              className={`hn-search-hit ${i === index ? "is-current" : ""}`}
              style={{ left: rects[h.page].x + b.x - 1.5, top: rects[h.page].y + b.y - 1, width: b.w + 3, height: b.h + 2 }}
            />
          )),
        )}
      </div>
      <div className={`hn-search ${glassClass(ctx)}`} role="search" onPointerDown={(e) => e.stopPropagation()}>
        <Icon name="search" />
        <input
          ref={input}
          className="hn-search-input"
          type="search"
          placeholder="Search the PDF"
          aria-label="Search the PDF"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={(e) => {
            keepKeys(e);
            if (e.key === "Enter") go(index + (e.shiftKey ? -1 : 1));
            if (e.key === "Escape") close();
          }}
        />
        <span className="hn-search-count" aria-live="polite">
          {deferred.trim() ? (hits.length ? `${index + 1} / ${hits.length}` : "No matches") : ""}
        </span>
        <button className="hn-search-btn" aria-label="Previous match" disabled={!hits.length} onClick={() => go(index - 1)}>
          <Icon name="chevron-up" />
        </button>
        <button className="hn-search-btn" aria-label="Next match" disabled={!hits.length} onClick={() => go(index + 1)}>
          <Icon name="chevron-down" />
        </button>
        <button className="hn-search-btn" aria-label="Close search" onClick={close}>
          <Icon name="x" />
        </button>
      </div>
    </>
  );
}

/* ------------------------------------------------------------------ */
/* The feature                                                         */
/* ------------------------------------------------------------------ */

export default defineFeature<S>({
  id: ANNOTATE_FEATURE,
  name: "PDF annotation",
  description:
    "Highlights snap to the words of an imported PDF, each highlighter colour can mean something (shown in a key under each page), and you can search the PDF's text.",
  defaults: { snap: true, legend: true, legendInExports: true, writeOnClose: true },
  settings: [
    { key: "snap", type: "toggle", name: "Snap highlights to the PDF's words" },
    { key: "legend", type: "toggle", name: "Show the colour key under each page" },
    { key: "legendInExports", type: "toggle", name: "Add the colour key to exported and printed pages" },
    {
      key: "writeOnClose",
      type: "toggle",
      name: "Update the PDF when you close the notebook",
      desc: "Writes your highlights, handwriting and the colour key into the PDF the notebook was made from (a clean copy of the original is kept).",
    },
  ],
  setup(ctx, s) {
    // Fast ink: the stroke becomes word boxes in the same step that adds it (one undo step).
    const off = ctx.pen.addFilter({
      id: "pdf-highlight-words",
      order: 60, // before "highlighter-behind" (90) moves highlights to the back
      start: () =>
        ctx.state.tool !== "highlighter" || !s().snap || !ctx.state.pageText
          ? null
          : {
              place: (all, el) => {
                const boxes = snapToWords(ctx, el);
                return boxes ? all.flatMap((e) => (e.id === el.id ? boxes : [e])) : all;
              },
            },
    });
    // Without fast ink there is no "place" step: swap the stroke right after it's drawn.
    const offEnd = ctx.events.on("strokeEnd", (el, tool) => {
      if (ctx.core.fastInk !== false || tool !== "highlighter" || !s().snap || el.type !== "freedraw") return;
      const boxes = snapToWords(ctx, el);
      if (!boxes) return;
      const tagged = boxes.map((b) => ({ ...b, customData: { ...(b.customData ?? {}), hn: "hl" } }) as El);
      const all = ctx.elements(true).flatMap((e) => (e.id === el.id ? tagged : [e]));
      const isPage = (e: El) => (e.customData as { hn?: string } | undefined)?.hn === "pdf-page";
      const hl = (e: El) => (e.customData as { hn?: string } | undefined)?.hn === "hl";
      ctx.replaceElements([...all.filter(isPage), ...all.filter((e) => !isPage(e) && hl(e)), ...all.filter((e) => !isPage(e) && !hl(e))]);
    });
    return () => {
      off();
      offEnd();
    };
  },
  Overlay: ({ ctx, settings }) => (
    <>
      {settings.legend && <Legend ctx={ctx} />}
      <Search ctx={ctx} />
    </>
  ),
  InkPanelSection: Meanings,
  toolbarButtons: [
    {
      id: "search",
      label: "Search",
      icon: "search",
      when: (ctx) => !!ctx.state.pageText,
      active: (ctx) => ctx.state.panel === "search",
      onClick: (ctx) => ctx.togglePanel("search"),
    },
  ],
});
