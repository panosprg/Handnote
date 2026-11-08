import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { CaptureUpdateAction, Excalidraw, getSceneVersion } from "@excalidraw/excalidraw";
import type { ExcalidrawImperativeAPI } from "@excalidraw/excalidraw/types";

import type { HandnoteFile } from "../data";
import { HandnoteContext, type El, type HostActions } from "./context";
import type { PagesInfo } from "./pages";
import { fitWidth, Paper, PagesUi, type PaperHandle } from "./Paper";
import { SelectionBar } from "./SelectionBar";
import type { FeatureRegistry } from "./registry";
import { useSettings, type SettingsStore, type Template } from "./settings";
import { FastView } from "./fast-view";
import { UnderLayer } from "./under-layer";
import { BALLPOINT_FILTER, DASH_FILTER, HIGHLIGHTER_FILTER } from "./tools";
import { FeatureBoundary, reportCrash, Toast } from "./ui";

export interface CanvasProps {
  initial: HandnoteFile;
  store: SettingsStore;
  registry: FeatureRegistry;
  isDark: boolean;
  /** Background images for the pages (imported PDFs), loaded after the note opens. */
  loadPageImages?: () => Promise<(string | undefined)[]>;
  /** Words on each PDF page (imported PDFs), loaded after the note opens. */
  loadPageText?: () => Promise<import("./pdf-text").PdfWord[][] | null>;
  onMetaChange?(meta: Record<string, unknown>): void;
  host: HostActions;
  onReady(api: ExcalidrawImperativeAPI, ctx: HandnoteContext | null): void;
  onDirty(): void;
  onTemplateChange(t: Template): void;
  onPagesChange(p: PagesInfo): void;
}

/**
 * The host: Excalidraw, the paper, and the feature lifecycle.
 * Features never need this file changed; they talk to HandnoteContext.
 */
export default function Canvas(props: CanvasProps) {
  const { initial, store, registry, isDark, onReady, onDirty, onTemplateChange, onPagesChange, host, loadPageImages, loadPageText, onMetaChange } =
    props;
  const settings = useSettings(store);
  useSyncExternalStore(
    (l) => registry.events.on("changed", l),
    () => registry.all(),
  );

  const rootRef = useRef<HTMLDivElement>(null);
  const paperRef = useRef<PaperHandle>(null);
  const [api, setApi] = useState<ExcalidrawImperativeAPI | null>(null);
  const [ctx, setCtx] = useState<HandnoteContext | null>(null);
  const lastVersion = useRef(-1);

  /* ---------- context ---------- */

  useEffect(() => {
    if (!api || !rootRef.current) return;
    const c = new HandnoteContext(
      api,
      rootRef.current,
      store,
      registry,
      { template: initial.handnote.template, pages: initial.handnote.pages, meta: initial.handnote.meta },
      onTemplateChange,
      onPagesChange,
      host,
      (m) => onMetaChange?.(m),
    );
    setCtx(c);
    onReady(api, c);
    loadPageImages?.().then((imgs) => c.setState({ pageImages: imgs }));
    loadPageText?.()
      .then((t) => t && c.setState({ pageText: t }))
      .catch((e) => console.warn("Handnote: no PDF text", e));
    const offBallpoint = c.pen.addFilter(BALLPOINT_FILTER);
    const offHighlighter = c.pen.addFilter(HIGHLIGHTER_FILTER);
    const offDash = c.pen.addFilter(DASH_FILTER);
    c.tool("ballpoint")!.activate(c);
    c.fastView = new FastView(c, (v) => paperRef.current?.update(v.scrollX, v.scrollY, v.zoom));
    c.underLayer = new UnderLayer(c);
    // Palm rejection: remember when the Pencil was last on (or hovering over) the screen.

    // Tapping the page closes an open menu (colours, paper). A Pencil tap that closes a menu
    // doesn't also draw a dot.
    const closeMenus = (e: PointerEvent) => {
      const panel = c.state.panel;
      if (!panel || panel === "outline") return;
      const t = e.target as HTMLElement | null;
      if (!t || t.tagName !== "CANVAS" || !c.root.contains(t)) return;
      c.setState({ panel: null });
      if (e.pointerType !== "touch") {
        e.stopImmediatePropagation();
        e.preventDefault();
      }
    };
    window.addEventListener("pointerdown", closeMenus, true);
    return () => {
      window.removeEventListener("pointerdown", closeMenus, true);
      c.fastView?.destroy();
      c.underLayer?.destroy();
      offBallpoint();
      offHighlighter();
      offDash();
      c.destroy();
    };
  }, [api]);

  const subscribeUi = useCallback((l: () => void) => (ctx ? ctx.subscribe(l) : () => {}), [ctx]);
  const ui = useSyncExternalStore(subscribeUi, () => ctx?.state ?? null);

  /* ---------- paper ---------- */

  const updatePaper = useCallback((scrollX: number, scrollY: number, zoom: number) => {
    paperRef.current?.update(scrollX, scrollY, zoom);
  }, []);

  useLayoutEffect(() => {
    if (!api) return;
    const st = api.getAppState();
    updatePaper(st.scrollX, st.scrollY, st.zoom.value);
  }, [api, ui?.pages, updatePaper]);

  /* ---------- core events: stroke end, object eraser ---------- */

  useEffect(() => {
    if (!ctx) return;
    const seen = new Set(ctx.elements().map((e) => e.id));
    let beforeErase: Map<string, El> | null = null;

    const offDown = ctx.api.onPointerDown((activeTool) => {
      if (activeTool.type === "eraser") beforeErase = new Map(ctx.elements().map((e) => [e.id, e]));
    });
    const offUp = ctx.api.onPointerUp((activeTool) => {
      const type = activeTool.type;
      window.setTimeout(() => {
        if (type === "freedraw") {
          const els = ctx.elements();
          const last = els[els.length - 1];
          if (last && last.type === "freedraw" && !seen.has(last.id)) {
            seen.add(last.id);
            ctx.events.emit("strokeEnd", last, ctx.state.tool);
          }
        } else if (type === "eraser" && beforeErase) {
          const now = new Set(ctx.elements().map((e) => e.id));
          const gone = [...beforeErase.values()].filter((e) => !now.has(e.id));
          beforeErase = null;
          if (gone.length) ctx.events.emit("erased", gone, "eraser");
        }
      }, 0);
    });
    return () => {
      offDown();
      offUp();
    };
  }, [ctx]);

  /* ---------- feature lifecycle ---------- */

  const enabled = registry.enabled(settings);
  const enabledKey = enabled.map((f) => f.id).join("|");

  useEffect(() => {
    if (!ctx) return;
    const cleanups: (() => void)[] = [];
    for (const f of registry.enabled(store.get())) {
      if (!f.setup) continue;
      try {
        const off = f.setup(ctx, () => ctx.featureSettings(f.id));
        if (off) cleanups.push(off);
      } catch (e) {
        console.error(`Handnote: feature "${f.id}" failed to start`, e);
        reportCrash(f.id, e);
      }
    }
    // A tool from a feature that was switched off can't stay selected.
    if (!ctx.tool(ctx.state.tool)) ctx.setTool("ballpoint");
    return () => cleanups.forEach((c) => c());
  }, [ctx, enabledKey]);

  const overlays = useMemo(
    () =>
      ctx
        ? enabled
            .filter((f) => f.Overlay)
            .map((f) => {
              const O = f.Overlay!;
              return (
                <FeatureBoundary key={f.id} id={f.id}>
                  <O ctx={ctx} settings={registry.settingsOf(f, settings)} />
                </FeatureBoundary>
              );
            })
        : null,
    [ctx, settings, enabledKey],
  );

  /* ---------- render ---------- */

  const template = ui?.template ?? initial.handnote.template;
  const cls = [
    "hn-root",
    `hn-tpl-${template}`,
    isDark ? "hn-dark" : "hn-light",
    ui?.showNative ? "hn-native" : "",
  ].join(" ");

  return (
    <div ref={rootRef} className={cls}>
      <Paper
        ref={paperRef}
        pages={ui?.pages ?? initial.handnote.pages}
        images={ui?.pageImages}
        template={template}
        dark={isDark}
      />
      <div className="hn-excalidraw">
        <Excalidraw
          excalidrawAPI={(a) => {
            setApi(a);
            onReady(a, null);
          }}
          initialData={async () => ({
            elements: initial.elements as never,
            files: initial.files as never,
            appState: {
              viewBackgroundColor: "transparent",
              penMode: true,
              currentItemRoughness: 0,
              ...(initial.handnote.scrollX !== undefined
                ? {
                    scrollX: initial.handnote.scrollX,
                    scrollY: initial.handnote.scrollY,
                    zoom: { value: (initial.handnote.zoom ?? 1) as never },
                  }
                : (() => {
                    // New notebook: fit the page width to the screen.
                    const f = fitWidth(initial.handnote.pages, rootRef.current?.clientWidth ?? 800);
                    return { scrollX: f.scrollX, scrollY: f.scrollY, zoom: { value: f.zoom as never } };
                  })()),
            },
          })}
          theme={isDark ? "dark" : "light"}
          UIOptions={{
            canvasActions: {
              changeViewBackgroundColor: false,
              clearCanvas: true,
              export: false,
              loadScene: false,
              saveToActiveFile: false,
              saveAsImage: true,
              toggleTheme: null,
            },
          }}
          onChange={(elements, appState) => {
            ctx?.events.emit("change", elements as unknown as El[], appState);
            const v = getSceneVersion(elements);
            if (lastVersion.current === -1) {
              lastVersion.current = v;
              return;
            }
            if (v !== lastVersion.current) {
              lastVersion.current = v;
              onDirty();
            }
          }}
          onScrollChange={(x, y, zoom) => {
            // Keep the notebook on screen (also for wheel/keyboard zoom, outline jumps, the hand tool).
            if (ctx) {
              const want = ctx.clampView({ zoom: zoom.value, scrollX: x, scrollY: y }, !ctx.fastView?.active);
              if (Math.abs(want.zoom - zoom.value) > 1e-3 || Math.abs(want.scrollX - x) > 0.5 || Math.abs(want.scrollY - y) > 0.5)
                queueMicrotask(() =>
                  ctx.api.updateScene({
                    appState: { zoom: { value: want.zoom as never }, scrollX: want.scrollX, scrollY: want.scrollY },
                    captureUpdate: CaptureUpdateAction.NEVER,
                  }),
                );
            }
            updatePaper(x, y, zoom.value);
            ctx?.events.emit("scroll", x, y, zoom.value);
          }}
        />
      </div>
      {ctx && <PagesUi ctx={ctx} />}
      {ctx && <Toast ctx={ctx} />}
      {ctx && <SelectionBar ctx={ctx} actions={enabled.flatMap((f) => f.selectionActions ?? [])} />}
      {overlays}
    </div>
  );
}
