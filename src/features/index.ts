/**
 * Built-in features. To add one, write it in this folder and add it here.
 * Order matters only for listeners that compete for the same Pencil input.
 */
import type { HandnoteFeature } from "../core/types";

import cleanSelection from "./clean-selection";
import cursor from "./cursor";
import eraseEffect from "./erase-effect";
import erasers from "./erasers";
import gestures from "./gestures";
import headings from "./headings";
import links from "./links";
import maths from "./maths";
import recognition from "./recognition";
import ruler from "./ruler";
import highlighterBehind from "./highlighter-behind";
import lasso from "./lasso";
import radialMenu from "./radial-menu";
import scribbleDelete from "./scribble-delete";
import shapeSnap from "./shape-snap";
import stabilizer from "./stabilizer";
import toolbar from "./toolbar-classic";

export const BUILT_IN_FEATURES: HandnoteFeature<any>[] = [
  toolbar,
  erasers,
  lasso,
  stabilizer,
  shapeSnap,
  highlighterBehind,
  scribbleDelete,
  eraseEffect,
  cleanSelection,
  cursor,
  headings,
  links,
  maths,
  recognition,
  ruler, // before gestures: it claims the fingers that land on it
  gestures,
  radialMenu,
];
