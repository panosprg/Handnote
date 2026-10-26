import type { Template } from "./core/settings";

/**
 * A .handnote file is a normal Excalidraw scene (so it can also be opened at
 * excalidraw.com) with an extra "handnote" block for our own settings.
 */
export interface HandnoteFile {
  type: "excalidraw";
  version: 2;
  source: "obsidian-handnote";
  handnote: {
    version: 1;
    template: Template;
    scrollX?: number;
    scrollY?: number;
    zoom?: number;
  };
  elements: unknown[];
  appState: Record<string, unknown>;
  files: Record<string, unknown>;
}

export function emptyNote(template: Template): string {
  const file: HandnoteFile = {
    type: "excalidraw",
    version: 2,
    source: "obsidian-handnote",
    handnote: { version: 1, template },
    elements: [],
    appState: { viewBackgroundColor: "transparent", gridSize: null },
    files: {},
  };
  return JSON.stringify(file, null, 1);
}

/**
 * File format migrations. When the note format changes, bump FILE_VERSION and
 * add a step here (version n → n+1). Old notes upgrade the next time they open.
 */
export const FILE_VERSION = 1;
const FILE_MIGRATIONS: Record<number, (f: any) => any> = {
  // 1: (f) => ({ ...f, handnote: { ...f.handnote, version: 2, newField: "default" } }),
};

/** Throws if the file isn't valid JSON (the view then refuses to overwrite it). */
export function parseNote(raw: string, fallbackTemplate: Template): HandnoteFile {
  let parsed = raw.trim() ? JSON.parse(raw) : {};
  for (let v = parsed.handnote?.version ?? FILE_VERSION; v < FILE_VERSION; v++) {
    parsed = FILE_MIGRATIONS[v](parsed);
  }
  return {
      type: "excalidraw",
      version: 2,
      source: "obsidian-handnote",
      handnote: {
        version: 1,
        template: parsed.handnote?.template ?? fallbackTemplate,
        scrollX: parsed.handnote?.scrollX,
        scrollY: parsed.handnote?.scrollY,
        zoom: parsed.handnote?.zoom,
      },
      elements: Array.isArray(parsed.elements) ? parsed.elements : [],
      appState: parsed.appState ?? {},
    files: parsed.files ?? {},
  };
}
