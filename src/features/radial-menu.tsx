import { useEffect, useRef, useState } from "react";
import { useCtxState, type HandnoteContext } from "../core/context";
import { useSettings } from "../core/settings";
import { defineFeature } from "../core/types";
import { glassClass, Icon } from "../core/ui";
import "./radial-menu.css";

type S = { delay: number };

interface Item {
  key: string;
  kind: "tool" | "color";
  value: string;
  icon?: string;
  label: string;
  dx: number;
  dy: number;
}

const ITEM = 46;

function layout(ctx: HandnoteContext): { items: Item[]; radius: number } {
  const tools = ctx.tools().filter((t) => t.id !== "hand");
  const favs = ctx.core.favourites;
  const items: Item[] = [];
  const arc = (140 * Math.PI) / 180;
  const ring = (n: number) => (n > 1 ? Math.max(78, ((ITEM - 2) * (n - 1)) / arc) : 78);
  const toolR = ring(tools.length);
  tools.forEach((t, i) => {
    const deg = tools.length === 1 ? -90 : -160 + (140 / (tools.length - 1)) * i;
    const a = (deg * Math.PI) / 180;
    items.push({ key: `t-${t.id}`, kind: "tool", value: t.id, icon: t.icon, label: t.label, dx: Math.cos(a) * toolR, dy: Math.sin(a) * toolR });
  });
  const colorR = ring(favs.length);
  favs.forEach((c, i) => {
    const deg = favs.length === 1 ? 90 : 20 + (140 / (favs.length - 1)) * i;
    const a = (deg * Math.PI) / 180;
    items.push({ key: `c-${i}`, kind: "color", value: c, label: c, dx: Math.cos(a) * colorR, dy: Math.sin(a) * colorR });
  });
  return { items, radius: Math.max(toolR, colorR) + ITEM / 2 + 8 };
}

/** Excalidraw opens its own menu after a 500 ms touch hold; a touchmove cancels it. */
function cancelExcalidrawMenu(target: EventTarget | null) {
  try {
    target?.dispatchEvent(new TouchEvent("touchmove", { bubbles: true, cancelable: true }));
  } catch {
    /* no TouchEvent on desktop: no touch menu there either */
  }
}

function RadialMenu({ ctx, settings }: { ctx: HandnoteContext; settings: S }) {
  useSettings(ctx.store);
  const ui = useCtxState(ctx);
  const [menu, setMenu] = useState<{ x: number; y: number; hover: string | null } | null>(null);
  const live = useRef({ menu, settings });
  live.current = { menu, settings };

  const close = () => {
    setMenu(null);
    ctx.setState({ modal: false });
  };

  const pick = (it: Item) => {
    close();
    if (it.kind === "tool") ctx.setTool(it.value);
    else ctx.setInkColor(it.value);
  };
  const pickRef = useRef(pick);
  pickRef.current = pick;

  useEffect(() => {
    const root = ctx.root;
    let timer: number | null = null;
    let finger: { id: number; sx: number; sy: number; x: number; y: number } | null = null;
    let menuFinger: number | null = null;
    let touchCount = 0;

    const hit = (cx: number, cy: number): Item | null => {
      const m = live.current.menu;
      if (!m) return null;
      const rect = root.getBoundingClientRect();
      let best: Item | null = null;
      let bestD = ITEM * 0.75;
      for (const it of layout(ctx).items) {
        const d = Math.hypot(cx - rect.left - (m.x + it.dx), cy - rect.top - (m.y + it.dy));
        if (d < bestD) [best, bestD] = [it, d];
      }
      return best;
    };

    const clear = () => {
      if (timer !== null) window.clearTimeout(timer);
      timer = null;
    };

    const onDown = (e: PointerEvent) => {
      if (e.pointerType !== "touch" || (e.target as HTMLElement)?.tagName !== "CANVAS") return;
      touchCount++;
      if (touchCount > 1 || live.current.menu) {
        clear();
        return;
      }
      finger = { id: e.pointerId, sx: e.clientX, sy: e.clientY, x: e.clientX, y: e.clientY };
      const target = e.target;
      clear();
      timer = window.setTimeout(() => {
        timer = null;
        if (!finger || touchCount !== 1) return;
        cancelExcalidrawMenu(target);
        const rect = root.getBoundingClientRect();
        const { radius } = layout(ctx);
        const x = Math.min(Math.max(finger.x - rect.left, radius), rect.width - radius);
        const y = Math.min(Math.max(finger.y - rect.top, radius), rect.height - radius);
        menuFinger = finger.id;
        ctx.setState({ modal: true, panel: null });
        setMenu({ x, y, hover: null });
        navigator.vibrate?.(10);
      }, live.current.settings.delay);
    };

    const onMove = (e: PointerEvent) => {
      if (e.pointerType !== "touch") return;
      if (menuFinger === e.pointerId) {
        const it = hit(e.clientX, e.clientY);
        setMenu((m) => (m && m.hover !== (it?.key ?? null) ? { ...m, hover: it?.key ?? null } : m));
        return;
      }
      if (finger && finger.id === e.pointerId) {
        finger.x = e.clientX;
        finger.y = e.clientY;
        if (Math.hypot(finger.x - finger.sx, finger.y - finger.sy) > 10) clear();
      }
    };

    const onUp = (e: PointerEvent) => {
      if (e.pointerType !== "touch") return;
      touchCount = Math.max(0, touchCount - 1);
      if (menuFinger === e.pointerId) {
        menuFinger = null;
        const it = hit(e.clientX, e.clientY);
        if (it) pickRef.current(it); // slide-and-release; otherwise stays open for a tap
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

  if (!menu) return null;
  const { items } = layout(ctx);
  const glass = glassClass(ctx);
  return (
    <div className="hn-menu-backdrop" onPointerDown={(e) => e.target === e.currentTarget && close()}>
      <div className="hn-menu" style={{ left: menu.x, top: menu.y }}>
        <div className={`hn-menu-hub ${glass}`} />
        {items.map((it) => (
          <button
            key={it.key}
            className={`hn-menu-item ${glass} ${menu.hover === it.key ? "is-hover" : ""} ${
              it.kind === "tool" && it.value === ui.tool ? "is-active" : ""
            }`}
            style={{ transform: `translate(${it.dx}px, ${it.dy}px)` }}
            aria-label={it.label}
            onPointerUp={() => pick(it)}
          >
            {it.kind === "tool" ? <Icon name={it.icon!} /> : <span className="hn-swatch" style={{ background: it.value }} />}
          </button>
        ))}
      </div>
    </div>
  );
}

export default defineFeature<S>({
  id: "radial-menu",
  name: "Long-press tool menu",
  description:
    "Hold one finger on the page to open a ring of tools and favourite colours. Slide to one and lift, or tap. " +
    "(Stands in for Pencil double-tap/squeeze, which iPadOS doesn't give to web apps.)",
  defaults: { delay: 450 },
  settings: [{ key: "delay", type: "slider", name: "Hold time (ms)", min: 250, max: 900, step: 50 }],
  Overlay: RadialMenu,
});
