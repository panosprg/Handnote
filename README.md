# Handnote

Handwritten notes for Obsidian, made for iPad + Apple Pencil, built on the Excalidraw engine.

## What it does

- **One folder:** everything Handnote makes lives in `Handnote/` (notebooks and your folders, `Quick Notes`,
  `Attachments` for PDF pages, `Exports` for exported/printed PDFs). Settings → Handnote → Tidy up moves files
  from older versions in.
- **Notebooks with pages** (A4, or the pages of an imported PDF), a library with covers and folders, export to PDF.
- **Pens:** one Pen button with Line options (ballpoint, fountain, dotted, dashed), pencil, highlighter (goes under
  the ink, snaps straight, even width). Sizes are in millimetres on the printed page: pin up to 3 to the second bar,
  exact slider in the pen's menu.
- **Paper:** blank, lined, grid, dots, Cornell, lecture, lines + grid, revision, mind map, isometric, per page.
- **Top bar:** hold any button to rearrange or hide buttons. Green/red dot shows whether the notebook is saved.
- **Print** all pages, the current page or a range (Notebook menu).
- **Fast ink:** the line you're writing is drawn on its own layer straight from the Pencil and handed to
  Excalidraw when you lift it, so writing doesn't lag (about 12× less work per Pencil movement than plain Excalidraw).
- **Erasers:** one Eraser button: precision (only what you rub) or whole strokes, with an un-draw animation; scribble to delete.
- **Writing help:** shape-preserving stabilization, hold-to-snap shapes, ruler, Pencil-tip indicator.
- **Selecting:** lasso and rectangle, one clean outline; selection bar with headings, links and Solve.
- **Headings + outline**, **links to notes**, **maths solving** (the last two kinds of recognition need MyScript keys).
- **Gestures:** one finger scrolls, pinch zooms, two/three-finger tap = undo/redo, swipe up past the last page to add one,
  finger hold or Pencil press-and-hold opens the quick dial.
- If a feature breaks, a message says which one and why (instead of it silently disappearing).

### Handwriting recognition (optional)

Headings-as-text and maths use MyScript, the engine Goodnotes and Nebo use. Make a free account at
developer.myscript.com, create an application, and paste its **Application key** and **HMAC key** into
Settings → Handnote → Handwriting recognition. It needs internet; everything else works offline.

## Install and update on iPad (BRAT)

Updates arrive automatically once this is set up. You only do it once.

1. Put this project in a **public** GitHub repository (e.g. `panosprag/handnote`).
2. In Obsidian on the iPad: Settings → Community plugins → Browse → install **BRAT**, enable it.
3. BRAT → *Add beta plugin* → paste the repo URL → enable **Handnote**.
4. In BRAT's settings, turn on *Auto-update plugins at startup*.

### Plugin id

The plugin id is **`panos-handnote`** (shown as "Handnote (Panos)"). Until 0.7 it was `handnote`, which
is also the id of an unrelated plugin ("HandNote") in Obsidian's plugin directory, so Obsidian's own
update check kept replacing this plugin with that one. Never change the id back. Settings from the old
`handnote` folder are brought over automatically the first time 0.7 starts.

## Releasing a new version (on your computer)

```bash
npm install          # first time only
npm test             # browser tests with real pen/touch input
python3 test/perf.py 4 800 bare   # writing cost vs plain Excalidraw (CPU slowed 4×, 800 strokes on the page)
npm version minor    # 0.2.0 → 0.3.0 (use "patch" for fixes)
git push
```

When the version in `manifest.json` changes on `main`, GitHub Actions builds the plugin and
publishes the release itself (`.github/workflows/release.yml`).
Next time Obsidian starts on the iPad, BRAT installs it. Your notes and settings are untouched.

No GitHub? `npm run build`, then copy `build/main.js`, `build/manifest.json` and
`build/styles.css` into `<vault>/.obsidian/plugins/panos-handnote/` and toggle the plugin off and on.

## How it's built

```
src/
  core/        the small, stable part. Rarely changes.
    Canvas.tsx      Excalidraw + paper + starts/stops features
    context.ts      HandnoteContext: everything a feature can see and do
    types.ts        HandnoteFeature / ToolDef: the plugin's "contract"
    settings.ts     settings, defaults, migrations between versions
    registry.ts     list of features, which are on
    tools.ts        pen, highlighter, object eraser, select, hand
    ui.tsx          shared pieces: ink panel, paper panel, icons
  features/    one file (+ optional .css) per feature. Add, remove, swap freely.
    index.ts        the list of built-in features
  data.ts      .handnote file format (+ file migrations)
  view.tsx     Obsidian view that hosts the canvas
  main.ts      plugin entry: commands, ribbon, settings tab, public API
test/          headless-browser tests (npm test)
```

### Adding a feature

1. Create `src/features/my-feature.tsx`:

```tsx
import { defineFeature } from "../core/types";

export default defineFeature({
  id: "my-feature",                 // never rename: settings are saved under it
  name: "My feature",
  description: "Shown in settings.",
  defaults: { strength: 50 },
  settings: [{ key: "strength", type: "slider", name: "Strength", min: 0, max: 100, step: 5 }],

  // optional: logic, runs per open note, return a cleanup
  setup(ctx, settings) {
    return ctx.events.on("strokeEnd", (stroke, tool) => {
      console.log(tool, "stroke with", stroke.points?.length, "points; strength", settings().strength);
    });
  },

  // optional: UI over the page, a tool on the palette, a section in the pen panel
  // Overlay, tools: [...], InkPanelSection
});
```

2. Add it to the list in `src/features/index.ts`.

It gets an on/off switch and its settings in the settings tab automatically.
If it crashes, only it is switched off for that note; the page keeps working.

**Events** a feature can listen to (`ctx.events.on(...)`): `strokeEnd`, `erased`, `change`, `scroll`, `state`.
**Actions**: `ctx.setTool`, `ctx.setInkColor`, `ctx.undo/redo`, `ctx.elements()`, `ctx.replaceElements()`,
`ctx.toScene/toScreen`, `ctx.setTemplate`, `ctx.togglePanel`, `ctx.featureSettings/updateFeatureSettings`.

### Add-on plugins

A separate Obsidian plugin can add features without touching Handnote at all:

```ts
const handnote = this.app.plugins.plugins["panos-handnote"]?.api;
const remove = handnote?.registerFeature(myFeature);
this.register(() => remove?.());
```

### Changing saved formats safely

- **Settings shape changed** → bump `SETTINGS_VERSION` in `core/settings.ts` and add a step to `MIGRATIONS`.
- **Note file shape changed** → bump `FILE_VERSION` in `data.ts` and add a step to `FILE_MIGRATIONS`.

Never edit an old migration; add a new one.

## Limits worth knowing

- Apple Pencil double-tap and squeeze can't reach Obsidian plugins (iPadOS only gives them to native
  apps). The long-press menu replaces them.
- Drawing runs on web technology inside Obsidian, so pen latency is a little higher than Goodnotes.
