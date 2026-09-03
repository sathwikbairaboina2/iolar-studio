import { describe, it, expect } from 'vitest';

const PATTERN = {
  name: 'test',
  displayName: 'Test',
  caption: {
    font: 'Inter', weight: 800, sizeVh: 3.2, case: 'none' as const, fg: '#fff', pill: '#000',
    pillAlpha: 0.85, radiusVh: 0.9, padVh: [0.5, 1.1] as [number, number], yPct: 73,
    wordsPerBeat: [1, 3] as [number, number], maxChars: 22,
  },
  pacing: {
    shotSec: [3, 6] as [number, number],
    captionBeatSec: [0.4, 1.1] as [number, number],
    cutOnWordBoundary: true,
  },
  hook: { layout: 'title-over-broll', durationSec: 1.6, titleSizeVh: 6, logoLockup: true },
  shotMix: { talkingHead: 0.35, screen: 0.45, broll: 0.2, anchorEverySec: 10 },
  motion: { default: 'zoom-in', strength: 0.12 },
  transitions: ['cut', 'cut', 'crossfade'] as ('cut' | 'crossfade')[],
  voice: { rate: 1 },
  letterbox: { bg: '#ffffff' },
};

const WORDS = ['one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten', 'eleven', 'twelve']
  .map((w, i) => ({ w, start: i * 0.5, end: i * 0.5 + 0.45 }));

async function baseReel() {
  const { validateReel } = await import('@/lib/reel/schema');
  return validateReel({
    style: 'test',
    title: 'Test',
    seed: 42,
    beats: [
      { id: 'b1', role: 'hook', text: 'one two three four', shot: { kind: 'broll', brief: 'stage', assetId: 'a1' } },
      { id: 'b2', role: 'body', text: 'five six seven eight', shot: { kind: 'screen', brief: 'chat ui', assetId: 'a2' } },
      { id: 'b3', role: 'close', text: 'nine ten eleven twelve', shot: { kind: 'talking-head', brief: 'creator', assetId: 'a3' } },
    ],
    vo: { words: WORDS, durationSec: 6 },
    assets: [
      { id: 'a1', kind: 'video', path: 'assets/a1.mp4', origin: 'plugin', status: 'ready', durationSec: 5 },
      { id: 'a2', kind: 'video', path: 'assets/a2.mp4', origin: 'plugin', status: 'ready', durationSec: 5 },
      { id: 'a3', kind: 'video', path: 'assets/a3.mp4', origin: 'user', status: 'ready', durationSec: 5 },
    ],
  });
}

/** The same fixture, but every shot is a still — the case camera motion exists for. */
async function stillReel() {
  const reel = await baseReel();
  return {
    ...reel,
    assets: reel.assets.map((a) => ({ ...a, kind: 'image' as const, path: a.path.replace('.mp4', '.png') })),
  };
}

describe('assemble', () => {
  it('gives every beat a clip spanning its own words', async () => {
    const { assemble } = await import('@/lib/reel/assemble');
    const tl = assemble({ reel: await baseReel(), style: PATTERN });
    expect(tl.clips).toHaveLength(3);
    expect(tl.clips[0]).toMatchObject({ beatId: 'b1', assetId: 'a1', start: 0 });
    expect(tl.clips[0].end).toBeCloseTo(1.95, 2);
    expect(tl.clips[1]).toMatchObject({ beatId: 'b2', assetId: 'a2' });
    // The last clip is held to the end of the voiceover rather than stopping on its final
    // word, so the closing line never plays over black.
    expect(tl.clips[2].end).toBeCloseTo(6, 2);
  });

  it('leaves no gap and no overlap between clips', async () => {
    const { assemble } = await import('@/lib/reel/assemble');
    const tl = assemble({ reel: await baseReel(), style: PATTERN });
    for (let i = 1; i < tl.clips.length; i++) {
      expect(tl.clips[i].start).toBeCloseTo(tl.clips[i - 1].end, 3);
    }
  });


  it('adds a hook overlay for the style hook duration', async () => {
    const { assemble } = await import('@/lib/reel/assemble');
    const tl = assemble({ reel: await baseReel(), style: PATTERN });
    expect(tl.overlays).toHaveLength(1);
    expect(tl.overlays[0]).toMatchObject({ kind: 'hook-title', start: 0 });
    expect(tl.overlays[0].end).toBeCloseTo(1.6, 5);
    expect(tl.overlays[0].props.title).toBe('one two three four');
  });

  it('is deterministic for a seed and varies motion between neighbours', async () => {
    const { assemble } = await import('@/lib/reel/assemble');
    const reel = await stillReel();
    const a = assemble({ reel, style: PATTERN });
    const b = assemble({ reel, style: PATTERN });
    expect(b).toEqual(a);
    const c = assemble({ reel: { ...reel, seed: 99 }, style: PATTERN });
    expect(c.clips.map((x) => x.motion)).not.toEqual(a.clips.map((x) => x.motion));
    expect(a.clips[0].motion.type).not.toBe(a.clips[1].motion.type);
  });

  it('preserves locked clips verbatim and reflows the rest around them', async () => {
    const { assemble } = await import('@/lib/reel/assemble');
    const reel = await baseReel();
    const first = assemble({ reel, style: PATTERN });
    const editedClip = {
      ...first.clips[1],
      end: first.clips[1].end + 1,
      locked: true,
      motion: { type: 'hold' as const, strength: 0, origin: [0.5, 0.5] as [number, number] },
    };
    const withLock = {
      ...reel,
      timeline: { ...first, clips: first.clips.map((c) => (c.id === editedClip.id ? editedClip : c)) },
    };
    const second = assemble({ reel: withLock, style: PATTERN });
    const kept = second.clips.find((c) => c.id === editedClip.id)!;
    expect(kept).toEqual(editedClip);
    expect(second.clips.find((c) => c.beatId === 'b3')!.start).toBeCloseTo(editedClip.end, 3);
  });

  it('keeps a locked caption and drops generated ones that would overlap it', async () => {
    const { assemble } = await import('@/lib/reel/assemble');
    const reel = await baseReel();
    const locked = { id: 'kx', text: 'MY WORDS', start: 0, end: 1.2, hidden: false, locked: true };
    const tl = assemble({ reel: { ...reel, timeline: { ...reel.timeline, captions: [locked] } }, style: PATTERN });
    expect(tl.captions.find((c) => c.id === 'kx')).toEqual(locked);
    for (const c of tl.captions.filter((c) => c.id !== 'kx')) {
      expect(c.start >= locked.end || c.end <= locked.start).toBe(true);
    }
  });

  it('skips beats whose asset is not ready yet', async () => {
    const { assemble } = await import('@/lib/reel/assemble');
    const { validateReel } = await import('@/lib/reel/schema');
    const reel = await baseReel();
    const half = validateReel({
      ...reel,
      assets: reel.assets.map((a) => (a.id === 'a2' ? { ...a, status: 'queued', path: '' } : a)),
    });

    const tl = assemble({ reel: half, style: PATTERN });
    // The beat is left out until its footage lands; the rest of the reel is unaffected.
    expect(tl.clips.some((c) => c.beatId === 'b2')).toBe(false);
    expect(tl.clips.length).toBeGreaterThan(0);
  });


  it('returns an empty timeline when there is no voiceover yet', async () => {
    const { assemble } = await import('@/lib/reel/assemble');
    const reel = await baseReel();
    const tl = assemble({ reel: { ...reel, vo: { ...reel.vo, words: [] } }, style: PATTERN });
    expect(tl.clips).toEqual([]);
    expect(tl.captions).toEqual([]);
  });
});

describe('degenerate word timings', () => {

  it('assembles a reel whose tail words all share one timestamp', async () => {
    const { assemble } = await import('@/lib/reel/assemble');
    const { validateReel } = await import('@/lib/reel/schema');
    const words = [
      ...WORDS,
      { w: 'is', start: 6, end: 6 },
      { w: 'running.', start: 6, end: 6 },
    ];
    const reel = await baseReel();
    const tl = assemble({
      reel: {
        ...reel,
        beats: [...reel.beats.slice(0, 2), { ...reel.beats[2], text: 'nine ten eleven twelve is running.' }],
        vo: { ...reel.vo, words },
      },
      style: PATTERN,
    });
    // The schema is the real gate here: it rejects any cue or clip of zero length.
    expect(() => validateReel({ ...reel, timeline: tl })).not.toThrow();
  });
});

describe('screen beats scroll, footage beats drift', () => {
  it('gives a screen beat a vertical pan, and a bigger one', async () => {
    const { assemble, SCREEN_MOTION_GAIN } = await import('@/lib/reel/assemble');
    const tl = assemble({ reel: await stillReel(), style: PATTERN });
    const screen = tl.clips.find((c) => c.beatId === 'b2')!; // the screen beat
    expect(['pan-up', 'pan-down']).toContain(screen.motion.type);
    expect(screen.motion.strength).toBeGreaterThan(PATTERN.motion.strength * (SCREEN_MOTION_GAIN - 1));
  });

  it('leaves footage beats on the gentler drift', async () => {
    const { assemble } = await import('@/lib/reel/assemble');
    const tl = assemble({ reel: await stillReel(), style: PATTERN });
    for (const c of tl.clips.filter((c) => c.beatId !== 'b2')) {
      expect(['zoom-in', 'zoom-out', 'pan-left', 'pan-right']).toContain(c.motion.type);
      expect(c.motion.strength).toBeLessThan(PATTERN.motion.strength * 1.5);
    }
  });
});

describe('a split beat reads as a cut', () => {
  it('frames each piece of a split beat differently', async () => {
    const { assemble } = await import('@/lib/reel/assemble');
    const { validateReel } = await import('@/lib/reel/schema');
    const long = Array.from({ length: 30 }, (_, i) => ({ w: `w${i}`, start: i * 0.4, end: i * 0.4 + 0.35 }));
    const reel = validateReel({
      style: 'test', title: 'Long', seed: 5,
      beats: [{ id: 'b1', role: 'body', text: long.map((w) => w.w).join(' '), shot: { kind: 'screen', brief: '', assetId: 'a1' } }],
      vo: { words: long, durationSec: 12 },
      assets: [{ id: 'a1', kind: 'image', path: 'assets/a1.png', origin: 'user', status: 'ready' }],
    });
    const tl = assemble({ reel, style: PATTERN });
    expect(tl.clips.length).toBeGreaterThanOrEqual(2);
    const origins = tl.clips.map((c) => c.motion.origin[1]);
    // consecutive pieces of one beat must not sit on the same part of the picture
    for (let i = 1; i < origins.length; i++) expect(origins[i]).not.toBe(origins[i - 1]);
  });
});

describe('motion is compensation for a still', () => {
  it('holds footage that already moves, so its edges are not cropped away', async () => {
    const { assemble, HELD } = await import('@/lib/reel/assemble');
    const reel = await baseReel(); // every asset in the fixture is a video
    for (const clip of assemble({ reel, style: PATTERN }).clips) {
      expect(clip.motion).toEqual(HELD);
    }
  });

  it('still moves a still', async () => {
    const { assemble } = await import('@/lib/reel/assemble');
    for (const clip of assemble({ reel: await stillReel(), style: PATTERN }).clips) {
      expect(clip.motion.type).not.toBe('hold');
      expect(clip.motion.strength).toBeGreaterThan(0);
    }
  });
});

describe('a line can cut between several shots', () => {
  it('walks the beat through its extra footage instead of holding one shot', async () => {
    const { assemble } = await import('@/lib/reel/assemble');
    const { validateReel } = await import('@/lib/reel/schema');
    const words = Array.from({ length: 24 }, (_, i) => ({ w: `w${i}`, start: i * 0.4, end: i * 0.4 + 0.35 }));
    const reel = validateReel({
      style: 'test', title: 'T', seed: 3,
      beats: [{
        id: 'b1', role: 'body', text: words.map((w) => w.w).join(' '),
        shot: { kind: 'screen', brief: '', assetId: 'a1', alsoAssetIds: ['a2', 'a3'] },
      }],
      vo: { words, durationSec: 10 },
      assets: ['a1', 'a2', 'a3'].map((id) => ({
        id, kind: 'video', path: `assets/${id}.mp4`, origin: 'plugin', status: 'ready',
      })),
    });
    const tl = assemble({ reel, style: PATTERN });
    expect(tl.clips.length).toBeGreaterThan(1);
    expect(new Set(tl.clips.map((c) => c.assetId)).size).toBeGreaterThan(1);
    // each piece opens its own footage rather than continuing the last one
    for (const c of tl.clips) expect(c.srcIn).toBe(0);
  });

  it('ignores extra footage that is not ready yet', async () => {
    const { assemble } = await import('@/lib/reel/assemble');
    const { validateReel } = await import('@/lib/reel/schema');
    const words = Array.from({ length: 24 }, (_, i) => ({ w: `w${i}`, start: i * 0.4, end: i * 0.4 + 0.35 }));
    const reel = validateReel({
      style: 'test', title: 'T', seed: 3,
      beats: [{
        id: 'b1', role: 'body', text: words.map((w) => w.w).join(' '),
        shot: { kind: 'screen', brief: '', assetId: 'a1', alsoAssetIds: ['a2'] },
      }],
      vo: { words, durationSec: 10 },
      assets: [
        { id: 'a1', kind: 'video', path: 'assets/a1.mp4', origin: 'plugin', status: 'ready' },
        { id: 'a2', kind: 'video', path: '', origin: 'plugin', status: 'queued' },
      ],
    });
    for (const c of assemble({ reel, style: PATTERN }).clips) expect(c.assetId).toBe('a1');
  });
});


describe('a padded recording never pushes its neighbour off its words', () => {
  it('keeps the next take on its own clock and trims the surplus instead', async () => {
    const { assemble } = await import('@/lib/reel/assemble');
    const reel = await baseReel();
    // Two whole recordings on the reel clock. The first was padded to the half-second
    // grid, so it measures 3.4s but its neighbour starts at 3.0.
    const padded = {
      ...reel,
      beats: [
        { ...reel.beats[0], shot: { ...reel.beats[0].shot, assetId: 'a1' } },
        { ...reel.beats[1], shot: { ...reel.beats[1].shot, assetId: 'a2' } },
        { ...reel.beats[2], shot: { ...reel.beats[2].shot, assetId: 'a2' } },
      ],
      assets: [
        { ...reel.assets[0], takeStart: 0, durationSec: 3.4 },
        { ...reel.assets[1], takeStart: 3.0, durationSec: 3.0 },
        reel.assets[2],
      ],
    };

    const t = assemble({ reel: padded as never, style: PATTERN as never });
    const second = t.clips.find((c) => c.assetId === 'a2')!;
    // Lips in step: the recording plays from the moment it was cut for...
    expect(second.start).toBe(3.0);
    // ...and the padded one gives up its silent surplus rather than shoving it.
    const first = t.clips.find((c) => c.assetId === 'a1')!;
    expect(first.end).toBeLessThanOrEqual(3.0);
  });
});
