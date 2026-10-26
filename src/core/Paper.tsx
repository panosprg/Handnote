import { forwardRef, useEffect, useImperativeHandle, useRef, useState } from "react";
import { useCtxState, type HandnoteContext } from "./context";
import { pageAt, pageRects, totalHeight, maxWidth, type PagesInfo } from "./pages";
import type { Template } from "./settings";
import { templateCss } from "./templates";
import { Icon } from "./ui";

export interface PaperHandle {
  /** Move the sheets to follow Excalidraw's scroll and zoom. */
  update(scrollX: number, scrollY: number, zoom: number): void;
}

/**
 * The paper: a desk with page sheets on it, drawn under the ink and moved in
 * step with Excalidraw's scroll/zoom. Templates (lines, grid, dots) are drawn
 * on each sheet in scene units, so they scale with the page.
 */
export const Paper = forwardRef<
  PaperHandle,
  { pages: PagesInfo; images?: (string | undefined)[]; template: Template; dark: boolean }
>(function Paper({ pages, images, template, dark }, ref) {
  const sheets = useRef<HTMLDivElement>(null);
  useImperativeHandle(ref, () => ({
    update(x, y, z) {
      if (sheets.current) sheets.current.style.transform = `translate(${x * z}px, ${y * z}px) scale(${z})`;
    },
  }));
  return (
    <div className="hn-desk">
      <div ref={sheets} className="hn-sheets">
        {pageRects(pages).map((r) => (
          <div
            key={r.index}
            className={`hn-sheet ${images?.[r.index] ? "hn-sheet-pdf" : ""}`}
            data-template={pages.sizes[r.index].template ?? template}
            style={{
              left: r.x,
              top: r.y,
              width: r.w,
              height: r.h,
              backgroundImage: images?.[r.index] ? "none" : templateCss(pages.sizes[r.index].template ?? template, r.w, r.h, dark),
            }}
          >
            {images?.[r.index] && <img className="hn-sheet-img" src={images[r.index]} alt="" draggable={false} />}
          </div>
        ))}
      </div>
    </div>
  );
});

/**
 * Things that sit on the pages but above the ink: the "add page" button under
 * the last page and the page counter.
 */
export function PagesUi({ ctx }: { ctx: HandnoteContext }) {
  const layer = useRef<HTMLDivElement>(null);
  const [page, setPage] = useState(0);
  const { pages } = useCtxState(ctx);

  useEffect(() => {
    const place = (x: number, y: number, z: number) => {
      if (layer.current) layer.current.style.transform = `translate(${x * z}px, ${y * z}px) scale(${z})`;
      const centreY = (ctx.root.clientHeight / 2) / z - y;
      setPage(pageAt(ctx.state.pages, centreY));
    };
    const st = ctx.api.getAppState();
    place(st.scrollX, st.scrollY, st.zoom.value);
    return ctx.events.on("scroll", place);
  }, [ctx, pages]);

  const bottom = totalHeight(pages);
  const w = maxWidth(pages);
  return (
    <>
      <div ref={layer} className="hn-sheets hn-sheets-ui">
        <button
          className="hn-add-page"
          style={{ left: w / 2 - 70, top: bottom + 18 }}
          onClick={() => ctx.addPage()}
          aria-label="Add page"
        >
          <Icon name="plus" /> Add page
        </button>
      </div>
      <div className="hn-page-counter" aria-live="polite">
        {page + 1} / {pages.sizes.length}
      </div>
    </>
  );
}

/** Zoom and scroll so the page width fits the screen, top of page 1 visible. */
export function fitWidth(pages: PagesInfo, viewportWidth: number) {
  const w = maxWidth(pages);
  const vw = viewportWidth || 800;
  // Same as the zoom-out limit (HandnoteContext.minZoom): the page fills the screen width.
  const z = Math.max(0.1, (vw - 48) / w);
  return { zoom: z, scrollX: (vw / z - w) / 2, scrollY: 24 / z };
}
