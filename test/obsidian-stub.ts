// Minimal stand-in for Obsidian's API so the canvas can run in a plain browser.
import * as pdfjs from "pdfjs-dist/legacy/build/pdf.mjs";
import * as pdfWorker from "pdfjs-dist/legacy/build/pdf.worker.mjs";
(globalThis as any).pdfjsWorker = pdfWorker; // run pdf.js in the page (no worker file needed)

const ICONS: Record<string, string> = {
  "pen-line": "✎", highlighter: "▮", eraser: "⌫", "mouse-pointer-2": "➤", hand: "✋",
  "undo-2": "↶", "redo-2": "↷", notebook: "▤", shapes: "◆", "trash-2": "🗑", lasso: "◌",
  "more-horizontal": "…", move: "✥", star: "★", "pen-tool": "✒", pen: "🖊", pencil: "✏",
  type: "T", scan: "⬚", plus: "+", "file-plus": "⊕", "file-down": "⤓", folder: "📁",
  "notebook-pen": "📓", "folder-plus": "📁+", "file-text": "📄", "list-tree": "☰", ruler: "📏",
  link: "🔗", unlink: "⛓", sigma: "Σ", printer: "⎙", "layout-grid": "▦", "heading-1": "H1", "heading-2": "H2", "heading-3": "H3", heading: "H",
};
export function setIcon(el: HTMLElement, name: string) {
  el.textContent = ICONS[name] ?? "?";
  el.style.fontSize = "18px";
}
export const loadPdfJs = async () => pdfjs;
export const normalizePath = (p: string) => p.replace(/\/+/g, "/").replace(/^\/|\/$/g, "") || "/";
export function arrayBufferToBase64(buf: ArrayBuffer) {
  let s = "";
  new Uint8Array(buf).forEach((b) => (s += String.fromCharCode(b)));
  return btoa(s);
}
export class Notice {
  constructor(public msg: string) {
    (window as any).notices = [...((window as any).notices ?? []), msg];
  }
  setMessage(m: string) {
    this.msg = m;
  }
  hide() {}
}
export class TAbstractFile {
  parent: TFolder | null = null;
  constructor(public path: string) {}
  get name() {
    return this.path.split("/").pop()!;
  }
}
export class TFile extends TAbstractFile {
  stat = { mtime: Date.now(), ctime: Date.now(), size: 0 };
  get basename() {
    return this.name.replace(/\.[^.]+$/, "");
  }
  get extension() {
    return this.name.split(".").pop()!;
  }
}
export class TFolder extends TAbstractFile {
  children: TAbstractFile[] = [];
}
class Stub {
  constructor(..._a: unknown[]) {}
}
export class Menu extends Stub {
  addItem() {
    return this;
  }
  addSeparator() {
    return this;
  }
  showAtPosition() {}
}
export class Modal extends Stub {
  open() {}
}
export class Setting extends Stub {}
export class ItemView extends Stub {}

export const Platform = { isMobile: false };
export const requestUrl = async () => ({ status: 200, text: "" });
export class FuzzySuggestModal extends Modal {
  setPlaceholder() {}
}

/** Enough of Obsidian's TextFileView to run HandnoteView: save() writes getViewData() to the fake vault. */
export class TextFileView {
  data = "";
  file: TFile | null = null;
  app: any;
  contentEl: HTMLElement;
  constructor(public leaf: any) {
    this.app = leaf.app;
    const el = document.createElement("div") as any;
    el.addClass = (c: string) => el.classList.add(c);
    el.empty = () => el.replaceChildren();
    el.createDiv = ({ cls }: { cls: string }) => {
      const d = document.createElement("div");
      d.className = cls;
      el.appendChild(d);
      return d;
    };
    this.contentEl = el;
  }
  requestSave() {
    void this.save();
  }
  async save() {
    if (!this.file) return;
    const d = this.getViewData();
    const w = window as any;
    if (w.failSave) throw new Error(w.failSave);
    await this.app.vault.modify(this.file, d);
    w.saves = (w.saves ?? 0) + 1;
  }
  async onUnloadFile(_f: TFile) {
    await this.save();
  }
  getViewData() {
    return "";
  }
  setViewData(_d: string, _c: boolean) {}
  clear() {}
}
