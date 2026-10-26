# Fix list

Things to fix in the next batch. Add to it, then fix them all together in one release.

## To fix

1. **Highlighter changes thickness when it straightens.** When a highlight snaps straight, it
   comes out at one fixed thickness instead of the size you picked. It must keep the selected size.
   - Likely cause: the straightening replaces the stroke's pressures with a fixed 0.5
     (`highlighter-behind.ts`, `straighten` → `setStrokePoints(el, line, line.map(() => 0.5))`), so the
     line's thickness no longer matches what was drawn. Check it against every highlighter size
     (3/5/8 mm and the slider), and that the straight line matches the width shown while drawing.

## Done
