import { useEffect, useState } from "react";
import { getCommonBounds, newElementWith } from "@excalidraw/excalidraw";
import type { El, HandnoteContext } from "../core/context";
import { defineFeature } from "../core/types";
import { glassClass, Icon } from "../core/ui";
import "./links.css";

const linkOf = (e: El) => (typeof e.link === "string" && e.link ? (e.link as string) : null);
const label = (link: string) => link.replace(/^\[\[|\]\]$/g, "").split("|").pop()!.split("/").pop()!.replace(/\.(md|handnote)$/, "");

function setLink(ctx: HandnoteContext, ids: Set<string>, link: string | null) {
  ctx.replaceElements(
    ctx.elements(true).map((el) => (ids.has(el.id) ? (newElementWith(el as never, { link } as never) as unknown as El) : el)),
    "now",
  );
}

/** A chip on every linked piece of writing; tap it to open the note. */
function LinkChips({ ctx }: { ctx: HandnoteContext }) {
  const [chips, setChips] = useState<{ key: string; link: string; x: number; y: number }[]>([]);
  useEffect(() => {
    const update = () => {
      const groups = new Map<string, El[]>();
      for (const el of ctx.elements()) {
        const l = linkOf(el);
        if (!l) continue;
        // writing linked in one go shares the link and sits together
        const key = `${l}@${Math.round(el.y / 200)}`;
        groups.set(key, [...(groups.get(key) ?? []), el]);
      }
      setChips(
        [...groups.entries()].map(([key, els]) => {
          const [, y1, x2, y2] = getCommonBounds(els as never);
          const p = ctx.toScreen(x2, (y1 + y2) / 2);
          return { key, link: linkOf(els[0])!, x: p.x, y: p.y };
        }),
      );
    };
    update();
    const offs = [ctx.events.on("change", update), ctx.events.on("scroll", update)];
    return () => offs.forEach((o) => o());
  }, [ctx]);

  return (
    <>
      {chips.map((c) => (
        <button
          key={c.key}
          className={`hn-link-chip ${glassClass(ctx)}`}
          style={{ left: c.x + 8, top: c.y - 13 }}
          onPointerDown={(e) => e.stopPropagation()}
          onClick={() => ctx.host.openLink(c.link)}
          title={`Open ${label(c.link)}`}
        >
          <Icon name="link" />
          <span>{label(c.link)}</span>
        </button>
      ))}
    </>
  );
}

export default defineFeature({
  id: "links",
  name: "Links to notes",
  description: "Select some writing and link it to any note in your vault. A chip appears next to it; tap it to open the note.",
  defaults: {},
  selectionActions: [
    {
      id: "link",
      label: "Link to note",
      icon: "link",
      run: async (ctx, els) => {
        const link = await ctx.host.pickNote();
        if (link) setLink(ctx, new Set(els.map((e) => e.id)), link);
      },
    },
    {
      id: "unlink",
      label: "Remove link",
      icon: "unlink",
      when: (_ctx, els) => els.some(linkOf),
      run: (ctx, els) => setLink(ctx, new Set(els.map((e) => e.id)), null),
    },
  ],
  Overlay: LinkChips,
});
