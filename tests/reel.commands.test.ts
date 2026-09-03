import { describe, it, expect, beforeEach } from 'vitest';
import { mkdtempSync } from 'fs';
import { tmpdir } from 'os';
import path from 'path';

/**
 * The command registry is the single write path. Everything here is about the
 * guarantees the studio and an agent both rely on: named ops, validated args,
 * a valid reel on disk, a history entry, and a broadcast — or none of it.
 */

beforeEach(async () => {
  process.env.IOLAR_DATA_DIR = mkdtempSync(path.join(tmpdir(), 'reel-commands-'));
  (await import('@/lib/reel/bus')).resetBus();
});

const clip = (id: string, assetId: string, start: number, end: number) => ({
  id,
  assetId,
  start,
  end,
  srcIn: 0,
  fit: 'cover' as const,
  motion: { type: 'zoom-in' as const, strength: 0.12, origin: [0.5, 0.4] as [number, number] },
  transition: 'cut' as const,
  locked: false,
});

async function seed() {
  const { validateReel, emptyReel } = await import('@/lib/reel/schema');
  const { saveReel } = await import('@/lib/reel/store');
  const reel = validateReel({
    ...emptyReel('grok'),
    title: 'Grok',
    style: 'armand',
    vo: { durationSec: 12 },
    assets: [
      { id: 'a1', kind: 'video', path: 'assets/a1.mp4', origin: 'plugin', status: 'ready' },
      { id: 'a2', kind: 'video', path: 'assets/a2.mp4', origin: 'plugin', status: 'ready' },
    ],
    timeline: {
      clips: [clip('c1', 'a1', 0, 4), clip('c2', 'a2', 4, 9)],
      captions: [
        { id: 'k1', text: 'just launched today', start: 0.5, end: 1.4 },
        { id: 'k2', text: 'and it works', start: 1.4, end: 2.6 },
      ],
      overlays: [],
    },
  });
  await saveReel('grok', reel);
  return reel;
}

describe('command registry', () => {
  it('has exactly one command per editing function, so the two files cannot drift', async () => {
    const { COMMANDS } = await import('@/lib/reel/commands');
    const edits = await import('@/lib/reel/edits');

    const editFns = Object.entries(edits)
      .filter(([name, v]) => typeof v === 'function' && name !== 'reflow')
      .map(([name]) => name)
      .sort();
    const wired = Object.values(COMMANDS)
      .map((c) => c.fn)
      .sort();

    expect(wired).toEqual(editFns);
  });
});

describe('applyCommand', () => {
  it('applies the edit and persists the result', async () => {
    const { applyCommand } = await import('@/lib/reel/commands');
    const { loadReel } = await import('@/lib/reel/store');
    await seed();

    const { reel } = await applyCommand('grok', {
      op: 'beat.text',
      args: { beatId: 'b1', text: 'a rewritten opening line' },
      actor: 'agent',
    });

    expect(reel.beats.find((b) => b.id === 'b1')!.text).toBe('a rewritten opening line');
    expect((await loadReel('grok')).beats.find((b) => b.id === 'b1')!.text).toBe('a rewritten opening line');
  });

  it('records the command in history with its actor and a readable summary', async () => {
    const { applyCommand } = await import('@/lib/reel/commands');
    const history = await import('@/lib/reel/history');
    await seed();

    await applyCommand('grok', {
      op: 'beat.text',
      args: { beatId: 'b1', text: 'a rewritten opening line' },
      actor: 'agent',
    });
    const log = await history.read('grok');

    expect(log.entries).toHaveLength(1);
    expect(log.entries[0].actor).toBe('agent');
    expect(log.entries[0].summary).toMatch(/b1/);
  });

  it('broadcasts the saved reel so an open studio tab updates', async () => {
    const { applyCommand } = await import('@/lib/reel/commands');
    const { subscribe } = await import('@/lib/reel/bus');
    await seed();
    const seen: string[] = [];
    subscribe('grok', (r) => seen.push(r.beats.find((b) => b.id === 'b1')!.text));

    await applyCommand('grok', {
      op: 'beat.text',
      args: { beatId: 'b1', text: 'the line the tab should see' },
      actor: 'ui',
    });

    expect(seen).toEqual(['the line the tab should see']);
  });

  it('refuses an unknown op and names the valid ones', async () => {
    const { applyCommand, CommandError } = await import('@/lib/reel/commands');
    await seed();

    const err = await applyCommand('grok', { op: 'clip.explode', args: {}, actor: 'ui' }).catch((e) => e);

    expect(err).toBeInstanceOf(CommandError);
    expect(err.status).toBe(400);
    expect(err.detail.validOps).toContain('beat.text');
  });

  it('refuses arguments the op does not accept', async () => {
    const { applyCommand } = await import('@/lib/reel/commands');
    await seed();

    const err = await applyCommand('grok', {
      op: 'beat.text',
      args: { clipId: 'c1', edge: 'sideways', deltaSec: -0.5 },
      actor: 'ui',
    }).catch((e) => e);

    expect(err.status).toBe(400);
    expect(err.detail.schema).toBeDefined();
  });



  it('leaves the reel, the history and the bus untouched when a command fails', async () => {
    const { applyCommand } = await import('@/lib/reel/commands');
    const { loadReel } = await import('@/lib/reel/store');
    const { subscribe } = await import('@/lib/reel/bus');
    const history = await import('@/lib/reel/history');
    const before = await seed();
    const seen: unknown[] = [];
    subscribe('grok', (r) => seen.push(r));

    await applyCommand('grok', { op: 'beat.text', args: { clipId: 'c99' }, actor: 'agent' }).catch(() => {});

    expect(await loadReel('grok')).toEqual(before);
    expect((await history.read('grok')).entries).toEqual([]);
    expect(seen).toEqual([]);
  });

  it('reports a missing reel rather than creating one', async () => {
    const { applyCommand } = await import('@/lib/reel/commands');

    const err = await applyCommand('no-such-reel', {
      op: 'beat.text',
      args: { clipId: 'c1' },
      actor: 'agent',
    }).catch((e) => e);

    expect(err.status).toBe(404);
  });



});
