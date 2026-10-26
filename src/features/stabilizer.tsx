import { defineFeature } from "../core/types";
import { Stabilizer } from "./stabilizer-engine";

type S = { pen: number; highlighter: number };

/** Live stroke smoothing (see stabilizer-engine.ts for how it works). */
export default defineFeature<S>({
  id: "stabilizer",
  name: "Stroke stabilization",
  description: "Smooths out hand wobble while you write. Higher = smoother but slightly more lag.",
  defaults: { pen: 35, highlighter: 60 },
  settings: [
    { key: "pen", type: "slider", name: "Pen", min: 0, max: 100, step: 5 },
    { key: "highlighter", type: "slider", name: "Highlighter", min: 0, max: 100, step: 5 },
  ],
  setup(ctx, s) {
    const st = new Stabilizer(ctx.root, {
      levelForStroke: () => {
        if (ctx.api.getAppState().activeTool.type !== "freedraw") return 0;
        return ctx.state.tool === "highlighter" ? s().highlighter : s().pen;
      },
    });
    return () => st.destroy();
  },
  InkPanelSection({ ctx, settings }) {
    const key = ctx.inkTarget();
    const v = settings[key];
    return (
      <>
        <div className="hn-label">
          Stabilization <span className="hn-value">{v === 0 ? "Off" : v}</span>
        </div>
        <input
          className="hn-slider"
          type="range"
          min={0}
          max={100}
          step={5}
          value={v}
          onChange={(e) => ctx.updateFeatureSettings("stabilizer", { [key]: Number(e.target.value) })}
        />
      </>
    );
  },
});
