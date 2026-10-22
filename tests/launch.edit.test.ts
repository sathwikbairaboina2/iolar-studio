import { describe, expect, it } from 'vitest';
import { SceneInSchema, changeText, editPrompt, generateEdit, layoutScenes, receiptClaims, resolveEdit, type EditInput } from '@/lib/launch/edit';

const timing = { fps: 30, totalFrames: 300, beats: [
  { id: 'hook', start: 0, end: 60 }, { id: 'numbers', start: 60, end: 180 }, { id: 'catch', start: 180, end: 255 }, { id: 'cta', start: 255, end: 300 },
] };
const claims = { claims: [
  { id: 'c1', text: 'old price', value: 10, unit: '$', url: 'https://openai.com/pricing', quote: '$10.00 / 1M' },
  { id: 'c2', text: 'new price', value: 3, unit: '$', url: 'https://ai.google.dev/pricing', quote: '$3.00 / 1M' },
  { id: 'c3', text: 'context', value: 1000000, unit: 'tokens', url: 'https://blog.google/x', quote: '1 million token context window' },
  { id: 'c4', text: 'cents price', value: 300, unit: '¢', url: 'https://ai.google.dev/pricing', quote: '300 cents' },
] };
const script = { headline: 'Gemini 4 is here.', kicker: 'BREAKING', beats: ['hook', 'numbers', 'catch', 'cta'].map((id) => ({ id, narration: 'x', emphasis: [], claims: [] })) } as never;
const input: EditInput = { scenes: [
  { type: 'Headline', beat: 'hook', weight: 1, kicker: 'BREAKING', title: 'Gemini 4 is here.' },
  { type: 'DeltaCard', beat: 'numbers', weight: 2, label: 'Price per 1M input tokens', before: 'c1', after: 'c2', better: 'lower', word: 'cheaper' },
  { type: 'Receipt', beat: 'numbers', weight: 1, claim: 'c3' },
  { type: 'Receipt', beat: 'catch', weight: 1, claim: 'c3' },
  { type: 'EndCard', beat: 'cta', weight: 1, line: 'Follow for every launch' },
] };
const shot = { claim: 'c3', file: 'receipt-c3.png', width: 1080, height: 1350, focus: [{ x: 40, y: 500, w: 600, h: 60 }], url: 'https://blog.google/x', host: 'blog.google' };
const ctx = { slug: 'gemini-4', date: '21.10.26', bed: null, timing, script, claims, receipts: { c3: shot } };

describe('layoutScenes', () => {
  it('tiles each beat by weight, so scenes cover 0..totalFrames exactly', () => {
    const { frames, errors } = layoutScenes(timing, input.scenes);
    expect(errors).toEqual([]);
    expect(frames).toEqual([{ from: 0, to: 60 }, { from: 60, to: 140 }, { from: 140, to: 180 }, { from: 180, to: 255 }, { from: 255, to: 300 }]);
  });
  it('moves a cut inside a beat onto the nearest spoken word, two frames before it', () => {
    const w = (startFrame: number) => ({ w: 'x', startFrame, endFrame: startFrame + 8 });
    const worded = { ...timing, beats: timing.beats.map((b) => (b.id === 'numbers' ? { ...b, words: [62, 100, 131, 150, 170].map(w) } : b)) };
    const { frames } = layoutScenes(worded, input.scenes);
    expect(frames.slice(1, 3)).toEqual([{ from: 60, to: 148 }, { from: 148, to: 180 }]);
  });
  it('keeps the weighted cut when no word starts within 20 frames of it', () => {
    const w = (startFrame: number) => ({ w: 'x', startFrame, endFrame: startFrame + 8 });
    const worded = { ...timing, beats: timing.beats.map((b) => (b.id === 'numbers' ? { ...b, words: [62, 170].map(w) } : b)) };
    expect(layoutScenes(worded, input.scenes).frames[1]).toEqual({ from: 60, to: 140 });
  });
  it('names a beat with no scene', () => {
    expect(layoutScenes(timing, input.scenes.filter((s) => s.beat !== 'catch')).errors).toContain('the catch beat has no scene');
  });
  it('names a scene for a beat the script does not have', () => {
    const extra = [...input.scenes, { type: 'EndCard', beat: 'who', weight: 1, line: 'x' } as const];
    expect(layoutScenes(timing, extra).errors.join('\n')).toMatch(/who/);
  });
  it('refuses scenes out of beat order', () => {
    expect(layoutScenes(timing, [input.scenes[1], input.scenes[0], ...input.scenes.slice(2)]).errors.join('\n')).toMatch(/order/);
  });
});

describe('changeText', () => {
  it('writes a ratio for a big change and a percent for a small one', () => {
    expect(changeText(10, 3, 'lower', 'cheaper')).toBe('3.3× cheaper');
    expect(changeText(80, 88, 'higher', 'better')).toBe('10% better');
  });
  it('takes the direction from the word, not from the sign', () => {
    expect(changeText(2, 4, 'lower', 'pricier')).toBe('2× pricier');
    expect(changeText(4, 2, 'lower', 'cheaper')).toBe('2× cheaper');
  });
});

describe('resolveEdit', () => {
  it('resolves numbers and receipts into render props', () => {
    const { props, errors } = resolveEdit(input, ctx);
    expect(errors).toEqual([]);
    const delta = props!.scenes[1];
    expect(delta).toMatchObject({ type: 'DeltaCard', before: { value: 10, unit: '$' }, after: { value: 3, unit: '$' }, change: '3.3× cheaper', source: 'ai.google.dev' });
    expect(props!.scenes[2]).toMatchObject({ type: 'Receipt', image: 'launch/gemini-4/receipt-c3.png', source: 'blog.google' });
    expect(props!.totalFrames).toBe(300);
  });
  it('refuses a delta whose units differ, naming both', () => {
    const bad = { scenes: input.scenes.map((s) => (s.type === 'DeltaCard' ? { ...s, before: 'c4' } : s)) } as EditInput;
    expect(resolveEdit(bad, ctx).errors.join('\n')).toMatch(/¢.*\$|\$.*¢/);
  });
  it('refuses a receipt whose quote was not found, and asks for another claim', () => {
    const { errors } = resolveEdit(input, { ...ctx, receipts: { c3: { ...shot, focus: null } } });
    expect(errors.join('\n')).toMatch(/c3.*not found on blog\.google/);
  });
  it('skips receipt checks when receipts are not captured yet', () => {
    expect(resolveEdit(input, { ...ctx, receipts: null }).errors).toEqual([]);
  });
  it('refuses a number scene citing a claim with no value', () => {
    const noValue = { claims: claims.claims.map((c) => (c.id === 'c2' ? { ...c, value: undefined } : c)) };
    expect(resolveEdit(input, { ...ctx, claims: noValue }).errors.join('\n')).toMatch(/c2 has no number/);
  });
});

describe('PullQuote and receipt share', () => {
  it('resolves a PullQuote into the claim quote and its host', () => {
    const withQuote: EditInput = { scenes: input.scenes.map((s) => (s.type === 'Receipt' && s.beat === 'numbers' ? { type: 'PullQuote', beat: 'numbers', weight: 1, claim: 'c3' } as const : s)) };
    const { props, errors } = resolveEdit(withQuote, ctx);
    expect(errors).toEqual([]);
    expect(props!.scenes[2]).toMatchObject({ type: 'PullQuote', quote: '1 million token context window', source: 'blog.google' });
  });
  it('carries DeltaCard labels through', () => {
    const labelled: EditInput = { scenes: input.scenes.map((s) => (s.type === 'DeltaCard' ? { ...s, beforeLabel: 'TODAY', afterLabel: 'FROM DEC 1' } : s)) };
    expect(resolveEdit(labelled, ctx).props!.scenes[1]).toMatchObject({ beforeLabel: 'TODAY', afterLabel: 'FROM DEC 1' });
    expect(SceneInSchema.safeParse({ ...input.scenes[1], beforeLabel: 'x'.repeat(15) }).success).toBe(false);
  });
  it('refuses a reel where receipts take over 45% of the frames', () => {
    const heavy: EditInput = { scenes: input.scenes.map((s) => (s.type === 'DeltaCard' ? { type: 'Receipt', beat: 'numbers', weight: 2, claim: 'c3' } as const : s)) };
    expect(resolveEdit(heavy, ctx).errors.join(' ')).toMatch(/receipts take \d+% of the reel; use at most 40%/);
    expect(resolveEdit(input, ctx).errors).toEqual([]);
  });
  it('refuses three scenes of one kind in a row, and more than two pull quotes', () => {
    const quote = (beat: 'numbers' | 'catch') => ({ type: 'PullQuote', beat, weight: 1, claim: 'c3' }) as const;
    const run: EditInput = { scenes: [input.scenes[0], quote('numbers'), quote('numbers'), quote('catch'), input.scenes[4]] };
    const errs = resolveEdit(run, { ...ctx, receipts: null }).errors.join(' ');
    expect(errs).toMatch(/3 PullQuote scenes in a row/);
    expect(errs).toMatch(/3 PullQuotes; use at most 2/);
  });
});

describe('generateEdit', () => {
  it('asks again with the structural errors quoted', async () => {
    const bad = { scenes: input.scenes.filter((s) => s.beat !== 'catch') };
    const said = [JSON.stringify(bad), JSON.stringify(input)];
    const prompts: string[] = [];
    const out = await generateEdit({ brief: {} as never, script, claims, timing }, { run: async (p) => { prompts.push(p); return said.shift()!; } }, (i) => resolveEdit(i, { ...ctx, receipts: null }).errors);
    expect(out.scenes).toHaveLength(5);
    expect(prompts[1]).toContain('the catch beat has no scene');
  });
});

describe('Headline facts', () => {
  const head = { type: 'Headline', beat: 'hook', weight: 1, kicker: 'BREAKING', title: 'Gemini 4 is here.' };
  const facts = [{ label: 'CONTEXT', value: '1M tokens' }, { label: 'PRICE', value: '$3 per 1M' }, { label: 'OUT', value: 'Today' }];
  it('accepts up to three short facts and refuses more or longer ones', () => {
    expect(SceneInSchema.safeParse({ ...head, facts }).success).toBe(true);
    expect(SceneInSchema.safeParse({ ...head, facts: [...facts, facts[0]] }).success).toBe(false);
    expect(SceneInSchema.safeParse({ ...head, facts: [{ label: 'A VERY LONG LABEL', value: 'x' }] }).success).toBe(false);
    expect(SceneInSchema.safeParse({ ...head, facts: [{ label: 'X', value: 'a value too long' }] }).success).toBe(false);
  });
  it('passes facts through to the resolved scene', () => {
    const withFacts: EditInput = { scenes: [{ ...input.scenes[0], facts } as never, ...input.scenes.slice(1)] };
    const r = resolveEdit(withFacts, ctx);
    expect(r.props?.scenes[0]).toMatchObject({ type: 'Headline', facts });
  });
});

describe('anchor, b-roll, demo and post scenes', () => {
  const narr = (id: string, text: string) => ({ id, narration: text, emphasis: [], claims: [] });
  const avScript = { ...(script as object), beats: [narr('hook', 'x'), narr('numbers', 'x'), narr('catch', 'The catch is a rate limit on the free tier.'), narr('cta', 'x')] } as never;
  const assets = {
    notes: [],
    assets: {
      'avatar-3': { kind: 'avatar', source: 'higgsfield', file: 'avatar-3.mp4', key: 'k' },
      'broll-0': { kind: 'broll', source: 'higgsfield', file: 'broll-0.png', key: 'k' },
      'demo-1': { kind: 'demo', source: 'download', file: 'demo-demo-1.mp4', key: 'k' },
      'post-1': { kind: 'post', source: 'oembed', file: '', key: 'k', post: { author: 'Google', handle: '@Google', date: 'October 21, 2026', text: 'Gemini 4 is here.' } },
    },
  } as never;
  const avatar = { type: 'AvatarTalk', beat: 'catch', weight: 1, layout: 'columnist', over: 'c3', quote: 'a rate limit' } as const;
  const base = (scenes: EditInput['scenes']): EditInput => ({ scenes });
  // hook Headline | numbers DeltaCard + Receipt | catch AvatarTalk | cta EndCard
  const withAvatar = base([input.scenes[0], input.scenes[1], input.scenes[2], avatar, input.scenes[4]]);
  const actx = { ...ctx, script: avScript, mode: 'avatar' as const, demos: ['demo-1'], posts: ['post-1'], assets };

  it('parses the four new inputs and refuses bad ones', () => {
    expect(SceneInSchema.safeParse(avatar).success).toBe(true);
    expect(SceneInSchema.safeParse({ ...avatar, quote: 'x'.repeat(61) }).success).toBe(false);
    expect(SceneInSchema.safeParse({ type: 'BRoll', beat: 'hook', weight: 1, prompt: 'A server room', title: 'x'.repeat(49) }).success).toBe(false);
    expect(SceneInSchema.safeParse({ type: 'DemoClip', beat: 'numbers', weight: 1, clip: 'demo-4', credit: 'Google' }).success).toBe(false);
    expect(SceneInSchema.safeParse({ type: 'PostCard', beat: 'numbers', weight: 1, post: 'post-2' }).success).toBe(true);
  });

  it('refuses an AvatarTalk scene in a faceless reel', () => {
    expect(resolveEdit(withAvatar, { ...actx, mode: 'faceless' }).errors.join('\n')).toMatch(/AvatarTalk.*avatar mode/);
  });

  it('resolves an AvatarTalk scene with the receipt shown above it and the clip', () => {
    const r = resolveEdit(withAvatar, actx);
    expect(r.errors).toEqual([]);
    expect(r.props!.scenes[3]).toMatchObject({
      type: 'AvatarTalk', layout: 'columnist', video: 'launch/gemini-4/avatar-3.mp4', portrait: 'launch/gemini-4/anchor.png', quote: 'a rate limit',
      receipt: { image: 'launch/gemini-4/receipt-c3.png', width: 1080, height: 1350, source: 'blog.google', focus: shot.focus },
    });
  });

  it('uses the still portrait (video null) when the clip could not be made', () => {
    const still = { notes: [], assets: { 'avatar-3': { kind: 'avatar', source: 'still', file: '', key: 'k' } } } as never;
    expect(resolveEdit(withAvatar, { ...actx, assets: still }).props!.scenes[3]).toMatchObject({ type: 'AvatarTalk', video: null });
  });

  it('refuses an over claim with no captured receipt, and a quote that is not in the narration', () => {
    expect(resolveEdit(withAvatar, { ...actx, receipts: {} }).errors.join('\n')).toMatch(/no screenshot was taken for c3/);
    expect(resolveEdit(withAvatar, { ...actx, receipts: { c3: { ...shot, focus: null } } }).errors.join('\n')).toMatch(/c3.*not found/);
    const wrong = base([input.scenes[0], input.scenes[1], input.scenes[2], { ...avatar, quote: 'completely invented words' }, input.scenes[4]]);
    expect(resolveEdit(wrong, actx).errors.join('\n')).toMatch(/pull-quote.*narration/);
    const noClaim = base([input.scenes[0], input.scenes[1], input.scenes[2], { ...avatar, over: 'c9' }, input.scenes[4]]);
    expect(resolveEdit(noClaim, actx).errors.join('\n')).toMatch(/c9 is not a claim/);
  });

  it('refuses more than half the frames as AvatarTalk', () => {
    const heavy = base([input.scenes[0], { ...avatar, beat: 'numbers', over: undefined, quote: undefined }, { ...avatar, over: undefined, quote: undefined }, input.scenes[4]]);
    expect(resolveEdit(heavy, { ...actx, assets: null, receipts: null }).errors.join('\n')).toMatch(/AvatarTalk scenes take \d+% of the reel; use at most 50%/);
  });

  it('resolves BRoll, and swaps it for a Headline when the photo was not made', () => {
    const b = base([{ type: 'BRoll', beat: 'hook', weight: 1, prompt: 'A server room at dusk', kicker: 'BREAKING', title: 'Gemini 4 is here.' }, ...input.scenes.slice(1)]);
    expect(resolveEdit(b, actx).props!.scenes[0]).toMatchObject({ type: 'BRoll', image: 'launch/gemini-4/broll-0.png', kicker: 'BREAKING' });
    const swapped = { notes: [], assets: { 'broll-0': { kind: 'broll', source: 'swapped', file: '', key: 'k', reason: 'over budget' } } } as never;
    expect(resolveEdit(b, { ...actx, assets: swapped }).props!.scenes[0]).toMatchObject({ type: 'Headline', kicker: 'BREAKING', title: 'Gemini 4 is here.' });
  });

  it('resolves DemoClip and PostCard, and refuses ids the reel does not have or has no file for', () => {
    // numbers beat is 120 frames: DemoClip 1/3 and PostCard 1/3 of it, each 40 frames
    const d = base([input.scenes[0], { type: 'DemoClip', beat: 'numbers', weight: 1, clip: 'demo-1', credit: 'Google' }, { type: 'PostCard', beat: 'numbers', weight: 1, post: 'post-1' }, { type: 'DeltaCard', ...(input.scenes[1] as object), weight: 1 } as never, ...input.scenes.slice(3)]);
    const r = resolveEdit(d, { ...actx, receipts: null });
    expect(r.errors).toEqual([]);
    const full = resolveEdit(d, actx);
    expect(full.props!.scenes[1]).toMatchObject({ type: 'DemoClip', video: 'launch/gemini-4/demo-demo-1.mp4', credit: 'Google' });
    const sized = { notes: [], assets: { ...(assets as { assets: object }).assets, 'demo-1': { kind: 'demo', source: 'download', file: 'demo-demo-1.mp4', key: 'k', width: 480, height: 854 } } } as never;
    expect(resolveEdit(d, { ...actx, assets: sized }).props!.scenes[1]).toMatchObject({ type: 'DemoClip', width: 480, height: 854 });
    expect(full.props!.scenes[2]).toMatchObject({ type: 'PostCard', author: 'Google', handle: '@Google', date: 'October 21, 2026', text: 'Gemini 4 is here.' });
    expect(resolveEdit(d, { ...actx, demos: [], posts: [] }).errors.join('\n')).toMatch(/demo-1[\s\S]*post-1/);
    const refused = { notes: [], assets: { 'demo-1': { kind: 'demo', source: 'refused', file: '', key: 'k', reason: 'the link is not a video' }, 'post-1': { kind: 'post', source: 'refused', file: '', key: 'k', reason: 'X does not show that post' } } } as never;
    expect(resolveEdit(d, { ...actx, assets: refused }).errors.join('\n')).toMatch(/the link is not a video[\s\S]*X does not show that post/);
  });

  it('refuses a DemoClip scene longer than 8 seconds', () => {
    const long = base([input.scenes[0], { type: 'DemoClip', beat: 'numbers', weight: 1, clip: 'demo-1', credit: 'Google' }, input.scenes[3], input.scenes[4]]);
    const slow = { fps: 30, totalFrames: 480, beats: [{ id: 'hook', start: 0, end: 60 }, { id: 'numbers', start: 60, end: 360 }, { id: 'catch', start: 360, end: 435 }, { id: 'cta', start: 435, end: 480 }] };
    expect(resolveEdit(long, { ...actx, timing: slow }).errors.join('\n')).toMatch(/DemoClip.*at most 8 seconds/);
  });

  it('keeps structure-only passes free of asset checks', () => {
    expect(resolveEdit(withAvatar, { ...actx, assets: null, receipts: null }).errors).toEqual([]);
  });

  it('collects the receipt claims AvatarTalk shows', () => {
    expect(receiptClaims(withAvatar)).toEqual(['c3']);
  });
});

describe('editPrompt for the new scenes', () => {
  const c = { script, claims, timing };
  const faceless = { mode: 'faceless', demos: [], posts: [] } as never;
  it('says nothing of the anchor, demos or posts in a plain faceless reel', () => {
    const p = editPrompt({ ...c, brief: faceless });
    expect(p).not.toMatch(/AvatarTalk|BRoll|DemoClip|PostCard/);
  });
  it('shows the current edit list to be revised, before the notes', () => {
    const previous = { scenes: [{ type: 'EndCard', beat: 'cta', weight: 1, line: 'Follow for every launch' }] } as never;
    const p = editPrompt({ ...c, brief: faceless, previous, notes: 'Bigger numbers.' });
    expect(p).toContain('The current edit list, to be revised:');
    expect(p).toContain('Follow for every launch');
    expect(p.indexOf('to be revised')).toBeLessThan(p.indexOf('Bigger numbers.'));
    expect(editPrompt({ ...c, brief: faceless })).not.toContain('to be revised');
  });
  it('offers the anchor and b-roll in avatar mode, with the 50% cap', () => {
    const p = editPrompt({ ...c, brief: { mode: 'avatar', demos: [], posts: [] } as never });
    expect(p).toMatch(/AvatarTalk \{/);
    expect(p).toMatch(/BRoll \{/);
    expect(p).toMatch(/at most 50%/);
    expect(p).not.toMatch(/DemoClip|PostCard/);
  });
  it('with a reference, asks for scenes of about its median shot length, clamped to 2-6 s', () => {
    const ref = (m: number) => ({ id: 'AAAAA1', creator: 'v', url: 'https://i.com/r', topic: 't', hookSec: 2, medianShotSec: m });
    expect(editPrompt({ ...c, brief: { mode: 'faceless', demos: [], posts: [], reference: ref(3.25) } as never })).toMatch(/about 3\.3 seconds/);
    expect(editPrompt({ ...c, brief: { mode: 'faceless', demos: [], posts: [], reference: ref(0.9) } as never })).toMatch(/about 2 seconds/);
    expect(editPrompt({ ...c, brief: { mode: 'faceless', demos: [], posts: [], reference: ref(11) } as never })).toMatch(/about 6 seconds/);
    expect(editPrompt({ ...c, brief: faceless })).not.toMatch(/- Pace:/);
  });
  it('lists the demo clips and posts the reel has', () => {
    const p = editPrompt({ ...c, brief: { mode: 'faceless', demos: [{ id: 'demo-1', url: 'https://x.dev/d.mp4' }], posts: [{ id: 'post-1', url: 'https://x.com/a/status/1' }] } as never });
    expect(p).toContain('demo-1 (https://x.dev/d.mp4)');
    expect(p).toContain('post-1 (https://x.com/a/status/1)');
    expect(p).toMatch(/DemoClip \{/);
  });
});

describe('the creator look', () => {
  it('accepts a face cam weighted up to 8 against short cutaways, so it can hold 80% of a beat', () => {
    const talk = { type: 'AvatarTalk', beat: 'what', layout: 'photo' } as const;
    expect(SceneInSchema.safeParse({ ...talk, weight: 8 }).success).toBe(true);
    expect(SceneInSchema.safeParse({ ...talk, weight: 9 }).success).toBe(false);
  });

  const c = { script, claims, timing };
  const faceless = { mode: 'faceless', demos: [], posts: [] } as never;
  const creatorTiming = { fps: 30, totalFrames: 300, beats: [
    { id: 'hook', start: 0, end: 60 }, { id: 'numbers', start: 60, end: 180 }, { id: 'catch', start: 180, end: 255 }, { id: 'cta', start: 255, end: 300 },
  ] };
  const broll = { type: 'BRoll', beat: 'hook', weight: 1, prompt: 'A phone on a desk', motion: 'Push in; screen glows' } as const;
  const fast: EditInput = { scenes: [
    broll,
    { type: 'Headline', beat: 'hook', weight: 1, kicker: 'BREAKING', title: 'Gemini 4 is here.' },
    { type: 'DeltaCard', beat: 'numbers', weight: 1, label: 'Price per 1M input tokens', before: 'c1', after: 'c2', better: 'lower', word: 'cheaper' },
    { type: 'BRoll', beat: 'numbers', weight: 1, prompt: 'A laptop', motion: 'Orbit left' },
    { type: 'Receipt', beat: 'catch', weight: 1, claim: 'c3' },
    { type: 'BRoll', beat: 'catch', weight: 1, prompt: 'A router' },
    { type: 'EndCard', beat: 'cta', weight: 1, line: 'Follow' },
  ] };
  const cctx = { ...ctx, timing: creatorTiming, look: 'creator' as const, assets: null };

  it('accepts a motion of at most 160 characters on a BRoll', () => {
    expect(SceneInSchema.safeParse(broll).success).toBe(true);
    expect(SceneInSchema.safeParse({ ...broll, motion: 'x'.repeat(161) }).success).toBe(false);
  });
  it('passes the look into the render props', () => {
    const r = resolveEdit(fast, cctx);
    expect(r.errors).toEqual([]);
    expect(r.props?.look).toBe('creator');
    expect(resolveEdit(input, ctx).props?.look).toBeUndefined();
  });
  it('refuses a hook that opens on a plain Headline', () => {
    const bad = { scenes: [fast.scenes[1], fast.scenes[0], ...fast.scenes.slice(2)] } as EditInput;
    expect(resolveEdit(bad, cctx).errors.join('\n')).toMatch(/never on a plain Headline/);
  });
  it('refuses a static scene over 2.5 seconds, and lets a moving scene run long', () => {
    const slow = { scenes: [broll, { type: 'Headline', beat: 'hook', weight: 1, kicker: 'B', title: 'T' }, { type: 'DeltaCard', beat: 'numbers', weight: 1, label: 'P', before: 'c1', after: 'c2', better: 'lower', word: 'cheaper' }, { type: 'Receipt', beat: 'catch', weight: 1, claim: 'c3' }, { type: 'EndCard', beat: 'cta', weight: 1, line: 'F' }] } as EditInput;
    expect(resolveEdit(slow, cctx).errors.join('\n')).toMatch(/DeltaCard scene runs 4\.0 seconds.*at most 2\.5/);
  });
  it('lets the face cam take up to 80% of the creator reel but only 50% of the newsroom one', () => {
    const talk = (beat: 'hook' | 'numbers' | 'catch', over?: string) => ({ type: 'AvatarTalk', beat, weight: 1, layout: over ? 'split' : 'photo', ...(over ? { over } : {}) }) as const;
    const heavy: EditInput = { scenes: [talk('hook'), talk('numbers', 'c3'), { type: 'DeltaCard', beat: 'numbers', weight: 0.5, label: 'P', before: 'c1', after: 'c2', better: 'lower', word: 'cheaper' }, talk('catch'), { type: 'BRoll', beat: 'cta', weight: 1, prompt: 'x' }] };
    const a = { ...cctx, mode: 'avatar' as const, script: { ...(script as object), beats: ['hook', 'numbers', 'catch', 'cta'].map((id) => ({ id, narration: 'x', emphasis: [], claims: [] })) } as never };
    expect(resolveEdit(heavy, a).errors.join(' ')).not.toMatch(/AvatarTalk scenes take/);
    expect(resolveEdit(heavy, { ...a, look: 'newsroom' }).errors.join(' ')).toMatch(/AvatarTalk scenes take .*at most 50%/);
  });
  it('needs an over claim for a split AvatarTalk, in the schema and in the gate', () => {
    expect(SceneInSchema.safeParse({ type: 'AvatarTalk', beat: 'hook', weight: 1, layout: 'split' }).success).toBe(false);
    expect(SceneInSchema.safeParse({ type: 'AvatarTalk', beat: 'hook', weight: 1, layout: 'split', over: 'c3' }).success).toBe(true);
  });
  it('writes the creator pacing into the prompt and offers b-roll without an anchor', () => {
    const p = editPrompt({ ...c, brief: { mode: 'faceless', look: 'creator', demos: [], posts: [] } as never });
    expect(p).toMatch(/about 2\.5 seconds or less/);
    expect(p).toMatch(/longer than 2\.5 seconds/);
    expect(p).toMatch(/never on a plain Headline/);
    expect(p).toMatch(/1\.5 to 3 seconds, and the reel has 2 to 4/);
    expect(p).toMatch(/BRoll \{/);
    expect(p).not.toMatch(/AvatarTalk \{/);
    expect(editPrompt({ ...c, brief: faceless })).not.toMatch(/about 2\.5 seconds/);
  });
  it('tells the creator look its b-roll title is not shown, and the newsroom look it gets a headline band', () => {
    const creator = editPrompt({ ...c, brief: { mode: 'faceless', look: 'creator', demos: [], posts: [] } as never });
    expect(creator).toMatch(/title is not shown in the creator look/);
    expect(creator).not.toMatch(/with a headline band/);
    expect(editPrompt({ ...c, brief: { mode: 'avatar', look: 'newsroom', demos: [], posts: [] } as never })).toMatch(/with a headline band/);
  });
});
