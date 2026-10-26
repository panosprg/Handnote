import { useEffect, useRef, useState, type ReactNode } from "react";
import { useCtxState, type HandnoteContext } from "../core/context";
import { useSettings } from "../core/settings";
import { defineFeature, type ToolDef } from "../core/types";
import { glassClass, Icon, PanelHost, PaperPanel } from "../core/ui";
import {
  GenericStick,
  HighlighterStick,
  LassoStick,
  ObjectEraserStick,
  PenStick,
  PrecisionEraserStick,
  STICK_H,
  STICK_W,
} from "./palette-arc-art";
import "./palette-arc.css";

type S = { x: number; bottom: number };
const ID = "palette-arc";

/* ---------------- geometry ---------------- */

const W = 600; // design width (scaled down on narrow screens)
const T = 60; // band thickness
const RM = 760; // radius of the band's centre line
const RO = RM + T / 2;
const RI = RM - T / 2;
const TOP = 74; // room above the band for tools sticking out
const CX = W / 2;
const CY = TOP + RO;
const PHI = Math.asin((W / 2 - T / 2) / RM); // half-angle of the band's centre line
const H = Math.ceil(CY - RM * Math.cos(PHI) + T / 2 + 6);

const pt = (r: number, a: number) => ({ x: CX + r * Math.sin(a), y: CY - r * Math.cos(a) });

function bandPath(): string {
  const oL = pt(RO, -PHI), oR = pt(RO, PHI), iR = pt(RI, PHI), iL = pt(RI, -PHI);
  const c = T / 2;
  return [
    `M ${oL.x} ${oL.y}`,
    `A ${RO} ${RO} 0 0 1 ${oR.x} ${oR.y}`,
    `A ${c} ${c} 0 0 1 ${iR.x} ${iR.y}`,
    `A ${RI} ${RI} 0 0 0 ${iL.x} ${iL.y}`,
    `A ${c} ${c} 0 0 1 ${oL.x} ${oL.y}`,
    "Z",
  ].join(" ");
}
const BAND = bandPath();

/* ---------------- items ---------------- */

type Item =
  | { kind: "button"; key: string; size: number; render: ReactNode; label: string; onTap: () => void; active?: boolean }
  | { kind: "tool"; key: string; tool: ToolDef };

function stickFor(tool: ToolDef, ctx: HandnoteContext): ReactNode {
  switch (tool.id) {
    case "pen":
      return <PenStick color={ctx.core.pen.color} />;
    case "highlighter":
      return <HighlighterStick color={ctx.core.highlighter.color} />;
    case "precision-eraser":
      return <PrecisionEraserStick />;
    case "eraser":
      return <ObjectEraserStick />;
    case "select":
      return <LassoStick />;
    default:
      return (
        <>
          <GenericStick />
          <span className="hn-stick-icon">
            <Icon name={tool.icon} />
          </span>
        </>
      );
  }
}

const GAP = 7;
const GROUP_GAP = 18;
const STICK_SPACING = STICK_W + 4;

function Palette({ ctx, settings }: { ctx: HandnoteContext; settings: S }) {
  const core = useSettings(ctx.store).core;
  const ui = useCtxState(ctx);
  const [rootSize, setRootSize] = useState({ w: 1000, h: 800 });
  const drag = useRef<{ id: number; sx: number; sy: number; x: number; bottom: number } | null>(null);
  const [pos, setPos] = useState({ x: settings.x, bottom: settings.bottom });

  useEffect(() => setPos({ x: settings.x, bottom: settings.bottom }), [settings.x, settings.bottom]);

  useEffect(() => {
    const ro = new ResizeObserver(() => setRootSize({ w: ctx.root.clientWidth, h: ctx.root.clientHeight }));
    ro.observe(ctx.root);
    return () => ro.disconnect();
  }, [ctx]);

  if (core.toolbarStyle !== "arc") return null;

  const tools = ctx.tools().filter((t) => t.id !== "hand");
  const inkColor = core[ctx.inkTarget()].color;

  const items: Item[] = [
    { kind: "button", key: "undo", size: 42, label: "Undo", render: <Icon name="undo-2" />, onTap: () => ctx.undo() },
    { kind: "button", key: "redo", size: 42, label: "Redo", render: <Icon name="redo-2" />, onTap: () => ctx.redo() },
    ...tools.map((t) => ({ kind: "tool" as const, key: t.id, tool: t })),
    {
      kind: "button",
      key: "color",
      size: 46,
      label: "Colour and size",
      active: ui.panel === "tool" && !!ctx.activeTool()?.ink,
      render: (
        <span className="hn-arc-color">
          <span style={{ background: inkColor }} />
        </span>
      ),
      onTap: () => {
        if (!ctx.activeTool()?.ink) ctx.setTool(ctx.state.lastInk);
        ctx.togglePanel("tool");
      },
    },
    {
      kind: "button",
      key: "more",
      size: 42,
      label: "More",
      active: ui.panel === "more",
      render: <Icon name="more-horizontal" />,
      onTap: () => ctx.togglePanel("more"),
    },
  ];

  // Lay items along the band's centre line, centred.
  const widths = items.map((it) => (it.kind === "tool" ? STICK_SPACING : it.size));
  const gaps = items.map((it, i): number => {
    if (i === 0) return 0;
    const prev = items[i - 1];
    return prev.kind !== it.kind ? GROUP_GAP : it.kind === "tool" ? 0 : GAP;
  });
  const total = widths.reduce((a, b) => a + b, 0) + gaps.reduce((a, b) => a + b, 0);
  let s = -total / 2;
  const placed = items.map((it, i) => {
    s += gaps[i];
    const centre = s + widths[i] / 2;
    s += widths[i];
    return { it, angle: centre / RM };
  });

  const scale = Math.min(1, (rootSize.w - 16) / W);
  const left = Math.min(Math.max(pos.x * rootSize.w - (W * scale) / 2, 8), rootSize.w - W * scale - 8);
  const bottom = Math.min(Math.max(pos.bottom, 8), rootSize.h - H * scale - 8);
  const panelAbove = bottom < rootSize.h / 2;
  const glass = glassClass(ctx);

  /* ----- dragging the palette by its band ----- */
  const onBandDown = (e: React.PointerEvent) => {
    if ((e.target as HTMLElement).closest("button")) return;
    e.stopPropagation();
    (e.currentTarget as HTMLElement).setPointerCapture?.(e.pointerId);
    drag.current = { id: e.pointerId, sx: e.clientX, sy: e.clientY, x: pos.x, bottom: pos.bottom };
  };
  const onBandMove = (e: React.PointerEvent) => {
    const d = drag.current;
    if (!d || d.id !== e.pointerId) return;
    setPos({ x: d.x + (e.clientX - d.sx) / rootSize.w, bottom: d.bottom - (e.clientY - d.sy) });
  };
  const onBandUp = (e: React.PointerEvent) => {
    const d = drag.current;
    if (!d || d.id !== e.pointerId) return;
    drag.current = null;
    if (Math.hypot(e.clientX - d.sx, e.clientY - d.sy) > 4) ctx.updateFeatureSettings(ID, { x: pos.x, bottom: pos.bottom });
  };

  const panelStyle: React.CSSProperties = {
    left: Math.min(Math.max(left + (W * scale) / 2, 180), rootSize.w - 180),
    ...(panelAbove ? { bottom: bottom + H * scale + 6 } : { top: rootSize.h - bottom + 6 }),
  };

  return (
    <>
      <div
        className="hn-arc"
        style={{ left, bottom, width: W, height: H, transform: `scale(${scale})` }}
        onPointerDown={onBandDown}
        onPointerMove={onBandMove}
        onPointerUp={onBandUp}
        onPointerCancel={onBandUp}
      >
        <svg className="hn-arc-shadow" width={W} height={H} aria-hidden>
          <path d={BAND} />
        </svg>
        <div className={`hn-arc-band ${glass}`} style={{ clipPath: `path('${BAND}')` }} />
        <svg className="hn-arc-edge" width={W} height={H} aria-hidden>
          <path d={BAND} />
        </svg>

        {placed.map(({ it, angle }) => {
          if (it.kind === "tool") {
            const base = pt(RI + 6, angle);
            const active = ui.tool === it.tool.id;
            return (
              <button
                key={it.key}
                className={`hn-stick ${active ? "is-active" : ""}`}
                aria-label={it.tool.label}
                title={it.tool.label}
                style={{
                  left: base.x - STICK_W / 2,
                  top: base.y - STICK_H,
                  transform: `rotate(${angle}rad) translateY(${active ? -16 : 0}px)`,
                }}
                onClick={() => ctx.setTool(it.tool.id)}
              >
                {stickFor(it.tool, ctx)}
              </button>
            );
          }
          const c = pt(RM, angle);
          return (
            <button
              key={it.key}
              className={`hn-arc-btn ${it.active ? "is-active" : ""}`}
              aria-label={it.label}
              title={it.label}
              style={{ left: c.x - it.size / 2, top: c.y - it.size / 2, width: it.size, height: it.size }}
              onClick={it.onTap}
            >
              {it.render}
            </button>
          );
        })}
      </div>

      <PanelHost ctx={ctx} className="hn-panel-arc" style={panelStyle} />
      {ui.panel === "more" && <MorePanel ctx={ctx} style={panelStyle} onReset={() => ctx.updateFeatureSettings(ID, { x: 0.5, bottom: 16 })} />}
    </>
  );
}

function MorePanel({ ctx, style, onReset }: { ctx: HandnoteContext; style: React.CSSProperties; onReset: () => void }) {
  const ui = useCtxState(ctx);
  return (
    <div className={`hn-panel hn-panel-arc ${glassClass(ctx)}`} style={style} onPointerDown={(e) => e.stopPropagation()}>
      <PaperPanel ctx={ctx} />
      <div className="hn-label">Tools</div>
      <div className="hn-row">
        <button className={`hn-chip ${ui.tool === "hand" ? "is-active" : ""}`} onClick={() => ctx.setTool("hand")}>
          <Icon name="hand" /> Hand
        </button>
        <button
          className={`hn-chip ${ui.showNative ? "is-active" : ""}`}
          onClick={() => ctx.setState({ showNative: !ui.showNative })}
        >
          <Icon name="shapes" /> Shapes & text
        </button>
        <button className="hn-chip" onClick={onReset}>
          <Icon name="move" /> Reset palette position
        </button>
      </div>
    </div>
  );
}

export default defineFeature<S>({
  id: ID,
  name: "Curved palette",
  description: "The arched glass toolbar. Drag it by its band to move it. (Choose the toolbar style above.)",
  optional: false,
  defaults: { x: 0.5, bottom: 16 },
  Overlay: Palette,
});
