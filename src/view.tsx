import { Notice, TextFileView, type WorkspaceLeaf } from "obsidian";
import { createRoot, type Root } from "react-dom/client";
import type { ExcalidrawImperativeAPI } from "@excalidraw/excalidraw/types";

import Canvas from "./core/Canvas";
import { parseNote, type HandnoteFile } from "./data";
import type HandnotePlugin from "./main";
import type { Template } from "./core/settings";

export const VIEW_TYPE_HANDNOTE = "handnote-view";

export class HandnoteView extends TextFileView {
  private root: Root | null = null;
  private api: ExcalidrawImperativeAPI | null = null;
  private note: HandnoteFile | null = null;
  /** If the file couldn't be parsed we never overwrite it. */
  private readOnly = false;
  private lastSerialized = "";

  constructor(leaf: WorkspaceLeaf, private plugin: HandnotePlugin) {
    super(leaf);
  }

  getViewType() {
    return VIEW_TYPE_HANDNOTE;
  }

  getDisplayText() {
    return this.file?.basename ?? "Handwritten note";
  }

  getIcon() {
    return "pen-line";
  }

  canAcceptExtension(extension: string) {
    return extension === "handnote";
  }

  async onOpen() {
    this.contentEl.addClass("hn-view");
  }

  async onClose() {
    this.unmount();
  }

  clear() {
    this.unmount();
  }

  setViewData(data: string, clear: boolean) {
    this.data = data;
    // Ignore echoes of our own saves; remount for genuinely external changes (sync, other device).
    if (!clear && this.root && data === this.lastSerialized) return;

    try {
      this.note = parseNote(data, this.plugin.store.get().core.defaultTemplate);
      this.readOnly = false;
    } catch (e) {
      console.error("Handnote: could not parse", this.file?.path, e);
      new Notice("Handnote: this file isn't a valid handwritten note, so it won't be modified.");
      this.note = parseNote("", this.plugin.store.get().core.defaultTemplate);
      this.readOnly = true;
    }
    this.lastSerialized = data;
    this.mount();
  }

  getViewData(): string {
    if (this.readOnly || !this.api || !this.note) return this.data;
    const st = this.api.getAppState();
    const file: HandnoteFile = {
      ...this.note,
      handnote: {
        ...this.note.handnote,
        scrollX: Math.round(st.scrollX),
        scrollY: Math.round(st.scrollY),
        zoom: Math.round(st.zoom.value * 100) / 100,
      },
      // Temporary selection groups (see clean-selection) are never saved.
      elements: this.api.getSceneElements().map((el) =>
        el.groupIds.some((g) => g.startsWith("hn-sel-")) ? { ...el, groupIds: el.groupIds.filter((g) => !g.startsWith("hn-sel-")) } : el,
      ) as unknown[],
      appState: { viewBackgroundColor: "transparent", gridSize: null },
      files: this.api.getFiles() as Record<string, unknown>,
    };
    this.lastSerialized = JSON.stringify(file, null, 1);
    return this.lastSerialized;
  }

  private mount() {
    this.unmount();
    if (!this.note) return;
    const host = this.contentEl.createDiv({ cls: "hn-host" });
    this.root = createRoot(host);
    const isDark = document.body.classList.contains("theme-dark");
    this.root.render(
      <Canvas
        key={this.file?.path ?? "note"}
        initial={this.note}
        store={this.plugin.store}
        registry={this.plugin.registry}
        isDark={isDark}
        onReady={(api) => (this.api = api)}
        onDirty={() => {
          if (!this.readOnly) this.requestSave();
        }}
        onTemplateChange={(t: Template) => {
          if (this.note) this.note = { ...this.note, handnote: { ...this.note.handnote, template: t } };
          if (!this.readOnly) this.requestSave();
        }}
      />,
    );
  }

  private unmount() {
    this.root?.unmount();
    this.root = null;
    this.api = null;
    this.contentEl.empty();
  }
}
