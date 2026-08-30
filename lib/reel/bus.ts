import type { Reel } from './schema';

/**
 * One topic per reel, so an edit made anywhere — the studio, an agent — reaches
 * every open tab on that reel.
 *
 * Deliberately in-process: the studio runs as a single local Next process, and
 * a module-level Map is the whole implementation. It does NOT survive multiple
 * workers; a file-watch or Redis bus is the upgrade path if that ever changes.
 */

export type Listener = (reel: Reel) => void;

const topics = new Map<string, Set<Listener>>();

export function subscribe(slug: string, listener: Listener): () => void {
  let set = topics.get(slug);
  if (!set) {
    set = new Set();
    topics.set(slug, set);
  }
  set.add(listener);

  return () => {
    const current = topics.get(slug);
    if (!current) return;
    current.delete(listener);
    // A closed tab must not keep its slug alive, or topics grows without bound.
    if (current.size === 0) topics.delete(slug);
  };
}

export function publish(slug: string, reel: Reel): void {
  const set = topics.get(slug);
  if (!set) return;
  for (const listener of [...set]) {
    try {
      listener(reel);
    } catch {
      // A dead EventSource controller must not stop the other tabs from updating.
    }
  }
}

export function subscriberCount(slug: string): number {
  return topics.get(slug)?.size ?? 0;
}

/** Test seam: the topic map is module state, so suites must be able to clear it. */
export function resetBus(): void {
  topics.clear();
}
