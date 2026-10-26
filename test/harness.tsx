import "@excalidraw/excalidraw/index.css";
import "../src/core/styles.css";
import { createRoot } from "react-dom/client";
import Canvas from "../src/core/Canvas";
import { FeatureRegistry } from "../src/core/registry";
import { loadSettings, SettingsStore } from "../src/core/settings";
import { parseNote, emptyNote } from "../src/data";
import { BUILT_IN_FEATURES } from "../src/features";

const w = window as any;
const q = new URLSearchParams(location.search);
w.store = new SettingsStore(loadSettings(q.has("v1") ? JSON.parse(q.get("v1")!) : null), () => {});
w.registry = new FeatureRegistry();
BUILT_IN_FEATURES.forEach((f) => w.registry.register(f));
w.dirty = 0;
createRoot(document.getElementById("app")!).render(
  <Canvas
    initial={parseNote(emptyNote("lined"), "lined")}
    store={w.store}
    registry={w.registry}
    isDark={q.has("dark")}
    onReady={(api) => (w.api = api)}
    onDirty={() => w.dirty++}
    onTemplateChange={() => {}}
  />,
);
