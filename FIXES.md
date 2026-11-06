# Fix list

Things to fix in the next batch. Add to it, then fix them all together in one release.

## To fix

(nothing yet)

## Done

### 0.10.0 (6 Nov 2026)
- PDF annotation: text layer from the PDF (`text.json`, built on first open for older notebooks), highlighter snaps
  to words, colour meanings per notebook (defaults in the panel), key under each page and on exports, search,
  write into the PDF (real highlight annotations, ink, key; rotated pages handled; clean `original.pdf` kept),
  highlights to a Markdown note, export/print of PDF notebooks keep the PDF's real (selectable) pages.
- Fixed: exports cut off the outer half of every stroke, and a straightened highlight on its own vanished from exports.
- Precision eraser removes a word highlight it touches.

### 0.9.0 (28 Oct 2026)
- Everything in one `Handnote` folder (Quick Notes, Attachments, Exports inside); library shows only that folder;
  one-time "Tidy up" offer moves older files in (links updated, imported PDFs left alone, empty old folders removed).
- Fixed: exporting a notebook made from a PDF could overwrite the original PDF (exports now go to Handnote/Exports).

### 0.8.0 (27 Oct 2026)
1. Highlighter keeps its size when it straightens (even width, no pressure).
2. Zoom-out stops when the page fills the screen width.
3. Top bar can be rearranged: hold a button (or Notebook → Edit toolbar), drag, − to hide, Reset.
4. One Pen button; Line options: Ballpoint, Fountain, Dotted, Dashed.
5. Quick sizes: only the ones you pin, max 3.
6. One Eraser button; Precision / Whole strokes in its menu; pinned sizes.
7. Pencil-tip dot = the real line width × zoom.
8. Excalidraw's ☰ button hidden.
9. Study templates: Cornell, Lecture, Lines + grid, Revision, Mind map, Isometric; per page.
10. Paper saved straight away; late sync echoes and unsaved changes can't reset it.
11. Print (all / this page / range) in the Notebook menu.
12. Saved dot: green saved, red unsaved, amber saving, blinking red if saving failed; tap to save.

