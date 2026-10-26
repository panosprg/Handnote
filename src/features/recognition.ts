import type { El, HandnoteContext } from "../core/context";
import { defineFeature } from "../core/types";

export type RecognitionSettings = { appKey: string; hmacKey: string; lang: string };
export const RECOGNITION = "handwriting-recognition";

export function recognitionReady(ctx: HandnoteContext): boolean {
  if (!ctx.isEnabled(RECOGNITION)) return false;
  const s = ctx.featureSettings<RecognitionSettings>(RECOGNITION);
  return !!(s.appKey && s.hmacKey);
}

async function hmacSha512Hex(key: string, message: string): Promise<string> {
  const enc = new TextEncoder();
  const k = await crypto.subtle.importKey("raw", enc.encode(key), { name: "HMAC", hash: "SHA-512" }, false, ["sign"]);
  const sig = await crypto.subtle.sign("HMAC", k, enc.encode(message));
  return [...new Uint8Array(sig)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

/** MyScript's request body: the strokes, in order, relative to their top-left corner. */
export function strokesPayload(els: El[], kind: "Text" | "Math", lang: string) {
  const ink = els.filter((e) => e.type === "freedraw" && e.points && e.points.length);
  const all = ink.flatMap((e) => e.points!.map(([x, y]) => [e.x + x, e.y + y]));
  const minX = Math.min(...all.map((p) => p[0]));
  const minY = Math.min(...all.map((p) => p[1]));
  const maxX = Math.max(...all.map((p) => p[0]));
  const maxY = Math.max(...all.map((p) => p[1]));
  let t = Date.now();
  const strokes = ink.map((e) => {
    const pts = e.points!;
    const p = e.pressures && e.pressures.length === pts.length ? [...e.pressures] : pts.map(() => 0.5);
    return {
      pointerType: "PEN",
      x: pts.map(([x]) => Math.round((e.x + x - minX) * 10) / 10),
      y: pts.map(([, y]) => Math.round((e.y + y - minY) * 10) / 10),
      t: pts.map(() => (t += 8)),
      p,
    };
  });
  return {
    configuration: { lang },
    xDPI: 96,
    yDPI: 96,
    contentType: kind,
    width: Math.ceil(maxX - minX) + 10,
    height: Math.ceil(maxY - minY) + 10,
    strokeGroups: [{ strokes }],
  };
}

/**
 * Sends handwriting to MyScript (the engine Goodnotes and Nebo use).
 * Text comes back as plain text, maths as LaTeX.
 */
export async function recognize(ctx: HandnoteContext, els: El[], kind: "Text" | "Math"): Promise<string> {
  const s = ctx.featureSettings<RecognitionSettings>(RECOGNITION);
  if (!s.appKey || !s.hmacKey) throw new Error("add your MyScript keys in Handnote's settings first");
  const body = JSON.stringify(strokesPayload(els, kind, s.lang || "en_US"));
  const res = await ctx.host.request("https://cloud.myscript.com/api/v4.0/iink/batch", {
    method: "POST",
    headers: {
      Accept: kind === "Math" ? "application/x-latex" : "text/plain",
      "Content-Type": "application/json",
      applicationKey: s.appKey,
      hmac: await hmacSha512Hex(s.appKey + s.hmacKey, body),
    },
    body,
  });
  if (res.status !== 200) throw new Error(`MyScript answered ${res.status}: ${res.text.slice(0, 120)}`);
  return res.text.trim();
}

export default defineFeature<RecognitionSettings>({
  id: RECOGNITION,
  name: "Handwriting recognition (MyScript)",
  description:
    "Optional. Turns handwritten headings into text and reads handwritten maths. Needs internet and a free MyScript developer account (developer.myscript.com): paste its Application key and HMAC key here.",
  defaultEnabled: true,
  defaults: { appKey: "", hmacKey: "", lang: "en_US" },
  settings: [
    { key: "appKey", type: "text", name: "Application key" },
    { key: "hmacKey", type: "text", name: "HMAC key" },
    { key: "lang", type: "dropdown", name: "Language", options: { en_US: "English", el_GR: "Ελληνικά (Greek)" } },
  ],
});
