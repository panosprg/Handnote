import { Notice, TextFileView, arrayBufferToBase64, normalizePath, type WorkspaceLeaf } from "obsidian";
import { createRoot, type Root } from "react-dom/client";
import type { ExcalidrawImperativeAPI } from "@excalidraw/excalidraw/types";

import Canvas from "./core/Canvas";
import type { HandnoteContext, HostActions } from "./core/context";
import { exportPdf } from "./core/export";
import type { PagesInfo } from "./core/pages";
import type { Template } from "./core/settings";
import { parseNote, type HandnoteFile } from "./data";
import type HandnotePlugin from "./main";

export const VIEW_TYPE_HANDNOTE = "handnote-view";

export class HandnoteView extends TextFileView {
  private root: Root | null = null;
  private api: ExcalidrawImperativeAPI | null = null;
  ctx: HandnoteContext | null = null;
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
    return this.file?.basename ?? "Notebook";
  }

  getIcon() {
    return "notebook-pen";
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
      new Notice("Handnote: this file isn't a valid notebook, so it won't be modified.");
      this.note = parseNote("", this.plugin.store.get().core.defaultTemplate);
      this.readOnly = true;
    }
    this.lastSerialized = data;
    this.mount();
  }

  getViewData(): string {
    if (this.readOnly || !this.api || !this.note) return this.data;
    const st = this.api.getAppState();
    const files = this.api.getFiles();
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
      files,
    };
    this.lastSerialized = JSON.stringify(file, null, 1);
    return this.lastSerialized;
  }

  /** Reads the PDF page images this notebook keeps next to it, one per page. */
  private async loadPageImages(): Promise<(string | undefined)[]> {
    const out: (string | undefined)[] = [];
    for (const a of this.note?.handnote.pdf?.assets ?? []) {
      try {
        const buf = await this.app.vault.adapter.readBinary(normalizePath(a.path));
        out.push(`data:image/jpeg;base64,${arrayBufferToBase64(buf)}`);
      } catch (e) {
        console.warn("Handnote: missing PDF page image", a.path, e);
        out.push(undefined);
      }
    }
    return out;
  }

  private host: HostActions = {
    notePath: () => this.file?.path ?? "",
    openLink: (link: string) => this.app.workspace.openLinkText(link.replace(/^\[\[|\]\]$/g, ""), this.file?.path ?? "", true),
    exportPdf: async () => {
      if (!this.ctx || !this.file) return;
      const notice = new Notice("Handnote: making the PDF…", 0);
      try {
        const bytes = await exportPdf(this.ctx);
        const path = normalizePath(`${this.file.parent?.path ?? ""}/${this.file.basename}.pdf`);
        const existing = this.app.vault.getFileByPath(path);
        const buf = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
        if (existing) await this.app.vault.modifyBinary(existing, buf);
        else await this.app.vault.createBinary(path, buf);
        notice.hide();
        new Notice(`Saved ${path}. Open it from your vault to print or share it.`);
        await this.app.workspace.getLeaf("tab").openFile(this.app.vault.getFileByPath(path)!);
      } catch (e) {
        notice.hide();
        console.error(e);
        new Notice(`Handnote: couldn't make the PDF (${(e as Error).message})`);
      }
    },
  };

  private mount() {
    this.unmount();
    if (!this.note) return;
    const el = this.contentEl.createDiv({ cls: "hn-host" });
    this.root = createRoot(el);
    const isDark = document.body.classList.contains("theme-dark");
    const save = () => {
      if (!this.readOnly) this.requestSave();
    };
    this.root.render(
      <Canvas
        key={this.file?.path ?? "note"}
        initial={this.note}
        store={this.plugin.store}
        registry={this.plugin.registry}
        isDark={isDark}
        host={this.host}
        loadPageImages={() => this.loadPageImages()}
        onReady={(api, ctx) => {
          this.api = api;
          if (ctx) this.ctx = ctx;
        }}
        onDirty={save}
        onTemplateChange={(t: Template) => {
          if (this.note) this.note = { ...this.note, handnote: { ...this.note.handnote, template: t } };
          save();
        }}
        onPagesChange={(p: PagesInfo) => {
          if (this.note) this.note = { ...this.note, handnote: { ...this.note.handnote, pages: p } };
          save();
        }}
      />,
    );
  }

  private unmount() {
    this.root?.unmount();
    this.root = null;
    this.api = null;
    this.ctx = null;
    this.contentEl.empty();
  }
}
