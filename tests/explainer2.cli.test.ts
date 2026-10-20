import { mkdtempSync, writeFileSync } from 'fs';
import os from 'os';
import path from 'path';
import { describe, expect, it, vi } from 'vitest';
import { parseArgs, runCli, summarize } from '@/lib/explainer2/cli';

const BRIEF = { topic: 'Rate limiting', audience: 'backend engineers', claim: 'Limits protect shared capacity', seconds: 30 };

describe('parseArgs', () => {
  it('takes a brief file, or a slug to resume', () => {
    expect(parseArgs(['brief.json'])).toEqual({ brief: 'brief.json' });
    expect(parseArgs(['--slug', 'caching'])).toEqual({ slug: 'caching' });
    expect(parseArgs(['--slug', 'caching', '--from', 'design'])).toEqual({ slug: 'caching', from: 'design' });
    expect(parseArgs(['--slug', 'caching', '--only', 'render'])).toEqual({ slug: 'caching', only: 'render' });
    expect(parseArgs(['--slug', 'caching', '--override'])).toEqual({ slug: 'caching', override: true });
  });
  it('rejects nonsense', () => {
    expect(() => parseArgs([])).toThrow(/usage/);
    expect(() => parseArgs(['--slug'])).toThrow(/usage/);
    expect(() => parseArgs(['--slug', 'a', '--from', 'dance'])).toThrow(/stage/);
    expect(() => parseArgs(['a.json', '--slug', 'b'])).toThrow(/usage/);
  });
});

describe('runCli', () => {
  const deps = () => ({ run: vi.fn(), speak: vi.fn(), probe: vi.fn(), proc: vi.fn() });

  it('creates from a brief file and runs every stage', async () => {
    process.env.IOLAR_DATA_DIR = mkdtempSync(path.join(os.tmpdir(), 'x2-cli-'));
    const file = path.join(process.env.IOLAR_DATA_DIR, 'brief.json');
    writeFileSync(file, JSON.stringify(BRIEF));
    const runJob = vi.fn(async (slug: string) => ({ slug, stages: { render: { status: 'done' } } }));
    const lines: string[] = [];
    const out = await runCli(['brief.json'].map(() => file), { deps: async () => deps() as never, runJob: runJob as never, log: (l) => lines.push(l) });
    expect(out.slug).toBe('rate-limiting');
    expect(runJob).toHaveBeenCalledWith('rate-limiting', expect.anything(), {});
    expect(lines.join('\n')).toContain('rate-limiting');
  });

  it('refuses an invalid brief before doing anything', async () => {
    process.env.IOLAR_DATA_DIR = mkdtempSync(path.join(os.tmpdir(), 'x2-cli-'));
    const file = path.join(process.env.IOLAR_DATA_DIR, 'brief.json');
    writeFileSync(file, JSON.stringify({ ...BRIEF, seconds: 3 }));
    const runJob = vi.fn();
    await expect(runCli([file], { deps: async () => deps() as never, runJob: runJob as never, log: () => {} })).rejects.toThrow(/seconds/);
    expect(runJob).not.toHaveBeenCalled();
  });

  it('resumes a slug with from', async () => {
    process.env.IOLAR_DATA_DIR = mkdtempSync(path.join(os.tmpdir(), 'x2-cli-'));
    const runJob = vi.fn(async (slug: string) => ({ slug, stages: {} }));
    await runCli(['--slug', 'caching', '--from', 'design'], { deps: async () => deps() as never, runJob: runJob as never, log: () => {} });
    expect(runJob).toHaveBeenCalledWith('caching', expect.anything(), { from: 'design' });
  });
});

describe('summarize', () => {
  it('prints one line per stage, with the error under a failed one', () => {
    const text = summarize({
      slug: 'x', renderId: 'abc',
      stages: { brief: { status: 'done' }, script: { status: 'done' }, factcheck: { status: 'failed', error: 'boom' }, voice: { status: 'pending' }, design: { status: 'pending' }, gates: { status: 'pending' }, render: { status: 'pending' } },
    } as never);
    expect(text).toContain('factcheck');
    expect(text).toContain('failed');
    expect(text).toContain('boom');
    expect(text.split('\n').length).toBeGreaterThanOrEqual(7);
  });
});
