import "@excalidraw/excalidraw/index.css";
import "../src/core/styles.css";
import { createRoot } from "react-dom/client";
import { PDFDocument, rgb, StandardFonts } from "pdf-lib";
import Canvas from "../src/core/Canvas";
import { exportPdf } from "../src/core/export";
import { FeatureRegistry } from "../src/core/registry";
import { loadSettings, SettingsStore } from "../src/core/settings";
import { parseNote, emptyNote } from "../src/data";
import { BUILT_IN_FEATURES } from "../src/features";
import { importPdf } from "../src/pdf-import";
import { fakeApp } from "./fake-app";
import { Library } from "../src/library";
import { useState } from "react";

const w = window as any;
const q = new URLSearchParams(location.search);
w.store = new SettingsStore(loadSettings(q.has("v1") ? JSON.parse(q.get("v1")!) : null), () => {});
w.registry = new FeatureRegistry();
BUILT_IN_FEATURES.forEach((f) => w.registry.register(f));
w.dirty = 0;
w.pagesChanges = 0;
w.PDFDocument = PDFDocument;
w.parseNote = parseNote;

/** Make a 2-page test PDF, import it like the plugin does, and return the note + assets. */
w.makeAndImportPdf = async () => {
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  for (const n of [1, 2]) {
    const page = doc.addPage([595, 842]);
    page.drawText(`Lecture slide ${n}`, { x: 60, y: 760, size: 32, font, color: rgb(0.1, 0.2, 0.5) });
    page.drawRectangle({ x: 60, y: 400, width: 300, height: 200, borderColor: rgb(0.8, 0.2, 0.2), borderWidth: 4 });
  }
  const bytes = await doc.save();
  const app = fakeApp();
  await app.vault.createFolder("Lectures");
  const pdf = await app.vault.createBinary("Lectures/Week 1.pdf", bytes.buffer as ArrayBuffer);
  const note = await importPdf(app as never, pdf as never, { folder: "Handnote", attachments: "Handnote/Attachments" });
  w.fakeApp = app;
  return { path: note.path, json: app.data.get(note.path) };
};

const mount = (raw: string, images: (string | undefined)[] = []) => {
  createRoot(document.getElementById("app")!).render(
    <Canvas
      initial={parseNote(raw, "lined")}
      store={w.store}
      registry={w.registry}
      isDark={q.has("dark")}
      host={{
        notePath: () => "Test.handnote",
        openLink: (l: string) => (w.openedLink = l),
        pickNote: async () => "[[Week 1 summary]]",
        request: async (url: string, init: any) => {
          w.lastRequest = { url, ...init, body: JSON.parse(init.body) };
          const maths = init.headers.Accept === "application/x-latex";
          return { status: 200, text: maths ? "x^{2}-5x+6=0" : "Lecture 1 overview" };
        },
        print: async (pages?: number[]) => {
          const bytes = await exportPdf(w.ctx, pages);
          const doc = await PDFDocument.load(bytes);
          w.printed = { pages: pages ?? null, count: doc.getPageCount() };
        },
        exportPdf: async () => {
          w.exportedPdf = await exportPdf(w.ctx);
        },
      }}
      loadPageImages={async () => images}
      onReady={(api, ctx) => {
        w.api = api;
        if (ctx) w.ctx = ctx;
      }}
      onDirty={() => w.dirty++}
      onTemplateChange={() => {}}
      onPagesChange={() => w.pagesChanges++}
    />,
  );
};

function LibraryDemo({ plugin }: { plugin: any }) {
  const [path, setPath] = useState("/");
  return <Library plugin={plugin} path={path} setPath={setPath} />;
}

if (q.has("library")) {
  (async () => {
    const { json } = await w.makeAndImportPdf();
    const app = w.fakeApp;
    void json;
    const mk = async (p: string, cover: string, pages: number) =>
      app.vault.create(p, JSON.stringify({ handnote: { version: 2, cover, pages: { sizes: Array(pages).fill({ w: 794, h: 1123 }) } } }));
    await app.vault.createFolder("Handnote/Deree");
    await app.vault.createFolder("Handnote/Deree/MIS 2101");
    await mk("Handnote/Deree/MIS 2101/Lecture notes.handnote", "#3b5bdb", 12);
    await mk("Handnote/Ideas.handnote", "#e8590c", 3);
    await mk("Handnote/Gym log.handnote", "#2b8a3e", 1);
    await mk("Handnote/Reading notes.handnote", "#5f3dc4", 7);
    // Files outside the Handnote folder must not show up in the library.
    await mk("Elsewhere.handnote", "#000000", 1);
    w.created = [];
    const plugin = {
      app,
      folders: () => ({ root: "Handnote", quick: "Handnote/Quick Notes", attachments: "Handnote/Attachments", exports: "Handnote/Exports" }),
      createNote: async (f: string) => w.created.push(f),
      pickPdfToImport: (f?: string) => (w.importInto = f),
      setCover: () => {},
    };
    createRoot(document.getElementById("app")!).render(<LibraryDemo plugin={plugin} />);
    w.libraryReady = true;
  })();
} else if (q.has("pdf")) {
  w.makeAndImportPdf().then(async ({ json }: { json: string }) => {
    const note = JSON.parse(json);
    const images: string[] = [];
    for (const a of note.handnote.pdf.assets) {
      const buf = w.fakeApp.data.get(a.path) as ArrayBuffer;
      let s = "";
      new Uint8Array(buf).forEach((b) => (s += String.fromCharCode(b)));
      images.push(`data:image/jpeg;base64,${btoa(s)}`);
    }
    w.importedNote = note;
    mount(json, images);
  });
} else if (q.has("tidy")) {
  // A vault from before 0.9: Handnote files scattered around.
  (async () => {
    const { planTidy, applyTidy } = await import("../src/tidy");
    const app = fakeApp();
    const note = (extra = {}) => emptyNote("lined", extra);
    await app.vault.createFolder("Handwritten");
    await app.vault.createFolder("Handwritten/Deree");
    await app.vault.createFolder("Quick Notes");
    await app.vault.createFolder("Week 1 (pages)");
    await app.vault.createFolder("Notes");
    await app.vault.create("Handwritten/Lecture.handnote", note());
    await app.vault.createBinary("Handwritten/Lecture.pdf", new ArrayBuffer(4));
    await app.vault.create("Handwritten/Deree/MIS.handnote", note());
    await app.vault.create("Quick Notes/Quick note 1.handnote", note());
    await app.vault.createBinary("Week 1 (pages)/page 001.jpg", new ArrayBuffer(4));
    await app.vault.createBinary("Week 1.pdf", new ArrayBuffer(4)); // the PDF the notebook was made from
    await app.vault.createBinary("Week 1 (print).pdf", new ArrayBuffer(4));
    await app.vault.create(
      "Week 1.handnote",
      note({ pdf: { source: "Week 1.pdf", assets: [{ fileId: "a", path: "Week 1 (pages)/page 001.jpg" }] } }),
    );
    await app.vault.create("Notes/Diary.md", "# my own note");
    const core = w.store.get().core;
    w.fakeApp = app;
    w.plan = await planTidy(app as never, core);
    w.runTidy = async () => {
      w.moved = await applyTidy(app as never, w.plan);
      w.paths = [...app.files.keys()].sort();
      w.week1 = JSON.parse(app.data.get("Handnote/Week 1.handnote") as string);
      w.plan2 = await planTidy(app as never, core);
    };
    w.tidyReady = true;
  })();
} else if (q.has("view")) {
  // The real Obsidian view (HandnoteView) on a fake vault: saving, echoes, the saved dot.
  (async () => {
    const { HandnoteView } = await import("../src/view");
    const app = fakeApp();
    const raw = emptyNote("lined");
    const file = await app.vault.create("Test.handnote", raw);
    const plugin = { app, store: w.store, registry: w.registry };
    const view = new HandnoteView({ app } as never, plugin as never);
    (view as any).file = file;
    const host = document.getElementById("app")!;
    view.contentEl.style.cssText = "position:fixed;inset:0";
    host.appendChild(view.contentEl);
    view.setViewData(raw, true);
    w.view = view;
    w.fakeApp = app;
    w.file = file;
    w.fileText = () => app.data.get(file.path);
    const wait = setInterval(() => {
      if (view.ctx) {
        w.ctx = view.ctx;
        w.api = view.ctx.api;
        clearInterval(wait);
      }
    }, 20);
  })();
} else if (q.has("bare")) {
  // Plain Excalidraw, no Handnote: a reference point for performance tests.
  const { Excalidraw } = require("@excalidraw/excalidraw");
  createRoot(document.getElementById("app")!).render(
    <div style={{ position: "fixed", inset: 0 }}>
      <Excalidraw
        initialData={{ appState: { activeTool: { type: "freedraw" }, penMode: true } }}
        excalidrawAPI={(a: any) => { w.api = a; w.ctx = {}; w.registry = { all: () => [] }; w.store = { updateFeature() {} }; }}
      />
    </div>,
  );
} else {
  mount(emptyNote("lined"));
}
