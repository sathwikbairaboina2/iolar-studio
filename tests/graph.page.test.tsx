import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';

vi.mock('next/navigation', () => ({ useRouter: () => ({ push: vi.fn() }), usePathname: () => '/graph' }));

// cytoscape needs a real layout engine; in jsdom the canvas is a stub that lists its node ids.
vi.mock('@/components/graph/GraphCanvas', () => ({
  default: ({ nodes }: { nodes: { id: string }[] }) => <div data-testid="graph-canvas">{nodes.map((n) => n.id).join(',')}</div>,
}));

beforeEach(() => {
  vi.resetModules();
  vi.stubGlobal('fetch', async (url: string) => {
    const u = String(url);
    if (u.includes('ask=')) {
      return {
        ok: true,
        json: async () => ({ hits: [{ collection: 'claims', score: 0.91, text: 'SQLite ships in every phone', payload: {} }] }),
      } as Response;
    }
    if (u.includes('space=jobs')) {
      return {
        ok: true,
        json: async () => ({ nodes: [{ id: 'Week:2026-W46', label: '2026-W46', kind: 'Week', space: 'jobs', degree: 4 }], edges: [] }),
      } as Response;
    }
    return {
      ok: true,
      json: async () => ({ nodes: [{ id: 'Reel:x', label: 'X', kind: 'Reel', space: 'reels', degree: 1 }], edges: [] }),
    } as Response;
  });
});

describe('the graph page', () => {
  it('has four tabs, loads the chosen space, and shows meaning hits', async () => {
    const Page = (await import('@/app/graph/page')).default;
    render(<Page />);
    expect(screen.getByRole('tab', { name: 'Handbooks' })).toBeTruthy();
    expect(screen.getByRole('tab', { name: 'Reels' })).toBeTruthy();
    expect(screen.getByRole('tab', { name: 'Jobs' })).toBeTruthy();
    expect(screen.getByRole('tab', { name: 'All' })).toBeTruthy();
    fireEvent.click(screen.getByRole('tab', { name: 'Jobs' }));
    await waitFor(() => expect(screen.getByTestId('graph-canvas').textContent).toContain('Week:2026-W46'));
    const ask = screen.getByPlaceholderText('ask by meaning…');
    fireEvent.change(ask, { target: { value: 'sqlite phones' } });
    fireEvent.keyDown(ask, { key: 'Enter' });
    await waitFor(() => expect(screen.getByText(/SQLite ships in every phone/)).toBeTruthy());
  });

  it('says the store is down instead of showing an empty graph', async () => {
    vi.stubGlobal(
      'fetch',
      async () => ({ ok: false, status: 503, json: async () => ({ error: 'ECONNREFUSED 127.0.0.1:3124' }) }) as Response
    );
    const Page = (await import('@/app/graph/page')).default;
    render(<Page />);
    await waitFor(() => expect(screen.getByText(/knowledge graph is not answering/i)).toBeTruthy());
  });
});
