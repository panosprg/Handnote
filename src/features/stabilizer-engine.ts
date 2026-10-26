/**
 * Live stroke stabilization.
 *
 * Excalidraw reads raw pointer positions, so we intercept the pen's
 * pointermove / pointerup events on `window` in the capture phase (which runs
 * before Excalidraw's own listeners), smooth the coordinates with a 1€ filter,
 * and re-dispatch an identical synthetic event carrying the smoothed position.
 *
 * The 1€ filter smooths hard when the pen moves slowly (where hand tremor
 * shows) and lightly when it moves fast (so quick strokes don't lag).
 */

class LowPass {
  private y: number | null = null;
  filter(x: number, alpha: number): number {
    this.y = this.y === null ? x : alpha * x + (1 - alpha) * this.y;
    return this.y;
  }
  last(): number | null {
    return this.y;
  }
}

class OneEuro {
  private x = new LowPass();
  private dx = new LowPass();
  private lastT: number | null = null;
  constructor(private minCutoff: number, private beta: number, private dCutoff = 1) {}

  private alpha(cutoff: number, dt: number) {
    const tau = 1 / (2 * Math.PI * cutoff);
    return 1 / (1 + tau / dt);
  }

  filter(value: number, tSeconds: number): number {
    const dt = this.lastT === null ? 1 / 120 : Math.max(1e-3, tSeconds - this.lastT);
    this.lastT = tSeconds;
    const prev = this.x.last();
    const rawSpeed = prev === null ? 0 : (value - prev) / dt;
    const speed = this.dx.filter(rawSpeed, this.alpha(this.dCutoff, dt));
    const cutoff = this.minCutoff + this.beta * Math.abs(speed);
    return this.x.filter(value, this.alpha(cutoff, dt));
  }
}

interface ActiveStroke {
  pointerId: number;
  fx: OneEuro;
  fy: OneEuro;
  sx: number;
  sy: number;
}

export interface StabilizerHooks {
  /** Return 0–100 if a stroke starting now should be stabilized, or 0 for none. */
  levelForStroke(e: PointerEvent): number;
}

const lerp = (a: number, b: number, t: number) => a + (b - a) * t;

export class Stabilizer {
  private stroke: ActiveStroke | null = null;

  constructor(private root: HTMLElement, private hooks: StabilizerHooks) {
    root.addEventListener("pointerdown", this.onDown, true);
    window.addEventListener("pointermove", this.onMove, true);
    window.addEventListener("pointerup", this.onUp, true);
    window.addEventListener("pointercancel", this.onCancel, true);
  }

  destroy() {
    this.root.removeEventListener("pointerdown", this.onDown, true);
    window.removeEventListener("pointermove", this.onMove, true);
    window.removeEventListener("pointerup", this.onUp, true);
    window.removeEventListener("pointercancel", this.onCancel, true);
    this.stroke = null;
  }

  private onDown = (e: PointerEvent) => {
    if (!e.isTrusted || e.pointerType === "touch") return;
    const level = this.hooks.levelForStroke(e);
    if (level <= 0) {
      this.stroke = null;
      return;
    }
    const s = Math.min(1, level / 100);
    // s=0 → barely filtered, s=1 → very smooth
    const minCutoff = lerp(6, 0.35, s);
    const beta = lerp(0.04, 0.004, s);
    const t = e.timeStamp / 1000;
    const fx = new OneEuro(minCutoff, beta);
    const fy = new OneEuro(minCutoff, beta);
    this.stroke = {
      pointerId: e.pointerId,
      fx,
      fy,
      sx: fx.filter(e.clientX, t),
      sy: fy.filter(e.clientY, t),
    };
  };

  private onMove = (e: PointerEvent) => {
    const st = this.stroke;
    if (!st || !e.isTrusted || e.pointerId !== st.pointerId) return;
    const t = e.timeStamp / 1000;
    st.sx = st.fx.filter(e.clientX, t);
    st.sy = st.fy.filter(e.clientY, t);
    e.stopImmediatePropagation();
    this.redispatch(e, "pointermove", st.sx, st.sy);
  };

  private onUp = (e: PointerEvent) => {
    const st = this.stroke;
    if (!st || !e.isTrusted || e.pointerId !== st.pointerId) return;
    this.stroke = null;
    // End halfway between the smoothed point and the real pen position:
    // avoids both a visible "hook" and a shortened stroke.
    const ex = (st.sx + e.clientX) / 2;
    const ey = (st.sy + e.clientY) / 2;
    e.stopImmediatePropagation();
    this.redispatch(e, "pointerup", ex, ey);
  };

  private onCancel = (e: PointerEvent) => {
    if (this.stroke && e.pointerId === this.stroke.pointerId) this.stroke = null;
  };

  private redispatch(e: PointerEvent, type: string, x: number, y: number) {
    const dx = x - e.clientX;
    const dy = y - e.clientY;
    const synthetic = new PointerEvent(type, {
      bubbles: true,
      cancelable: true,
      composed: true,
      clientX: x,
      clientY: y,
      screenX: e.screenX + dx,
      screenY: e.screenY + dy,
      pointerId: e.pointerId,
      pointerType: e.pointerType,
      isPrimary: e.isPrimary,
      pressure: e.pressure,
      tiltX: e.tiltX,
      tiltY: e.tiltY,
      twist: e.twist,
      width: e.width,
      height: e.height,
      button: e.button,
      buttons: e.buttons,
      ctrlKey: e.ctrlKey,
      shiftKey: e.shiftKey,
      altKey: e.altKey,
      metaKey: e.metaKey,
    });
    (e.target ?? window).dispatchEvent(synthetic);
  }
}
