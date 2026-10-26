import { CaptureUpdateAction, convertToExcalidrawElements } from "@excalidraw/excalidraw";
import type { El, HandnoteContext } from "./context";
import type { PenFilter } from "./pen";
import { isDashTool, type InkToolId } from "./settings";
import type { ToolDef } from "./types";
import { InkPanel } from "./ui";

function activateInk(ctx: HandnoteContext, tool: InkToolId) {
  const cfg = ctx.core[tool];
  ctx.api.setActiveTool({ type: "freedraw", locked: true });
  ctx.api.updateScene({
    appState: {
      currentItemStrokeColor: cfg.color,
      currentItemStrokeWidth: cfg.width,
      currentItemOpacity: cfg.opacity,
    },
    captureUpdate: CaptureUpdateAction.NEVER,
  });
}

const ink = (id: InkToolId, label: string, icon: string, order: number, group?: string): ToolDef => ({
  id,
  label,
  icon,
  ink: true,
  order,
  group,
  activate: (c) => activateInk(c, id),
  Panel: InkPanel,
});

/** Tools sharing one toolbar button; the member is picked in the tool's menu. */
export const TOOL_GROUPS: Record<string, { label: string; icon: string }> = {
  pen: { label: "Pen", icon: "pen" },
  eraser: { label: "Eraser", icon: "eraser" },
};

/** Tools that are always there. Features add more (erasers, lasso…). */
export const CORE_TOOLS: ToolDef[] = [
  ink("ballpoint", "Ballpoint", "pen", 9, "pen"),
  ink("pen", "Fountain pen", "pen-tool", 9.1, "pen"),
  ink("dotted", "Dotted pen", "more-horizontal", 9.2, "pen"),
  ink("dashed", "Dashed pen", "minus", 9.3, "pen"),
  ink("pencil", "Pencil", "pencil", 12),
  ink("highlighter", "Highlighter", "highlighter", 20),
  {
    id: "select",
    label: "Rectangle select",
    icon: "scan",
    order: 41,
    activate: (c) => c.api.setActiveTool({ type: "selection" }),
  },
  {
    id: "text",
    label: "Text",
    icon: "type",
    order: 45,
    activate: (c) => {
      c.api.setActiveTool({ type: "text", locked: true });
      c.api.updateScene({
        appState: { currentItemFontFamily: 2, currentItemFontSize: 20, currentItemStrokeColor: c.core.ballpoint.color },
        captureUpdate: CaptureUpdateAction.NEVER,
      });
    },
  },
  { id: "hand", label: "Hand", icon: "hand", order: 90, activate: (c) => c.api.setActiveTool({ type: "hand", locked: true }) },
];

const BALLPOINT_PRESSURE = 0.6;

/** Ballpoint: the same line width whatever the pressure. */
export const BALLPOINT_FILTER: PenFilter = {
  id: "ballpoint",
  order: 5,
  start: (_e, ctx) =>
    ctx.state.tool !== "ballpoint"
      ? null
      : {
          point: (p) => ({ ...p, pressure: BALLPOINT_PRESSURE }),
          finish: (el) => ctx.setStrokePoints(el, ctx.strokePoints(el), el.points!.map(() => BALLPOINT_PRESSURE)),
        },
};

/** Highlighter: an even width, like a real one (and like the size you picked). */
export const HIGHLIGHTER_PRESSURE = 0.5;
export const HIGHLIGHTER_FILTER: PenFilter = {
  id: "highlighter-even",
  order: 5,
  start: (_e, ctx) => (ctx.state.tool !== "highlighter" ? null : { point: (p) => ({ ...p, pressure: HIGHLIGHTER_PRESSURE }) }),
};

/** Fewer points for a line that is drawn as a curve through them (Ramer–Douglas–Peucker). */
function simplify(pts: [number, number][], tol: number): [number, number][] {
  if (pts.length < 3) return pts;
  const keep = new Uint8Array(pts.length);
  keep[0] = keep[pts.length - 1] = 1;
  const stack: [number, number][] = [[0, pts.length - 1]];
  while (stack.length) {
    const [a, b] = stack.pop()!;
    const [ax, ay] = pts[a];
    const [bx, by] = pts[b];
    const len = Math.hypot(bx - ax, by - ay) || 1;
    let best = -1;
    let bestD = tol;
    for (let i = a + 1; i < b; i++) {
      const d = Math.abs((bx - ax) * (ay - pts[i][1]) - (ax - pts[i][0]) * (by - ay)) / len;
      if (d > bestD) [best, bestD] = [i, d];
    }
    if (best > 0) {
      keep[best] = 1;
      stack.push([a, best], [best, b]);
    }
  }
  return pts.filter((_, i) => keep[i]);
}

/**
 * Dotted and dashed pens. Excalidraw can't draw freehand ink dotted, so the stroke
 * is written like a ballpoint and, when the Pencil lifts, becomes an Excalidraw line
 * with a dotted/dashed stroke through the same points: one element, one undo step.
 */
export const DASH_FILTER: PenFilter = {
  id: "dotted-dashed",
  order: 80,
  start: (_e, ctx) => {
    const tool = ctx.state.tool;
    if (!isDashTool(tool)) return null;
    return {
      point: (p) => ({ ...p, pressure: 0.6 }),
      place: (all, el) => {
        const abs = ctx.strokePoints(el);
        const zoom = ctx.api.getAppState().zoom.value;
        let pts = simplify(abs, 0.35 / zoom);
        if (pts.length < 2) pts = [abs[0], [abs[0][0] + 0.5, abs[0][1]]];
        const [ox, oy] = pts[0];
        const [line] = convertToExcalidrawElements([
          {
            type: "line",
            x: ox,
            y: oy,
            points: pts.map(([x, y]) => [x - ox, y - oy]),
            strokeColor: el.strokeColor,
            strokeWidth: el.strokeWidth,
            opacity: el.opacity,
            strokeStyle: tool,
            roughness: 0,
            roundness: pts.length > 2 ? { type: 2 } : null,
            customData: { ...(el.customData ?? {}), hn: "dash" },
          } as never,
        ]) as unknown as El[];
        const replaced = { ...line, id: el.id } as El;
        return all.map((e) => (e.id === el.id ? replaced : e));
      },
    };
  },
};

/** Handnote's own ink: freehand strokes and the dotted/dashed pen lines. */
export const isInkElement = (el: El) =>
  el.type === "freedraw" || (el.type === "line" && (el.customData as { hn?: string } | undefined)?.hn === "dash");
