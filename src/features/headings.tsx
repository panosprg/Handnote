import { useEffect, useMemo, useState } from "react";
import { exportToSvg, getCommonBounds, newElementWith } from "@excalidraw/excalidraw";
import { Notice } from "obsidian";
import { useCtxState, type El, type HandnoteContext } from "../core/context";
import { pageAt } from "../core/pages";
import { defineFeature } from "../core/types";
import { glassClass, Icon } from "../core/ui";
import { recognitionReady, recognize } from "./recognition";
import "./headings.css";

type S = { recognize: boolean };
type HeadingData = { id: string; level: 1 | 2 | 3; text?: string };

const headingOf = (e: El) => (e.customData as { hnHeading?: HeadingData } | undefined)?.hnHeading;

function setHeading(ctx: HandnoteContext, ids: Set<string>, data: HeadingData | null) {
  ctx.replaceElements(
    ctx.elements(true).map((el) => {
      if (!ids.has(el.id)) return el;
      const { hnHeading: _old, ...rest } = (el.customData ?? {}) as Record<string, unknown>;
      return newElementWith(el as never, { customData: data ? { ...rest, hnHeading: data } : rest } as never) as unknown as El;
    }),
    "now",
  );
}

const LEVELS: { level: 1 | 2 | 3; label: string; icon: string }[] = [
  { level: 1, label: "Title", icon: "heading-1" },
  { level: 2, label: "Subtitle", icon: "heading-2" },
  { level: 3, label: "Heading 3", icon: "heading-3" },
];

interface Entry {
  id: string;
  level: number;
  text?: string;
  els: El[];
  x: number;
  y: number;
  page: number;
}

function Snapshot({ ctx, els }: { ctx: HandnoteContext; els: El[] }) {
  const [src, setSrc] = useState<string | null>(null);
  const key = els.map((e) => `${e.id}:${e.version}`).join("|");
  useEffect(() => {
    let off = false;
    exportToSvg({
      elements: els as never,
      appState: { exportBackground: false, exportWithDarkMode: false } as never,
      files: ctx.api.getFiles(),
      exportPadding: 4,
    }).then((svg: SVGSVGElement) => !off && setSrc(`data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg.outerHTML)}`));
    return () => {
      off = true;
    };
  }, [key]);
  return src ? <img className="hn-outline-snap" src={src} alt="" /> : <span className="hn-outline-snap" />;
}

function Outline({ ctx }: { ctx: HandnoteContext }) {
  const ui = useCtxState(ctx);
  const [version, setVersion] = useState(0);
  useEffect(() => ctx.events.on("change", () => setVersion((v) => v + 1)), [ctx]);

  const entries: Entry[] = useMemo(() => {
    const groups = new Map<string, { data: HeadingData; els: El[] }>();
    for (const el of ctx.elements()) {
      const h = headingOf(el);
      if (!h) continue;
      const g = groups.get(h.id) ?? { data: h, els: [] };
      g.els.push(el);
      groups.set(h.id, g);
    }
    return [...groups.values()]
      .map(({ data, els }) => {
        const [x1, y1] = getCommonBounds(els as never);
        return { id: data.id, level: data.level, text: data.text, els, x: x1, y: y1, page: pageAt(ui.pages, y1) };
      })
      .sort((a, b) => a.y - b.y || a.x - b.x);
  }, [version, ui.pages, ui.panel]);

  if (ui.panel !== "outline") return null;
  return (
    <div className={`hn-outline ${glassClass(ctx)}`} onPointerDown={(e) => e.stopPropagation()}>
      <div className="hn-outline-head">
        <span>Outline</span>
        <button className="hn-link" onClick={() => ctx.setState({ panel: null })}>
          Done
        </button>
      </div>
      {!entries.length && (
        <div className="hn-outline-empty">
          Select some handwriting with the lasso and choose Title, Subtitle or Heading 3. It will show up here.
        </div>
      )}
      {entries.map((e) => (
        <button key={e.id} className={`hn-outline-item hn-level-${e.level}`} onClick={() => ctx.scrollTo(e.x, e.y)}>
          {e.text ? <span className="hn-outline-text">{e.text}</span> : <Snapshot ctx={ctx} els={e.els} />}
          <span className="hn-outline-page">p. {e.page + 1}</span>
        </button>
      ))}
    </div>
  );
}

export default defineFeature<S>({
  id: "headings",
  name: "Handwritten headings and outline",
  description:
    "Lasso some handwriting and mark it as a title, subtitle or heading. The outline lists them all; tap one to jump there. With recognition set up, headings also show as typed text.",
  defaults: { recognize: true },
  settings: [{ key: "recognize", type: "toggle", name: "Turn headings into text (uses handwriting recognition)" }],
  toolbarButtons: [
    {
      id: "outline",
      label: "Outline",
      icon: "list-tree",
      onClick: (ctx) => ctx.togglePanel("outline"),
      active: (ctx) => ctx.state.panel === "outline",
    },
  ],
  selectionActions: [
    ...LEVELS.map((l) => ({
      id: `heading-${l.level}`,
      label: l.label,
      icon: l.icon,
      when: (_ctx: HandnoteContext, els: El[]) => els.some((e) => e.type === "freedraw" || e.type === "text") && !els.some(headingOf),
      run: async (ctx: HandnoteContext, els: El[]) => {
        const data: HeadingData = { id: Math.random().toString(36).slice(2, 10), level: l.level };
        const ids = new Set(els.map((e) => e.id));
        setHeading(ctx, ids, data);
        const s = ctx.featureSettings<S>("headings");
        if (!s.recognize || !recognitionReady(ctx)) return;
        try {
          const typed = els.filter((e) => e.type === "text").map((e) => String(e.text ?? "")).join(" ");
          const text = typed || (await recognize(ctx, els, "Text"));
          if (text) setHeading(ctx, ids, { ...data, text: text.replace(/\s+/g, " ") });
        } catch (err) {
          new Notice(`Handnote: couldn't read the heading (${(err as Error).message}). It's saved as handwriting.`);
        }
      },
    })),
    {
      id: "heading-remove",
      label: "Not a heading",
      icon: "heading",
      when: (_ctx, els) => els.some(headingOf),
      run: (ctx, els) => setHeading(ctx, new Set(els.map((e) => e.id)), null),
    },
  ],
  Overlay: Outline,
});
