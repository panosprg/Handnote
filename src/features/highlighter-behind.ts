import { mutateElement } from "@excalidraw/excalidraw";
import type { El } from "../core/context";
import { defineFeature } from "../core/types";

const TAG = "hl";

const isHighlight = (e: El) => (e.customData as { hn?: string } | undefined)?.hn === TAG;

/**
 * Highlighter strokes go *under* the writing, like real highlighter on paper,
 * so the text keeps its full dark colour instead of being tinted.
 *
 * The stroke is moved to the back as soon as it starts (not after), so it is
 * part of the same undo step as the stroke itself.
 */
type S = { straighten: boolean };

/** Straight highlighter: the stroke becomes a straight band from where you started to where you lifted. */
function straighten(pts: [number, number][]): [number, number][] | null {
  if (pts.length < 3) return null;
  const a = pts[0];
  let b = pts[pts.length - 1];
  const len = Math.hypot(b[0] - a[0], b[1] - a[1]);
  if (len < 8) return null;
  // Nearly horizontal (the usual case for text): make it exactly horizontal at the average height.
  const angle = Math.abs((Math.atan2(b[1] - a[1], b[0] - a[0]) * 180) / Math.PI);
  let start = a;
  if (angle < 10 || angle > 170) {
    const y = pts.reduce((s, p) => s + p[1], 0) / pts.length;
    start = [a[0], y];
    b = [b[0], y];
  }
  const n = Math.max(2, Math.ceil(len / 4));
  return Array.from({ length: n + 1 }, (_, i) => [start[0] + ((b[0] - start[0]) * i) / n, start[1] + ((b[1] - start[1]) * i) / n]);
}

export default defineFeature<S>({
  id: "highlighter-behind",
  name: "Highlighter",
  description: "Highlights sit under your ink so the text stays dark and readable, and can snap into straight lines.",
  optional: false,
  defaults: { straighten: true },
  settings: [{ key: "straighten", type: "toggle", name: "Straighten highlighter strokes" }],
  setup(ctx, s) {
    const offStraight = ctx.pen.addFilter({
      id: "highlighter-straighten",
      order: 70,
      start: () =>
        ctx.state.tool !== "highlighter" || !s().straighten
          ? null
          : {
              finish: (el) => {
                const line = straighten(ctx.strokePoints(el));
                if (line) ctx.setStrokePoints(el, line, line.map(() => 0.5));
              },
            },
    });
    const done = new Set<string>();
    const offBehind = ctx.events.on("change", (_els, appState) => {
      const fresh = appState.newElement as unknown as El | null;
      if (!fresh || fresh.type !== "freedraw" || ctx.state.tool !== "highlighter" || done.has(fresh.id)) return;
      done.add(fresh.id);
      queueMicrotask(() => {
        mutateElement(fresh as never, { customData: { ...(fresh.customData ?? {}), hn: TAG } } as never);
        const all = ctx.elements(true);
        // Order from the back: PDF pages, then highlights, then everything else.
        const isPage = (e: El) => (e.customData as { hn?: string } | undefined)?.hn === "pdf-page";
        const pages = all.filter(isPage);
        const highlights = all.filter((e) => !isPage(e) && isHighlight(e));
        const rest = all.filter((e) => !isPage(e) && !isHighlight(e));
        // "later" = folded into the stroke's own undo step when the stroke ends.
        ctx.replaceElements([...pages, ...highlights, ...rest], "later");
      });
    });
    return () => {
      offStraight();
      offBehind();
    };
  },
});
