type Fn = (...args: any[]) => void;

/** Minimal typed event emitter. */
export class Emitter<Events extends Record<string, unknown[]>> {
  private handlers = new Map<keyof Events, Set<Fn>>();

  on<K extends keyof Events>(event: K, fn: (...args: Events[K]) => void): () => void {
    let set = this.handlers.get(event);
    if (!set) this.handlers.set(event, (set = new Set()));
    set.add(fn as Fn);
    return () => {
      set!.delete(fn as Fn);
    };
  }

  emit<K extends keyof Events>(event: K, ...args: Events[K]) {
    this.handlers.get(event)?.forEach((fn) => {
      try {
        fn(...args);
      } catch (e) {
        console.error(`Handnote: "${String(event)}" handler failed`, e);
      }
    });
  }
}
