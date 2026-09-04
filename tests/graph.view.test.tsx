import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor, fireEvent, cleanup } from '@testing-library/react';

/**
 * The graph can be looked at flat or deep. Which one is a way of working, so it is
 * remembered; three.js is only fetched when the deep view is actually asked for.
 */

vi.mock('next/navigation', () => ({ useRouter: () => ({ push: vi.fn() }), usePathname: () => '/graph' }));

// WebGL does not exist in jsdom, so the deep canvas stands in for itself.
vi.mock('@/components/graph/GraphCanvas3D', () => ({
  default: ({ nodes }: { nodes: { id: string }[] }) => <div data-testid="graph-3d">deep · {nodes.length} nodes</div>,
}));
vi.mock('@/components/graph/GraphCanvas', () => ({
  default: ({ nodes }: { nodes: { id: string }[] }) => <div data-testid="graph-2d">flat · {nodes.length} nodes</div>,
}));

const graph = {
  nodes: [
    { id: 'Topic:kernels', label: 'Kernels', kind: 'Topic', space: 'handbooks', degree: 4 },
    { id: 'Chapter:gpu', label: 'GPUs', kind: 'Chapter', space: 'handbooks', degree: 2 },
  ],
  edges: [{ source: 'Chapter:gpu', target: 'Topic:kernels', rel: 'COVERS' }],
};

afterEach(() => cleanup());

beforeEach(() => {
  vi.resetModules();
  localStorage.clear();
  vi.stubGlobal('fetch', async (url: string) =>
    String(url).startsWith('/api/graph')
      ? ({ ok: true, json: async () => graph } as Response)
      : ({ ok: true, json: async () => ({}) } as Response)
  );
});

describe('the knowledge graph', () => {
  it('opens flat, and switches to the deep view on the same data', async () => {
    const Page = (await import('@/app/graph/page')).default;
    render(<Page />);

    await waitFor(() => expect(screen.getByTestId('graph-2d')).toBeTruthy());
    expect(screen.getByTestId('graph-2d').textContent).toContain('2 nodes');
    expect(screen.queryByTestId('graph-3d')).toBeNull();

    fireEvent.click(screen.getByText('3D'));
    await waitFor(() => expect(screen.getByTestId('graph-3d')).toBeTruthy());
    expect(screen.getByTestId('graph-3d').textContent).toContain('2 nodes');
    expect(screen.queryByTestId('graph-2d')).toBeNull();
    expect(localStorage.getItem('iolar.graphView')).toBe('deep');
  });

  it('opens where it was left', async () => {
    localStorage.setItem('iolar.graphView', 'deep');
    const Page = (await import('@/app/graph/page')).default;
    render(<Page />);
    await waitFor(() => expect(screen.getByTestId('graph-3d')).toBeTruthy());
  });
});
