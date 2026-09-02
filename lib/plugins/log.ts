/**
 * What the plugins have been doing, in order.
 *
 * Starting a service, unloading a model so ComfyUI can have the card, a renderer going
 * down: all of it happens on the server where nobody is watching. This is the line each of
 * those writes, so a page can show it as it happens. A ring, not a file — it is a live feed,
 * and the reel's own history already keeps what matters.
 */

export type LogLevel = 'info' | 'success' | 'warning' | 'error';

export type LogEntry = {
  id: number;
  at: string;
  plugin: string;
  text: string;
  level: LogLevel;
};

export const LOG_LIMIT = 200;

// Survives Next's dev-mode module reloads, so a line written by a render is still there
// when the page asks for it a second later.
const g = globalThis as unknown as { __pluginLog?: { entries: LogEntry[]; next: number } };
const state = (g.__pluginLog ??= { entries: [], next: 1 });

export function logPlugin(plugin: string, text: string, level: LogLevel = 'info'): LogEntry {
  const entry: LogEntry = { id: state.next++, at: new Date().toISOString(), plugin, text, level };
  state.entries.push(entry);
  if (state.entries.length > LOG_LIMIT) state.entries.splice(0, state.entries.length - LOG_LIMIT);
  return entry;
}

/** Everything after `since` — a reader keeps the last id it saw and asks for the rest. */
export function readLog(since = 0): { entries: LogEntry[]; last: number } {
  const entries = state.entries.filter((e) => e.id > since);
  return { entries, last: state.entries.at(-1)?.id ?? 0 };
}
