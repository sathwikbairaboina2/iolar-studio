import { describe, it, expect } from 'vitest';

describe('reel schema', () => {
  it('fills defaults for a minimal reel', async () => {
    const { validateReel } = await import('@/lib/reel/schema');
    const r = validateReel({
      pattern: 'armand',
      title: 'Grok Bot',
      beats: [{ id: 'b1', role: 'hook', text: 'xAI just dropped Grok Bot.', shot: { kind: 'title', brief: 'stage b-roll' } }],
    });
    expect(r.ratio).toBe('9:16');
    expect(r.fps).toBe(30);
    expect(r.brand).toBe('iolar');
    expect(r.beats[0].shot.hero).toBe(false);
    expect(r.timeline.clips).toEqual([]);
    expect(r.assets).toEqual([]);
  });

  it('rejects a beat with an unknown shot kind', async () => {
    const { validateReel } = await import('@/lib/reel/schema');
    expect(() =>
      validateReel({
        pattern: 'armand',
        title: 't',
        beats: [{ id: 'b1', role: 'hook', text: 'x', shot: { kind: 'explosion', brief: '' } }],
      })
    ).toThrow();
  });

  it('rejects a clip whose end is not after its start', async () => {
    const { validateReel } = await import('@/lib/reel/schema');
    expect(() =>
      validateReel({
        pattern: 'armand',
        title: 't',
        beats: [{ id: 'b1', role: 'hook', text: 'x', shot: { kind: 'broll', brief: '' } }],
        timeline: { clips: [{ id: 'c1', assetId: 'a1', start: 4, end: 4, srcIn: 0 }] },
      })
    ).toThrow();
  });

  it('exposes 9:16 as 1080x1920', async () => {
    const { REEL_RATIOS } = await import('@/lib/reel/schema');
    expect(REEL_RATIOS['9:16']).toEqual([1080, 1920]);
  });

  it('emptyReel builds a valid draft from a slug', async () => {
    const { emptyReel } = await import('@/lib/reel/schema');
    const r = emptyReel('grok-bot');
    expect(r.title).toBe('grok bot');
    expect(r.beats).toHaveLength(1);
    expect(r.vo.words).toEqual([]);
  });
});
