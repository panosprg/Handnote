import type { ComponentType } from "react";
import type { El, HandnoteContext } from "./context";

/**
 * ============================================================
 *  HOW TO ADD A FEATURE
 * ============================================================
 *  1. Create src/features/my-feature.ts(x) exporting a `HandnoteFeature`.
 *  2. Add it to the list in src/features/index.ts.
 *  That's it: its settings appear in the settings tab automatically,
 *  it can be switched off there, and nothing else needs to change.
 *
 *  Other Obsidian plugins can add features too, at runtime:
 *    app.plugins.plugins["panos-handnote"].api.registerFeature(myFeature)
 * ============================================================
 */

export type SettingDef =
  | { key: string; type: "toggle"; name: string; desc?: string }
  | { key: string; type: "slider"; name: string; desc?: string; min: number; max: number; step: number }
  | { key: string; type: "dropdown"; name: string; desc?: string; options: Record<string, string> }
  | { key: string; type: "text"; name: string; desc?: string };

export interface ToolDef {
  id: string;
  label: string;
  /** Obsidian (lucide) icon name, used by the classic toolbar and radial menu */
  icon: string;
  /** Called when the tool is chosen: set up Excalidraw for it. */
  activate(ctx: HandnoteContext): void;
  /** Ink tools use a colour/size and show the ink panel when tapped again. */
  ink?: boolean;
  /** Lower comes first in toolbars. */
  order: number;
  /** Shown when the tool is tapped while already active (e.g. colour & size). */
  Panel?: ComponentType<{ ctx: HandnoteContext }>;
}

/** A button a feature adds to the top bar. */
export interface ToolbarButton {
  id: string;
  label: string;
  icon: string;
  onClick(ctx: HandnoteContext): void;
  active?(ctx: HandnoteContext): boolean;
}

/** An action shown in the bar that appears over a selection. */
export interface SelectionAction {
  id: string;
  label: string;
  icon: string;
  /** Hide the action when it doesn't apply to this selection. */
  when?(ctx: HandnoteContext, els: El[]): boolean;
  run(ctx: HandnoteContext, els: El[]): void | Promise<void>;
}

export interface FeatureProps<S> {
  ctx: HandnoteContext;
  settings: S;
}

export interface HandnoteFeature<S extends Record<string, unknown> = Record<string, unknown>> {
  /** Stable id: also the key its settings are saved under. Never rename. */
  id: string;
  name: string;
  description: string;
  /** Can the user turn it off? (default true) */
  optional?: boolean;
  /** Is it on for new users? (default true) */
  defaultEnabled?: boolean;
  /** Default values for this feature's settings. */
  defaults: S;
  /** Settings shown in the settings tab under this feature. */
  settings?: SettingDef[];
  /** Tools this feature adds to the toolbars. */
  tools?: ToolDef[];
  /** Runs when a note opens (and when the feature is switched on). Return a cleanup function. */
  setup?(ctx: HandnoteContext, settings: () => S): (() => void) | void;
  /** React UI drawn over the page (toolbars, menus, effects). */
  Overlay?: ComponentType<FeatureProps<S>>;
  /** Extra section at the bottom of the pen/highlighter panel. */
  InkPanelSection?: ComponentType<FeatureProps<S>>;
  /** Buttons added to the top bar. */
  toolbarButtons?: ToolbarButton[];
  /** Actions offered when something is selected. */
  selectionActions?: SelectionAction[];
}

/** Helper that keeps the generic type when declaring a feature. */
export function defineFeature<S extends Record<string, unknown>>(f: HandnoteFeature<S>): HandnoteFeature<S> {
  return f;
}
