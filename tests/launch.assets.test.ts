import { mkdtempSync, promises as fs } from 'fs';
import os from 'os';
import path from 'path';
import { beforeEach, describe, expect, it } from 'vitest';
import { dropAsset, makeAssets, parseOembed } from '@/lib/launch/assets';
import { HfUnreachable, type Hf } from '@/lib/launch/higgsfield';
import { createLaunch, readAssets, readBrief } from '@/lib/launch/store';
import { readSpend } from '@/lib/launch/spend';
import { launchAssetsDir, launchRoot, launchVoiceDir } from '@/lib/paths';
import type { EditInput } from '@/lib/launch/edit';

const timing = { fps: 30, totalFrames: 300, beats: [
  { id: 'hook', start: 0, end: 60, voice: 55 }, { id: 'numbers', start: 60, end: 180, voice: 110 }, { id: 'catch', start: 180, end: 255, voice: 70 }, { id: 'cta', start: 255, end: 300, voice: 40 },
] };
const anchorJson = { imageJobId: 'img-job-1', file: 'anchor/portrait.png', prompt: 'p', lockedAt: 'x' };
const input: EditInput = { scenes: [
  { type: 'BRoll', beat: 'hook', weight: 1, prompt: 'A server room at dusk', kicker: 'BREAKING', title: 'Gemini 4' },
  { type: 'DemoClip', beat: 'numbers', weight: 1, clip: 'demo-1', credit: 'Google' },
  { type: 'PostCard', beat: 'numbers', weight: 1, post: 'post-1' },
  { type: 'AvatarTalk', beat: 'catch', weight: 1, layout: 'photo' },
  { type: 'EndCard', beat: 'cta', weight: 1, line: 'Follow' },
] };

let slug: string;
let procCalls: string[][];
const proc = async (c: string, args: string[]) => {
  procCalls.push(args);
  if (c === 'ffprobe') return { code: 0, output: '480x854' };
  const out = args[args.length - 1];
  await fs.mkdir(path.dirname(out), { recursive: true });
  await fs.writeFile(out, 'media');
  return { code: 0, output: '' };
};

const OEMBED = { author_name: 'Google', author_url: 'https://twitter.com/Google', html: '<blockquote class="twitter-tweet"><p lang="en" dir="ltr">Gemini 4 is here &amp; it is fast. <a href="https://t.co/abc">https://t.co/abc</a></p>&mdash; Google (@Google) <a href="https://twitter.com/Google/status/1?ref_src=twsrc%5Etfw">October 21, 2026</a></blockquote>' };

function fakeHttp(over: { demoType?: string; oembedStatus?: number } = {}) {
  const urls: string[] = [];
  const http = (async (u: string) => {
    urls.push(u);
    if (u.startsWith('https://publish.twitter.com/oembed')) return over.oembedStatus ? new Response('gone', { status: over.oembedStatus }) : Response.json(OEMBED);
    if (u === 'https://x.dev/demo.mp4') return new Response('video', { headers: { 'content-type': over.demoType ?? 'video/mp4' } });
    return new Response('png-bytes', { headers: { 'content-type': 'image/png' } });
  }) as unknown as typeof fetch;
  return { http, urls };
}

function fakeHf(over: { unreachable?: boolean; cost?: number } = {}) {
  const log: string[] = [];
  let n = 0;
  const hf: Hf = {
    balance: async () => 400,
    cost: async () => { if (over.unreachable) throw new HfUnreachable(); return over.cost ?? 0.5; },
    uploadFile: async () => 'media-1',
    generateVideo: async () => { log.push('video'); return `v-${n++}`; },
    generateImage: async (p) => { log.push(`image ${(p as { prompt: string }).prompt}`); return `i-${n++}`; },
    generateAudio: async () => 'a',
    wait: async (ids) => Object.fromEntries(ids.map((id) => [id, { status: 'completed' as const, url: `https://cdn/${id}` }])),
  };
  return { hf, log };
}

beforeEach(async () => {
  process.env.IOLAR_DATA_DIR = mkdtempSync(path.join(os.tmpdir(), 'launch-assets-'));
  procCalls = [];
  slug = await createLaunch({ title: 'Gemini 4', links: ['https://blog.google/x'], mode: 'avatar', creditBudget: 120, demos: ['https://x.dev/demo.mp4'], posts: ['https://x.com/Google/status/1'] });
  await fs.mkdir(launchVoiceDir(slug), { recursive: true });
  for (const b of timing.beats) await fs.writeFile(path.join(launchVoiceDir(slug), `${b.id}.mp3`), 'mp3');
  await fs.mkdir(path.join(launchRoot(), 'anchor'), { recursive: true });
  await fs.writeFile(path.join(launchRoot(), 'anchor.json'), JSON.stringify(anchorJson));
  await fs.writeFile(path.join(launchRoot(), 'anchor/portrait.png'), 'face');
});

const run = async (deps: Partial<Parameters<typeof makeAssets>[4]> = {}) => {
  const brief = (await readBrief(slug))!;
  return makeAssets(slug, input, brief, timing, { proc, http: fakeHttp().http, hf: async () => fakeHf().hf, lipsync: null, ...deps });
};

describe('parseOembed', () => {
  it('takes the text, author, handle and date out of the embed html', () => {
    expect(parseOembed(OEMBED)).toEqual({ author: 'Google', handle: '@Google', date: 'October 21, 2026', text: 'Gemini 4 is here & it is fast.' });
  });
  it('returns null for an embed with no text', () => {
    expect(parseOembed({ author_name: 'A', author_url: 'https://x.com/a', html: '<blockquote></blockquote>' })).toBeNull();
  });
});

describe('makeAssets', () => {
  it('makes every kind and records each with its source', async () => {
    const out = await run();
    expect(out.assets['broll-0']).toMatchObject({ kind: 'broll', source: 'higgsfield', file: 'broll-0.mp4' });
    expect(out.assets['demo-1']).toMatchObject({ kind: 'demo', source: 'download', file: 'demo-1.mp4' });
    expect(out.assets['post-1']).toMatchObject({ kind: 'post', source: 'oembed', post: { handle: '@Google' } });
    expect(out.assets['avatar-3']).toMatchObject({ kind: 'avatar', source: 'higgsfield', file: 'avatar-3.mp4' });
    expect(await readAssets(slug)).toEqual(out);
    expect((await readSpend(slug))!.entries.length).toBeGreaterThan(1);
  });

  it('makes a nano banana still, then a kling clip from that still, with the creator style and the motion prompt', async () => {
    const f = fakeHf();
    const params: { image?: Record<string, unknown>; video?: Record<string, unknown> } = {};
    f.hf.generateImage = async (p: object) => { params.image = p as never; return 'still-1'; };
    f.hf.generateVideo = async (p: object) => { params.video = p as never; return 'clip-1'; };
    const out = await run({ hf: async () => f.hf });
    expect(params.image).toMatchObject({ model: 'nano_banana_pro', aspect_ratio: '9:16', resolution: '1k' });
    expect(String(params.image!.prompt)).toContain('A server room at dusk Cinematic, young Indian tech creator');
    expect(params.video).toMatchObject({ model: 'kling3_0', aspect_ratio: '9:16', duration: 3, mode: 'std', sound: 'off', medias: [{ role: 'start_image', value: 'still-1' }] });
    expect(String(params.video!.prompt)).toMatch(/push-in.*Photoreal, consistent objects, no cuts, no new text\.$/);
    expect(out.assets['broll-0']).toMatchObject({ source: 'higgsfield', file: 'broll-0.mp4' });
  });

  it('uses the scene motion, and keys the asset on it', async () => {
    const f = fakeHf();
    const prompts: string[] = [];
    f.hf.generateVideo = async (p) => { prompts.push(String((p as { prompt?: string }).prompt)); return 'clip-1'; };
    const brief = (await readBrief(slug))!;
    const withMotion: EditInput = { scenes: [{ type: 'BRoll', beat: 'hook', weight: 1, prompt: 'A phone on a desk', motion: 'Orbit left; screen glow flickers' }, input.scenes[4]] };
    const out = await makeAssets(slug, withMotion, brief, timing, { proc, http: fakeHttp().http, hf: async () => f.hf, lipsync: null });
    expect(prompts[0]).toMatch(/^Orbit left; screen glow flickers Photoreal/);
    expect(out.assets['broll-0'].key).toContain('Orbit left');
  });

  it('keeps the still as broll-i.png when the clip fails', async () => {
    const f = fakeHf();
    f.hf.generateVideo = async () => 'clip-bad';
    const wait = f.hf.wait;
    f.hf.wait = async (ids) => ({ ...(await wait(ids, 1)), ...(ids.includes('clip-bad') ? { 'clip-bad': { status: 'failed' as const } } : {}) });
    const out = await run({ hf: async () => f.hf });
    expect(out.assets['broll-0']).toMatchObject({ source: 'higgsfield', file: 'broll-0.png' });
  });

  it('swaps b-roll for a headline and falls the avatar back when Higgsfield is not reachable, saying so once', async () => {
    const out = await run({ hf: async () => fakeHf({ unreachable: true }).hf });
    expect(out.assets['broll-0']).toMatchObject({ source: 'swapped', file: '' });
    expect(out.assets['avatar-3']).toMatchObject({ source: 'still', file: '' });
    expect(out.notes).toEqual(['Higgsfield is not reachable from the studio']);
  });

  it('keeps the cause of an unreachable Higgsfield in the note', async () => {
    const f = fakeHf();
    f.hf.cost = async () => { throw new HfUnreachable('Higgsfield is not reachable from the studio (the CLI timed out)'); };
    f.hf.uploadFile = async () => { throw new HfUnreachable('Higgsfield is not reachable from the studio (the CLI timed out)'); };
    const out = await run({ hf: async () => f.hf });
    expect(out.notes).toEqual(['Higgsfield is not reachable from the studio (the CLI timed out)']);
  });

  it('tries a fallen-back avatar and swapped b-roll again on the next run, once Higgsfield answers', async () => {
    await run({ hf: async () => fakeHf({ unreachable: true }).hf });
    const out = await run({ hf: async () => fakeHf().hf });
    expect(out.assets['broll-0']).toMatchObject({ source: 'higgsfield' });
    expect(out.assets['avatar-3']).toMatchObject({ source: 'higgsfield', file: 'avatar-3.mp4' });
  });

  it('swaps b-roll that would pass the budget, with the reason', async () => {
    const out = await run({ hf: async () => fakeHf({ cost: 500 }).hf });
    expect(out.assets['broll-0']).toMatchObject({ source: 'swapped' });
    expect(out.assets['broll-0'].reason).toMatch(/budget/);
  });

  it('refuses a demo link that is not a video, and a post that X will not show', async () => {
    const out = await run({ http: fakeHttp({ demoType: 'text/html', oembedStatus: 404 }).http });
    expect(out.assets['demo-1']).toMatchObject({ source: 'refused' });
    expect(out.assets['demo-1'].reason).toMatch(/not a video/);
    expect(out.assets['post-1']).toMatchObject({ source: 'refused' });
    expect(out.assets['post-1'].reason).toMatch(/404/);
  });

  it('trims a demo clip to its scene, silent, and never past 8 seconds', async () => {
    await run();
    const trim = procCalls.find((a) => a.includes('-t') && a.some((x) => /demo-1\.mp4$/.test(x)))!;
    expect(trim[trim.indexOf('-t') + 1]).toBe('2');
    expect(trim).toContain('-an');
  });

  it('records the width and height of the trimmed demo clip', async () => {
    const out = await run();
    expect(out.assets['demo-1']).toMatchObject({ width: 480, height: 854 });
  });

  it('does not make a finished asset again, and makes it again once its file is dropped', async () => {
    const f = fakeHf();
    await run({ hf: async () => f.hf });
    const first = f.log.length;
    await run({ hf: async () => f.hf });
    expect(f.log.length).toBe(first);
    await dropAsset(slug, 'broll-0');
    expect((await readAssets(slug))!.assets['broll-0']).toBeUndefined();
    await expect(fs.access(path.join(launchAssetsDir(slug), 'broll-0.mp4'))).rejects.toThrow();
    await run({ hf: async () => f.hf });
    expect(f.log.filter((l) => l.startsWith('image'))).toHaveLength(2);
  });
});
