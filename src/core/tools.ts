import { CaptureUpdateAction } from "@excalidraw/excalidraw";
import type { HandnoteContext } from "./context";
import type { PenFilter } from "./pen";
import type { InkToolId } from "./settings";
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

const ink = (id: InkToolId, label: string, icon: string, order: number): ToolDef => ({
  id,
  label,
  icon,
  ink: true,
  order,
  activate: (c) => activateInk(c, id),
  Panel: InkPanel,
});

/** Tools that are always there. Features add more (erasers, lasso…). */
export const CORE_TOOLS: ToolDef[] = [
  ink("ballpoint", "Pen", "pen", 9),
  ink("pen", "Fountain pen", "pen-tool", 10),
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
