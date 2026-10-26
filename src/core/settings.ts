import { useSyncExternalStore } from "react";

export type Template =
  | "blank"
  | "lined"
  | "grid"
  | "dots"
  | "cornell"
  | "lecture"
  | "twocol"
  | "mindmap"
  | "revision"
  | "isometric";
export const TEMPLATES: { id: Template; name: string }[] = [
  { id: "blank", name: "Blank" },
  { id: "lined", name: "Lined" },
  { id: "grid", name: "Grid" },
  { id: "dots", name: "Dots" },
  { id: "cornell", name: "Cornell" },
  { id: "lecture", name: "Lecture" },
  { id: "twocol", name: "Lines + grid" },
  { id: "revision", name: "Revision" },
  { id: "mindmap", name: "Mind map" },
  { id: "isometric", name: "Isometric" },
];
export const isTemplate = (t: unknown): t is Template => TEMPLATES.some((x) => x.id === t);

export type InkToolId = "pen" | "ballpoint" | "pencil" | "highlighter" | "dotted" | "dashed";
export const INK_TOOLS: InkToolId[] = ["pen", "ballpoint", "pencil", "highlighter", "dotted", "dashed"];
/** The pen types behind the one "Pen" button (its Line options). */
export const PEN_TYPES: { id: InkToolId; name: string }[] = [
  { id: "ballpoint", name: "Ballpoint" },
  { id: "pen", name: "Fountain" },
  { id: "dotted", name: "Dotted" },
  { id: "dashed", name: "Dashed" },
];
/** Drawn as an Excalidraw line with a dotted/dashed stroke (not freehand ink). */
export const isDashTool = (t: string): t is "dotted" | "dashed" => t === "dotted" || t === "dashed";
export const MAX_PINNED = 3;

export interface InkConfig {
  color: string;
  width: number;
  opacity: number;
}

export interface CoreSettings {
  notesFolder: string;
  quickNotesFolder: string;
  defaultTemplate: Template;
  reduceTransparency: boolean;
  /** Draw the stroke being written on its own canvas (much less lag). */
  fastInk: boolean;
  /** Fountain pen: line width follows Pencil pressure */
  pen: InkConfig;
  /** Even line width, like a ballpoint */
  ballpoint: InkConfig;
  pencil: InkConfig;
  highlighter: InkConfig;
  dotted: InkConfig;
  dashed: InkConfig;
  /** Favourite colours, shared by every tool */
  favourites: string[];
  /** Sizes pinned to the second bar, per tool (mm for pens, px for erasers), at most MAX_PINNED. */
  pinned: Record<string, number[]>;
  /** Last pen type / eraser type used behind a grouped button ("pen" → "ballpoint"…). */
  groupLast: Record<string, string>;
  /** Top bar layout: button order and hidden buttons (ids of toolbar items). */
  toolbar: { order: string[]; hidden: string[] };
}

/** Everything saved in data.json. Bump SETTINGS_VERSION and add a migration when the shape changes. */
export interface HandnoteSettings {
  version: number;
  core: CoreSettings;
  /** Per-feature settings, keyed by feature id. `enabled` is always present. */
  features: Record<string, Record<string, unknown> & { enabled?: boolean }>;
}

export const SETTINGS_VERSION = 3;

export const DEFAULT_CORE: CoreSettings = {
  notesFolder: "Handwritten",
  quickNotesFolder: "Quick Notes",
  defaultTemplate: "lined",
  reduceTransparency: false,
  fastInk: true,
  pen: { color: "#1e1e1e", width: 1, opacity: 100 },
  ballpoint: { color: "#1e1e1e", width: 1, opacity: 100 },
  pencil: { color: "#4a4a52", width: 0.5, opacity: 75 },
  highlighter: { color: "#ffe066", width: 6, opacity: 45 },
  dotted: { color: "#1e1e1e", width: 2.2, opacity: 100 },
  dashed: { color: "#1e1e1e", width: 2.2, opacity: 100 },
  favourites: ["#1e1e1e", "#1971c2", "#e03131", "#2f9e44"],
  pinned: {
    ballpoint: [0.5, 0.7, 1],
    pen: [0.5, 0.7, 1],
    pencil: [0.3, 0.5, 0.7],
    dotted: [0.5, 0.7, 1],
    dashed: [0.5, 0.7, 1],
    highlighter: [3, 5, 8],
    "precision-eraser": [8, 14, 22],
    "object-eraser": [8, 14, 22],
  },
  groupLast: { pen: "ballpoint", eraser: "precision-eraser" },
  toolbar: { order: [], hidden: [] },
};

/** 9 hues, 4 shades each (dark → light). */
export const PALETTE: { name: string; shades: string[] }[] = [
  { name: "Ink", shades: ["#1e1e1e", "#495057", "#868e96", "#ced4da"] },
  { name: "Blue", shades: ["#0b3d91", "#1971c2", "#4dabf7", "#a5d8ff"] },
  { name: "Red", shades: ["#8f1d1d", "#e03131", "#ff6b6b", "#ffc9c9"] },
  { name: "Green", shades: ["#1b5e20", "#2f9e44", "#69db7c", "#b2f2bb"] },
  { name: "Orange", shades: ["#a84300", "#f08c00", "#ffa94d", "#ffd8a8"] },
  { name: "Yellow", shades: ["#e67700", "#fab005", "#ffe066", "#fff3bf"] },
  { name: "Purple", shades: ["#4a148c", "#7048e8", "#9775fa", "#d0bfff"] },
  { name: "Pink", shades: ["#a61e4d", "#e64980", "#f783ac", "#fcc2d7"] },
  { name: "Teal", shades: ["#0b7285", "#1098ad", "#3bc9db", "#99e9f2"] },
];

export const PEN_WIDTHS = [0.5, 1, 1.5, 2.5];
export const HIGHLIGHTER_WIDTHS = [4, 6, 9];

/* ---------- Sizes in millimetres ----------
 * Pages are real A4 at 96 px per inch, so a millimetre on the page is a millimetre
 * on paper when printed or exported. Excalidraw draws a freedraw line
 * strokeWidth × 4.25 × 2 × sin(t·π/2) px thick, with t = 0.5 − 0.6 × (0.5 − pressure)
 * (perfect-freehand). Sizes are shown at the tool's typical pressure.
 */
export const PX_PER_MM = 96 / 25.4;
const typicalPressure = (tool: InkToolId) => (tool === "ballpoint" ? 0.6 : 0.5);
const pxPerWidth = (tool: InkToolId) => 8.5 * Math.sin(((0.5 - 0.6 * (0.5 - typicalPressure(tool))) * Math.PI) / 2);
/* Dotted/dashed are Excalidraw lines: drawn strokeWidth + 0.5 px thick. */
export const widthToMm = (tool: InkToolId, width: number) =>
  isDashTool(tool) ? (width + 0.5) / PX_PER_MM : (width * pxPerWidth(tool)) / PX_PER_MM;
export const mmToWidth = (tool: InkToolId, mm: number) =>
  isDashTool(tool) ? Math.max(0.3, mm * PX_PER_MM - 0.5) : (mm * PX_PER_MM) / pxPerWidth(tool);
/** How thick the line is on screen (px) at a zoom. */
export const inkPx = (tool: InkToolId, width: number, zoom: number) => widthToMm(tool, width) * PX_PER_MM * zoom;
/** Quick sizes (mm) for the top bar and the panel. */
export const MM_PRESETS: Record<InkToolId, number[]> = {
  pen: [0.3, 0.5, 0.7, 1, 1.5, 2],
  ballpoint: [0.3, 0.5, 0.7, 1, 1.5, 2],
  pencil: [0.3, 0.5, 0.7, 1, 1.5, 2],
  dotted: [0.3, 0.5, 0.7, 1, 1.5, 2],
  dashed: [0.3, 0.5, 0.7, 1, 1.5, 2],
  highlighter: [2, 3, 5, 8, 12],
};
/** Range of the size slider (mm). */
export const MM_RANGE: Record<InkToolId, { min: number; max: number; step: number }> = {
  pen: { min: 0.1, max: 5, step: 0.05 },
  ballpoint: { min: 0.1, max: 5, step: 0.05 },
  pencil: { min: 0.1, max: 5, step: 0.05 },
  dotted: { min: 0.2, max: 5, step: 0.05 },
  dashed: { min: 0.2, max: 5, step: 0.05 },
  highlighter: { min: 1, max: 15, step: 0.5 },
};
export const sameMm = (a: number, b: number) => Math.abs(a - b) < 0.005;
export const formatMm = (mm: number) => `${mm < 1 ? mm.toFixed(2).replace(/0$/, "") : mm.toFixed(1).replace(/\.0$/, "")} mm`;
export const MAX_FAVOURITES = 8;

/* ------------------------------------------------------------------ */
/* Migrations: one function per version step. Never edit an old one. */
/* ------------------------------------------------------------------ */

type Raw = Record<string, any>;

const MIGRATIONS: Record<number, (s: Raw) => Raw> = {
  // 0.3: one stabilization slider for all pens; the curved palette is gone.
  2: (s) => {
    const stab = s.features?.stabilizer ?? {};
    const { pen, ...rest } = stab;
    return {
      ...s,
      version: 3,
      features: { ...(s.features ?? {}), stabilizer: { ...rest, ...(pen !== undefined ? { writing: pen } : {}) } },
    };
  },
  // v1 (Handnote 0.1) was a flat object.
  1: (old) => ({
    version: 2,
    core: {
      notesFolder: old.notesFolder,
      quickNotesFolder: old.quickNotesFolder,
      defaultTemplate: old.defaultTemplate,
      reduceTransparency: old.reduceTransparency,
      favourites: old.favourites,
      pen: old.pen && { color: old.pen.color, width: old.pen.width, opacity: old.pen.opacity },
      highlighter: old.highlighter && {
        color: old.highlighter.color,
        width: old.highlighter.width,
        opacity: old.highlighter.opacity,
      },
    },
    features: {
      stabilizer: { pen: old.pen?.stabilization, highlighter: old.highlighter?.stabilization },
      "scribble-delete": { enabled: old.scribbleToDelete },
      "radial-menu": { enabled: old.longPressMenu, delay: old.longPressMs },
      gestures: { twoFingerUndo: old.twoFingerUndo },
    },
  }),
};

function stripUndefined<T extends Raw>(o: T): T {
  const out: Raw = {};
  for (const [k, v] of Object.entries(o ?? {})) {
    if (v === undefined) continue;
    out[k] = v && typeof v === "object" && !Array.isArray(v) ? stripUndefined(v) : v;
  }
  return out as T;
}

export function loadSettings(raw: Raw | null): HandnoteSettings {
  let s: Raw = raw ?? {};
  let v: number = s.version ?? (Object.keys(s).length ? 1 : SETTINGS_VERSION);
  while (v < SETTINGS_VERSION) {
    s = MIGRATIONS[v](s);
    v = s.version;
  }
  s = stripUndefined(s);
  const core = { ...DEFAULT_CORE, ...(s.core ?? {}) };
  for (const k of INK_TOOLS) core[k] = { ...DEFAULT_CORE[k], ...(s.core?.[k] ?? {}) };
  core.pinned = { ...DEFAULT_CORE.pinned, ...(s.core?.pinned ?? {}) };
  core.groupLast = { ...DEFAULT_CORE.groupLast, ...(s.core?.groupLast ?? {}) };
  core.toolbar = { order: [], hidden: [], ...(s.core?.toolbar ?? {}) };
  if (!isTemplate(core.defaultTemplate)) core.defaultTemplate = DEFAULT_CORE.defaultTemplate;
  delete (core as Record<string, unknown>).toolbarStyle;
  return { version: SETTINGS_VERSION, core, features: s.features ?? {} };
}

/* ------------------------------------------------------------------ */
/* Observable store shared by every open note and the settings tab.   */
/* ------------------------------------------------------------------ */

export class SettingsStore {
  private listeners = new Set<() => void>();

  constructor(private current: HandnoteSettings, private persist: (s: HandnoteSettings) => void) {}

  get(): HandnoteSettings {
    return this.current;
  }

  updateCore(patch: Partial<CoreSettings>) {
    this.set({ ...this.current, core: { ...this.current.core, ...patch } });
  }

  updateFeature(id: string, patch: Record<string, unknown>) {
    const prev = this.current.features[id] ?? {};
    this.set({ ...this.current, features: { ...this.current.features, [id]: { ...prev, ...patch } } });
  }

  private set(next: HandnoteSettings) {
    this.current = next;
    this.persist(next);
    this.listeners.forEach((l) => l());
  }

  subscribe = (l: () => void) => {
    this.listeners.add(l);
    return () => {
      this.listeners.delete(l);
    };
  };
}

export function useSettings(store: SettingsStore): HandnoteSettings {
  return useSyncExternalStore(store.subscribe, () => store.get());
}
