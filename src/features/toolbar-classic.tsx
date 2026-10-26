import { useCtxState, type HandnoteContext } from "../core/context";
import { useSettings } from "../core/settings";
import { defineFeature } from "../core/types";
import { glassClass, Icon, PanelHost } from "../core/ui";
import "./toolbar-classic.css";

function Toolbar({ ctx }: { ctx: HandnoteContext }) {
  const core = useSettings(ctx.store).core;
  const ui = useCtxState(ctx);
  if (core.toolbarStyle === "arc") return null;
  // Next to the curved palette, the top bar skips what the palette already has.
  const compact = core.toolbarStyle === "both";

  const glass = glassClass(ctx);
  const ink = core[ctx.inkTarget()];

  return (
    <>
      <div className={`hn-toolbar ${glass} ${compact ? "hn-toolbar-compact" : ""}`} onPointerDown={(e) => e.stopPropagation()}>
        {!compact && ctx.tools().map((t) => (
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
        {!compact && <span className="hn-sep" />}
        {!compact && (
        <button
          className="hn-btn"
          aria-label="Colour and size"
          title="Colour, size and stabilization"
          onClick={() => {
            if (!ctx.activeTool()?.ink) ctx.setTool(ctx.state.lastInk);
            ctx.togglePanel("tool");
          }}
        >
          <span className="hn-swatch" style={{ background: ink.color }} />
        </button>
        )}
        {core.favourites.slice(0, compact ? 8 : 4).map((c, i) => (
          <button
            key={`${c}-${i}`}
            className={`hn-btn hn-fav-quick ${ink.color.toLowerCase() === c.toLowerCase() ? "is-active" : ""}`}
            aria-label={`Favourite colour ${c}`}
            onClick={() => ctx.setInkColor(c)}
          >
            <span className="hn-swatch hn-swatch-sm" style={{ background: c }} />
          </button>
        ))}
        <span className="hn-sep" />
        {!compact && (
          <>
            <button className="hn-btn" aria-label="Undo" title="Undo" onClick={() => ctx.undo()}>
              <Icon name="undo-2" />
            </button>
            <button className="hn-btn" aria-label="Redo" title="Redo" onClick={() => ctx.redo()}>
              <Icon name="redo-2" />
            </button>
          </>
        )}
        <button
          className={`hn-btn ${ui.panel === "paper" ? "is-active" : ""}`}
          aria-label="Paper"
          title="Paper template"
          onClick={() => ctx.togglePanel("paper")}
        >
          <Icon name="notebook" />
        </button>
        {compact && (
          <button
            className={`hn-btn ${ui.tool === "hand" ? "is-active" : ""}`}
            aria-label="Hand"
            title="Hand (move the page with the Pencil)"
            onClick={() => ctx.setTool(ui.tool === "hand" ? ctx.state.lastInk : "hand")}
          >
            <Icon name="hand" />
          </button>
        )}
        <button
          className={`hn-btn ${ui.showNative ? "is-active" : ""}`}
          aria-label="Shapes and text"
          title="Shapes, text and more"
          onClick={() => ctx.setState({ showNative: !ui.showNative })}
        >
          <Icon name="shapes" />
        </button>
      </div>
      <PanelHost ctx={ctx} className="hn-panel-top" only={compact ? ["paper"] : undefined} />
    </>
  );
}

export default defineFeature({
  id: "toolbar-classic",
  name: "Top bar",
  description: "Glass toolbar at the top centre of the page. (Choose the toolbar style above.)",
  optional: false,
  defaults: {},
  Overlay: Toolbar,
});
