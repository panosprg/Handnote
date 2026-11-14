"""Drives Handnote in headless Chromium with real (trusted) pen and touch input
via the DevTools protocol, then checks behaviour. Usage: python3 test/run.py [shots_dir]"""
import json, math, random, sys, pathlib, urllib.parse
from playwright.sync_api import sync_playwright

HERE = pathlib.Path(__file__).parent
URL = (HERE / "index.html").as_uri()
OUT = pathlib.Path(sys.argv[1]) if len(sys.argv) > 1 else HERE / "shots"
OUT.mkdir(parents=True, exist_ok=True)
results = []

def check(name, ok, detail=""):
    results.append((name, ok))
    print(("PASS " if ok else "FAIL ") + name + (f"  ({detail})" if detail else ""))

def pen_down(cdp, x, y):
    cdp.send("Input.dispatchMouseEvent", {"type": "mouseMoved", "x": x, "y": y, "pointerType": "pen"})
    cdp.send("Input.dispatchMouseEvent", {"type": "mousePressed", "x": x, "y": y, "button": "left", "buttons": 1, "clickCount": 1, "pointerType": "pen", "force": 0.5})

def pen_move(cdp, x, y, force=0.5):
    cdp.send("Input.dispatchMouseEvent", {"type": "mouseMoved", "x": x, "y": y, "button": "left", "buttons": 1, "pointerType": "pen", "force": force})

def pen_up(cdp, x, y):
    cdp.send("Input.dispatchMouseEvent", {"type": "mouseReleased", "x": x, "y": y, "button": "left", "buttons": 0, "clickCount": 1, "pointerType": "pen"})

def pen_stroke(cdp, pts, page, delay=8, settle=150, forces=None):
    pen_down(cdp, *pts[0])
    for i, (x, y) in enumerate(pts[1:]):
        pen_move(cdp, x, y, forces[i + 1] if forces else 0.5)
        page.wait_for_timeout(delay)
    pen_up(cdp, *pts[-1])
    page.wait_for_timeout(settle)

def hover(cdp, x, y):
    cdp.send("Input.dispatchMouseEvent", {"type": "mouseMoved", "x": x, "y": y, "button": "none", "buttons": 0, "pointerType": "pen"})

def touch(cdp, kind, points, page=None, radius=None, fresh=True):
    # A finger put down well after the Pencil was used (palm rejection ignores touches right after writing).
    if kind == "touchStart" and CURRENT_PAGE.get("page") is not None and fresh and not CURRENT_PAGE.get("down"):
        # No resetting of Handnote's state (that once hid a real bug): just wait like a real hand
        # (only before the first finger: the fingers of a pinch land together).
        CURRENT_PAGE["page"].wait_for_timeout(560)
    CURRENT_PAGE["down"] = len(points) if kind in ("touchStart", "touchMove") else (len(points) if kind == "touchEnd" else 0)
    pts = []
    for i, (x, y) in points:
        tp = {"x": x, "y": y, "id": i}
        if radius:
            tp.update({"radiusX": radius, "radiusY": radius})
        pts.append(tp)
    cdp.send("Input.dispatchTouchEvent", {"type": kind, "touchPoints": pts})

CURRENT_PAGE = {}

def line(x0, y0, x1, y1, n=40):
    return [(x0 + (x1 - x0) * i / (n - 1), y0 + (y1 - y0) * i / (n - 1)) for i in range(n)]

def els(page):
    return page.evaluate("api.getSceneElements().map(e => ({id: e.id, type: e.type, hl: e.customData?.hn === 'hl', n: e.points?.length, g: e.groupIds}))")

def last_freedraw(page):
    return page.evaluate("""() => { const a = api.getSceneElements().filter(e => e.type === 'freedraw');
        const e = a[a.length-1]; return e ? {id: e.id, pts: e.points.map(p => [p[0]+e.x, p[1]+e.y]), pr: e.pressures, sim: e.simulatePressure} : null }""")

def roughness(pts):
    ys = [p[1] for p in pts]
    return sum(abs(ys[i+1] - 2*ys[i] + ys[i-1]) for i in range(1, len(ys)-1)) / max(1, len(ys) - 2)

def wobbly(x0, x1, y, n=70, amp=3.0, seed=1):
    r = random.Random(seed)
    return [(x0 + (x1-x0)*i/(n-1), y + r.uniform(-amp, amp)) for i in range(n)]

def tool(page):
    return page.evaluate("document.querySelector('.hn-toolbar .hn-btn.is-active')?.getAttribute('aria-label')")

# Pen types and erasers share one toolbar button each; tests pick the exact one directly.
TOOL_IDS = {"Fountain pen": "pen", "Ballpoint": "ballpoint", "Precision eraser": "precision-eraser",
            "Object eraser": "object-eraser", "Dotted pen": "dotted", "Dashed pen": "dashed"}

def tap(page, label):
    if label in TOOL_IDS:
        page.evaluate(f"(id => {{ if (ctx.state.tool !== id) ctx.setTool(id); }})('{TOOL_IDS[label]}')")
    else:
        page.click(f".hn-toolbar button[aria-label='{label}']")
    page.wait_for_timeout(120)

def undo(page):
    tap(page, "Undo"); page.wait_for_timeout(100)

with sync_playwright() as p:
    browser = p.chromium.launch()

    def open_page(query="", free_zoom=True, ready="window.api !== undefined"):
        ctx = browser.new_context(viewport={"width": 1180, "height": 820}, has_touch=True, device_scale_factor=2)
        page = ctx.new_page()
        errors = []
        page.on("pageerror", lambda e: errors.append(str(e)))
        page.on("console", lambda m: m.type == "error" and errors.append("console: " + m.text))
        page.goto(URL + query)
        page.wait_for_function(ready, timeout=30000)
        page.wait_for_timeout(700)
        CURRENT_PAGE["page"] = page
        # Most checks draw at 100% zoom; the zoom-out limit (page fills the width) has its own test.
        if free_zoom:
            page.evaluate("window.ctx && (ctx.minZoom = () => 0.25, ctx.clampView = (v) => v)")
        return ctx, page, ctx.new_cdp_session(page), errors

    # ---------- pages: new notebook opens fitted to the screen ----------
    ctx, page, cdp, errors = open_page()
    z = page.evaluate("api.getAppState().zoom.value")
    check("new notebook fits the page width", abs(z - (1180 - 48) / 794) < 0.02, f"zoom {z:.2f}")
    check("one A4 page to start", page.locator(".hn-sheet").count() == 1 and page.inner_text(".hn-page-counter").strip() == "1 / 1")
    page.screenshot(path=str(OUT / "page.png"))
    page.click("button.hn-add-page"); page.wait_for_timeout(200)
    check("add page button adds a page", page.locator(".hn-sheet").count() == 2 and page.evaluate("ctx.state.pages.sizes.length") == 2)
    check("…and saves it", page.evaluate("window.pagesChanges") == 1)
    # write on page 1 and 2, then export
    tap(page, "Fountain pen")
    pen_stroke(cdp, line(300, 200, 700, 260, 30), page)
    page.evaluate("api.updateScene({appState: {scrollY: api.getAppState().scrollY - 1123}})"); page.wait_for_timeout(100)
    pen_stroke(cdp, line(300, 300, 700, 300, 30), page)
    page.click(".hn-toolbar [aria-label='Notebook']"); page.wait_for_timeout(200)
    page.screenshot(path=str(OUT / "notebook-panel.png"))
    page.click("button.hn-chip:has-text('Export / print')"); page.wait_for_timeout(150)
    page.click(".hn-panel button[aria-label='Save PDF']")
    try:
        page.wait_for_function("window.exportedPdf !== undefined", timeout=20000)
    except Exception:
        print("EXPORT TIMEOUT", errors[-5:])
        raise
    info = page.evaluate("""(async () => { const d = await PDFDocument.load(window.exportedPdf);
        return {n: d.getPageCount(), w: d.getPage(0).getWidth(), h: d.getPage(0).getHeight(), bytes: window.exportedPdf.length} })()""")
    check("export makes a PDF with one A4 page per notebook page", info["n"] == 2 and abs(info["w"] - 595.5) < 1 and abs(info["h"] - 842.25) < 1, str(info))
    # render page 1 back to check the ink is on it
    ink = page.evaluate("""(async () => { const { renderPage } = window; return null })()""")
    check("no JavaScript errors (pages)", not errors, "; ".join(errors[:3]))
    ctx.close()

    # ---------- PDF annotation ----------
    ctx, page, cdp, errors = open_page("?pdf")
    page.wait_for_function("window.importedNote !== undefined", timeout=30000)
    page.wait_for_timeout(800)
    note = page.evaluate("window.importedNote")
    check("PDF import makes one notebook page per PDF page", len(note["handnote"]["pages"]["sizes"]) == 2
          and note["handnote"]["pages"]["sizes"][0] == {"w": 793, "h": 1123}, str(note["handnote"]["pages"]["sizes"]))
    check("PDF page images go in Handnote/Attachments (not next to the PDF)",
          all(a["path"].startswith("Handnote/Attachments/Week 1 pages/") for a in note["handnote"]["pdf"]["assets"]),
          note["handnote"]["pdf"]["assets"][0]["path"])
    imgs = page.evaluate("[...document.querySelectorAll('.hn-sheet-img')].map(i => i.complete && i.naturalWidth > 0)")
    check("PDF pages show as the paper", imgs == [True, True], str(imgs))
    # find the PDF title text on screen ("Lecture slide 1", dark blue) and highlight over it
    box = page.evaluate("(() => { const r = document.querySelector('.hn-sheet-img').getBoundingClientRect(); return [r.x, r.y, r.width] })()")
    sx = box[2] / 793
    tx, ty = box[0] + 100 * sx, box[1] + 110 * sx  # inside the title text area
    page.screenshot(path=str(OUT / "pdf-before.png"))
    tap(page, "Highlighter")
    pen_stroke(cdp, line(box[0] + 70 * sx, ty, box[0] + 560 * sx, ty, 30), page)
    tap(page, "Fountain pen")
    pen_stroke(cdp, line(150, 300, 500, 330, 30), page)
    page.screenshot(path=str(OUT / "pdf.png"))
    from PIL import Image
    def darkest(path, x, y, w=int(440 * sx), h=24):
        im = Image.open(path).convert("L")
        s = 2  # device scale
        return min(im.getpixel((int(x * s) + i, int(y * s) + j)) for i in range(0, w * s, 3) for j in range(-h, h, 3))
    before = darkest(str(OUT / "pdf-before.png"), box[0] + 80 * sx, ty)
    after = darkest(str(OUT / "pdf.png"), box[0] + 80 * sx, ty)
    check("highlighting PDF text keeps the text dark", after <= before + 25, f"darkest pixel {before} → {after}")
    tap(page, "Object eraser")
    pen_stroke(cdp, line(100, 500, 700, 520, 30), page)
    check("erasers never touch the PDF page", page.locator(".hn-sheet-img").count() == 2)
    check("no JavaScript errors (PDF)", not errors, "; ".join(errors[:3]))
    ctx.close()

    ctx, page, cdp, errors = open_page()
    page.evaluate("api.updateScene({appState: {zoom: {value: 1}, scrollX: 0, scrollY: 0}})")
    page.wait_for_timeout(150)

    # ---------- toolbar ----------
    labels = page.evaluate("[...document.querySelectorAll('.hn-toolbar .hn-btn')].map(b => b.getAttribute('aria-label'))")
    want = ["Pen", "Pencil", "Highlighter", "Eraser", "Lasso", "Rectangle select", "Text"]
    check("top bar has every tool", all(t in labels for t in want), ", ".join(l for l in labels if l))
    check("curved palette is gone", page.locator(".hn-arc").count() == 0)
    check("one Pen and one Eraser button (pen types / eraser types are in their menus)",
          labels.count("Pen") == 1 and "Fountain pen" not in labels and labels.count("Eraser") == 1 and "Object eraser" not in labels, ", ".join(l for l in labels if l))
    check("Pen is active on open", tool(page) == "Pen", str(tool(page)))
    check("second bar: colours and only the 3 pinned sizes", page.locator(".hn-optionsbar .hn-size-quick").count() == 3 and page.locator(".hn-optionsbar .hn-fav-quick").count() >= 4)
    check("Excalidraw's ☰ menu button is hidden", page.evaluate("(() => { const b = document.querySelector('.main-menu-trigger'); return !b || b.getBoundingClientRect().width === 0 })()"))
    check("saved dot shows green on open", page.locator(".hn-toolbar .hn-save.is-saved").count() == 1)
    check("no panel open on load", page.locator(".hn-panel").count() == 0)

    # ---------- pen hover dot ----------
    hover(cdp, 600, 400); page.wait_for_timeout(80)
    dot = page.evaluate("(() => { const c = document.querySelector('.hn-cursor'); const r = c.getBoundingClientRect(); return {d: c.style.display, cls: c.className, cx: r.x + r.width/2, cy: r.y + r.height/2} })()")
    check("pen hover shows a dot under the tip", dot["d"] == "block" and "dot" in dot["cls"] and abs(dot["cx"] - 600) < 1.5 and abs(dot["cy"] - 400) < 1.5, str(dot))

    # ---------- ballpoint ----------
    tap(page, "Ballpoint")
    pen_stroke(cdp, line(250, 180, 700, 180, 40), page, forces=[0.2 + 0.7 * (i % 7) / 6 for i in range(40)])
    bp = last_freedraw(page)
    check("ballpoint ignores pressure (even line)", max(bp["pr"]) - min(bp["pr"]) < 1e-3 and not bp["sim"], f"{min(bp['pr'])}..{max(bp['pr'])}")
    tap(page, "Fountain pen")
    pen_stroke(cdp, line(250, 220, 700, 220, 40), page, forces=[0.2 + 0.7 * (i % 7) / 6 for i in range(40)])
    fp = last_freedraw(page)
    check("fountain pen keeps its pressure response (not forced even)", fp["sim"] or len(set(fp["pr"])) > 1)

    # ---------- pencil ----------
    tap(page, "Pencil")
    st = page.evaluate("(() => { const s = api.getAppState(); return [s.currentItemStrokeColor, s.currentItemOpacity] })()")
    check("pencil: graphite colour, softer", st == ["#4a4a52", 75], str(st))
    tap(page, "Fountain pen")

    # ---------- stabilization keeps shapes ----------
    page.evaluate("store.updateFeature('stabilizer', {writing: 0})")
    pen_stroke(cdp, wobbly(250, 750, 280), page)
    raw = last_freedraw(page)
    page.evaluate("store.updateFeature('stabilizer', {writing: 80})")
    pen_stroke(cdp, wobbly(250, 750, 320), page)
    smooth = last_freedraw(page)
    check("stabilization removes wobble", roughness(smooth["pts"]) < roughness(raw["pts"]) * 0.5,
          f"{roughness(raw['pts']):.2f} → {roughness(smooth['pts']):.2f}")
    # a small "o": radius must survive smoothing
    circ = [(400 + 9 * math.cos(t / 40 * 2 * math.pi), 380 + 9 * math.sin(t / 40 * 2 * math.pi)) for t in range(41)]
    pen_stroke(cdp, circ, page, delay=6)
    o = last_freedraw(page)["pts"]
    cx = sum(p[0] for p in o) / len(o); cy = sum(p[1] for p in o) / len(o)
    r = sum(math.hypot(p[0] - cx, p[1] - cy) for p in o) / len(o)
    check("a small 'o' keeps its size (shape preserved)", r > 7.5, f"radius {r:.1f} of 9")
    page.evaluate("store.updateFeature('stabilizer', {writing: 35})")

    # ---------- hold to snap ----------
    rough_line = [(300 + i * 6, 430 + random.Random(i).uniform(-4, 4)) for i in range(45)]
    pen_down(cdp, *rough_line[0])
    for x, y in rough_line[1:]:
        pen_move(cdp, x, y); page.wait_for_timeout(8)
    page.wait_for_timeout(750)  # hold still
    snapped = last_freedraw(page)
    pen_up(cdp, *rough_line[-1]); page.wait_for_timeout(150)
    s_pts = last_freedraw(page)["pts"]
    dev = max(abs(p[1] - (s_pts[0][1] + (s_pts[-1][1] - s_pts[0][1]) * (p[0] - s_pts[0][0]) / ((s_pts[-1][0] - s_pts[0][0]) or 1))) for p in s_pts)
    check("hold at the end snaps a line straight", dev < 0.6, f"max deviation {dev:.2f}")
    ell = [(800 + 60 * math.cos(t / 50 * 2 * math.pi) + random.Random(t).uniform(-4, 4), 450 + 35 * math.sin(t / 50 * 2 * math.pi)) for t in range(52)]
    pen_down(cdp, *ell[0])
    for x, y in ell[1:]:
        pen_move(cdp, x, y); page.wait_for_timeout(8)
    page.wait_for_timeout(750)
    pen_up(cdp, *ell[-1]); page.wait_for_timeout(150)
    e_pts = last_freedraw(page)["pts"]
    err = sum(abs(math.hypot((p[0] - 800) / 60, (p[1] - 450) / 35) - 1) for p in e_pts) / len(e_pts)
    check("hold snaps an ellipse", err < 0.08 and len(e_pts) >= 48, f"error {err:.3f}, {len(e_pts)} pts")
    page.screenshot(path=str(OUT / "shapes.png"))

    # ---------- erasers ----------
    pen_stroke(cdp, line(300, 520, 700, 520, 60), page)
    target = last_freedraw(page)["id"]
    n0 = len(els(page))
    tap(page, "Precision eraser")
    pen_down(cdp, 500, 480)
    for y in range(482, 562, 4):
        pen_move(cdp, 500, y); page.wait_for_timeout(8)
    ring = page.evaluate("(() => { const c = document.querySelector('.hn-cursor'); const r = c.getBoundingClientRect(); return {cls: c.className, cx: r.x + r.width/2, cy: r.y + r.height/2, w: r.width} })()")
    pen_up(cdp, 500, 558); page.wait_for_timeout(150)
    check("eraser ring sits exactly under the Pencil", "ring" in ring["cls"] and abs(ring["cx"] - 500) < 1.5 and abs(ring["cy"] - 558) < 1.5,
          f"ring centre ({ring['cx']:.1f}, {ring['cy']:.1f}) vs pencil (500, 558)")
    after = els(page)
    check("precision eraser splits the stroke", len(after) == n0 + 1, f"{n0} → {len(after)}")
    undo(page)
    check("precision erase is one undo step", len(els(page)) == n0)

    tap(page, "Object eraser")
    pen_stroke(cdp, line(450, 490, 470, 550, 12), page, settle=60)
    page.wait_for_timeout(60)
    ghosts = page.locator(".hn-ghost").count()
    page.wait_for_timeout(800)
    check("object eraser removes the whole stroke", target not in [e["id"] for e in els(page)])
    check("…with the un-draw animation", ghosts >= 1)
    undo(page)
    check("object erase is one undo step", target in [e["id"] for e in els(page)])

    # ---------- highlighter: straight + behind ----------
    tap(page, "Fountain pen")
    pen_stroke(cdp, [(300 + k * 6, 600 + 8 * math.sin(k)) for k in range(60)], page)
    ink = last_freedraw(page)["id"]
    tap(page, "Highlighter")
    pen_stroke(cdp, [(290 + i * 9, 603 + random.Random(i).uniform(-5, 5)) for i in range(42)], page)
    ys = page.evaluate("(() => { const e = api.getSceneElements().filter(e => e.customData?.hn === 'hl').pop(); return e.points.map(p => p[1] + e.y) })()")
    check("highlighter stroke comes out straight", max(ys) - min(ys) < 0.01, f"height {max(ys) - min(ys):.2f}")
    order = els(page)
    check("highlighter sits behind the writing", order[0]["hl"] and [e["id"] for e in order].index(ink) > 0)
    page.screenshot(path=str(OUT / "highlight.png"), clip={"x": 250, "y": 560, "width": 460, "height": 90})

    # ---------- lasso + clean selection ----------
    tap(page, "Fountain pen")
    pen_stroke(cdp, [(820 + k * 3, 250 + 14 * math.sin(k / 2)) for k in range(30)], page)
    pen_stroke(cdp, [(830 + k * 3, 290 + 14 * math.cos(k / 2)) for k in range(30)], page)
    w1, w2 = [e["id"] for e in els(page)][-2:]
    tap(page, "Lasso")
    loop = [(790 + 90 + 85 * math.cos(t / 30 * 2 * math.pi), 272 + 55 * math.sin(t / 30 * 2 * math.pi)) for t in range(32)]
    pen_stroke(cdp, loop, page, delay=6, settle=250)
    sel = page.evaluate("Object.keys(api.getAppState().selectedElementIds).filter(k => api.getAppState().selectedElementIds[k])")
    check("lasso selects the writing inside the loop", set(sel) == {w1, w2}, f"{len(sel)} selected")
    groups = page.evaluate("Object.keys(api.getAppState().selectedGroupIds)")
    check("selection shows as one outline (temporary group)", len(groups) == 1 and groups[0].startswith("hn-sel-"))
    page.screenshot(path=str(OUT / "lasso.png"), clip={"x": 760, "y": 190, "width": 260, "height": 170})
    # drag the selection
    before = page.evaluate(f"api.getSceneElements().find(e => e.id === '{w1}').x")
    pen_stroke(cdp, line(870, 270, 870, 370, 15), page, settle=250)
    moved = page.evaluate(f"api.getSceneElements().find(e => e.id === '{w1}').x !== undefined && api.getSceneElements().find(e => e.id === '{w1}').y")
    check("dragging moves the selection", page.evaluate(f"api.getSceneElements().find(e => e.id === '{w1}').y") > 260)
    tap(page, "Fountain pen"); page.wait_for_timeout(200)
    page.evaluate("api.updateScene({appState: {selectedElementIds: {}, selectedGroupIds: {}}})"); page.wait_for_timeout(200)
    left = page.evaluate("api.getSceneElements().some(e => e.groupIds.some(g => g.startsWith('hn-sel-')))")
    check("temporary group is removed after deselecting", not left)

    # ---------- text tool ----------
    tap(page, "Text")
    check("text tool active", page.evaluate("api.getAppState().activeTool.type") == "text")
    tap(page, "Fountain pen")

    # ---------- pinch zoom with the pen tool ----------
    z0 = page.evaluate("api.getAppState().zoom.value")
    touch(cdp, "touchStart", [(0, (500, 500)), (1, (600, 500))])
    for k in range(1, 11):
        touch(cdp, "touchMove", [(0, (500 - k * 10, 500)), (1, (600 + k * 10, 500))]); page.wait_for_timeout(16)
    touch(cdp, "touchEnd", [])
    page.wait_for_timeout(150)
    z1 = page.evaluate("api.getAppState().zoom.value")
    check("pinch zooms in while the pen is selected", z1 > z0 * 2.5, f"{z0:.2f} → {z1:.2f}")
    page.evaluate("api.updateScene({appState: {zoom: {value: 1}, scrollX: 0, scrollY: 0}})")
    page.wait_for_timeout(100)

    # ---------- radial menu (finger) ----------
    touch(cdp, "touchStart", [(0, (900, 600))])
    page.wait_for_timeout(650)
    check("finger hold opens the quick menu", page.locator(".hn-dial").count() == 1)
    page.screenshot(path=str(OUT / "dial.png"))
    box = page.locator(".hn-dial-tool[aria-label='Highlighter']").bounding_box()
    ex, ey = box["x"] + 20, box["y"] + 20
    for t in range(1, 6):
        touch(cdp, "touchMove", [(0, (900 + (ex - 900) * t / 5, 600 + (ey - 600) * t / 5))]); page.wait_for_timeout(16)
    touch(cdp, "touchEnd", [])
    page.wait_for_timeout(150)
    check("slide to Highlighter and lift picks it", tool(page) == "Highlighter", str(tool(page)))

    # ---------- radial menu (Pencil hold) ----------
    tap(page, "Fountain pen")
    n_before = len(els(page))
    pen_down(cdp, 900, 300)
    page.wait_for_timeout(750)
    opened = page.locator(".hn-dial").count() == 1
    pen_up(cdp, 900, 300); page.wait_for_timeout(150)
    check("Pencil press-and-hold opens the quick menu", opened)
    check("…and leaves no dot behind", len(els(page)) == n_before)
    page.click(".hn-dial-backdrop", position={"x": 20, "y": 20}); page.wait_for_timeout(100)

    # ---------- gestures ----------
    sy0 = page.evaluate("api.getAppState().scrollY")
    touch(cdp, "touchStart", [(0, (950, 700))])
    for k in range(1, 11):
        touch(cdp, "touchMove", [(0, (950, 700 - k * 12))]); page.wait_for_timeout(16)
    touch(cdp, "touchEnd", []); page.wait_for_timeout(100)
    check("one finger scrolls", page.evaluate("api.getAppState().scrollY") < sy0 - 60)
    pen_stroke(cdp, line(300, 300, 450, 300, 20), page)
    n1 = len(els(page)); page.wait_for_timeout(250)
    touch(cdp, "touchStart", [(0, (700, 500))]); touch(cdp, "touchStart", [(0, (700, 500)), (1, (780, 520))])
    page.wait_for_timeout(80)
    touch(cdp, "touchEnd", [(1, (780, 520))]); touch(cdp, "touchEnd", [])
    page.wait_for_timeout(200)
    check("two-finger tap undoes", len(els(page)) == n1 - 1)

    # ---------- iPad: touches on the page are cancelled (stops Scribble delaying the Pencil) ----------
    tap(page, "Ballpoint")
    prevented = page.evaluate("""(() => { const c = document.querySelector('canvas.excalidraw__canvas.interactive');
        const t = new Touch({ identifier: 9, target: c, clientX: 500, clientY: 500 });
        const ev = new TouchEvent('touchstart', { touches: [t], changedTouches: [t], targetTouches: [t], bubbles: true, cancelable: true });
        c.dispatchEvent(ev); const ev2 = new TouchEvent('touchend', { touches: [], changedTouches: [t], bubbles: true, cancelable: true }); c.dispatchEvent(ev2);
        return ev.defaultPrevented })()""")
    check("touches on the page are cancelled while writing (iPad Scribble can't hold the Pencil back)", prevented)
    tap(page, "Fountain pen")

    # ---------- swipe up past the last page to add one ----------
    pages0 = page.evaluate("ctx.state.pages.sizes.length")
    page.evaluate(f"api.updateScene({{appState: {{zoom: {{value: 1}}, scrollX: 0, scrollY: 700 - {pages0} * 1159 + 36}}}})"); page.wait_for_timeout(150)
    touch(cdp, "touchStart", [(0, (900, 700))])
    for k in range(1, 21):
        touch(cdp, "touchMove", [(0, (900, 700 - k * 22))]); page.wait_for_timeout(12)
    hint = page.evaluate("(() => { const h = document.querySelector('.hn-pull-hint'); return h.className })()")
    touch(cdp, "touchEnd", []); page.wait_for_timeout(250)
    check("pulling up past the last page shows 'let go to add a page'", "is-armed" in hint, hint)
    check("…and letting go adds a page", page.evaluate("ctx.state.pages.sizes.length") == pages0 + 1)
    page.evaluate("api.updateScene({appState: {zoom: {value: 1}, scrollX: 0, scrollY: 0}})"); page.wait_for_timeout(100)

    # ---------- top bar quick options ----------
    tap(page, "Highlighter")
    check("highlighter sizes in the top bar", page.locator(".hn-optionsbar .hn-size-quick").count() == 3)
    tap(page, "Precision eraser")
    check("eraser sizes in the top bar", page.locator(".hn-optionsbar .hn-size-quick").count() == 3)
    tap(page, "Fountain pen")
    page.screenshot(path=str(OUT / "toolbar.png"), clip={"x": 0, "y": 0, "width": 1180, "height": 120})

    # ---------- sizes in millimetres ----------
    tap(page, "Ballpoint")
    page.click(".hn-optionsbar button[aria-label='Size 0.5 mm']"); page.wait_for_timeout(120)
    sw = page.evaluate("api.getAppState().currentItemStrokeWidth")
    check("0.5 mm preset sets the matching line width", abs(sw * 6.5494 / (96 / 25.4) - 0.5) < 0.01, f"strokeWidth {sw:.3f}")
    check("top bar shows the size in mm", page.inner_text(".hn-optionsbar .hn-mm-chip").strip() == "0.5 mm", page.inner_text(".hn-optionsbar .hn-mm-chip"))
    pen_stroke(cdp, line(300, 600, 600, 600, 40), page)
    drawn = page.evaluate("(() => { const a = api.getSceneElements().filter(e => e.type === 'freedraw'); return a[a.length-1].strokeWidth })()")
    check("strokes use the chosen size", abs(drawn - sw) < 1e-6)
    page.click(".hn-optionsbar button[aria-label='Exact size']"); page.wait_for_timeout(150)
    page.evaluate("""() => { const i = document.querySelector('.hn-mm-slider');
        Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(i, '1.2');
        i.dispatchEvent(new Event('input', { bubbles: true })); }""")
    page.wait_for_timeout(120)
    check("exact size slider (1.2 mm)", page.inner_text(".hn-mm-value").strip() == "1.2 mm" and page.inner_text(".hn-optionsbar .hn-mm-chip").strip() == "1.2 mm",
          page.inner_text(".hn-mm-value"))
    page.click(".hn-mm-step[aria-label='Thicker']"); page.wait_for_timeout(100)
    check("+ makes it a step thicker", page.inner_text(".hn-mm-value").strip() == "1.3 mm", page.inner_text(".hn-mm-value"))
    page.screenshot(path=str(OUT / "size-panel.png"))
    page.click(".hn-optionsbar button[aria-label='Exact size']"); page.wait_for_timeout(100)
    tap(page, "Fountain pen")

    # ---------- fast ink ----------
    n0 = len([e for e in els(page) if e["type"] == "freedraw"])
    pen_down(cdp, 300, 650)
    for x, y in line(300, 650, 600, 660, 30)[1:]:
        pen_move(cdp, x, y); page.wait_for_timeout(8)
    mid = page.evaluate("""(() => { const c = document.querySelector('canvas.hn-wet'); if (!c) return null;
        const d = c.getContext('2d').getImageData(0, 0, c.width, c.height).data; let n = 0;
        for (let i = 3; i < d.length; i += 4) if (d[i]) n++; return {n, scene: api.getSceneElements().filter(e => e.type === 'freedraw').length} })()""")
    check("fast ink: stroke shows while writing without touching the scene", mid and mid["n"] > 200 and mid["scene"] == n0, str(mid))
    pen_up(cdp, 600, 660); page.wait_for_timeout(200)
    after = page.evaluate("""(() => { const c = document.querySelector('canvas.hn-wet');
        const d = c.getContext('2d').getImageData(0, 0, c.width, c.height).data; let n = 0;
        for (let i = 3; i < d.length; i += 4) if (d[i]) n++; return n })()""")
    check("fast ink: lifting the Pencil commits one stroke and clears the wet layer", len([e for e in els(page) if e["type"] == "freedraw"]) == n0 + 1 and after == 0, str(after))
    undo(page)
    check("fast ink: one undo removes the whole stroke", len([e for e in els(page) if e["type"] == "freedraw"]) == n0)

    # ---------- headings, outline, recognition, links, maths ----------
    page.evaluate("api.updateScene({appState: {zoom: {value: 1}, scrollX: 0, scrollY: -1200}})"); page.wait_for_timeout(150)
    page.evaluate("store.updateFeature('handwriting-recognition', {appKey: 'test-app', hmacKey: 'test-hmac'})")
    pen_stroke(cdp, [(300 + k * 4, 300 + 12 * math.sin(k / 3)) for k in range(50)], page)
    tap(page, "Lasso")
    loop = [(400 + 140 * math.cos(t / 30 * 2 * math.pi), 300 + 45 * math.sin(t / 30 * 2 * math.pi)) for t in range(32)]
    pen_stroke(cdp, loop, page, delay=6, settle=300)
    bar = page.evaluate("[...document.querySelectorAll('.hn-selbar-btn span:last-child')].map(b => b.textContent)")
    check("selection bar offers headings and links", all(x in bar for x in ["Title", "Subtitle", "Heading 3", "Link to note"]), str(bar))
    check("Solve appears once recognition keys are set", "Solve" in bar)
    page.click(".hn-selbar-btn:has-text('Title')"); page.wait_for_timeout(400)
    req = page.evaluate("window.lastRequest")
    check("heading is sent for recognition with signed request", req and req["headers"]["hmac"] and len(req["headers"]["hmac"]) == 128
          and req["body"]["contentType"] == "Text" and len(req["body"]["strokeGroups"][0]["strokes"]) == 1)
    page.click(".hn-toolbar [aria-label='Outline']"); page.wait_for_timeout(300)
    items = page.evaluate("[...document.querySelectorAll('.hn-outline-item')].map(i => i.textContent)")
    check("outline lists the heading as text", len(items) == 1 and "Lecture 1 overview" in items[0], str(items))
    page.screenshot(path=str(OUT / "outline.png"))
    page.evaluate("api.updateScene({appState: {scrollY: -5000}})")
    page.click(".hn-outline-item"); page.wait_for_timeout(150)
    sy = page.evaluate("api.getAppState().scrollY")
    check("tapping an outline entry jumps to it", abs(sy - (820 / 4 - (300 - 12 + 1200))) < 40, f"scrollY {sy:.0f}")
    page.click(".hn-toolbar [aria-label='Outline']"); page.wait_for_timeout(100)
    # link
    page.evaluate("api.updateScene({appState: {zoom: {value: 1}, scrollX: 0, scrollY: -1200}})"); page.wait_for_timeout(100)
    tap(page, "Lasso"); pen_stroke(cdp, loop, page, delay=6, settle=300)
    page.click(".hn-selbar-btn:has-text('Link to note')", timeout=5000); page.wait_for_timeout(300)
    check("linked writing gets a chip with the note's name", page.locator(".hn-link-chip:has-text('Week 1 summary')").count() == 1)
    page.click(".hn-link-chip"); page.wait_for_timeout(100)
    check("tapping the chip opens the note", page.evaluate("window.openedLink") == "[[Week 1 summary]]")
    # maths
    tap(page, "Fountain pen")
    page.evaluate("api.updateScene({appState: {selectedElementIds: {}, selectedGroupIds: {}}})")
    pen_stroke(cdp, [(300 + k * 4, 520 + 10 * math.sin(k / 2)) for k in range(40)], page)
    tap(page, "Lasso")
    loop2 = [(380 + 110 * math.cos(t / 30 * 2 * math.pi), 520 + 40 * math.sin(t / 30 * 2 * math.pi)) for t in range(32)]
    pen_stroke(cdp, loop2, page, delay=6, settle=300)
    page.click(".hn-selbar-btn:has-text('Solve')"); page.wait_for_timeout(400)
    ans = page.evaluate("api.getSceneElements().filter(e => e.customData?.hn === 'maths-answer').map(e => e.text)")
    check("Solve writes the answer next to the maths", ans == ["x = 2, x = 3"], str(ans))
    page.screenshot(path=str(OUT / "maths.png"))
    # ruler
    tap(page, "Fountain pen")
    page.click(".hn-toolbar [aria-label='Ruler']"); page.wait_for_timeout(150)
    check("ruler appears", page.locator(".hn-ruler").count() == 1)
    rb = page.evaluate("(() => { const r = document.querySelector('.hn-ruler').getBoundingClientRect(); return [r.x, r.y, r.width, r.height] })()")
    edge_y = rb[1] + rb[3] + 10  # just below the bottom edge
    pen_stroke(cdp, [(rb[0] + 40 + i * 8, edge_y + random.Random(i).uniform(-6, 6)) for i in range(50)], page)
    ys = [p[1] for p in last_freedraw(page)["pts"]]
    check("writing along the ruler gives a straight line", max(ys) - min(ys) < 0.6, f"height {max(ys) - min(ys):.2f}")
    sy0 = page.evaluate("api.getAppState().scrollY")
    cx, cy = rb[0] + rb[2] / 2, rb[1] + rb[3] / 2
    touch(cdp, "touchStart", [(0, (cx, cy))])
    for k in range(1, 9):
        touch(cdp, "touchMove", [(0, (cx + k * 10, cy + k * 12))]); page.wait_for_timeout(16)
    touch(cdp, "touchEnd", []); page.wait_for_timeout(100)
    rb2 = page.evaluate("(() => { const r = document.querySelector('.hn-ruler').getBoundingClientRect(); return [r.x, r.y] })()")
    check("a finger on the ruler moves the ruler, not the page",
          abs(rb2[0] - rb[0] - 80) < 3 and abs(rb2[1] - rb[1] - 96) < 3 and page.evaluate("api.getAppState().scrollY") == sy0)
    page.screenshot(path=str(OUT / "ruler.png"))

    check("no JavaScript errors", not errors, "; ".join(errors[:3]))
    ctx.close()

    # ================= fix list (0.8) =================
    ctx, page, cdp, errors = open_page()
    page.evaluate("api.updateScene({appState: {zoom: {value: 1}, scrollX: 0, scrollY: 0}})"); page.wait_for_timeout(150)
    def panel_open(): return page.locator(".hn-panel").count() > 0
    def last_el(): return page.evaluate("(() => { const e = api.getSceneElements().filter(e => !e.isDeleted).slice(-1)[0]; return e && {type: e.type, style: e.strokeStyle, hn: e.customData?.hn, sw: e.strokeWidth, n: e.points?.length, pr: e.pressures, sim: e.simulatePressure} })()")
    def count(kind): return page.evaluate(f"api.getSceneElements().filter(e => !e.isDeleted && e.type === '{kind}').length")

    # #4 one Pen button + Line options
    page.click(".hn-toolbar button[aria-label='Pen']"); page.wait_for_timeout(150)  # tap again → menu
    opts = page.evaluate("[...document.querySelectorAll('.hn-panel [role=radiogroup][aria-label=\"Line options\"] button')].map(b => b.getAttribute('aria-label'))")
    check("#4 Pen menu has Line options: Ballpoint, Fountain, Dotted, Dashed", opts == ["Ballpoint", "Fountain", "Dotted", "Dashed"], str(opts))
    page.click(".hn-panel button[aria-label='Dotted']"); page.wait_for_timeout(150)
    check("#4 picking Dotted keeps the one Pen button active", page.evaluate("ctx.state.tool") == "dotted" and tool(page) == "Pen", str(tool(page)))
    page.click(".hn-optionsbar button[aria-label='All colours']"); page.wait_for_timeout(100)
    if panel_open(): page.click(".hn-optionsbar button[aria-label='All colours']"); page.wait_for_timeout(100)
    n_lines = count("line")
    pen_down(cdp, 300, 520)
    for x, y in line(300, 520, 600, 540, 40)[1:]:
        pen_move(cdp, x, y); page.wait_for_timeout(8)
    wet = page.evaluate("(() => { const c = document.querySelector('canvas.hn-wet'); const d = c.getContext('2d').getImageData(0, 0, c.width, c.height).data; let n = 0; for (let i = 3; i < d.length; i += 4) if (d[i]) n++; return n })()")
    pen_up(cdp, 600, 540); page.wait_for_timeout(250)
    el = last_el()
    check("#4 dotted pen draws a dotted line (one element)", el["type"] == "line" and el["style"] == "dotted" and el["hn"] == "dash" and count("line") == n_lines + 1, str(el))
    check("#4 the dotted line shows while writing", wet > 50, f"{wet} px")
    page.screenshot(path=str(OUT / "dotted.png"), clip={"x": 250, "y": 480, "width": 420, "height": 100})
    tap(page, "Dashed pen")
    pen_stroke(cdp, [(300 + i * 8, 580 + 12 * math.sin(i / 6)) for i in range(45)], page)
    el = last_el()
    check("#4 dashed pen draws a dashed line", el["type"] == "line" and el["style"] == "dashed", str(el))
    undo(page)
    check("#4 one undo removes the dashed line", count("line") == n_lines + 1)
    # precision eraser cuts the dotted line like ink
    tap(page, "Precision eraser")
    pen_stroke(cdp, line(450, 500, 452, 560, 12), page)
    check("#6 precision eraser cuts a dotted line in two", count("line") == n_lines + 2, str(count("line")))

    # #5 pinned sizes (max 3)
    tap(page, "Ballpoint"); page.click(".hn-optionsbar button[aria-label='Exact size']"); page.wait_for_timeout(150)
    page.click(".hn-panel button[aria-label='Unpin 1 mm']"); page.wait_for_timeout(100)
    check("#5 unpinning removes the size from the bar", page.locator(".hn-optionsbar .hn-size-quick").count() == 2)
    page.evaluate("""() => { const i = document.querySelector('.hn-mm-slider');
        Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(i, '0.85');
        i.dispatchEvent(new Event('input', { bubbles: true })); }"""); page.wait_for_timeout(100)
    page.click(".hn-panel button[aria-label='Pin 0.85 mm']"); page.wait_for_timeout(100)
    sizes = page.evaluate("[...document.querySelectorAll('.hn-optionsbar .hn-size-quick')].map(b => b.getAttribute('aria-label'))")
    check("#5 pinning the current size adds it (sorted)", sizes == ["Size 0.5 mm", "Size 0.7 mm", "Size 0.85 mm"], str(sizes))
    page.evaluate("""() => { const i = document.querySelector('.hn-mm-slider');
        Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(i, '2');
        i.dispatchEvent(new Event('input', { bubbles: true })); }"""); page.wait_for_timeout(100)
    check("#5 at most 3: a 4th can't be pinned", page.locator(".hn-panel button[aria-label='Pin 2 mm']").count() == 0 and page.locator(".hn-pin-note").count() == 1)
    page.screenshot(path=str(OUT / "pen-menu.png"))
    page.click(".hn-optionsbar button[aria-label='Exact size']"); page.wait_for_timeout(100)

    # #6 one Eraser button, type in its menu
    tap(page, "Precision eraser")
    page.click(".hn-toolbar button[aria-label='Eraser']"); page.wait_for_timeout(150)
    page.click(".hn-panel button[aria-label='Whole strokes']"); page.wait_for_timeout(150)
    check("#6 eraser type is picked in the eraser's menu", page.evaluate("ctx.state.tool") == "object-eraser" and tool(page) == "Eraser")
    check("#6 eraser bar shows its 3 pinned sizes", page.locator(".hn-optionsbar .hn-size-quick").count() == 3)
    page.screenshot(path=str(OUT / "eraser-menu.png"))
    page.keyboard.press("Escape")
    if panel_open(): page.click(".hn-optionsbar button[aria-label='Eraser options']"); page.wait_for_timeout(100)

    # #1 highlighter keeps its size when it straightens
    tap(page, "Highlighter")
    sw = page.evaluate("api.getAppState().currentItemStrokeWidth")
    pen_stroke(cdp, [(300 + i * 7, 640 + random.Random(i).uniform(-2.5, 2.5)) for i in range(50)], page,
               forces=[0.15 + 0.8 * (i % 5) / 4 for i in range(50)])
    # highlights are moved behind the ink, so look for the newest highlight, not the last element
    hl = page.evaluate("(() => { const e = api.getSceneElements().filter(e => !e.isDeleted && e.customData?.hn === 'hl').sort((a, b) => b.updated - a.updated)[0]; return e && {type: e.type, sw: e.strokeWidth, pr: e.pressures, sim: e.simulatePressure} })()")
    check("#1 straightened highlight keeps the chosen size (even width, not pressure)",
          hl["type"] == "freedraw" and hl["sw"] == sw and not hl["sim"] and hl["pr"] and max(hl["pr"]) - min(hl["pr"]) < 1e-6 and abs(hl["pr"][0] - 0.5) < 1e-6,
          f"sw {hl['sw']} vs {sw}, pressures {hl['pr'][:3] if hl['pr'] else None}")

    # #7 the tip dot is the line's real width
    tap(page, "Ballpoint")
    page.evaluate("api.updateScene({appState: {zoom: {value: 1}}})"); page.wait_for_timeout(80)
    hover(cdp, 700, 700); page.wait_for_timeout(60)
    d1 = page.evaluate("document.querySelector('.hn-cursor').getBoundingClientRect().width")
    want1 = page.evaluate("(() => { const w = store.get().core.ballpoint.width; return w * 8.5 * Math.sin((0.5 - 0.6 * (0.5 - 0.6)) * Math.PI / 2) })()")
    page.evaluate("api.updateScene({appState: {zoom: {value: 2}}})"); page.wait_for_timeout(80)
    hover(cdp, 702, 700); page.wait_for_timeout(60)
    d2 = page.evaluate("document.querySelector('.hn-cursor').getBoundingClientRect().width")
    check("#7 tip dot = line width × zoom", abs(d1 - want1) < 0.6 and abs(d2 - 2 * want1) < 1, f"{d1:.2f}/{d2:.2f} want {want1:.2f}/{2*want1:.2f}")
    page.evaluate("api.updateScene({appState: {zoom: {value: 1}}})"); page.wait_for_timeout(80)

    # #3 rearrange the bar
    btn = page.locator(".hn-toolbar button[aria-label='Text']").bounding_box()
    page.mouse.move(btn["x"] + 10, btn["y"] + 10); page.mouse.down(); page.wait_for_timeout(750); page.mouse.up()
    page.wait_for_timeout(150)
    check("#3 holding a toolbar button starts editing", page.locator(".hn-toolbar.hn-toolbar-editing").count() == 1)
    page.click(".hn-toolbar button[aria-label='Hide Text']"); page.wait_for_timeout(120)
    check("#3 − hides a button (it goes to the tray)", page.locator(".hn-toolbar button[aria-label='Text']").count() == 0 and page.locator(".hn-tb-tray button[aria-label='Show Text']").count() == 1)
    a = page.locator(".hn-toolbar button[aria-label='Highlighter']").bounding_box()
    b = page.locator(".hn-toolbar button[aria-label='Pen']").bounding_box()
    page.mouse.move(a["x"] + 20, a["y"] + 20); page.mouse.down()
    for k in range(1, 11):
        page.mouse.move(a["x"] + 20 + (b["x"] - a["x"] - 10) * k / 10, a["y"] + 20); page.wait_for_timeout(16)
    page.mouse.up(); page.wait_for_timeout(150)
    order = page.evaluate("[...document.querySelectorAll('.hn-toolbar [data-key]')].map(e => e.dataset.key)")
    check("#3 dragging moves a button (Highlighter before Pen)", order.index("highlighter") < order.index("group:pen"), ", ".join(order))
    page.screenshot(path=str(OUT / "toolbar-edit.png"), clip={"x": 0, "y": 0, "width": 1180, "height": 130})
    page.click(".hn-tb-tray button:has-text('Done')"); page.wait_for_timeout(150)
    saved = page.evaluate("store.get().core.toolbar")
    check("#3 layout is saved", saved["hidden"] == ["text"] and saved["order"].index("highlighter") < saved["order"].index("group:pen"), json.dumps(saved))
    page.click(".hn-toolbar [aria-label='Notebook']"); page.wait_for_timeout(150)
    page.click(".hn-panel button:has-text('Edit toolbar')"); page.wait_for_timeout(150)
    page.click(".hn-tb-tray button:has-text('Reset')"); page.wait_for_timeout(100)
    page.click(".hn-tb-tray button:has-text('Done')"); page.wait_for_timeout(150)
    check("#3 Reset brings the default bar back (Edit toolbar in the Notebook menu)",
          page.locator(".hn-toolbar button[aria-label='Text']").count() == 1 and page.evaluate("store.get().core.toolbar.hidden.length") == 0)

    # #9 templates, per page
    page.click(".hn-toolbar [aria-label='Notebook']"); page.wait_for_timeout(150)
    page.click(".hn-panel button:has-text('All pages')"); page.wait_for_timeout(80)
    names = page.evaluate("[...document.querySelectorAll('.hn-paper-grid .hn-paper-opt')].map(b => b.getAttribute('aria-label'))")
    check("#9 paper picker offers the study templates", all(n in names for n in ["Cornell", "Lecture", "Lines + grid", "Revision", "Mind map", "Isometric"]) and len(names) == 10, str(names))
    page.screenshot(path=str(OUT / "paper-picker.png"))
    page.click(".hn-paper-opt[aria-label='Lined']"); page.wait_for_timeout(80)
    page.click(".hn-panel button:has-text('Add page')"); page.wait_for_timeout(150)
    page.click(".hn-panel button:has-text('This page')"); page.wait_for_timeout(80)
    page.click(".hn-paper-opt[aria-label='Cornell']"); page.wait_for_timeout(200)
    tpl = page.evaluate("[...document.querySelectorAll('.hn-sheet')].map(s => s.dataset.template)")
    check("#9 a template can be set for just one page", tpl[0] == "cornell" and all(t == "lined" for t in tpl[1:]), str(tpl))
    page.evaluate("ctx.addPage(0)"); page.wait_for_timeout(150)
    tpl = page.evaluate("[...document.querySelectorAll('.hn-sheet')].map(s => s.dataset.template)")
    check("#9 a new page takes the paper of the page before it", tpl[1] == "cornell", str(tpl))
    bg = page.evaluate("getComputedStyle(document.querySelector('.hn-sheet')).backgroundImage.slice(0, 40)")
    check("#9 the page shows the template (SVG background)", bg.startswith('url("data:image/svg+xml'), bg)
    page.evaluate("ctx.setState({panel: null})")
    page.evaluate("api.updateScene({appState: {zoom: {value: 0.62}, scrollX: 20, scrollY: 10}})"); page.wait_for_timeout(200)
    page.screenshot(path=str(OUT / "cornell.png"))
    for t in ["lecture", "twocol", "revision", "mindmap", "isometric"]:
        page.evaluate(f"ctx.setPageTemplate(0, '{t}')"); page.wait_for_timeout(150)
        page.screenshot(path=str(OUT / f"tpl-{t}.png"), clip={"x": 0, "y": 0, "width": 640, "height": 820})
    page.evaluate("ctx.setPageTemplate(0, 'cornell')")
    page.evaluate("api.updateScene({appState: {zoom: {value: 1}, scrollX: 0, scrollY: 0}})"); page.wait_for_timeout(100)
    # #11 print / export: all pages, this page, or a range (Export panel: toolbar button or Notebook menu)
    page.click(".hn-toolbar [aria-label='Notebook']"); page.wait_for_timeout(150)
    page.click(".hn-panel button:has-text('Export / print')"); page.wait_for_timeout(150)
    page.click(".hn-panel button:has-text('Pages…')"); page.wait_for_timeout(100)
    page.fill(".hn-range", "2-3")
    page.click(".hn-panel button[aria-label='Print']")
    page.wait_for_function("window.printed !== undefined", timeout=20000)
    pr = page.evaluate("window.printed")
    check("#11 Print (Notebook → Export / print) prints a page range", pr["pages"] == [1, 2] and pr["count"] == 2, str(pr))
    page.evaluate("window.printed = undefined")
    page.click(".hn-toolbar [aria-label='Export PDF']"); page.wait_for_timeout(150)
    page.screenshot(path=str(OUT / "export-panel.png"))
    page.click(".hn-panel button[aria-label='Print']")
    page.wait_for_function("window.printed !== undefined", timeout=20000)
    check("#11 …or all pages", page.evaluate("window.printed.count") == 3, str(page.evaluate("window.printed")))
    # Export as PDF from the toolbar: all pages, or just this page
    page.click(".hn-toolbar [aria-label='Export PDF']"); page.wait_for_timeout(150)
    page.click(".hn-panel button[aria-label='Save PDF']")
    page.wait_for_function("window.exported !== undefined", timeout=20000)
    ex = page.evaluate("window.exported")
    check("Export PDF button in the toolbar exports every page", ex["pages"] is None and ex["count"] == 3 and ex["then"] == "open", str(ex))
    page.evaluate("window.exported = undefined")
    page.click(".hn-toolbar [aria-label='Export PDF']"); page.wait_for_timeout(150)
    page.click(".hn-panel button:has-text('This page')")
    page.click(".hn-panel button[aria-label='Save PDF']")
    page.wait_for_function("window.exported !== undefined", timeout=20000)
    ex = page.evaluate("window.exported")
    check("…or just this page", ex["pages"] == [0] and ex["count"] == 1, str(ex))
    check("no JavaScript errors (fix list)", not errors, "; ".join(errors[:3]))
    ctx.close()

    # Small letters that end near their start ("a", "o", "m") were filled with a black wedge
    ctx, page, cdp, errors = open_page()
    page.evaluate("ctx.setTool('pen')"); page.wait_for_timeout(100)
    import math
    loop = [(300 + 9 * math.cos(t / 10 * 2 * math.pi), 300 + 9 * math.sin(t / 10 * 2 * math.pi)) for t in range(0, 11)] + [(310, 296), (310, 312), (308, 300)]
    res = {}
    for fast in (True, False):
        page.evaluate(f"ctx.store.updateCore({{fastInk: {'true' if fast else 'false'}}})"); page.wait_for_timeout(50)
        page.evaluate("ctx.setTool('ballpoint'); ctx.setTool('pen')"); page.wait_for_timeout(50)
        page.evaluate("api.updateScene({appState: {currentItemBackgroundColor: '#1e1e1e'}})")
        hover(cdp, 300, 300); page.wait_for_timeout(50)
        pen_stroke(cdp, [(round(x), round(y)) for x, y in loop], page, settle=300)
        res[fast] = page.evaluate("(() => { const f = api.getSceneElements().filter(e => e.type === 'freedraw'); return f.length ? f[f.length - 1].backgroundColor : null })()")
    check("a stroke that ends near its start is never filled (fast ink)", res[True] == "transparent", str(res))
    check("…nor without fast ink", res[False] == "transparent", str(res))
    page.evaluate("ctx.store.updateCore({fastInk: true})")
    hover(cdp, 400, 400); page.wait_for_timeout(80)
    shown = page.evaluate("getComputedStyle(document.querySelector('.hn-cursor')).display")
    pen_down(cdp, 400, 400); page.wait_for_timeout(50)
    gone = page.evaluate("getComputedStyle(document.querySelector('.hn-cursor')).display")
    pen_up(cdp, 400, 400); page.wait_for_timeout(100)
    check("the Pencil's hover dot goes away when the Pencil touches the page", shown == "block" and gone == "none", f"{shown} → {gone}")
    check("no JavaScript errors (no-fill ink)", not errors, "; ".join(errors[:3]))
    ctx.close()

    # #2 zoom-out stops when the page fills the width
    ctx, page, cdp, errors = open_page(free_zoom=False)
    mz = page.evaluate("ctx.minZoom()")
    page.evaluate("api.updateScene({appState: {zoom: {value: 0.3}}})"); page.wait_for_timeout(150)
    z = page.evaluate("api.getAppState().zoom.value")
    check("#2 zooming out below full width snaps back to full width", abs(z - mz) < 1e-3, f"{z:.3f} vs {mz:.3f}")
    page.evaluate(f"api.updateScene({{appState: {{zoom: {{value: {mz * 2}}}}}}})"); page.wait_for_timeout(100)
    touch(cdp, "touchStart", [(0, (500, 500))]); touch(cdp, "touchStart", [(0, (500, 500)), (1, (800, 500))])
    for k in range(1, 16):
        touch(cdp, "touchMove", [(0, (500 + k * 9, 500)), (1, (800 - k * 9, 500))]); page.wait_for_timeout(16)
    touch(cdp, "touchEnd", [(1, (665, 500))]); touch(cdp, "touchEnd", []); page.wait_for_timeout(150)
    z = page.evaluate("api.getAppState().zoom.value")
    check("#2 pinching out stops at full width", z >= mz - 1e-3 and z < mz * 1.2, f"{z:.3f} vs {mz:.3f}")
    ctx.close()

    # Goodnotes-style view: the notebook stays on screen, pinch to zoom
    ctx, page, cdp, errors = open_page(free_zoom=False)
    def vw(): return page.evaluate("(() => { const s = api.getAppState(); return {z: s.zoom.value, x: s.scrollX, y: s.scrollY} })()")
    def page_box(): return page.evaluate("(() => { const r = document.querySelector('.hn-sheet').getBoundingClientRect(); const o = document.querySelector('.hn-root').getBoundingClientRect(); return {l: r.left - o.left, r: o.right - r.right, t: r.top - o.top} })()")
    b = page_box()
    check("the page fills the width, centred", abs(b["l"] - b["r"]) < 2 and b["l"] < 30, json.dumps(b))
    v0 = vw()
    touch(cdp, "touchStart", [(0, (600, 600))])
    for k in range(1, 15): touch(cdp, "touchMove", [(0, (600 + k * 25, 600 + k * 30))], fresh=False); page.wait_for_timeout(16)
    touch(cdp, "touchEnd", [], fresh=False); page.wait_for_timeout(350)
    v1 = vw(); b = page_box()
    check("dragging sideways/down can't push the page off screen", abs(v1["x"] - v0["x"]) < 0.5 and b["t"] <= 121 and abs(b["l"] - b["r"]) < 2, f"{json.dumps(v1)} {json.dumps(b)}")
    touch(cdp, "touchStart", [(0, (600, 700))])
    for k in range(1, 20): touch(cdp, "touchMove", [(0, (600, 700 - k * 25))], fresh=False); page.wait_for_timeout(16)
    touch(cdp, "touchEnd", [], fresh=False); page.wait_for_timeout(350)
    check("…but scrolling down the notebook works", vw()["y"] < v0["y"] - 100, json.dumps(vw()))
    # pinch to zoom in, move around inside the page, pinch back out
    touch(cdp, "touchStart", [(0, (550, 450))]); touch(cdp, "touchStart", [(0, (550, 450)), (1, (650, 450))], fresh=False)
    for k in range(1, 16): touch(cdp, "touchMove", [(0, (550 - k * 12, 450)), (1, (650 + k * 12, 450))], fresh=False); page.wait_for_timeout(16)
    touch(cdp, "touchEnd", [(1, (830, 450))], fresh=False); touch(cdp, "touchEnd", [], fresh=False); page.wait_for_timeout(350)
    zin = vw()
    check("pinch zooms in", zin["z"] > v0["z"] * 1.8, json.dumps(zin))
    for rep in range(4):  # drag right far past the page's left edge
        touch(cdp, "touchStart", [(0, (200, 450))])
        for k in range(1, 25): touch(cdp, "touchMove", [(0, (200 + k * 40, 450))], fresh=False); page.wait_for_timeout(12)
        touch(cdp, "touchEnd", [], fresh=False); page.wait_for_timeout(300)
    b = page_box()
    check("zoomed in, you can move around but not past the page's edge", -1 <= b["l"] <= 25, json.dumps(b))
    touch(cdp, "touchStart", [(0, (300, 450))]); touch(cdp, "touchStart", [(0, (300, 450)), (1, (900, 450))], fresh=False)
    for k in range(1, 20): touch(cdp, "touchMove", [(0, (300 + k * 14, 450)), (1, (900 - k * 14, 450))], fresh=False); page.wait_for_timeout(16)
    touch(cdp, "touchEnd", [(1, (634, 450))], fresh=False); touch(cdp, "touchEnd", [], fresh=False); page.wait_for_timeout(350)
    b = page_box()
    check("pinching back out snaps to the page filling the width", abs(vw()["z"] - v0["z"]) < 1e-3 and abs(b["l"] - b["r"]) < 2, f"{json.dumps(vw())} {json.dumps(b)}")
    page.evaluate("api.updateScene({appState: {scrollX: 500, scrollY: 2000}})"); page.wait_for_timeout(200)
    b = page_box()
    check("other ways of moving the view (outline jumps, keyboard) are kept on the page too", abs(b["l"] - b["r"]) < 2 and b["t"] <= 121, json.dumps(b))
    check("no JavaScript errors (view limits)", not errors, "; ".join(errors[:3]))
    ctx.close()

    # #10 #12 the real view: template remembered, saved dot, echoes
    ctx, page, cdp, errors = open_page("?view")
    page.wait_for_function("window.ctx !== undefined"); page.wait_for_timeout(500)
    page.evaluate("ctx.minZoom = () => 0.25")
    check("#12 saved dot is green after opening", page.locator(".hn-save.is-saved").count() == 1)
    page.evaluate("ctx.setPageTemplate('all', 'grid')"); page.wait_for_timeout(300)
    saved = json.loads(page.evaluate("fileText()"))
    check("#10 the notebook's paper is saved to the file at once", saved["handnote"]["template"] == "grid", saved["handnote"]["template"])
    page.evaluate("ctx.addPage()"); page.wait_for_timeout(100)
    page.evaluate("ctx.setPageTemplate(1, 'revision')"); page.wait_for_timeout(300)
    saved = json.loads(page.evaluate("fileText()"))
    check("#10 a page's own paper is saved too", saved["handnote"]["pages"]["sizes"][1].get("template") == "revision", json.dumps(saved["handnote"]["pages"]))
    parsed = page.evaluate("(t => parseNote(t, 'lined').handnote)(fileText())")
    check("#10 reopening reads the same papers back", parsed["template"] == "grid" and parsed["pages"]["sizes"][1]["template"] == "revision")
    # write something: red until saved, then green
    pen_stroke(cdp, line(300, 400, 600, 420, 30), page, settle=60)
    red = page.locator(".hn-save.is-unsaved, .hn-save.is-saving").count() == 1
    page.wait_for_timeout(1400)
    check("#12 dot goes red after writing, then green once saved", red and page.locator(".hn-save.is-saved").count() == 1)
    # an old copy of the file arriving late (sync echo) must not undo anything
    before = page.evaluate("api.getSceneElements().length")
    page.evaluate("view.setViewData(view.recentWrites[view.recentWrites.length - 1], false)"); page.wait_for_timeout(300)
    check("#10 a late echo of an older save doesn't reload the notebook", page.evaluate("api.getSceneElements().length") == before and page.evaluate("ctx.state.template") == "grid")
    # a failed save stays red and says why; tapping retries
    page.evaluate("window.failSave = 'disk full'")
    pen_stroke(cdp, line(300, 450, 600, 470, 30), page, settle=60)
    page.wait_for_timeout(1400)
    check("#12 a failed save shows the error dot", page.locator(".hn-save.is-error").count() == 1 and "disk full" in (page.locator(".hn-save").get_attribute("title") or ""))
    page.evaluate("window.failSave = undefined")
    page.click(".hn-save"); page.wait_for_timeout(300)
    check("#12 tapping the dot saves now", page.locator(".hn-save.is-saved").count() == 1)
    page.screenshot(path=str(OUT / "saved-dot.png"), clip={"x": 0, "y": 0, "width": 1180, "height": 80})
    check("no JavaScript errors (view)", not [e for e in errors if "disk full" not in e], "; ".join(errors[:3]))
    ctx.close()

    # ================= 0.10: deleted words, palm, scrolling, highlights, menus =================
    ctx, page, cdp, errors = open_page()
    page.evaluate("api.updateScene({appState: {zoom: {value: 1}, scrollX: 0, scrollY: 0}})"); page.wait_for_timeout(150)
    def n_ink(): return page.evaluate("api.getSceneElements().filter(e => !e.isDeleted && e.type === 'freedraw').length")
    def sy(): return page.evaluate("api.getAppState().scrollY")
    tap(page, "Ballpoint")
    for k in range(3):
        pen_stroke(cdp, [(300 + k * 70 + i * 2, 300 + 10 * math.sin(i / 3)) for i in range(25)], page)
    n0 = n_ink()

    # after writing, erasing or lassoing with the Pencil, fingers work again (no reset, real waiting)
    for label, tool_label, pts in [("writing", "Ballpoint", line(300, 450, 400, 455, 15)),
                                   ("erasing", "Precision eraser", line(600, 450, 650, 455, 10)),
                                   ("using the lasso", "Lasso", [(600 + 40 * math.cos(t / 10 * 6.28), 500 + 40 * math.sin(t / 10 * 6.28)) for t in range(11)])]:
        if tool_label == "Lasso":
            page.evaluate("ctx.setTool('lasso')")
        else:
            tap(page, tool_label)
        pen_stroke(cdp, pts, page)
        page.keyboard.press("Escape")
        y1 = sy()
        touch(cdp, "touchStart", [(0, (1000, 650))])
        for k in range(1, 8): touch(cdp, "touchMove", [(0, (1000, 650 - k * 20))], fresh=False); page.wait_for_timeout(16)
        touch(cdp, "touchEnd", [], fresh=False); page.wait_for_timeout(300)
        check(f"fingers scroll again half a second after {label} with the Pencil", abs(sy() - (y1 - 140)) < 3, f"pen down stuck? {page.evaluate('ctx.penDown')}, scrollY {sy()} vs {y1 - 140}")
        page.evaluate(f"api.updateScene({{appState: {{scrollY: {y1}}}}})"); page.wait_for_timeout(100)
    tap(page, "Ballpoint")
    n0 = n_ink()

    # palm rejection
    y0 = sy()
    page.evaluate("ctx.lastPenAt = performance.now()")
    touch(cdp, "touchStart", [(0, (700, 600))], fresh=False)
    for k in range(1, 15): touch(cdp, "touchMove", [(0, (700, 600 - k * 15))])
    touch(cdp, "touchEnd", []); page.wait_for_timeout(250)
    check("palm: a hand on the screen right after writing doesn't scroll", abs(sy() - y0) < 1, f"{sy()} vs {y0}")
    page.evaluate("ctx.lastPenAt = -Infinity")
    touch(cdp, "touchStart", [(0, (700, 600))], radius=30)
    for k in range(1, 15): touch(cdp, "touchMove", [(0, (700, 600 - k * 15))], radius=30)
    touch(cdp, "touchEnd", [], radius=30); page.wait_for_timeout(300)
    check("a finger with a big contact area (as iPadOS reports fingertips) still scrolls", abs(sy() - (y0 - 210)) < 3, f"{sy()} vs {y0 - 210}")
    page.evaluate("api.updateScene({appState: {scrollY: %s}})" % y0); page.wait_for_timeout(150)
    hover(cdp, 900, 500); hover(cdp, 905, 505)
    touch(cdp, "touchStart", [(0, (700, 600))], fresh=False)
    for k in range(1, 15): touch(cdp, "touchMove", [(0, (700, 600 - k * 15))], fresh=False)
    touch(cdp, "touchEnd", [], fresh=False); page.wait_for_timeout(300)
    check("the Pencil hovering near the screen doesn't block finger scrolling", abs(sy() - (y0 - 210)) < 3, f"{sy()} vs {y0 - 210}")
    page.evaluate("api.updateScene({appState: {scrollY: %s}})" % y0); page.wait_for_timeout(150)
    touch(cdp, "touchStart", [(0, (600, 600)), (1, (700, 600))]); page.wait_for_timeout(60)
    touch(cdp, "touchCancel", []); page.wait_for_timeout(200)
    check("a two-finger touch iPadOS cancels never undoes", n_ink() == n0, f"{n_ink()} vs {n0}")
    touch(cdp, "touchStart", [(0, (600, 600)), (1, (700, 600))]); page.wait_for_timeout(40)
    pen_stroke(cdp, line(300, 420, 400, 425, 12), page, settle=40)
    touch(cdp, "touchEnd", [(1, (700, 600))], fresh=False); touch(cdp, "touchEnd", [], fresh=False); page.wait_for_timeout(200)
    check("the Pencil coming down cancels a two-finger tap (no undo)", n_ink() == n0 + 1, f"{n_ink()} vs {n0 + 1}")
    page.wait_for_timeout(900)
    touch(cdp, "touchStart", [(0, (600, 600)), (1, (700, 600))]); page.wait_for_timeout(60)
    touch(cdp, "touchEnd", [(1, (700, 600))], fresh=False); touch(cdp, "touchEnd", [], fresh=False); page.wait_for_timeout(250)
    toast = page.evaluate("document.querySelector('.hn-toast')?.textContent || ''")
    check("a real two-finger tap still undoes, and says so (with Redo)", n_ink() == n0 and "Undo" in toast and "Redo" in toast, toast)
    page.click(".hn-toast-btn"); page.wait_for_timeout(200)
    check("…Redo in the message brings it back", n_ink() == n0 + 1)

    # dial: never from a palm, never picks on a cancelled touch
    page.evaluate("ctx.lastPenAt = performance.now()")
    touch(cdp, "touchStart", [(0, (800, 650))], fresh=False); page.wait_for_timeout(800)
    check("a palm put down while writing doesn't open the dial", page.locator(".hn-dial").count() == 0)
    touch(cdp, "touchEnd", [], fresh=False); page.wait_for_timeout(100)
    before_tool = page.evaluate("ctx.state.tool")
    touch(cdp, "touchStart", [(0, (800, 650))]); page.wait_for_timeout(800)
    opened = page.locator(".hn-dial").count() == 1
    touch(cdp, "touchMove", [(0, (800, 590))], fresh=False); page.wait_for_timeout(120)
    touch(cdp, "touchCancel", [], fresh=False); page.wait_for_timeout(150)
    check("a cancelled touch on the dial doesn't switch tools", opened and page.evaluate("ctx.state.tool") == before_tool, page.evaluate("ctx.state.tool"))
    page.keyboard.press("Escape")
    if page.locator(".hn-dial-backdrop").count(): page.mouse.click(30, 780); page.wait_for_timeout(150)

    # scribble-to-delete: never on ordinary writing
    tap(page, "Ballpoint")
    pen_stroke(cdp, line(462, 528, 463, 529, 3), page)  # an i-dot
    dot_id = page.evaluate("api.getSceneElements().filter(e => !e.isDeleted).slice(-1)[0].id")
    word = [(420 + i * 1.1, 545 - abs(math.sin(i / 6)) * 18) for i in range(90)]  # joined-up "mmmm" around the dot
    pen_stroke(cdp, word, page); page.wait_for_timeout(200)
    alive = page.evaluate(f"api.getSceneElements().some(e => e.id === '{dot_id}' && !e.isDeleted)")
    check("writing a joined-up word next to an i-dot deletes nothing", alive and page.locator(".hn-toast:has-text('Scribbled')").count() == 0)
    for k in range(3):
        pen_stroke(cdp, [(300 + k * 40 + i * 1.5, 700 + 8 * math.sin(i / 2)) for i in range(20)], page)
    before = n_ink()
    zig = []
    for k in range(8):
        zig += [(295 + j * 4, 690 + (k % 2) * 24 + (j % 2) * 0) for j in range(1)]
        zig += [(295 + 50 * (k % 2) + (0 if k % 2 else 0), 690)]
    zig = [(290 + (k % 2) * 140, 688 + k * 2.5) for k in range(14)]
    dense = []
    for a, b in zip(zig, zig[1:]):
        dense += [(a[0] + (b[0] - a[0]) * t / 10, a[1] + (b[1] - a[1]) * t / 10) for t in range(10)]
    pen_stroke(cdp, dense, page, delay=2); page.wait_for_timeout(250)
    check("a real scribble over words still deletes them, and says so (with Undo)", n_ink() <= before - 3 and page.locator(".hn-toast:has-text('Scribbled out')").count() == 1, f"{n_ink()} vs {before}")
    page.click(".hn-toast-btn"); page.wait_for_timeout(250)
    check("…Undo in the message brings the words back and removes the scribble", n_ink() == before, f"{n_ink()} vs {before}")

    # highlights are drawn under the ink
    tap(page, "Highlighter")
    pen_stroke(cdp, [(280 + i * 8, 1000 - 700) for i in range(40)], page)
    page.wait_for_timeout(250)
    hl = page.evaluate("""(() => {
        const root = document.querySelector('.hn-root');
        const px = (sel, x, y) => { const c = document.querySelector(sel); const d = window.devicePixelRatio;
          return [...c.getContext('2d').getImageData(Math.round(x * d), Math.round(y * d), 1, 1).data]; };
        return { on: root.classList.contains('hn-under-on'), under: px('canvas.hn-under', 600, 300), stat: px('canvas.excalidraw__canvas.static', 600, 300) };
    })()""")
    check("highlights are drawn under the ink (never over text), not by Excalidraw on screen",
          hl["on"] and hl["under"][3] > 0 and hl["stat"][3] == 0, json.dumps(hl))
    over = page.evaluate("""(() => { const c = document.querySelector('canvas.hn-over'); if (!c) return -1;
        const d = c.getContext('2d').getImageData(0, 0, c.width, c.height).data; let n = 0; for (let i = 3; i < d.length; i += 4) if (d[i]) n++; return n })()""")
    check("writing under a highlight is redrawn darker", over > 100, f"{over} px")
    page.evaluate("store.updateCore({darkenUnderHighlights: false})"); page.wait_for_timeout(200)
    off = page.evaluate("""(() => { const c = document.querySelector('canvas.hn-over'); const d = c.getContext('2d').getImageData(0, 0, c.width, c.height).data; let n = 0; for (let i = 3; i < d.length; i += 4) if (d[i]) n++; return n })()""")
    check("…and the setting turns it off", off == 0, f"{off} px")
    page.evaluate("store.updateCore({darkenUnderHighlights: true})")
    tap(page, "Ballpoint")

    # menus: close when you tap the page; never off the screen
    page.click(".hn-optionsbar button[aria-label='All colours']"); page.wait_for_timeout(150)
    touch(cdp, "touchStart", [(0, (1050, 700))]); touch(cdp, "touchEnd", [], fresh=False); page.wait_for_timeout(200)
    check("tapping the page with a finger closes the colour menu", page.locator(".hn-panel").count() == 0)
    page.click(".hn-optionsbar button[aria-label='All colours']"); page.wait_for_timeout(150)
    n1 = n_ink()
    pen_stroke(cdp, [(1050, 700), (1051, 700)], page)
    check("a Pencil tap on the page closes the menu without drawing a dot", page.locator(".hn-panel").count() == 0 and n_ink() == n1, f"{n_ink()} vs {n1}")
    page.set_viewport_size({"width": 1180, "height": 620}); page.wait_for_timeout(250)
    page.click(".hn-optionsbar button[aria-label='All colours']"); page.wait_for_timeout(200)
    box = page.evaluate("(() => { const p = document.querySelector('.hn-panel').getBoundingClientRect(); const r = document.querySelector('.hn-root').getBoundingClientRect(); const el = document.querySelector('.hn-panel'); return {bottom: p.bottom, root: r.bottom, scrolls: el.scrollHeight > el.clientHeight} })()")
    check("landscape: the colour menu stays on screen (scrolls inside)", box["bottom"] <= box["root"] + 1 and box["scrolls"], json.dumps(box))
    page.screenshot(path=str(OUT / "landscape-menu.png"))
    page.click(".hn-optionsbar button[aria-label='All colours']"); page.wait_for_timeout(100)
    page.set_viewport_size({"width": 1180, "height": 820}); page.wait_for_timeout(250)

    # smooth scrolling: a snapshot moves during the gesture; the real redraw happens at the end
    y0 = sy()
    touch(cdp, "touchStart", [(0, (700, 650))])
    for k in range(1, 8): touch(cdp, "touchMove", [(0, (700, 650 - k * 20))], fresh=False); page.wait_for_timeout(16)
    page.wait_for_timeout(50)
    mid = page.evaluate("(() => ({ snap: getComputedStyle(document.querySelector('canvas.hn-snapshot')).display, stat: document.querySelector('canvas.excalidraw__canvas.static').style.visibility }))()")
    touch(cdp, "touchEnd", [], fresh=False); page.wait_for_timeout(300)
    after = page.evaluate("(() => ({ snap: getComputedStyle(document.querySelector('canvas.hn-snapshot')).display, stat: document.querySelector('canvas.excalidraw__canvas.static').style.visibility }))()")
    check("scrolling moves a snapshot (no full redraw per finger movement)", mid["snap"] == "block" and mid["stat"] == "hidden", json.dumps(mid))
    check("…and redraws properly when the finger lifts", after["snap"] == "none" and after["stat"] == "" and abs(sy() - (y0 - 140)) < 2, f"{json.dumps(after)} scrollY {sy()} vs {y0 - 140}")
    check("no JavaScript errors (0.10)", not errors, "; ".join(errors[:3]))
    ctx.close()

    # a late, older copy of the notebook from sync never removes writing
    ctx, page, cdp, errors = open_page("?view")
    page.wait_for_function("window.ctx !== undefined"); page.wait_for_timeout(500)
    page.evaluate("ctx.minZoom = () => 0.25")
    tap(page, "Ballpoint")
    pen_stroke(cdp, line(300, 300, 500, 310, 20), page); page.wait_for_timeout(1300)
    old = page.evaluate("fileText()")
    for k in range(8):
        pen_stroke(cdp, line(300, 340 + k * 30, 500, 345 + k * 30, 20), page); page.wait_for_timeout(1100)
    before = page.evaluate("api.getSceneElements().length")
    page.evaluate("(t => view.setViewData(JSON.stringify(JSON.parse(t), null, 2), false))(" + json.dumps(old) + ")"); page.wait_for_timeout(300)
    check("an old copy arriving from sync doesn't remove anything you wrote since", page.evaluate("api.getSceneElements().length") == before, f"{page.evaluate('api.getSceneElements().length')} vs {before}")
    newer = json.loads(page.evaluate("fileText()"))
    extra = dict(newer["elements"][0]); extra["id"] = "from-other-device"; extra["y"] = extra["y"] + 400
    newer["elements"].append(extra)
    page.evaluate("(t => view.setViewData(t, false))(" + json.dumps(json.dumps(newer)) + ")"); page.wait_for_timeout(300)
    check("…while writing from another device is added", page.evaluate("api.getSceneElements().some(e => e.id === 'from-other-device')") and page.evaluate("api.getSceneElements().length") == before + 1)
    check("no JavaScript errors (sync)", not errors, "; ".join(errors[:3]))
    ctx.close()

    # ---------- one Handnote folder ----------
    ctx, page, cdp, errors = open_page("?library", ready="window.libraryReady === true")
    page.wait_for_function("window.libraryReady === true", timeout=30000); page.wait_for_timeout(400)
    names = page.evaluate("document.querySelector('.hn-lib-grid').textContent")
    check("library shows the Handnote folder only", "Ideas" in names and "Deree" in names and "Elsewhere" not in names, names[:200])
    check("library has an Exports tile with the exported PDFs", "Exports" in names and "2 PDFs" in names, names[:300])
    page.click(".hn-lib-item[aria-label='Exports']"); page.wait_for_timeout(200)
    inside = page.evaluate("document.querySelector('.hn-lib-grid').textContent")
    page.screenshot(path=str(OUT / "library-exports.png"))
    check("…tapping it lists them", "Ideas" in inside and "Gym log (page 1)" in inside and "Reading notes" not in inside, inside[:300])
    page.click(".hn-lib-item:has-text('Ideas')"); page.wait_for_timeout(150)
    check("…and tapping a PDF opens it", page.evaluate("window.opened ?? ''") == "Handnote/Exports/Ideas.pdf", str(page.evaluate("window.opened")))
    page.click(".hn-lib-crumb:has-text('Notebooks')"); page.wait_for_timeout(150)
    page.click(".hn-lib-btn:has-text('New notebook')"); page.wait_for_timeout(150)
    page.click(".hn-lib-btn:has-text('Import PDF')"); page.wait_for_timeout(150)
    check("new notebooks and imported PDFs go in the Handnote folder",
          page.evaluate("window.created[0]") == "Handnote" and page.evaluate("window.importInto") == "Handnote", str(page.evaluate("[window.created, window.importInto]")))
    ctx.close()

    ctx, page, cdp, errors = open_page("?tidy", ready="window.tidyReady === true")
    page.wait_for_function("window.tidyReady === true", timeout=20000)
    plan = page.evaluate("window.plan")
    tos = {m["from"]: m["to"] for m in plan["notes"] + plan["pages"] + plan["exports"]}
    check("tidy-up finds the scattered notebooks, PDF pages and exports",
          tos.get("Handwritten/Lecture.handnote") == "Handnote/Lecture.handnote"
          and tos.get("Handwritten/Deree/MIS.handnote") == "Handnote/Deree/MIS.handnote"
          and tos.get("Quick Notes/Quick note 1.handnote") == "Handnote/Quick Notes/Quick note 1.handnote"
          and tos.get("Week 1.handnote") == "Handnote/Week 1.handnote"
          and tos.get("Week 1 (pages)") == "Handnote/Attachments/Week 1 (pages)"
          and tos.get("Handwritten/Lecture.pdf") == "Handnote/Exports/Lecture.pdf"
          and tos.get("Week 1 (print).pdf") == "Handnote/Exports/Week 1 (print).pdf", json.dumps(tos))
    check("tidy-up never moves the PDF a notebook was made from", "Week 1.pdf" not in tos)
    page.evaluate("runTidy()"); page.wait_for_function("window.paths !== undefined")
    paths = page.evaluate("window.paths")
    week1 = page.evaluate("window.week1")
    check("after tidy-up: everything is inside Handnote", all(p.startswith("Handnote") or p in ("/", "Week 1.pdf", "Notes", "Notes/Diary.md") for p in paths), ", ".join(paths))
    check("…old empty folders are gone, your own files stay", "Handwritten" not in paths and "Quick Notes" not in paths and "Week 1 (pages)" not in paths and "Notes/Diary.md" in paths and "Week 1.pdf" in paths)
    check("…the moved notebook still finds its PDF pages", week1["handnote"]["pdf"]["assets"][0]["path"] == "Handnote/Attachments/Week 1 (pages)/page 001.jpg")
    check("…and running it again finds nothing left", page.evaluate("(p => !p.notes.length && !p.pages.length && !p.exports.length)(window.plan2)"))
    check("no JavaScript errors (tidy)", not errors, "; ".join(errors[:3]))
    ctx.close()

    # ---------- PDF annotation: text, search, colour meanings, key, write into the PDF ----------
    ctx, page, cdp, errors = open_page("?annotate", ready="window.ctx && window.ctx.state.pageText && window.ctx.state.pageImages.length === 2")
    page.evaluate("api.updateScene({appState: {zoom: {value: 1}, scrollX: 40, scrollY: 20}})"); page.wait_for_timeout(250)
    text = page.evaluate("ctx.state.pageText.map(p => p.map(w => w.t).join(' '))")
    check("PDF text is read word by word on import", "Evidence shows the results are significant." in text[0] and text[1] == "Rotated page words", str(text))
    check("…and kept next to the page images", page.evaluate("fakeApp.files.has('Handnote/Attachments/Week 2 pages/text.json')"))
    ev = page.evaluate("ctx.state.pageText[0].find(w => w.t === 'Evidence')")
    base = ev["y"] + ev["h"] * 0.85 / 1.1
    check("word boxes sit where the words are", abs(ev["x"] - 80) < 2 and abs(base - (842 - 700) * 96 / 72) < 3, f"{ev}, baseline {base:.1f}")
    rw = page.evaluate("ctx.state.pageText[1][0]")
    check("…also on a page shown turned", abs(rw["x"] - 80) < 2 and abs(rw["y"] + rw["h"] * 0.85 / 1.1 - 100 * 96 / 72) < 3, str(rw))

    # search
    tool_before = page.evaluate("api.getAppState().activeTool.type")
    page.click(".hn-toolbar button[aria-label='Search']"); page.wait_for_timeout(250)
    page.fill(".hn-search-input", "SIGNIFICANT"); page.wait_for_timeout(350)
    check("search finds words (any case)", page.inner_text(".hn-search-count").strip() == "1 / 1" and page.locator(".hn-search-hit").count() == 1,
          page.inner_text(".hn-search-count"))
    check("…typing in search doesn't switch tools", page.evaluate("api.getAppState().activeTool.type") == tool_before)
    page.fill(".hn-search-input", "information systems"); page.wait_for_timeout(350)
    check("search finds a word hyphenated over two lines", page.inner_text(".hn-search-count").strip() == "1 / 1" and page.locator(".hn-search-hit").count() == 2)
    page.screenshot(path=str(OUT / "pdf-search.png"))
    page.fill(".hn-search-input", "rotated page"); page.wait_for_timeout(450)
    check("…and goes to the page it's on", page.inner_text(".hn-search-count").strip() == "1 / 1" and page.evaluate("ctx.currentPage()") == 1)
    page.fill(".hn-search-input", "zebra"); page.wait_for_timeout(300)
    check("…says when there's nothing", page.inner_text(".hn-search-count").strip() == "No matches")
    page.keyboard.press("Escape"); page.wait_for_timeout(150)
    check("Escape closes search", page.locator(".hn-search").count() == 0)
    page.evaluate("api.updateScene({appState: {zoom: {value: 1}, scrollX: 40, scrollY: 20}})"); page.wait_for_timeout(200)

    # highlight snapped to words
    hls = "api.getSceneElements().filter(e => e.customData?.hn === 'hl').map(e => ({type: e.type, text: e.customData.text, color: e.type === 'rectangle' ? e.backgroundColor : e.strokeColor}))"
    tap(page, "Highlighter")
    a = page.evaluate("wordAt(0, 'Evidence', 'left')"); b = page.evaluate("wordAt(0, 'significant.', 'right')")
    pen_stroke(cdp, wobbly(a["x"] - 6, b["x"] + 6, a["y"], 50, 2.5), page, settle=300)
    hl = page.evaluate(hls)
    check("highlighting over PDF text snaps to the words and keeps the text",
          len(hl) == 1 and hl[0]["type"] == "rectangle" and hl[0]["text"] == "Evidence shows the results are significant.", str(hl))
    page.wait_for_timeout(200)
    under = page.evaluate("""(() => {
        const e = api.getSceneElements().find(e => e.customData?.hn === 'hl' && e.type === 'rectangle');
        const p = ctx.toScreen(e.x + e.width * 0.5, e.y + e.height * 0.5); const d = window.devicePixelRatio;
        const px = sel => { const c = document.querySelector(sel); return [...c.getContext('2d').getImageData(Math.round(p.x * d), Math.round(p.y * d), 1, 1).data]; };
        return { on: document.querySelector('.hn-root').classList.contains('hn-under-on'), under: px('canvas.hn-under'), stat: px('canvas.excalidraw__canvas.static') };
    })()""")
    check("PDF word highlights are drawn under the ink too (the PDF text stays dark on iPad)",
          under["on"] and under["under"][3] == 255 and under["stat"][3] == 0, json.dumps(under))
    check("…the key under the page shows what the colour means", page.locator(".hn-legend").count() == 1 and "Evidence" in page.inner_text(".hn-legend"))
    undo(page)
    check("…one undo removes the highlight (and the key)", len(page.evaluate(hls)) == 0 and page.locator(".hn-legend").count() == 0)
    tap(page, "Redo"); page.wait_for_timeout(150)
    check("…redo brings it back", len(page.evaluate(hls)) == 1)

    page.evaluate("ctx.setInkColor('#b2f2bb')")
    a = page.evaluate("wordAt(0, 'A', 'left')"); b = page.evaluate("wordAt(0, 'infor-', 'right')")
    pen_stroke(cdp, line(a["x"] - 4, a["y"], b["x"] + 4, a["y"] + 2, 40), page, settle=300)
    page.evaluate("ctx.setInkColor('#ffc9c9')")
    a = page.evaluate("wordAt(0, 'Unrelated', 'left')"); b = page.evaluate("wordAt(0, 'sentence.', 'right')")
    pen_stroke(cdp, line(a["x"] - 4, a["y"], b["x"] + 4, a["y"], 40), page, settle=300)
    legend = page.inner_text(".hn-legend")
    check("…each colour used on the page is in its key (named ones only)", "Evidence" in legend and "Key idea" in legend and "Unrelated" not in legend, legend)
    pen_stroke(cdp, line(140, 700, 400, 700, 30), page, settle=300)  # empty space low on page 1: no words
    check("a highlight away from the text stays a normal stroke", page.evaluate(hls)[-1]["type"] == "freedraw")

    # name the new colour in the highlighter's panel
    tap(page, "Highlighter"); page.wait_for_timeout(200)
    check("the highlighter panel has 'What colours mean'", page.locator(".hn-meanings").count() == 1)
    page.fill(".hn-meaning-input", "Counter-argument"); page.keyboard.press("Enter"); page.wait_for_timeout(300)
    page.screenshot(path=str(OUT / "pdf-meanings.png"))
    legend = page.inner_text(".hn-legend")
    check("naming a colour adds it to the key straight away", "Counter-argument" in legend, legend)
    saved = page.evaluate("JSON.parse(fakeApp.data.get(view.file.path)).handnote.meta.highlightCategories")
    check("…and the meanings are saved in the notebook", any(c["label"] == "Counter-argument" and c["color"] == "#ffc9c9" for c in saved), str(saved))
    page.evaluate("ctx.setState({panel: null})"); page.wait_for_timeout(100)
    page.screenshot(path=str(OUT / "pdf-legend.png"))

    # highlight on the turned page
    page.evaluate("ctx.scrollTo(ctx.state.pages.sizes[0].w / 2, pageRects(ctx.state.pages)[1].y + 60)"); page.wait_for_timeout(250)
    page.evaluate("ctx.setInkColor('#ffe066')")
    a = page.evaluate("wordAt(1, 'Rotated', 'left')"); b = page.evaluate("wordAt(1, 'words', 'right')")
    pen_stroke(cdp, line(a["x"] - 4, a["y"], b["x"] + 4, a["y"], 40), page, settle=300)
    check("highlights snap to words on a turned page too", page.evaluate(hls)[-1].get("text") == "Rotated page words", str(page.evaluate(hls)[-1]))

    # write into the PDF
    page.evaluate("view.saveIntoPdf()")
    check("writing into the PDF keeps a clean copy of the original",
          page.evaluate("fakeApp.files.has('Handnote/Attachments/Week 2 pages/original.pdf')"))
    read_pdf = """(async path => {
        const doc = await pdfjs.getDocument({data: bytesOf(path).slice()}).promise;
        const out = [];
        for (let n = 1; n <= doc.numPages; n++) {
          const p = await doc.getPage(n);
          const annots = (await p.getAnnotations()).filter(a => a.subtype === 'Highlight')
            .map(a => ({text: a.contentsObj?.str, rect: a.rect, color: Array.from(a.color || [])}));
          const t = await p.getTextContent();
          const ops = await p.getOperatorList();
          const imgs = ops.fnArray.filter(f => f === pdfjs.OPS.paintImageXObject).length;
          out.push({view: p.view, rotate: p.rotate, annots, imgs, text: t.items.map(i => i.str).join(' ')});
        }
        return out;
    })"""
    pdf = page.evaluate(read_pdf + "('Lectures/Week 2.pdf')")
    p1 = pdf[0]
    texts = [a_["text"] for a_ in p1["annots"]]
    check("the PDF gets real highlight annotations, named by meaning",
          "Evidence: Evidence shows the results are significant." in texts and "Key idea: A second claim about infor-" in texts
          and "Counter-argument: Unrelated closing sentence." in texts, str(texts))
    ev_rect = next(a_["rect"] for a_ in p1["annots"] if a_["text"].startswith("Evidence:"))
    check("…sitting on the words they highlight", ev_rect[0] < 62 and abs(ev_rect[0] - 60) < 3 and ev_rect[1] < 700 < ev_rect[3] and ev_rect[3] - ev_rect[1] < 24, str(ev_rect))
    check("…the PDF's own text is kept (still selectable and searchable)", "Evidence shows the results are significant." in p1["text"])
    check("…the page grows at the bottom for the colour key", abs(p1["view"][1] + 22.5) < 0.6 and abs(p1["view"][3] - 842) < 0.1, str(p1["view"]))
    check("…a freehand highlight (perfectly straight) is drawn too, not dropped", p1["imgs"] == 2, f"{p1['imgs']} images (ink + key expected)")
    p2 = pdf[1]
    r2 = p2["annots"][0]["rect"] if p2["annots"] else None
    check("on a turned page the highlight lands on its words", p2["rotate"] == 90 and r2 and r2[0] < 100 < r2[2] and abs(r2[1] - 60) < 4 and r2[3] > 150, f"{p2['rotate']} {r2}")
    check("…and its key goes on the edge shown at the bottom", abs(p2["view"][2] - (595 + 22.5)) < 0.6, str(p2["view"]))
    page.evaluate("view.saveIntoPdf()")
    again = page.evaluate(read_pdf + "('Lectures/Week 2.pdf')")
    check("writing again doesn't double anything", [len(x["annots"]) for x in again] == [len(x["annots"]) for x in pdf] and again[0]["view"] == p1["view"],
          f"{[len(x['annots']) for x in again]} {again[0]['view']}")
    (OUT / "written.pdf").write_bytes(bytes(page.evaluate("Array.from(bytesOf('Lectures/Week 2.pdf'))")))
    orig = page.evaluate(read_pdf + "('Handnote/Attachments/Week 2 pages/original.pdf')")
    check("…the clean copy stays clean", all(not x["annots"] for x in orig) and orig[0]["view"] == [0, 0, 595, 842])

    # highlights → note
    page.evaluate("ctx.host.collectHighlights()")
    md = page.evaluate("fakeApp.data.get('Handnote/Week 2 highlights.md')") or ""
    check("highlights go into a note, grouped by meaning, with page links",
          "## Evidence" in md and "> Evidence shows the results are significant." in md and "## Counter-argument" in md
          and "[[Lectures/Week 2.pdf#page=1|p. 1]]" in md and md.index("## Evidence") < md.index("## Key idea"), md[:400])

    # export keeps the PDF's pages too
    page.evaluate("ctx.host.exportPdf()")
    exp = page.evaluate(read_pdf + "('Handnote/Exports/Week 2.pdf')")
    check("export of a PDF notebook keeps the real PDF pages and highlights", "significant" in exp[0]["text"] and len(exp[0]["annots"]) == 3)

    # precision eraser rubs out a word highlight; closing the notebook updates the PDF
    page.evaluate("api.updateScene({appState: {zoom: {value: 1}, scrollX: 40, scrollY: 20}})"); page.wait_for_timeout(200)
    tap(page, "Precision eraser")
    a = page.evaluate("wordAt(0, 'Unrelated', 'mid')")
    pen_stroke(cdp, line(a["x"] - 2, a["y"] - 6, a["x"] + 2, a["y"] + 6, 8), page, settle=300)
    check("the precision eraser rubs out a word highlight", not any(h.get("text") == "Unrelated closing sentence." for h in page.evaluate(hls)))
    page.evaluate("view.onUnloadFile(view.file)"); page.wait_for_timeout(300)
    closed = page.evaluate(read_pdf + "('Lectures/Week 2.pdf')")
    check("closing the notebook updates the PDF", len(closed[0]["annots"]) == 2, str([a_["text"] for a_ in closed[0]["annots"]]))
    check("no JavaScript errors (PDF annotation)", not errors, "; ".join(errors[:3]))
    ctx.close()

    # ---------- selecting PDF text ----------
    # A PDF whose crop box reaches past the page (PowerPoint/Keynote do this): exports put
    # highlights and ink too high, because they used the raw crop box instead of the visible part.
    ctx, page, cdp, errors = open_page("?annotate&crop", ready="window.ctx && window.ctx.state.pageText && window.ctx.state.pageImages.length === 2")
    page.evaluate("api.updateScene({appState: {zoom: {value: 1}, scrollX: 40, scrollY: 20}})"); page.wait_for_timeout(250)
    tap(page, "Highlighter")
    a = page.evaluate("wordAt(0, 'Evidence', 'left')"); b = page.evaluate("wordAt(0, 'significant.', 'right')")
    pen_stroke(cdp, wobbly(a["x"] - 6, b["x"] + 6, a["y"], 50, 2.5), page, settle=300)
    page.evaluate("ctx.host.exportPdf()"); page.wait_for_timeout(2500)
    exp = page.evaluate(read_pdf + "('Handnote/Exports/Week 2.pdf')")
    r = exp[0]["annots"][0]["rect"] if exp[0]["annots"] else [0, 0, 0, 0]
    check("exports put highlights on the words when the PDF's crop box reaches past the page",
          r[1] < 700 < r[3] and r[3] - 700 < 16 and exp[0]["view"][3] == 842, f"rect {r}, view {exp[0]['view']}")
    check("no JavaScript errors (crop box)", not errors, "; ".join(errors[:3]))
    ctx.close()

    ctx, page, cdp, errors = open_page("?annotate", ready="window.ctx && window.ctx.state.pageText && window.ctx.state.pageImages.length === 2")
    ctx.grant_permissions(["clipboard-read", "clipboard-write"])
    page.evaluate("ctx.minZoom = () => 0.25; ctx.clampView = (v) => v")
    page.evaluate("api.updateScene({appState: {zoom: {value: 1}, scrollX: 40, scrollY: 20}})"); page.wait_for_timeout(250)
    check("a Select text tool appears in PDF notebooks", page.locator(".hn-toolbar button[aria-label='Select text']").count() == 1)
    page.click(".hn-toolbar button[aria-label='Select text']"); page.wait_for_timeout(150)
    a = page.evaluate("wordAt(0, 'Evidence', 'left')"); b = page.evaluate("wordAt(0, 'significant.', 'right')")
    n_before = page.evaluate("api.getSceneElements().length")
    pen_stroke(cdp, line(a["x"] + 2, a["y"], b["x"] - 2, b["y"], 20), page, settle=200)
    check("dragging the Pencil over words selects them (and draws nothing)",
          page.locator(".hn-tsel-box").count() == 1 and page.locator(".hn-tsel-bar").count() == 1 and page.evaluate("api.getSceneElements().length") == n_before)
    page.screenshot(path=str(OUT / "pdf-select.png"))
    page.click(".hn-tsel-btn:has-text('Copy')"); page.wait_for_timeout(200)
    clip = page.evaluate("navigator.clipboard.readText()")
    check("Copy puts the selected text on the clipboard", clip == "Evidence shows the results are significant.", repr(clip))
    a = page.evaluate("wordAt(0, 'second', 'mid')"); b = page.evaluate("wordAt(0, 'systems', 'mid')")
    pen_stroke(cdp, line(a["x"], a["y"], b["x"], b["y"], 20), page, settle=200)
    page.click(".hn-tsel-btn:has-text('Copy')"); page.wait_for_timeout(200)
    clip = page.evaluate("navigator.clipboard.readText()")
    check("a selection runs across lines and joins a hyphenated word", clip == "second claim about information systems", repr(clip))
    c = page.evaluate("wordAt(0, 'follows', 'mid')")
    pen_stroke(cdp, line(b["x"], b["y"], c["x"], c["y"], 10), page, settle=200)
    page.click(".hn-tsel-btn:has-text('Copy')"); page.wait_for_timeout(200)
    check("dragging from the end of a selection extends it", page.evaluate("navigator.clipboard.readText()") == "second claim about information systems follows")
    page.click(".hn-tsel-btn:has-text('Highlight')"); page.wait_for_timeout(300)
    made = page.evaluate("api.getSceneElements().filter(e => !e.isDeleted && e.customData?.hn === 'hl').map(e => e.customData.text)")
    check("Highlight turns the selection into word highlights", made == ["A second claim about infor-", "mation systems follows"] or sorted(made) == sorted(["A second claim about infor-", "mation systems follows"]) or ("second claim about infor-" in " ".join(made) and "mation systems follows" in " ".join(made)), str(made))
    check("…and the selection goes away", page.locator(".hn-tsel-box").count() == 0)
    t = page.evaluate("wordAt(0, 'Unrelated', 'mid')")
    pen_stroke(cdp, [(t["x"], t["y"]), (t["x"] + 1, t["y"])], page, settle=200)
    page.click(".hn-tsel-btn:has-text('Copy')"); page.wait_for_timeout(200)
    check("tapping a word selects that word", page.evaluate("navigator.clipboard.readText()") == "Unrelated")
    page.click(".hn-tsel-btn:has-text('Search')"); page.wait_for_timeout(300)
    check("Search looks for the selected text", page.input_value(".hn-search-input") == "Unrelated" and page.inner_text(".hn-search-count").strip() == "1 / 1")
    page.keyboard.press("Escape"); page.evaluate("ctx.setState({panel: null})"); page.wait_for_timeout(100)
    y0 = page.evaluate("api.getAppState().scrollY")
    touch(cdp, "touchStart", [(0, (900, 650))])
    for k in range(1, 8): touch(cdp, "touchMove", [(0, (900, 650 - k * 20))], fresh=False); page.wait_for_timeout(16)
    touch(cdp, "touchEnd", [], fresh=False); page.wait_for_timeout(300)
    check("fingers still scroll with the Select text tool", abs(page.evaluate("api.getAppState().scrollY") - (y0 - 140)) < 3)
    check("no JavaScript errors (PDF text selection)", not errors, "; ".join(errors[:3]))
    ctx.close()

    # performance meter
    ctx, page, cdp, errors = open_page()
    page.evaluate("store.updateCore({showPerf: true})"); page.wait_for_timeout(150)
    tap(page, "Ballpoint")
    pen_stroke(cdp, line(300, 400, 500, 410, 20), page, settle=200)
    meter = page.evaluate("document.querySelector('.hn-perf')?.textContent || ''")
    check("the performance meter shows the time after lifting the Pencil", "After lifting the Pencil" in meter and " 0 ms" not in meter.split("Scrolling")[0], meter)
    ctx.close()

    # colour key on a plain notebook's export
    ctx, page, cdp, errors = open_page()
    page.evaluate("api.updateScene({appState: {zoom: {value: 1}, scrollX: 0, scrollY: 0}})"); page.wait_for_timeout(150)
    tap(page, "Highlighter")
    pen_stroke(cdp, line(200, 300, 500, 300, 30), page, settle=250)
    check("plain notebooks get the key too", "Evidence" in page.inner_text(".hn-legend"))
    page.evaluate("ctx.host.exportPdf()")
    page.wait_for_function("window.exportedPdf !== undefined", timeout=20000)
    h = page.evaluate("(async () => (await PDFDocument.load(window.exportedPdf)).getPage(0).getHeight())()")
    check("…and exported pages get it underneath", abs(h - (1123 + 30) * 0.75) < 1, str(h))
    check("no JavaScript errors (key export)", not errors, "; ".join(errors[:3]))
    ctx.close()

    # ---------- old settings migrate ----------
    v1 = {"notesFolder": "Hand", "pen": {"color": "#e03131", "width": 1.5, "opacity": 100, "stabilization": 70},
          "highlighter": {"color": "#b2f2bb", "width": 6, "opacity": 40, "stabilization": 50},
          "favourites": ["#000000"], "scribbleToDelete": False, "longPressMenu": True, "longPressMs": 600}
    ctx, page, cdp, errors = open_page("?v1=" + urllib.parse.quote(json.dumps(v1)))
    s = page.evaluate("store.get()")
    check("0.1 settings migrate to 0.3", s["core"]["pen"]["color"] == "#e03131" and s["features"]["stabilizer"]["writing"] == 70
          and s["features"]["scribble-delete"]["enabled"] is False and "ballpoint" in s["core"])
    ctx.close()

    # ---------- dark ----------
    ctx, page, cdp, errors = open_page("?dark")
    for i in range(3):
        pen_stroke(cdp, [(300 + i * 10 + k * 4, 250 + 30 * math.sin(k / 5) + i * 40) for k in range(60)], page)
    touch(cdp, "touchStart", [(0, (800, 500))]); page.wait_for_timeout(650)
    page.screenshot(path=str(OUT / "dark.png"))
    touch(cdp, "touchEnd", [])
    check("dark mode without errors", not errors, "; ".join(errors[:2]))
    ctx.close()
    browser.close()

print(f"\n{sum(1 for r in results if r[1])}/{len(results)} passed")
