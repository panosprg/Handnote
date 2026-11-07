import { newElementWith } from "@excalidraw/excalidraw";
import type { El } from "../core/context";
import { defineFeature } from "../core/types";
import { scribbleDeletes } from "./scribble-geometry";

/** A quick zig-zag over ink deletes that ink (and the zig-zag). */
export default defineFeature({
  id: "scribble-delete",
  name: "Scribble to delete",
  description: "Scribble a quick zig-zag over writing with the pen to delete it.",
  defaults: {},
  setup(ctx) {
    return ctx.events.on("strokeEnd", (stroke, tool) => {
      if (!["pen", "ballpoint", "pencil"].includes(tool)) return;
      const targets = scribbleDeletes(stroke, ctx.elements()) as El[];
      if (!targets.length) return;
      ctx.events.emit("erased", targets, "scribble");
      const ids = new Set([stroke.id, ...targets.map((t) => t.id)]);
      ctx.replaceElements(
        ctx.elements(true).map((el) => (ids.has(el.id) ? (newElementWith(el as never, { isDeleted: true } as never) as unknown as El) : el)),
      );
      // Always say what was deleted, with Undo right there.
      ctx.toast(`Scribbled out ${targets.length} stroke${targets.length === 1 ? "" : "s"}`, {
        label: "Undo",
        // Two steps: bring the writing back, then remove the scribble itself.
        run: () => {
          ctx.undo();
          ctx.undo();
        },
      });
    });
  },
});
