import { useEffect, useState } from "react";
import type { HandnoteContext } from "../core/context";
import { INK_TOOLS, type InkToolId } from "../core/settings";
import { defineFeature } from "../core/types";
import { glassClass } from "../core/ui";
import "./ruler.css";

/** Ruler position on screen (not on the page: it stays put when you scroll, like Goodnotes). */
interface RulerState {
  visible: boolean;
  cx: number;
  cy: number;
  angle: number; // radians
}

const LENGTH = 600;
const THICK = 70;
const SNAP = 32; // px from an edge where the pen starts following it

const states = new WeakMap<HandnoteContext, RulerState>();
const stateOf = (ctx: HandnoteContext) => {
  let s = states.get(ctx);
  if (!s) states.set(ctx, (s = { visible: false, cx: 0, cy: 0, angle: 0 }));
  return s;
};

/** Point relative to the ruler: u along it, v across it (positive = below). */
function toLocal(s: RulerState, x: number, y: number) {
  const dx = x - s.cx;
  const dy = y - s.cy;
  const c = Math.cos(s.angle);
  const n = Math.sin(s.angle);
  return { u: dx * c + dy * n, v: -dx * n + dy * c };
}
function fromLocal(s: RulerState, u: number, v: number) {
  const c = Math.cos(s.angle);
  const n = Math.sin(s.angle);
  return { x: s.cx + u * c - v * n, y: s.cy + u * n + v * c };
}

function Ruler({ ctx }: { ctx: HandnoteContext }) {
  const [, force] = useState(0);
  useEffect(() => ctx.events.on("ruler" as never, (() => force((n) => n + 1)) as never), [ctx]);
  const s = stateOf(ctx);
  if (!s.visible) return null;
  const zoom = ctx.api.getAppState().zoom.value;
  const cm = 37.8 * zoom; // 1 cm at 96 dpi, at the current zoom
  const ticks: JSX.Element[] = [];
  for (let i = 0, k = 0; i * (cm / 10) < LENGTH - 16; i++, k++) {
    const x = 8 + i * (cm / 10);
    const h = i % 10 === 0 ? 18 : i % 5 === 0 ? 12 : 7;
    ticks.push(<line key={`t${k}`} x1={x} y1={0} x2={x} y2={h} />);
    if (i % 10 === 0 && i > 0) ticks.push(<text key={`n${k}`} x={x} y={30}>{i / 10}</text>);
  }
  const deg = Math.round(((s.angle * 180) / Math.PI + 360) % 180);
  return (
    <div
      className={`hn-ruler ${glassClass(ctx)}`}
      style={{
        width: LENGTH,
        height: THICK,
        transform: `translate(${s.cx - LENGTH / 2}px, ${s.cy - THICK / 2}px) rotate(${s.angle}rad)`,
      }}
    >
      <svg width={LENGTH} height={THICK} aria-hidden>
        <g className="hn-ruler-ticks">{ticks}</g>
      </svg>
      <span className="hn-ruler-angle">{deg}°</span>
    </div>
  );
}

export default defineFeature({
  id: "ruler",
  name: "Ruler",
  description: "A ruler you move with one finger and rotate with two. Write along its edge for a perfectly straight line.",
  defaults: {},
  toolbarButtons: [
    {
      id: "ruler",
      label: "Ruler",
      icon: "ruler",
      active: (ctx) => stateOf(ctx).visible,
      onClick: (ctx) => {
        const s = stateOf(ctx);
        s.visible = !s.visible;
        if (s.visible) {
          s.cx = ctx.root.clientWidth / 2;
          s.cy = ctx.root.clientHeight / 2;
          s.angle = 0;
        }
        ctx.events.emit("ruler" as never);
        ctx.setState({}); // refresh the toolbar button
      },
    },
  ],
  setup(ctx) {
    const s = stateOf(ctx);
    const rel = (e: PointerEvent) => {
      const r = ctx.root.getBoundingClientRect();
      return { x: e.clientX - r.left, y: e.clientY - r.top };
    };
    const onRuler = (x: number, y: number) => {
      const p = toLocal(s, x, y);
      return s.visible && Math.abs(p.u) <= LENGTH / 2 && Math.abs(p.v) <= THICK / 2;
    };

    /* ---- fingers move and turn the ruler ---- */
    const fingers = new Map<number, { x: number; y: number }>();
    let start: { cx: number; cy: number; angle: number; a: { x: number; y: number }; b?: { x: number; y: number } } | null = null;
    const snapshot = () => {
      const [a, b] = [...fingers.values()];
      start = { cx: s.cx, cy: s.cy, angle: s.angle, a: { ...a }, b: b && { ...b } };
    };
    const down = (e: PointerEvent) => {
      if (e.pointerType !== "touch" || !s.visible) return;
      const p = rel(e);
      if (!fingers.size && !onRuler(p.x, p.y)) return;
      if (fingers.size >= 2) return;
      ctx.claimedTouches.add(e.pointerId);
      fingers.set(e.pointerId, p);
      snapshot();
    };
    const move = (e: PointerEvent) => {
      if (!fingers.has(e.pointerId) || !start) return;
      fingers.set(e.pointerId, rel(e));
      const [a, b] = [...fingers.values()];
      if (b && start.b) {
        const ang0 = Math.atan2(start.b.y - start.a.y, start.b.x - start.a.x);
        const ang1 = Math.atan2(b.y - a.y, b.x - a.x);
        let angle = start.angle + (ang1 - ang0);
        // gentle snap to 0/45/90°
        const deg = (angle * 180) / Math.PI;
        const nearest = Math.round(deg / 45) * 45;
        if (Math.abs(deg - nearest) < 2.5) angle = (nearest * Math.PI) / 180;
        s.angle = angle;
        s.cx = start.cx + ((a.x + b.x) / 2 - (start.a.x + start.b.x) / 2);
        s.cy = start.cy + ((a.y + b.y) / 2 - (start.a.y + start.b.y) / 2);
      } else {
        s.cx = start.cx + (a.x - start.a.x);
        s.cy = start.cy + (a.y - start.a.y);
      }
      ctx.events.emit("ruler" as never);
    };
    const up = (e: PointerEvent) => {
      if (!fingers.has(e.pointerId)) return;
      fingers.delete(e.pointerId);
      ctx.claimedTouches.delete(e.pointerId);
      if (fingers.size) snapshot();
      else start = null;
    };
    window.addEventListener("pointerdown", down, true);
    window.addEventListener("pointermove", move, true);
    window.addEventListener("pointerup", up, true);
    window.addEventListener("pointercancel", up, true);

    /* ---- the pen follows the nearest edge ---- */
    const offFilter = ctx.pen.addFilter({
      id: "ruler",
      order: 15,
      start: (e) => {
        if (!s.visible || !INK_TOOLS.includes(ctx.state.tool as InkToolId)) return null;
        const r = ctx.root.getBoundingClientRect();
        const p = toLocal(s, e.clientX - r.left, e.clientY - r.top);
        if (Math.abs(p.u) > LENGTH / 2 + SNAP) return null;
        const side = p.v < 0 ? -1 : 1;
        if (Math.abs(Math.abs(p.v) - THICK / 2) > SNAP && Math.abs(p.v) > THICK / 2) return null;
        const edge = side * (THICK / 2 + 1.5);
        return {
          point: (pt) => {
            const l = toLocal(s, pt.x - r.left, pt.y - r.top);
            const g = fromLocal(s, l.u, edge);
            return { ...pt, x: g.x + r.left, y: g.y + r.top };
          },
        };
      },
    });

    return () => {
      window.removeEventListener("pointerdown", down, true);
      window.removeEventListener("pointermove", move, true);
      window.removeEventListener("pointerup", up, true);
      window.removeEventListener("pointercancel", up, true);
      offFilter();
    };
  },
  Overlay: Ruler,
});
