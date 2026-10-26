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
  const note = await importPdf(app as never, pdf as never);
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
    await app.vault.createFolder("Deree");
    await app.vault.createFolder("Deree/MIS 2101");
    await mk("Deree/MIS 2101/Lecture notes.handnote", "#3b5bdb", 12);
    await mk("Ideas.handnote", "#e8590c", 3);
    await mk("Gym log.handnote", "#2b8a3e", 1);
    await mk("Reading notes.handnote", "#5f3dc4", 7);
    w.created = [];
    const plugin = { app, createNote: async (f: string) => w.created.push(f), pickPdfToImport: () => {}, setCover: () => {} };
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
} else {
  mount(emptyNote("lined"));
}
