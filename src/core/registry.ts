import { Emitter } from "./emitter";
import type { HandnoteSettings } from "./settings";
import type { HandnoteFeature } from "./types";

type AnyFeature = HandnoteFeature<any>;

/** Holds every known feature (built-in and added by other plugins). */
export class FeatureRegistry {
  private list: AnyFeature[] = [];
  readonly events = new Emitter<{ changed: [] }>();

  register(feature: AnyFeature) {
    if (!feature?.id) throw new Error("Handnote: a feature needs an id");
    this.list = [...this.list.filter((f) => f.id !== feature.id), feature];
    this.events.emit("changed");
  }

  unregister(id: string) {
    this.list = this.list.filter((f) => f.id !== id);
    this.events.emit("changed");
  }

  all(): AnyFeature[] {
    return this.list;
  }

  get(id: string): AnyFeature | undefined {
    return this.list.find((f) => f.id === id);
  }

  isEnabled(f: AnyFeature, s: HandnoteSettings): boolean {
    if (f.optional === false) return true;
    return (s.features[f.id]?.enabled as boolean | undefined) ?? f.defaultEnabled ?? true;
  }

  enabled(s: HandnoteSettings): AnyFeature[] {
    return this.list.filter((f) => this.isEnabled(f, s));
  }

  settingsOf<S>(f: AnyFeature, s: HandnoteSettings): S {
    const { enabled: _e, ...saved } = s.features[f.id] ?? {};
    return { ...f.defaults, ...saved } as S;
  }
}
