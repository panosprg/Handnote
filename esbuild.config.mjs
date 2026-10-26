import esbuild from "esbuild";
import builtins from "builtin-modules";
import fs from "fs";

const prod = process.argv[2] === "production";

// Trim ~4.5 MB: Excalidraw's non-English UI translations and the Mermaid
// diagram importer are never used by Handnote.
const slim = {
  name: "slim",
  setup(build) {
    build.onResolve({ filter: /^@excalidraw\/mermaid-to-excalidraw$/ }, () => ({ path: "mermaid", namespace: "stub" }));
    build.onLoad({ filter: /.*/, namespace: "stub" }, () => ({
      contents: "export const parseMermaidToExcalidraw = async () => { throw new Error('Mermaid import is disabled in Handnote'); };",
      loader: "js",
    }));
    build.onLoad({ filter: /[\\/]dist[\\/](prod|dev)[\\/]locales[\\/][^\\/]+\.js$/ }, (args) => {
      if (/[\\/]en-[^\\/]+\.js$/.test(args.path)) return undefined;
      return { contents: "export default {};", loader: "js" };
    });
  },
};

await esbuild.build({
  entryPoints: { main: "src/main.ts" },
  bundle: true,
  outdir: "build",
  format: "cjs",
  platform: "browser",
  target: "es2020",
  external: ["obsidian", "electron", "@codemirror/*", "@lezer/*", ...builtins],
  define: {
    "process.env.NODE_ENV": JSON.stringify(prod ? "production" : "development"),
    "process.env.IS_PREACT": "\"false\"",
  },
  conditions: [prod ? "production" : "development"],
  loader: { ".woff2": "dataurl", ".ttf": "dataurl" },
  minify: prod,
  sourcemap: prod ? false : "inline",
  plugins: [slim],
  logLevel: "info",
  legalComments: "none",
});

// Obsidian loads styles.css. Every .css imported by core or a feature is bundled into it.
fs.renameSync("build/main.css", "build/styles.css");
fs.copyFileSync("manifest.json", "build/manifest.json");
