import { mkdtempSync, promises as fs } from 'fs';
import os from 'os';
import path from 'path';
import { beforeEach, describe, expect, it } from 'vitest';

/**
 * A poster is the still the shelf shows for an explainer.
 *
 * It is taken late in the clip on purpose: an explainer opens on a board that is still fading in
 * and fills up as its beats mutate it, so frame 0 is the emptiest picture the reel ever has.
 */

const load = async () => {
  const poster = await import('@/lib/explainer/poster');
  const paths = await import('@/lib/paths');
  return { poster, paths };
};

beforeEach(() => {
  process.env.IOLAR_DATA_DIR = mkdtempSync(path.join(os.tmpdir(), 'explainer-poster-'));
});

describe('when in the clip the poster is taken', () => {
  it('takes it late, where the board is fullest', async () => {
    const { poster } = await load();
    expect(poster.posterTime(20)).toBeCloseTo(15, 5);
  });

  it('stays inside a clip too short to have a three quarter mark worth seeking to', async () => {
    const { poster } = await load();
    expect(poster.posterTime(0.4)).toBeLessThan(0.4);
    expect(poster.posterTime(0.4)).toBeGreaterThanOrEqual(0);
  });

  it('asks for frame zero rather than a negative seek when the duration is unknown', async () => {
    const { poster } = await load();
    expect(poster.posterTime(0)).toBe(0);
    expect(poster.posterTime(Number.NaN)).toBe(0);
  });
});

describe('writing a poster', () => {
  it('puts a jpg beside the mp4 it was taken from', async () => {
    const { poster, paths } = await load();
    const { makeTestClip } = await import('@/lib/reel/probe');

    const mp4 = paths.explainerRenderMp4('a-slug', 'job1');
    await fs.mkdir(path.dirname(mp4), { recursive: true });
    await makeTestClip(mp4, { seconds: 2, width: 216, height: 384, fps: 10, audio: false });

    const out = await poster.write('a-slug', 'job1');

    expect(out).toBe(paths.explainerRenderPoster('a-slug', 'job1'));
    const stat = await fs.stat(out!);
    expect(stat.size).toBeGreaterThan(0);
  }, 60_000);

  it('answers null instead of throwing when there is no mp4 to read', async () => {
    const { poster } = await load();
    await expect(poster.write('a-slug', 'missing')).resolves.toBeNull();
  });
});

describe('finding the poster for an explainer', () => {
  it('reports one that exists and does not invent one that does not', async () => {
    const { poster, paths } = await load();
    const jpg = paths.explainerRenderPoster('a-slug', 'job1');
    await fs.mkdir(path.dirname(jpg), { recursive: true });
    await fs.writeFile(jpg, 'not really a jpeg');

    await expect(poster.has('a-slug', 'job1')).resolves.toBe(true);
    await expect(poster.has('a-slug', 'job2')).resolves.toBe(false);
  });
});
