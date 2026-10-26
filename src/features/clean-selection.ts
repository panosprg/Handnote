import { CaptureUpdateAction, newElementWith } from "@excalidraw/excalidraw";
import type { El } from "../core/context";
import { defineFeature } from "../core/types";

/** Prefix of the temporary groups. The view strips these when saving. */
export const TEMP_GROUP_PREFIX = "hn-sel-";

/**
 * Excalidraw draws a box around every selected stroke. When several things are
 * selected, Handnote puts them in a temporary group so there is one simple
 * outline around the whole selection. The group disappears when the selection
 * changes and is never saved.
 */
export default defineFeature({
  id: "clean-selection",
  name: "Simple selection outline",
  description: "One outline around everything you select, instead of a box on every stroke.",
  defaults: {},
  setup(ctx) {
    let temp: { gid: string; ids: Set<string> } | null = null;
    let pointerDown = false;
    let queued = false;

    const regroup = (ids: Set<string>, add: string | null, remove: string | null) =>
      ctx.elements(true).map((el) => {
        if (!ids.has(el.id)) return el;
        let groups = (el.groupIds as string[]).filter((g) => g !== remove);
        if (add) groups = [...groups, add];
        return newElementWith(el as never, { groupIds: groups } as never) as unknown as El;
      });

    const ungroup = () => {
      if (!temp) return;
      const t = temp;
      temp = null;
      ctx.replaceElements(regroup(t.ids, null, t.gid), "never");
    };

    const check = () => {
      queued = false;
      if (pointerDown) return;
      const st = ctx.api.getAppState();
      if (st.selectionElement || st.selectedElementsAreBeingDragged || st.editingTextElement) return;
      const ids = new Set(Object.keys(st.selectedElementIds).filter((k) => st.selectedElementIds[k]));

      if (temp) {
        const same = ids.size === temp.ids.size && [...ids].every((i) => temp!.ids.has(i));
        if (same) return;
        ungroup();
      }
      if (ids.size < 2) return;
      // Already one real group? Excalidraw shows it as one outline anyway.
      const els = ctx.elements().filter((e) => ids.has(e.id));
      const shared = (els[0]?.groupIds as string[] | undefined)?.find((g) => els.every((e) => (e.groupIds as string[]).includes(g)));
      if (shared) return;

      const gid = TEMP_GROUP_PREFIX + Math.random().toString(36).slice(2, 10);
      temp = { gid, ids };
      ctx.replaceElements(regroup(ids, gid, null), "never");
      ctx.api.updateScene({
        appState: { selectedGroupIds: { [gid]: true }, editingGroupId: null },
        captureUpdate: CaptureUpdateAction.NEVER,
      });
    };

    const schedule = () => {
      if (queued) return;
      queued = true;
      queueMicrotask(check);
    };

    const down = () => (pointerDown = true);
    const up = () => {
      pointerDown = false;
      window.setTimeout(schedule, 0);
    };
    ctx.root.addEventListener("pointerdown", down, true);
    window.addEventListener("pointerup", up, true);
    const offChange = ctx.events.on("change", schedule);
    const offLasso = ctx.events.on("selectionMade", schedule);
    return () => {
      ungroup();
      ctx.root.removeEventListener("pointerdown", down, true);
      window.removeEventListener("pointerup", up, true);
      offChange();
      offLasso();
    };
  },
});
