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

def touch(cdp, kind, points):
    cdp.send("Input.dispatchTouchEvent", {"type": kind, "touchPoints": [{"x": x, "y": y, "id": i} for i, (x, y) in points]})

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

def tap(page, label):
    page.click(f".hn-toolbar button[aria-label='{label}']")
    page.wait_for_timeout(120)

def undo(page):
    tap(page, "Undo"); page.wait_for_timeout(100)

with sync_playwright() as p:
    browser = p.chromium.launch()

    def open_page(query=""):
        ctx = browser.new_context(viewport={"width": 1180, "height": 820}, has_touch=True, device_scale_factor=2)
        page = ctx.new_page()
        errors = []
        page.on("pageerror", lambda e: errors.append(str(e)))
        page.goto(URL + query)
        page.wait_for_function("window.api !== undefined")
        page.wait_for_timeout(700)
        return ctx, page, ctx.new_cdp_session(page), errors

    ctx, page, cdp, errors = open_page()

    # ---------- toolbar ----------
    labels = page.evaluate("[...document.querySelectorAll('.hn-toolbar .hn-btn')].map(b => b.getAttribute('aria-label'))")
    want = ["Fountain pen", "Ballpoint", "Pencil", "Highlighter", "Precision eraser", "Object eraser", "Lasso", "Rectangle select", "Text"]
    check("top bar has every tool", all(t in labels for t in want), ", ".join(l for l in labels if l))
    check("curved palette is gone", page.locator(".hn-arc").count() == 0)
    check("fountain pen is active on open", tool(page) == "Fountain pen", str(tool(page)))
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

    # ---------- top bar quick options ----------
    tap(page, "Highlighter")
    check("highlighter sizes in the top bar", page.locator(".hn-toolbar .hn-size-quick").count() == 3)
    tap(page, "Precision eraser")
    check("eraser sizes in the top bar", page.locator(".hn-toolbar .hn-size-quick").count() == 4)
    tap(page, "Fountain pen")
    page.screenshot(path=str(OUT / "toolbar.png"), clip={"x": 0, "y": 0, "width": 1180, "height": 80})

    check("no JavaScript errors", not errors, "; ".join(errors[:3]))
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
