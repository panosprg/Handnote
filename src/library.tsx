import { useEffect, useMemo, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import {
  ItemView,
  Menu,
  Modal,
  Notice,
  Setting,
  TFile,
  TFolder,
  normalizePath,
  setIcon,
  type App,
  type WorkspaceLeaf,
} from "obsidian";
import { COVER_COLOURS } from "./data";
import type HandnotePlugin from "./main";

import "./library.css";

export const VIEW_TYPE_LIBRARY = "handnote-library";

interface NotebookInfo {
  file: TFile;
  cover: string;
  pages: number;
  /** first PDF page image, used as the cover for PDF notebooks */
  image?: string;
}

/* ------------------------------------------------------------------ */
/* Small dialogs                                                       */
/* ------------------------------------------------------------------ */

export class PromptModal extends Modal {
  constructor(app: App, private title: string, private value: string, private done: (v: string) => void) {
    super(app);
  }
  onOpen() {
    this.titleEl.setText(this.title);
    let v = this.value;
    new Setting(this.contentEl).addText((t) => {
      t.setValue(v).onChange((x) => (v = x));
      t.inputEl.style.width = "100%";
      window.setTimeout(() => t.inputEl.select(), 10);
      t.inputEl.addEventListener("keydown", (e) => {
        if (e.key === "Enter") {
          this.close();
          this.done(v.trim());
        }
      });
    });
    new Setting(this.contentEl).addButton((b) =>
      b
        .setButtonText("OK")
        .setCta()
        .onClick(() => {
          this.close();
          this.done(v.trim());
        }),
    );
  }
  onClose() {
    this.contentEl.empty();
  }
}

class CoverModal extends Modal {
  constructor(app: App, private done: (c: string) => void) {
    super(app);
  }
  onOpen() {
    this.titleEl.setText("Cover colour");
    const row = this.contentEl.createDiv({ cls: "hn-cover-picker" });
    for (const c of COVER_COLOURS) {
      const b = row.createEl("button", { cls: "hn-cover-swatch", attr: { "aria-label": c } });
      b.style.background = c;
      b.onclick = () => {
        this.close();
        this.done(c);
      };
    }
  }
  onClose() {
    this.contentEl.empty();
  }
}

function Icon({ name }: { name: string }) {
  return <span className="hn-icon" ref={(el) => el && setIcon(el, name)} />;
}

/* ------------------------------------------------------------------ */
/* Library                                                             */
/* ------------------------------------------------------------------ */

function hasNotebooks(f: TFolder): boolean {
  return f.children.some((c) => (c instanceof TFile && c.extension === "handnote") || (c instanceof TFolder && hasNotebooks(c)));
}

function countNotebooks(f: TFolder): number {
  return f.children.reduce(
    (n, c) => n + (c instanceof TFile && c.extension === "handnote" ? 1 : c instanceof TFolder ? countNotebooks(c) : 0),
    0,
  );
}

export function Library({ plugin, path, setPath }: { plugin: HandnotePlugin; path: string; setPath: (p: string) => void }) {
  const app = plugin.app;
  const [tick, setTick] = useState(0);
  const [infos, setInfos] = useState<Record<string, NotebookInfo>>({});

  useEffect(() => {
    const bump = () => setTick((t) => t + 1);
    const refs = [
      app.vault.on("create", bump),
      app.vault.on("delete", bump),
      app.vault.on("rename", bump),
      app.vault.on("modify", (f) => f instanceof TFile && f.extension === "handnote" && bump()),
    ];
    return () => refs.forEach((r) => app.vault.offref(r));
  }, [app]);

  const folder = (app.vault.getAbstractFileByPath(path || "/") as TFolder | null) ?? app.vault.getRoot();
  const folders = folder.children.filter((c): c is TFolder => c instanceof TFolder && hasNotebooks(c));
  const notebooks = useMemo(
    () =>
      folder.children
        .filter((c): c is TFile => c instanceof TFile && c.extension === "handnote")
        .sort((a, b) => b.stat.mtime - a.stat.mtime),
    [folder, tick],
  );

  // Read covers (colour, page count, first PDF page) lazily.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const next: Record<string, NotebookInfo> = {};
      for (const f of notebooks) {
        try {
          const h = JSON.parse(await app.vault.cachedRead(f)).handnote ?? {};
          const first = h.pdf?.assets?.[0]?.path;
          next[f.path] = {
            file: f,
            cover: h.cover ?? COVER_COLOURS[f.basename.length % COVER_COLOURS.length],
            pages: h.pages?.sizes?.length ?? 1,
            image: first ? app.vault.adapter.getResourcePath(normalizePath(first)) : undefined,
          };
        } catch {
          next[f.path] = { file: f, cover: "#868e96", pages: 1 };
        }
      }
      if (!cancelled) setInfos(next);
    })();
    return () => {
      cancelled = true;
    };
  }, [notebooks]);

  const open = (f: TFile) => app.workspace.getLeaf("tab").openFile(f);

  const notebookMenu = (e: React.MouseEvent | React.PointerEvent, f: TFile) => {
    e.preventDefault();
    const m = new Menu();
    m.addItem((i) => i.setTitle("Open").setIcon("book-open").onClick(() => open(f)));
    m.addItem((i) =>
      i
        .setTitle("Rename")
        .setIcon("pencil")
        .onClick(() =>
          new PromptModal(app, "Rename notebook", f.basename, (v) => {
            if (v) app.fileManager.renameFile(f, normalizePath(`${f.parent?.path ?? ""}/${v}.handnote`));
          }).open(),
        ),
    );
    m.addSeparator();
    m.addItem((i) =>
      i
        .setTitle("Cover colour…")
        .setIcon("palette")
        .onClick(() => new CoverModal(app, (c) => plugin.setCover(f, c)).open()),
    );
    m.addSeparator();
    m.addItem((i) =>
      i
        .setTitle("Move to folder…")
        .setIcon("folder-input")
        .onClick(() =>
          new PromptModal(app, "Move to folder (path)", f.parent?.path ?? "", async (v) => {
            const dest = normalizePath(v || "/");
            if (dest !== "/" && !app.vault.getAbstractFileByPath(dest)) await app.vault.createFolder(dest);
            await app.fileManager.renameFile(f, normalizePath(`${dest === "/" ? "" : dest + "/"}${f.name}`));
          }).open(),
        ),
    );
    m.addItem((i) =>
      i
        .setTitle("Duplicate")
        .setIcon("copy")
        .onClick(async () => {
          let p = normalizePath(`${f.parent?.path ?? ""}/${f.basename} copy.handnote`);
          for (let n = 2; app.vault.getAbstractFileByPath(p); n++) p = normalizePath(`${f.parent?.path ?? ""}/${f.basename} copy ${n}.handnote`);
          await app.vault.copy(f, p);
        }),
    );
    m.addItem((i) =>
      i
        .setTitle("Delete")
        .setIcon("trash-2")
        .onClick(async () => {
          await app.vault.trash(f, true);
          new Notice(`Moved "${f.basename}" to the trash`);
        }),
    );
    m.showAtPosition({ x: e.clientX, y: e.clientY });
  };

  const folderMenu = (e: React.MouseEvent | React.PointerEvent, d: TFolder) => {
    e.preventDefault();
    const m = new Menu();
    m.addItem((i) => i.setTitle("Open").setIcon("folder-open").onClick(() => setPath(d.path)));
    m.addItem((i) =>
      i
        .setTitle("Rename")
        .setIcon("pencil")
        .onClick(() =>
          new PromptModal(app, "Rename folder", d.name, (v) => {
            if (v) app.fileManager.renameFile(d, normalizePath(`${d.parent?.path ?? ""}/${v}`));
          }).open(),
        ),
    );
    m.showAtPosition({ x: e.clientX, y: e.clientY });
  };

  // Long-press for touch (iPad has no right-click).
  const longPress = (cb: (e: React.PointerEvent) => void) => {
    let t: number | null = null;
    return {
      onPointerDown: (e: React.PointerEvent) => {
        e.persist?.();
        t = window.setTimeout(() => {
          t = null;
          cb(e);
        }, 500);
      },
      onPointerUp: () => t !== null && window.clearTimeout(t),
      onPointerLeave: () => t !== null && window.clearTimeout(t),
    };
  };

  const crumbs = folder.path === "/" ? [] : folder.path.split("/");

  return (
    <div className="hn-lib">
      <div className="hn-lib-head">
        <div className="hn-lib-crumbs">
          <button className="hn-lib-crumb" onClick={() => setPath("/")}>
            Notebooks
          </button>
          {crumbs.map((c, i) => (
            <span key={i}>
              <span className="hn-lib-sep">›</span>
              <button className="hn-lib-crumb" onClick={() => setPath(crumbs.slice(0, i + 1).join("/"))}>
                {c}
              </button>
            </span>
          ))}
        </div>
        <div className="hn-lib-actions">
          <button className="hn-lib-btn" onClick={() => plugin.createNote(folder.path, "Notebook")}>
            <Icon name="notebook-pen" /> New notebook
          </button>
          <button
            className="hn-lib-btn"
            onClick={() =>
              new PromptModal(app, "New folder", "", async (v) => {
                if (!v) return;
                const p = normalizePath(`${folder.path === "/" ? "" : folder.path + "/"}${v}`);
                if (!app.vault.getAbstractFileByPath(p)) await app.vault.createFolder(p);
                // An empty folder has no notebooks yet: put a first one in so it shows.
                await plugin.createNote(p, "Notebook", undefined, false);
              }).open()
            }
          >
            <Icon name="folder-plus" /> New folder
          </button>
          <button className="hn-lib-btn" onClick={() => plugin.pickPdfToImport()}>
            <Icon name="file-text" /> Import PDF
          </button>
        </div>
      </div>

      <div className="hn-lib-grid">
        {folders.map((d) => (
          <div
            key={d.path}
            className="hn-lib-item"
            onClick={() => setPath(d.path)}
            onContextMenu={(e) => folderMenu(e, d)}
            {...longPress((e) => folderMenu(e, d))}
          >
            <div className="hn-lib-folder">
              <Icon name="folder" />
            </div>
            <div className="hn-lib-name">{d.name}</div>
            <div className="hn-lib-meta">{countNotebooks(d)} notebook{countNotebooks(d) === 1 ? "" : "s"}</div>
          </div>
        ))}
        {notebooks.map((f) => {
          const info = infos[f.path];
          return (
            <div
              key={f.path}
              className="hn-lib-item"
              onClick={() => open(f)}
              onContextMenu={(e) => notebookMenu(e, f)}
              {...longPress((e) => notebookMenu(e, f))}
            >
              <div className="hn-lib-cover" style={{ ["--hn-cover" as string]: info?.cover ?? "#868e96" }}>
                {info?.image ? (
                  <img src={info.image} alt="" />
                ) : (
                  <>
                    <span className="hn-lib-spine" />
                    <span className="hn-lib-label">{f.basename}</span>
                  </>
                )}
              </div>
              <div className="hn-lib-name">{f.basename}</div>
              <div className="hn-lib-meta">
                {info ? `${info.pages} page${info.pages === 1 ? "" : "s"} · ` : ""}
                {new Date(f.stat.mtime).toLocaleDateString()}
              </div>
            </div>
          );
        })}
        {!folders.length && !notebooks.length && (
          <div className="hn-lib-empty">No notebooks here yet. Tap “New notebook” to start one.</div>
        )}
      </div>
    </div>
  );
}

export class LibraryView extends ItemView {
  private root: Root | null = null;
  private path = "/";

  constructor(leaf: WorkspaceLeaf, private plugin: HandnotePlugin) {
    super(leaf);
  }
  getViewType() {
    return VIEW_TYPE_LIBRARY;
  }
  getDisplayText() {
    return "Notebooks";
  }
  getIcon() {
    return "library";
  }
  async onOpen() {
    this.contentEl.addClass("hn-lib-view");
    this.root = createRoot(this.contentEl);
    this.render();
  }
  private render() {
    this.root?.render(
      <Library
        plugin={this.plugin}
        path={this.path}
        setPath={(p) => {
          this.path = p;
          this.render();
        }}
      />,
    );
  }
  async onClose() {
    this.root?.unmount();
    this.root = null;
  }
}
