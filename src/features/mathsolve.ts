/**
 * Turns recognised LaTeX into something mathjs understands, then evaluates,
 * simplifies or solves it. Pure functions: easy to test.
 */
import { all, create } from "mathjs";

const math = create(all, { number: "number" });

/** Index of the brace that closes the one at `open`. */
function closing(s: string, open: number): number {
  let depth = 0;
  for (let i = open; i < s.length; i++) {
    if (s[i] === "{") depth++;
    else if (s[i] === "}" && --depth === 0) return i;
  }
  return -1;
}

/** Reads `{…}` at position i; returns its inside and the index after it. */
function group(s: string, i: number): [string, number] {
  while (s[i] === " ") i++;
  if (s[i] !== "{") return [s[i] ?? "", i + 1];
  const end = closing(s, i);
  return [s.slice(i + 1, end), end + 1];
}

export function latexToMath(latex: string): string {
  let s = latex
    .replace(/\\left|\\right/g, "")
    .replace(/\\[,;:! ]/g, " ")
    .replace(/\\cdot|\\times/g, "*")
    .replace(/\\div/g, "/")
    .replace(/\\pi/g, "pi")
    .replace(/\\ln/g, "log")
    .replace(/\\log/g, "log10")
    .replace(/\\(sin|cos|tan|arcsin|arccos|arctan|sinh|cosh|tanh|exp)/g, "$1")
    .replace(/\\operatorname\{(\w+)\}/g, "$1")
    .replace(/\\mathrm\{(\w+)\}/g, "$1")
    .replace(/[\[\]]/g, (b) => (b === "[" ? "(" : ")"))
    .replace(/\\\{|\\\}/g, "")
    .trim();

  // \frac{a}{b} and \sqrt[n]{x} / \sqrt{x}, innermost first
  for (let guard = 0; guard < 50; guard++) {
    const f = s.lastIndexOf("\\frac");
    const r = s.lastIndexOf("\\sqrt");
    const at = Math.max(f, r);
    if (at < 0) break;
    if (at === f) {
      const [a, i1] = group(s, at + 5);
      const [b, i2] = group(s, i1);
      s = `${s.slice(0, at)}((${a})/(${b}))${s.slice(i2)}`;
    } else {
      let i = at + 5;
      let n = "";
      if (s[i] === "(") {
        const end = s.indexOf(")", i);
        n = s.slice(i + 1, end);
        i = end + 1;
      }
      const [x, i2] = group(s, i);
      s = `${s.slice(0, at)}${n ? `nthRoot(${x}, ${n})` : `sqrt(${x})`}${s.slice(i2)}`;
    }
  }
  return s.replace(/\^\{/g, "^(").replace(/[{]/g, "(").replace(/[}]/g, ")").replace(/\\/g, "");
}

const fmt = (x: number) => {
  if (!isFinite(x)) return String(x);
  const r = Math.round(x * 1e9) / 1e9;
  return math.format(r, { precision: 10 });
};

function variables(expr: string): string[] {
  const node = math.parse(expr);
  const names = new Set<string>();
  node.traverse((n: any, _p: any, parent: any) => {
    if (n.isSymbolNode && !(parent?.isFunctionNode && parent.fn === n) && !(n.name in math)) names.add(n.name);
  });
  return [...names];
}

/** Real roots of f on a range, by sign changes + bisection. */
function numericRoots(f: (x: number) => number, lo = -100, hi = 100, step = 0.01): number[] {
  const roots: number[] = [];
  let x0 = lo;
  let y0 = f(x0);
  for (let x1 = lo + step; x1 <= hi; x1 += step) {
    const y1 = f(x1);
    if (Math.abs(y1) < 1e-12) roots.push(x1);
    else if (isFinite(y0) && isFinite(y1) && y0 * y1 < 0) {
      let [a, b, fa] = [x0, x1, y0];
      for (let k = 0; k < 60; k++) {
        const m = (a + b) / 2;
        const fm = f(m);
        if (fa * fm <= 0) b = m;
        else [a, fa] = [m, fm];
      }
      roots.push((a + b) / 2);
    }
    [x0, y0] = [x1, y1];
  }
  return roots.filter((r, i) => i === 0 || Math.abs(r - roots[i - 1]) > 1e-6).slice(0, 6);
}

/**
 * Works out a recognised expression:
 *  - "2+3\cdot4"      → "= 14"
 *  - "x^2-5x+6=0"     → "x = 2, x = 3"
 *  - "2x+3x"          → "= 5 * x"
 */
export function solveLatex(latex: string): string {
  const src = latexToMath(latex);
  if (src.includes("=")) {
    const [lhs, rhs] = src.split("=");
    const expr = `(${lhs || 0})-(${rhs || 0})`;
    const vars = variables(expr);
    if (vars.length !== 1) {
      const v = math.evaluate(expr);
      return typeof v === "number" ? (Math.abs(v) < 1e-9 ? "✓ true" : "✗ not equal") : String(v);
    }
    const name = vars[0];
    const compiled = math.compile(expr);
    const f = (x: number) => Number(compiled.evaluate({ [name]: x }));
    const roots = numericRoots(f);
    if (!roots.length) return `no real ${name} found`;
    return roots.map((r) => `${name} = ${fmt(r)}`).join(", ");
  }
  const vars = variables(src);
  if (vars.length) return `= ${math.simplify(src).toString()}`;
  return `= ${fmt(Number(math.evaluate(src)))}`;
}
