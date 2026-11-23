import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import path from 'path';

const req = (method: string, body?: unknown) =>
  new Request('http://t/api/jobcards/x/handoff', {
    method,
    headers: { 'content-type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });

const fixture = () =>
  JSON.parse(readFileSync(path.join(process.cwd(), 'tests/fixtures/jobcard.json'), 'utf8')) as Record<string, unknown>;

const json = (v: unknown, status = 200) =>
  new Response(JSON.stringify(v), { status, headers: { 'content-type': 'application/json' } });

/** IntaBot as the route sees it: global fetch, answering only its own host. */
function intabot(answer: () => Response | Error) {
  const calls: string[] = [];
  vi.stubGlobal('fetch', async (url: string) => {
    const u = new URL(String(url));
    if (u.host !== 'intabot.test:4100') throw new Error(`unexpected network call to ${url}`);
    calls.push(u.pathname);
    const v = answer();
    if (v instanceof Error) throw v;
    return v;
  });
  return calls;
}

const created = () =>
  json({ postId: 'post-9', accountId: 'acct-1', status: 'PENDING_APPROVAL', caption: 'the caption', created: true }, 201);

async function made(opts: { image?: boolean } = {}) {
  const list = await import('@/app/api/jobcards/route');
  const reply = await list.POST(
    new Request('http://t/api/jobcards', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ draft: fixture() }),
    })
  );
  const { id } = (await reply.json()) as { id: string };
  if (opts.image !== false) {
    const { jobcardDir, jobcardImage } = await import('@/lib/paths');
    mkdirSync(jobcardDir(id), { recursive: true });
    writeFileSync(jobcardImage(id), Buffer.from([0x89, 0x50, 0x4e, 0x47, 1, 2, 3]));
  }
  return { id, ctx: { params: Promise.resolve({ id }) } };
}

beforeEach(async () => {
  process.env.IOLAR_DATA_DIR = mkdtempSync(path.join(tmpdir(), 'is-handoff-api-'));
  process.env.INTABOT_URL = 'http://intabot.test:4100';
  process.env.INTABOT_HANDOFF_KEY = 'k-123';
  (await import('@/lib/db')).closeDb();
});
afterEach(async () => {
  vi.unstubAllGlobals();
  delete process.env.INTABOT_URL;
  delete process.env.INTABOT_HANDOFF_KEY;
  (await import('@/lib/db')).closeDb();
});

describe('POST /api/jobcards/[id]/handoff', () => {
  it('hands a rendered card to IntaBot and then shows it on GET', async () => {
    const calls = intabot(created);
    const route = await import('@/app/api/jobcards/[id]/handoff/route');
    const one = await import('@/app/api/jobcards/[id]/route');
    const { id, ctx } = await made();

    const before = await (await one.GET(req('GET'), ctx)).json();
    expect(before.handoff).toBeNull();

    const reply = await route.POST(req('POST'), ctx);
    expect(reply.status).toBe(200);
    const body = await reply.json();
    expect(body.handoff).toMatchObject({ postId: 'post-9', accountId: 'acct-1', status: 'queued' });
    expect(calls).toEqual(['/handoff/job-card']);

    const after = await (await one.GET(req('GET'), { params: Promise.resolve({ id }) })).json();
    expect(after.handoff).toMatchObject({ postId: 'post-9', status: 'queued' });
  });

  it('answers 409 for a card that was never rendered', async () => {
    const calls = intabot(created);
    const route = await import('@/app/api/jobcards/[id]/handoff/route');
    const { ctx } = await made({ image: false });
    const reply = await route.POST(req('POST'), ctx);
    expect(reply.status).toBe(409);
    expect((await reply.json()).error).toMatch(/render the card first/);
    expect(calls).toHaveLength(0);
  });

  it('answers 404 for an unknown card', async () => {
    intabot(created);
    const route = await import('@/app/api/jobcards/[id]/handoff/route');
    expect((await route.POST(req('POST'), { params: Promise.resolve({ id: 'ghost' }) })).status).toBe(404);
  });

  it('passes an IntaBot refusal through and answers 502 when it is down', async () => {
    const route = await import('@/app/api/jobcards/[id]/handoff/route');
    const { ctx } = await made();

    intabot(() => json({ message: 'Unauthorized' }, 401));
    const refused = await route.POST(req('POST'), ctx);
    expect(refused.status).toBe(401);
    expect((await refused.json()).error).toMatch(/Unauthorized/);

    vi.unstubAllGlobals();
    intabot(() => new Error('connect ECONNREFUSED'));
    const down = await route.POST(req('POST'), ctx);
    expect(down.status).toBe(502);
    expect((await down.json()).error).toMatch(/IntaBot did not answer/);
  });
});
