import { mkdtempSync, promises as fs } from 'fs';
import os from 'os';
import path from 'path';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { launchAssetsDir, launchRendersDir } from '@/lib/paths';

const startLaunch = vi.fn(async () => undefined);
const startApprove = vi.fn(async () => undefined);
const startLaunchRevise = vi.fn(async () => undefined);
const startLaunchOverride = vi.fn(async () => undefined);

vi.mock('@/lib/launch/start', async (orig) => {
  const real = await orig<typeof import('@/lib/launch/start')>();
  return {
    ...real,
    startLaunch: (...a: unknown[]) => (startLaunch as (...x: unknown[]) => unknown)(...a),
    startApprove: (...a: unknown[]) => (startApprove as (...x: unknown[]) => unknown)(...a),
    startLaunchRevise: (...a: unknown[]) => (startLaunchRevise as (...x: unknown[]) => unknown)(...a),
    startLaunchOverride: (...a: unknown[]) => (startLaunchOverride as (...x: unknown[]) => unknown)(...a),
  };
});

const json = (body: unknown) => new Request('http://x/api/launch', { method: 'POST', body: JSON.stringify(body) });
const ctx = (slug: string, file = '') => ({ params: Promise.resolve({ slug, file }) });

let data: string;
beforeEach(() => {
  data = mkdtempSync(path.join(os.tmpdir(), 'launch-api-'));
  process.env.IOLAR_DATA_DIR = data;
  startLaunch.mockClear();
  startApprove.mockClear();
  startLaunchRevise.mockClear();
  startLaunchOverride.mockClear();
});

const create = async () => {
  const { POST } = await import('@/app/api/launch/route');
  return POST(json({ title: 'Gemini 4', links: ['https://blog.google/x'] }));
};

describe('/api/launch', () => {
  it('creates a reel from a title and links, and lists it', async () => {
    const res = await create();
    expect(res.status).toBe(201);
    expect((await res.json()).slug).toBe('gemini-4');
    const { GET } = await import('@/app/api/launch/route');
    expect((await (await GET()).json()).launches.map((l: { slug: string }) => l.slug)).toEqual(['gemini-4']);
    expect(startLaunch).not.toHaveBeenCalled();
  });
  it('makes a reel from a reference, marks it made, and starts it', async () => {
    const { writeReference, readReference } = await import('@/lib/launch/inbox');
    await writeReference({ id: 'AAAAA1', creator: 'varunmayya', postedAt: '2026-10-21T08:00:00Z', url: 'https://instagram.com/reel/AAAAA1', caption: 'c', topic: 'Gemini 4 launch', transcript: 'SECRET WORDS', durationSec: 40,
      shots: [{ start: 0, end: 2.5, kind: 'talk' }, { start: 2.5, end: 6, kind: 'screen' }, { start: 6, end: 9, kind: 'broll' }, { start: 9, end: 40, kind: 'talk' }], status: 'new', foundAt: '2026-10-21T09:00:00Z' });
    const { POST } = await import('@/app/api/launch/route');
    const res = await POST(json({ referenceId: 'AAAAA1', seconds: 30, start: true }));
    expect(res.status).toBe(201);
    const { slug } = await res.json();
    expect(slug).toBe('gemini-4-launch');
    expect(startLaunch).toHaveBeenCalledWith(slug);
    const { readBrief } = await import('@/lib/launch/store');
    const brief = await readBrief(slug);
    expect(brief).toMatchObject({ title: 'Gemini 4 launch', links: [], seconds: 30, reference: { id: 'AAAAA1', creator: 'varunmayya', hookSec: 2.5, medianShotSec: 3.25 } });
    expect(JSON.stringify(brief)).not.toContain('SECRET WORDS');
    expect(await readReference('AAAAA1')).toMatchObject({ status: 'made', slug });
    expect((await POST(json({ referenceId: 'ZZZZZ9' }))).status).toBe(404);
    expect((await POST(json({ referenceId: '../x' }))).status).toBe(400);
  });
  it('starts the run when asked to', async () => {
    const { POST } = await import('@/app/api/launch/route');
    await POST(json({ title: 'Gemini 4', links: ['https://blog.google/x'], start: true }));
    expect(startLaunch).toHaveBeenCalledWith('gemini-4');
  });
  it('refuses a brief with no links', async () => {
    const { POST } = await import('@/app/api/launch/route');
    const res = await POST(json({ title: 'Gemini 4', links: [] }));
    expect(res.status).toBe(400);
  });
  it('reads one reel back with nulls for what is not there yet', async () => {
    await create();
    const { GET } = await import('@/app/api/launch/[slug]/route');
    const body = await (await GET(new Request('http://x'), ctx('gemini-4'))).json();
    expect(body.brief.title).toBe('Gemini 4');
    expect(body).toMatchObject({ claims: null, script: null, factcheck: null, receipts: null, props: null, running: false });
    expect((await GET(new Request('http://x'), ctx('nope'))).status).toBe(404);
  });
  it('runs, approves, revises and overrides through the start helpers', async () => {
    await create();
    const run = await import('@/app/api/launch/[slug]/run/route');
    expect((await run.POST(new Request('http://x', { method: 'POST', body: JSON.stringify({ from: 'edit' }) }), ctx('gemini-4'))).status).toBe(202);
    expect(startLaunch).toHaveBeenCalledWith('gemini-4', { from: 'edit' });
    const approve = await import('@/app/api/launch/[slug]/approve/route');
    expect((await approve.POST(new Request('http://x', { method: 'POST' }), ctx('gemini-4'))).status).toBe(202);
    expect(startApprove).toHaveBeenCalledWith('gemini-4');
    const revise = await import('@/app/api/launch/[slug]/revise/route');
    expect((await revise.POST(new Request('http://x', { method: 'POST', body: JSON.stringify({ notes: '' }) }), ctx('gemini-4'))).status).toBe(400);
    expect((await revise.POST(new Request('http://x', { method: 'POST', body: JSON.stringify({ notes: 'Price first.', kind: 'wording' }) }), ctx('gemini-4'))).status).toBe(202);
    expect(startLaunchRevise).toHaveBeenCalledWith('gemini-4', 'Price first.', 'wording');
    const override = await import('@/app/api/launch/[slug]/override/route');
    expect((await override.POST(new Request('http://x', { method: 'POST' }), ctx('gemini-4'))).status).toBe(202);
  });
  it('answers 409 when it is already running', async () => {
    await create();
    const { LaunchAlreadyRunning } = await import('@/lib/launch/start');
    startApprove.mockRejectedValueOnce(new LaunchAlreadyRunning('gemini-4'));
    const approve = await import('@/app/api/launch/[slug]/approve/route');
    expect((await approve.POST(new Request('http://x', { method: 'POST' }), ctx('gemini-4'))).status).toBe(409);
  });
  it('serves only receipt pngs', async () => {
    const { GET } = await import('@/app/api/launch/[slug]/receipts/[file]/route');
    expect((await GET(new Request('http://x'), ctx('gemini-4', '..%2Fjob.json'))).status).toBe(400);
    expect((await GET(new Request('http://x'), ctx('gemini-4', 'job.json'))).status).toBe(400);
    expect((await GET(new Request('http://x'), ctx('gemini-4', 'receipt-c3.png'))).status).toBe(404);
    await fs.mkdir(launchAssetsDir('gemini-4'), { recursive: true });
    await fs.writeFile(path.join(launchAssetsDir('gemini-4'), 'receipt-c3.png'), 'png');
    const ok = await GET(new Request('http://x'), ctx('gemini-4', 'receipt-c3.png'));
    expect(ok.status).toBe(200);
    expect(ok.headers.get('content-type')).toBe('image/png');
  });
  it('serves the cover, and 404s the mp4 before a render', async () => {
    await create();
    const cover = await import('@/app/api/launch/[slug]/cover/route');
    expect((await cover.GET(new Request('http://x'), ctx('gemini-4'))).status).toBe(404);
    await fs.mkdir(launchRendersDir('gemini-4'), { recursive: true });
    await fs.writeFile(path.join(launchRendersDir('gemini-4'), 'cover.png'), 'png');
    expect((await cover.GET(new Request('http://x'), ctx('gemini-4'))).status).toBe(200);
    const mp4 = await import('@/app/api/launch/[slug]/mp4/route');
    expect((await mp4.GET(new Request('http://x'), ctx('gemini-4'))).status).toBe(404);
  });
});

describe('/api/launch anchor-reel additions', () => {
  it('creates an avatar reel with a budget default and demo and post links', async () => {
    const { POST } = await import('@/app/api/launch/route');
    const res = await POST(json({ title: 'Gemini 4', links: ['https://blog.google/x'], mode: 'avatar', demos: ['https://x.dev/d.mp4'], posts: ['https://x.com/Google/status/1'] }));
    expect(res.status).toBe(201);
    const { GET } = await import('@/app/api/launch/[slug]/route');
    const body = await (await GET(new Request('http://x'), ctx('gemini-4'))).json();
    expect(body.brief).toMatchObject({ mode: 'avatar', creditBudget: 120, demos: [{ id: 'demo-1', url: 'https://x.dev/d.mp4' }], posts: [{ id: 'post-1' }] });
    expect(body).toMatchObject({ spend: null, assets: null });
  });
  it('refuses more than three demo links and a link that is not http', async () => {
    const { POST } = await import('@/app/api/launch/route');
    const four = Array.from({ length: 4 }, (_, i) => `https://x.dev/${i}.mp4`);
    expect((await POST(json({ title: 'x', links: ['https://a.b/c'], demos: four }))).status).toBe(400);
    expect((await POST(json({ title: 'x', links: ['https://a.b/c'], posts: ['ftp://x'] }))).status).toBe(400);
  });
  it('includes spend and assets once there are any', async () => {
    await create();
    await fs.writeFile(path.join(data, 'launch', 'gemini-4', 'spend.json'), JSON.stringify({ budget: 120, entries: [{ at: 'x', what: 'clip', credits: 30, balanceAfter: 100, outcome: 'spent' }] }));
    await fs.writeFile(path.join(data, 'launch', 'gemini-4', 'assets.json'), JSON.stringify({ assets: { 'broll-0': { kind: 'broll', source: 'higgsfield', file: 'broll-0.png', key: 'k' } }, notes: [] }));
    const { GET } = await import('@/app/api/launch/[slug]/route');
    const body = await (await GET(new Request('http://x'), ctx('gemini-4'))).json();
    expect(body.spend.entries).toHaveLength(1);
    expect(body.assets.assets['broll-0'].source).toBe('higgsfield');
  });
  it('serves only avatar, b-roll and demo files from assets/, by strict name', async () => {
    const { GET } = await import('@/app/api/launch/[slug]/assets/[file]/route');
    for (const bad of ['..%2Fjob.json', 'job.json', 'avatar-3.mp3', 'receipt-c3.png', 'avatar-x.mp4', 'broll-0.mp4']) {
      expect((await GET(new Request('http://x'), ctx('gemini-4', bad))).status, bad).toBe(400);
    }
    expect((await GET(new Request('http://x'), ctx('gemini-4', 'avatar-3.mp4'))).status).toBe(404);
    await fs.mkdir(launchAssetsDir('gemini-4'), { recursive: true });
    await fs.writeFile(path.join(launchAssetsDir('gemini-4'), 'avatar-3.mp4'), 'mp4');
    await fs.writeFile(path.join(launchAssetsDir('gemini-4'), 'broll-0.png'), 'png');
    const v = await GET(new Request('http://x'), ctx('gemini-4', 'avatar-3.mp4'));
    expect(v.status).toBe(200);
    expect(v.headers.get('content-type')).toBe('video/mp4');
    expect((await GET(new Request('http://x'), ctx('gemini-4', 'broll-0.png'))).headers.get('content-type')).toBe('image/png');
  });
  it('makes one asset again: drops it and runs from the assets stage', async () => {
    await create();
    await fs.mkdir(launchAssetsDir('gemini-4'), { recursive: true });
    await fs.writeFile(path.join(launchAssetsDir('gemini-4'), 'broll-0.png'), 'png');
    await fs.writeFile(path.join(data, 'launch', 'gemini-4', 'assets.json'), JSON.stringify({ assets: { 'broll-0': { kind: 'broll', source: 'higgsfield', file: 'broll-0.png', key: 'k' } }, notes: [] }));
    const redo = await import('@/app/api/launch/[slug]/assets/[file]/redo/route');
    const post = (file: string) => redo.POST(new Request('http://x', { method: 'POST' }), ctx('gemini-4', file));
    expect((await post('..%2Fjob.json')).status).toBe(400);
    expect((await post('broll-9')).status).toBe(404);
    expect(startLaunch).not.toHaveBeenCalled();
    expect((await post('broll-0')).status).toBe(202);
    expect(startLaunch).toHaveBeenCalledWith('gemini-4', { from: 'assets' });
    await expect(fs.access(path.join(launchAssetsDir('gemini-4'), 'broll-0.png'))).rejects.toThrow();
    const { LaunchAlreadyRunning } = await import('@/lib/launch/start');
    startLaunch.mockRejectedValueOnce(new LaunchAlreadyRunning('gemini-4'));
    await fs.writeFile(path.join(data, 'launch', 'gemini-4', 'assets.json'), JSON.stringify({ assets: { 'broll-0': { kind: 'broll', source: 'swapped', file: '', key: 'k' } }, notes: [] }));
    expect((await post('broll-0.png')).status).toBe(409);
  });
});

describe('/api/launch polish additions', () => {
  it('serves only strip pngs named NN-Type.png', async () => {
    await create();
    const { GET } = await import('@/app/api/launch/[slug]/strips/[file]/route');
    for (const bad of ['..%2Fjob.json', 'job.json', '0-Headline.png', '00-Headline.jpg', '00-Head_line.png', '00-.png', '../00-Headline.png']) {
      expect((await GET(new Request('http://x'), ctx('gemini-4', bad))).status).toBe(400);
    }
    expect((await GET(new Request('http://x'), ctx('gemini-4', '00-Headline.png'))).status).toBe(404);
    await fs.mkdir(path.join(data, 'launch', 'gemini-4', 'strips'), { recursive: true });
    await fs.writeFile(path.join(data, 'launch', 'gemini-4', 'strips', '00-Headline.png'), 'png');
    const ok = await GET(new Request('http://x'), ctx('gemini-4', '00-Headline.png'));
    expect(ok.status).toBe(200);
    expect(ok.headers.get('content-type')).toBe('image/png');
  });

  it('returns the critic record with the reel, null when there is none', async () => {
    await create();
    const { GET } = await import('@/app/api/launch/[slug]/route');
    expect((await (await GET(new Request('http://x'), ctx('gemini-4'))).json()).critic).toBeNull();
    const rec = { pass: false, scores: { hook: 5 }, fixes: ['x'], rounds: [] };
    await fs.writeFile(path.join(data, 'launch', 'gemini-4', 'critic.json'), JSON.stringify(rec));
    expect((await (await GET(new Request('http://x'), ctx('gemini-4'))).json()).critic).toEqual(rec);
  });

  it('sets the speed of a reel, and refuses anything else', async () => {
    await create();
    const { POST } = await import('@/app/api/launch/[slug]/speed/route');
    const post = (body: unknown, slug = 'gemini-4') => POST(new Request('http://x', { method: 'POST', body: JSON.stringify(body) }), ctx(slug));
    expect((await post({ speed: 'turbo' })).status).toBe(400);
    expect((await post({ speed: 'polish' }, 'nope')).status).toBe(404);
    expect((await post({ speed: 'polish' })).status).toBe(200);
    const { readBrief } = await import('@/lib/launch/store');
    expect((await readBrief('gemini-4'))?.speed).toBe('polish');
    expect((await post({ speed: 'fast' })).status).toBe(200);
    expect((await readBrief('gemini-4'))?.speed).toBe('fast');
  });

  it('creates a polish reel from the form', async () => {
    const { POST } = await import('@/app/api/launch/route');
    expect((await POST(json({ title: 'Gemini 4', links: ['https://blog.google/x'], speed: 'polish' }))).status).toBe(201);
    const { readBrief } = await import('@/lib/launch/store');
    expect((await readBrief('gemini-4'))?.speed).toBe('polish');
  });
});
