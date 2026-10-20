import { mkdtempSync, promises as fs } from 'fs';
import os from 'os';
import path from 'path';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const runJob = vi.fn(async () => ({}));
const reviseJob = vi.fn(async () => ({}));
const overrideFacts = vi.fn(async () => ({}));
let running = false;

vi.mock('@/lib/explainer2/job', async (orig) => {
  const real = await orig<typeof import('@/lib/explainer2/job')>();
  return {
    ...real,
    realDeps: async () => ({ fake: true }),
    runJob: (...a: unknown[]) => (runJob as (...x: unknown[]) => unknown)(...a),
    reviseJob: (...a: unknown[]) => (reviseJob as (...x: unknown[]) => unknown)(...a),
    overrideFacts: (...a: unknown[]) => (overrideFacts as (...x: unknown[]) => unknown)(...a),
    isRunning: () => running,
  };
});

const BRIEF = { topic: 'Rate limiting', audience: 'backend engineers', claim: 'Limits protect shared capacity', seconds: 30 };
const json = (method: string, body?: unknown) =>
  new Request('http://t/api/explainers2', { method, headers: { 'content-type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) });
const ctx = (slug: string, extra: { file?: string } = {}) => ({ params: Promise.resolve({ slug, file: '', ...extra }) });

let data: string;
beforeEach(() => {
  data = mkdtempSync(path.join(os.tmpdir(), 'x2-api-'));
  process.env.IOLAR_DATA_DIR = data;
  delete process.env.REELS_RENDER_DIR;
  running = false;
  runJob.mockClear();
  reviseJob.mockClear();
  overrideFacts.mockClear();
});

const create = async () => {
  const list = await import('@/app/api/explainers2/route');
  const res = await list.POST(json('POST', BRIEF));
  return { list, res, body: await res.json() };
};

describe('/api/explainers2', () => {
  it('creates from a brief, lists it, and rejects a bad brief', async () => {
    const { list, res, body } = await create();
    expect(res.status).toBe(201);
    expect(body.slug).toBe('rate-limiting');
    const listed = await (await list.GET()).json();
    expect(listed.explainers.map((r: { slug: string }) => r.slug)).toEqual(['rate-limiting']);
    const bad = await list.POST(json('POST', { ...BRIEF, seconds: 5 }));
    expect(bad.status).toBe(400);
  });

  it('can start the run right away', async () => {
    const list = await import('@/app/api/explainers2/route');
    const res = await list.POST(json('POST', { ...BRIEF, start: true }));
    expect(res.status).toBe(201);
    expect(runJob).toHaveBeenCalledTimes(1);
  });

  it('returns the detail and 404s an unknown slug', async () => {
    await create();
    const one = await import('@/app/api/explainers2/[slug]/route');
    const got = await (await one.GET(json('GET'), ctx('rate-limiting'))).json();
    expect(got.brief.topic).toBe('Rate limiting');
    expect(got.job.stages.brief.status).toBe('done');
    expect(got.script).toBeNull();
    expect(got.running).toBe(false);
    expect((await one.GET(json('GET'), ctx('nope'))).status).toBe(404);
    expect((await one.GET(json('GET'), ctx('../x'))).status).toBe(400);
  });

  it('saves an edited script, validated, and makes the fact check run again', async () => {
    await create();
    const one = await import('@/app/api/explainers2/[slug]/route');
    const beat = (i: number) => ({ id: `b${i}`, caption: 'c', narration: 'n', visual: 'v' });
    const script = {
      title: 'Edited', hook: { before: { value: 1, unit: 'ms', label: 'a' }, after: { value: 2, unit: 'ms', label: 'b' } },
      beats: [1, 2, 3, 4].map(beat), facts: [],
    };
    const bad = await one.PUT(json('PUT', { ...script, title: 'x'.repeat(50) }), ctx('rate-limiting'));
    expect(bad.status).toBe(400);
    const ok = await one.PUT(json('PUT', script), ctx('rate-limiting'));
    expect(ok.status).toBe(200);
    const got = await (await one.GET(json('GET'), ctx('rate-limiting'))).json();
    expect(got.script.title).toBe('Edited');
    expect(got.job.stages.script.status).toBe('done');
    expect(got.job.stages.factcheck.status).toBe('pending');
  });

  it('starts runs, revisions and overrides in the background', async () => {
    await create();
    const run = await import('@/app/api/explainers2/[slug]/run/route');
    const res = await run.POST(json('POST', { from: 'design' }), ctx('rate-limiting'));
    expect(res.status).toBe(202);
    expect(runJob).toHaveBeenCalledWith('rate-limiting', { fake: true }, { from: 'design' });

    const revise = await import('@/app/api/explainers2/[slug]/revise/route');
    expect((await revise.POST(json('POST', { notes: '', kind: 'visual' }), ctx('rate-limiting'))).status).toBe(400);
    expect((await revise.POST(json('POST', { notes: 'Bigger', kind: 'visual' }), ctx('rate-limiting'))).status).toBe(202);
    expect(reviseJob).toHaveBeenCalledWith('rate-limiting', 'Bigger', 'visual');

    const override = await import('@/app/api/explainers2/[slug]/override/route');
    expect((await override.POST(json('POST'), ctx('rate-limiting'))).status).toBe(202);
    expect(overrideFacts).toHaveBeenCalledWith('rate-limiting');
  });

  it('answers 409 when it is already running', async () => {
    await create();
    running = true;
    const run = await import('@/app/api/explainers2/[slug]/run/route');
    expect((await run.POST(json('POST', {}), ctx('rate-limiting'))).status).toBe(409);
    expect(runJob).not.toHaveBeenCalled();
  });

  it('serves stills and clips by name only, and the mp4 and poster once rendered', async () => {
    await create();
    const dir = path.join(data, 'explainer-v2', 'rate-limiting');
    await fs.mkdir(path.join(dir, 'stills'), { recursive: true });
    await fs.mkdir(path.join(dir, 'voice'), { recursive: true });
    await fs.mkdir(path.join(dir, 'renders'), { recursive: true });
    await fs.writeFile(path.join(dir, 'stills', 'b1.png'), 'png');
    await fs.writeFile(path.join(dir, 'voice', 'b1.mp3'), 'mp3');
    await fs.writeFile(path.join(dir, 'renders', 'poster.png'), 'poster');
    await fs.writeFile(path.join(dir, 'renders', 'abc123abc123.mp4'), 'mp4');
    const job = JSON.parse(await fs.readFile(path.join(dir, 'job.json'), 'utf8'));
    job.renderId = 'abc123abc123';
    await fs.writeFile(path.join(dir, 'job.json'), JSON.stringify(job));

    const still = await import('@/app/api/explainers2/[slug]/stills/[file]/route');
    const png = await still.GET(json('GET'), ctx('rate-limiting', { file: 'b1.png' }));
    expect(png.status).toBe(200);
    expect(png.headers.get('content-type')).toBe('image/png');
    expect((await still.GET(json('GET'), ctx('rate-limiting', { file: '../job.json' }))).status).toBe(400);
    expect((await still.GET(json('GET'), ctx('rate-limiting', { file: 'b9.png' }))).status).toBe(404);

    const voice = await import('@/app/api/explainers2/[slug]/voice/[file]/route');
    expect((await voice.GET(json('GET'), ctx('rate-limiting', { file: 'b1.mp3' }))).headers.get('content-type')).toBe('audio/mpeg');
    expect((await voice.GET(json('GET'), ctx('rate-limiting', { file: '..\\x.mp3' }))).status).toBe(400);

    const mp4 = await import('@/app/api/explainers2/[slug]/mp4/route');
    expect((await mp4.GET(json('GET'), ctx('rate-limiting'))).headers.get('content-type')).toBe('video/mp4');
    const poster = await import('@/app/api/explainers2/[slug]/poster/route');
    expect((await poster.GET(json('GET'), ctx('rate-limiting'))).status).toBe(200);
  });

  it('404s the mp4 before anything rendered', async () => {
    await create();
    const mp4 = await import('@/app/api/explainers2/[slug]/mp4/route');
    expect((await mp4.GET(json('GET'), ctx('rate-limiting'))).status).toBe(404);
  });
});

describe('/api/explainers2 sound, critic and cover', () => {
  const library = async () => {
    const root = mkdtempSync(path.join(os.tmpdir(), 'x2-api-r-'));
    process.env.REELS_RENDER_DIR = root;
    await fs.mkdir(path.join(root, 'public', 'designed', '_audio'), { recursive: true });
    await fs.writeFile(
      path.join(root, 'public', 'designed', '_audio', 'manifest.json'),
      JSON.stringify({ files: [{ file: 'music/calm-1.mp3', kind: 'music', mood: 'calm' }, { file: 'music/calm-2.mp3', kind: 'music', mood: 'calm' }, { file: 'sfx/pop.wav', kind: 'sfx', event: 'pop' }] }),
    );
    return root;
  };

  it('the detail carries the critic record, the strips and the beds on offer', async () => {
    await create();
    await library();
    const dir = path.join(data, 'explainer-v2', 'rate-limiting');
    const scores = { hook: 9, readable: 9, motion: 9, emphasis: 9, clean: 9, look: 9, match: 9 };
    await fs.writeFile(path.join(dir, 'critic.json'), JSON.stringify({ pass: true, scores, fixes: [], rounds: [{ scores, fixes: [], pass: true }] }));
    await fs.mkdir(path.join(dir, 'strips'), { recursive: true });
    await fs.writeFile(path.join(dir, 'strips', 'b1.png'), 'png');
    await fs.writeFile(path.join(dir, 'sound.json'), JSON.stringify({ bed: 'music/calm-1.mp3' }));
    const one = await import('@/app/api/explainers2/[slug]/route');
    const got = await (await one.GET(json('GET'), ctx('rate-limiting'))).json();
    expect(got.critic.pass).toBe(true);
    expect(got.strips).toEqual(['b1.png']);
    expect(got.sound).toEqual({ bed: 'music/calm-1.mp3', beds: [{ file: 'music/calm-1.mp3', mood: 'calm' }, { file: 'music/calm-2.mp3', mood: 'calm' }] });
  });

  it('the detail copes with no critic, no strips and no library', async () => {
    await create();
    process.env.REELS_RENDER_DIR = mkdtempSync(path.join(os.tmpdir(), 'x2-api-empty-'));
    const one = await import('@/app/api/explainers2/[slug]/route');
    const got = await (await one.GET(json('GET'), ctx('rate-limiting'))).json();
    expect(got.critic).toBeNull();
    expect(got.strips).toEqual([]);
    expect(got.sound).toEqual({ bed: null, beds: [] });
  });

  it('changes the bed to one in the library and renders again; refuses one that is not', async () => {
    await create();
    await library();
    const bed = await import('@/app/api/explainers2/[slug]/bed/route');
    expect((await bed.POST(json('POST', { bed: 'music/nope.mp3' }), ctx('rate-limiting'))).status).toBe(400);
    expect((await bed.POST(json('POST', { bed: 'sfx/pop.wav' }), ctx('rate-limiting'))).status).toBe(400);
    expect((await bed.POST(json('POST', { bed: 7 }), ctx('rate-limiting'))).status).toBe(400);
    expect(runJob).not.toHaveBeenCalled();
    const ok = await bed.POST(json('POST', { bed: 'music/calm-2.mp3' }), ctx('rate-limiting'));
    expect(ok.status).toBe(202);
    const dir = path.join(data, 'explainer-v2', 'rate-limiting');
    expect(JSON.parse(await fs.readFile(path.join(dir, 'sound.json'), 'utf8'))).toEqual({ bed: 'music/calm-2.mp3' });
    expect(runJob).toHaveBeenCalledTimes(1);
    const none = await bed.POST(json('POST', { bed: null }), ctx('rate-limiting'));
    expect(none.status).toBe(202);
    expect(JSON.parse(await fs.readFile(path.join(dir, 'sound.json'), 'utf8'))).toEqual({ bed: null });
  });

  it('answers 409 to a bed change while it is running, and 404 for an unknown explainer', async () => {
    await create();
    await library();
    const bed = await import('@/app/api/explainers2/[slug]/bed/route');
    running = true;
    expect((await bed.POST(json('POST', { bed: null }), ctx('rate-limiting'))).status).toBe(409);
    expect((await bed.POST(json('POST', { bed: null }), ctx('nope'))).status).toBe(404);
  });

  it('serves a strip by name only, and the cover as the poster, falling back to the old poster', async () => {
    await create();
    const dir = path.join(data, 'explainer-v2', 'rate-limiting');
    await fs.mkdir(path.join(dir, 'strips'), { recursive: true });
    await fs.mkdir(path.join(dir, 'renders'), { recursive: true });
    await fs.writeFile(path.join(dir, 'strips', 'b1.png'), 'strip');
    const strip = await import('@/app/api/explainers2/[slug]/strips/[file]/route');
    expect((await strip.GET(json('GET'), ctx('rate-limiting', { file: 'b1.png' }))).status).toBe(200);
    expect((await strip.GET(json('GET'), ctx('rate-limiting', { file: '../job.json' }))).status).toBe(400);
    expect((await strip.GET(json('GET'), ctx('rate-limiting', { file: 'b9.png' }))).status).toBe(404);

    const poster = await import('@/app/api/explainers2/[slug]/poster/route');
    expect((await poster.GET(json('GET'), ctx('rate-limiting'))).status).toBe(404);
    await fs.writeFile(path.join(dir, 'renders', 'poster.png'), 'old');
    expect(Buffer.from(await (await poster.GET(json('GET'), ctx('rate-limiting'))).arrayBuffer()).toString()).toBe('old');
    await fs.writeFile(path.join(dir, 'renders', 'cover.png'), 'cover');
    expect(Buffer.from(await (await poster.GET(json('GET'), ctx('rate-limiting'))).arrayBuffer()).toString()).toBe('cover');
  });

  it('lists the cover and the lowest critic score', async () => {
    const { list } = await create();
    const dir = path.join(data, 'explainer-v2', 'rate-limiting');
    await fs.mkdir(path.join(dir, 'renders'), { recursive: true });
    await fs.writeFile(path.join(dir, 'renders', 'cover.png'), 'c');
    const scores = { hook: 9, readable: 7, motion: 9, emphasis: 9, clean: 9, look: 9, match: 9 };
    await fs.writeFile(path.join(dir, 'critic.json'), JSON.stringify({ pass: false, scores, fixes: ['x'], rounds: [{ scores, fixes: ['x'], pass: false }] }));
    const row = (await (await list.GET()).json()).explainers[0];
    expect(row).toMatchObject({ cover: true, poster: true, criticMin: 7 });
  });
});

