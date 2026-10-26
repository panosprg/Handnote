import { useSyncExternalStore } from "react";

export type Template = "blank" | "lined" | "grid" | "dots";
export type InkToolId = "pen" | "ballpoint" | "pencil" | "highlighter";
export const INK_TOOLS: InkToolId[] = ["pen", "ballpoint", "pencil", "highlighter"];

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
  /** Fountain pen: line width follows Pencil pressure */
  pen: InkConfig;
  /** Even line width, like a ballpoint */
  ballpoint: InkConfig;
  pencil: InkConfig;
  highlighter: InkConfig;
  /** Favourite colours, shared by every tool */
  favourites: string[];
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
  pen: { color: "#1e1e1e", width: 1, opacity: 100 },
  ballpoint: { color: "#1e1e1e", width: 1, opacity: 100 },
  pencil: { color: "#4a4a52", width: 0.5, opacity: 75 },
  highlighter: { color: "#ffe066", width: 6, opacity: 45 },
  favourites: ["#1e1e1e", "#1971c2", "#e03131", "#2f9e44"],
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
