import { mkdtempSync, promises as fs } from 'fs';
import os from 'os';
import path from 'path';
import { beforeEach, describe, expect, it } from 'vitest';
import type { LaunchProps } from '@/lib/launch/edit';
import { launchHash, launchRenderCommand, launchWorkspace, renderLaunch, syncLaunchIn } from '@/lib/launch/render';
import { launchAssetsDir, launchRendersDir, launchRoot, launchVoiceDir } from '@/lib/paths';

const props: LaunchProps = {
  slug: 'gemini-4', fps: 30, width: 1080, height: 1920, totalFrames: 120, date: '21.10.26', bed: null, emphasis: [],
  timing: { fps: 30, totalFrames: 120, beats: [{ id: 'hook', start: 0, end: 120 }] },
  scenes: [{ type: 'Receipt', from: 0, to: 120, image: 'launch/gemini-4/receipt-c3.png', width: 1080, height: 1350, focus: [{ x: 1, y: 2, w: 3, h: 4 }], source: 'blog.google' }],
};

let root: string;
beforeEach(async () => {
  process.env.IOLAR_DATA_DIR = mkdtempSync(path.join(os.tmpdir(), 'launch-rd-'));
  root = mkdtempSync(path.join(os.tmpdir(), 'launch-rr-'));
  await fs.mkdir(launchVoiceDir('gemini-4'), { recursive: true });
  await fs.mkdir(launchAssetsDir('gemini-4'), { recursive: true });
  await fs.writeFile(path.join(launchVoiceDir('gemini-4'), 'hook.mp3'), 'voice');
  await fs.writeFile(path.join(launchAssetsDir('gemini-4'), 'receipt-c3.png'), 'png3');
  await fs.writeFile(path.join(launchAssetsDir('gemini-4'), 'receipt-c9.png'), 'png9');
});

describe('launch render', () => {
  it('copies the voice and the receipts the props use, and writes props.json', async () => {
    await syncLaunchIn('gemini-4', props, root);
    const w = launchWorkspace(root, 'gemini-4');
    expect((await fs.readdir(w.publicDir)).sort()).toEqual(['hook.mp3', 'receipt-c3.png']);
    expect(JSON.parse(await fs.readFile(w.propsFile, 'utf8')).slug).toBe('gemini-4');
  });
  it('builds the render command for the launch-reel composition with the props file', () => {
    expect(launchRenderCommand('C:/r/out/launch/g/props.json', 'out/launch/g/abc.mp4').args).toEqual(['remotion', 'render', 'src/index.ts', 'launch-reel', 'out/launch/g/abc.mp4', '--props=C:/r/out/launch/g/props.json', '--codec=h264']);
  });
  it('renders, then copies the mp4 and a cover into renders/', async () => {
    const calls: string[][] = [];
    const proc = async (_c: string, args: string[]) => {
      calls.push(args);
      await fs.mkdir(path.dirname(path.resolve(root, args[4])), { recursive: true });
      await fs.writeFile(path.resolve(root, args[4]), 'x');
      return { code: 0, output: '' };
    };
    const id = await renderLaunch('gemini-4', props, { proc, root });
    expect(id).toMatch(/^[0-9a-f]{12}$/);
    expect(await fs.readdir(launchRendersDir('gemini-4'))).toEqual(expect.arrayContaining([`${id}.mp4`, 'cover.png']));
    expect(calls.map((a) => a[1])).toEqual(['render', 'still']);
  });
  it('changes the render id when a scene file or the captions change', async () => {
    await fs.mkdir(path.join(root, 'src', 'launch', 'scenes'), { recursive: true });
    await fs.mkdir(path.join(root, 'src', 'designed', 'kit'), { recursive: true });
    await fs.writeFile(path.join(root, 'src', 'launch', 'scenes', 'Receipt.tsx'), 'a');
    await fs.writeFile(path.join(root, 'src', 'designed', 'kit', 'captions.ts'), 'c');
    const a = await launchHash(props, launchVoiceDir('gemini-4'), root);
    expect(await launchHash(props, launchVoiceDir('gemini-4'), root)).toBe(a);
    await fs.writeFile(path.join(root, 'src', 'launch', 'scenes', 'Receipt.tsx'), 'b');
    const b = await launchHash(props, launchVoiceDir('gemini-4'), root);
    expect(b).not.toBe(a);
    await fs.writeFile(path.join(root, 'src', 'designed', 'kit', 'captions.ts'), 'd');
    expect(await launchHash(props, launchVoiceDir('gemini-4'), root)).not.toBe(b);
  });
  it('fails with the tail of the output when the render command fails', async () => {
    const proc = async () => ({ code: 1, output: 'boom: no such composition' });
    await expect(renderLaunch('gemini-4', props, { proc, root })).rejects.toThrow(/render failed.*no such composition/);
  });
});

describe('launch render, anchor scenes', () => {
  it('copies the avatar clip, the receipt over it, the portrait, b-roll and demo clip', async () => {
    const assets = launchAssetsDir('gemini-4');
    for (const f of ['avatar-3.mp4', 'broll-0.png', 'demo-1.mp4']) await fs.writeFile(path.join(assets, f), f);
    await fs.mkdir(path.join(launchRoot(), 'anchor'), { recursive: true });
    await fs.writeFile(path.join(launchRoot(), 'anchor.json'), JSON.stringify({ imageJobId: 'img-job-1', file: 'anchor/portrait.png', prompt: 'p', lockedAt: 'x' }));
    await fs.writeFile(path.join(launchRoot(), 'anchor/portrait.png'), 'face');
    const rich: LaunchProps = {
      ...props,
      timing: { fps: 30, totalFrames: 120, beats: [{ id: 'hook', start: 0, end: 120 }] },
      scenes: [
        { type: 'BRoll', from: 0, to: 30, image: 'launch/gemini-4/broll-0.png' },
        { type: 'DemoClip', from: 30, to: 60, video: 'launch/gemini-4/demo-1.mp4', credit: 'Google' },
        { type: 'PostCard', from: 60, to: 90, author: 'A', handle: '@a', date: 'today', text: 't' },
        { type: 'AvatarTalk', from: 90, to: 120, layout: 'columnist', video: 'launch/gemini-4/avatar-3.mp4', portrait: 'launch/gemini-4/anchor.png', receipt: { image: 'launch/gemini-4/receipt-c3.png', width: 1080, height: 1350, focus: [{ x: 1, y: 2, w: 3, h: 4 }], source: 'blog.google' } },
      ],
    };
    await syncLaunchIn('gemini-4', rich, root);
    expect((await fs.readdir(launchWorkspace(root, 'gemini-4').publicDir)).sort()).toEqual(['anchor.png', 'avatar-3.mp4', 'broll-0.png', 'demo-1.mp4', 'hook.mp3', 'receipt-c3.png']);
    expect(await fs.readFile(path.join(launchWorkspace(root, 'gemini-4').publicDir, 'anchor.png'), 'utf8')).toBe('face');
  });
});
