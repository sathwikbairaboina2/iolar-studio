import { mkdtempSync, mkdirSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import path from 'path';
import { describe, expect, it, vi, beforeEach } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';

const edition = {
  schema: 1 as const, subject: 'py', chapter: 'loop', inputsHash: 'h', generatedAt: '2026-10-09T10:00:00.000Z',
  sections: [
    { title: 'Intro', role: 'intro' as const, pages: [{ title: 'Start', blocks: [{ type: 'paragraph', text: 'Hello **world** <b>x</b>' }] }] },
    {
      title: 'Main', role: 'outline' as const, outlineIndex: 0,
      pages: [{
        title: 'Body',
        blocks: [
          { type: 'code', lang: 'python', lines: ['print(1)'] },
          { type: 'code', lang: 'output', lines: ['1'] },
          { type: 'table', headers: ['a'], rows: [['cell']] },
          { type: 'callout', style: 'sticky', title: 'Mistake', text: 'careful' },
          { type: 'diagram', kind: 'flow', spec: { nodes: ['one'] } },
          { type: 'qa', q: 'Q?', a_bullets: ['A!'] },
        ],
      }],
    },
  ],
};

beforeEach(() => cleanup());

describe('EditionView', () => {
  it('draws sections, pages with numbers and each block type, and escapes html', async () => {
    const { EditionView } = await import('@/components/handbooks/EditionView');
    const { container } = render(<EditionView edition={edition} title="Loop" />);
    expect(screen.getByText('Loop')).toBeTruthy();
    expect(screen.getByText('Intro')).toBeTruthy();
    expect(screen.getByText('page 2')).toBeTruthy();
    expect(screen.getByText('print(1)', { exact: false })).toBeTruthy();
    expect(screen.getByText('cell')).toBeTruthy();
    expect(screen.getByText(/diagram · flow/)).toBeTruthy();
    expect(screen.getByText('Q?')).toBeTruthy();
    expect(container.querySelector('.em')?.textContent).toBe('world');
    expect(container.querySelector('p b')).toBeNull();
  });
});

describe('edition page', () => {
  it('reads the saved edition, and says so when there is none', async () => {
    vi.resetModules();
    const root = mkdtempSync(path.join(tmpdir(), 'view-'));
    process.env.IOLAR_DATA_DIR = root;
    const f = (rel: string, v: unknown) => { const p = path.join(root, rel); mkdirSync(path.dirname(p), { recursive: true }); writeFileSync(p, JSON.stringify(v)); };
    f('handbooks/py/loop/chapter.json', { title: 'Event Loop', order: 0 });
    const { default: Page } = await import('@/app/handbooks/[subject]/[chapter]/edition/page');
    render(await Page({ params: Promise.resolve({ subject: 'py', chapter: 'loop' }) }));
    expect(screen.getByText(/No edition has been written/)).toBeTruthy();
    cleanup();
    f('handbooks/py/loop/digital/edition.json', edition);
    render(await Page({ params: Promise.resolve({ subject: 'py', chapter: 'loop' }) }));
    expect(screen.getByText('Event Loop')).toBeTruthy();
    expect(screen.getByText('Body')).toBeTruthy();
  });
});
