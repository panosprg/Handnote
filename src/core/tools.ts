import { CaptureUpdateAction } from "@excalidraw/excalidraw";
import type { HandnoteContext } from "./context";
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

/** Tools that are always there. Features add more (see ToolDef). */
export const CORE_TOOLS: ToolDef[] = [
  { id: "pen", label: "Pen", icon: "pen-line", ink: true, order: 10, activate: (c) => activateInk(c, "pen"), Panel: InkPanel },
  {
    id: "highlighter",
    label: "Highlighter",
    icon: "highlighter",
    ink: true,
    order: 20,
    activate: (c) => activateInk(c, "highlighter"),
    Panel: InkPanel,
  },
  {
    id: "eraser",
    label: "Object eraser",
    icon: "trash-2",
    order: 40,
    activate: (c) => c.api.setActiveTool({ type: "eraser", locked: true }),
  },
  {
    id: "select",
    label: "Select",
    icon: "lasso",
    order: 50,
    activate: (c) => c.api.setActiveTool({ type: "selection" }),
  },
  { id: "hand", label: "Hand", icon: "hand", order: 90, activate: (c) => c.api.setActiveTool({ type: "hand", locked: true }) },
];
