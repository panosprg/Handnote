"""Drawing performance: main-thread time per pen event and frame gaps while writing,
on a notebook that already has a lot of handwriting. CPU is throttled to approximate an iPad.
Usage: python3 test/perf.py [throttle] [existing_strokes]"""
import math, sys, pathlib, statistics
from playwright.sync_api import sync_playwright

HERE = pathlib.Path(__file__).parent
URL = (HERE / "index.html").as_uri()
THROTTLE = float(sys.argv[1]) if len(sys.argv) > 1 else 4
EXISTING = int(sys.argv[2]) if len(sys.argv) > 2 else 800
ONLY = sys.argv[3].split(",") if len(sys.argv) > 3 else None

FILL = """(n) => {
  const els = [];
  for (let i = 0; i < n; i++) {
    const x = 60 + (i % 40) * 17, y = 80 + Math.floor(i / 40) * 26;
    const pts = []; for (let k = 0; k < 30; k++) pts.push([k * 0.5, Math.sin(k / 3) * 6]);
    els.push({ id: 'f' + i, type: 'freedraw', x, y, width: 15, height: 12, angle: 0, strokeColor: '#1e1e1e',
      backgroundColor: 'transparent', fillStyle: 'solid', strokeWidth: 1, strokeStyle: 'solid', roughness: 0, opacity: 100,
      groupIds: [], frameId: null, roundness: null, seed: i + 1, version: 1, versionNonce: i + 1, isDeleted: false,
      boundElements: null, updated: 1, link: null, locked: false, points: pts, pressures: [], simulatePressure: true,
      lastCommittedPoint: null, index: null });
  }
  api.updateScene({ elements: els, captureUpdate: 'IMMEDIATELY' });
}"""

def run(off, label, p, css="", js="", query=""):
    ctx = p.new_context(viewport={"width": 1180, "height": 820}, has_touch=True, device_scale_factor=2)
    page = ctx.new_page()
    page.goto(URL + query)
    page.wait_for_function("window.api !== undefined && window.ctx !== undefined")
    page.wait_for_timeout(500)
    for f in off:
        page.evaluate(f"store.updateFeature('{f}', {{ enabled: false }})")
    if css: page.add_style_tag(content=css)
    if js: page.evaluate(js)
    page.evaluate(FILL, EXISTING)
    page.wait_for_timeout(500)
    cdp = ctx.new_cdp_session(page)
    cdp.send("Performance.enable")
    cdp.send("Emulation.setCPUThrottlingRate", {"rate": THROTTLE})
    page.evaluate("""() => { window.frames_ = []; const f = (t) => { window.frames_.push(t); requestAnimationFrame(f); }; requestAnimationFrame(f); }""")
    def metric():
        m = {x["name"]: x["value"] for x in cdp.send("Performance.getMetrics")["metrics"]}
        return m["TaskDuration"], m["ScriptDuration"]
    t0, s0 = metric()
    n = 0
    for stroke in range(4):
        y = 560 + stroke * 30
        pts = [(200 + i * 4, y + 10 * math.sin(i / 4)) for i in range(90)]
        cdp.send("Input.dispatchMouseEvent", {"type": "mousePressed", "x": pts[0][0], "y": pts[0][1], "button": "left", "buttons": 1, "clickCount": 1, "pointerType": "pen", "force": 0.5})
        for x, yy in pts[1:]:
            cdp.send("Input.dispatchMouseEvent", {"type": "mouseMoved", "x": x, "y": yy, "button": "left", "buttons": 1, "pointerType": "pen", "force": 0.5})
            n += 1
        cdp.send("Input.dispatchMouseEvent", {"type": "mouseReleased", "x": pts[-1][0], "y": pts[-1][1], "button": "left", "buttons": 0, "clickCount": 1, "pointerType": "pen"})
        page.wait_for_timeout(50)
    t1, s1 = metric()
    gaps = page.evaluate("window.frames_.slice(1).map((t, i) => t - window.frames_[i])")
    long = sum(1 for g in gaps if g > 50)
    print(flush=True, *[f"{label:28s} task {1000*(t1-t0)/n:6.2f} ms/event  script {1000*(s1-s0)/n:6.2f} ms/event  frames>50ms {long:3d}  worst {max(gaps) if gaps else 0:6.0f} ms"])
    ctx.close()

with sync_playwright() as p:
    b = p.chromium.launch()
    feats = b.new_page()
    feats.goto(URL); feats.wait_for_function("window.registry !== undefined")
    ids = feats.evaluate("registry.all().filter(f => f.optional !== false).map(f => f.id)")
    feats.close()
    if ONLY == ["bare"]:
        run([], "plain excalidraw", b, query="?bare")
        run([], "handnote", b)
    elif ONLY == ["css"]:
        run([], "baseline", b)
        run([], "no blend", b, css=".hn-root * { mix-blend-mode: normal !important; }")
        run([], "no backdrop", b, css=".hn-root * { backdrop-filter: none !important; -webkit-backdrop-filter: none !important; }")
        run([], "no paper", b, css=".hn-paper, .hn-desk { display: none !important; }")
        run([], "no overlays", b, css=".hn-toolbar, .hn-optionsbar, .hn-cursor, .hn-pagesui { display: none !important; }")
        run([], "everything", b, css=".hn-root * { mix-blend-mode: normal !important; backdrop-filter: none !important; } .hn-paper, .hn-desk, .hn-toolbar, .hn-optionsbar { display: none !important; }")
    else:
        run([], "all on", b)
        for f in (ONLY or ids):
            run([f], f"without {f}", b)
