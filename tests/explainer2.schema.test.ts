import { describe, expect, it } from 'vitest';
import { BriefSchema, FactCheckSchema, JobSchema, ScriptSchema, STAGES, TimingSchema, newJob } from '@/lib/explainer2/schema';

const beat = (i: number, over: Record<string, unknown> = {}) => ({
  id: `b${i}`, caption: 'A short caption', narration: 'A spoken sentence that carries the beat.', visual: 'The cache card turns green.', ...over,
});
const script = (over: Record<string, unknown> = {}) => ({
  title: 'Why caching feels instant',
  hook: { before: { value: 800, unit: 'ms', label: 'Without a cache' }, after: { value: 20, unit: 'ms', label: 'With a cache' } },
  beats: [1, 2, 3, 4].map((i) => beat(i)),
  facts: ['A Redis read is typically under a millisecond.'],
  ...over,
});

describe('BriefSchema', () => {
  it('accepts a brief and bounds the length', () => {
    expect(BriefSchema.safeParse({ topic: 'Caching', audience: 'engineers', claim: 'Caches trade freshness for speed', seconds: 30 }).success).toBe(true);
    expect(BriefSchema.safeParse({ topic: 'Caching', audience: 'engineers', claim: 'x', seconds: 19 }).success).toBe(false);
    expect(BriefSchema.safeParse({ topic: 'Caching', audience: 'engineers', claim: 'x', seconds: 46 }).success).toBe(false);
    expect(BriefSchema.safeParse({ topic: '', audience: 'a', claim: 'x', seconds: 30 }).success).toBe(false);
  });
});

describe('ScriptSchema limits', () => {
  it('accepts a valid script', () => expect(ScriptSchema.safeParse(script()).success).toBe(true));
  it('caps the title at 40 characters', () => {
    expect(ScriptSchema.safeParse(script({ title: 'x'.repeat(40) })).success).toBe(true);
    expect(ScriptSchema.safeParse(script({ title: 'x'.repeat(41) })).success).toBe(false);
  });
  it('wants 4 to 7 beats', () => {
    expect(ScriptSchema.safeParse(script({ beats: [1, 2, 3].map((i) => beat(i)) })).success).toBe(false);
    expect(ScriptSchema.safeParse(script({ beats: [1, 2, 3, 4, 5, 6, 7].map((i) => beat(i)) })).success).toBe(true);
    expect(ScriptSchema.safeParse(script({ beats: [1, 2, 3, 4, 5, 6, 7, 8].map((i) => beat(i)) })).success).toBe(false);
  });
  it('caps caption at 80 and narration at 220', () => {
    expect(ScriptSchema.safeParse(script({ beats: [beat(1, { caption: 'x'.repeat(81) }), beat(2), beat(3), beat(4)] })).success).toBe(false);
    expect(ScriptSchema.safeParse(script({ beats: [beat(1, { narration: 'x'.repeat(221) }), beat(2), beat(3), beat(4)] })).success).toBe(false);
    expect(ScriptSchema.safeParse(script({ beats: [beat(1, { caption: 'x'.repeat(80), narration: 'x'.repeat(220) }), beat(2), beat(3), beat(4)] })).success).toBe(true);
  });
  it('needs unique beat ids of the form b<number>', () => {
    expect(ScriptSchema.safeParse(script({ beats: [beat(1), beat(1), beat(3), beat(4)] })).success).toBe(false);
    expect(ScriptSchema.safeParse(script({ beats: [beat(1, { id: 'intro' }), beat(2), beat(3), beat(4)] })).success).toBe(false);
  });
  it('needs a numeric hook reading', () => {
    expect(ScriptSchema.safeParse(script({ hook: { before: { value: '800', unit: 'ms', label: 'x' }, after: { value: 20, unit: 'ms', label: 'y' } } })).success).toBe(false);
  });
});

describe('FactCheckSchema / TimingSchema / JobSchema', () => {
  it('parses a fact check', () => {
    expect(FactCheckSchema.safeParse({ ok: false, issues: [{ beat: 'b2', claim: 'x', correction: 'y' }] }).success).toBe(true);
    expect(FactCheckSchema.safeParse({ ok: true }).success).toBe(false);
  });
  it('parses timing', () => {
    expect(TimingSchema.safeParse({ fps: 30, totalFrames: 100, beats: [{ id: 'b1', start: 0, end: 100 }] }).success).toBe(true);
  });
  it('a new job has every stage pending except brief', () => {
    const j = JobSchema.parse(newJob('caching', '2026-10-19T00:00:00.000Z'));
    expect(j.stages.brief.status).toBe('done');
    for (const s of STAGES.filter((s) => s !== 'brief')) expect(j.stages[s].status).toBe('pending');
  });
});

describe('max additions', () => {
  it('a beat may carry emphasis words, at most 6 of 40 characters', () => {
    expect(ScriptSchema.safeParse(script({ beats: [beat(1, { emphasis: ['30 ms', 'cache'] }), beat(2), beat(3), beat(4)] })).success).toBe(true);
    expect(ScriptSchema.safeParse(script({ beats: [beat(1, { emphasis: Array(7).fill('x') }), beat(2), beat(3), beat(4)] })).success).toBe(false);
    expect(ScriptSchema.safeParse(script({ beats: [beat(1, { emphasis: ['x'.repeat(41)] }), beat(2), beat(3), beat(4)] })).success).toBe(false);
  });
  it('timing beats may carry the voice length, the words and how they were timed', () => {
    const ok = { fps: 30, totalFrames: 100, beats: [{ id: 'b1', start: 0, end: 100, voice: 80, method: 'whisper', words: [{ w: 'Hi', startFrame: 0, endFrame: 10 }] }] };
    expect(TimingSchema.safeParse(ok).success).toBe(true);
    expect(TimingSchema.safeParse({ ...ok, beats: [{ ...ok.beats[0], method: 'guess' }] }).success).toBe(false);
  });
  it('has a critic stage between the checks and the render', () => {
    expect(STAGES.indexOf('critic')).toBe(STAGES.indexOf('gates') + 1);
    expect(STAGES.indexOf('render')).toBe(STAGES.indexOf('critic') + 1);
  });
  it('reads a job saved before the critic stage: done once rendered, otherwise pending', () => {
    const old = (render: string) => {
      const j = newJob('caching', '2026-10-19T00:00:00.000Z') as unknown as { stages: Record<string, unknown> };
      delete j.stages.critic;
      j.stages.render = { status: render };
      return j;
    };
    expect(JobSchema.parse(old('done')).stages.critic.status).toBe('done');
    expect(JobSchema.parse(old('pending')).stages.critic.status).toBe('pending');
  });
});

