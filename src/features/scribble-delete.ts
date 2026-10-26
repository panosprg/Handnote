import { newElementWith } from "@excalidraw/excalidraw";
import type { El } from "../core/context";
import { defineFeature } from "../core/types";
import { findScribbleTargets, isScribble } from "./scribble-geometry";

/** A quick zig-zag over ink deletes that ink (and the zig-zag). */
export default defineFeature({
  id: "scribble-delete",
  name: "Scribble to delete",
  description: "Scribble a quick zig-zag over writing with the pen to delete it.",
  defaults: {},
  setup(ctx) {
    return ctx.events.on("strokeEnd", (stroke, tool) => {
      if (tool !== "pen" || !isScribble(stroke)) return;
      const all = ctx.elements();
      const targets = findScribbleTargets(stroke, all) as El[];
      if (!targets.length) return;
      ctx.events.emit("erased", targets, "scribble");
      const ids = new Set([stroke.id, ...targets.map((t) => t.id)]);
      ctx.replaceElements(
        ctx.elements(true).map((el) => (ids.has(el.id) ? (newElementWith(el as never, { isDeleted: true } as never) as unknown as El) : el)),
      );
    });
  },
});
