import { useSyncExternalStore } from "react";
import { CaptureUpdateAction } from "@excalidraw/excalidraw";
import type { AppState, ExcalidrawImperativeAPI } from "@excalidraw/excalidraw/types";

import { Emitter } from "./emitter";
import type { FeatureRegistry } from "./registry";
import type { CoreSettings, HandnoteSettings, InkToolId, SettingsStore, Template } from "./settings";
import { CORE_TOOLS } from "./tools";
import type { ToolDef } from "./types";

/** Loose element type: features only touch the fields they need. */
export type El = {
  id: string;
  type: string;
  x: number;
  y: number;
  width: number;
  height: number;
  angle: number;
  isDeleted: boolean;
  strokeColor: string;
  strokeWidth: number;
  opacity: number;
  points?: readonly (readonly [number, number])[];
  pressures?: readonly number[];
  customData?: Record<string, unknown>;
  [key: string]: unknown;
};

export interface UiState {
  tool: string;
  lastInk: InkToolId;
  /** "tool" = the active tool's own panel, or any feature-defined name */
  panel: string | null;
  template: Template;
  /** Excalidraw's own shape/text toolbar is visible */
  showNative: boolean;
  /** A menu is open over the page: gestures should stand down */
  modal: boolean;
}

export interface CtxEvents extends Record<string, unknown[]> {
  state: [];
  /** A pen or highlighter stroke was finished. */
  strokeEnd: [el: El, toolId: string];
  /** Elements are being removed; effects may animate them. */
  erased: [els: El[], reason: "eraser" | "scribble" | "precision"];
  /** Excalidraw onChange (fires a lot: keep handlers cheap). */
  change: [elements: readonly El[], appState: AppState];
  scroll: [scrollX: number, scrollY: number, zoom: number];
}

/**
 * Everything a feature can see and do. One context per open note.
 */
export class HandnoteContext {
  readonly events = new Emitter<CtxEvents>();
  state: UiState;
  private unsub: () => void;

  constructor(
    readonly api: ExcalidrawImperativeAPI,
    readonly root: HTMLElement,
    readonly store: SettingsStore,
    readonly registry: FeatureRegistry,
    initial: { template: Template },
    private onTemplateChange: (t: Template) => void,
  ) {
    this.state = {
      tool: "pen",
      lastInk: "pen",
      panel: null,
      template: initial.template,
      showNative: false,
      modal: false,
    };
    // Re-apply ink settings when colours/sizes change anywhere.
    let lastCore = store.get().core;
    this.unsub = store.subscribe(() => {
      const core = store.get().core;
      if ((core.pen !== lastCore.pen || core.highlighter !== lastCore.highlighter) && this.activeTool()?.ink) {
        this.activeTool()!.activate(this);
      }
      lastCore = core;
    });
  }

  destroy() {
    this.unsub();
  }

  /* ---------- settings ---------- */

  get settings(): HandnoteSettings {
    return this.store.get();
  }

  get core(): CoreSettings {
    return this.store.get().core;
  }

  isEnabled(featureId: string): boolean {
    const f = this.registry.get(featureId);
    return !!f && this.registry.isEnabled(f, this.settings);
  }

  featureSettings<S>(featureId: string): S {
    const f = this.registry.get(featureId);
    return f ? this.registry.settingsOf<S>(f, this.settings) : ({} as S);
  }

  updateFeatureSettings(featureId: string, patch: Record<string, unknown>) {
    this.store.updateFeature(featureId, patch);
  }

  /* ---------- UI state ---------- */

  setState(patch: Partial<UiState>) {
    this.state = { ...this.state, ...patch };
    this.events.emit("state");
  }

  subscribe = (l: () => void) => this.events.on("state", l);

  togglePanel(name: string) {
    this.setState({ panel: this.state.panel === name ? null : name });
  }

  /* ---------- tools ---------- */

  tools(): ToolDef[] {
    const extra = this.registry.enabled(this.settings).flatMap((f) => f.tools ?? []);
    return [...CORE_TOOLS, ...extra].sort((a, b) => a.order - b.order);
  }

  tool(id: string): ToolDef | undefined {
    return this.tools().find((t) => t.id === id);
  }

  activeTool(): ToolDef | undefined {
    return this.tool(this.state.tool);
  }

  setTool(id: string) {
    const def = this.tool(id);
    if (!def) return;
    if (id === this.state.tool && this.state.panel !== "tool") {
      // Tapping the active tool again opens its panel (if it has one).
      if (def.Panel) this.setState({ panel: "tool" });
      def.activate(this);
      return;
    }
    def.activate(this);
    this.setState({
      tool: id,
      lastInk: def.ink ? (id as InkToolId) : this.state.lastInk,
      panel: this.state.panel === "tool" ? null : this.state.panel,
    });
  }

  /** The ink tool colour edits apply to (current tool if ink, else the last ink tool). */
  inkTarget(): InkToolId {
    const t = this.state.tool;
    return t === "pen" || t === "highlighter" ? t : this.state.lastInk;
  }

  setInkColor(color: string) {
    const target = this.inkTarget();
    if (this.state.tool !== target) this.setTool(target);
    this.store.updateCore({ [target]: { ...this.core[target], color } } as Partial<CoreSettings>);
  }

  /* ---------- paper ---------- */

  setTemplate(t: Template) {
    this.setState({ template: t });
    this.onTemplateChange(t);
  }

  /* ---------- history ---------- */

  undo() {
    this.sendHistoryKey(false);
  }

  redo() {
    this.sendHistoryKey(true);
  }

  private sendHistoryKey(redo: boolean) {
    const target = this.root.querySelector(".excalidraw") ?? this.root;
    target.dispatchEvent(
      new KeyboardEvent("keydown", {
        key: redo ? "Z" : "z",
        code: "KeyZ",
        ctrlKey: true,
        metaKey: true,
        shiftKey: redo,
        bubbles: true,
        cancelable: true,
      }),
    );
  }

  /* ---------- geometry ---------- */

  /** Scene coordinates → pixels relative to the page's top-left corner. */
  toScreen(sceneX: number, sceneY: number) {
    const st = this.api.getAppState();
    return { x: (sceneX + st.scrollX) * st.zoom.value, y: (sceneY + st.scrollY) * st.zoom.value };
  }

  /** Client (event) coordinates → scene coordinates. */
  toScene(clientX: number, clientY: number) {
    const st = this.api.getAppState();
    const rect = this.root.getBoundingClientRect();
    return {
      x: (clientX - rect.left) / st.zoom.value - st.scrollX,
      y: (clientY - rect.top) / st.zoom.value - st.scrollY,
    };
  }

  /* ---------- elements ---------- */

  elements(includeDeleted = false): El[] {
    return (includeDeleted ? this.api.getSceneElementsIncludingDeleted() : this.api.getSceneElements()) as unknown as El[];
  }

  replaceElements(elements: El[], capture: "now" | "later" | "never" = "now") {
    this.api.updateScene({
      elements: elements as never,
      captureUpdate:
        capture === "now"
          ? CaptureUpdateAction.IMMEDIATELY
          : capture === "later"
            ? CaptureUpdateAction.EVENTUALLY
            : CaptureUpdateAction.NEVER,
    });
  }
}

export function useCtxState(ctx: HandnoteContext): UiState {
  return useSyncExternalStore(ctx.subscribe, () => ctx.state);
}
