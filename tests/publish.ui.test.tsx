import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Suspense } from 'react';
import { render, screen, waitFor, fireEvent, act, cleanup } from '@testing-library/react';

vi.mock('next/navigation', () => ({ useRouter: () => ({ push: vi.fn() }), usePathname: () => '/handbooks/py' }));

const chapters = [
  { subject: 'py', slug: 'loop', title: 'Event Loop', parts: 1, points: 10, pages: 10, avgFill: 90, status: 'rendered', updatedAt: '' },
  { subject: 'py', slug: 'tasks', title: 'Tasks', parts: 1, points: 10, pages: 10, avgFill: 90, status: 'rendered', updatedAt: '' },
  { subject: 'py', slug: 'db', title: 'Databases', parts: 1, points: 10, pages: 10, avgFill: 90, status: 'rendered', updatedAt: '' },
  { subject: 'py', slug: 'web', title: 'Websockets', parts: 1, points: 10, pages: 10, avgFill: 90, status: 'rendered', updatedAt: '' },
];

const publish = {
  state: {
    alwaysAsk: false,
    chapters: {
      loop: { selected: true, verdict: 'pass', approvedBy: 'ai', hash: 'h' },
      tasks: { selected: true, verdict: 'unsure', hash: 'h', findings: [{ pass: 'pedagogy', rule: 'pedagogy.ai', severity: 'major', page: 2, summary: 'Part 2 repeats the setup.', evidence: '', fix: '' }] },
      db: { selected: true, verdict: 'fail', hash: 'h' },
    },
    exportedAt: new Date().toISOString(),
  },
  job: null,
  queue: { chapters: ['tasks'], order: false },
  live: ['loop'],
  stale: [],
  editions: { tasks: ['Intro', 'Coroutines', 'Coroutines'] },
};

let posts: unknown[];
beforeEach(() => {
  cleanup();
  vi.resetModules();
  posts = [];
  vi.stubGlobal('fetch', vi.fn(async (url: string, init?: RequestInit) => {
    if (init?.method === 'POST') {
      posts.push({ url, body: JSON.parse(String(init.body)) });
      return { ok: true, json: async () => ({}) } as Response;
    }
    if (String(url).endsWith('/publish')) return { ok: true, json: async () => publish } as Response;
    return { ok: true, json: async () => ({ subject: { slug: 'py', name: 'Python', emoji: '🐍', description: '' }, chapters }) } as Response;
  }));
});

async function mount() {
  const { default: Page } = await import('@/app/handbooks/[subject]/page');
  await act(async () => { render(<Suspense fallback={null}><Page params={Promise.resolve({ subject: 'py' })} /></Suspense>); });
  await waitFor(() => expect(screen.getByText('Event Loop')).toBeTruthy());
  await waitFor(() => expect(screen.getByTestId('aiiolar-loop')).toBeTruthy());
}

describe('publish UI', () => {
  it('maps each chapter to its aiiolar tag', async () => {
    await mount();
    expect(screen.getByTestId('aiiolar-loop').textContent).toBe('Live on aiiolar');
    expect(screen.getByTestId('aiiolar-tasks').textContent).toBe('Needs you');
    expect(screen.getByTestId('aiiolar-db').textContent).toBe('Failed review');
    expect(screen.getByTestId('aiiolar-web').textContent).toBe('Not published');
  });

  it('shows the bar for a selection and hides it on Clear', async () => {
    await mount();
    fireEvent.click(screen.getByLabelText('select Event Loop'));
    fireEvent.click(screen.getByLabelText('select Tasks'));
    expect(screen.getByText('2 selected')).toBeTruthy();
    fireEvent.click(screen.getByText('Clear'));
    expect(screen.queryByText('2 selected')).toBeNull();
  });

  it('posts a run for the selection and opens the drawer', async () => {
    await mount();
    fireEvent.click(screen.getByLabelText('select Tasks'));
    fireEvent.click(screen.getByLabelText('select Websockets'));
    await act(async () => { fireEvent.click(screen.getByText(/Review & publish/)); });
    await waitFor(() => expect(posts).toContainEqual({ url: '/api/handbooks/py/publish', body: { action: 'run', chapters: ['tasks', 'web'] } }));
    await waitFor(() => expect(screen.getAllByText('Chapter reviews').length).toBeGreaterThan(0));
  });

  it('lists an unsure chapter in the review queue and approves it', async () => {
    await mount();
    await act(async () => { fireEvent.click(screen.getByText(/Review queue/)); });
    await waitFor(() => expect(screen.getByText(/Part 2 repeats the setup/)).toBeTruthy());
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Approve' })); });
    await waitFor(() => expect(posts).toContainEqual({ url: '/api/handbooks/py/publish', body: { action: 'approve', chapter: 'tasks' } }));
  });

  it('posts Always ask me', async () => {
    await mount();
    await act(async () => { fireEvent.click(screen.getByRole('switch', { name: 'Always ask me' })); });
    await waitFor(() => expect(posts).toContainEqual({ url: '/api/handbooks/py/publish', body: { action: 'alwaysAsk', value: true } }));
  });

  it('shows the six steps per chapter and findings with page and section title', async () => {
    await mount();
    await act(async () => { fireEvent.click(screen.getByText(/Review queue/)); });
    await waitFor(() => expect(screen.getByText(/Part 2 repeats the setup/)).toBeTruthy());
    for (const name of ['generate', 'rules', 'facts', 'pedagogy', 'readability', 'fix']) expect(screen.getByTestId(`pass-${name}`)).toBeTruthy();
    expect(screen.getByTestId('pass-pedagogy').getAttribute('data-state')).toBe('bad');
    expect(screen.getByText(/page 2 [(]Coroutines[)]/)).toBeTruthy();
  });

  it('links to the edition and posts regenerate notes', async () => {
    await mount();
    await act(async () => { fireEvent.click(screen.getByText(/Review queue/)); });
    await waitFor(() => expect(screen.getByText('Open the edition')).toBeTruthy());
    expect(screen.getByText('Open the edition').closest('a')?.getAttribute('href')).toBe('/handbooks/py/tasks/edition');
    await act(async () => { fireEvent.click(screen.getByText('Regenerate with notes')); });
    fireEvent.change(screen.getByLabelText('notes for Tasks'), { target: { value: 'Coroutines needs a second example' } });
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Regenerate' })); });
    await waitFor(() => expect(posts).toContainEqual({ url: '/api/handbooks/py/publish', body: { action: 'regenerate', chapter: 'tasks', notes: 'Coroutines needs a second example' } }));
  });
});
