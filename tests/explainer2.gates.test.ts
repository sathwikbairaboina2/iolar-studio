import { describe, expect, it, vi } from 'vitest';
import { checkBeatLayers, checkDuration, checkTextFloor, runGates, scanSource } from '@/lib/explainer2/gates';
import type { Timing } from '@/lib/explainer2/schema';

const TIMING: Timing = { fps: 30, totalFrames: 240, beats: [{ id: 'b1', start: 0, end: 90 }, { id: 'b2', start: 90, end: 240 }] };
const GOOD = `import React from 'react'
import { useCurrentFrame, interpolate } from 'remotion'
import { Stage, Backdrop } from '../../kit'
export const meta = { id: 'designed-x', durationInFrames: 240, fps: 30, width: 1080, height: 1920 }
export default function Video() { const f = useCurrentFrame(); return <Stage><Backdrop /><BeatLayer timing={timing} beats="b1" /></Stage> }
`;

describe('scanSource', () => {
  it('passes a clean video', () => expect(scanSource(GOOD)).toEqual([]));
  it.each([
    ['Math.random', 'const a = Math.random()'],
    ['Date', 'const a = Date.now()'],
    ['Date', 'const a = new Date()'],
    ['fetch', "await fetch('/x')"],
    ['transition', "<div style={{ transition: 'all 1s' }} />"],
    ['animation', "<div style={{ animation: 'spin 1s' }} />"],
    ['setTimeout', 'setTimeout(() => {}, 10)'],
    ['setInterval', 'setInterval(() => {}, 10)'],
    ['useEffect', 'useEffect(() => { }, [])'],
  ])('flags %s', (name, line) => {
    const errs = scanSource(`${GOOD}\n${line}\n`);
    expect(errs.join(' ')).toContain(name);
  });
  it('flags imports from outside remotion, @remotion/*, react and ../../kit', () => {
    expect(scanSource(`${GOOD}\nimport x from 'lodash'`).join(' ')).toContain('lodash');
    expect(scanSource(`${GOOD}\nimport y from '../other'`).join(' ')).toContain('../other');
    expect(scanSource(`${GOOD}\nimport z from 'fs'`).join(' ')).toContain('fs');
    expect(scanSource(`${GOOD}\nconst q = require('path')`).join(' ')).toContain('path');
    expect(scanSource(`${GOOD}\nconst q = await import('os')`).join(' ')).toContain('os');
  });
  it('allows the permitted imports', () => {
    const src = `${GOOD}\nimport { Audio } from '@remotion/media'\nimport { loadFont } from '@remotion/fonts'`;
    expect(scanSource(src)).toEqual([]);
  });
  it('allows the timing and sound json that sit beside the video, and no other json', () => {
    expect(scanSource(`${GOOD}
import timing from './timing.json'
import sound from './sound.json'`)).toEqual([]);
    expect(scanSource(`${GOOD}
import s from './script.json'`).join(' ')).toContain('script.json');
    expect(scanSource(`${GOOD}
import s from '../../../secret.json'`).join(' ')).toContain('secret.json');
  });
  it('ignores forbidden words inside comments', () => {
    expect(scanSource(`${GOOD}\n// never use Math.random or Date here\n/* setTimeout */`)).toEqual([]);
  });
  it('does not mistake words that contain Date', () => expect(scanSource(`${GOOD}\nconst updateDated = 1`)).toEqual([]));
  it('wants a default export and meta', () => {
    expect(scanSource(`import { Stage } from '../../kit'\nexport const meta = {}`).join(' ')).toMatch(/default/);
    expect(scanSource(`import { Stage } from '../../kit'\nexport default function V() { return null }`).join(' ')).toMatch(/meta/);
  });
});

describe('checkDuration', () => {
  it('passes when the literal matches', () => expect(checkDuration(GOOD, TIMING)).toEqual([]));
  it('fails when it differs', () => expect(checkDuration(GOOD.replace('240', '200'), TIMING).join(' ')).toContain('240'));
  it('follows TIMING.totalFrames to its literal', () => {
    const src = `const TIMING = { fps: 30, totalFrames: 240, beats: [] }\nexport const meta = { id: 'a', durationInFrames: TIMING.totalFrames }`;
    expect(checkDuration(src, TIMING)).toEqual([]);
    expect(checkDuration(src.replace('240', '231'), TIMING).join(' ')).toContain('231');
  });
  it('accepts the totalFrames of the timing.json the video imports, and nothing else of that shape', () => {
    const json = `import timing from './timing.json'
export const meta = { id: 'a', durationInFrames: timing.totalFrames }`;
    expect(checkDuration(json, TIMING)).toEqual([]);
    expect(checkDuration(`export const meta = { id: 'a', durationInFrames: timing.totalFrames }`, TIMING).length).toBe(1);
    expect(checkDuration(json.replace('timing.totalFrames', 'other.totalFrames'), TIMING).length).toBe(1);
  });
  it('complains when it cannot find it', () => expect(checkDuration('export default 1', TIMING).length).toBe(1));
});

describe('checkTextFloor', () => {
  it('passes a video with no small text', () => {
    expect(checkTextFloor(`${GOOD}
const a = { fontSize: 40 * U }
const b = { fontSize: 64 }`)).toEqual([]);
  });
  it('flags a plain literal under 40 with its line number', () => {
    const errs = checkTextFloor(`line1
const a = { fontSize: 32 }
`);
    expect(errs).toHaveLength(1);
    expect(errs[0]).toContain('line 2');
    expect(errs[0]).toContain('32');
    expect(errs[0]).toMatch(/at least 40/);
  });
  it('flags `N * U` under 40 and reports each hit', () => {
    const errs = checkTextFloor(`a
b
<div style={{ fontSize: 36 * U }} />
<span style={{ fontSize: 28*U, color: 'x' }} />`);
    expect(errs).toHaveLength(2);
    expect(errs[0]).toContain('line 3');
    expect(errs[1]).toContain('line 4');
  });
  it('ignores comments and computed sizes', () => {
    expect(checkTextFloor(`// fontSize: 20
/* fontSize: 30 * U */
const a = { fontSize: size * 0.4 * U }`)).toEqual([]);
  });
  it('keeps line numbers right after a block comment', () => {
    expect(checkTextFloor(`/* one
two */
const a = { fontSize: 30 }`)[0]).toContain('line 3');
  });
});

describe('checkTextFloor computed sizes', () => {
  it('flags a product of a small named constant and U, naming the binding', () => {
    const errs = checkTextFloor(`a
const labelSize = 36
<div style={{ fontSize: labelSize * U }} />`);
    expect(errs).toHaveLength(1);
    expect(errs[0]).toContain('line 3');
    expect(errs[0]).toContain('labelSize * U is 36 px (labelSize = 36)');
    expect(errs[0]).toMatch(/at least 40/);
  });
  it('passes a default that keeps the product at or over 40', () => {
    expect(checkTextFloor(`const C = ({ size = 120 }) => <div style={{ fontSize: size * 0.4 * U }} />`)).toEqual([]);
  });
  it('uses the smallest candidate, including a JSX attribute', () => {
    const errs = checkTextFloor(`const C = ({ size = 120 }) => <div style={{ fontSize: size * 0.4 * U }} />
<C size={80} />`);
    expect(errs).toHaveLength(1);
    expect(errs[0]).toContain('line 1');
    expect(errs[0]).toContain('32 px (size = 80)');
  });
  it('skips ternaries, sums, calls and unbound identifiers', () => {
    expect(checkTextFloor(`const a = { fontSize: big ? 60 : 30 }
const b = { fontSize: base + 4 }
const c = { fontSize: Math.round(x) * U }
const d = { fontSize: mystery * U }`)).toEqual([]);
  });
});

describe('checkBeatLayers', () => {
  const NO_LAYER = GOOD.replace('<BeatLayer timing={timing} beats="b1" />', '');
  it('passes a video that uses BeatLayer', () => expect(checkBeatLayers(GOOD)).toEqual([]));
  it('requires at least one BeatLayer', () => {
    const errs = checkBeatLayers(NO_LAYER);
    expect(errs).toHaveLength(1);
    expect(errs[0]).toContain('BeatLayer');
  });
  it('ignores a BeatLayer that only appears in a comment', () => {
    expect(checkBeatLayers(`${NO_LAYER}
// wrap it in <BeatLayer>
/* <BeatLayer> */`)).toHaveLength(1);
  });
  it('accepts literal beat ids, alone or as a range', () => {
    expect(checkBeatLayers(`${GOOD}
<BeatLayer timing={timing} beats={['b2', 'b4']}>`)).toEqual([]);
  });
  it('flags a BeatLayer whose beats are computed, with its line number', () => {
    const src = `${GOOD}
<BeatLayer timing={TIMING} beats={[TIMING.beats[Math.max(0, a - 1)].id, TIMING.beats[b].id]}>`;
    const errs = checkBeatLayers(src);
    expect(errs).toHaveLength(1);
    expect(errs[0]).toContain(`line ${src.split('\n').length}`);
    expect(errs[0]).toContain('literal');
  });
  it('flags a hand-rolled fade out at a beat boundary with its line number', () => {
    const src = `${GOOD}
const a = 1
<div style={{ opacity: 1 - t01(frame, B3 - LEAD, B3 + 2) }} />
`;
    const errs = checkBeatLayers(src);
    expect(errs).toHaveLength(1);
    expect(errs[0]).toContain(`line ${src.split('\n').findIndex((l) => l.includes('opacity')) + 1}`);
    expect(errs[0]).toMatch(/BeatLayer/);
  });
  it('flags interpolate and beats[i].start frames too', () => {
    const errs = checkBeatLayers(`${GOOD}
<div style={{ opacity: 1 - interpolate(frame, [timing.beats[2].start - 4, timing.beats[2].start], [0, 1]) }} />
`);
    expect(errs).toHaveLength(1);
  });
  it('does not flag a fade inside a beat', () => {
    expect(checkBeatLayers(`${GOOD}
<div style={{ opacity: 1 - t01(frame, TAKE_AT, TAKE_AT + 8) }} />
<div style={{ opacity: t01(frame, B3, B3 + 6) }} />`)).toEqual([]);
  });
  it('ignores a fade out written in a comment', () => {
    expect(checkBeatLayers(`${GOOD}
// opacity: 1 - t01(frame, B3 - LEAD, B3 + 2)
/* opacity: 1 - t01(frame, B3, B3 + 2) */`)).toEqual([]);
  });
});

describe('runGates', () => {
  const deps = (over: Record<string, unknown> = {}) => ({
    readVideo: vi.fn().mockResolvedValue(GOOD),
    tsc: vi.fn().mockResolvedValue({ ok: true, output: '' }),
    still: vi.fn().mockResolvedValue({ ok: true, output: '' }),
    ...over,
  });
  it('passes when everything passes, rendering a still per beat at its middle', async () => {
    const d = deps();
    const r = await runGates(TIMING, d);
    expect(r).toEqual({ ok: true, errors: [] });
    expect(d.still).toHaveBeenCalledTimes(2);
    expect(d.still).toHaveBeenNthCalledWith(1, 'b1', 45);
    expect(d.still).toHaveBeenNthCalledWith(2, 'b2', 165);
  });
  it('collects every failure and skips the stills when the type check fails', async () => {
    const d = deps({ tsc: vi.fn().mockResolvedValue({ ok: false, output: 'error TS2322: bad' }), readVideo: vi.fn().mockResolvedValue(`${GOOD}\nMath.random()`) });
    const r = await runGates(TIMING, d);
    expect(r.ok).toBe(false);
    expect(r.errors.join('\n')).toContain('TS2322');
    expect(r.errors.join('\n')).toContain('Math.random');
    expect(d.still).not.toHaveBeenCalled();
  });
  it('ignores type errors in another video sharing the workspace', async () => {
    const output = 'src/designed/videos/other/Video.tsx(4,2): error TS2304: Cannot find name \'END\'.';
    const r = await runGates(TIMING, deps({ slug: 'mine', tsc: vi.fn().mockResolvedValue({ ok: false, output }) }));
    expect(r).toEqual({ ok: true, errors: [] });
  });
  it('still fails on its own or the kit\'s type errors', async () => {
    const output = [
      'src/designed/videos/other/Video.tsx(4,2): error TS2304: Cannot find name \'END\'.',
      'src/designed/videos/mine/Video.tsx(9,1): error TS2322: bad',
      'src/designed/kit/ui.tsx(1,1): error TS2322: kit',
    ].join('\n');
    const d = deps({ slug: 'mine', tsc: vi.fn().mockResolvedValue({ ok: false, output }) });
    const r = await runGates(TIMING, d);
    expect(r.ok).toBe(false);
    expect(r.errors.join('\n')).toContain('videos/mine');
    expect(r.errors.join('\n')).toContain('kit/ui.tsx');
    expect(r.errors.join('\n')).not.toContain('videos/other');
    expect(d.still).not.toHaveBeenCalled();
  });
  it('reports text under 40 px as a gate error', async () => {
    const r = await runGates(TIMING, deps({ readVideo: vi.fn().mockResolvedValue(`${GOOD}\nconst a = { fontSize: 30 * U }`) }));
    expect(r.ok).toBe(false);
    expect(r.errors.join('\n')).toMatch(/fontSize 30.*at least 40/);
  });
  it('reports a video without BeatLayer as a gate error', async () => {
    const r = await runGates(TIMING, deps({ readVideo: vi.fn().mockResolvedValue(GOOD.replace('<BeatLayer timing={timing} beats="b1" />', '')) }));
    expect(r.ok).toBe(false);
    expect(r.errors.join('\n')).toContain('BeatLayer');
  });
  it('fails on a missing video file', async () => {
    const r = await runGates(TIMING, deps({ readVideo: vi.fn().mockRejectedValue(new Error('ENOENT')) }));
    expect(r.ok).toBe(false);
    expect(r.errors[0]).toMatch(/Video\.tsx/);
  });
  it('fails when a still does not render', async () => {
    const still = vi.fn().mockResolvedValueOnce({ ok: true, output: '' }).mockResolvedValueOnce({ ok: false, output: 'boom' });
    const r = await runGates(TIMING, deps({ still }));
    expect(r.ok).toBe(false);
    expect(r.errors.join('\n')).toMatch(/b2/);
  });
});
