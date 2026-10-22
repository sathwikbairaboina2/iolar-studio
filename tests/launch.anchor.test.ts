import { mkdtempSync, promises as fs } from 'fs';
import os from 'os';
import path from 'path';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { launchAnchorDir, launchRoot } from '@/lib/paths';
import { ANCHOR_PROMPT, listCandidates, lockAnchor, proposeAnchors, readAnchor } from '@/lib/launch/anchor';

beforeEach(() => {
  process.env.IOLAR_DATA_DIR = mkdtempSync(path.join(os.tmpdir(), 'launch-anchor-'));
});

const addCandidate = async (id: string) => {
  const dir = path.join(launchAnchorDir(), 'candidates');
  await fs.mkdir(dir, { recursive: true });
  await fs.writeFile(path.join(dir, `${id}.png`), 'face-' + id);
};

describe('lockAnchor', () => {
  it('copies the candidate to portrait.png and writes anchor.json', async () => {
    await addCandidate('752acdda-b9be-4601-99c7-2b4f91a8df28');
    const a = await lockAnchor('752acdda-b9be-4601-99c7-2b4f91a8df28', ANCHOR_PROMPT, new Date('2026-10-21T08:00:00Z'));
    expect(a).toEqual({ imageJobId: '752acdda-b9be-4601-99c7-2b4f91a8df28', file: 'anchor/portrait.png', prompt: ANCHOR_PROMPT, lockedAt: '2026-10-21T08:00:00.000Z' });
    expect(await fs.readFile(path.join(launchRoot(), 'anchor/portrait.png'), 'utf8')).toBe('face-752acdda-b9be-4601-99c7-2b4f91a8df28');
    expect(await readAnchor()).toEqual(a);
  });
  it('refuses an unknown job id and a path-like one', async () => {
    await expect(lockAnchor('00000000-aaaa-bbbb-cccc-000000000000')).rejects.toThrow(/not a candidate/);
    await expect(lockAnchor('../../etc/passwd')).rejects.toThrow(/not a candidate/);
    expect(await readAnchor()).toBeNull();
  });
});

describe('the Gen Z presenter', () => {
  it('uses the creator prompt and accepts an uploaded start image', async () => {
    expect(ANCHOR_PROMPT).toMatch(/22-year-old Indian man/);
    const { AnchorSchema } = await import('@/lib/launch/anchor');
    const base = { imageJobId: '6d00fad9-62b7-4b0d-837a-3b5b5ca79ce8', file: 'anchor/portrait.png', prompt: 'p', lockedAt: 'now' };
    expect(AnchorSchema.parse(base).startImage).toBeUndefined();
    expect(AnchorSchema.parse({ ...base, startImage: 'media-1' }).startImage).toBe('media-1');
  });
});

describe('proposeAnchors', () => {
  it('asks for four faces, waits once and downloads the finished ones', async () => {
    let n = 0;
    const submitted: object[] = [];
    const hf = {
      generateImage: async (p: object) => { submitted.push(p); return `job-aaaa-000${n++}`; },
      generateAudio: async () => 'a',
      wait: vi.fn(async (ids: string[]) => Object.fromEntries(ids.map((id, i) => [id, i === 3 ? { status: 'failed' } : { status: 'completed', url: `https://cdn/${id}.png` }]))),
    } as never;
    const http = (async (u: string) => new Response(`bytes ${u}`)) as unknown as typeof fetch;
    const got = await proposeAnchors(hf, undefined, { http });
    expect(submitted).toHaveLength(4);
    expect(submitted[0]).toMatchObject({ model: 'soul_2', aspect_ratio: '3:4', prompt: ANCHOR_PROMPT });
    expect(got).toHaveLength(3);
    expect((await listCandidates()).map((c) => c.jobId).sort()).toEqual(got.map((c) => c.jobId).sort());
  });
});

describe('/api/launch/anchor', () => {
  it('validates the action and serves candidates by strict name', async () => {
    const { GET, POST } = await import('@/app/api/launch/anchor/route');
    const post = (b: unknown) => POST(new Request('http://x', { method: 'POST', body: JSON.stringify(b) }));
    expect((await post({ action: 'dance' })).status).toBe(400);
    expect((await post({ action: 'lock' })).status).toBe(400);
    expect((await post({ action: 'lock', jobId: '00000000-aaaa-bbbb-cccc-000000000000' })).status).toBe(404);
    await addCandidate('job-aaaa-0001');
    expect((await post({ action: 'lock', jobId: 'job-aaaa-0001' })).status).toBe(200);
    const body = await (await GET()).json();
    expect(body.anchor.imageJobId).toBe('job-aaaa-0001');
    expect(body.candidates).toHaveLength(1);

    const file = await import('@/app/api/launch/anchor/[file]/route');
    const ctx = (f: string) => ({ params: Promise.resolve({ file: f }) });
    expect((await file.GET(new Request('http://x'), ctx('portrait.png'))).status).toBe(200);
    expect((await file.GET(new Request('http://x'), ctx('job-aaaa-0001.png'))).status).toBe(200);
    expect((await file.GET(new Request('http://x'), ctx('..%2Fx.png'))).status).toBe(400);
    expect((await file.GET(new Request('http://x'), ctx('job-zzzz-9999.png'))).status).toBe(404);
  });
});
