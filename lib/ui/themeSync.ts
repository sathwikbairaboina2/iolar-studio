export type Mode = 'light' | 'dark';

/** Where the control-room panel can be served from. Anything else cannot
 *  change this app's theme. */
const PANEL_ORIGINS = [
  'http://localhost:28100',
  'http://127.0.0.1:28100',
  'http://localhost:28101',
  'http://127.0.0.1:28101',
  'https://beast.tail88cf35.ts.net:8444',
];

const isMode = (value: unknown): value is Mode => value === 'light' || value === 'dark';

/** The built-in panel origins plus any extra ones from a comma separated
 *  value (NEXT_PUBLIC_PANEL_ORIGINS). Entries that are not urls are dropped. */
export function panelOrigins(extra: string | undefined): string[] {
  const origins = [...PANEL_ORIGINS];
  for (const entry of (extra ?? '').split(',')) {
    try {
      const origin = new URL(entry.trim()).origin;
      if (origin !== 'null' && !origins.includes(origin)) origins.push(origin);
    } catch { /* not a url: skip it */ }
  }
  return origins;
}

/** `?theme=light|dark` on the page url, or null. */
export function modeFromSearch(search: string): Mode | null {
  const value = new URLSearchParams(search).get('theme');
  return isMode(value) ? value : null;
}

/** The mode in a panel `insta-theme` message, or null for any other sender or payload. */
export function modeFromMessage(event: { origin: string; data: unknown }, allowed: string[]): Mode | null {
  if (!allowed.includes(event.origin)) return null;
  const data = event.data;
  if (typeof data !== 'object' || data === null) return null;
  const { type, mode } = data as { type?: unknown; mode?: unknown };
  return type === 'insta-theme' && isMode(mode) ? mode : null;
}
