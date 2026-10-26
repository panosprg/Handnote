import { useCtxState, type HandnoteContext } from "../core/context";
import { HIGHLIGHTER_WIDTHS, INK_TOOLS, PEN_WIDTHS, useSettings, type CoreSettings, type InkToolId } from "../core/settings";
import { defineFeature } from "../core/types";
import { glassClass, Icon, PanelHost } from "../core/ui";
import "./toolbar-classic.css";

const ERASER_SIZES = [8, 14, 22, 34];

/**
 * Goodnotes-style top bar: every tool, then quick options for the tool in use
 * (colours and sizes for pens, sizes for the precision eraser).
 */
function Toolbar({ ctx }: { ctx: HandnoteContext }) {
  const settings = useSettings(ctx.store);
  const core = settings.core;
  const ui = useCtxState(ctx);
  const withPalette = false;

  const glass = glassClass(ctx);
  const active = ctx.activeTool();
  const inkId = active && INK_TOOLS.includes(active.id as InkToolId) ? (active.id as InkToolId) : null;
  const ink = inkId ? core[inkId] : null;

  const setWidth = (w: number) =>
    inkId && ctx.store.updateCore({ [inkId]: { ...core[inkId], width: w } } as Partial<CoreSettings>);

  let options: React.ReactNode = null;
  if (inkId && ink) {
    const widths = inkId === "highlighter" ? HIGHLIGHTER_WIDTHS : PEN_WIDTHS;
    options = (
      <>
        {core.favourites.slice(0, 5).map((c, i) => (
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
          title="All colours, sizes and stabilization"
          onClick={() => ctx.togglePanel("tool")}
        >
          <span className="hn-wheel-mini">
            <span style={{ background: ink.color }} />
          </span>
        </button>
        <span className="hn-sep" />
        {widths.map((w) => {
          const d = Math.min(18, 3 + w * (inkId === "highlighter" ? 1.6 : 3.4));
          return (
            <button
              key={w}
              className={`hn-btn hn-size-quick ${ink.width === w ? "is-active" : ""}`}
              aria-label={`Size ${w}`}
              onClick={() => setWidth(w)}
            >
              <span style={{ width: d, height: d, background: ink.color, opacity: Math.max(0.35, ink.opacity / 100) }} />
            </button>
          );
        })}
      </>
    );
  } else if (active?.id === "precision-eraser") {
    const size = ctx.featureSettings<{ size: number }>("precision-eraser").size;
    options = ERASER_SIZES.map((s) => (
      <button
        key={s}
        className={`hn-btn hn-size-quick ${size === s ? "is-active" : ""}`}
        aria-label={`Eraser size ${s}`}
        onClick={() => ctx.updateFeatureSettings("precision-eraser", { size: s })}
      >
        <span className="hn-eraser-dot" style={{ width: Math.min(20, s * 0.6), height: Math.min(20, s * 0.6) }} />
      </button>
    ));
  }

  return (
    <>
      <div className={`hn-toolbar ${glass}`} onPointerDown={(e) => e.stopPropagation()}>
        {!withPalette && (
          <>
            <button className="hn-btn" aria-label="Undo" title="Undo" onClick={() => ctx.undo()}>
              <Icon name="undo-2" />
            </button>
            <button className="hn-btn" aria-label="Redo" title="Redo" onClick={() => ctx.redo()}>
              <Icon name="redo-2" />
            </button>
            <span className="hn-sep" />
          </>
        )}

        {ctx.tools().map((t) => (
          <button
            key={t.id}
            className={`hn-btn ${ui.tool === t.id ? "is-active" : ""}`}
            aria-label={t.label}
            title={t.label}
            onClick={() => ctx.setTool(t.id)}
          >
            <Icon name={t.icon} />
          </button>
        ))}
        <button
          className={`hn-btn ${ui.showNative ? "is-active" : ""}`}
          aria-label="Shapes and text"
          title="Shapes, text and more"
          onClick={() => ctx.setState({ showNative: !ui.showNative })}
        >
          <Icon name="shapes" />
        </button>
        <button
          className={`hn-btn ${ui.panel === "paper" ? "is-active" : ""}`}
          aria-label="Paper"
          title="Paper template"
          onClick={() => ctx.togglePanel("paper")}
        >
          <Icon name="notebook" />
        </button>

        {options && (
          <>
            <span className="hn-sep" />
            {options}
          </>
        )}
      </div>
      {/* With the palette on screen, the full pen panel opens by the palette instead. */}
      <PanelHost ctx={ctx} className="hn-panel-top" only={withPalette ? ["paper"] : undefined} />
    </>
  );
}

export default defineFeature({
  id: "toolbar-classic",
  name: "Top bar",
  description: "Glass toolbar at the top centre: every tool plus quick colours and sizes for the one in use.",
  optional: false,
  defaults: {},
  Overlay: Toolbar,
});
