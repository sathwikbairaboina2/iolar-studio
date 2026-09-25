import { describe, it, expect, beforeEach } from 'vitest';
import { mkdtempSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import path from 'path';

const book = {
  title: 'Docker Complete Notes',
  summary: 'Containers from images to compose.',
  chapters: [
    { title: 'Docker Complete Notes', points: ['what this series covers'], shape: ['cover'] },
    { title: 'Images and Layers', points: ['an image is a stack of layers', 'layers are cached'], shape: ['definition', 'mechanism', 'example'] },
    { title: 'Containers', points: ['a container is a running image'], layout: [{ type: 'heading', note: 'title' }, { type: 'bullets', note: 'definition' }, { type: 'diagram', note: 'lifecycle flow' }] },
  ],
};

beforeEach(() => {
  process.env.IOLAR_DATA_DIR = mkdtempSync(path.join(tmpdir(), 'iolar-pages-'));
  writeFileSync(path.join(process.env.IOLAR_DATA_DIR, 'settings.json'), JSON.stringify({ llmProvider: 'claude', brand: 'iolar', defaultTemplate: 'sketchnote' }));
});

describe('chapterPrompt', () => {
  it('carries the chapter, the family recipe, the hint and what earlier pages taught', async () => {
    const { chapterPrompt } = await import('@/lib/ai/pages');
    const { otherPages } = await import('@/lib/ai/pages');
    const p = chapterPrompt({ brand: 'iolar', template: 'sketchnote', book: book as never, index: 1, prior: otherPages(book as never, 1) });
    expect(p).toContain('page 2 of 3');
    expect(p).toContain('an image is a stack of layers');
    expect(p).toContain('FAMILY "sketchnote"');
    expect(p).toContain('definition → mechanism → example');
    expect(p).toContain('1. Docker Complete Notes');
    expect(p).toContain('3. Containers: a container is a running image');
    expect(p).not.toContain('2. Images and Layers:');
    expect(p).toContain('Return ONLY ONE Slide object');
    expect(p).toContain('"kind":"flowchart"');
  });
  it('turns a reference layout into a hint, not an order', async () => {
    const { chapterPrompt } = await import('@/lib/ai/pages');
    const p = chapterPrompt({ brand: 'iolar', template: 'sketchnote', book: book as never, index: 2, prior: [] });
    expect(p).toContain('HINT');
    expect(p).toContain('diagram (lifecycle flow)');
  });
});

describe('seriesFor', () => {
  it('drops the placeholder a new chapter seeds, keeps a series the user typed, and trims a colon subtitle', async () => {
    const { seriesFor } = await import('@/lib/ai/pages');
    expect(seriesFor('STORAGE', 'Storage', 'Kubernetes Storage Handbook: Volumes, PV, PVC')).toBe('KUBERNETES STORAGE HANDBOOK');
    expect(seriesFor('IOLAR DEEP DIVE', 'Storage', 'Kubernetes Storage Handbook')).toBe('IOLAR DEEP DIVE');
    expect(seriesFor(undefined, undefined, 'Docker Complete Notes')).toBe('DOCKER COMPLETE NOTES');
  });
});

describe('planPagesFromBook', () => {
  it('asks once per chapter (in parallel), then once for the caption, assembles a valid post and saves it', async () => {
    const { createSubject, createChapter, createPart } = await import('@/lib/store');
    const { saveBook } = await import('@/lib/ai/book');
    const { planPagesFromBook } = await import('@/lib/ai/pages');
    await createSubject('d', { name: 'Docker' });
    await createChapter('d', 'c', 'C');
    await createPart('d', 'c', 1, { brand: 'iolar', template: 'sketchnote', ratio: '3:4', seed: 3, series: 'DOCKER NOTES', date: 'x', slides: [{ page_title: 'draft', blocks: [{ type: 'heading', text: 'x' }] }], caption: { text: '', hashtags: [] } } as never);
    await saveBook('d', 'c', book as never);

    const prompts: string[] = [];
    const run = async (prompt: string) => {
      prompts.push(prompt);
      if (prompt.includes('Write the Instagram caption')) return '{"text":"Hook first.","hashtags":["#docker","#devops"]}';
      const m = /You are writing page (\d+) of 3/.exec(prompt);
      const n = Number(m?.[1]);
      if (n === 1) return JSON.stringify({ kind: 'cover', page_title: 'Docker Complete Notes', hero: 'docker', blocks: [], cover: { title: 'Docker', subtitle: 'Complete Notes', icons: [{ icon: 'docker', label: 'Docker' }], pills: ['images'] } });
      return JSON.stringify({ page_title: `Page ${n}`, hero: 'docker', subtitle: 'sub', blocks: [{ type: 'heading', text: `${n}. Heading ${n}` }, { type: 'bullets', items: ['one', 'two'] }] });
    };
    const seen: number[] = [];
    const post = await planPagesFromBook('d', 'c', 1, run, (i) => seen.push(i));

    expect(prompts.length).toBe(4);
    const pagePrompts = prompts.filter((p) => p.includes('You are writing page'));
    expect(pagePrompts.some((p) => p.includes('page 2 of 3') && p.includes('1. Docker Complete Notes') && p.includes('3. Containers'))).toBe(true);
    expect([...seen].sort()).toEqual([0, 1, 2]);
    const { loadPost } = await import('@/lib/store');
    expect((await loadPost('d', 'c', 1)).slides.length).toBe(3);
    expect(post.slides.length).toBe(3);
    expect(post.slides[0].kind).toBe('cover');
    expect(post.slides[1].page_title).toBe('Page 2');
    expect(post.slides[2].page_title).toBe('Page 3');
    expect(post.slides[1].hero).toBe('docker');
    expect(post.template).toBe('sketchnote');
    expect(post.series).toBe('DOCKER NOTES');
    expect(post.caption).toEqual({ text: 'Hook first.', hashtags: ['#docker', '#devops'] });
  });

  it('retries a page that fails validation with the error, once', async () => {
    const { createSubject, createChapter } = await import('@/lib/store');
    const { saveBook } = await import('@/lib/ai/book');
    const { planPagesFromBook } = await import('@/lib/ai/pages');
    await createSubject('d', { name: 'Docker' });
    await createChapter('d', 'c', 'C');
    await saveBook('d', 'c', { ...book, chapters: [book.chapters[1]] } as never);
    let calls = 0;
    const run = async (prompt: string) => {
      calls++;
      if (prompt.includes('Write the Instagram caption')) return 'not json at all';
      if (calls === 1) return '{"page_title":"bad","blocks":[]}';
      expect(prompt).toContain('failed validation');
      return '{"page_title":"good","blocks":[{"type":"heading","text":"ok"}]}';
    };
    const post = await planPagesFromBook('d', 'c', 1, run);
    expect(post.slides[0].page_title).toBe('good');
    expect(post.caption.text).toBe(book.summary);
  });

  it('on the local model, unwraps a single page returned inside a whole post envelope', async () => {
    writeFileSync(path.join(process.env.IOLAR_DATA_DIR!, 'settings.json'), JSON.stringify({ llmProvider: 'local', brand: 'iolar', defaultTemplate: 'sketchnote' }));
    const { createSubject, createChapter } = await import('@/lib/store');
    const { saveBook } = await import('@/lib/ai/book');
    const { planPagesFromBook } = await import('@/lib/ai/pages');
    await createSubject('d', { name: 'Docker' });
    await createChapter('d', 'c', 'C');
    await saveBook('d', 'c', { ...book, chapters: [book.chapters[1]] } as never);
    const prompts: string[] = [];
    const run = async (prompt: string) => {
      prompts.push(prompt);
      if (prompt.includes('Write the Instagram caption')) return 'not json at all';
      return '{"brand":"iolar","slides":[{"page_title":"wrapped","blocks":[{"type":"heading","text":"ok"}]}],"caption":{"text":"x","hashtags":[]}}';
    };
    const post = await planPagesFromBook('d', 'c', 1, run);
    expect(post.slides[0].page_title).toBe('wrapped');
    expect(prompts.filter((p) => p.includes('failed validation'))).toHaveLength(0);
  });

  it('on Claude, still treats a post envelope as a validation failure and retries', async () => {
    const { createSubject, createChapter } = await import('@/lib/store');
    const { saveBook } = await import('@/lib/ai/book');
    const { planPagesFromBook } = await import('@/lib/ai/pages');
    await createSubject('d', { name: 'Docker' });
    await createChapter('d', 'c', 'C');
    await saveBook('d', 'c', { ...book, chapters: [book.chapters[1]] } as never);
    const prompts: string[] = [];
    const run = async (prompt: string) => {
      prompts.push(prompt);
      if (prompt.includes('Write the Instagram caption')) return 'not json at all';
      if (prompt.includes('failed validation')) return '{"page_title":"retried","blocks":[{"type":"heading","text":"ok"}]}';
      return '{"brand":"iolar","slides":[{"page_title":"wrapped","blocks":[{"type":"heading","text":"ok"}]}]}';
    };
    const post = await planPagesFromBook('d', 'c', 1, run);
    expect(post.slides[0].page_title).toBe('retried');
  });
});
