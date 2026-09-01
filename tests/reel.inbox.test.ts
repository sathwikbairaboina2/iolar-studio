import { describe, it, expect, vi, beforeEach } from 'vitest';
import { mkdtempSync, promises as fs } from 'fs';
import { tmpdir } from 'os';
import path from 'path';

/**
 * A folder per beat, for the footage you already have.
 *
 * Dropping files through the browser one at a time is fine for one shot and miserable for
 * fifteen. The inbox is a plain folder: fill it from Explorer, then adopt what you want.
 */

beforeEach(() => {
  vi.resetModules();
  process.env.IOLAR_DATA_DIR = mkdtempSync(path.join(tmpdir(), 'reel-inbox-'));
});

async function seed(slug = 'grok') {
  const { createReel, loadReel, saveReel } = await import('@/lib/reel/store');
  await createReel(slug);
  const reel = await loadReel(slug);
  await saveReel(slug, {
    ...reel,
    beats: [
      { id: 'b1', role: 'hook', text: 'one two', shot: { kind: 'talking-head', brief: 'to camera', hero: false, alsoAssetIds: [], sourceLineId: null } },
      { id: 'b2', role: 'close', text: 'three four', shot: { kind: 'screen', brief: 'chat ui', hero: false, alsoAssetIds: [], sourceLineId: null } },
    ],
  });
  return loadReel(slug);
}

async function drop(slug: string, beatId: string, name: string, bytes = Buffer.from([1, 2, 3])) {
  const { beatInboxDir } = await import('@/lib/paths');
  const dir = beatInboxDir(slug, beatId);
  await fs.mkdir(dir, { recursive: true });
  await fs.writeFile(path.join(dir, name), bytes);
  return path.join(dir, name);
}

describe('the beat inbox', () => {
  it('makes a folder per beat and says where it is', async () => {
    await seed();
    const { openInbox } = await import('@/lib/reel/inbox');

    const boxes = await openInbox('grok');

    expect(boxes.map((b) => b.beatId)).toEqual(['b1', 'b2']);
    for (const box of boxes) {
      expect(box.dir).toContain('inbox');
      expect((await fs.stat(box.dir)).isDirectory()).toBe(true);
      expect(box.files).toEqual([]);
    }
  });

  it('lists what was dropped in, with sizes and what kind of file it is', async () => {
    await seed();
    await drop('grok', 'b1', 'take-one.mp4', Buffer.alloc(2048));
    await drop('grok', 'b1', 'frame.png');
    await drop('grok', 'b1', 'notes.txt');
    const { openInbox } = await import('@/lib/reel/inbox');

    const b1 = (await openInbox('grok')).find((b) => b.beatId === 'b1')!;

    expect(b1.files.map((f) => f.name).sort()).toEqual(['frame.png', 'take-one.mp4']);
    expect(b1.files.find((f) => f.name === 'take-one.mp4')).toMatchObject({ kind: 'video', bytes: 2048 });
    expect(b1.files.find((f) => f.name === 'frame.png')).toMatchObject({ kind: 'image' });
  });

  it('adopts a dropped file as that beat’s shot, leaving the original where it was', async () => {
    await seed();
    const dropped = await drop('grok', 'b1', 'take-one.mp4', Buffer.alloc(64));
    const { adoptFromInbox } = await import('@/lib/reel/inbox');

    const reel = await adoptFromInbox('grok', 'b1', 'take-one.mp4', 'shot');

    const beat = reel.beats.find((b) => b.id === 'b1')!;
    expect(beat.shot.assetId).toBeTruthy();
    const asset = reel.assets.find((a) => a.id === beat.shot.assetId)!;
    expect(asset).toMatchObject({ origin: 'user', status: 'ready', kind: 'video' });
    // The inbox is yours; adopting copies out of it rather than eating it.
    expect((await fs.stat(dropped)).size).toBe(64);
  });

  it('refuses a name that climbs out of the beat folder', async () => {
    await seed();
    const { adoptFromInbox } = await import('@/lib/reel/inbox');
    await expect(adoptFromInbox('grok', 'b1', '../../reel.json', 'shot')).rejects.toThrow(/name/i);
    await expect(adoptFromInbox('grok', 'b1', 'sub/file.mp4', 'shot')).rejects.toThrow(/name/i);
  });

  it('refuses a file that is not there', async () => {
    await seed();
    const { adoptFromInbox } = await import('@/lib/reel/inbox');
    await expect(adoptFromInbox('grok', 'b1', 'ghost.mp4', 'shot')).rejects.toThrow(/ghost\.mp4/);
  });

  it('refuses a beat the reel does not have', async () => {
    await seed();
    const { adoptFromInbox } = await import('@/lib/reel/inbox');
    await expect(adoptFromInbox('grok', 'b9', 'x.mp4', 'shot')).rejects.toThrow(/b9/);
  });

  it('takes a still as a still, which leaves the beat free to be animated from it', async () => {
    await seed();
    await drop('grok', 'b2', 'ui.png');
    const { adoptFromInbox } = await import('@/lib/reel/inbox');

    const reel = await adoptFromInbox('grok', 'b2', 'ui.png', 'still');

    const asset = reel.assets.at(-1)!;
    expect(asset.kind).toBe('image');
    expect(reel.beats.find((b) => b.id === 'b2')!.shot.assetId).toBeFalsy();
  });
});
