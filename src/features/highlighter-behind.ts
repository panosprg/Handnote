import { mutateElement } from "@excalidraw/excalidraw";
import type { El } from "../core/context";
import { defineFeature } from "../core/types";

const TAG = "hl";

const isHighlight = (e: El) => (e.customData as { hn?: string } | undefined)?.hn === TAG;

/**
 * Highlighter strokes go *under* the writing, like real highlighter on paper,
 * so the text keeps its full dark colour instead of being tinted.
 *
 * The stroke is moved to the back as soon as it starts (not after), so it is
 * part of the same undo step as the stroke itself.
 */
export default defineFeature({
  id: "highlighter-behind",
  name: "Highlighter behind writing",
  description: "Highlights sit under your ink so the text stays dark and readable.",
  defaults: {},
  setup(ctx) {
    const done = new Set<string>();
    return ctx.events.on("change", (_els, appState) => {
      const fresh = appState.newElement as unknown as El | null;
      if (!fresh || fresh.type !== "freedraw" || ctx.state.tool !== "highlighter" || done.has(fresh.id)) return;
      done.add(fresh.id);
      queueMicrotask(() => {
        mutateElement(fresh as never, { customData: { ...(fresh.customData ?? {}), hn: TAG } } as never);
        const all = ctx.elements(true);
        const highlights = all.filter(isHighlight);
        const rest = all.filter((e) => !isHighlight(e));
        // "later" = folded into the stroke's own undo step when the stroke ends.
        ctx.replaceElements([...highlights, ...rest], "later");
      });
    });
  },
});
