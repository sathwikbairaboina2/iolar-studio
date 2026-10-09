import { beforeEach, describe, expect, it, vi } from 'vitest';
const ch = (slug: string, studioOrder: number) => ({ slug, title: slug, summary: '', outline: [], studioOrder });
const chapters = [ch('loop', 0), ch('tasks', 1), ch('http', 2)];
beforeEach(() => vi.resetModules());

describe('checkOrder', async () => {
  const { checkOrder } = await import('@/lib/publish/order');
  it('accepts a valid order', () => expect(checkOrder(['loop', 'tasks', 'http'], { tasks: ['loop'] }, ['loop', 'tasks', 'http'])).toEqual([]));
  it('finds a prerequisite after its chapter, a missing chapter and a cycle', () => {
    expect(checkOrder(['tasks', 'loop', 'http'], { tasks: ['loop'] }, ['loop', 'tasks', 'http']).join(' ')).toMatch(/tasks/);
    expect(checkOrder(['loop', 'tasks'], {}, ['loop', 'tasks', 'http']).join(' ')).toMatch(/http/);
    expect(checkOrder(['loop', 'tasks', 'http'], { loop: ['tasks'], tasks: ['loop'] }, ['loop', 'tasks', 'http']).length).toBeGreaterThan(0);
  });
});

describe('proposeOrder', () => {
  it('uses the AI order when it checks out', async () => {
    vi.doMock('@/lib/ai/claude', () => ({ runClaude: vi.fn().mockResolvedValue(JSON.stringify({ order: ['loop', 'tasks', 'http'], prerequisites: { tasks: ['loop'], http: ['tasks'] }, gaps: ['g'], overlaps: [], confidence: 0.9 })), ClaudeUnavailableError: class extends Error {} }));
    const { proposeOrder } = await import('@/lib/publish/order');
    expect(await proposeOrder('s', chapters)).toMatchObject({ order: ['loop', 'tasks', 'http'], confidence: 0.9, gaps: ['g'] });
  });
  it('falls back to a valid order with confidence 0 when the answer is unusable', async () => {
    vi.doMock('@/lib/ai/claude', () => ({ runClaude: vi.fn().mockResolvedValue('{"order":["ghost","http"],"prerequisites":{"loop":["http"],"http":["loop"]},"confidence":0.99}'), ClaudeUnavailableError: class extends Error {} }));
    const { proposeOrder, checkOrder } = await import('@/lib/publish/order');
    const r = await proposeOrder('s', chapters);
    expect(r.confidence).toBe(0);
    expect(checkOrder(r.order, r.prerequisites, ['loop', 'tasks', 'http'])).toEqual([]);
  });
  it('falls back when Claude is not available', async () => {
    class Unavail extends Error {}
    vi.doMock('@/lib/ai/claude', () => ({ runClaude: vi.fn().mockRejectedValue(new Unavail()), ClaudeUnavailableError: Unavail }));
    const { proposeOrder } = await import('@/lib/publish/order');
    const r = await proposeOrder('s', chapters);
    expect(r).toMatchObject({ order: ['loop', 'tasks', 'http'], confidence: 0 });
  });
});
