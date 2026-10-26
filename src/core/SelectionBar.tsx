import { useEffect, useState } from "react";
import { getCommonBounds } from "@excalidraw/excalidraw";
import type { El, HandnoteContext } from "./context";
import type { SelectionAction } from "./types";
import { glassClass, Icon } from "./ui";

/**
 * A small glass bar above whatever is selected, with the actions features
 * offer for it (headings, links, maths…). Hidden while dragging.
 */
export function SelectionBar({ ctx, actions }: { ctx: HandnoteContext; actions: SelectionAction[] }) {
  const [sel, setSel] = useState<{ els: El[]; x: number; y: number } | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let down = false;
    const update = () => {
      const st = ctx.api.getAppState();
      if (down || st.selectedElementsAreBeingDragged || st.editingTextElement || ctx.state.modal) return setSel(null);
      const els = ctx.selected();
      if (!els.length) return setSel(null);
      const [x1, y1, x2] = getCommonBounds(els as never);
      const p = ctx.toScreen((x1 + x2) / 2, y1);
      setSel({ els, x: p.x, y: p.y });
    };
    const onDown = (e: PointerEvent) => {
      if ((e.target as HTMLElement)?.closest?.(".hn-selbar")) return; // tapping the bar itself
      down = true;
      setSel(null);
    };
    const onUp = () => {
      down = false;
      window.setTimeout(update, 30);
    };
    ctx.root.addEventListener("pointerdown", onDown, true);
    window.addEventListener("pointerup", onUp, true);
    const offs = [ctx.events.on("change", () => window.setTimeout(update, 0)), ctx.events.on("scroll", update), ctx.events.on("selectionMade", update)];
    return () => {
      ctx.root.removeEventListener("pointerdown", onDown, true);
      window.removeEventListener("pointerup", onUp, true);
      offs.forEach((o) => o());
    };
  }, [ctx]);

  if (!sel) return null;
  const shown = actions.filter((a) => !a.when || a.when(ctx, sel.els));
  if (!shown.length) return null;
  const top = Math.max(70, sel.y - 58);
  return (
    <div
      className={`hn-selbar ${glassClass(ctx)}`}
      style={{ left: Math.min(Math.max(sel.x, 160), ctx.root.clientWidth - 160), top }}
      onPointerDown={(e) => e.stopPropagation()}
    >
      {shown.map((a) => (
        <button
          key={a.id}
          className="hn-selbar-btn"
          disabled={busy}
          title={a.label}
          onClick={async () => {
            setBusy(true);
            try {
              await a.run(ctx, ctx.selected());
            } finally {
              setBusy(false);
            }
          }}
        >
          <Icon name={a.icon} />
          <span>{a.label}</span>
        </button>
      ))}
    </div>
  );
}
