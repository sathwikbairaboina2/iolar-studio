import { describe, expect, it } from 'vitest';
import { BriefInputSchema, ClaimsSchema, JobSchema, scriptSchemaFor, newJob, STAGES } from '@/lib/launch/schema';

const beat = (id: string, claims: string[] = []) => ({ id, narration: `${id} words.`, claims });

describe('brief', () => {
  it('fills the defaults', () => {
    const b = BriefInputSchema.parse({ title: 'Gemini 4', links: ['https://blog.google/gemini-4'] });
    expect(b).toMatchObject({ mode: 'faceless', speed: 'fast', seconds: 45, creditBudget: 0 });
  });
  it('refuses a non-http link', () => {
    expect(() => BriefInputSchema.parse({ title: 'x', links: ['file:///c:/x'] })).toThrow();
  });
  const reference = { id: 'AAAAA1', creator: 'varunmayya', url: 'https://instagram.com/reel/AAAAA1', topic: 'Gemini 4 launch', hookSec: 2.5, medianShotSec: 3.25 };
  it('wants a link, or a reference to take the topic from', () => {
    expect(() => BriefInputSchema.parse({ title: 'x', links: [] })).toThrow(/give at least one link/);
    const b = BriefInputSchema.parse({ title: 'Gemini 4 launch', links: [], reference });
    expect(b.reference?.hookSec).toBe(2.5);
  });
});

describe('claims', () => {
  it('refuses duplicate ids', () => {
    const c = { id: 'c1', text: 't', url: 'https://a.b/c', quote: 'quote text' };
    expect(() => ClaimsSchema.parse({ claims: [c, c] })).toThrow(/unique/);
  });
});

describe('script', () => {
  const schema = scriptSchemaFor(['c1', 'c2']);
  const ok = { headline: 'Gemini 4 is here', kicker: 'BREAKING', beats: [beat('hook'), beat('numbers', ['c1']), beat('catch', ['c2']), beat('cta')] };
  it('accepts the arc in order', () => expect(schema.parse(ok).beats).toHaveLength(4));
  it('refuses beats out of arc order', () => {
    expect(() => schema.parse({ ...ok, beats: [beat('numbers'), beat('hook'), beat('catch'), beat('cta')] })).toThrow(/arc order/);
  });
  it('requires hook, numbers, catch and cta', () => {
    expect(() => schema.parse({ ...ok, beats: [beat('hook'), beat('what'), beat('numbers'), beat('cta')] })).toThrow(/catch beat is required/);
  });
  it('refuses a claim id that does not exist', () => {
    expect(() => schema.parse({ ...ok, beats: [beat('hook'), beat('numbers', ['c9']), beat('catch'), beat('cta')] })).toThrow(/c9/);
  });
});

describe('job', () => {
  it('starts with the brief done and everything else pending, not approved', () => {
    const j = newJob('gemini-4', '2026-10-21T00:00:00.000Z');
    expect(j.stages.brief.status).toBe('done');
    expect(STAGES.filter((s) => s !== 'brief').every((s) => j.stages[s].status === 'pending')).toBe(true);
    expect(j.approved).toBe(false);
  });

  it('ends with the critic stage', () => {
    expect(STAGES.at(-1)).toBe('critic');
  });

  it('loads a job written before the critic stage: done when the render is, else pending', () => {
    const old = (render: string) => {
      const j = newJob('gemini-4', '2026-10-21T00:00:00.000Z');
      const { critic: _c, ...stages } = j.stages;
      return { ...j, stages: { ...stages, render: { status: render } } };
    };
    expect(JobSchema.parse(old('done')).stages.critic.status).toBe('done');
    expect(JobSchema.parse(old('pending')).stages.critic.status).toBe('pending');
  });
});
