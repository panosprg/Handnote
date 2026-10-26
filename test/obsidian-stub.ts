// Minimal stand-in for Obsidian's API so the canvas can run in a plain browser.
const ICONS: Record<string, string> = {
  "pen-line": "✎", highlighter: "▮", eraser: "⌫", "mouse-pointer-2": "➤", hand: "✋",
  "undo-2": "↶", "redo-2": "↷", "pen-tool": "✒", pen: "🖊", pencil: "✏", type: "T", scan: "⬚", eraser: "⌫", notebook: "▤", shapes: "◆", "trash-2": "🗑", lasso: "◌", "more-horizontal": "…", move: "✥", star: "★",
};
export function setIcon(el: HTMLElement, name: string) {
  el.textContent = ICONS[name] ?? "?";
  el.style.fontSize = "18px";
}
