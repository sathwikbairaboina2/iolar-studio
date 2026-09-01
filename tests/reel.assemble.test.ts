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
    const reel = await stillReel();
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
      assets: [{ id: 'a1', kind: 'video', path: 'assets/a1.mp4', origin: 'plugin', status: 'ready', durationSec: 10 }],
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

  it('still reads the script when the counts disagree', async () => {
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
    // The voiceover was synthesised from this script, so every word in it was spoken —
    // one the recogniser did not return is a miss on its side, not a word to drop.
    expect(scriptAlignedWords(reel).map((w) => w.w)).toEqual(['one', 'two', 'three', 'four', 'five']);
  });

  it('drops a word the recogniser invented mid-script rather than captioning it', async () => {
    const { scriptAlignedWords } = await import('@/lib/reel/assemble');
    const { validateReel } = await import('@/lib/reel/schema');
    const reel = validateReel({
      pattern: 'test',
      title: 'T',
      beats: [{ id: 'b1', role: 'hook', text: 'one two three', shot: { kind: 'broll', brief: '' } }],
      vo: { words: [
        { w: 'one', start: 0, end: 0.2 },
        { w: 'uh', start: 0.2, end: 0.3 },
        { w: 'two', start: 0.3, end: 0.5 },
        { w: 'three', start: 0.5, end: 0.7 },
      ] },
    });
    expect(scriptAlignedWords(reel).map((w) => w.w)).toEqual(['one', 'two', 'three']);
  });

  it('keeps a mis-count inside one beat from shifting every beat after it', async () => {
    const { beatSpans, scriptAlignedWords } = await import('@/lib/reel/assemble');
    const { validateReel } = await import('@/lib/reel/schema');
    const reel = validateReel({
      pattern: 'test',
      title: 'T',
      beats: [
        { id: 'b1', role: 'hook', text: 'twenty five years', shot: { kind: 'broll', brief: '' } },
        { id: 'b2', role: 'body', text: 'after end of mission', shot: { kind: 'broll', brief: '' } },
      ],
      // the recogniser heard "25" as one word, so a naive walk hands b2 the wrong slice
      vo: { words: [
        { w: '25', start: 0, end: 0.4 },
        { w: 'years', start: 0.4, end: 0.8 },
        { w: 'after', start: 1, end: 1.2 },
        { w: 'end', start: 1.2, end: 1.4 },
        { w: 'of', start: 1.4, end: 1.5 },
        { w: 'mission', start: 1.5, end: 2 },
      ] },
    });
    const spans = beatSpans(reel);
    expect(spans.get('b2')!.start).toBeCloseTo(1, 3);
    expect(spans.get('b2')!.end).toBeCloseTo(2, 3);
    expect(scriptAlignedWords(reel).map((w) => w.w).join(' ')).toBe('twenty five years after end of mission');
  });

  it('gives no span to a beat the recogniser returned nothing for', async () => {
    const { beatSpans, scriptAlignedWords } = await import('@/lib/reel/assemble');
    const { validateReel } = await import('@/lib/reel/schema');
    const reel = validateReel({
      pattern: 'test',
      title: 'T',
      beats: [
        { id: 'b1', role: 'hook', text: 'one two', shot: { kind: 'broll', brief: '' } },
        { id: 'b2', role: 'close', text: 'three four', shot: { kind: 'broll', brief: '' } },
      ],
      vo: { words: [{ w: 'one', start: 0, end: 0.4 }, { w: 'two', start: 0.4, end: 0.9 }] },
    });
    // Captions still read the whole script; the build has nothing to cut b2 against.
    expect(scriptAlignedWords(reel).map((w) => w.w)).toEqual(['one', 'two', 'three', 'four']);
    expect(beatSpans(reel).has('b2')).toBe(false);
  });

  it('gives every word a span that starts no earlier than the one before it', async () => {
    const { scriptAlignedWords } = await import('@/lib/reel/assemble');
    const { validateReel } = await import('@/lib/reel/schema');
    const reel = validateReel({
      pattern: 'test',
      title: 'T',
      beats: [{ id: 'b1', role: 'hook', text: 'rule 47 CFR 25.283(e) applies', shot: { kind: 'broll', brief: '' } }],
      vo: { words: [
        { w: 'rule', start: 0, end: 0.3 },
        { w: 'applies', start: 1.4, end: 1.8 },
      ] },
    });
    const words = scriptAlignedWords(reel);
    expect(words.map((w) => w.w)).toEqual(['rule', '47', 'CFR', '25.283(e)', 'applies']);
    for (let i = 1; i < words.length; i++) {
      expect(words[i].start).toBeGreaterThanOrEqual(words[i - 1].start);
      expect(words[i].end).toBeGreaterThan(words[i].start);
    }
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
    const tl = assemble({ reel: await stillReel(), pattern: PATTERN });
    const screen = tl.clips.find((c) => c.beatId === 'b2')!; // the screen beat
    expect(['pan-up', 'pan-down']).toContain(screen.motion.type);
    expect(screen.motion.strength).toBeGreaterThan(PATTERN.motion.strength * (SCREEN_MOTION_GAIN - 1));
  });

  it('leaves footage beats on the gentler drift', async () => {
    const { assemble } = await import('@/lib/reel/assemble');
    const tl = assemble({ reel: await stillReel(), pattern: PATTERN });
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
      pattern: 'test', title: 'Long', seed: 5,
      beats: [{ id: 'b1', role: 'body', text: long.map((w) => w.w).join(' '), shot: { kind: 'screen', brief: '', assetId: 'a1' } }],
      vo: { words: long, durationSec: 12 },
      assets: [{ id: 'a1', kind: 'image', path: 'assets/a1.png', origin: 'user', status: 'ready' }],
    });
    const tl = assemble({ reel, pattern: PATTERN });
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
    for (const clip of assemble({ reel, pattern: PATTERN }).clips) {
      expect(clip.motion).toEqual(HELD);
    }
  });

  it('still moves a still', async () => {
    const { assemble } = await import('@/lib/reel/assemble');
    for (const clip of assemble({ reel: await stillReel(), pattern: PATTERN }).clips) {
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
      pattern: 'test', title: 'T', seed: 3,
      beats: [{
        id: 'b1', role: 'body', text: words.map((w) => w.w).join(' '),
        shot: { kind: 'screen', brief: '', assetId: 'a1', alsoAssetIds: ['a2', 'a3'] },
      }],
      vo: { words, durationSec: 10 },
      assets: ['a1', 'a2', 'a3'].map((id) => ({
        id, kind: 'video', path: `assets/${id}.mp4`, origin: 'plugin', status: 'ready',
      })),
    });
    const tl = assemble({ reel, pattern: PATTERN });
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
      pattern: 'test', title: 'T', seed: 3,
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
    for (const c of assemble({ reel, pattern: PATTERN }).clips) expect(c.assetId).toBe('a1');
  });
});

describe('caption cues break where a reader would', () => {
  const at = (list: [string, number, number][]) => list.map(([w, start, end]) => ({ w, start, end }));

  it('ends a cue at a full stop instead of carrying the next sentence into it', async () => {
    const { groupCaptions } = await import('@/lib/reel/assemble');
    const words = at([
      ['was', 0, 0.3], ['a', 0.3, 0.4], ['recommended', 0.4, 0.9], ['practice.', 0.9, 1.4],
      ['A', 1.4, 1.6], ['suggestion.', 1.6, 2.1],
    ]);
    for (const cue of groupCaptions(words, PATTERN)) {
      const stops = cue.text.match(/[.!?](?=\s)/g) ?? [];
      expect(stops).toHaveLength(0);
    }
  });

  it('does not strand a lone word in its own cue when it fits with the one before', async () => {
    const { groupCaptions } = await import('@/lib/reel/assemble');
    const words = at([['for', 0, 0.2], ['ignoring', 0.2, 0.6], ['it', 0.6, 0.8]]);
    const cues = groupCaptions(words, PATTERN);
    expect(cues.some((c) => c.text.split(' ').length === 1)).toBe(false);
  });

  it('pulls a stranded word forward when the cue before it is already full', async () => {
    const { groupCaptions } = await import('@/lib/reel/assemble');
    // "130" is said slowly, so the cue clock alone would leave "For" and "130" alone in turn
    const words = at([['For', 0, 0.4], ['130', 0.4, 1.56], ['years', 1.56, 1.9], ['the', 1.9, 2.1]]);
    const cues = groupCaptions(words, PATTERN);
    expect(cues.some((c) => c.text.split(' ').length === 1)).toBe(false);
  });

  it('still honours the char cap when it merges a stranded word back', async () => {
    const { groupCaptions } = await import('@/lib/reel/assemble');
    const words = at([['transmissible', 0, 0.6], ['spongiform', 0.6, 1.2], ['x', 1.2, 1.4]]);
    for (const cue of groupCaptions(words, PATTERN)) {
      expect(cue.text.length).toBeLessThanOrEqual(PATTERN.caption.maxChars);
    }
  });
});
