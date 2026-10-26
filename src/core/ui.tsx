import { Component, useEffect, useRef, useState, type ReactNode } from "react";
import { Notice, setIcon } from "obsidian";
import { templatePreviewCss } from "./templates";

import { useCtxState, type HandnoteContext } from "./context";
import {
  formatMm,
  MAX_FAVOURITES,
  MAX_PINNED,
  MM_PRESETS,
  MM_RANGE,
  PEN_TYPES,
  TEMPLATES,
  mmToWidth,
  PALETTE,
  sameMm,
  widthToMm,
  useSettings,
  type CoreSettings,
  type Template,
} from "./settings";

export function Icon({ name }: { name: string }) {
  const ref = useRef<HTMLSpanElement>(null);
  useEffect(() => {
    if (ref.current) setIcon(ref.current, name);
  }, [name]);
  return <span className="hn-icon" ref={ref} aria-hidden />;
}

export function glassClass(ctx: HandnoteContext) {
  return ctx.core.reduceTransparency ? "hn-solid" : "hn-glass";
}

/** Stops a misbehaving feature from taking the whole page down. */
/** Shows a visible message when a feature breaks, so problems on the iPad aren't silent. */
export const crashLog: { feature: string; error: string; at: string }[] = [];
export function reportCrash(feature: string, e: unknown) {
  const error = e instanceof Error ? e.message : String(e);
  crashLog.push({ feature, error, at: new Date().toISOString() });
  new Notice(`Handnote: "${feature}" stopped working: ${error}`, 10000);
}

export class FeatureBoundary extends Component<{ id: string; children: ReactNode }, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError() {
    return { failed: true };
  }
  componentDidCatch(e: unknown) {
    console.error(`Handnote: feature "${this.props.id}" crashed and was switched off for this note`, e);
    reportCrash(this.props.id, e);
  }
  render() {
    return this.state.failed ? null : this.props.children;
  }
}

/* ------------------------------------------------------------------ */
/* Pen / highlighter panel                                             */
/* ------------------------------------------------------------------ */

/* ------------------------------------------------------------------ */
/* Shared menu pieces                                                  */
/* ------------------------------------------------------------------ */

/** A small drawing of each pen type, for Line options. */
function LineSample({ type, color }: { type: string; color: string }) {
  const common = { fill: "none", stroke: color, strokeLinecap: "round" as const };
  return (
    <svg width="44" height="14" viewBox="0 0 44 14" aria-hidden>
      {type === "pen" ? (
        <path d="M3 10 C 12 2, 20 2, 26 7 S 38 11, 41 4" {...common} strokeWidth="1" />
      ) : null}
      {type === "pen" ? <path d="M10 6.5 C 16 3.5, 21 4, 26 7" {...common} strokeWidth="3" /> : null}
      {type === "ballpoint" ? <path d="M3 10 C 12 2, 20 2, 26 7 S 38 11, 41 4" {...common} strokeWidth="2" /> : null}
      {type === "dotted" ? <path d="M3 7 H 41" {...common} strokeWidth="2.6" strokeDasharray="0.1 5.5" /> : null}
      {type === "dashed" ? <path d="M3 7 H 41" {...common} strokeWidth="2.2" strokeDasharray="6 5" /> : null}
    </svg>
  );
}

/** Pick which tool of a group (pen type, eraser type) the group's button uses. */
export function TypePicker({ ctx, title, options }: { ctx: HandnoteContext; title: string; options: { id: string; name: string }[] }) {
  const ui = useCtxState(ctx);
  return (
    <>
      <div className="hn-label">{title}</div>
      <div className="hn-row hn-types" role="radiogroup" aria-label={title}>
        {options.map((o) => (
          <button
            key={o.id}
            role="radio"
            aria-checked={ui.tool === o.id}
            className={`hn-type ${ui.tool === o.id ? "is-active" : ""}`}
            aria-label={o.name}
            onClick={() => ui.tool !== o.id && ctx.setTool(o.id)}
          >
            {PEN_TYPES.some((p) => p.id === o.id) ? <LineSample type={o.id} color="currentColor" /> : null}
            <span>{o.name}</span>
          </button>
        ))}
      </div>
    </>
  );
}

/** The sizes pinned to the second bar for one tool (max 3), with pin / unpin. */
export function PinnedSizes({
  ctx,
  tool,
  current,
  format,
  same = (a, b) => Math.abs(a - b) < 0.005,
}: {
  ctx: HandnoteContext;
  tool: string;
  current: number;
  format: (v: number) => string;
  same?: (a: number, b: number) => boolean;
}) {
  const settings = useSettings(ctx.store);
  const pins = settings.core.pinned[tool] ?? [];
  const set = (next: number[]) =>
    ctx.store.updateCore({ pinned: { ...settings.core.pinned, [tool]: [...next].sort((a, b) => a - b) } });
  const pinnedNow = pins.some((p) => same(p, current));
  return (
    <>
      <div className="hn-label">
        In the bar <span className="hn-value">{pins.length} / {MAX_PINNED}</span>
      </div>
      <div className="hn-row hn-pins">
        {pins.map((p) => (
          <button key={p} className="hn-pin" aria-label={`Unpin ${format(p)}`} onClick={() => set(pins.filter((x) => x !== p))}>
            {format(p)} <span className="hn-pin-x">×</span>
          </button>
        ))}
        {!pinnedNow && pins.length < MAX_PINNED && (
          <button className="hn-pin hn-pin-add" aria-label={`Pin ${format(current)}`} onClick={() => set([...pins, current])}>
            + Pin {format(current)}
          </button>
        )}
        {!pinnedNow && pins.length >= MAX_PINNED && <span className="hn-pin-note">Unpin one to add {format(current)}</span>}
      </div>
    </>
  );
}

/** Size preview: the line at its real size on the page (100% zoom). */
const PREVIEW_PX_PER_MM = 96 / 25.4;

export function InkPanel({ ctx }: { ctx: HandnoteContext }) {
  const settings = useSettings(ctx.store);
  useCtxState(ctx);
  const [hue, setHue] = useState(() => {
    const c = settings.core[ctx.inkTarget()].color.toLowerCase();
    const i = PALETTE.findIndex((p) => p.shades.includes(c));
    return i < 0 ? 0 : i;
  });
  const [editFavs, setEditFavs] = useState(false);

  const target = ctx.inkTarget();
  const cfg = settings.core[target];
  const mm = widthToMm(target, cfg.width);
  const range = MM_RANGE[target];
  const setMm = (v: number) => {
    const clamped = Math.min(range.max, Math.max(range.min, Math.round(v / range.step) * range.step));
    updateInk({ width: mmToWidth(target, clamped) });
  };
  const isCurrent = (c: string) => cfg.color.toLowerCase() === c.toLowerCase();

  const updateInk = (patch: Partial<CoreSettings["pen"]>) =>
    ctx.store.updateCore({ [target]: { ...cfg, ...patch } } as Partial<CoreSettings>);

  const addFavourite = () => {
    if (settings.core.favourites.some(isCurrent)) return;
    ctx.store.updateCore({ favourites: [...settings.core.favourites, cfg.color].slice(-MAX_FAVOURITES) });
  };

  const sections = ctx.registry
    .enabled(settings)
    .filter((f) => f.InkPanelSection)
    .map((f) => {
      const Section = f.InkPanelSection!;
      return (
        <FeatureBoundary key={f.id} id={f.id}>
          <Section ctx={ctx} settings={ctx.registry.settingsOf(f, settings)} />
        </FeatureBoundary>
      );
    });

  return (
    <>
      <div className="hn-panel-title">{ctx.tool(target)?.group === "pen" ? "Pen" : (ctx.tool(target)?.label ?? "Pen")}</div>
      {ctx.tool(target)?.group === "pen" && (
        <TypePicker ctx={ctx} title="Line options" options={PEN_TYPES.filter((p) => ctx.tool(p.id))} />
      )}

      <div className="hn-row hn-hues">
        {PALETTE.map((p, i) => (
          <button
            key={p.name}
            className={`hn-hue ${hue === i ? "is-active" : ""}`}
            aria-label={p.name}
            title={p.name}
            style={{ background: p.shades[1] }}
            onClick={() => setHue(i)}
          />
        ))}
      </div>

      <div className="hn-row hn-shades">
        {PALETTE[hue].shades.map((c) => (
          <button
            key={c}
            className={`hn-shade ${isCurrent(c) ? "is-active" : ""}`}
            style={{ background: c }}
            aria-label={c}
            onClick={() => ctx.setInkColor(c)}
          />
        ))}
        <label className="hn-wheel" title="Colour wheel">
          <input type="color" value={cfg.color} onChange={(e) => ctx.setInkColor(e.target.value)} />
        </label>
      </div>

      <div className="hn-label">
        Favourites
        <button className="hn-link" onClick={() => setEditFavs(!editFavs)}>
          {editFavs ? "Done" : "Edit"}
        </button>
      </div>
      <div className="hn-row hn-favs">
        {settings.core.favourites.map((c, i) => (
          <button
            key={`${c}-${i}`}
            className={`hn-fav ${isCurrent(c) ? "is-active" : ""}`}
            style={{ background: c }}
            aria-label={editFavs ? `Remove ${c}` : c}
            onClick={() =>
              editFavs
                ? ctx.store.updateCore({ favourites: settings.core.favourites.filter((_, j) => j !== i) })
                : ctx.setInkColor(c)
            }
          >
            {editFavs && <span className="hn-fav-x">×</span>}
          </button>
        ))}
        {settings.core.favourites.length < MAX_FAVOURITES && (
          <button className="hn-fav hn-fav-add" aria-label="Add current colour" onClick={addFavourite}>
            +
          </button>
        )}
      </div>

      <div className="hn-label">Size</div>
      <div className="hn-row">
        {MM_PRESETS[target].map((p, i, all) => {
          const d = 4 + (i / Math.max(1, all.length - 1)) * 20;
          return (
            <button
              key={p}
              className={`hn-width ${sameMm(mm, p) ? "is-active" : ""}`}
              aria-label={`Size ${formatMm(p)}`}
              title={formatMm(p)}
              onClick={() => setMm(p)}
            >
              <span style={{ width: d, height: d, background: cfg.color, opacity: cfg.opacity / 100 }} />
            </button>
          );
        })}
      </div>
      <div className="hn-mm">
        <button className="hn-mm-step" aria-label="Thinner" onClick={() => setMm(mm - range.step)}>
          −
        </button>
        <input
          className="hn-mm-slider"
          type="range"
          aria-label="Size in millimetres"
          min={range.min}
          max={range.max}
          step={range.step}
          value={Math.min(range.max, Math.max(range.min, mm))}
          onChange={(e) => setMm(parseFloat(e.target.value))}
        />
        <button className="hn-mm-step" aria-label="Thicker" onClick={() => setMm(mm + range.step)}>
          +
        </button>
        <span className="hn-mm-value">{formatMm(mm)}</span>
      </div>
      <div className={`hn-mm-preview ${target === "dotted" || target === "dashed" ? `hn-mm-preview-${target}` : ""}`} aria-hidden>
        <span
          style={{
            height: Math.max(1, mm * PREVIEW_PX_PER_MM),
            ...(target === "dotted" || target === "dashed"
              ? { color: cfg.color, borderTopWidth: Math.max(1, mm * PREVIEW_PX_PER_MM) }
              : { background: cfg.color }),
            opacity: cfg.opacity / 100,
          }}
        />
      </div>
      <PinnedSizes ctx={ctx} tool={target} current={Math.round(mm * 100) / 100} format={formatMm} same={sameMm} />

      {sections}
    </>
  );
}

/* ------------------------------------------------------------------ */
/* Paper panel                                                         */
/* ------------------------------------------------------------------ */

/** "1-3, 5" → [0, 1, 2, 4] (0-based, within 1..count). */
export function parsePageRange(text: string, count: number): number[] {
  const out = new Set<number>();
  for (const part of text.split(/[,;\s]+/).filter(Boolean)) {
    const m = part.match(/^(\d+)(?:-(\d+))?$/);
    if (!m) continue;
    let a = Number(m[1]);
    let b = m[2] ? Number(m[2]) : a;
    if (a > b) [a, b] = [b, a];
    for (let i = Math.max(1, a); i <= Math.min(count, b); i++) out.add(i - 1);
  }
  return [...out].sort((x, y) => x - y);
}

export function PaperPanel({ ctx }: { ctx: HandnoteContext }) {
  const ui = useCtxState(ctx);
  const pageCount = ui.pages.sizes.length;
  const [scope, setScope] = useState<"page" | "all">(pageCount > 1 ? "page" : "all");
  const page = ctx.currentPage();
  const current = scope === "all" ? ui.template : ctx.pageTemplate(page);
  const dark = ctx.root.classList.contains("hn-dark");
  return (
    <>
      <div className="hn-panel-title">Paper</div>
      <div className="hn-row hn-types" role="radiogroup" aria-label="Apply paper to">
        <button role="radio" aria-checked={scope === "page"} className={`hn-type ${scope === "page" ? "is-active" : ""}`} onClick={() => setScope("page")}>
          <span>This page ({page + 1})</span>
        </button>
        <button role="radio" aria-checked={scope === "all"} className={`hn-type ${scope === "all" ? "is-active" : ""}`} onClick={() => setScope("all")}>
          <span>All pages</span>
        </button>
      </div>
      <div className="hn-paper-grid">
        {TEMPLATES.map((t) => (
          <button
            key={t.id}
            className={`hn-paper-opt hn-tpl-${t.id} ${current === t.id ? "is-active" : ""}`}
            aria-label={t.name}
            onClick={() => ctx.setPageTemplate(scope === "all" ? "all" : page, t.id)}
          >
            <span className="hn-paper-preview" style={{ backgroundImage: templatePreviewCss(t.id, dark) }} />
            <span className="hn-paper-name">{t.name}</span>
          </button>
        ))}
      </div>
    </>
  );
}

function PrintRow({ ctx }: { ctx: HandnoteContext }) {
  const ui = useCtxState(ctx);
  const [range, setRange] = useState("");
  const count = ui.pages.sizes.length;
  const go = (pages?: number[]) => {
    ctx.setState({ panel: null });
    void ctx.host.print?.(pages);
  };
  const picked = parsePageRange(range, count);
  return (
    <>
      <div className="hn-label">Print</div>
      <div className="hn-row hn-print">
        <button className="hn-chip" aria-label="Print all pages" onClick={() => go()}>
          <Icon name="printer" /> All pages
        </button>
        <button className="hn-chip" aria-label="Print this page" onClick={() => go([ctx.currentPage()])}>
          This page
        </button>
        <input
          className="hn-range"
          aria-label="Pages to print"
          placeholder={count > 1 ? `e.g. 1-${Math.min(3, count)}` : "1"}
          value={range}
          onChange={(e) => setRange(e.target.value)}
        />
        <button className="hn-chip" disabled={!picked.length} aria-label="Print these pages" onClick={() => go(picked)}>
          Print {picked.length ? `${picked.length} page${picked.length > 1 ? "s" : ""}` : "pages"}
        </button>
      </div>
    </>
  );
}

/** Renders whichever panel is open; toolbars decide where it sits. */
export function PanelHost({
  ctx,
  className,
  style,
  only,
}: {
  ctx: HandnoteContext;
  className?: string;
  style?: React.CSSProperties;
  /** Render only these panels (when two toolbars share the page). */
  only?: string[];
}) {
  const st = useCtxState(ctx);
  useSettings(ctx.store);
  if (only && st.panel && !only.includes(st.panel)) return null;
  let content: ReactNode = null;
  if (st.panel === "tool") {
    const P = ctx.activeTool()?.Panel;
    content = P ? <P ctx={ctx} /> : null;
  } else if (st.panel === "paper") {
    content = (
      <>
        <PaperPanel ctx={ctx} />
        <div className="hn-label">Notebook</div>
        <div className="hn-row">
          <button className="hn-chip" onClick={() => ctx.addPage()}>
            <Icon name="file-plus" /> Add page
          </button>
          <button
            className="hn-chip"
            onClick={() => {
              ctx.setState({ panel: null });
              void ctx.host.exportPdf();
            }}
          >
            <Icon name="file-down" /> Export PDF
          </button>
          <button
            className="hn-chip"
            onClick={() => {
              ctx.setState({ panel: null });
              ctx.events.emit("editToolbar" as never);
            }}
          >
            <Icon name="layout-grid" /> Edit toolbar
          </button>
        </div>
        {ctx.host.print && <PrintRow ctx={ctx} />}
      </>
    );
  }
  if (!content) return null;
  return (
    <div
      className={`hn-panel ${glassClass(ctx)} ${className ?? ""}`}
      style={style}
      onPointerDown={(e) => e.stopPropagation()}
    >
      {content}
    </div>
  );
}
