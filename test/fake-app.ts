import { TFile, TFolder } from "obsidian";

/** In-memory vault, enough for the PDF import and the library. */
export function fakeApp() {
  const files = new Map<string, TFile | TFolder>();
  const data = new Map<string, ArrayBuffer | string>();
  const root = new TFolder("/");
  files.set("/", root);
  const parentOf = (p: string) => (files.get(p.includes("/") ? p.slice(0, p.lastIndexOf("/")) : "/") as TFolder) ?? root;
  const add = (f: TFile | TFolder) => {
    files.set(f.path, f);
    const parent = parentOf(f.path);
    f.parent = parent;
    parent.children.push(f);
    return f;
  };
  const vault = {
    getRoot: () => root,
    getAbstractFileByPath: (p: string) => files.get(p) ?? null,
    getFileByPath: (p: string) => (files.get(p) instanceof TFile ? (files.get(p) as TFile) : null),
    getFiles: () => [...files.values()].filter((f): f is TFile => f instanceof TFile),
    createFolder: async (p: string) => add(new TFolder(p)),
    createBinary: async (p: string, d: ArrayBuffer) => {
      data.set(p, d);
      return add(new TFile(p));
    },
    modifyBinary: async (f: TFile, d: ArrayBuffer) => void data.set(f.path, d),
    create: async (p: string, d: string) => {
      data.set(p, d);
      return add(new TFile(p));
    },
    readBinary: async (f: TFile) => data.get(f.path) as ArrayBuffer,
    cachedRead: async (f: TFile) => data.get(f.path) as string,
    adapter: {
      readBinary: async (p: string) => data.get(p) as ArrayBuffer,
      getResourcePath: (p: string) => {
        const d = data.get(p);
        return d instanceof ArrayBuffer ? URL.createObjectURL(new Blob([d], { type: "image/jpeg" })) : "";
      },
    },
    on: () => ({}),
    offref: () => {},
  };
  return { vault, workspace: {}, data, files };
}
