import { useSyncExternalStore } from "react";
import { CaptureUpdateAction, mutateElement } from "@excalidraw/excalidraw";
import type { AppState, ExcalidrawImperativeAPI } from "@excalidraw/excalidraw/types";

import { Emitter } from "./emitter";
import type { FeatureRegistry } from "./registry";
import { INK_TOOLS, type CoreSettings, type HandnoteSettings, type InkToolId, type SettingsStore, type Template } from "./settings";
import { PenPipeline } from "./pen";
import { A4, maxWidth, pageAt, type PagesInfo } from "./pages";
import { CORE_TOOLS, TOOL_GROUPS } from "./tools";
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
  /** The notebook's pages */
  pages: PagesInfo;
  /** Background image per page (imported PDFs), as data URLs */
  pageImages: (string | undefined)[];
  /** Is the notebook saved? (the green/red dot) */
  saveStatus: "saved" | "unsaved" | "saving" | "error";
  saveError?: string;
}

/** Things only the Obsidian side can do (files, links), provided by the view. */
export interface HostActions {
  exportPdf(): Promise<void>;
  openLink(link: string): void;
  /** Ask the user to pick a note in the vault; resolves to its link text or null. */
  pickNote(): Promise<string | null>;
  /** HTTP request without browser CORS limits (Obsidian's requestUrl). */
  request(url: string, init: { method: string; headers: Record<string, string>; body: string }): Promise<{ status: number; text: string }>;
  /** vault path of this note */
  notePath(): string;
  /** Print the notebook (all pages, or 0-based page indexes). */
  print?(pages?: number[]): Promise<void>;
  /** Save right now (the saved dot). */
  saveNow?(): Promise<void>;
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
  /** Something was just selected (lasso, etc.). */
  selectionMade: [];
  /** The Pencil was held still at the start of a stroke (client coordinates). */
  penHold: [x: number, y: number];
}

/**
 * Everything a feature can see and do. One context per open note.
 */
export class HandnoteContext {
  readonly events = new Emitter<CtxEvents>();
  /** Every ink stroke passes through here; features add filters. */
  readonly pen: PenPipeline;
  /** Touches a feature has taken (e.g. the ruler): other gestures leave them alone. */
  readonly claimedTouches = new Set<number>();
  state: UiState;
  private unsub: () => void;

  constructor(
    readonly api: ExcalidrawImperativeAPI,
    readonly root: HTMLElement,
    readonly store: SettingsStore,
    readonly registry: FeatureRegistry,
    initial: { template: Template; pages: PagesInfo },
    private onTemplateChange: (t: Template) => void,
    private onPagesChange: (p: PagesInfo) => void,
    readonly host: HostActions,
  ) {
    this.state = {
      tool: "ballpoint",
      lastInk: "ballpoint",
      panel: null,
      template: initial.template,
      showNative: false,
      modal: false,
      pages: initial.pages,
      pageImages: [],
      saveStatus: "saved",
    };
    this.pen = new PenPipeline(this);
    // Re-apply ink settings when colours/sizes change anywhere.
    let lastCore = store.get().core;
    this.unsub = store.subscribe(() => {
      const core = store.get().core;
      if (INK_TOOLS.some((k) => core[k] !== lastCore[k]) && this.activeTool()?.ink) {
        this.activeTool()!.activate(this);
      }
      lastCore = core;
    });
  }

  destroy() {
    this.unsub();
    this.pen.destroy();
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

  /**
   * Tools as the toolbar and dial show them: a group (pen types, erasers) is one item,
   * standing for its last-used member, labelled with the group's name.
   */
  groupedTools(): (ToolDef & { member: string; key: string })[] {
    const out: (ToolDef & { member: string; key: string })[] = [];
    const seen = new Set<string>();
    for (const t of this.tools()) {
      if (!t.group) {
        out.push({ ...t, member: t.id, key: t.id });
        continue;
      }
      if (seen.has(t.group)) continue;
      seen.add(t.group);
      const members = this.tools().filter((m) => m.group === t.group);
      const activeMember = members.find((m) => m.id === this.state.tool);
      const last = members.find((m) => m.id === this.core.groupLast[t.group!]);
      const m = activeMember ?? last ?? members[0];
      const g = TOOL_GROUPS[t.group];
      out.push({ ...m, label: g?.label ?? m.label, icon: m.icon, member: m.id, key: `group:${t.group}` });
    }
    return out;
  }

  /** The other tools in the active tool's group (for its menu). */
  groupMembers(group: string): ToolDef[] {
    return this.tools().filter((t) => t.group === group);
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
    if (def.group && this.core.groupLast[def.group] !== id)
      this.store.updateCore({ groupLast: { ...this.core.groupLast, [def.group]: id } });
    this.setState({
      tool: id,
      lastInk: def.ink ? (id as InkToolId) : this.state.lastInk,
      panel: this.state.panel === "tool" ? null : this.state.panel,
    });
  }

  /** The ink tool colour edits apply to (current tool if ink, else the last ink tool). */
  inkTarget(): InkToolId {
    const t = this.state.tool as InkToolId;
    return INK_TOOLS.includes(t) ? t : this.state.lastInk;
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

  /* ---------- pages ---------- */

  setPages(pages: PagesInfo) {
    this.setState({ pages });
    this.onPagesChange(pages);
  }

  /** Adds a page after `index` (default: at the end), the same size and paper as its neighbour. */
  addPage(index = this.state.pages.sizes.length - 1) {
    const sizes = [...this.state.pages.sizes];
    const like = sizes[index] ?? A4;
    const tpl = (like as { template?: Template }).template;
    sizes.splice(index + 1, 0, { w: like.w, h: like.h, ...(tpl ? { template: tpl } : {}) });
    this.setPages({ sizes });
  }

  /** The paper of one page (its own, or the notebook's). */
  pageTemplate(index: number): Template {
    return this.state.pages.sizes[index]?.template ?? this.state.template;
  }

  /** Change the paper of one page, or of the whole notebook ("all" also clears per-page choices). */
  setPageTemplate(target: number | "all", t: Template) {
    if (target === "all") {
      const sizes = this.state.pages.sizes.map(({ w, h }) => ({ w, h }));
      if (sizes.some((s, i) => this.state.pages.sizes[i].template)) this.setPages({ sizes });
      this.setTemplate(t);
      return;
    }
    const sizes = this.state.pages.sizes.map((s, i) => {
      if (i !== target) return s;
      const { w, h } = s;
      return t === this.state.template ? { w, h } : { w, h, template: t };
    });
    this.setPages({ sizes });
  }

  /** The page in the middle of the screen (0-based). */
  currentPage(): number {
    const st = this.api.getAppState();
    return pageAt(this.state.pages, this.root.clientHeight / 2 / st.zoom.value - st.scrollY);
  }

  /** The furthest you can zoom out: the page fills the screen width (like Goodnotes). */
  minZoom(): number {
    const vw = this.root.clientWidth || 800;
    return Math.max(0.1, (vw - 48) / maxWidth(this.state.pages));
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

  /** Scene coordinates → client (event) coordinates. */
  toClient(sceneX: number, sceneY: number) {
    const p = this.toScreen(sceneX, sceneY);
    const rect = this.root.getBoundingClientRect();
    return { x: p.x + rect.left, y: p.y + rect.top };
  }

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

  /**
   * Rewrite a stroke's points (absolute scene coordinates). Used by pen filters
   * while the stroke is still being drawn, so the change is part of its undo step.
   */
  setStrokePoints(el: El, pts: [number, number][], pressures?: number[]) {
    if (pts.length < 2) return;
    const [ox, oy] = pts[0];
    const rel = pts.map(([x, y]) => [x - ox, y - oy] as [number, number]);
    const xs = rel.map((p) => p[0]);
    const ys = rel.map((p) => p[1]);
    mutateElement(el as never, {
      x: ox,
      y: oy,
      points: rel,
      // No pressures given: keep the stroke's own pressure mode (mouse strokes simulate it).
      pressures: pressures ?? (el.simulatePressure ? [] : rel.map(() => 0.5)),
      simulatePressure: pressures ? false : !!el.simulatePressure,
      width: Math.max(...xs) - Math.min(...xs),
      height: Math.max(...ys) - Math.min(...ys),
      lastCommittedPoint: rel[rel.length - 1],
    } as never);
  }

  /** Currently selected elements (not deleted). */
  selected(): El[] {
    const ids = this.api.getAppState().selectedElementIds;
    return this.elements().filter((e) => ids[e.id]);
  }

  /** Scroll so a scene point sits in the upper part of the screen. */
  scrollTo(sceneX: number, sceneY: number) {
    const st = this.api.getAppState();
    const z = st.zoom.value;
    this.api.updateScene({
      appState: { scrollX: this.root.clientWidth / 2 / z - sceneX, scrollY: this.root.clientHeight / 4 / z - sceneY },
      captureUpdate: CaptureUpdateAction.NEVER,
    });
  }

  /** A stroke's points in absolute scene coordinates. */
  strokePoints(el: El): [number, number][] {
    return (el.points ?? []).map(([x, y]) => [el.x + x, el.y + y]);
  }

  /**
   * Record everything that changed since `before` (a snapshot taken with
   * `elements(true)`) as ONE undo step. Use it after a gesture that updated the
   * scene live with `replaceElements(..., "later")`: Excalidraw ignores such
   * live changes when recording, so the scene is put back and re-applied at once.
   */
  commitFrom(before: El[]) {
    const after = this.elements(true);
    this.replaceElements(before, "later");
    this.replaceElements(after, "now");
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
