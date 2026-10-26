import { useEffect, useRef, useState } from "react";
import { mutateElement } from "@excalidraw/excalidraw";
import { useCtxState, type HandnoteContext } from "../core/context";
import { INK_TOOLS, useSettings, type InkToolId } from "../core/settings";
import { defineFeature } from "../core/types";
import { glassClass, Icon } from "../core/ui";
import "./radial-menu.css";

type S = { delay: number; pencilHold: boolean; pencilDelay: number };

/* Dial geometry (px) */
const SIZE = 264;
const C = SIZE / 2;
const R_OUT = 128;
const R_IN = 76; // tools live between R_IN and R_OUT
const R_COLOR = 52; // favourite colours sit on this circle
const R_HUB = 26;

interface Hit {
  kind: "tool" | "color";
  value: string;
}

function polar(r: number, a: number) {
  return { x: C + r * Math.sin(a), y: C - r * Math.cos(a) };
}

function segmentPath(i: number, n: number) {
  const gap = 0.012;
  const a0 = (i / n) * 2 * Math.PI + gap;
  const a1 = ((i + 1) / n) * 2 * Math.PI - gap;
  const large = a1 - a0 > Math.PI ? 1 : 0;
  const p0 = polar(R_OUT - 4, a0), p1 = polar(R_OUT - 4, a1), p2 = polar(R_IN + 2, a1), p3 = polar(R_IN + 2, a0);
  return `M${p0.x} ${p0.y} A${R_OUT - 4} ${R_OUT - 4} 0 ${large} 1 ${p1.x} ${p1.y} L${p2.x} ${p2.y} A${R_IN + 2} ${R_IN + 2} 0 ${large} 0 ${p3.x} ${p3.y}Z`;
}

function layout(ctx: HandnoteContext) {
  const tools = ctx.tools().filter((t) => t.id !== "hand");
  const colors = ctx.core.favourites.slice(0, 8);
  return { tools, colors };
}

/** What sits under a point given relative to the dial's centre. */
function hitTest(ctx: HandnoteContext, dx: number, dy: number): Hit | null {
  const { tools, colors } = layout(ctx);
  const r = Math.hypot(dx, dy);
  if (r >= R_IN - 4 && r <= R_OUT + 24 && tools.length) {
    const a = (Math.atan2(dx, -dy) + 2 * Math.PI) % (2 * Math.PI);
    return { kind: "tool", value: tools[Math.floor((a / (2 * Math.PI)) * tools.length) % tools.length].id };
  }
  if (r > R_HUB && r < R_IN - 4 && colors.length) {
    const a = (Math.atan2(dx, -dy) + 2 * Math.PI) % (2 * Math.PI);
    const i = Math.round((a / (2 * Math.PI)) * colors.length) % colors.length;
    return { kind: "color", value: colors[i] };
  }
  return null;
}

function RadialMenu({ ctx, settings }: { ctx: HandnoteContext; settings: S }) {
  useSettings(ctx.store);
  const ui = useCtxState(ctx);
  const [menu, setMenu] = useState<{ x: number; y: number; hover: Hit | null } | null>(null);
  const live = useRef({ menu, settings });
  live.current = { menu, settings };

  const close = () => {
    setMenu(null);
    ctx.setState({ modal: false });
  };
  const pick = (h: Hit) => {
    close();
    if (h.kind === "tool") ctx.setTool(h.value);
    else ctx.setInkColor(h.value);
  };
  const pickRef = useRef(pick);
  pickRef.current = pick;

  const open = (clientX: number, clientY: number) => {
    const rect = ctx.root.getBoundingClientRect();
    const half = SIZE / 2 + 8;
    const x = Math.min(Math.max(clientX - rect.left, half), rect.width - half);
    const y = Math.min(Math.max(clientY - rect.top, half), rect.height - half);
    ctx.setState({ modal: true, panel: null });
    setMenu({ x, y, hover: null });
    navigator.vibrate?.(10);
  };
  const openRef = useRef(open);
  openRef.current = open;

  /* ---- finger: hold one finger still ---- */
  useEffect(() => {
    const root = ctx.root;
    let timer: number | null = null;
    let finger: { id: number; sx: number; sy: number; x: number; y: number } | null = null;
    let menuFinger: number | null = null;
    let count = 0;

    const relHit = (cx: number, cy: number) => {
      const m = live.current.menu;
      if (!m) return null;
      const r = root.getBoundingClientRect();
      return hitTest(ctx, cx - r.left - m.x, cy - r.top - m.y);
    };
    const clear = () => {
      if (timer !== null) window.clearTimeout(timer);
      timer = null;
    };

    const onDown = (e: PointerEvent) => {
      if (e.pointerType !== "touch" || (e.target as HTMLElement)?.tagName !== "CANVAS") return;
      count++;
      if (count > 1 || live.current.menu) return clear();
      finger = { id: e.pointerId, sx: e.clientX, sy: e.clientY, x: e.clientX, y: e.clientY };
      clear();
      timer = window.setTimeout(() => {
        timer = null;
        if (!finger || count !== 1) return;
        menuFinger = finger.id;
        openRef.current(finger.x, finger.y);
      }, live.current.settings.delay);
    };
    const onMove = (e: PointerEvent) => {
      if (e.pointerType !== "touch") return;
      if (menuFinger === e.pointerId) {
        const h = relHit(e.clientX, e.clientY);
        setMenu((m) => (m && JSON.stringify(m.hover) !== JSON.stringify(h) ? { ...m, hover: h } : m));
        return;
      }
      if (finger?.id === e.pointerId) {
        finger.x = e.clientX;
        finger.y = e.clientY;
        if (Math.hypot(finger.x - finger.sx, finger.y - finger.sy) > 10) clear();
      }
    };
    const onUp = (e: PointerEvent) => {
      if (e.pointerType !== "touch") return;
      count = Math.max(0, count - 1);
      if (menuFinger === e.pointerId) {
        menuFinger = null;
        const h = relHit(e.clientX, e.clientY);
        if (h) pickRef.current(h); // slide-and-release; otherwise it stays open for a tap
      }
      if (finger?.id === e.pointerId) {
        finger = null;
        clear();
      }
    };

    root.addEventListener("pointerdown", onDown, true);
    window.addEventListener("pointermove", onMove, true);
    window.addEventListener("pointerup", onUp, true);
    window.addEventListener("pointercancel", onUp, true);
    return () => {
      clear();
      root.removeEventListener("pointerdown", onDown, true);
      window.removeEventListener("pointermove", onMove, true);
      window.removeEventListener("pointerup", onUp, true);
      window.removeEventListener("pointercancel", onUp, true);
    };
  }, [ctx]);

  /* ---- Pencil: press and hold still before writing ---- */
  useEffect(() => {
    return ctx.pen.addFilter({
      id: "pencil-hold-menu",
      order: 1,
      start: (e) => {
        if (!live.current.settings.pencilHold || !INK_TOOLS.includes(ctx.state.tool as InkToolId)) return null;
        const sx = e.clientX;
        const sy = e.clientY;
        let opened = false;
        let timer: number | null = window.setTimeout(() => {
          timer = null;
          opened = true;
          ctx.pen.freeze();
          openRef.current(sx, sy);
        }, live.current.settings.pencilDelay);
        return {
          point: (p) => {
            if (timer !== null && Math.hypot(p.x - sx, p.y - sy) > 4) {
              window.clearTimeout(timer);
              timer = null;
            }
            return opened ? null : p;
          },
          // The dot left by holding the Pencil down is removed.
          finish: (el) => {
            if (opened) mutateElement(el as never, { isDeleted: true } as never);
          },
          dispose: () => {
            if (timer !== null) window.clearTimeout(timer);
          },
        };
      },
    });
  }, [ctx]);

  if (!menu) return null;
  const { tools, colors } = layout(ctx);
  const n = tools.length;
  const glass = glassClass(ctx);
  const current = ctx.core[ctx.inkTarget()].color;

  const onDialPointer = (e: React.PointerEvent) => {
    const r = (e.currentTarget as HTMLElement).getBoundingClientRect();
    return hitTest(ctx, e.clientX - r.left - C, e.clientY - r.top - C);
  };

  return (
    <div className="hn-dial-backdrop" onPointerDown={(e) => e.target === e.currentTarget && close()}>
      <div
        className="hn-dial"
        style={{ left: menu.x - C, top: menu.y - C, width: SIZE, height: SIZE }}
        onPointerMove={(e) => {
          if (e.pointerType === "touch") return; // fingers are tracked above
          const h = onDialPointer(e);
          setMenu((m) => (m ? { ...m, hover: h } : m));
        }}
        onPointerUp={(e) => {
          const h = onDialPointer(e);
          if (h) pick(h);
        }}
      >
        <div className={`hn-dial-glass ${glass}`} />
        <svg width={SIZE} height={SIZE} className="hn-dial-svg" aria-hidden>
          {tools.map((t, i) => {
            const hover = menu.hover?.kind === "tool" && menu.hover.value === t.id;
            const active = ui.tool === t.id;
            return (
              <path
                key={t.id}
                d={segmentPath(i, n)}
                className={`hn-dial-seg ${hover ? "is-hover" : ""} ${active ? "is-active" : ""}`}
              />
            );
          })}
        </svg>
        {tools.map((t, i) => {
          const p = polar((R_IN + R_OUT) / 2, ((i + 0.5) / n) * 2 * Math.PI);
          const hover = menu.hover?.kind === "tool" && menu.hover.value === t.id;
          return (
            <button
              key={t.id}
              className={`hn-dial-tool ${ui.tool === t.id ? "is-active" : ""} ${hover ? "is-hover" : ""}`}
              style={{ left: p.x - 20, top: p.y - 20 }}
              aria-label={t.label}
              title={t.label}
            >
              <Icon name={t.icon} />
            </button>
          );
        })}
        {colors.map((c, i) => {
          const p = polar(R_COLOR, (i / colors.length) * 2 * Math.PI);
          const hover = menu.hover?.kind === "color" && menu.hover.value === c;
          return (
            <button
              key={`${c}-${i}`}
              className={`hn-dial-color ${hover ? "is-hover" : ""} ${current.toLowerCase() === c.toLowerCase() ? "is-active" : ""}`}
              style={{ left: p.x - 11, top: p.y - 11, background: c }}
              aria-label={`Colour ${c}`}
            />
          );
        })}
        <div className="hn-dial-hub" style={{ background: current }} />
      </div>
    </div>
  );
}

export default defineFeature<S>({
  id: "radial-menu",
  name: "Quick menu",
  description:
    "A dial with every tool and your favourite colours. Open it by holding one finger on the page, or by pressing the Pencil and holding it still before you write. (Pencil double-tap and squeeze can't reach Obsidian plugins.)",
  defaults: { delay: 450, pencilHold: true, pencilDelay: 600 },
  settings: [
    { key: "delay", type: "slider", name: "Finger hold time (ms)", min: 250, max: 900, step: 50 },
    { key: "pencilHold", type: "toggle", name: "Open with Pencil press-and-hold" },
    { key: "pencilDelay", type: "slider", name: "Pencil hold time (ms)", min: 400, max: 1200, step: 50 },
  ],
  Overlay: RadialMenu,
});
