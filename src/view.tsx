import { CaptureUpdateAction } from "@excalidraw/excalidraw";
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
import { exportLegends, exportPdf, renderPage } from "./core/export";
import { ANNOTATE_FEATURE, categories, highlightColor, isHighlight, labelFor } from "./core/categories";
import { buildAnnotatedPdf, isAnnotated } from "./core/pdf-annotate";
import { unpackText, type PdfWord } from "./core/pdf-text";
import { pageRects } from "./core/pages";
import type { PagesInfo } from "./core/pages";
import { handnoteFolders, type Template } from "./core/settings";
import { buildPdfText, ensureFolder, pdfDataDir } from "./pdf-import";
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
  /** Changed since the annotations were last written into the PDF. */
  private pdfStale = false;
  private writingPdf: Promise<void> | null = null;

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
    // The file changed while open (sync). Never reload over what's on screen: merge stroke by
    // stroke and keep whichever version of each stroke is newer. An old copy arriving late
    // (iCloud) then changes nothing; strokes written on another device are added.
    if (!clear && this.root && this.api) {
      this.mergeFromDisk(data);
      return;
    }

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

  private mergeFromDisk(data: string) {
    let incoming: HandnoteFile;
    try {
      incoming = parseNote(data, this.plugin.store.get().core.defaultTemplate);
    } catch {
      return; // half-written or broken copy: keep what we have
    }
    const api = this.api!;
    const local = new Map(api.getSceneElementsIncludingDeleted().map((e) => [e.id, e]));
    let changed = false;
    for (const el of incoming.elements as { id: string; version: number }[]) {
      const mine = local.get(el.id);
      if (!mine || el.version > mine.version) {
        local.set(el.id, el as never);
        changed = true;
      }
    }
    const pages = incoming.handnote.pages;
    if (this.ctx && pages.sizes.length > this.ctx.state.pages.sizes.length) this.ctx.setPages(pages);
    if (!changed) return;
    api.updateScene({ elements: [...local.values()] as never, captureUpdate: CaptureUpdateAction.NEVER });
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

  /* ---------- the PDF a notebook was made from ---------- */

  private pdfInfo() {
    const pdf = this.note?.handnote.pdf;
    if (!pdf) return null;
    const dir = pdfDataDir(pdf.assets);
    return { source: pdf.source, dir, original: normalizePath(`${dir}/original.pdf`), text: normalizePath(`${dir}/text.json`) };
  }

  private async readBytes(path: string): Promise<Uint8Array | null> {
    const f = this.app.vault.getFileByPath(path);
    return f ? new Uint8Array(await this.app.vault.readBinary(f)) : null;
  }

  /**
   * The PDF exactly as it was imported. Kept as "original.pdf" next to the page images
   * the first time annotations are written into the PDF (so writing again never doubles them).
   */
  private async originalPdf(keep = false): Promise<Uint8Array | null> {
    const info = this.pdfInfo();
    if (!info) return null;
    const saved = await this.readBytes(info.original);
    if (saved) return saved;
    const source = await this.readBytes(info.source);
    // Already annotated by Handnote but its clean copy is gone: can't be used as the original.
    if (!source || (await isAnnotated(source))) return null;
    if (keep) {
      const buf = source.buffer.slice(source.byteOffset, source.byteOffset + source.byteLength) as ArrayBuffer;
      await this.app.vault.createBinary(info.original, buf);
    }
    return source;
  }

  /** The words on each PDF page (made from the PDF the first time, for older notebooks). */
  private async loadPageText(): Promise<PdfWord[][] | null> {
    const info = this.pdfInfo();
    if (!info) return null;
    const f = this.app.vault.getFileByPath(info.text);
    if (f) {
      const t = unpackText(await this.app.vault.cachedRead(f));
      if (t) return t.pages;
    }
    const original = await this.originalPdf();
    if (!original) return null;
    const buf = original.buffer.slice(original.byteOffset, original.byteOffset + original.byteLength) as ArrayBuffer;
    return (await buildPdfText(this.app, buf, info.dir)).pages;
  }

  /** Writes the highlights, handwriting and colour key into the PDF the notebook was made from. */
  async saveIntoPdf(quiet = false) {
    if (this.writingPdf) return this.writingPdf;
    const run = async () => {
      const info = this.pdfInfo();
      const ctx = this.ctx;
      if (!info || !ctx) return;
      const notice = quiet ? null : new Notice("Handnote: writing into the PDF…", 0);
      try {
        if (!this.app.vault.getFileByPath(info.source)) throw new Error(`the PDF isn't at ${info.source} any more`);
        const original = await this.originalPdf(true);
        if (!original)
          throw new Error("the clean copy of the original PDF is missing (original.pdf next to the page images), so it can't be rewritten safely");
        const legend = exportLegends(ctx);
        const bytes = await buildAnnotatedPdf(ctx, original, {
          legend: legend.length > 0,
          renderExtraPage: (r) => renderPage(ctx, r, ctx.pageTemplate(r.index), legend[r.index]),
        });
        await this.writePdf(info.source, bytes);
        this.pdfStale = false;
        notice?.hide();
        if (!quiet) new Notice(`Saved into ${info.source}.`);
      } catch (e) {
        notice?.hide();
        console.error("Handnote: couldn't write into the PDF", e);
        new Notice(`Handnote: couldn't write into the PDF (${(e as Error).message})`, 8000);
      }
    };
    this.writingPdf = run().finally(() => (this.writingPdf = null));
    return this.writingPdf;
  }

  /** Every highlight with its text, grouped by what its colour means, in a Markdown note. */
  private async collectHighlights() {
    const ctx = this.ctx;
    const info = this.pdfInfo();
    if (!ctx || !info || !this.file) return;
    const list = categories(ctx);
    const rects = pageRects(ctx.state.pages);
    const pageOf = (y: number) => rects.findIndex((r) => y >= r.y - 18 && y <= r.y + r.h + 18);
    const items = ctx
      .elements()
      .filter(isHighlight)
      .map((e) => ({
        text: String((e.customData as { text?: string } | undefined)?.text ?? "").trim(),
        color: highlightColor(e),
        page: pageOf(e.y + e.height / 2),
        y: e.y,
        x: e.x,
      }))
      .filter((h) => h.text && h.page >= 0)
      .sort((a, b) => a.page - b.page || a.y - b.y || a.x - b.x);
    if (!items.length) {
      new Notice("Handnote: no highlighted text yet. Highlight over the PDF's words with the highlighter.");
      return;
    }
    // Lines of one highlight that run on (same colour, next line) become one quote.
    const merged: typeof items = [];
    for (const h of items) {
      const prev = merged[merged.length - 1];
      if (prev && prev.color === h.color && prev.page === h.page && h.y - prev.y > 0 && h.y - prev.y < 40) {
        prev.text = prev.text.endsWith("-") ? prev.text.slice(0, -1) + h.text : `${prev.text} ${h.text}`;
        prev.y = h.y;
      } else merged.push({ ...h });
    }
    const pdfLink = info.source.replace(/\.pdf$/i, "");
    const groups = [
      ...list.filter((c) => c.label.trim()).map((c) => ({ title: c.label.trim(), color: c.color })),
      { title: "Other highlights", color: "" },
    ];
    let md = `# Highlights: ${this.file.basename}\n\nFrom [[${info.source}|${this.file.basename}]] (notebook: [[${this.file.path}|${this.file.basename}]]). Made by Handnote: running "Highlights to a note" again replaces this note.\n`;
    for (const g of groups) {
      const mine = merged.filter((h) => (g.color ? h.color === g.color : !labelFor(list, h.color)));
      if (!mine.length) continue;
      md += `\n## ${g.title}\n\n`;
      for (const h of mine) md += `> ${h.text}\n> — [[${pdfLink}.pdf#page=${h.page + 1}|p. ${h.page + 1}]]\n\n`;
    }
    const dir = this.file.parent && this.file.parent.path !== "/" ? `${this.file.parent.path}/` : "";
    const path = normalizePath(`${dir}${this.file.basename} highlights.md`);
    const existing = this.app.vault.getFileByPath(path);
    if (existing) await this.app.vault.modify(existing, md);
    else await this.app.vault.create(path, md);
    new Notice(`Saved ${merged.length} highlight${merged.length === 1 ? "" : "s"} to ${path}.`);
    await this.app.workspace.getLeaf("tab").openFile(this.app.vault.getFileByPath(path)!);
  }

  /* ---------- saving (and the green/red dot) ---------- */

  private setSaveStatus(saveStatus: "saved" | "unsaved" | "saving" | "error", saveError?: string) {
    this.ctx?.setState({ saveStatus, saveError });
  }

  /** Something changed: save about a second after the last change. */
  private markDirty() {
    if (this.readOnly) return;
    this.dirty = true;
    this.pdfStale = true;
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
    if (this.pdfStale && this.ctx && this.writeOnClose()) await this.saveIntoPdf(true);
    await super.onUnloadFile(file);
  }

  private async writePdf(path: string, bytes: Uint8Array) {
    const buf = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
    const existing = this.app.vault.getFileByPath(path);
    if (existing) await this.app.vault.modifyBinary(existing, buf);
    else await this.app.vault.createBinary(path, buf);
  }

  private writeOnClose() {
    const ctx = this.ctx;
    if (!ctx || !ctx.isEnabled(ANNOTATE_FEATURE)) return false;
    return ctx.featureSettings<{ writeOnClose?: boolean }>(ANNOTATE_FEATURE).writeOnClose !== false;
  }

  private host: HostActions = {
    isPdf: () => !!this.note?.handnote.pdf,
    saveIntoPdf: () => this.saveIntoPdf(),
    collectHighlights: () => this.collectHighlights(),
    saveNow: () => this.flush(),
    print: async (pages?: number[]) => {
      if (!this.ctx || !this.file) return;
      const notice = new Notice("Handnote: getting the pages ready to print…", 0);
      try {
        const bytes = await exportPdf(this.ctx, pages, await this.originalPdf());
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
        const exportsDir = handnoteFolders(this.plugin.store.get().core).exports;
        await ensureFolder(this.app, exportsDir);
        const path = normalizePath(`${exportsDir}/${this.file.basename} (print).pdf`);
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
        const bytes = await exportPdf(this.ctx, undefined, await this.originalPdf());
        // In Handnote/Exports (never next to the notebook: that could overwrite the PDF it was made from).
        const exportsDir = handnoteFolders(this.plugin.store.get().core).exports;
        await ensureFolder(this.app, exportsDir);
        const path = normalizePath(`${exportsDir}/${this.file.basename}.pdf`);
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
        loadPageText={() => this.loadPageText()}
        onMetaChange={(meta) => {
          if (this.note) this.note = { ...this.note, handnote: { ...this.note.handnote, meta } };
          // Like the paper: saved straight away.
          this.dirty = true;
          this.pdfStale = true;
          void this.flush();
        }}
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
