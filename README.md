# Handnote

Handwritten notes for Obsidian, made for iPad + Apple Pencil, built on the Excalidraw engine.

## Install and update on iPad (BRAT)

Updates arrive automatically once this is set up. You only do it once.

1. Put this project in a **public** GitHub repository (e.g. `panosprag/handnote`).
2. In Obsidian on the iPad: Settings → Community plugins → Browse → install **BRAT**, enable it.
3. BRAT → *Add beta plugin* → paste the repo URL → enable **Handnote**.
4. In BRAT's settings, turn on *Auto-update plugins at startup*.

## Releasing a new version (on your computer)

```bash
npm install          # first time only
npm test             # browser tests with real pen/touch input
npm version minor    # 0.2.0 → 0.3.0 (use "patch" for fixes)
git push
```

When the version in `manifest.json` changes on `main`, GitHub Actions builds the plugin and
publishes the release itself (`.github/workflows/release.yml`).
Next time Obsidian starts on the iPad, BRAT installs it. Your notes and settings are untouched.

No GitHub? `npm run build`, then copy `build/main.js`, `build/manifest.json` and
`build/styles.css` into `<vault>/.obsidian/plugins/handnote/` and toggle the plugin off and on.

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
const handnote = this.app.plugins.plugins["handnote"]?.api;
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
