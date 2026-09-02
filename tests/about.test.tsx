import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';

beforeEach(() => {
  vi.resetModules();
  vi.stubGlobal('fetch', async (url: string) => {
    if (String(url).includes('handbook=1')) {
      return { ok: true, text: async () => '<h1>Reels Engine Handbook</h1>' } as Response;
    }
    return {
      ok: true,
      json: async () => ({
        updatedAt: '2026-09-02',
        features: [
          {
            key: 'research',
            title: 'Research',
            status: 'built',
            summary: 'A brief becomes a script.',
            how: ['plan', 'hunt'],
            files: ['lib/reel/research/graph.ts'],
            tests: ['tests/research.graph.test.ts'],
            handbook: '#research',
          },
          { key: 'agent-memory', title: 'Agent memory', status: 'in-progress', summary: 'Agents recall.', how: [], files: [], tests: [], handbook: '#knowledge' },
        ],
      }),
    } as Response;
  });
});

describe('how it works', () => {
  it('lists every feature with its status, and embeds the handbook', async () => {
    const Page = (await import('@/app/about/page')).default;
    render(<Page />);
    await waitFor(() => expect(screen.getByText('Research')).toBeTruthy());
    expect(screen.getByText('built')).toBeTruthy();
    expect(screen.getByText('in-progress')).toBeTruthy();
    expect(screen.getByText('lib/reel/research/graph.ts')).toBeTruthy();
    const frame = screen.getByTitle('Reels Engine Handbook') as HTMLIFrameElement;
    expect(frame.getAttribute('src')).toBe('/api/about?handbook=1');
  });

  it('reads the real manifest: every feature has files, tests and a handbook anchor', async () => {
    const { readFileSync } = await import('fs');
    const manifest = JSON.parse(readFileSync('docs/implementation.json', 'utf8')) as {
      features: { key: string; status: string; files: string[]; tests: string[]; handbook: string }[];
    };
    expect(manifest.features.length).toBeGreaterThanOrEqual(8);
    for (const f of manifest.features) {
      expect(['built', 'in-progress', 'designed']).toContain(f.status);
      expect(f.files.length).toBeGreaterThan(0);
      expect(f.tests.length).toBeGreaterThan(0);
      expect(f.handbook).toMatch(/^#/);
    }
  });
});
