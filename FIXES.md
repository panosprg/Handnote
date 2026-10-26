# Fix list

Things to fix in the next batch. Add to it, then fix them all together in one release.

## To fix

1. **Highlighter changes thickness when it straightens.** When a highlight snaps straight, it
   comes out at one fixed thickness instead of the size you picked. It must keep the selected size.
   - Likely cause: the straightening replaces the stroke's pressures with a fixed 0.5
     (`highlighter-behind.ts`, `straighten` → `setStrokePoints(el, line, line.map(() => 0.5))`), so the
     line's thickness no longer matches what was drawn. Check it against every highlighter size
     (3/5/8 mm and the slider), and that the straight line matches the width shown while drawing.

2. **Zooming out stops at full page size.** Pinching out must stop when the page fills the screen
   width (like Goodnotes), not keep shrinking it. Today the minimum is 25 % (`MIN_ZOOM` in `gestures.ts`).
   - Work out the limit from the widest page and the screen width (the `fitWidth` helper in `Paper.tsx`),
     and recalculate it when the iPad rotates or Obsidian's sidebar opens/closes.
   - Make the zoom gently settle at that limit, and apply it to any other zoom-out path too (Excalidraw's own wheel/keyboard zoom).

3. **Rearrange the top bar.** Change the order of the buttons yourself.
   - An "Edit toolbar" mode (long-press an empty spot on the bar, or a button in settings): the buttons
     wiggle, drag one to move it, tap a "−" to hide it, add hidden ones back from a tray, plus a "Reset" button.
   - Works with the Pencil and with a finger. Saved in settings, so it's the same in every notebook,
     and survives updates (new tools from later versions appear at the end, not in random places).
   - Covers everything in the bar: tools, undo/redo, outline, ruler, shapes, notebook.

4. **One Pen button, with the pen type in "Line options"** (from your handwritten note, 26 Oct).
   - The top bar gets a single **Pen** button instead of Pen + Fountain pen side by side.
   - The pen's menu (the one the colour-wheel button opens) gets a **Line options** section with:
     - **Ballpoint**: even line (today's "Pen").
     - **Fountain**: follows Pencil pressure.
     - **Dotted**: `· · · · · ·`
     - **Dashed**: `— — — — —`
   - Each type keeps its own colour and size, like now.
   - Dotted/dashed are new. Excalidraw can't draw handwritten lines dotted or dashed, so Handnote
     has to make them itself (e.g. cut the stroke into dots/dashes when the Pencil lifts, kept as one
     stroke for selecting, erasing and undo). Dot/dash spacing should follow the size.

5. **Quick sizes: only the ones you pick, max 3.** The size dots in the second bar show only the sizes
   you've chosen (up to 3), not the fixed list of 6. You set them in the pen's menu (e.g. tap a size,
   "Pin to bar"). Each pen type/highlighter keeps its own 3. The exact mm chip stays.

6. **Same for the erasers.** One **Eraser** button in the top bar instead of two. Precision /
   object chosen in its menu (like Line options), and its quick sizes are also the ones you pick, max 3.

## Done
