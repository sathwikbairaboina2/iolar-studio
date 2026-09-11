import { describe, expect, it, vi } from 'vitest';
import { AuthorError, draft, revise } from '@/lib/explainer/author';
import { ExplainerDocSchema, type ExplainerDoc } from '@/lib/explainer/schema';

const BRIEF = { topic: 'database indexes', audience: 'backend engineers', claim: 'an index turns a scan into a lookup', seconds: 16 };

const good = (over: Record<string, unknown> = {}) => JSON.stringify({
  template: 'explainer',
  theme: 'midnight',
  brand: { handle: '@stackframe', name: 'Stack Frame' },
  scene: {
    title: 'Indexes',
    rows: [{ id: 'scan', label: 'Scan', value: 200, unit: ' ms' }, { id: 'index', label: 'Index', value: 200, unit: ' ms' }],
    links: [],
    panel: [],
  },
  beats: [
    { id: 'b1', role: 'hook', mutations: [{ op: 'text', field: 'note', to: 'Same query.' }] },
    { id: 'b2', role: 'payoff', mutations: [{ op: 'set', row: 'index', value: 2, state: 'good' }] },
  ],
  ...over,
});

/** A document that parses and cannot fold: b1 changes a row nothing has put on the board. */
const unfoldable = () => good({
  beats: [
    { id: 'b1', role: 'hook', mutations: [{ op: 'set', row: 'ghost', state: 'good' }] },
    { id: 'b2', role: 'payoff', mutations: [{ op: 'set', row: 'index', value: 2 }] },
  ],
});

describe('drafting', () => {
  it('folds what comes back and keeps the brief with it', async () => {
    const run = vi.fn(async (_prompt: string) => good());
    const doc = await draft(BRIEF, { run });
    expect(doc.scene.title).toBe('Indexes');
    expect(doc.brief).toEqual(BRIEF);
    expect(run).toHaveBeenCalledTimes(1);
  });

  it('tells the model the rule that makes an explainer an explainer, and the brief', async () => {
    const run = vi.fn(async (_prompt: string) => good());
    await draft(BRIEF, { run });
    const prompt = run.mock.calls[0][0];
    expect(prompt).toMatch(/ONE board that mutates/);
    expect(prompt).toMatch(/database indexes/);
    expect(prompt).toMatch(/an index turns a scan into a lookup/);
    expect(prompt).toMatch(/about 16 seconds/);
  });

  it('takes a document wrapped in prose and fences', async () => {
    const run = vi.fn(async (_prompt: string) => `Sure! Here you go:\n\`\`\`json\n${good()}\n\`\`\`\nHope that helps.`);
    expect((await draft(BRIEF, { run })).scene.title).toBe('Indexes');
  });

  it('asks once more with its own error when the document will not fold', async () => {
    const run = vi.fn(async (_prompt: string) => good())
      .mockResolvedValueOnce(unfoldable())
      .mockResolvedValueOnce(good());
    const doc = await draft(BRIEF, { run });
    expect(doc.scene.title).toBe('Indexes');
    expect(run).toHaveBeenCalledTimes(2);
    expect(run.mock.calls[1][0]).toMatch(/previous answer was rejected: [\s\S]*ghost/);
  });

  it('gives up after the second try, keeping what the model said', async () => {
    const run = vi.fn(async (_prompt: string) => 'I would rather write a poem about indexes.');
    await expect(draft(BRIEF, { run })).rejects.toBeInstanceOf(AuthorError);
    expect(run).toHaveBeenCalledTimes(2);
    try {
      await draft(BRIEF, { run });
    } catch (err) {
      expect((err as AuthorError).said).toMatch(/poem/);
    }
  });
});

describe('revising', () => {
  const current = (): ExplainerDoc => ExplainerDocSchema.parse({ ...JSON.parse(good()), brief: BRIEF });

  it('puts the document, its length and the instruction in front of the model', async () => {
    const run = vi.fn(async (_prompt: string) => good({ theme: 'paper' }));
    const next = await revise(current(), 'make it lighter', { run });
    expect(next.theme).toBe('paper');

    const prompt = run.mock.calls[0][0];
    expect(prompt).toMatch(/CHANGE: make it lighter/);
    expect(prompt).toMatch(/"id":"scan"/);
    expect(prompt).toMatch(/currently runs 7s/);
    expect(prompt).toMatch(/database indexes/);
  });

  it('keeps the brief when the model drops it', async () => {
    const run = vi.fn(async (_prompt: string) => good());
    expect((await revise(current(), 'shorter', { run })).brief).toEqual(BRIEF);
  });
});
