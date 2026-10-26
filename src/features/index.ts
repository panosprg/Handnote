/**
 * Built-in features. To add one, write it in this folder and add it here.
 * Order matters only for event listeners that compete for the same input
 * (e.g. the precision eraser must see the Pencil before the stabilizer).
 */
import type { HandnoteFeature } from "../core/types";

import eraseEffect from "./erase-effect";
import gestures from "./gestures";
import highlighterBehind from "./highlighter-behind";
import paletteArc from "./palette-arc";
import precisionEraser from "./precision-eraser";
import radialMenu from "./radial-menu";
import scribbleDelete from "./scribble-delete";
import stabilizer from "./stabilizer";
import toolbarClassic from "./toolbar-classic";

export const BUILT_IN_FEATURES: HandnoteFeature<any>[] = [
  paletteArc,
  toolbarClassic,
  precisionEraser,
  stabilizer,
  highlighterBehind,
  scribbleDelete,
  eraseEffect,
  gestures,
  radialMenu,
];
