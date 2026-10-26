import { convertToExcalidrawElements, getCommonBounds } from "@excalidraw/excalidraw";
import { Notice } from "obsidian";
import type { El } from "../core/context";
import { defineFeature } from "../core/types";
import { solveLatex } from "./mathsolve";
import { recognitionReady, recognize } from "./recognition";

/**
 * Lasso a handwritten sum or equation and tap Solve: MyScript reads it as
 * maths, Handnote works it out and writes the answer next to it.
 */
export default defineFeature({
  id: "maths",
  name: "Maths solving",
  description: "Lasso handwritten maths and tap Solve: the answer is written next to it. Needs handwriting recognition set up.",
  defaults: {},
  selectionActions: [
    {
      id: "solve",
      label: "Solve",
      icon: "sigma",
      when: (ctx, els) => recognitionReady(ctx) && els.some((e) => e.type === "freedraw"),
      run: async (ctx, els) => {
        const ink = els.filter((e) => e.type === "freedraw");
        let latex = "";
        try {
          latex = await recognize(ctx, ink, "Math");
          const answer = solveLatex(latex);
          const [, y1, x2, y2] = getCommonBounds(ink as never);
          const height = y2 - y1;
          const fontSize = Math.max(16, Math.min(48, height * 0.6));
          const [text] = convertToExcalidrawElements([
            {
              type: "text",
              x: x2 + 14,
              y: y1 + height / 2 - fontSize * 0.65,
              text: answer,
              fontSize,
              fontFamily: 2,
              strokeColor: ctx.core[ctx.state.lastInk].color,
              customData: { hn: "maths-answer", latex },
            } as never,
          ]);
          ctx.replaceElements([...ctx.elements(true), text as unknown as El], "now");
        } catch (e) {
          new Notice(`Handnote: couldn't solve ${latex ? `"${latex}"` : "that"} (${(e as Error).message})`);
        }
      },
    },
  ],
});
