import "@excalidraw/excalidraw/index.css";
import "./core/styles.css";
import { App, Notice, Plugin, PluginSettingTab, Setting, TFolder, normalizePath } from "obsidian";

import { FeatureRegistry } from "./core/registry";
import { loadSettings, SettingsStore, type CoreSettings, type Template, type ToolbarStyle } from "./core/settings";
import type { HandnoteFeature } from "./core/types";
import { emptyNote } from "./data";
import { BUILT_IN_FEATURES } from "./features";
import { HandnoteView, VIEW_TYPE_HANDNOTE } from "./view";

/** What other plugins get from `app.plugins.plugins.handnote.api`. */
export interface HandnoteApi {
  version: string;
  registerFeature(feature: HandnoteFeature<any>): () => void;
}

export default class HandnotePlugin extends Plugin {
  store!: SettingsStore;
  registry = new FeatureRegistry();
  api!: HandnoteApi;
  private saveTimer: number | null = null;

  async onload() {
    this.store = new SettingsStore(loadSettings(await this.loadData()), () => this.queueSave());
    BUILT_IN_FEATURES.forEach((f) => this.registry.register(f));

    this.api = {
      version: this.manifest.version,
      registerFeature: (feature) => {
        this.registry.register(feature);
        return () => this.registry.unregister(feature.id);
      },
    };

    this.registerView(VIEW_TYPE_HANDNOTE, (leaf) => new HandnoteView(leaf, this));
    this.registerExtensions(["handnote"], VIEW_TYPE_HANDNOTE);

    const core = () => this.store.get().core;
    this.addRibbonIcon("notebook-pen", "New handwritten note", () => this.createNote(core().notesFolder, "Handwritten"));
    this.addRibbonIcon("sticky-note", "New quick note", () => this.createNote(core().quickNotesFolder, "Quick note"));
    this.addCommand({
      id: "new-note",
      name: "New handwritten note",
      callback: () => this.createNote(core().notesFolder, "Handwritten"),
    });
    this.addCommand({
      id: "new-quick-note",
      name: "New quick note",
      callback: () => this.createNote(core().quickNotesFolder, "Quick note"),
    });
    this.registerEvent(
      this.app.workspace.on("file-menu", (menu, file) => {
        if (!(file instanceof TFolder)) return;
        menu.addItem((item) =>
          item
            .setTitle("New handwritten note")
            .setIcon("notebook-pen")
            .onClick(() => this.createNote(file.path, "Handwritten")),
        );
      }),
    );

    this.addSettingTab(new HandnoteSettingTab(this.app, this));
  }

  onunload() {
    if (this.saveTimer !== null) {
      window.clearTimeout(this.saveTimer);
      void this.saveData(this.store.get());
    }
  }

  private queueSave() {
    if (this.saveTimer !== null) window.clearTimeout(this.saveTimer);
    this.saveTimer = window.setTimeout(() => {
      this.saveTimer = null;
      void this.saveData(this.store.get());
    }, 500);
  }

  private async ensureFolder(path: string) {
    let current = "";
    for (const part of normalizePath(path).split("/").filter(Boolean)) {
      current = current ? `${current}/${part}` : part;
      if (!this.app.vault.getAbstractFileByPath(current)) await this.app.vault.createFolder(current);
    }
  }

  async createNote(folder: string, prefix: string, template: Template = this.store.get().core.defaultTemplate) {
    try {
      const dir = normalizePath(folder || "/");
      if (dir !== "/") await this.ensureFolder(dir);
      const d = new Date();
      const pad = (n: number) => String(n).padStart(2, "0");
      const stamp = `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}.${pad(d.getMinutes())}`;
      const base = dir === "/" ? "" : dir + "/";
      let path = normalizePath(`${base}${prefix} ${stamp}.handnote`);
      for (let i = 2; this.app.vault.getAbstractFileByPath(path); i++) {
        path = normalizePath(`${base}${prefix} ${stamp} (${i}).handnote`);
      }
      const file = await this.app.vault.create(path, emptyNote(template));
      await this.app.workspace.getLeaf(true).openFile(file);
    } catch (e) {
      console.error(e);
      new Notice(`Handnote: couldn't create the note (${(e as Error).message})`);
    }
  }
}

/** Core settings by hand; every feature's settings are generated from its definition. */
class HandnoteSettingTab extends PluginSettingTab {
  constructor(app: App, private plugin: HandnotePlugin) {
    super(app, plugin);
  }

  display() {
    const { containerEl } = this;
    const { store, registry } = this.plugin;
    const s = store.get();
    const setCore = (patch: Partial<CoreSettings>) => store.updateCore(patch);
    containerEl.empty();

    new Setting(containerEl).setName("Notes").setHeading();
    new Setting(containerEl)
      .setName("Handwritten notes folder")
      .addText((t) => t.setValue(s.core.notesFolder).onChange((v) => setCore({ notesFolder: v.trim() })));
    new Setting(containerEl)
      .setName("Quick Notes folder")
      .addText((t) => t.setValue(s.core.quickNotesFolder).onChange((v) => setCore({ quickNotesFolder: v.trim() })));
    new Setting(containerEl).setName("Default paper").addDropdown((d) =>
      d
        .addOptions({ blank: "Blank", lined: "Lined", grid: "Grid", dots: "Dots" })
        .setValue(s.core.defaultTemplate)
        .onChange((v) => setCore({ defaultTemplate: v as Template })),
    );

    new Setting(containerEl).setName("Appearance").setHeading();
    new Setting(containerEl).setName("Toolbar style").addDropdown((d) =>
      d
        .addOptions({ both: "Top bar + curved palette", arc: "Curved palette only", classic: "Top bar only" })
        .setValue(s.core.toolbarStyle)
        .onChange((v) => setCore({ toolbarStyle: v as ToolbarStyle })),
    );
    new Setting(containerEl)
      .setName("Reduce transparency")
      .setDesc("Solid toolbars instead of glass. Turn on if writing feels laggy.")
      .addToggle((t) => t.setValue(s.core.reduceTransparency).onChange((v) => setCore({ reduceTransparency: v })));

    new Setting(containerEl).setName("Features").setHeading();
    for (const f of registry.all()) {
      const enabled = registry.isEnabled(f, store.get());
      const head = new Setting(containerEl).setName(f.name).setDesc(f.description);
      if (f.optional !== false) {
        head.addToggle((t) =>
          t.setValue(enabled).onChange((v) => {
            store.updateFeature(f.id, { enabled: v });
            this.display();
          }),
        );
      }
      if (!enabled || !f.settings?.length) continue;
      const values = registry.settingsOf<Record<string, any>>(f, store.get());
      const box = containerEl.createDiv({ cls: "hn-setting-group" });
      for (const def of f.settings) {
        const row = new Setting(box).setName(def.name);
        if (def.desc) row.setDesc(def.desc);
        const set = (v: unknown) => store.updateFeature(f.id, { [def.key]: v });
        switch (def.type) {
          case "toggle":
            row.addToggle((t) => t.setValue(!!values[def.key]).onChange(set));
            break;
          case "slider":
            row.addSlider((sl) =>
              sl.setLimits(def.min, def.max, def.step).setValue(values[def.key]).setDynamicTooltip().onChange(set),
            );
            break;
          case "dropdown":
            row.addDropdown((d) => d.addOptions(def.options).setValue(String(values[def.key])).onChange(set));
            break;
          case "text":
            row.addText((t) => t.setValue(String(values[def.key] ?? "")).onChange(set));
            break;
        }
      }
    }
  }
}
