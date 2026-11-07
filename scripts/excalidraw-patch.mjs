/**
 * Build-time patch to Excalidraw (esbuild plugin), used by the plugin build and the tests.
 *
 * Highlights are drawn by Handnote's own under-layer (src/core/under-layer.ts) so they
 * never sit on top of text. Excalidraw must then skip them when drawing the screen —
 * but still draw them in exports. One condition is inserted where Excalidraw draws a
 * freehand stroke; if the code it looks for isn't there (Excalidraw changed), the build
 * fails loudly instead of quietly drawing highlights twice.
 */
import fs from "fs";

// Skip highlights (pen-stroke highlights, and the word highlights on PDFs, which are rectangles).
const SKIP = 'if(!i.isExporting&&globalThis.__hnHideHighlights&&e.customData&&e.customData.hn==="hl")break;';
const SITES = [
  'case"freedraw":{if(he.generateElementShape(e,null),i.isExporting){',
  'case"rectangle":case"diamond":case"ellipse":case"line":case"arrow":case"image":case"text":case"iframe":case"embeddable":{if(he.generateElementShape(e,i),i.isExporting){',
];
const patch = (src) => SITES.reduce((s, site) => s.replace(site, site.replace("{if(he.", `{${SKIP}if(he.`)), src);

export const excalidrawPatch = {
  name: "excalidraw-patch",
  setup(build) {
    let patched = false;
    build.onLoad({ filter: /@excalidraw[\\/]excalidraw[\\/]dist[\\/]prod[\\/]chunk-[A-Z0-9]+\.js$/ }, async (args) => {
      const src = await fs.promises.readFile(args.path, "utf8");
      if (!src.includes('case"freedraw":{if(he.generateElementShape')) return undefined;
      for (const site of SITES)
        if (!src.includes(site)) throw new Error("Handnote: Excalidraw's element renderer changed; update scripts/excalidraw-patch.mjs");
      patched = true;
      return { contents: patch(src), loader: "js" };
    });
    build.onEnd((result) => {
      const prod = (build.initialOptions.conditions ?? []).includes("production");
      if (prod && !patched && !result.errors.length)
        result.errors.push({ text: "Handnote: the Excalidraw highlight patch was not applied (scripts/excalidraw-patch.mjs)" });
    });
  },
};
