import {
  FuzzySuggestModal,
  Notice,
  Platform,
  TextFileView,
  arrayBufferToBase64,
  normalizePath,
  requestUrl,
  type App,
  type TFile,
  type WorkspaceLeaf,
} from "obsidian";
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

class NotePicker extends FuzzySuggestModal<TFile> {
  private picked = false;
  constructor(app: App, private done: (f: TFile | null) => void) {
    super(app);
    this.setPlaceholder("Link to which note?");
  }
  getItems() {
    return this.app.vault.getFiles().filter((f) => f.extension === "md" || f.extension === "handnote");
  }
  getItemText(f: TFile) {
    return f.path;
  }
  onChooseItem(f: TFile) {
    this.picked = true;
    this.done(f);
  }
  onClose() {
    // onChooseItem runs after onClose; wait a tick before reporting "nothing picked".
    window.setTimeout(() => !this.picked && this.done(null), 50);
  }
}

export class HandnoteView extends TextFileView {
  private root: Root | null = null;
  private api: ExcalidrawImperativeAPI | null = null;
  ctx: HandnoteContext | null = null;
  private note: HandnoteFile | null = null;
  /** If the file couldn't be parsed we never overwrite it. */
  private readOnly = false;
  private lastSerialized = "";
  /** What we wrote recently: when the file "changes" to one of these it's our own save echoing back. */
  private recentWrites: string[] = [];
  private saveTimer: number | null = null;
  private dirty = false;

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
    // Ignore echoes of our own saves (even older ones arriving late, e.g. via iCloud);
    // remount for genuinely external changes (sync from another device).
    if (!clear && this.root && (data === this.lastSerialized || this.recentWrites.includes(data))) return;
    // Unsaved changes here win over an older copy arriving from disk.
    if (!clear && this.root && this.dirty) return;

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
    this.recentWrites = [this.lastSerialized, ...this.recentWrites].slice(0, 6);
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

  /* ---------- saving (and the green/red dot) ---------- */

  private setSaveStatus(saveStatus: "saved" | "unsaved" | "saving" | "error", saveError?: string) {
    this.ctx?.setState({ saveStatus, saveError });
  }

  /** Something changed: save about a second after the last change. */
  private markDirty() {
    if (this.readOnly) return;
    this.dirty = true;
    this.setSaveStatus("unsaved");
    if (this.saveTimer !== null) window.clearTimeout(this.saveTimer);
    this.saveTimer = window.setTimeout(() => void this.flush(), 900);
  }

  /** Save now if anything is waiting. */
  async flush() {
    if (this.saveTimer !== null) window.clearTimeout(this.saveTimer);
    this.saveTimer = null;
    if (this.readOnly || !this.file) return;
    this.setSaveStatus("saving");
    try {
      this.dirty = false;
      await this.save();
      // A change that came in while saving keeps the dot red.
      this.setSaveStatus(this.dirty ? "unsaved" : "saved");
    } catch (e) {
      this.dirty = true;
      console.error("Handnote: save failed", e);
      this.setSaveStatus("error", (e as Error)?.message ?? String(e));
    }
  }

  async onUnloadFile(file: TFile) {
    if (this.dirty) await this.flush();
    await super.onUnloadFile(file);
  }

  private async writePdf(path: string, bytes: Uint8Array) {
    const buf = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
    const existing = this.app.vault.getFileByPath(path);
    if (existing) await this.app.vault.modifyBinary(existing, buf);
    else await this.app.vault.createBinary(path, buf);
  }

  private host: HostActions = {
    saveNow: () => this.flush(),
    print: async (pages?: number[]) => {
      if (!this.ctx || !this.file) return;
      const notice = new Notice("Handnote: getting the pages ready to print…", 0);
      try {
        const bytes = await exportPdf(this.ctx, pages);
        notice.hide();
        if (!Platform.isMobile) {
          // Desktop: print the PDF straight from a hidden frame.
          const url = URL.createObjectURL(new Blob([bytes as BlobPart], { type: "application/pdf" }));
          const frame = document.body.createEl("iframe", { attr: { src: url, "aria-hidden": "true" } });
          frame.setCssStyles({ position: "fixed", width: "0", height: "0", border: "0", opacity: "0" });
          frame.onload = () => {
            try {
              frame.contentWindow?.focus();
              frame.contentWindow?.print();
            } finally {
              window.setTimeout(() => {
                frame.remove();
                URL.revokeObjectURL(url);
              }, 60_000);
            }
          };
          return;
        }
        // iPad: make the PDF, then hand it to iPadOS (share sheet → Print).
        const path = normalizePath(`${this.file.parent?.path ?? ""}/${this.file.basename} (print).pdf`);
        await this.writePdf(path, bytes);
        const openWith = (this.app as unknown as { openWithDefaultApp?: (p: string) => unknown }).openWithDefaultApp;
        if (openWith) {
          openWith.call(this.app, path);
          new Notice("Choose Print in the share sheet.");
        } else {
          await this.app.workspace.getLeaf("tab").openFile(this.app.vault.getFileByPath(path)!);
          new Notice("Tap ••• (top right) → Share → Print.");
        }
      } catch (e) {
        notice.hide();
        console.error(e);
        new Notice(`Handnote: couldn't print (${(e as Error).message})`);
      }
    },
    notePath: () => this.file?.path ?? "",
    pickNote: () =>
      new Promise((resolve) =>
        new NotePicker(this.app, (f) =>
          resolve(f ? `[[${this.app.metadataCache.fileToLinktext(f, this.file?.path ?? "", f.extension === "md")}]]` : null),
        ).open(),
      ),
    request: async (url, init) => {
      const r = await requestUrl({ url, method: init.method, headers: init.headers, body: init.body, throw: false });
      return { status: r.status, text: r.text };
    },
    openLink: (link: string) => this.app.workspace.openLinkText(link.replace(/^\[\[|\]\]$/g, ""), this.file?.path ?? "", true),
    exportPdf: async () => {
      if (!this.ctx || !this.file) return;
      const notice = new Notice("Handnote: making the PDF…", 0);
      try {
        const bytes = await exportPdf(this.ctx);
        const path = normalizePath(`${this.file.parent?.path ?? ""}/${this.file.basename}.pdf`);
        await this.writePdf(path, bytes);
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
    const save = () => this.markDirty();
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
          // The paper choice is saved straight away.
          this.dirty = true;
          void this.flush();
        }}
        onPagesChange={(p: PagesInfo) => {
          if (this.note) this.note = { ...this.note, handnote: { ...this.note.handnote, pages: p } };
          // Pages carry per-page paper: save straight away too.
          this.dirty = true;
          void this.flush();
        }}
      />,
    );
  }

  private unmount() {
    if (this.saveTimer !== null) window.clearTimeout(this.saveTimer);
    this.saveTimer = null;
    this.root?.unmount();
    this.root = null;
    this.api = null;
    this.ctx = null;
    this.contentEl.empty();
  }
}
