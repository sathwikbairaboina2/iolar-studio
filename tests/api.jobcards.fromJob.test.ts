import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mkdirSync, mkdtempSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import path from 'path';
import { panelJob, sparseJob } from './helpers/panelJob';

// The browser is the slow part and has its own suites; here a render is a PNG on disk.
const renders: string[] = [];
let failFor: string | null = null;
vi.mock('@/lib/jobcard/render', () => ({
  closeBrowser: async () => {},
  renderCard: async (card: { company: { name: string } }, family: string, outPath: string) => {
    if (card.company.name === failFor) throw new Error('chromium crashed');
    renders.push(card.company.name);
    mkdirSync(path.dirname(outPath), { recursive: true });
    writeFileSync(outPath, Buffer.from([0x89, 0x50, 0x4e, 0x47, 1, 2, 3]));
    return { family, file: outPath, width: 1080, height: 1440, overflowPx: 0, slackPx: 0, fellBack: false };
  },
}));

const post = (url: string, body?: unknown) =>
  new Request(url, { method: 'POST', headers: { 'content-type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) });

const json = (v: unknown, status = 200) => new Response(JSON.stringify(v), { status, headers: { 'content-type': 'application/json' } });

beforeEach(async () => {
  process.env.IOLAR_DATA_DIR = mkdtempSync(path.join(tmpdir(), 'is-fromjob-api-'));
  delete process.env.STUDIO_PUBLIC_URL;
  renders.length = 0;
  failFor = null;
  (await import('@/lib/db')).closeDb();
});
afterEach(async () => {
  vi.unstubAllGlobals();
  delete process.env.INTABOT_URL;
  delete process.env.INTABOT_HANDOFF_KEY;
  (await import('@/lib/db')).closeDb();
});

describe('POST /api/jobcards/from-job', () => {
  it('makes and renders a card, answers with ids and an image url Studio serves', async () => {
    const route = await import('@/app/api/jobcards/from-job/route');
    const image = await import('@/app/api/jobcards/[id]/image/route');
    const reply = await route.POST(post('http://studio.test:3120/api/jobcards/from-job', { job: panelJob() }));
    expect(reply.status).toBe(200);
    const body = await reply.json();
    expect(body).toMatchObject({ family: expect.stringMatching(/campaign|infographic/), fellBack: false, missing: [] });
    expect(body.imageUrl).toBe(`http://studio.test:3120/api/jobcards/${body.cardId}/image`);

    const png = await image.GET(new Request(body.imageUrl), { params: Promise.resolve({ id: body.cardId }) });
    expect(png.status).toBe(200);
    expect(png.headers.get('content-type')).toBe('image/png');
  });

  it('is idempotent: the same job answers with the same card and renders once', async () => {
    const route = await import('@/app/api/jobcards/from-job/route');
    const a = await (await route.POST(post('http://s/x', { job: panelJob() }))).json();
    const b = await (await route.POST(post('http://s/x', { job: panelJob() }))).json();
    expect(b.cardId).toBe(a.cardId);
    expect(renders).toHaveLength(1);
    const c = await route.POST(post('http://s/x', { job: panelJob({ company: 'Zoho Labs' }) }));
    expect((await c.json()).cardId).toBe(a.cardId);
    expect(renders).toHaveLength(2);
  });

  it('answers 422 with the missing fields for a job with gaps, and does not render', async () => {
    const route = await import('@/app/api/jobcards/from-job/route');
    const reply = await route.POST(post('http://s/x', { job: sparseJob() }));
    expect(reply.status).toBe(422);
    const body = await reply.json();
    expect(body.missing).toEqual(['skill', 'eligibility']);
    expect(body.cardId).toBeTruthy();
    expect(renders).toHaveLength(0);
  });

  it('stores the draft and answers 200 when asked not to render', async () => {
    const route = await import('@/app/api/jobcards/from-job/route');
    const reply = await route.POST(post('http://s/x', { job: sparseJob(), render: false }));
    expect(reply.status).toBe(200);
    expect(await reply.json()).toMatchObject({ imageUrl: null, missing: ['skill', 'eligibility'] });
  });

  it('honours the family asked for, and a public url override', async () => {
    process.env.STUDIO_PUBLIC_URL = 'http://studio.tail:3120/';
    const route = await import('@/app/api/jobcards/from-job/route');
    const body = await (await route.POST(post('http://127.0.0.1:3120/x', { job: panelJob(), family: 'campaign' }))).json();
    expect(body.family).toBe('campaign');
    expect(body.imageUrl).toBe(`http://studio.tail:3120/api/jobcards/${body.cardId}/image`);
  });

  it('answers 400 for a body that is not a job or a family that does not exist', async () => {
    const route = await import('@/app/api/jobcards/from-job/route');
    expect((await route.POST(post('http://s/x', { job: { company: 'x' } }))).status).toBe(400);
    expect((await route.POST(post('http://s/x', {}))).status).toBe(400);
    expect((await route.POST(post('http://s/x', { job: panelJob(), family: 'ticket' }))).status).toBe(400);
  });
});

describe('POST /api/jobcards/batch', () => {
  it('renders 2-10 jobs in order and reports each', async () => {
    const route = await import('@/app/api/jobcards/batch/route');
    const jobs = [panelJob({ id: 'a', company: 'Alpha' }), panelJob({ id: 'b', company: 'Beta' }), panelJob({ id: 'c', company: 'Gamma' })];
    const reply = await route.POST(post('http://studio.test:3120/api/jobcards/batch', { jobs, render: true }));
    expect(reply.status).toBe(200);
    const { cards } = await reply.json();
    expect(cards.map((c: { panelJobId: string }) => c.panelJobId)).toEqual(['a', 'b', 'c']);
    expect(renders).toEqual(['Alpha', 'Beta', 'Gamma']);
    for (const c of cards) {
      expect(c).toMatchObject({ missing: [], family: expect.any(String) });
      expect(c.imageUrl).toBe(`http://studio.test:3120/api/jobcards/${c.cardId}/image`);
    }
  });

  it('is never a 500 for one bad job: a failure and a gap are reported on their entries', async () => {
    failFor = 'Beta';
    const route = await import('@/app/api/jobcards/batch/route');
    const jobs = [panelJob({ id: 'a', company: 'Alpha' }), panelJob({ id: 'b', company: 'Beta' }), sparseJob({ id: 'c' })];
    const reply = await route.POST(post('http://s/x', { jobs, render: true }));
    expect(reply.status).toBe(200);
    const { cards } = await reply.json();
    expect(cards[0].imageUrl).toBeTruthy();
    expect(cards[1]).toMatchObject({ panelJobId: 'b', imageUrl: null, error: expect.stringContaining('chromium crashed') });
    expect(cards[2]).toMatchObject({ panelJobId: 'c', imageUrl: null, missing: ['skill', 'eligibility'] });
  });

  it('answers 400 for fewer than 2 or more than 10 jobs, or a job that is not a job', async () => {
    const route = await import('@/app/api/jobcards/batch/route');
    expect((await route.POST(post('http://s/x', { jobs: [panelJob()] }))).status).toBe(400);
    const many = Array.from({ length: 11 }, (_, i) => panelJob({ id: `j${i}` }));
    expect((await route.POST(post('http://s/x', { jobs: many }))).status).toBe(400);
    expect((await route.POST(post('http://s/x', { jobs: [panelJob(), { nope: 1 }] }))).status).toBe(400);
    expect(renders).toHaveLength(0);
  });
});

describe('POST /api/jobcards/handoff-carousel', () => {
  const fixtureBot = () => {
    const seen: { path: string; form: FormData; key: string | null }[] = [];
    vi.stubGlobal('fetch', async (url: string, init: RequestInit) => {
      const u = new URL(String(url));
      if (u.host !== 'intabot.test:4100') throw new Error(`unexpected network call to ${url}`);
      seen.push({ path: u.pathname, form: init.body as FormData, key: (init.headers as Record<string, string>)['x-handoff-key'] });
      return json({ postId: 'post-c1', accountId: 'acct-1', status: 'PENDING_APPROVAL', caption: 'cap', created: true }, 201);
    });
    return seen;
  };

  it('posts the cards in order to the carousel route and returns the post and whether it was created', async () => {
    process.env.INTABOT_URL = 'http://intabot.test:4100';
    process.env.INTABOT_HANDOFF_KEY = 'k-1';
    const seen = fixtureBot();
    const batch = await import('@/app/api/jobcards/batch/route');
    const route = await import('@/app/api/jobcards/handoff-carousel/route');
    const jobs = [panelJob({ id: 'a', company: 'Alpha' }), panelJob({ id: 'b', company: 'Beta' })];
    const { cards } = await (await batch.POST(post('http://s/x', { jobs }))).json();
    const ids = cards.map((c: { cardId: string }) => c.cardId).reverse();

    const reply = await route.POST(post('http://s/x', { contentId: 'c-9', title: 'Two jobs', cardIds: ids }));
    expect(reply.status).toBe(200);
    expect(await reply.json()).toMatchObject({ postId: 'post-c1', accountId: 'acct-1', created: true });
    expect(seen).toHaveLength(1);
    expect(seen[0].path).toBe('/handoff/carousel');
    expect(seen[0].key).toBe('k-1');
    expect((seen[0].form.getAll('files[]') as File[]).map((f) => f.name)).toEqual(ids.map((i: string) => `${i}.png`));
    expect(JSON.parse(String(seen[0].form.get('card')))).toMatchObject({ contentId: 'c-9', title: 'Two jobs' });
  });

  it('answers 400 for a body without a content id, title or cards, and 409 for a card with no render', async () => {
    process.env.INTABOT_URL = 'http://intabot.test:4100';
    process.env.INTABOT_HANDOFF_KEY = 'k-1';
    const seen = fixtureBot();
    const one = await import('@/app/api/jobcards/from-job/route');
    const route = await import('@/app/api/jobcards/handoff-carousel/route');
    expect((await route.POST(post('http://s/x', { title: 't', cardIds: ['a', 'b'] }))).status).toBe(400);
    expect((await route.POST(post('http://s/x', { contentId: 'c', cardIds: ['a', 'b'] }))).status).toBe(400);
    expect((await route.POST(post('http://s/x', { contentId: 'c', title: 't' }))).status).toBe(400);

    const a = await (await one.POST(post('http://s/x', { job: panelJob({ id: 'a' }), render: false }))).json();
    const b = await (await one.POST(post('http://s/x', { job: panelJob({ id: 'b', company: 'Beta' }), render: false }))).json();
    const reply = await route.POST(post('http://s/x', { contentId: 'c', title: 't', cardIds: [a.cardId, b.cardId] }));
    expect(reply.status).toBe(409);
    expect(seen).toHaveLength(0);
  });
});
