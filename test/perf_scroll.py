"""Scrolling/zooming cost with a lot of handwriting on the page (CPU slowed to roughly iPad speed).
Usage: python3 test/perf_scroll.py [throttle] [strokes]"""
import sys, pathlib, math
from playwright.sync_api import sync_playwright

URL = (pathlib.Path(__file__).parent / "index.html").as_uri()
THROTTLE = float(sys.argv[1]) if len(sys.argv) > 1 else 4
N = int(sys.argv[2]) if len(sys.argv) > 2 else 1500
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

with sync_playwright() as p:
    b = p.chromium.launch()
    ctx = b.new_context(viewport={"width": 1180, "height": 820}, has_touch=True, device_scale_factor=2)
    page = ctx.new_page(); page.goto(URL)
    page.wait_for_function("window.api !== undefined"); page.wait_for_timeout(600)
    page.evaluate("ctx.minZoom = () => 0.25")
    page.evaluate(FILL, N); page.wait_for_timeout(600)
    cdp = ctx.new_cdp_session(page)
    cdp.send("Performance.enable"); cdp.send("Emulation.setCPUThrottlingRate", {"rate": THROTTLE})
    def metric():
        m = {x["name"]: x["value"] for x in cdp.send("Performance.getMetrics")["metrics"]}
        return m["TaskDuration"]
    def touch(kind, pts):
        cdp.send("Input.dispatchTouchEvent", {"type": kind, "touchPoints": [{"x": x, "y": y, "id": i} for i, (x, y) in pts]})
    page.evaluate("() => { window.frames_ = []; const f = (t) => { window.frames_.push(t); requestAnimationFrame(f); }; requestAnimationFrame(f); }")
    t0 = metric(); n = 0
    for rep in range(3):
        touch("touchStart", [(0, (600, 700))])
        for k in range(1, 41):
            touch("touchMove", [(0, (600, 700 - k * 12 if rep % 2 == 0 else 220 + k * 12))]); n += 1
        touch("touchEnd", [])
    t1 = metric()
    gaps = page.evaluate("window.frames_.slice(1).map((t, i) => t - window.frames_[i])")
    print(f"scroll: {1000*(t1-t0)/n:6.2f} ms per finger move, frames>50ms {sum(1 for g in gaps if g > 50)}, worst {max(gaps):.0f} ms", flush=True)
    t0 = metric(); n = 0
    touch("touchStart", [(0, (500, 400))]); touch("touchStart", [(0, (500, 400)), (1, (700, 400))])
    for k in range(1, 31):
        touch("touchMove", [(0, (500 - k * 4, 400)), (1, (700 + k * 4, 400))]); n += 1
    touch("touchEnd", [(1, (820, 400))]); touch("touchEnd", [])
    t1 = metric()
    print(f"pinch:  {1000*(t1-t0)/n:6.2f} ms per finger move", flush=True)
    st = page.evaluate("[api.getAppState().scrollY, api.getAppState().zoom.value]")
    print("final scrollY/zoom", st)
