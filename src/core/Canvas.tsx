import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { Excalidraw, getSceneVersion } from "@excalidraw/excalidraw";
import type { ExcalidrawImperativeAPI } from "@excalidraw/excalidraw/types";

import type { HandnoteFile } from "../data";
import { HandnoteContext, type El } from "./context";
import type { FeatureRegistry } from "./registry";
import { useSettings, type SettingsStore, type Template } from "./settings";
import { BALLPOINT_FILTER } from "./tools";
import { FeatureBoundary } from "./ui";

export interface CanvasProps {
  initial: HandnoteFile;
  store: SettingsStore;
  registry: FeatureRegistry;
  isDark: boolean;
  onReady(api: ExcalidrawImperativeAPI): void;
  onDirty(): void;
  onTemplateChange(t: Template): void;
}

const PAPER_SPACING: Record<Template, number> = { blank: 32, lined: 32, grid: 24, dots: 24 };

/**
 * The host: Excalidraw, the paper, and the feature lifecycle.
 * Features never need this file changed; they talk to HandnoteContext.
 */
export default function Canvas(props: CanvasProps) {
  const { initial, store, registry, isDark, onReady, onDirty, onTemplateChange } = props;
  const settings = useSettings(store);
  useSyncExternalStore(
    (l) => registry.events.on("changed", l),
    () => registry.all(),
  );

  const rootRef = useRef<HTMLDivElement>(null);
  const paperRef = useRef<HTMLDivElement>(null);
  const [api, setApi] = useState<ExcalidrawImperativeAPI | null>(null);
  const [ctx, setCtx] = useState<HandnoteContext | null>(null);
  const lastVersion = useRef(-1);
  const templateRef = useRef<Template>(initial.handnote.template);

  /* ---------- context ---------- */

  useEffect(() => {
    if (!api || !rootRef.current) return;
    const c = new HandnoteContext(api, rootRef.current, store, registry, { template: initial.handnote.template }, (t) => {
      templateRef.current = t;
      onTemplateChange(t);
    });
    setCtx(c);
    const offBallpoint = c.pen.addFilter(BALLPOINT_FILTER);
    c.tool("pen")!.activate(c);
    return () => {
      offBallpoint();
      c.destroy();
    };
  }, [api]);

  const subscribeUi = useCallback((l: () => void) => (ctx ? ctx.subscribe(l) : () => {}), [ctx]);
  const ui = useSyncExternalStore(subscribeUi, () => ctx?.state ?? null);

  /* ---------- paper ---------- */

  const updatePaper = useCallback((scrollX: number, scrollY: number, zoom: number) => {
    const el = paperRef.current;
    if (!el) return;
    const tpl = templateRef.current;
    const g = PAPER_SPACING[tpl] * zoom;
    el.style.backgroundSize = tpl === "lined" ? `100% ${g}px` : `${g}px ${g}px`;
    el.style.backgroundPosition = `${scrollX * zoom}px ${scrollY * zoom}px`;
  }, []);

  useLayoutEffect(() => {
    if (!api) return;
    templateRef.current = ui?.template ?? templateRef.current;
    const st = api.getAppState();
    updatePaper(st.scrollX, st.scrollY, st.zoom.value);
  }, [api, ui?.template, updatePaper]);

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
      }
    }
    // A tool from a feature that was switched off can't stay selected.
    if (!ctx.tool(ctx.state.tool)) ctx.setTool("pen");
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
      <div ref={paperRef} className="hn-paper" />
      <div className="hn-excalidraw">
        <Excalidraw
          excalidrawAPI={(a) => {
            setApi(a);
            onReady(a);
          }}
          initialData={{
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
                : {}),
            },
          }}
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
            updatePaper(x, y, zoom.value);
            ctx?.events.emit("scroll", x, y, zoom.value);
          }}
        />
      </div>
      {overlays}
    </div>
  );
}
