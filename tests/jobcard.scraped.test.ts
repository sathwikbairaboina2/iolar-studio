import { afterEach, describe, expect, it } from 'vitest';
import { getScraped, listScraped, scraperBase, ScraperUnreachable } from '@/lib/jobcard/scraped';

const row = (sc: string, extra: Record<string, unknown> = {}) => ({
  shortcode: sc,
  username: 'hiring.daily.mock',
  ig_url: `https://instagram.com/p/${sc}/`,
  caption: 'Hiring: Software Engineer I\nCompany: Zoho',
  status: 'selected',
  error: null,
  added_at: '2026-11-23T08:00:00Z',
  prepared_at: null,
  payload: null,
  thumb_url: `/api/media/${sc}/thumb`,
  ...extra,
});

const http = (routes: Record<string, () => Response | Error>) =>
  (async (url: string) => {
    const u = new URL(url);
    const hit = routes[u.pathname + u.search];
    if (!hit) return new Response('{}', { status: 404 });
    const v = hit();
    if (v instanceof Error) throw v;
    return v;
  }) as unknown as typeof fetch;

const json = (v: unknown, status = 200) => new Response(JSON.stringify(v), { status, headers: { 'content-type': 'application/json' } });

afterEach(() => {
  delete process.env.INSTASCRAPER_URL;
});

describe('the scraper client', () => {
  it('defaults to the local scraper and strips a trailing slash', () => {
    expect(scraperBase()).toBe('http://localhost:3000/api');
    process.env.INSTASCRAPER_URL = 'http://127.0.0.1:28111/api/';
    expect(scraperBase()).toBe('http://127.0.0.1:28111/api');
  });

  it('lists the recreate queue with absolute thumbnail urls', async () => {
    process.env.INSTASCRAPER_URL = 'http://127.0.0.1:28111/api';
    const items = await listScraped({ http: http({ '/api/recreate': () => json({ items: [row('a-0'), row('a-1')] }) }) });
    expect(items).toHaveLength(2);
    expect(items[0]).toEqual({
      shortcode: 'a-0',
      username: 'hiring.daily.mock',
      igUrl: 'https://instagram.com/p/a-0/',
      caption: 'Hiring: Software Engineer I\nCompany: Zoho',
      status: 'selected',
      addedAt: '2026-11-23T08:00:00Z',
      thumbUrl: 'http://127.0.0.1:28111/api/media/a-0/thumb',
    });
  });

  it('reads one item, and answers null for a shortcode the scraper does not hold', async () => {
    const h = http({
      '/api/recreate/a-0': () => json(row('a-0')),
      '/api/recreate/ghost': () => json({ detail: { message: 'not marked for recreation' } }, 404),
    });
    expect((await getScraped('a-0', { http: h }))?.igUrl).toBe('https://instagram.com/p/a-0/');
    expect(await getScraped('ghost', { http: h })).toBeNull();
  });

  it('throws ScraperUnreachable on a network failure and on a server error', async () => {
    await expect(
      listScraped({ http: http({ '/api/recreate': () => new Error('connect ECONNREFUSED') }) })
    ).rejects.toBeInstanceOf(ScraperUnreachable);
    await expect(
      listScraped({ http: http({ '/api/recreate': () => new Response('boom', { status: 500 }) }) })
    ).rejects.toBeInstanceOf(ScraperUnreachable);
    await expect(
      getScraped('a-0', { http: http({ '/api/recreate/a-0': () => new Response('boom', { status: 503 }) }) })
    ).rejects.toBeInstanceOf(ScraperUnreachable);
  });
});
