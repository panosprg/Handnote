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

def pen_stroke(cdp, pts, page, delay=8, settle=150):
    x, y = pts[0]
    cdp.send("Input.dispatchMouseEvent", {"type": "mouseMoved", "x": x, "y": y, "pointerType": "pen"})
    cdp.send("Input.dispatchMouseEvent", {"type": "mousePressed", "x": x, "y": y, "button": "left", "buttons": 1, "clickCount": 1, "pointerType": "pen", "force": 0.5})
    for (x, y) in pts[1:]:
        cdp.send("Input.dispatchMouseEvent", {"type": "mouseMoved", "x": x, "y": y, "button": "left", "buttons": 1, "pointerType": "pen", "force": 0.5})
        page.wait_for_timeout(delay)
    cdp.send("Input.dispatchMouseEvent", {"type": "mouseReleased", "x": x, "y": y, "button": "left", "buttons": 0, "clickCount": 1, "pointerType": "pen"})
    page.wait_for_timeout(settle)

def touch(cdp, kind, points):
    cdp.send("Input.dispatchTouchEvent", {"type": kind, "touchPoints": [{"x": x, "y": y, "id": i} for i, (x, y) in points]})

def line(x0, y0, x1, y1, n=40):
    return [(x0 + (x1 - x0) * i / (n - 1), y0 + (y1 - y0) * i / (n - 1)) for i in range(n)]

def els(page):
    return page.evaluate("api.getSceneElements().map(e => ({id: e.id, type: e.type, hl: e.customData?.hn === 'hl', n: e.points?.length}))")

def last_freedraw(page):
    return page.evaluate("""() => { const a = api.getSceneElements().filter(e => e.type === 'freedraw');
        const e = a[a.length-1]; return e ? {id: e.id, pts: e.points.map(p => [p[0]+e.x, p[1]+e.y])} : null }""")

def roughness(pts):
    ys = [p[1] for p in pts]
    return sum(abs(ys[i+1] - 2*ys[i] + ys[i-1]) for i in range(1, len(ys)-1)) / max(1, len(ys) - 2)

def wobbly(x0, x1, y, n=70, amp=3.0, seed=1):
    r = random.Random(seed)
    return [(x0 + (x1-x0)*i/(n-1), y + r.uniform(-amp, amp)) for i in range(n)]

def tool(page):
    return page.evaluate("document.querySelector('.hn-stick.is-active')?.getAttribute('aria-label')")

def tap(page, label):
    page.click(f".hn-root button.hn-stick[aria-label='{label}'], .hn-root button.hn-arc-btn[aria-label='{label}']")
    page.wait_for_timeout(120)

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

    # ---------- palette + top bar ----------
    check("curved palette is shown", page.locator(".hn-arc").count() == 1)
    check("glass top bar is shown with it", page.locator(".hn-toolbar.hn-glass").count() == 1)
    page.click(".hn-toolbar [aria-label='Paper']"); page.wait_for_timeout(250)
    check("top bar opens the paper panel at the top", page.locator(".hn-panel-top").count() == 1)
    page.click(".hn-toolbar [aria-label='Paper']"); page.wait_for_timeout(150)
    check("pen is the active tool", tool(page) == "Pen", tool(page))
    labels = page.evaluate("[...document.querySelectorAll('.hn-stick')].map(b => b.getAttribute('aria-label'))")
    check("palette has both erasers", "Precision eraser" in labels and "Object eraser" in labels, ", ".join(labels))
    page.screenshot(path=str(OUT / "palette.png"))

    # ---------- stabilization ----------
    page.evaluate("store.updateFeature('stabilizer', {pen: 0})")
    pen_stroke(cdp, wobbly(250, 750, 200), page)
    raw = last_freedraw(page)
    page.evaluate("store.updateFeature('stabilizer', {pen: 80})")
    pen_stroke(cdp, wobbly(250, 750, 260), page)
    smooth = last_freedraw(page)
    check("stabilization smooths wobble", roughness(smooth["pts"]) < roughness(raw["pts"]) * 0.6,
          f"{roughness(raw['pts']):.2f} → {roughness(smooth['pts']):.2f}")
    page.evaluate("store.updateFeature('stabilizer', {pen: 35})")

    # ---------- precision eraser ----------
    pen_stroke(cdp, line(300, 340, 700, 340, 60), page)
    target = last_freedraw(page)["id"]
    n0 = len(els(page))
    tap(page, "Precision eraser")
    check("precision eraser selected", tool(page) == "Precision eraser")
    pen_stroke(cdp, line(500, 300, 500, 380, 20), page)
    after = els(page)
    pieces = [e for e in after if e["type"] == "freedraw"]
    check("precision eraser splits the stroke in two", len(after) == n0 + 1 and any(e["id"] == target for e in after),
          f"{n0} → {len(after)} elements")
    page.evaluate("document.querySelector('.hn-eraser-cursor').style.display")  # exists
    pen_stroke(cdp, line(320, 330, 330, 350, 6), page)  # nibble the left end
    page.keyboard.press("Escape")
    n_before_undo = len(els(page))
    page.click(".hn-arc-btn[aria-label='Undo']"); page.wait_for_timeout(150)
    page.click(".hn-arc-btn[aria-label='Undo']"); page.wait_for_timeout(150)
    check("each precision-erase stroke is one undo step", len(els(page)) == n0, f"{n_before_undo} → {len(els(page))}")

    # ---------- object eraser + erase effect ----------
    tap(page, "Pen")
    pen_stroke(cdp, [(300 + k*4, 440 + 15*math.sin(k/4)) for k in range(60)], page)
    victim = last_freedraw(page)["id"]
    tap(page, "Object eraser")
    pen_stroke(cdp, line(380, 400, 400, 480, 12), page, settle=60)
    page.wait_for_timeout(120)
    ghosts = page.locator(".hn-ghost").count()
    page.screenshot(path=str(OUT / "erase-effect.png"))
    page.wait_for_timeout(800)
    check("object eraser removes the whole stroke", victim not in [e["id"] for e in els(page)])
    check("erased stroke plays the un-draw animation", ghosts >= 1, f"{ghosts} ghost(s)")
    check("animation cleans up after itself", page.locator(".hn-ghost").count() == 0)

    # ---------- scribble ----------
    tap(page, "Pen")
    pen_stroke(cdp, [(650 + k*3, 470 + 18*math.sin(k/2.2)) for k in range(50)], page)
    word = last_freedraw(page)["id"]
    zz = []
    for k in range(9):
        zz += [(640, 455 + k*4), (810, 462 + k*4)]
    dense = [(a[0] + (b[0]-a[0])*t/6, a[1] + (b[1]-a[1])*t/6) for a, b in zip(zz, zz[1:]) for t in range(6)]
    pen_stroke(cdp, dense, page, delay=3, settle=100)
    g2 = page.locator(".hn-ghost").count()
    page.wait_for_timeout(300)
    check("scribble deletes the word", word not in [e["id"] for e in els(page)])
    check("scribble also animates", g2 >= 1)
    page.wait_for_timeout(700)

    # ---------- highlighter behind ----------
    pen_stroke(cdp, [(300 + k*6, 560 + 8*math.sin(k)) for k in range(60)], page)
    ink = last_freedraw(page)["id"]
    n_ink = len(els(page))
    tap(page, "Highlighter")
    pen_stroke(cdp, line(290, 562, 660, 562, 40), page)
    order = els(page)
    hl = [e for e in order if e["hl"]]
    check("highlighter stroke is tagged", len(hl) == 1)
    check("highlighter sits behind the writing", order[0]["hl"] and [e["id"] for e in order].index(ink) > 0,
          f"first element is {'highlight' if order[0]['hl'] else order[0]['type']}")
    page.screenshot(path=str(OUT / "highlight.png"), clip={"x": 250, "y": 520, "width": 460, "height": 90})
    page.click(".hn-arc-btn[aria-label='Undo']"); page.wait_for_timeout(200)
    after_undo = els(page)
    check("one undo removes the highlight (and only it)", len(after_undo) == n_ink and ink in [e["id"] for e in after_undo],
          f"{len(order)} → {len(after_undo)}")
    tap(page, "Pen")

    # ---------- colour panel ----------
    tap(page, "Colour and size")
    check("colour button opens the pen panel", page.locator(".hn-panel .hn-panel-title").first.inner_text() == "Pen")
    page.click("button.hn-hue[aria-label='Blue']")
    page.click("button.hn-shade[aria-label='#4dabf7']")
    page.wait_for_timeout(100)
    check("shade sets pen colour", page.evaluate("api.getAppState().currentItemStrokeColor") == "#4dabf7")
    check("stabilization slider is in the panel (from its feature)", page.locator(".hn-panel .hn-slider").count() == 1)
    page.screenshot(path=str(OUT / "ink-panel.png"))
    tap(page, "Colour and size")

    # ---------- more panel ----------
    tap(page, "More")
    page.screenshot(path=str(OUT / "more-panel.png"))
    page.click("button.hn-paper-opt.hn-tpl-grid")
    page.wait_for_timeout(100)
    check("paper switches to grid", page.locator(".hn-root.hn-tpl-grid").count() == 1)
    tap(page, "More")

    # ---------- long-press menu ----------
    touch(cdp, "touchStart", [(0, (900, 300))])
    page.wait_for_timeout(650)
    check("long-press opens radial menu", page.locator(".hn-menu").count() == 1)
    box = page.locator(".hn-menu-item[aria-label='Precision eraser']").bounding_box()
    if box:
        ex, ey = box["x"] + box["width"]/2, box["y"] + box["height"]/2
        for t in range(1, 6):
            touch(cdp, "touchMove", [(0, (900 + (ex-900)*t/5, 300 + (ey-300)*t/5))]); page.wait_for_timeout(16)
    touch(cdp, "touchEnd", [])
    page.wait_for_timeout(150)
    check("slide-and-release picks the precision eraser", tool(page) == "Precision eraser", tool(page))
    tap(page, "Pen")

    # ---------- finger scroll + two-finger undo ----------
    sy0 = page.evaluate("api.getAppState().scrollY")
    touch(cdp, "touchStart", [(0, (950, 600))])
    for k in range(1, 11):
        touch(cdp, "touchMove", [(0, (950, 600 - k*12))]); page.wait_for_timeout(16)
    touch(cdp, "touchEnd", [])
    page.wait_for_timeout(100)
    check("one finger scrolls", page.evaluate("api.getAppState().scrollY") < sy0 - 60)
    pen_stroke(cdp, line(300, 300, 450, 300, 20), page)
    n1 = len(els(page)); page.wait_for_timeout(250)
    touch(cdp, "touchStart", [(0, (700, 500))]); touch(cdp, "touchStart", [(0, (700, 500)), (1, (780, 520))])
    page.wait_for_timeout(80)
    touch(cdp, "touchEnd", [(1, (780, 520))]); touch(cdp, "touchEnd", [])
    page.wait_for_timeout(200)
    check("two-finger tap undoes", len(els(page)) == n1 - 1)

    # ---------- add a feature at runtime (no core changes) ----------
    page.evaluate("""registry.register({ id: 'demo-star', name: 'Demo', description: 'test', defaults: {},
        tools: [{ id: 'star', label: 'Star stamp', icon: 'star', order: 45, activate: () => {} }] })""")
    page.wait_for_timeout(200)
    check("a feature added at runtime shows up on the palette", page.locator(".hn-stick[aria-label='Star stamp']").count() == 1)
    page.screenshot(path=str(OUT / "palette-with-addon.png"))
    page.evaluate("registry.unregister('demo-star')")

    # ---------- switching a feature off ----------
    page.evaluate("store.updateFeature('precision-eraser', {enabled: false})")
    page.wait_for_timeout(200)
    check("turning a feature off removes its tool", page.locator(".hn-stick[aria-label='Precision eraser']").count() == 0)
    page.evaluate("store.updateFeature('precision-eraser', {enabled: true})")

    # ---------- classic toolbar still works ----------
    page.evaluate("store.updateCore({toolbarStyle: 'classic'})")
    page.wait_for_timeout(200)
    check("classic toolbar swaps in", page.locator(".hn-toolbar").count() == 1 and page.locator(".hn-arc").count() == 0)
    page.screenshot(path=str(OUT / "classic.png"))
    check("no JavaScript errors", not errors, "; ".join(errors[:3]))
    ctx.close()

    # ---------- old (v0.1) settings migrate ----------
    v1 = {"notesFolder": "Hand", "pen": {"color": "#e03131", "width": 1.5, "opacity": 100, "stabilization": 70},
          "highlighter": {"color": "#b2f2bb", "width": 6, "opacity": 40, "stabilization": 50},
          "favourites": ["#000000"], "scribbleToDelete": False, "longPressMenu": True, "longPressMs": 600}
    ctx, page, cdp, errors = open_page("?v1=" + urllib.parse.quote(json.dumps(v1)))
    s = page.evaluate("store.get()")
    check("v0.1 settings migrate", s["core"]["pen"]["color"] == "#e03131" and s["features"]["stabilizer"]["pen"] == 70
          and s["features"]["scribble-delete"]["enabled"] is False and s["features"]["radial-menu"]["delay"] == 600)
    ctx.close()

    # ---------- dark ----------
    ctx, page, cdp, errors = open_page("?dark")
    page.evaluate("document.querySelector('.hn-panel') && 0")
    for i in range(3):
        pen_stroke(cdp, [(300 + i*10 + k*4, 250 + 30*math.sin(k/5) + i*40) for k in range(60)], page)
    page.screenshot(path=str(OUT / "dark.png"))
    check("dark mode without errors", not errors, "; ".join(errors[:2]))
    ctx.close()
    browser.close()

print(f"\n{sum(1 for r in results if r[1])}/{len(results)} passed")
