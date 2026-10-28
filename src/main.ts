import "@excalidraw/excalidraw/index.css";
import "./core/styles.css";
import { App, FuzzySuggestModal, Modal, Notice, Plugin, PluginSettingTab, Setting, TFile, TFolder, normalizePath } from "obsidian";

import { FeatureRegistry } from "./core/registry";
import { handnoteFolders, loadSettings, SettingsStore, TEMPLATES, type CoreSettings, type Template } from "./core/settings";
import type { HandnoteFeature } from "./core/types";
import { emptyNote } from "./data";
import { BUILT_IN_FEATURES } from "./features";
import { LibraryView, VIEW_TYPE_LIBRARY } from "./library";
import { ensureFolder, importPdf } from "./pdf-import";
import { applyTidy, describePlan, isEmptyPlan, planTidy, type TidyPlan } from "./tidy";
import { HandnoteView, VIEW_TYPE_HANDNOTE } from "./view";

/** What other plugins get from `app.plugins.plugins["panos-handnote"].api`. */
export interface HandnoteApi {
  version: string;
  registerFeature(feature: HandnoteFeature<any>): () => void;
}

class PdfPicker extends FuzzySuggestModal<TFile> {
  constructor(app: App, private pick: (f: TFile) => void) {
    super(app);
    this.setPlaceholder("Choose a PDF to write on");
  }
  getItems() {
    return this.app.vault.getFiles().filter((f) => f.extension === "pdf");
  }
  getItemText(f: TFile) {
    return f.path;
  }
  onChooseItem(f: TFile) {
    this.pick(f);
  }
}

/** Asks before moving anything. */
class TidyModal extends Modal {
  constructor(app: App, private plan: TidyPlan, private root: string, private onAnswer: (move: boolean) => void) {
    super(app);
  }
  onOpen() {
    const { contentEl } = this;
    this.setTitle("Put all Handnote files in one folder?");
    contentEl.createEl("p", {
      text: `Handnote now keeps everything in the “${this.root}” folder, so your file list stays tidy. It found ${describePlan(this.plan)} elsewhere in your vault.`,
    });
    contentEl.createEl("p", {
      text: "Move them there? Links to your notebooks are updated, and PDFs you imported stay where they are.",
    });
    const row = contentEl.createDiv({ cls: "modal-button-container" });
    row.createEl("button", { text: "Not now" }).onclick = () => {
      this.onAnswer(false);
      this.close();
    };
    const yes = row.createEl("button", { text: "Move them", cls: "mod-cta" });
    yes.onclick = () => {
      this.onAnswer(true);
      this.close();
    };
  }
  onClose() {
    this.contentEl.empty();
  }
}

export default class HandnotePlugin extends Plugin {
  store!: SettingsStore;
  registry = new FeatureRegistry();
  api!: HandnoteApi;
  private saveTimer: number | null = null;

  /**
   * Until 0.7 this plugin's id was "handnote", which is also the id of an unrelated plugin in
   * Obsidian's plugin directory, so Obsidian's updater kept replacing it with that one. The id is
   * now unique; this brings the settings over from the old folder (only if they're ours).
   */
  private async settingsFromOldId(): Promise<unknown> {
    try {
      const path = `${this.app.vault.configDir}/plugins/handnote/data.json`;
      if (!(await this.app.vault.adapter.exists(path))) return null;
      const data = JSON.parse(await this.app.vault.adapter.read(path));
      return data && typeof data === "object" && data.core && data.features ? data : null;
    } catch {
      return null;
    }
  }

  async onload() {
    this.store = new SettingsStore(loadSettings((await this.loadData()) ?? (await this.settingsFromOldId())), () => this.queueSave());
    BUILT_IN_FEATURES.forEach((f) => this.registry.register(f));

    this.api = {
      version: this.manifest.version,
      registerFeature: (feature) => {
        this.registry.register(feature);
        return () => this.registry.unregister(feature.id);
      },
    };

    this.registerView(VIEW_TYPE_HANDNOTE, (leaf) => new HandnoteView(leaf, this));
    this.registerView(VIEW_TYPE_LIBRARY, (leaf) => new LibraryView(leaf, this));
    try {
      this.registerExtensions(["handnote"], VIEW_TYPE_HANDNOTE);
    } catch (e) {
      // Another plugin already opens .handnote files (e.g. the unrelated "HandNote" from the plugin directory).
      new Notice(
        "Handnote: another plugin is already opening .handnote files (probably “HandNote” by another author). Disable or uninstall it, then reload Obsidian. Don't open your notebooks with it: it may save them in its own format.",
        0,
      );
      console.error("Handnote: couldn't register the .handnote file type", e);
    }

    const core = () => this.store.get().core;
    this.addRibbonIcon("library", "Notebooks", () => this.openLibrary());
    this.addRibbonIcon("notebook-pen", "New notebook", () => this.createNote(this.folders().root, "Notebook"));
    this.addRibbonIcon("sticky-note", "New quick note", () => this.createNote(this.folders().quick, "Quick note"));
    this.addCommand({ id: "open-library", name: "Open notebooks library", callback: () => this.openLibrary() });
    this.addCommand({
      id: "new-note",
      name: "New notebook",
      callback: () => this.createNote(this.folders().root, "Notebook"),
    });
    this.addCommand({
      id: "new-quick-note",
      name: "New quick note",
      callback: () => this.createNote(this.folders().quick, "Quick note"),
    });
    this.addCommand({ id: "import-pdf", name: "Write on a PDF", callback: () => this.pickPdfToImport() });
    this.addCommand({ id: "tidy-up", name: "Move all Handnote files into the Handnote folder", callback: () => void this.tidyUp(true) });
    // Once, after updating: offer to move files from older versions into the one folder.
    this.app.workspace.onLayoutReady(() => {
      if (!this.store.get().core.tidyOffered) window.setTimeout(() => void this.tidyUp(false), 1500);
    });
    this.addCommand({
      id: "export-pdf",
      name: "Export notebook as PDF",
      checkCallback: (checking) => {
        const view = this.app.workspace.getActiveViewOfType(HandnoteView);
        if (!view?.ctx) return false;
        if (!checking) void view.ctx.host.exportPdf();
        return true;
      },
    });
    this.registerEvent(
      this.app.workspace.on("file-menu", (menu, file) => {
        if (file instanceof TFolder) {
          menu.addItem((item) =>
            item
              .setTitle("New notebook")
              .setIcon("notebook-pen")
              .onClick(() => this.createNote(file.path, "Notebook")),
          );
        } else if (file instanceof TFile && file.extension === "pdf") {
          menu.addItem((item) =>
            item
              .setTitle("Write on this PDF")
              .setIcon("notebook-pen")
              .onClick(() => this.annotatePdf(file)),
          );
        }
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

  /** Where Handnote's files go (all inside one folder). */
  folders() {
    return handnoteFolders(this.store.get().core);
  }

  /** Offer (or run, from settings / the command) the move into the Handnote folder. */
  async tidyUp(fromUser: boolean) {
    const core = this.store.get().core;
    const plan = await planTidy(this.app, core);
    if (isEmptyPlan(plan)) {
      if (!core.tidyOffered) this.store.updateCore({ tidyOffered: true });
      if (fromUser) new Notice(`Handnote: everything is already in the “${this.folders().root}” folder.`);
      return;
    }
    new TidyModal(this.app, plan, this.folders().root, async (move) => {
      this.store.updateCore({ tidyOffered: true });
      if (!move) {
        new Notice("Handnote: OK. You can do it any time from Settings → Handnote.");
        return;
      }
      const n = new Notice("Handnote: moving files…", 0);
      try {
        const moved = await applyTidy(this.app, plan);
        n.hide();
        new Notice(`Handnote: moved ${moved} item${moved === 1 ? "" : "s"} into “${this.folders().root}”.`);
      } catch (e) {
        n.hide();
        console.error(e);
        new Notice(`Handnote: couldn't move everything (${(e as Error).message}). Nothing was deleted.`);
      }
    }).open();
  }

  async openLibrary() {
    await this.ensureFolder(this.folders().root);
    const existing = this.app.workspace.getLeavesOfType(VIEW_TYPE_LIBRARY)[0];
    const leaf = existing ?? this.app.workspace.getLeaf("tab");
    if (!existing) await leaf.setViewState({ type: VIEW_TYPE_LIBRARY, active: true });
    this.app.workspace.revealLeaf(leaf);
  }

  pickPdfToImport(folder?: string) {
    new PdfPicker(this.app, (f) => this.annotatePdf(f, folder)).open();
  }

  async annotatePdf(pdf: TFile, folder?: string) {
    const notice = new Notice(`Handnote: preparing "${pdf.basename}"…`, 0);
    try {
      const dirs = this.folders();
      const file = await importPdf(this.app, pdf, { folder: folder ?? dirs.root, attachments: dirs.attachments }, (n, total) =>
        notice.setMessage(`Handnote: preparing page ${n} of ${total}…`),
      );
      notice.hide();
      await this.app.workspace.getLeaf("tab").openFile(file);
    } catch (e) {
      notice.hide();
      console.error(e);
      new Notice(`Handnote: couldn't open the PDF (${(e as Error).message})`);
    }
  }

  /** Change a notebook's cover colour (library). */
  async setCover(file: TFile, colour: string) {
    await this.app.vault.process(file, (raw) => {
      const j = JSON.parse(raw);
      j.handnote = { ...(j.handnote ?? {}), cover: colour };
      return JSON.stringify(j, null, 1);
    });
  }

  private async ensureFolder(path: string) {
    await ensureFolder(this.app, path);
  }

  async createNote(folder: string, prefix: string, template: Template = this.store.get().core.defaultTemplate, open = true) {
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
      if (open) await this.app.workspace.getLeaf(true).openFile(file);
      return file;
    } catch (e) {
      console.error(e);
      new Notice(`Handnote: couldn't create the notebook (${(e as Error).message})`);
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
      .setName("Handnote folder")
      .setDesc("Everything Handnote makes goes in this one folder: notebooks, Quick Notes, PDF pages (Attachments) and exported PDFs (Exports).")
      .addText((t) =>
        t.setValue(s.core.rootFolder).onChange((v) => setCore({ rootFolder: v.trim().replace(/^\/+|\/+$/g, "") || "Handnote" })),
      );
    new Setting(containerEl)
      .setName("Tidy up")
      .setDesc("Move Handnote files that are elsewhere in your vault (from older versions) into the Handnote folder.")
      .addButton((b) => b.setButtonText("Move them").onClick(() => void this.plugin.tidyUp(true)));
    new Setting(containerEl).setName("Default paper").addDropdown((d) =>
      d
        .addOptions(Object.fromEntries(TEMPLATES.map((t) => [t.id, t.name])))
        .setValue(s.core.defaultTemplate)
        .onChange((v) => setCore({ defaultTemplate: v as Template })),
    );

    new Setting(containerEl).setName("Appearance").setHeading();
    new Setting(containerEl)
      .setName("Reduce transparency")
      .setDesc("Solid toolbars instead of glass. Turn on if writing feels laggy.")
      .addToggle((t) => t.setValue(s.core.reduceTransparency).onChange((v) => setCore({ reduceTransparency: v })));
    new Setting(containerEl)
      .setName("Fast ink")
      .setDesc("Draws the line you're writing on its own layer, so the ink keeps up with the Pencil. Leave on unless something looks wrong while writing.")
      .addToggle((t) => t.setValue(s.core.fastInk).onChange((v) => setCore({ fastInk: v })));

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
