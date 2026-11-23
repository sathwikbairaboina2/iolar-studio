import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mkdtempSync, readFileSync } from 'fs';
import { tmpdir } from 'os';
import path from 'path';

const req = (method: string, body?: unknown) =>
  new Request('http://t/api/jobcards', {
    method,
    headers: { 'content-type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });

const captions = JSON.parse(
  readFileSync(path.join(process.cwd(), 'tests/fixtures/scraped-captions.json'), 'utf8')
) as string[];

const raw = (i: number) => ({
  shortcode: `hiring.daily.mock-${i}`,
  username: 'hiring.daily.mock',
  ig_url: `https://instagram.com/p/hiring.daily.mock-${i}/`,
  caption: captions[i],
  status: 'selected',
  added_at: '2026-11-23T08:00:00Z',
  thumb_url: `/api/media/hiring.daily.mock-${i}/thumb`,
});

const json = (v: unknown, status = 200) => new Response(JSON.stringify(v), { status, headers: { 'content-type': 'application/json' } });

/** A scraper that holds the three posts, or none at all when `down`. */
function scraper(down = false) {
  const calls: string[] = [];
  vi.stubGlobal('fetch', async (url: string) => {
    const u = new URL(String(url));
    calls.push(u.pathname);
    if (u.host !== 'scraper.test') throw new Error(`unexpected network call to ${url}`);
    if (down) throw new Error('connect ECONNREFUSED');
    if (u.pathname === '/api/recreate') return json({ items: [0, 1, 2].map(raw) });
    const m = u.pathname.match(/^\/api\/recreate\/(.+)$/);
    const hit = m && [0, 1, 2].map(raw).find((r) => r.shortcode === m[1]);
    return hit ? json(hit) : json({ detail: { message: 'not marked for recreation' } }, 404);
  });
  return calls;
}

beforeEach(async () => {
  process.env.IOLAR_DATA_DIR = mkdtempSync(path.join(tmpdir(), 'is-scraped-'));
  process.env.INSTASCRAPER_URL = 'http://scraper.test/api';
  (await import('@/lib/db')).closeDb();
});
afterEach(async () => {
  vi.unstubAllGlobals();
  delete process.env.INSTASCRAPER_URL;
  (await import('@/lib/db')).closeDb();
});

describe('scraped posts through the job cards api', () => {
  it('lists the scraper queue with absolute thumbnails and no card yet', async () => {
    scraper();
    const r = await import('@/app/api/jobcards/scraped/route');
    const body = await (await r.GET()).json();
    expect(body.items).toHaveLength(3);
    expect(body.items[0]).toMatchObject({
      shortcode: 'hiring.daily.mock-0',
      username: 'hiring.daily.mock',
      igUrl: 'https://instagram.com/p/hiring.daily.mock-0/',
      status: 'selected',
      thumbUrl: 'http://scraper.test/api/media/hiring.daily.mock-0/thumb',
      cardId: null,
    });
  });

  it('answers 502 when the scraper is unreachable', async () => {
    scraper(true);
    const r = await import('@/app/api/jobcards/scraped/route');
    const reply = await r.GET();
    expect(reply.status).toBe(502);
    expect((await reply.json()).error).toMatch(/scraper/);
  });

  it('makes a card from a scraped post, then lists it with its cardId', async () => {
    scraper();
    const list = await import('@/app/api/jobcards/route');
    const scraped = await import('@/app/api/jobcards/scraped/route');

    const reply = await list.POST(req('POST', { scraped: 'hiring.daily.mock-0', useModel: false }));
    expect(reply.status).toBe(201);
    const made = await reply.json();
    expect(made.draft.company.name).toBe('Zoho');
    expect(made.draft.source).toEqual({ url: 'https://instagram.com/p/hiring.daily.mock-0/', kind: 'reference', poolId: null });
    expect(made.missing).toEqual([]);

    const items = (await (await scraped.GET()).json()).items as { shortcode: string; cardId: string | null }[];
    expect(items.find((i) => i.shortcode === 'hiring.daily.mock-0')?.cardId).toBe(made.id);
    expect(items.find((i) => i.shortcode === 'hiring.daily.mock-1')?.cardId).toBeNull();
  });

  it('names the gap when the post has no salary', async () => {
    scraper();
    const list = await import('@/app/api/jobcards/route');
    const made = await (await list.POST(req('POST', { scraped: 'hiring.daily.mock-1', useModel: false }))).json();
    expect(made.draft.location).toMatchObject({ city: 'Remote', workMode: 'remote' });
    expect(made.missing).toEqual(['salary range']);
  });

  it('answers 404 for a shortcode the scraper does not hold, and 502 when it is down', async () => {
    const list = await import('@/app/api/jobcards/route');
    scraper();
    expect((await list.POST(req('POST', { scraped: 'ghost', useModel: false }))).status).toBe(404);
    vi.unstubAllGlobals();
    scraper(true);
    expect((await list.POST(req('POST', { scraped: 'hiring.daily.mock-0', useModel: false }))).status).toBe(502);
  });
});
