/**
 * The scraper's recreate queue, read from the other side. instascraper holds the posts a
 * person marked for recreation; this is the only part of Studio that talks to it, so the
 * card pane and the routes share one shape and one failure.
 */

export type ScrapedItem = {
  shortcode: string;
  username: string;
  igUrl: string;
  caption: string;
  status: string;
  addedAt: string;
  /** Absolute: the browser sits on Studio's origin, the thumbnail on the scraper's. */
  thumbUrl: string;
};

/** The scraper did not answer, or answered with an error that is not "no such post". */
export class ScraperUnreachable extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ScraperUnreachable';
  }
}

type Deps = { http?: typeof fetch };

/** Same default as the launch watch. */
export const scraperBase = () => (process.env.INSTASCRAPER_URL ?? 'http://localhost:3000/api').replace(/\/+$/, '');

type Raw = {
  shortcode: string;
  username: string;
  ig_url: string;
  caption: string | null;
  status: string;
  added_at: string;
  thumb_url: string;
};

const toItem = (r: Raw, base: string): ScrapedItem => ({
  shortcode: r.shortcode,
  username: r.username,
  igUrl: r.ig_url,
  caption: r.caption ?? '',
  status: r.status,
  addedAt: r.added_at,
  thumbUrl: new URL(r.thumb_url, base).toString(),
});

async function call(path: string, deps: Deps): Promise<Response> {
  // Resolved per call so a test (or a hot reload) that swaps global fetch is honoured.
  const http = deps.http ?? ((...a: Parameters<typeof fetch>) => fetch(...a));
  try {
    return await http(`${scraperBase()}${path}`, { cache: 'no-store', signal: AbortSignal.timeout(10_000) });
  } catch (err) {
    throw new ScraperUnreachable(`the scraper did not answer (${err instanceof Error ? err.message : String(err)})`);
  }
}

export async function listScraped(deps: Deps = {}): Promise<ScrapedItem[]> {
  const res = await call('/recreate', deps);
  if (!res.ok) throw new ScraperUnreachable(`the scraper answered ${res.status}`);
  const body = (await res.json().catch(() => null)) as { items?: Raw[] } | null;
  return (body?.items ?? []).map((r) => toItem(r, scraperBase()));
}

/** One queued post, or null when the scraper has no such shortcode in its queue. */
export async function getScraped(shortcode: string, deps: Deps = {}): Promise<ScrapedItem | null> {
  const res = await call(`/recreate/${encodeURIComponent(shortcode)}`, deps);
  if (res.status === 404) return null;
  if (!res.ok) throw new ScraperUnreachable(`the scraper answered ${res.status}`);
  const body = (await res.json().catch(() => null)) as Raw | null;
  if (!body) throw new ScraperUnreachable('the scraper sent no post');
  return toItem(body, scraperBase());
}
