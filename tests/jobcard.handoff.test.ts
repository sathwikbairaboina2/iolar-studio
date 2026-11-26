import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import path from 'path';

const fixture = () =>
  JSON.parse(readFileSync(path.join(process.cwd(), 'tests/fixtures/jobcard.json'), 'utf8')) as Record<string, unknown>;

// Eight bytes of PNG signature are enough: the handoff ships the file, it does not decode it.
const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3]);

const json = (v: unknown, status = 200) =>
  new Response(JSON.stringify(v), { status, headers: { 'content-type': 'application/json' } });

type Call = { url: string; init: RequestInit };

/** An IntaBot stand-in: records the request, answers with whatever it is told to. */
const intabot = (answer: () => Response | Error) => {
  const calls: Call[] = [];
  const http = (async (url: string, init: RequestInit) => {
    calls.push({ url: String(url), init });
    const v = answer();
    if (v instanceof Error) throw v;
    return v;
  }) as unknown as typeof fetch;
  return { calls, http };
};

const created = () => json({ postId: 'post-1', accountId: 'acct-1', status: 'PENDING_APPROVAL', caption: 'cap', created: true }, 201);

async function seed(opts: { image?: boolean; draft?: Record<string, unknown> } = {}) {
  const { saveCard } = await import('@/lib/jobcard/store');
  const { jobcardDir, jobcardImage } = await import('@/lib/paths');
  const id = 'zoho-sde-0001';
  await saveCard(id, (opts.draft ?? fixture()) as never);
  if (opts.image !== false) {
    mkdirSync(jobcardDir(id), { recursive: true });
    writeFileSync(jobcardImage(id), PNG);
  }
  return id;
}

beforeEach(async () => {
  process.env.IOLAR_DATA_DIR = mkdtempSync(path.join(tmpdir(), 'is-handoff-'));
  process.env.INTABOT_URL = 'http://intabot.test:4100/';
  process.env.INTABOT_HANDOFF_KEY = 'k-123';
  (await import('@/lib/db')).closeDb();
});
afterEach(async () => {
  delete process.env.INTABOT_URL;
  delete process.env.INTABOT_HANDOFF_KEY;
  (await import('@/lib/db')).closeDb();
});

describe('the IntaBot client', () => {
  it('defaults to the local IntaBot api and strips a trailing slash', async () => {
    const { intabotBase } = await import('@/lib/jobcard/handoff');
    expect(intabotBase()).toBe('http://intabot.test:4100');
    delete process.env.INTABOT_URL;
    expect(intabotBase()).toBe('http://localhost:4100');
  });
});

describe('handing a card to IntaBot', () => {
  it('posts the PNG and the mapped fields with the key, then records the handoff in card.json', async () => {
    const id = await seed();
    const { handoffCard } = await import('@/lib/jobcard/handoff');
    const { calls, http } = intabot(created);

    const out = await handoffCard(id, { http });
    expect(out.status).toBe(200);
    expect(out).toMatchObject({ handoff: { postId: 'post-1', accountId: 'acct-1', status: 'queued' } });

    expect(calls).toHaveLength(1);
    expect(calls[0].url).toBe('http://intabot.test:4100/handoff/job-card');
    expect(calls[0].init.method).toBe('POST');
    expect((calls[0].init.headers as Record<string, string>)['x-handoff-key']).toBe('k-123');

    const form = calls[0].init.body as FormData;
    const file = form.get('file') as File;
    expect(file.type).toBe('image/png');
    expect(Buffer.from(await file.arrayBuffer()).equals(PNG)).toBe(true);
    const card = JSON.parse(String(form.get('card')));
    expect(card).toMatchObject({
      cardId: id,
      role: 'Software Development Engineer',
      company: 'Zoho Corporation',
      applyUrl: 'https://aiiolar.com/jobs?q=Software%20Development%20Engineer%20Zoho%20Corporation',
    });
    for (const k of ['experience', 'location', 'eligibility']) expect(typeof card[k]).toBe('string');
    expect(card.eligibility.length).toBeGreaterThan(0);

    const stored = JSON.parse(readFileSync((await import('@/lib/paths')).jobcardFile(id), 'utf8'));
    expect(stored.handoff).toMatchObject({ postId: 'post-1', accountId: 'acct-1', status: 'queued' });
    expect(typeof stored.handoff.at).toBe('string');
    // The rest of the document is untouched.
    expect(stored.company.name).toBe('Zoho Corporation');
  });

  it('sends cta.url as the apply link when the card has one', async () => {
    const draft = fixture();
    draft.cta = { ...(draft.cta as object), url: 'https://aiiolar.com/jobs?job=zoho-sde' };
    const id = await seed({ draft });
    const { handoffCard } = await import('@/lib/jobcard/handoff');
    const { calls, http } = intabot(created);
    await handoffCard(id, { http });
    expect(JSON.parse(String((calls[0].init.body as FormData).get('card'))).applyUrl).toBe('https://aiiolar.com/jobs?job=zoho-sde');
  });

  it('builds the apply link when the card carries none: the job for a pool card, a search otherwise', async () => {
    const draft = fixture();
    draft.cta = { channel: 'site' };
    draft.source = { url: 'https://careers.zohocorp.com/jobs/sde', kind: 'pool', poolId: 412, familyKey: 'zoho|sde' };
    const id = await seed({ draft });
    const { handoffCard } = await import('@/lib/jobcard/handoff');
    const { calls, http } = intabot(created);
    await handoffCard(id, { http });
    expect(JSON.parse(String((calls[0].init.body as FormData).get('card'))).applyUrl).toBe('https://aiiolar.com/jobs?job=zoho%7Csde');
  });

  it('surfaces IntaBot errors with their status and writes nothing', async () => {
    const id = await seed();
    const { handoffCard } = await import('@/lib/jobcard/handoff');
    const { http } = intabot(() => json({ statusCode: 401, message: 'Unauthorized' }, 401));
    const out = await handoffCard(id, { http });
    expect(out).toMatchObject({ status: 401, error: expect.stringContaining('Unauthorized') });

    const { readDraft } = await import('@/lib/jobcard/store');
    expect((await readDraft(id))?.handoff).toBeUndefined();
  });

  it('answers 502 when IntaBot does not answer', async () => {
    const id = await seed();
    const { handoffCard } = await import('@/lib/jobcard/handoff');
    const { http } = intabot(() => new Error('connect ECONNREFUSED'));
    const out = await handoffCard(id, { http });
    expect(out).toMatchObject({ status: 502, error: expect.stringMatching(/IntaBot did not answer/) });
  });

  it('answers 409 when the card was never rendered, without calling IntaBot', async () => {
    const id = await seed({ image: false });
    const { handoffCard } = await import('@/lib/jobcard/handoff');
    const { calls, http } = intabot(created);
    const out = await handoffCard(id, { http });
    expect(out).toMatchObject({ status: 409, error: expect.stringMatching(/render the card first/) });
    expect(calls).toHaveLength(0);
  });

  it('answers 400 with the gaps when the document is incomplete', async () => {
    const draft = fixture();
    delete draft.eligibility;
    const id = await seed({ draft });
    const { handoffCard } = await import('@/lib/jobcard/handoff');
    const { calls, http } = intabot(created);
    const out = await handoffCard(id, { http });
    expect(out).toMatchObject({ status: 400, missing: ['eligibility'] });
    expect(calls).toHaveLength(0);
  });

  it('answers 404 for an unknown card and 503 when the key is not set', async () => {
    const { handoffCard } = await import('@/lib/jobcard/handoff');
    const { calls, http } = intabot(created);
    expect(await handoffCard('nope', { http })).toMatchObject({ status: 404 });

    const id = await seed();
    delete process.env.INTABOT_HANDOFF_KEY;
    expect(await handoffCard(id, { http })).toMatchObject({ status: 503, error: expect.stringMatching(/INTABOT_HANDOFF_KEY/) });
    expect(calls).toHaveLength(0);
  });

  it('keeps the earlier handoff when IntaBot reports a repeat', async () => {
    const id = await seed();
    const { handoffCard } = await import('@/lib/jobcard/handoff');
    await handoffCard(id, { http: intabot(created).http });
    const again = await handoffCard(id, {
      http: intabot(() => json({ postId: 'post-1', accountId: 'acct-1', status: 'PENDING_APPROVAL', caption: 'cap', created: false })).http,
    });
    expect(again.status).toBe(200);
    expect(again).toMatchObject({ handoff: { postId: 'post-1' } });
  });
});

describe('the keyword on a handed-off card', () => {
  it('sends the keyword the card asks viewers to comment', async () => {
    const id = await seed();
    const { handoffCard } = await import('@/lib/jobcard/handoff');
    const { calls, http } = intabot(created);
    await handoffCard(id, { http });
    expect(JSON.parse(String((calls[0].init.body as FormData).get('card'))).keyword).toBe('ZOHO');
  });

  it('sends a keyword set on the card, and leaves it out when it is not 2-20 letters or digits', async () => {
    const { handoffCard } = await import('@/lib/jobcard/handoff');
    const withKeyword = fixture();
    withKeyword.cta = { channel: 'site', url: 'https://aiiolar.com/jobs?job=a', keyword: 'zoho2026' };
    const a = intabot(created);
    await handoffCard(await seed({ draft: withKeyword }), { http: a.http });
    expect(JSON.parse(String((a.calls[0].init.body as FormData).get('card'))).keyword).toBe('ZOHO2026');

    const odd = fixture();
    odd.company = { name: 'X', logo: null, accent: null };
    odd.cta = { channel: 'site' };
    const b = intabot(created);
    await handoffCard(await seed({ draft: odd }), { http: b.http });
    expect(JSON.parse(String((b.calls[0].init.body as FormData).get('card')))).not.toHaveProperty('keyword');
  });
});

describe('handing a carousel to IntaBot', () => {
  const carouselOk = () => json({ postId: 'post-c1', accountId: 'acct-1', status: 'PENDING_APPROVAL', caption: 'cap', created: true }, 201);

  async function cards(n: number) {
    const { saveCard } = await import('@/lib/jobcard/store');
    const { jobcardDir, jobcardImage } = await import('@/lib/paths');
    const ids: string[] = [];
    for (let i = 0; i < n; i++) {
      const id = `card-${i}`;
      await saveCard(id, fixture() as never);
      mkdirSync(jobcardDir(id), { recursive: true });
      writeFileSync(jobcardImage(id), Buffer.concat([PNG, Buffer.from([i])]));
      ids.push(id);
    }
    return ids;
  }

  it('posts every PNG in order as files[] with the content card, and returns the post', async () => {
    const ids = await cards(3);
    const { handoffCarousel } = await import('@/lib/jobcard/handoff');
    const { calls, http } = intabot(carouselOk);
    const out = await handoffCarousel(
      { contentId: 'c-1', title: 'Three jobs this week', caption: 'a caption', cardIds: [ids[2], ids[0], ids[1]], keyword: 'LIST' },
      { http }
    );
    expect(out).toMatchObject({ status: 200, postId: 'post-c1', accountId: 'acct-1', created: true });

    expect(calls[0].url).toBe('http://intabot.test:4100/handoff/carousel');
    expect((calls[0].init.headers as Record<string, string>)['x-handoff-key']).toBe('k-123');
    const form = calls[0].init.body as FormData;
    const files = form.getAll('files[]') as File[];
    expect(files).toHaveLength(3);
    expect(files.every((f) => f.type === 'image/png')).toBe(true);
    // The order sent is the order of the slides.
    const lastBytes = await Promise.all(files.map(async (f) => new Uint8Array(await f.arrayBuffer()).at(-1)));
    expect(lastBytes).toEqual([2, 0, 1]);
    expect(JSON.parse(String(form.get('card')))).toEqual({
      contentId: 'c-1',
      title: 'Three jobs this week',
      caption: 'a caption',
      keyword: 'LIST',
    });
  });

  it('answers 400 for fewer than 2 or more than 10 cards, 404 for an unknown card and 409 for an unrendered one, before calling IntaBot', async () => {
    const ids = await cards(2);
    const { handoffCarousel } = await import('@/lib/jobcard/handoff');
    const { calls, http } = intabot(carouselOk);
    const body = { contentId: 'c-1', title: 't' };
    expect(await handoffCarousel({ ...body, cardIds: [ids[0]] }, { http })).toMatchObject({ status: 400 });
    expect(await handoffCarousel({ ...body, cardIds: Array.from({ length: 11 }, () => ids[0]) }, { http })).toMatchObject({ status: 400 });
    expect(await handoffCarousel({ ...body, cardIds: [ids[0], 'ghost'] }, { http })).toMatchObject({ status: 404 });
    expect(await handoffCarousel({ ...body, cardIds: [ids[0], '../card-1'] }, { http })).toMatchObject({ status: 404 });
    const { jobcardImage } = await import('@/lib/paths');
    (await import('fs')).rmSync(jobcardImage(ids[1]));
    expect(await handoffCarousel({ ...body, cardIds: ids }, { http })).toMatchObject({ status: 409, error: expect.stringMatching(/render/) });
    expect(calls).toHaveLength(0);
  });

  it('passes IntaBot refusals through, answers 502 when it is down and 503 without the key', async () => {
    const ids = await cards(2);
    const { handoffCarousel } = await import('@/lib/jobcard/handoff');
    const body = { contentId: 'c-1', title: 't', cardIds: ids };
    expect(await handoffCarousel(body, { http: intabot(() => json({ message: 'Unauthorized' }, 401)).http })).toMatchObject({
      status: 401,
      error: expect.stringContaining('Unauthorized'),
    });
    expect(await handoffCarousel(body, { http: intabot(() => new Error('connect ECONNREFUSED')).http })).toMatchObject({ status: 502 });
    delete process.env.INTABOT_HANDOFF_KEY;
    expect(await handoffCarousel(body, { http: intabot(carouselOk).http })).toMatchObject({ status: 503 });
  });

  it('keeps a repeat harmless: IntaBot answers with the first post', async () => {
    const ids = await cards(2);
    const { handoffCarousel } = await import('@/lib/jobcard/handoff');
    const out = await handoffCarousel(
      { contentId: 'c-1', title: 't', cardIds: ids },
      { http: intabot(() => json({ postId: 'post-c1', accountId: 'acct-1', status: 'PENDING_APPROVAL', caption: 'cap', created: false })).http }
    );
    expect(out).toMatchObject({ status: 200, postId: 'post-c1', created: false });
  });
});
