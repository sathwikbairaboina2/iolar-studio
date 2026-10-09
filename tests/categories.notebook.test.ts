import { describe, it, expect, vi, beforeEach } from 'vitest';
import { mkdtempSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import path from 'path';
import { CATEGORIES, categoryOf } from '@/lib/handbookCategories';
import { TEMPLATES } from '@/lib/schema';

const rules = (id: string) => categoryOf(id).presentation.pageRules;

describe('categories use the notebook family and its blocks', () => {
  it('every category names a real template, and it is notebook', () => {
    for (const c of CATEGORIES) {
      expect(TEMPLATES, c.id).toContain(c.presentation.template);
      expect(c.presentation.template, c.id).toBe('notebook');
    }
  });

  it('listicle: concept, labelrows with three exact rows, ribbon, benefits pair, banner, block ceiling, aside', () => {
    const r = rules('listicle');
    expect(r).toContain('"concept" block');
    expect(r).toContain('"labelrows" block');
    for (const label of ['What it is', 'Why it exists', 'Used for']) expect(r).toContain(label);
    expect(r).toContain('ribbon');
    expect(r).toContain('How it works');
    expect(r).toContain('ONE diagram or table');
    expect(r).toContain('Benefits');
    expect(r).toContain('Things to consider');
    expect(r).toContain('"banner"');
    expect(r).toContain('Interview takeaway');
    expect(r).toMatch(/at most 7 blocks/i);
    expect(r).toContain('"aside"');
    expect(categoryOf('listicle').presentation.itemsPerPage).toBe('1 concept');
    expect(categoryOf('listicle').presentation.minFill).toBe(60);
  });

  it('interview-qa: four qa blocks per page, numbered q, one visual each, ceiling, banner', () => {
    const r = rules('interview-qa');
    expect(r).toContain('"qa" block');
    expect(r).toContain('4 questions');
    expect(r).toContain('"Q<n>. <question>"');
    expect(r).toMatch(/at most one small table, diagram or (4-line )?code block/);
    expect(r).toMatch(/at most 9 blocks/i);
    expect(r).toContain('"banner"');
    expect(r).toContain('Key takeaways');
    expect(categoryOf('interview-qa').presentation.itemsPerPage).toBe('4 questions');
    expect(categoryOf('interview-qa').presentation.minFill).toBe(80);
  });

  it('drills: 5-6 tasks, a sentence-case Q heading, one code block carrying a result, no stickies', () => {
    const r = rules('drills');
    expect(r).toContain('5-6 tasks');
    expect(r).toContain('"Q<n>. <short task title>"');
    expect(r).toContain('sentence case');
    expect(r).toContain('at most 6 words');
    expect(r).toContain('ONE "code" block');
    expect(r).toContain('"result"');
    expect(r).toMatch(/at most 3 rows and 3 columns/);
    expect(r).toMatch(/no sticky/i);
    expect(categoryOf('drills').presentation.itemsPerPage).toBe('5-6 tasks');
    expect(categoryOf('drills').presentation.minFill).toBe(80);
  });

  it('system-design: the full subsystem set, the state machine as a flowchart, never text arrows', () => {
    const r = rules('system-design');
    for (const s of ['Responsibilities', 'High Level Design', 'state machine', 'one node per state', 'table schema', 'APIs', 'idempotency and consistency', 'failure scenarios', 'events published', 'key metrics', 'design considerations']) {
      expect(r.toLowerCase(), s).toContain(s.toLowerCase());
    }
    expect(r).toContain('"flowchart"');
    expect(r).toMatch(/never text arrows/i);
    expect(r).toContain('Intro pages');
    expect(r).toContain('Responsibilities;');
  });

  it('handbook: a colour-coded table and an annotated code example on every page that has code', () => {
    const r = rules('handbook');
    expect(r).toContain('colour-coded table');
    expect(r).toContain('annotated code example');
  });
});

describe('the page prompt', () => {
  const book = { title: 'DB', summary: 's', chapters: [{ title: 'Indexing', points: ['what an index is'] }] };

  it('carries the hero rule: brand logos only for a page about that product', async () => {
    const { chapterPrompt } = await import('@/lib/ai/pages');
    for (const category of [undefined, 'listicle']) {
      const p = chapterPrompt({ brand: 'iolar', template: 'notebook', book: book as never, index: 0, prior: [], category });
      expect(p).toContain('only when this page is about that product');
      expect(p).toContain('postgresql');
      expect(p).toContain('generic');
    }
  });
});

describe('template choice', () => {
  beforeEach(() => {
    process.env.IOLAR_DATA_DIR = mkdtempSync(path.join(tmpdir(), 'iolar-nb-'));
    writeFileSync(path.join(process.env.IOLAR_DATA_DIR, 'settings.json'), JSON.stringify({ llmProvider: 'claude', brand: 'iolar', defaultTemplate: 'spiral-notes' }));
    vi.resetModules();
  });

  it('createChapter seeds part 1 with the category template, not the default template', async () => {
    const { createSubject, createChapter, loadPost } = await import('@/lib/store');
    await createSubject('s');
    await createChapter('s', 'l', 'L', 'listicle');
    expect((await loadPost('s', 'l', 1)).template).toBe('notebook');
    await createChapter('s', 'h', 'H');
    expect((await loadPost('s', 'h', 1)).template).toBe('notebook');
  });

  const book = { title: 'DB', summary: 's', chapters: [{ title: 'Indexing', points: ['what an index is'], shape: ['what it is', 'why it exists', 'used for', 'how it works', 'benefits', 'things to consider', 'interview takeaway'] }] };
  const run = async (prompt: string) =>
    prompt.includes('Write the Instagram caption')
      ? '{"text":"t","hashtags":[]}'
      : '{"page_title":"Indexing","blocks":[{"type":"heading","text":"x"}]}';

  it('planPagesFromBook moves a post that still has the default template to the category template', async () => {
    const { createSubject, createChapter, savePost, loadPost } = await import('@/lib/store');
    const { saveBook } = await import('@/lib/ai/book');
    const { planPagesFromBook } = await import('@/lib/ai/pages');
    await createSubject('s');
    await createChapter('s', 'l', 'L', 'listicle');
    // An older chapter: its part still carries the template that was the default when it was made.
    await savePost('s', 'l', 1, { ...(await loadPost('s', 'l', 1)), template: 'spiral-notes' });
    await saveBook('s', 'l', book as never);
    const prompts: string[] = [];
    const post = await planPagesFromBook('s', 'l', 1, async (p) => { prompts.push(p); return run(p); });
    expect(post.template).toBe('notebook');
    expect(prompts.find((p) => p.includes('You are writing page'))).toContain('FAMILY "notebook"');
  });

  it('planPagesFromBook keeps a template the user chose', async () => {
    const { createSubject, createChapter, savePost, loadPost } = await import('@/lib/store');
    const { saveBook } = await import('@/lib/ai/book');
    const { planPagesFromBook } = await import('@/lib/ai/pages');
    await createSubject('s');
    await createChapter('s', 'l', 'L', 'listicle');
    await savePost('s', 'l', 1, { ...(await loadPost('s', 'l', 1)), template: 'blackboard' });
    await saveBook('s', 'l', book as never);
    expect((await planPagesFromBook('s', 'l', 1, run)).template).toBe('blackboard');
  });
});
