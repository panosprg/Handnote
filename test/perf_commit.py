"""Cost of finishing a stroke (Pencil lift → page redrawn) on a heavy PDF notebook:
2 PDF pages, ~1,500 strokes, 60 word highlights. CPU slowed to roughly iPad speed.
Usage: python3 test/perf_commit.py [throttle]"""
import sys, pathlib, math, collections
from playwright.sync_api import sync_playwright

URL = (pathlib.Path(__file__).parent / "index.html").as_uri()
THROTTLE = float(sys.argv[1]) if len(sys.argv) > 1 else 4
PROFILE = "--profile" in sys.argv

SETUP = """async () => {
  ctx.minZoom = () => 0.25; ctx.clampView = (v) => v;
  // two A4 PDF pages: a big image with some 'text'
  const c = document.createElement('canvas'); c.width = 1588; c.height = 2246;
  const g = c.getContext('2d'); g.fillStyle = '#fff'; g.fillRect(0, 0, c.width, c.height);
  g.fillStyle = '#222'; g.font = '28px serif';
  for (let y = 120; y < 2200; y += 44) g.fillText('Lorem ipsum dolor sit amet consectetur adipiscing elit sed do eiusmod tempor', 90, y);
  const url = c.toDataURL('image/jpeg', 0.85);
  ctx.setPages({ sizes: [{ w: 794, h: 1123 }, { w: 794, h: 1123 }] });
  ctx.setState({ pageImages: [url, url] });
  const els = [];
  for (let i = 0; i < 1500; i++) {
    const x = 60 + (i % 40) * 17, y = 80 + Math.floor(i / 40) * 26;
    const pts = []; for (let k = 0; k < 30; k++) pts.push([k * 0.5, Math.sin(k / 3) * 6]);
    els.push({ id: 'f' + i, type: 'freedraw', x, y, width: 15, height: 12, angle: 0, strokeColor: '#1971c2',
      backgroundColor: 'transparent', fillStyle: 'solid', strokeWidth: 1, strokeStyle: 'solid', roughness: 0, opacity: 100,
      groupIds: [], frameId: null, roundness: null, seed: i + 1, version: 1, versionNonce: i + 1, isDeleted: false,
      boundElements: null, updated: 1, link: null, locked: false, points: pts, pressures: [], simulatePressure: true,
      lastCommittedPoint: null, index: null });
  }
  for (let i = 0; i < 60; i++) {
    els.unshift({ id: 'h' + i, type: 'rectangle', x: 80 + (i % 3) * 200, y: 100 + Math.floor(i / 3) * 44, width: 180, height: 30, angle: 0,
      strokeColor: 'transparent', backgroundColor: '#ffe066', fillStyle: 'solid', strokeWidth: 1, strokeStyle: 'solid', roughness: 0,
      opacity: 45, groupIds: [], frameId: null, roundness: { type: 3 }, seed: 9000 + i, version: 1, versionNonce: 9000 + i, isDeleted: false,
      boundElements: null, updated: 1, link: null, locked: false, customData: { hn: 'hl' }, index: null });
  }
  api.updateScene({ elements: els, captureUpdate: 'IMMEDIATELY' });
  ctx.setTool('ballpoint');
}"""

with sync_playwright() as p:
    b = p.chromium.launch()
    bctx = b.new_context(viewport={"width": 1180, "height": 820}, has_touch=True, device_scale_factor=2)
    page = bctx.new_page(); page.goto(URL)
    page.wait_for_function("window.api !== undefined"); page.wait_for_timeout(600)
    page.evaluate(SETUP); page.wait_for_timeout(1500)
    for a in sys.argv[2:]:
        if a.startswith("--js="): page.evaluate(a[5:]); page.wait_for_timeout(800)
    cdp = bctx.new_cdp_session(page)
    cdp.send("Performance.enable"); cdp.send("Emulation.setCPUThrottlingRate", {"rate": THROTTLE})
    def task():
        return {m["name"]: m["value"] for m in cdp.send("Performance.getMetrics")["metrics"]}["TaskDuration"]
    def ev(t, x, y, b=1):
        cdp.send("Input.dispatchMouseEvent", {"type": t, "x": x, "y": y, "button": "left", "buttons": b, "clickCount": 1, "pointerType": "pen", "force": 0.4})
    if PROFILE:
        cdp.send("Profiler.enable"); cdp.send("Profiler.setSamplingInterval", {"interval": 200}); cdp.send("Profiler.start")
    costs = []
    for s in range(5):
        y = 450 + s * 30
        pts = [(300 + i * 4, y + 6 * math.sin(i / 3)) for i in range(40)]
        ev("mouseMoved", *pts[0], 0); ev("mousePressed", *pts[0])
        for x, yy in pts[1:]: ev("mouseMoved", x, yy)
        page.wait_for_timeout(100)
        t0 = task()
        ev("mouseReleased", *pts[-1], 0)
        page.wait_for_timeout(1500)
        costs.append(1000 * (task() - t0))
    try:
        print("COUNT", page.evaluate("JSON.stringify(window.cnt || null)"))
    except Exception: pass
    print("after each Pencil lift: " + ", ".join(f"{c:.0f}" for c in costs) + " ms of work (avg %.0f ms)" % (sum(costs) / len(costs)), flush=True)
    if PROFILE:
        prof = cdp.send("Profiler.stop")["profile"]
        nodes = {n["id"]: n for n in prof["nodes"]}
        agg = collections.Counter()
        for s_, d in zip(prof["samples"], prof["timeDeltas"]):
            cf = nodes[s_]["callFrame"]; agg[(cf["functionName"] or "(anon)") + " :" + str(cf["lineNumber"])] += d
        tot = sum(agg.values())
        for k, v in agg.most_common(15): print(f"  {v/1000:7.1f} ms {100*v/tot:5.1f}%  {k}")
