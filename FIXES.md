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

7. **Pencil-tip dot = the pen's real size.** The hover dot under the Pencil tip should be exactly as
   wide as the line that pen will draw: the selected mm size × current zoom (so it grows when you zoom in).
   Same colour as the ink, and it updates when the size, pen type or zoom changes. For the highlighter,
   show its width too (a soft bar or ring, not a solid blob). Today it's a fixed-size dot (`cursor.tsx`).

8. **Remove the ☰ button at the top-left of the page.** It's Excalidraw's own main menu
   (`.main-menu-trigger`) leaking through. Hide it in Handnote mode (keep it only when "Shapes and text"
   / native Excalidraw UI is on). Check nothing needed is only reachable from it (export, dark mode and
   clear page already live in Handnote's own menus).

9. **More page templates (study).** (Planning templates dropped on 26 Oct.) Today there are blank, lined, grid and dots.
   From a quick look at what Goodnotes/Paperlike template packs offer, add:
   - **Cornell notes**: cue column on the left, notes on the right, summary box at the bottom.
     It's the most recommended study layout.
   - **Lecture notes**: header row (course, topic, date), then lined. For Deree classes.
   - **Two-column**: lines on one side, grid on the other. Good for accounting/maths working next to explanations.
   - **Mind map**: centre bubble on dot paper.
   - **Study / revision sheet**: key terms, formulas, summary, questions to review.
   - **Isometric dots**: for 3D sketches and diagrams.

   Notes for building them:
   - Drawn as vector backgrounds like today's templates, so they're sharp at any zoom and in PDF export/print.
   - Light and dark versions, and the paper picker shows a small preview of each.
   - Per page, not just per notebook: e.g. page 1 a revision sheet, the rest lined.

10. **Remember each notebook's template.** The template you pick must stick to that notebook (and page),
    and come back the same when you reopen it, on any device. Today it can reset.
    - Lead: the choice is passed up (`onTemplateChange` in `view.tsx`) but check that the save
      (`getViewData`) actually writes it, and that opening a note doesn't overwrite it with the default.
    - New notebooks still start with the default template from settings.

11. **Print button in the Notebook menu.**
    - Builds the same PDF as Export (pages + template + ink, PDF backgrounds included) and opens the
      iPad print sheet (AirPrint).
    - Obsidian on iPad can't always print a page directly, so the fallback is: make the PDF, open it,
      and let the share sheet's Print take it.
    - Options: all pages / current page / a page range.

12. **Saved indicator (green / red).** A small dot in the top bar:
    - green = everything is saved;
    - red = unsaved changes (e.g. right after a stroke, until the save lands);
    - Optional: amber while saving.
    - Tap it to save now. If a save fails (e.g. iCloud problem), it stays red and says why.
    - Placed where it never hides the tools (end of the top bar, or next to the page counter).

## Done
