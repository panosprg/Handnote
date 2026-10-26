import { Component, useEffect, useRef, useState, type ReactNode } from "react";
import { Notice, setIcon } from "obsidian";

import { useCtxState, type HandnoteContext } from "./context";
import {
  formatMm,
  MAX_FAVOURITES,
  MM_PRESETS,
  MM_RANGE,
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
      <div className="hn-panel-title">{ctx.tool(target)?.label ?? "Pen"}</div>

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
      <div className="hn-mm-preview" aria-hidden>
        <span style={{ height: Math.max(1, mm * PREVIEW_PX_PER_MM), background: cfg.color, opacity: cfg.opacity / 100 }} />
      </div>

      {sections}
    </>
  );
}

/* ------------------------------------------------------------------ */
/* Paper panel                                                         */
/* ------------------------------------------------------------------ */

export function PaperPanel({ ctx }: { ctx: HandnoteContext }) {
  const { template } = useCtxState(ctx);
  return (
    <>
      <div className="hn-panel-title">Paper</div>
      <div className="hn-row">
        {(["blank", "lined", "grid", "dots"] as Template[]).map((t) => (
          <button
            key={t}
            className={`hn-paper-opt hn-tpl-${t} ${template === t ? "is-active" : ""}`}
            onClick={() => ctx.setTemplate(t)}
          >
            <span className="hn-paper-preview" />
            <span className="hn-paper-name">{t[0].toUpperCase() + t.slice(1)}</span>
          </button>
        ))}
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
        </div>
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
