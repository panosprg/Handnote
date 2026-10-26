import { useEffect, useRef, useState } from "react";
import { Notice } from "obsidian";
import { useCtxState, type HandnoteContext } from "../core/context";
import {
  formatMm,
  INK_TOOLS,
  MM_PRESETS,
  mmToWidth,
  sameMm,
  useSettings,
  widthToMm,
  type CoreSettings,
  type InkToolId,
} from "../core/settings";
import { defineFeature } from "../core/types";
import { glassClass, Icon, PanelHost } from "../core/ui";
import "./toolbar-classic.css";

const HOLD_MS = 550;

interface Item {
  key: string;
  label: string;
  icon: string;
  active: boolean;
  run(): void;
}

/** Every button the top bar can show, in their default order. */
function allItems(ctx: HandnoteContext): Item[] {
  const ui = ctx.state;
  const items: Item[] = [
    { key: "undo", label: "Undo", icon: "undo-2", active: false, run: () => ctx.undo() },
    { key: "redo", label: "Redo", icon: "redo-2", active: false, run: () => ctx.redo() },
  ];
  for (const t of ctx.groupedTools()) {
    items.push({
      key: t.key,
      label: t.label,
      icon: t.icon,
      active: t.group ? ctx.tool(ui.tool)?.group === t.group : ui.tool === t.id,
      run: () => ctx.setTool(t.group && ctx.tool(ui.tool)?.group === t.group ? ui.tool : t.member),
    });
  }
  for (const b of ctx.registry.enabled(ctx.settings).flatMap((f) => f.toolbarButtons ?? [])) {
    items.push({ key: `btn:${b.id}`, label: b.label, icon: b.icon, active: !!b.active?.(ctx), run: () => b.onClick(ctx) });
  }
  items.push(
    {
      key: "shapes",
      label: "Shapes and text",
      icon: "shapes",
      active: ui.showNative,
      run: () => ctx.setState({ showNative: !ui.showNative }),
    },
    { key: "notebook", label: "Notebook", icon: "notebook", active: ui.panel === "paper", run: () => ctx.togglePanel("paper") },
  );
  return items;
}

/** Saved order first (unknown keys dropped), then anything new in its default place at the end. */
export function arrange(keys: string[], saved: string[]): string[] {
  const known = saved.filter((k) => keys.includes(k));
  return [...known, ...keys.filter((k) => !known.includes(k))];
}

const SAVE_TEXT = {
  saved: "Saved",
  unsaved: "Unsaved changes",
  saving: "Saving…",
  error: "Couldn't save",
} as const;

function SaveDot({ ctx }: { ctx: HandnoteContext }) {
  const ui = useCtxState(ctx);
  const s = ui.saveStatus;
  return (
    <button
      className={`hn-btn hn-save is-${s}`}
      aria-label={SAVE_TEXT[s]}
      title={s === "error" && ui.saveError ? `${SAVE_TEXT[s]}: ${ui.saveError}. Tap to try again.` : `${SAVE_TEXT[s]}. Tap to save now.`}
      onClick={() => {
        if (s === "error" && ui.saveError) new Notice(`Handnote couldn't save this notebook: ${ui.saveError}`);
        void ctx.host.saveNow?.();
      }}
    >
      <span className="hn-save-dot" />
    </button>
  );
}

/**
 * Goodnotes-style top bar: tools (pen types and erasers share one button each), then a
 * second bar with quick options for the tool in use. Hold any button to rearrange the bar.
 */
function Toolbar({ ctx }: { ctx: HandnoteContext }) {
  const settings = useSettings(ctx.store);
  const core = settings.core;
  const ui = useCtxState(ctx);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState<string[] | null>(null);
  const bar = useRef<HTMLDivElement>(null);
  const hold = useRef<{ timer: number | null; x: number; y: number; fired: boolean }>({ timer: null, x: 0, y: 0, fired: false });
  const drag = useRef<{ key: string; id: number } | null>(null);

  useEffect(() => ctx.events.on("editToolbar" as never, (() => setEditing(true)) as never), [ctx]);
  useEffect(() => ctx.setState({ modal: editing }), [editing]);

  const glass = glassClass(ctx);
  const items = allItems(ctx);
  const byKey = new Map(items.map((i) => [i.key, i]));
  const order = draft ?? arrange(items.map((i) => i.key), core.toolbar.order);
  const hidden = new Set(core.toolbar.hidden.filter((k) => byKey.has(k)));
  const shown = order.filter((k) => !hidden.has(k));

  const saveLayout = (patch: Partial<CoreSettings["toolbar"]>) =>
    ctx.store.updateCore({ toolbar: { ...core.toolbar, ...patch } });

  /* ----- hold to edit ----- */
  const clearHold = () => {
    if (hold.current.timer !== null) window.clearTimeout(hold.current.timer);
    hold.current.timer = null;
  };
  const onBarDown = (e: React.PointerEvent) => {
    e.stopPropagation();
    if (editing) return;
    hold.current = {
      x: e.clientX,
      y: e.clientY,
      fired: false,
      timer: window.setTimeout(() => {
        hold.current.fired = true;
        hold.current.timer = null;
        navigator.vibrate?.(10);
        setEditing(true);
      }, HOLD_MS),
    };
  };
  const onBarMove = (e: React.PointerEvent) => {
    if (hold.current.timer !== null && Math.hypot(e.clientX - hold.current.x, e.clientY - hold.current.y) > 8) clearHold();
    const d = drag.current;
    if (!editing || !d || d.id !== e.pointerId || !bar.current) return;
    // Move the dragged button to where the finger/Pencil is.
    const buttons = [...bar.current.querySelectorAll<HTMLElement>("[data-key]")];
    const others = buttons.filter((b) => b.dataset.key !== d.key);
    let index = others.findIndex((b) => {
      const r = b.getBoundingClientRect();
      return e.clientX < r.left + r.width / 2;
    });
    if (index < 0) index = others.length;
    const visible = others.map((b) => b.dataset.key!);
    visible.splice(index, 0, d.key);
    const next = [...visible, ...order.filter((k) => hidden.has(k))];
    if (next.join() !== order.join()) setDraft(next);
  };
  const onBarUp = (e: React.PointerEvent) => {
    clearHold();
    if (drag.current && drag.current.id === e.pointerId) {
      drag.current = null;
      if (draft) saveLayout({ order: draft });
      setDraft(null);
    }
  };
  const press = (it: Item) => {
    if (hold.current.fired) {
      hold.current.fired = false;
      return; // that press opened edit mode
    }
    if (!editing) it.run();
  };

  /* ----- second bar: options for the tool in use ----- */
  const active = ctx.activeTool();
  const inkId = active && INK_TOOLS.includes(active.id as InkToolId) ? (active.id as InkToolId) : null;
  const ink = inkId ? core[inkId] : null;
  let options: React.ReactNode = null;
  if (!editing && inkId && ink) {
    const presets = MM_PRESETS[inkId];
    const pins = core.pinned[inkId] ?? [];
    const lo = presets[0];
    const hi = presets[presets.length - 1];
    const mm = widthToMm(inkId, ink.width);
    options = (
      <>
        {core.favourites.slice(0, 8).map((c, i) => (
          <button
            key={`${c}-${i}`}
            className={`hn-btn hn-fav-quick ${ink.color.toLowerCase() === c.toLowerCase() ? "is-active" : ""}`}
            aria-label={`Colour ${c}`}
            onClick={() => ctx.setInkColor(c)}
          >
            <span className="hn-swatch hn-swatch-sm" style={{ background: c }} />
          </button>
        ))}
        <button
          className={`hn-btn ${ui.panel === "tool" ? "is-active" : ""}`}
          aria-label="All colours"
          title="Colours, line options and sizes"
          onClick={() => ctx.togglePanel("tool")}
        >
          <span className="hn-wheel-mini">
            <span style={{ background: ink.color }} />
          </span>
        </button>
        {pins.length > 0 && <span className="hn-sep" />}
        {pins.map((p) => {
          const d = 4 + Math.max(0, Math.min(1, (p - lo) / (hi - lo || 1))) * 12;
          return (
            <button
              key={p}
              className={`hn-btn hn-size-quick ${sameMm(mm, p) ? "is-active" : ""}`}
              aria-label={`Size ${formatMm(p)}`}
              title={formatMm(p)}
              onClick={() => ctx.store.updateCore({ [inkId]: { ...ink, width: mmToWidth(inkId, p) } } as Partial<CoreSettings>)}
            >
              <span style={{ width: d, height: d, background: ink.color, opacity: Math.max(0.35, ink.opacity / 100) }} />
            </button>
          );
        })}
        <button
          className={`hn-btn hn-mm-chip ${ui.panel === "tool" ? "is-active" : ""}`}
          aria-label="Exact size"
          title="Exact size and which sizes are in this bar"
          onClick={() => ctx.togglePanel("tool")}
        >
          {formatMm(mm)}
        </button>
      </>
    );
  } else if (!editing && active?.group === "eraser") {
    const key = active.id === "object-eraser" ? "objectSize" : "size";
    const size = ctx.featureSettings<Record<string, number>>("erasers")[key];
    const pins = core.pinned[active.id] ?? [];
    options = (
      <>
        {pins.map((s) => (
          <button
            key={s}
            className={`hn-btn hn-size-quick ${size === s ? "is-active" : ""}`}
            aria-label={`Eraser size ${s}`}
            onClick={() => ctx.updateFeatureSettings("erasers", { [key]: s })}
          >
            <span className="hn-eraser-dot" style={{ width: Math.min(20, s * 0.6), height: Math.min(20, s * 0.6) }} />
          </button>
        ))}
        <button
          className={`hn-btn hn-mm-chip ${ui.panel === "tool" ? "is-active" : ""}`}
          aria-label="Eraser options"
          title="Eraser type and sizes"
          onClick={() => ctx.togglePanel("tool")}
        >
          {active.id === "object-eraser" ? "Whole strokes" : "Precision"} · {size}
        </button>
      </>
    );
  }

  return (
    <>
      <div
        ref={bar}
        className={`hn-toolbar ${glass} ${editing ? "hn-toolbar-editing" : ""}`}
        onPointerDown={onBarDown}
        onPointerMove={onBarMove}
        onPointerUp={onBarUp}
        onPointerCancel={onBarUp}
        onContextMenu={(e) => e.preventDefault()}
      >
        {shown.map((k) => {
          const it = byKey.get(k)!;
          return (
            <span key={k} className={`hn-tb-item ${draft && drag.current?.key === k ? "is-dragging" : ""}`} data-key={k}>
              <button
                className={`hn-btn ${it.active && !editing ? "is-active" : ""}`}
                aria-label={it.label}
                title={editing ? `Drag to move ${it.label}` : it.label}
                onPointerDown={(e) => {
                  if (!editing) return;
                  (e.currentTarget as HTMLElement).setPointerCapture?.(e.pointerId);
                  drag.current = { key: k, id: e.pointerId };
                }}
                onClick={() => press(it)}
              >
                <Icon name={it.icon} />
              </button>
              {editing && (
                <button
                  className="hn-tb-remove"
                  aria-label={`Hide ${it.label}`}
                  onPointerDown={(e) => e.stopPropagation()}
                  onClick={() => saveLayout({ order, hidden: [...core.toolbar.hidden, k] })}
                >
                  −
                </button>
              )}
            </span>
          );
        })}
        {!editing && (
          <>
            <span className="hn-sep" />
            <SaveDot ctx={ctx} />
          </>
        )}
      </div>

      {editing && (
        <div className={`hn-optionsbar hn-tb-tray ${glass}`} onPointerDown={(e) => e.stopPropagation()}>
          {[...hidden].length === 0 && <span className="hn-tb-hint">Drag buttons to move them · tap − to hide</span>}
          {order
            .filter((k) => hidden.has(k))
            .map((k) => {
              const it = byKey.get(k)!;
              return (
                <button
                  key={k}
                  className="hn-btn hn-tb-add"
                  aria-label={`Show ${it.label}`}
                  title={`Show ${it.label}`}
                  onClick={() => saveLayout({ order, hidden: core.toolbar.hidden.filter((h) => h !== k) })}
                >
                  <Icon name={it.icon} />
                  <span className="hn-tb-plus">+</span>
                </button>
              );
            })}
          <span className="hn-sep" />
          <button className="hn-chip" onClick={() => saveLayout({ order: [], hidden: [] })}>
            Reset
          </button>
          <button className="hn-chip is-active" onClick={() => setEditing(false)}>
            Done
          </button>
        </div>
      )}

      {/* Second bar: colours and sizes for the tool in use, always visible (not lost off the edge). */}
      {options && (
        <div className={`hn-optionsbar ${glass}`} onPointerDown={(e) => e.stopPropagation()}>
          {options}
        </div>
      )}
      {!editing && <PanelHost ctx={ctx} className={options ? "hn-panel-top hn-panel-below-options" : "hn-panel-top"} />}
    </>
  );
}

export default defineFeature({
  id: "toolbar-classic",
  name: "Top bar",
  description:
    "Glass toolbar at the top centre: every tool plus quick colours and sizes for the one in use. Hold any button to rearrange it.",
  optional: false,
  defaults: {},
  Overlay: Toolbar,
});
