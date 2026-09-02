import { describe, it, expect, vi, beforeEach } from 'vitest';
import { mkdtempSync } from 'fs';
import { tmpdir } from 'os';
import path from 'path';

beforeEach(() => {
  vi.resetModules();
  process.env.IOLAR_DATA_DIR = mkdtempSync(path.join(tmpdir(), 'is-mem-'));
});

const brief = {
  runId: 'r',
  createdAt: '2026-09-02T00:00:00.000Z',
  topic: 'SQLite',
  angle: 'a',
  audience: 'b',
  videoFormat: 'reel',
  mustProve: ['one', 'two'],
  mustInclude: [],
  avoid: [],
  recencyWindowDays: 30,
  sourceClasses: ['docs'],
  searchQueries: [{ class: 'docs', queries: ['q'] }],
  referenceReel: null,
  status: 'briefed',
};

const planReply = JSON.stringify({ approach: 'x', queries: [{ class: 'docs', query: 'q', proves: 'one', why: 'w' }] });

describe('memory in the graph', () => {
  it('the plan node asks for domains and hands the block to the planner, and says so in the trace', async () => {
    const store = await import('@/lib/reel/research/store');
    await store.writeBrief('r', brief as never);
    const prompts: string[] = [];
    const run = vi.fn(async (p: string) => {
      prompts.push(p);
      return planReply;
    });
    const domains = vi.fn(async () => ({ block: 'What worked before for topics like these:\n  sqlite.org kept 5, rejected 0', count: 1 }));
    const { advanceResearch } = await import('@/lib/reel/research/graph');
    await advanceResearch('r', {
      run,
      researchUrl: 'http://x',
      recall: { domains, verdicts: vi.fn(), claims: vi.fn(), passages: vi.fn() } as never,
    });
    expect(domains).toHaveBeenCalledOnce();
    expect(prompts[0]).toContain('MEMORY\nWhat worked before');
    const { readTrace } = await import('@/lib/reel/research/trace');
    expect((await readTrace('r')).some((e) => /memory: 1 domain known/.test(String(e.text)))).toBe(true);
  });

  it('with no recall in deps the planner runs exactly as before', async () => {
    const store = await import('@/lib/reel/research/store');
    await store.writeBrief('r', brief as never);
    const prompts: string[] = [];
    const run = vi.fn(async (p: string) => {
      prompts.push(p);
      return planReply;
    });
    const { advanceResearch } = await import('@/lib/reel/research/graph');
    await advanceResearch('r', { run, researchUrl: 'http://x', recall: undefined });
    expect(prompts[0]).not.toContain('MEMORY');
  });
});
