import { describe, expect, it, beforeEach } from 'vitest';
import { render, cleanup } from '@testing-library/react';
import type { Edition } from '@/lib/digital/edition';

const edition: Edition = {
  schema: 1, subject: 'python-asyncio', chapter: 'tasks', inputsHash: 'h', generatedAt: '2026-10-09T10:00:00.000Z',
  sections: [
    { title: 'Intro', role: 'intro', pages: [{ title: 'Start', blocks: [{ type: 'heading', text: 'Why' }, { type: 'paragraph', text: 'Hello **world**' }] }] },
    {
      title: 'Main', role: 'outline', outlineIndex: 0,
      pages: [
        { title: 'Compare', blocks: [{ type: 'table', headers: ['a', 'b', 'c', 'd'], rows: [['1', '2', '3', '4']] }, { type: 'diagram', kind: 'flow', spec: { nodes: ['one', 'two', 'three'] } }] },
        { title: 'Run', blocks: [{ type: 'code', lang: 'python', lines: ['print(1)'] }] },
      ],
    },
  ],
};
const svg = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 8 8"><circle cx="4" cy="4" r="3"/></svg>';

beforeEach(() => cleanup());

describe('EditionSheets', () => {
  it('draws every page as a numbered sheet with the subject pill, title and logo', async () => {
    const { EditionSheets } = await import('@/components/handbooks/EditionSheets');
    const { container } = render(<EditionSheets edition={edition} subject="Python Asyncio" title="Tasks" logoSvg={svg} icons={{}} />);
    const sheets = container.querySelectorAll('section');
    expect(sheets).toHaveLength(3);
    ['Page 1', 'Page 2', 'Page 3'].forEach((t, i) => expect(sheets[i].textContent).toContain(t));
    sheets.forEach((s) => expect(s.textContent).toContain('Python Asyncio'));
    expect(container.textContent).toContain('Tasks');
    expect(container.textContent).toContain('Compare');
    expect(container.querySelectorAll('section svg').length).toBeGreaterThanOrEqual(3);
  });

  it('puts the table and flow in a wide row and shows no Play button', async () => {
    const { EditionSheets } = await import('@/components/handbooks/EditionSheets');
    const { container } = render(<EditionSheets edition={edition} subject="Python Asyncio" title="Tasks" logoSvg={null} icons={{}} />);
    const body = container.querySelectorAll('section')[1].querySelector('[data-body]')!;
    expect(body.querySelector('[data-wide]')).toBeTruthy();
    expect(container.textContent).not.toMatch(/Play/);
    expect(container.querySelector('section svg[aria-hidden]')).toBeNull();
  });

  it('stacks the sheets full width, not in the chapter reader grid that keeps a column for the page list', async () => {
    const { EditionSheets } = await import('@/components/handbooks/EditionSheets');
    const styles = (await import('@/components/aiiolar-sheet/handbook.module.css')).default as Record<string, string>;
    const { container } = render(<EditionSheets edition={edition} subject="Python Asyncio" title="Tasks" logoSvg={null} icons={{}} />);
    const holder = container.querySelector('section')!.parentElement!;
    expect(styles.reader).toBeTruthy();
    expect(holder.classList.contains(styles.reader)).toBe(false);
    expect(holder.classList.contains(styles.readerSheet)).toBe(false);
  });
});
