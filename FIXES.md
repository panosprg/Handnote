# Fix list

Things to fix in the next batch. Add to it, then fix them all together in one release.

## To fix

(nothing yet)

## Done

### 0.12.0 (8 Nov 2026)
- Fixed: after the first Pencil stroke, fingers stopped working (the pen code swallowed the Pencil's lift, so
  Handnote thought the Pencil was still down and treated every finger as a palm). The Pencil is now tracked
  before any tool sees its events, and "Pencil down" expires by itself after 3 s without Pencil activity.
- Fingers scroll and zoom in every tool (lasso and select too), except the text tool.
- Goodnotes-style view: the notebook fills the width, centred, and can't be pushed off screen; pinch to zoom in
  and move around inside the pages; zooming out snaps back to the full width.
- Text under highlights drawn darker (handwriting and PDF text), without relying on CSS blending. Setting:
  "Darker text under highlights".
- Tests no longer reset Handnote's state before finger gestures (that hid the bug above).

### 0.11.1 (7 Nov 2026)
- Fixed: 0.11.0 ignored most finger touches on iPad (fingertips report large contact sizes, and a hovering
  Pencil counted as "in use"). Palm rejection now only uses timing: 0.5 s after the Pencil leaves the screen.
- "Smooth scrolling" switch in settings (off = old behaviour).

### 0.11.0 (7 Nov 2026)
- Words deleted by accident, four causes fixed:
  - Palm rejection: touches while/just after using the Pencil, or palm-sized contacts, do nothing.
  - A touch iPadOS cancels never counts as a two-finger tap (used to run Undo).
  - Scribble-to-delete only on real scribbles (must cross existing ink ≥4 times and cover it); never
    on joined-up writing near an i-dot or accent.
  - Long-press dial never opens from a palm, and never picks a tool on a cancelled or un-slid release.
  - Sync: a late, older copy of the file is merged stroke by stroke (newest wins), never reloaded over your writing.
  - Every gesture undo / scribble delete shows a message with Undo/Redo.
- Smooth scrolling and zooming: a snapshot moves while the finger moves; one real redraw when it stops.
  (Throttled test, 1,500 strokes: scroll 102 → ~31 ms per move incl. redraws, pinch 432 → 73 ms; laggy frames 122 → 8.)
- Text under highlights stays dark on iPad: highlights are drawn on their own layer under the ink with the
  canvas's own multiply (iPad Safari ignores the CSS blend: WebKit bug 286619). Covers pen highlights and
  0.10's PDF word highlights. Exports unchanged.
- Colour menu never goes off screen (scrolls inside in landscape); tapping the page closes it (a Pencil tap
  that closes it doesn't draw).
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

