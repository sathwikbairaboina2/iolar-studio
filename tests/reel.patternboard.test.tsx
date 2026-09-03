import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor, cleanup } from '@testing-library/react';
import { good } from './helpers/pattern';

const units = [
  { path: 'sections.0', label: 'hook', kind: 'hook', lineIds: ['l1'], start: 0, end: 10, sec: 10 },
  { path: 'sections.1.slides.0', label: 'slide 1', kind: 'slide', lineIds: ['l2'], start: 10, end: 16, sec: 6 },
  { path: 'sections.1.slides.1', label: 'slide 2', kind: 'slide', lineIds: ['l3'], start: 16, end: 22, sec: 6 },
  { path: 'sections.2.pages.0', label: 'page 1', kind: 'page', lineIds: ['l4'], start: 22, end: 26, sec: 4 },
  { path: 'sections.3', label: 'cta', kind: 'cta', lineIds: ['l5'], start: 26, end: 31, sec: 5 },
];
const lines = {
  l1: 'Three tools nobody told you about.', l2: 'The first runs offline.', l3: 'The second costs nothing.',
  l4: 'Here is the repo.', l5: 'Comment tools and I will DM you the links.',
};
const pattern = { name: 'tools', theme: 'kinetic', presenter: 'lipsync', sections: good, job: null };
const state = (over: Record<string, unknown> = {}) => ({
  stage: 'sectioned', blocked: null, sectionsStale: false, renderStale: false, units, measured: false, timingError: null,
  presenter: { source: 'lipsync', status: 'none' }, job: null, progress: null, previewUrl: null, exportPath: null, lastError: null,
  pattern, lines,
  limits: { title: 60, chips: 3, chip: 16, points: 4, point: 40, keyword: 12, topic: 40, secMin: 1, secMax: 30 },
  themes: ['kinetic', 'glass-bento'],
  ...over,
});

let posted: { url: string; method: string; body: unknown }[] = [];
let current = state();
afterEach(() => cleanup());
beforeEach(() => {
  posted = [];
  current = state();
  vi.stubGlobal('fetch', async (url: string, init?: RequestInit) => {
    const u = String(url);
    const json = (body: unknown, status = 200) => ({ ok: status < 400, status, json: async () => body }) as Response;
    if (init?.method && init.method !== 'GET') {
      posted.push({ url: u, method: init.method, body: init.body ? JSON.parse(String(init.body)) : null });
      if (u.endsWith('/pattern/render')) {
        return json({ error: 'cta keyword is 14, the limit is 12', issues: [{ loc: ['sections', 3, 'cta', 'keyword'], msg: 'too long' }] }, 422);
      }
      if (u.endsWith('/pattern')) {
        current = state({ pattern: { ...pattern, ...(init.body ? JSON.parse(String(init.body)) : {}) } });
        return json(current);
      }
      return json(current);
    }
    if (u.endsWith('/pattern')) return json(current);
    return json({ error: 'no route' }, 404);
  });
});

describe('PatternBoard', () => {
  it('draws one card per unit with its lines and live counts, and lets a line move to the previous unit', async () => {
    const PatternBoard = (await import('@/components/reel/PatternBoard')).default;
    render(<PatternBoard slug="t" onChanged={() => {}} />);
    await waitFor(() => expect(screen.getAllByTestId('unit-card')).toHaveLength(5));
    expect(screen.getByText('Three tools nobody told you about.')).toBeTruthy();
    expect(screen.getByTestId('count-sections.0.title').textContent).toBe('29/60');
    // The hook would be emptied: refused, nothing posted.
    fireEvent.click(screen.getByTestId('move-next-sections.0-l1'));
    expect(posted.filter((p) => p.url.endsWith('/pattern'))).toHaveLength(0);
    // Slide 2's only line moves back into slide 1; the empty slide 2 is dropped.
    fireEvent.click(screen.getByTestId('move-prev-sections.1.slides.1-l3'));
    await waitFor(() => expect(posted.some((p) => p.url.endsWith('/pattern'))).toBe(true));
    const sent = posted.find((p) => p.url.endsWith('/pattern'))!.body as { sections: { slides?: { lineIds: string[] }[] }[] };
    expect(sent.sections[1].slides!.map((s) => s.lineIds)).toEqual([['l2', 'l3']]);
  });

  it('shows the 422 from render on the unit it names', async () => {
    const PatternBoard = (await import('@/components/reel/PatternBoard')).default;
    current = state({ stage: 'presented', measured: true, presenter: { source: 'upload', status: 'ready' } });
    render(<PatternBoard slug="t" onChanged={() => {}} />);
    await waitFor(() => expect(screen.getByTestId('render')).toBeTruthy());
    fireEvent.click(screen.getByTestId('render'));
    await waitFor(() => expect(screen.getByText(/cta keyword is 14/)).toBeTruthy());
    expect(screen.getByTestId('unit-card-sections.3').className).toContain('unit-error');
  });

  it('blocks Render on a timing error and shows the preview iframe and export when done', async () => {
    const PatternBoard = (await import('@/components/reel/PatternBoard')).default;
    current = state({ stage: 'presented', timingError: 'slide 2 needs 34.0 s, the template allows 30 s; split it or move a line' });
    const { unmount } = render(<PatternBoard slug="t" onChanged={() => {}} />);
    await waitFor(() => expect(screen.getByTestId('render')).toBeTruthy());
    expect((screen.getByTestId('render') as HTMLButtonElement).disabled).toBe(true);
    expect(screen.getByText(/slide 2 needs 34.0 s/)).toBeTruthy();
    unmount();

    current = state({
      stage: 'done', job: { id: 'j1', state: 'done', submittedAt: 'x', docHash: 'd', error: null },
      previewUrl: 'http://x/preview/tools/kinetic?job=j1', exportPath: 'C:/d/reel/t/export/reel.mp4',
    });
    render(<PatternBoard slug="t" onChanged={() => {}} />);
    await waitFor(() => expect(screen.getByTestId('preview-frame')).toBeTruthy());
    expect((screen.getByTestId('preview-frame') as HTMLIFrameElement).src).toBe('http://x/preview/tools/kinetic?job=j1');
    expect(screen.getByText(/export\/reel\.mp4/)).toBeTruthy();
  });
});
