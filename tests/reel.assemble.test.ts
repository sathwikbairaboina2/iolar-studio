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
  voice: { higgsfieldVoiceId: '', rate: 1 },
  letterbox: { bg: '#ffffff' },
};

const WORDS = ['one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten', 'eleven', 'twelve']
  .map((w, i) => ({ w, start: i * 0.5, end: i * 0.5 + 0.45 }));

async function baseReel() {
  const { validateReel } = await import('@/lib/reel/schema');
  return validateReel({
    pattern: 'test',
    title: 'Test',
    seed: 42,
    beats: [
      { id: 'b1', role: 'hook', text: 'one two three four', shot: { kind: 'broll', brief: 'stage', assetId: 'a1' } },
      { id: 'b2', role: 'body', text: 'five six seven eight', shot: { kind: 'screen', brief: 'chat ui', assetId: 'a2' } },
      { id: 'b3', role: 'close', text: 'nine ten eleven twelve', shot: { kind: 'talking-head', brief: 'creator', assetId: 'a3' } },
    ],
    vo: { words: WORDS, durationSec: 6 },
    assets: [
      { id: 'a1', kind: 'video', path: 'assets/a1.mp4', origin: 'comfy', status: 'ready', durationSec: 5 },
      { id: 'a2', kind: 'video', path: 'assets/a2.mp4', origin: 'comfy', status: 'ready', durationSec: 5 },
      { id: 'a3', kind: 'video', path: 'assets/a3.mp4', origin: 'user', status: 'ready', durationSec: 5 },
    ],
  });
}

describe('assemble', () => {
  it('gives every beat a clip spanning its own words', async () => {
    const { assemble } = await import('@/lib/reel/assemble');
    const tl = assemble({ reel: await baseReel(), pattern: PATTERN });
    expect(tl.clips).toHaveLength(3);
    expect(tl.clips[0]).toMatchObject({ beatId: 'b1', assetId: 'a1', start: 0 });
    expect(tl.clips[0].end).toBeCloseTo(1.95, 2);
    expect(tl.clips[1]).toMatchObject({ beatId: 'b2', assetId: 'a2' });
    expect(tl.clips[2].end).toBeCloseTo(5.95, 2);
  });

  it('leaves no gap and no overlap between clips', async () => {
    const { assemble } = await import('@/lib/reel/assemble');
    const tl = assemble({ reel: await baseReel(), pattern: PATTERN });
    for (let i = 1; i < tl.clips.length; i++) {
      expect(tl.clips[i].start).toBeCloseTo(tl.clips[i - 1].end, 3);
    }
  });

  it('groups words into caption beats of 1-3 words under the char cap', async () => {
    const { groupCaptions } = await import('@/lib/reel/assemble');
    const cues = groupCaptions(WORDS, PATTERN);
    expect(cues.length).toBeGreaterThanOrEqual(4);
    for (const c of cues) {
      expect(c.text.split(' ').length).toBeLessThanOrEqual(3);
      expect(c.text.length).toBeLessThanOrEqual(22);
      expect(c.end).toBeGreaterThan(c.start);
    }
    expect(cues[0].start).toBeCloseTo(0, 5);
    expect(cues.at(-1)!.end).toBeCloseTo(5.95, 2);
  });

  it('adds a hook overlay for the pattern hook duration', async () => {
    const { assemble } = await import('@/lib/reel/assemble');
    const tl = assemble({ reel: await baseReel(), pattern: PATTERN });
    expect(tl.overlays).toHaveLength(1);
    expect(tl.overlays[0]).toMatchObject({ kind: 'hook-title', start: 0 });
    expect(tl.overlays[0].end).toBeCloseTo(1.6, 5);
    expect(tl.overlays[0].props.title).toBe('one two three four');
  });

  it('is deterministic for a seed and varies motion between neighbours', async () => {
    const { assemble } = await import('@/lib/reel/assemble');
    const reel = await baseReel();
    const a = assemble({ reel, pattern: PATTERN });
    const b = assemble({ reel, pattern: PATTERN });
    expect(b).toEqual(a);
    const c = assemble({ reel: { ...reel, seed: 99 }, pattern: PATTERN });
    expect(c.clips.map((x) => x.motion)).not.toEqual(a.clips.map((x) => x.motion));
    expect(a.clips[0].motion.type).not.toBe(a.clips[1].motion.type);
  });

  it('preserves locked clips verbatim and reflows the rest around them', async () => {
    const { assemble } = await import('@/lib/reel/assemble');
    const reel = await baseReel();
    const first = assemble({ reel, pattern: PATTERN });
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
    const second = assemble({ reel: withLock, pattern: PATTERN });
    const kept = second.clips.find((c) => c.id === editedClip.id)!;
    expect(kept).toEqual(editedClip);
    expect(second.clips.find((c) => c.beatId === 'b3')!.start).toBeCloseTo(editedClip.end, 3);
  });

  it('keeps a locked caption and drops generated ones that would overlap it', async () => {
    const { assemble } = await import('@/lib/reel/assemble');
    const reel = await baseReel();
    const locked = { id: 'kx', text: 'MY WORDS', start: 0, end: 1.2, hidden: false, locked: true };
    const tl = assemble({ reel: { ...reel, timeline: { ...reel.timeline, captions: [locked] } }, pattern: PATTERN });
    expect(tl.captions.find((c) => c.id === 'kx')).toEqual(locked);
    for (const c of tl.captions.filter((c) => c.id !== 'kx')) {
      expect(c.start >= locked.end || c.end <= locked.start).toBe(true);
    }
  });

  it('skips beats whose asset is not ready yet but still captions the whole voiceover', async () => {
    const { assemble } = await import('@/lib/reel/assemble');
    const reel = await baseReel();
    const pending = {
      ...reel,
      assets: reel.assets.map((a) => (a.id === 'a2' ? { ...a, status: 'queued' as const } : a)),
    };
    const tl = assemble({ reel: pending, pattern: PATTERN });
    expect(tl.clips.map((c) => c.beatId)).toEqual(['b1', 'b3']);
    expect(tl.captions.at(-1)!.end).toBeCloseTo(5.95, 2);
  });

  it('splits a beat longer than the pattern max shot length', async () => {
    const { assemble, groupCaptions } = await import('@/lib/reel/assemble');
    const { validateReel } = await import('@/lib/reel/schema');
    const long = ['a','b','c','d','e','f','g','h','i','j','k','l','m','n','o','p']
      .map((w, i) => ({ w, start: i * 0.6, end: i * 0.6 + 0.55 }));
    const reel = validateReel({
      pattern: 'test',
      title: 'Long',
      seed: 1,
      beats: [{ id: 'b1', role: 'body', text: long.map((w) => w.w).join(' '), shot: { kind: 'broll', brief: '', assetId: 'a1' } }],
      vo: { words: long, durationSec: 9.6 },
      assets: [{ id: 'a1', kind: 'video', path: 'assets/a1.mp4', origin: 'comfy', status: 'ready', durationSec: 10 }],
    });
    const tl = assemble({ reel, pattern: PATTERN });
    expect(tl.clips.length).toBe(2);
    for (const c of tl.clips) expect(c.end - c.start).toBeLessThanOrEqual(6.001);
    expect(groupCaptions(long, PATTERN).length).toBeGreaterThan(5);
  });

  it('returns an empty timeline when there is no voiceover yet', async () => {
    const { assemble } = await import('@/lib/reel/assemble');
    const reel = await baseReel();
    const tl = assemble({ reel: { ...reel, vo: { ...reel.vo, words: [] } }, pattern: PATTERN });
    expect(tl.clips).toEqual([]);
    expect(tl.captions).toEqual([]);
  });
});

describe('degenerate word timings', () => {
  it('gives a readable length to a caption built from zero-length words', async () => {
    const { groupCaptions, MIN_CUE_SEC } = await import('@/lib/reel/assemble');
    // Whisper emits these at the end of a take: start === end.
    const words = [
      { w: 'the', start: 11.5, end: 11.9 },
      { w: 'server', start: 11.98, end: 11.98 },
      { w: 'is', start: 11.98, end: 11.98 },
      { w: 'running.', start: 11.98, end: 11.98 },
    ];
    for (const cue of groupCaptions(words, PATTERN)) {
      expect(cue.end - cue.start).toBeGreaterThanOrEqual(MIN_CUE_SEC - 1e-6);
    }
  });

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
      pattern: PATTERN,
    });
    // The schema is the real gate here: it rejects any cue or clip of zero length.
    expect(() => validateReel({ ...reel, timeline: tl })).not.toThrow();
  });
});

describe('captions read the script, not the transcript', () => {
  it('keeps the script wording and the recogniser timings', async () => {
    const { scriptAlignedWords } = await import('@/lib/reel/assemble');
    const { validateReel } = await import('@/lib/reel/schema');
    const reel = validateReel({
      pattern: 'test',
      title: 'T',
      beats: [{ id: 'b1', role: 'hook', text: 'Grok Bot ships', shot: { kind: 'broll', brief: '' } }],
      // whisper misheard the product name, as it does with any coined word
      vo: { words: [
        { w: 'Rock', start: 0, end: 0.3 },
        { w: 'Bot', start: 0.3, end: 0.6 },
        { w: 'ships', start: 0.6, end: 1 },
      ] },
    });
    expect(scriptAlignedWords(reel).map((w) => w.w)).toEqual(['Grok', 'Bot', 'ships']);
    expect(scriptAlignedWords(reel).map((w) => w.start)).toEqual([0, 0.3, 0.6]);
  });

  it('falls back to the transcript for a beat whose word counts disagree', async () => {
    const { scriptAlignedWords } = await import('@/lib/reel/assemble');
    const { validateReel } = await import('@/lib/reel/schema');
    const reel = validateReel({
      pattern: 'test',
      title: 'T',
      beats: [
        { id: 'b1', role: 'hook', text: 'one two three', shot: { kind: 'broll', brief: '' } },
        { id: 'b2', role: 'close', text: 'four five', shot: { kind: 'broll', brief: '' } },
      ],
      vo: { words: [
        { w: 'wun', start: 0, end: 0.2 },
        { w: 'too', start: 0.2, end: 0.4 },
        { w: 'three', start: 0.4, end: 0.6 },
        { w: 'four', start: 0.6, end: 0.8 },
      ] },
    });
    // b1 matches 3-for-3 and is corrected; b2 expected two words but only one was heard
    expect(scriptAlignedWords(reel).map((w) => w.w)).toEqual(['one', 'two', 'three', 'four']);
  });

  it('captions the whole voiceover even when the recogniser runs past the script', async () => {
    const { scriptAlignedWords } = await import('@/lib/reel/assemble');
    const { validateReel } = await import('@/lib/reel/schema');
    const reel = validateReel({
      pattern: 'test',
      title: 'T',
      beats: [{ id: 'b1', role: 'hook', text: 'one two', shot: { kind: 'broll', brief: '' } }],
      vo: { words: [
        { w: 'one', start: 0, end: 0.2 },
        { w: 'two', start: 0.2, end: 0.4 },
        { w: 'extra', start: 0.4, end: 0.6 },
      ] },
    });
    expect(scriptAlignedWords(reel).map((w) => w.w)).toEqual(['one', 'two', 'extra']);
  });
});

describe('screen beats scroll, footage beats drift', () => {
  it('gives a screen beat a vertical pan, and a bigger one', async () => {
    const { assemble, SCREEN_MOTION_GAIN } = await import('@/lib/reel/assemble');
    const tl = assemble({ reel: await baseReel(), pattern: PATTERN });
    const screen = tl.clips.find((c) => c.beatId === 'b2')!; // the screen beat
    expect(['pan-up', 'pan-down']).toContain(screen.motion.type);
    expect(screen.motion.strength).toBeGreaterThan(PATTERN.motion.strength * (SCREEN_MOTION_GAIN - 1));
  });

  it('leaves footage beats on the gentler drift', async () => {
    const { assemble } = await import('@/lib/reel/assemble');
    const tl = assemble({ reel: await baseReel(), pattern: PATTERN });
    for (const c of tl.clips.filter((c) => c.beatId !== 'b2')) {
      expect(['zoom-in', 'zoom-out', 'pan-left', 'pan-right']).toContain(c.motion.type);
      expect(c.motion.strength).toBeLessThan(PATTERN.motion.strength * 1.5);
    }
  });
});
