import { mkdtempSync, promises as fs } from 'fs';
import os from 'os';
import path from 'path';
import { beforeEach, describe, expect, it } from 'vitest';
import { clipPlan, makeAvatarClips, voiceSlice } from '@/lib/launch/avatar';
import { HfUnreachable } from '@/lib/launch/higgsfield';
import { createLaunch } from '@/lib/launch/store';
import { launchAssetsDir, launchVoiceDir } from '@/lib/paths';

const timing = { fps: 30, totalFrames: 1200, beats: [
  { id: 'hook', start: 0, end: 150, voice: 140 },
  { id: 'what', start: 150, end: 600, voice: 430 },
  { id: 'catch', start: 600, end: 1200, voice: 590 },
] };
type VideoParams = { duration: number; medias: { role: string; value: string }[]; resolution: string; model: string; aspect_ratio: string };
const anchor = { imageJobId: 'img-job-1', file: 'anchor/portrait.png', prompt: 'p', lockedAt: 'x' };

let slug: string;
let ffmpegCalls: string[][];
const proc = async (_cmd: string, args: string[]) => {
  ffmpegCalls.push(args);
  const out = args[args.length - 1];
  await fs.mkdir(path.dirname(out), { recursive: true });
  await fs.writeFile(out, 'media');
  return { code: 0, output: '' };
};

/** A fake Higgsfield: records every call in order; `skipAt` makes that submission fall over the budget. */
function fakeHf(over: { failJob?: string; unreachable?: boolean } = {}) {
  const log: string[] = [];
  let n = 0;
  const hf = {
    balance: async () => 500,
    cost: async () => { if (over.unreachable) throw new HfUnreachable(); return 30; },
    uploadFile: async (f: string) => { log.push('upload'); return `media-${path.basename(f)}`; },
    generateVideo: async (p: VideoParams) => { log.push(`submit ${p.duration} ${p.resolution}`); return `job-${n++}`; },
    generateImage: async () => 'x',
    generateAudio: async () => 'a',
    wait: async (ids: string[]) => { log.push(`wait ${ids.length}`); return Object.fromEntries(ids.map((id) => [id, id === over.failJob ? { status: 'failed' as const } : { status: 'completed' as const, url: `https://cdn/${id}.mp4` }])); },
  };
  return { hf, log };
}
const http = (async (u: string) => new Response(`video ${u}`)) as unknown as typeof fetch;
const lipsync = (available: boolean) => {
  const calls: unknown[] = [];
  return {
    calls,
    p: {
      name: 'lipsync', available: async () => available,
      animate: async (req: unknown) => { calls.push(req); return { jobId: 'L1' }; },
      jobState: async () => 'ready' as const,
      collect: async (_id: string, dest: string) => { await fs.writeFile(dest, 'lip'); },
    },
  };
};

beforeEach(async () => {
  process.env.IOLAR_DATA_DIR = mkdtempSync(path.join(os.tmpdir(), 'launch-avatar-'));
  ffmpegCalls = [];
  slug = await createLaunch({ title: 'Gemini 4', links: ['https://blog.google/x'], mode: 'avatar', creditBudget: 120 });
  await fs.mkdir(launchVoiceDir(slug), { recursive: true });
  for (const b of timing.beats) await fs.writeFile(path.join(launchVoiceDir(slug), `${b.id}.mp3`), 'mp3');
});

describe('clipPlan', () => {
  it('is one clip up to 15 s and equal parts of at most 15 s beyond', () => {
    expect(clipPlan(300)).toEqual([10]);
    expect(clipPlan(450)).toEqual([15]);
    expect(clipPlan(1020)).toEqual([11.33, 11.33, 11.34]);
    expect(clipPlan(960)).toEqual([10.67, 10.67, 10.66]);
  });
});

describe('voiceSlice', () => {
  it('delays each overlapping beat clip to its start and trims to the scene', async () => {
    await voiceSlice(slug, timing, 100, 300, path.join(launchAssetsDir(slug), 'slice.mp3'), proc);
    const out = path.join(launchAssetsDir(slug), 'slice.mp3');
    // the filter graph is in a file beside the output (a shell on Windows would mangle | and [ ] in an argument)
    const args = ffmpegCalls[0].join(' ') + ' ' + (await fs.readFile(`${out}.filter.txt`, 'utf8'));
    expect(args).toContain('hook.mp3');
    expect(args).toContain('what.mp3');
    expect(args).not.toContain('catch.mp3');
    // both are placed at their beat start on the reel's timeline (0 and 5000 ms); atrim then cuts the scene out
    expect(args).toMatch(/adelay=0\|0/);
    expect(args).toMatch(/adelay=5000\|5000/);
    expect(args).toMatch(/atrim=start=3\.333/);
    expect(args).toMatch(/end=10(\.0+)?/);
    expect(ffmpegCalls[0].at(-1)).toMatch(/slice\.mp3$/);
  });
});

describe('makeAvatarClips', () => {
  const scenes = [
    { id: 's1', from: 150, to: 450, layout: 'columnist' as const },
    { id: 's2', from: 600, to: 900, layout: 'photo' as const },
  ];

  it('uploads and submits every part of every scene before it waits once', async () => {
    const { hf, log } = fakeHf();
    const out = await makeAvatarClips(slug, scenes, { hf, lipsync: null, anchor, timing, proc, http });
    expect(log).toEqual(['upload', 'upload', 'submit 10 720p', 'submit 10 720p', 'wait 2']);
    expect(out.s1).toEqual({ file: 'avatar-s1.mp4', source: 'higgsfield' });
    expect(out.s2.source).toBe('higgsfield');
    expect((await fs.readFile(path.join(launchAssetsDir(slug), 'avatar-s1.mp4'), 'utf8'))).toBe('media');
  });

  it('splits an avatar scene longer than 15 s and joins the parts', async () => {
    const { hf, log } = fakeHf();
    const out = await makeAvatarClips(slug, [{ id: 'long', from: 0, to: 1020, layout: 'columnist' }], { hf, lipsync: null, anchor, timing, proc, http });
    expect(log.filter((l) => l.startsWith('submit'))).toEqual(['submit 12 720p', 'submit 12 720p', 'submit 12 720p']);
    expect(out.long.source).toBe('higgsfield');
    expect(ffmpegCalls.some((a) => a.includes('concat'))).toBe(true);
  });

  it('sends the locked portrait and the voice slice as references', async () => {
    const { hf } = fakeHf();
    let params: VideoParams | undefined;
    hf.generateVideo = async (p: VideoParams) => { params = p; return 'job-x'; };
    await makeAvatarClips(slug, [scenes[0]], { hf, lipsync: null, anchor, timing, proc, http });
    expect(params).toMatchObject({ model: 'wan2_7', resolution: '720p', aspect_ratio: '9:16' });
    expect(params!.medias).toEqual([{ role: 'start_image', value: 'img-job-1' }, { role: 'audio_references', value: 'media-avatar-s1.mp3' }]);
  });

  it('prefers an uploaded start image over the job id', async () => {
    const { hf } = fakeHf();
    let params: VideoParams | undefined;
    hf.generateVideo = async (p: VideoParams) => { params = p; return 'job-x'; };
    await makeAvatarClips(slug, [scenes[0]], { hf, lipsync: null, anchor: { ...anchor, startImage: 'media-face' }, timing, proc, http });
    expect(params!.medias[0]).toEqual({ role: 'start_image', value: 'media-face' });
  });

  it('keeps durations within the 2 to 15 s Wan allows', async () => {
    const { hf } = fakeHf();
    const durations: number[] = [];
    hf.generateVideo = async (p: VideoParams) => { durations.push(p.duration); return `job-${durations.length}`; };
    await makeAvatarClips(slug, [{ id: 'tiny', from: 0, to: 30, layout: 'photo' }, { id: 'big', from: 0, to: 450, layout: 'photo' }], { hf, lipsync: null, anchor, timing, proc, http });
    expect(durations).toEqual([2, 15]);
  });

  it('falls back to lipsync for a scene whose part failed, keeping the other scene', async () => {
    const { hf } = fakeHf({ failJob: 'job-1' });
    const lip = lipsync(true);
    const out = await makeAvatarClips(slug, scenes, { hf, lipsync: lip.p, anchor, timing, proc, http });
    expect(out.s1.source).toBe('higgsfield');
    expect(out.s2).toEqual({ file: 'avatar-s2.mp4', source: 'lipsync' });
    expect(lip.calls[0]).toMatchObject({ seconds: 10, fps: 30, ratio: '9:16' });
    expect((lip.calls[0] as { imagePath: string }).imagePath).toMatch(/portrait\.png$/);
  });

  it('uses the still portrait when lipsync is not available either', async () => {
    const { hf } = fakeHf({ failJob: 'job-0' });
    const out = await makeAvatarClips(slug, [scenes[0]], { hf, lipsync: lipsync(false).p, anchor, timing, proc, http });
    expect(out.s1).toEqual({ file: '', source: 'still' });
  });

  it('takes the fallback for every scene, once, when Higgsfield is not reachable', async () => {
    const { hf } = fakeHf({ unreachable: true });
    const notes: string[] = [];
    const out = await makeAvatarClips(slug, scenes, { hf, lipsync: null, anchor, timing, proc, http, note: (n) => notes.push(n) });
    expect(Object.values(out).map((o) => o.source)).toEqual(['still', 'still']);
    expect(notes).toEqual(['Higgsfield is not reachable from the studio']);
  });

  it('skips a part that would pass the budget and falls that scene back', async () => {
    const { hf } = fakeHf();
    hf.cost = async () => 70;
    const out = await makeAvatarClips(slug, scenes, { hf, lipsync: null, anchor, timing, proc, http });
    expect(out.s1.source).toBe('higgsfield');
    expect(out.s2.source).toBe('still');
  });
});
