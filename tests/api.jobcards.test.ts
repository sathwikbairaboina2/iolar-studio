import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, readFileSync } from 'fs';
import { tmpdir } from 'os';
import path from 'path';

const req = (method: string, body?: unknown) =>
  new Request('http://t/api/jobcards', {
    method,
    headers: { 'content-type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });

const fixture = () =>
  JSON.parse(readFileSync(path.join(process.cwd(), 'tests/fixtures/jobcard.json'), 'utf8')) as Record<string, unknown>;

beforeEach(async () => {
  process.env.IOLAR_DATA_DIR = mkdtempSync(path.join(tmpdir(), 'is-jobcards-'));
  (await import('@/lib/db')).closeDb();
});
afterEach(async () => {
  (await import('@/lib/db')).closeDb();
  await (await import('@/lib/jobcard/render')).closeBrowser();
});

describe('the job cards api', () => {
  it('takes a document, corrects it, renders it, and serves the card', async () => {
    const list = await import('@/app/api/jobcards/route');
    const one = await import('@/app/api/jobcards/[id]/route');
    const render = await import('@/app/api/jobcards/[id]/render/route');
    const image = await import('@/app/api/jobcards/[id]/image/route');

    const made = await (await list.POST(req('POST', { draft: fixture() }))).json();
    expect(made.missing).toEqual([]);
    expect(made.id).toContain('zoho');

    const ctx = { params: Promise.resolve({ id: made.id as string }) };
    const got = await (await one.GET(req('GET'), ctx)).json();
    expect(got.row.company).toBe('Zoho Corporation');
    // Every field filled, four rounds, two dates: the family that cannot run out of room.
    expect(got.families[0].family).toBe('band-stack');

    const edited = { ...got.draft, role: { ...got.draft.role, title: 'Senior Backend Engineer' } };
    const put = await (await one.PUT(req('PUT', edited), { params: Promise.resolve({ id: made.id }) })).json();
    expect(put.row.role).toBe('Senior Backend Engineer');

    const shot = await (
      await render.POST(req('POST', { family: 'band-stack' }), { params: Promise.resolve({ id: made.id }) })
    ).json();
    expect(shot).toMatchObject({ family: 'band-stack', overflowPx: 0, fellBack: false });
    expect(shot.row.renderedAt).toBeTruthy();

    const png = await image.GET(req('GET'), { params: Promise.resolve({ id: made.id }) });
    expect(png.headers.get('content-type')).toBe('image/png');
    expect((await png.arrayBuffer()).byteLength).toBeGreaterThan(1000);

    const all = await (await list.GET()).json();
    expect(all.cards).toHaveLength(1);
    expect(all.cards[0]).toMatchObject({ family: 'band-stack', fellBack: false });
  }, 180_000);

  it('will not render a document that is still missing a mandatory field', async () => {
    const list = await import('@/app/api/jobcards/route');
    const render = await import('@/app/api/jobcards/[id]/render/route');

    const draft = fixture();
    delete draft.salary;
    const made = await (await list.POST(req('POST', { draft }))).json();
    expect(made.missing).toContain('salary range');

    const reply = await render.POST(req('POST', {}), { params: Promise.resolve({ id: made.id }) });
    expect(reply.status).toBe(400);
    expect((await reply.json()).missing).toContain('salary range');
  });

  it('reads a pool row the ledger already holds', async () => {
    const L = await import('@/lib/jobs/ledger');
    L.upsertPool(
      [
        {
          researchId: 412,
          familyKey: 'zoho|sde',
          company: 'Zoho Corporation',
          title: 'Software Development Engineer',
          category: 'india',
          remote: false,
          postedAt: '2026-09-01T00:00:00.000Z',
          raw: {
            id: 412,
            url: 'https://careers.zohocorp.com/jobs/sde',
            title: 'Software Development Engineer',
            company: 'Zoho Corporation',
            location: 'Chennai, Tamil Nadu',
            remote: false,
            salary: '₹8L - ₹18L',
            description: 'Hybrid role. 2 - 5 years of backend work.',
            locations: ['Chennai, Tamil Nadu'],
          },
        },
      ],
      '2026-09-02T00:00:00.000Z'
    );

    const list = await import('@/app/api/jobcards/route');
    // No model: the row still maps across, and the gaps it cannot fill are named.
    const made = await (await list.POST(req('POST', { poolId: 412, useModel: false }))).json();
    expect(made.draft.company.name).toBe('Zoho Corporation');
    expect(made.draft.source).toMatchObject({ kind: 'pool', poolId: 412 });
    expect(made.missing).toEqual(['skill', 'eligibility']);
  });

  it('answers 404 for a row the ledger does not hold', async () => {
    const list = await import('@/app/api/jobcards/route');
    expect((await list.POST(req('POST', { poolId: 9999 }))).status).toBe(404);
  });
});
