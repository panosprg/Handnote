/**
 * "Tidy up": moves Handnote files made before 0.9 (scattered around the vault) into
 * the one Handnote folder. Nothing moves without the user saying yes; links to moved
 * notebooks are updated by Obsidian (fileManager.renameFile).
 */
import { normalizePath, TFile, TFolder, type App } from "obsidian";
import { handnoteFolders, type CoreSettings } from "./core/settings";
import { ensureFolder } from "./pdf-import";

export interface TidyMove {
  from: string;
  to: string;
}
export interface TidyPlan {
  notes: TidyMove[];
  /** PDF page-image folders; `note` is where their notebook will be after the move. */
  pages: (TidyMove & { note: string })[];
  exports: TidyMove[];
  /** Old folders to remove if they end up empty. */
  emptyCandidates: string[];
}

const under = (p: string, dir: string) => dir !== "" && dir !== "/" && (p === dir || p.startsWith(dir + "/"));
const parentOf = (p: string) => (p.includes("/") ? p.slice(0, p.lastIndexOf("/")) : "");
const nameOf = (p: string) => p.split("/").pop()!;

export const isEmptyPlan = (p: TidyPlan) => !p.notes.length && !p.pages.length && !p.exports.length;

export async function planTidy(app: App, core: CoreSettings): Promise<TidyPlan> {
  const dirs = handnoteFolders(core);
  const oldNotes = normalizePath(core.notesFolder || "Handwritten");
  const oldQuick = normalizePath(core.quickNotesFolder || "Quick Notes");
  const taken = new Set<string>();
  const unique = (path: string, isFolder = false) => {
    const ext = isFolder ? "" : path.slice(path.lastIndexOf("."));
    const stem = isFolder ? path : path.slice(0, path.length - ext.length);
    let p = path;
    for (let i = 2; taken.has(p) || app.vault.getAbstractFileByPath(p); i++) p = `${stem} (${i})${ext}`;
    taken.add(p);
    return p;
  };

  const plan: TidyPlan = { notes: [], pages: [], exports: [], emptyCandidates: [] };
  const notes = app.vault.getFiles().filter((f) => f.extension === "handnote" && !under(f.path, dirs.root));
  for (const f of notes) {
    let to: string;
    if (under(f.path, oldQuick) && !under(oldQuick, dirs.root)) to = `${dirs.quick}${f.path.slice(oldQuick.length)}`;
    else if (under(f.path, oldNotes) && !under(oldNotes, dirs.root)) to = `${dirs.root}${f.path.slice(oldNotes.length)}`;
    else to = `${dirs.root}/${f.name}`;
    to = unique(normalizePath(to));
    plan.notes.push({ from: f.path, to });
    plan.emptyCandidates.push(parentOf(f.path));

    let h: { pdf?: { source?: string; assets?: { path: string }[] } } = {};
    try {
      h = JSON.parse(await app.vault.cachedRead(f)).handnote ?? {};
    } catch {
      /* not a readable notebook: just move it */
    }
    // Its PDF page images (one folder for all pages).
    const assetDirs = [...new Set((h.pdf?.assets ?? []).map((a) => parentOf(normalizePath(a.path))))];
    if (assetDirs.length === 1 && !under(assetDirs[0], dirs.root) && app.vault.getAbstractFileByPath(assetDirs[0]) instanceof TFolder) {
      plan.pages.push({ from: assetDirs[0], to: unique(`${dirs.attachments}/${nameOf(assetDirs[0])}`, true), note: to });
      plan.emptyCandidates.push(parentOf(assetDirs[0]));
    }
    // PDFs it exported or printed next to itself (never the PDF it was made from).
    const dir = parentOf(f.path);
    for (const name of [`${f.basename}.pdf`, `${f.basename} (print).pdf`]) {
      const p = normalizePath(dir ? `${dir}/${name}` : name);
      if (p === h.pdf?.source || !(app.vault.getAbstractFileByPath(p) instanceof TFile)) continue;
      plan.exports.push({ from: p, to: unique(`${dirs.exports}/${name}`) });
    }
  }
  plan.emptyCandidates.push(oldNotes, oldQuick);
  plan.emptyCandidates = [...new Set(plan.emptyCandidates.filter((d) => d && d !== "/" && !under(d, dirs.root)))];
  return plan;
}

export async function applyTidy(app: App, plan: TidyPlan): Promise<number> {
  let moved = 0;
  const move = async (from: string, to: string) => {
    const f = app.vault.getAbstractFileByPath(from);
    if (!f) return false;
    await ensureFolder(app, parentOf(to) || "/");
    await app.fileManager.renameFile(f, to);
    moved++;
    return true;
  };
  for (const m of plan.notes) await move(m.from, m.to);
  for (const m of plan.pages) {
    if (!(await move(m.from, m.to))) continue;
    // The notebook stores where its page images are: point it at the new folder.
    const note = app.vault.getAbstractFileByPath(m.note);
    if (note instanceof TFile)
      await app.vault.process(note, (raw) => {
        const j = JSON.parse(raw);
        for (const a of j.handnote?.pdf?.assets ?? []) if (a.path.startsWith(m.from + "/")) a.path = m.to + a.path.slice(m.from.length);
        return JSON.stringify(j, null, 1);
      });
  }
  for (const m of plan.exports) await move(m.from, m.to);
  // Remove old folders left empty (deepest first).
  for (const d of [...plan.emptyCandidates].sort((a, b) => b.split("/").length - a.split("/").length)) {
    let cur = d;
    while (cur) {
      const f = app.vault.getAbstractFileByPath(cur);
      if (!(f instanceof TFolder) || f.children.length) break;
      await app.vault.delete(f);
      cur = parentOf(cur);
    }
  }
  return moved;
}

export function describePlan(p: TidyPlan): string {
  const parts = [
    p.notes.length && `${p.notes.length} notebook${p.notes.length > 1 ? "s" : ""}`,
    p.pages.length && `${p.pages.length} folder${p.pages.length > 1 ? "s" : ""} of PDF pages`,
    p.exports.length && `${p.exports.length} exported PDF${p.exports.length > 1 ? "s" : ""}`,
  ].filter(Boolean);
  return parts.join(", ").replace(/, ([^,]*)$/, " and $1");
}
