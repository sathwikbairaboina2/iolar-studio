import { describe, it, expect, vi, beforeEach } from 'vitest';
import { mkdtempSync, writeFileSync, existsSync, readFileSync } from 'fs';
import { tmpdir } from 'os';
import path from 'path';
import { extractJson } from '@/lib/ai/revise';
import { diffPosts } from '@/lib/ai/diff';
import { validatePost, Post } from '@/lib/schema';

const base = (): Post => validatePost({
  brand: 'iolar', template: 'spiral-notes', ratio: '3:4', seed: 1,
  series: 'S', date: 'd',
  slides: [{ page_title: 'P1', blocks: [{ type: 'heading', text: 'A' }] }],
  caption: { text: '', hashtags: [] },
});

describe('extractJson', () => {
  it('parses fenced output', () => {
    expect(extractJson('Here you go:\n```json\n{"a":1}\n```\nthanks')).toEqual({ a: 1 });
  });
  it('parses bare output with prose prefix', () => {
    expect(extractJson('Sure! {"a":{"b":2}} done')).toEqual({ a: { b: 2 } });
  });
  it('throws when no JSON', () => {
    expect(() => extractJson('no json here')).toThrow();
  });
});

describe('diffPosts', () => {
  it('flags changed block and added slide, ignores identical', () => {
    const before = base();
    const after = structuredClone(before);
    (after.slides[0].blocks[0] as { text: string }).text = 'B';
    after.slides.push({ page_title: 'P2', blocks: [{ type: 'paragraph', text: 'new' }] });
    const d = diffPosts(before, after);
    expect(d.length).toBe(2);
    expect(d[0]).toMatchObject({ slide: 1, kind: 'changed' });
    expect(d[0].blocks[0].kind).toBe('changed');
    expect(d[1]).toMatchObject({ slide: 2, kind: 'added' });
    expect(diffPosts(before, structuredClone(before))).toEqual([]);
  });
});

describe('revise route', () => {
  beforeEach(() => {
    process.env.IOLAR_DATA_DIR = mkdtempSync(path.join(tmpdir(), 'iolar-ai-'));
    // These mock the Claude CLI, so the studio's provider switch is pinned to Claude here;
    // the local model has its own tests.
    writeFileSync(path.join(process.env.IOLAR_DATA_DIR, 'settings.json'), JSON.stringify({ llmProvider: 'claude' }));
    vi.resetModules();
  });

  it('returns proposal+diff without saving; rejects 11-slide proposals', async () => {
    const proposal = base();
    (proposal.slides[0].blocks[0] as { text: string }).text = 'CHANGED';

    vi.doMock('@/lib/ai/claude', () => ({
      runClaude: vi.fn().mockResolvedValue(JSON.stringify(proposal)),
      ClaudeUnavailableError: class extends Error {},
    }));

    const { createSubject, createChapter, savePost, loadPost } = await import('@/lib/store');
    await createSubject('python');
    await createChapter('python', 'ai-demo');
    await savePost('python', 'ai-demo', 1, base());
    const route = await import('@/app/api/handbooks/[subject]/[chapter]/parts/[part]/revise/route');
    const res = await route.POST(
      new Request('http://t/api', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ request: 'change it', scope: 'post' }) }),
      { params: Promise.resolve({ subject: 'python', chapter: 'ai-demo', part: '1' }) }
    );
    const body = await res.json();
    expect(res.status).toBe(200);
    expect(body.diff.length).toBe(1);
    // disk unchanged
    const onDisk = await loadPost('python', 'ai-demo', 1);
    expect((onDisk.slides[0].blocks[0] as { text: string }).text).toBe('A');
    // chat history persisted
    const dataDir = process.env.IOLAR_DATA_DIR!;
    expect(existsSync(path.join(dataDir, 'handbooks', 'python', 'ai-demo', 'parts', '01', 'chat.json'))).toBe(true);
    expect(readFileSync(path.join(dataDir, 'handbooks', 'python', 'ai-demo', 'parts', '01', 'chat.json'), 'utf8')).toContain('change it');
  });

  it('accepts more than ten slides — the cap is advisory', async () => {
    const big = base();
    big.slides = Array.from({ length: 11 }, (_, i) => ({ page_title: `P${i}`, blocks: [{ type: 'heading' as const, text: 'x' }] }));

    vi.doMock('@/lib/ai/claude', () => ({
      runClaude: vi.fn().mockResolvedValue(JSON.stringify(big)),
      ClaudeUnavailableError: class extends Error {},
    }));

    const { createSubject, createChapter, savePost } = await import('@/lib/store');
    await createSubject('python');
    await createChapter('python', 'ai-cap');
    await savePost('python', 'ai-cap', 1, base());
    const route = await import('@/app/api/handbooks/[subject]/[chapter]/parts/[part]/revise/route');
    const res = await route.POST(
      new Request('http://t/api', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ request: 'expand', scope: 'post' }) }),
      { params: Promise.resolve({ subject: 'python', chapter: 'ai-cap', part: '1' }) }
    );
    expect(res.status).toBe(200);
    expect((await res.json()).proposal.slides.length).toBe(11);
  });

  it('500 when the AI returns an invalid block type', async () => {
    const bad = JSON.parse(JSON.stringify(base()));
    bad.slides[0].blocks[0].type = 'not-a-block';

    vi.doMock('@/lib/ai/claude', () => ({
      runClaude: vi.fn().mockResolvedValue(JSON.stringify(bad)),
      ClaudeUnavailableError: class extends Error {},
    }));

    const { createSubject, createChapter, savePost } = await import('@/lib/store');
    await createSubject('python');
    await createChapter('python', 'ai-bad');
    await savePost('python', 'ai-bad', 1, base());
    const route = await import('@/app/api/handbooks/[subject]/[chapter]/parts/[part]/revise/route');
    const res = await route.POST(
      new Request('http://t/api', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ request: 'break it', scope: 'post' }) }),
      { params: Promise.resolve({ subject: 'python', chapter: 'ai-bad', part: '1' }) }
    );
    expect(res.status).toBeGreaterThanOrEqual(400);
  });
});
