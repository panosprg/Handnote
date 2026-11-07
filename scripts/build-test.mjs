// Test bundle (same Excalidraw patch as the real build).
import esbuild from "esbuild";
import { excalidrawPatch } from "./excalidraw-patch.mjs";

await esbuild.build({
  entryPoints: ["test/harness.tsx"],
  bundle: true,
  outdir: "test/out",
  format: "iife",
  alias: { obsidian: "./test/obsidian-stub.ts" },
  define: { "process.env.NODE_ENV": '"production"', "process.env.IS_PREACT": '"false"' },
  conditions: ["production"],
  jsx: "automatic",
  loader: { ".woff2": "dataurl" },
  plugins: [excalidrawPatch],
  logLevel: "error",
});
