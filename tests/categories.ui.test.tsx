import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Suspense } from 'react';
import { render, screen, waitFor, fireEvent, act, cleanup } from '@testing-library/react';

const push = vi.fn();
vi.mock('next/navigation', () => ({ useRouter: () => ({ push }), usePathname: () => '/handbooks/py' }));

const chapters = [
  { subject: 'py', slug: 'basics', title: 'Python Basics', parts: 1, points: 10, pages: 10, avgFill: 90, status: 'published', updatedAt: '' },
  { subject: 'py', slug: 'qa', title: 'Python Q&A', category: 'interview-qa', parts: 1, points: 50, pages: 10, avgFill: 88, status: 'draft', updatedAt: '' },
  { subject: 'py', slug: 'ten', title: '10 Python Concepts', category: 'listicle', parts: 1, points: 70, pages: 10, avgFill: 80, status: 'draft', updatedAt: '' },
];

beforeEach(() => {
  cleanup();
  vi.resetModules();
  vi.stubGlobal('fetch', vi.fn(async (url: string, init?: RequestInit) => {
    if (init?.method === 'POST') return { ok: true, json: async () => ({ ...JSON.parse(String(init.body)) }) } as Response;
    return { ok: true, json: async () => ({ subject: { slug: 'py', name: 'Python', emoji: '🐍', description: '' }, chapters }) } as Response;
  }));
});

describe('handbook categories UI', () => {
  it('lists every category with its three rule layers', async () => {
    const { default: Page } = await import('@/app/handbooks/categories/page');
    render(<Page />);
    for (const name of ['Complete Handbook', 'Interview Q&A Bank', 'N Concepts Listicle', 'System Design Case Study', 'Query & Code Drills']) {
      expect(screen.getAllByText(new RegExp(name.replace(/[&]/g, '.'))).length).toBeGreaterThan(0);
    }
    expect(screen.getAllByText('Presentation').length).toBe(5);
  });

  it('filters the chapter list by category and title, and shows each chapter category', async () => {
    const { default: Page } = await import('@/app/handbooks/[subject]/page');
    await act(async () => { render(<Suspense fallback={null}><Page params={Promise.resolve({ subject: 'py' })} /></Suspense>); });
    await waitFor(() => expect(screen.getByText('Python Basics')).toBeTruthy());
    expect(screen.getByText('All 3')).toBeTruthy();

    fireEvent.click(screen.getByText(/N Concepts Listicle 1/));
    await waitFor(() => expect(screen.queryByText('Python Basics')).toBeNull());
    expect(screen.getByText('10 Python Concepts')).toBeTruthy();

    fireEvent.click(screen.getByText('All 3'));
    fireEvent.change(screen.getByPlaceholderText('filter by title'), { target: { value: 'q&a' } });
    await waitFor(() => expect(screen.queryByText('10 Python Concepts')).toBeNull());
    expect(screen.getByText('Python Q&A')).toBeTruthy();
    expect(screen.getByText('1 of 3')).toBeTruthy();
  });

  it('sends the picked category when creating a chapter', async () => {
    const { default: Page } = await import('@/app/handbooks/[subject]/page');
    await act(async () => { render(<Suspense fallback={null}><Page params={Promise.resolve({ subject: 'py' })} /></Suspense>); });
    await waitFor(() => expect(screen.getByText('Python Basics')).toBeTruthy());
    fireEvent.click(screen.getByText('new chapter'));
    fireEvent.change(screen.getByPlaceholderText(/Chapter title/), { target: { value: 'Python Drills' } });
    // The modal's picker defaults to the classic handbook.
    fireEvent.click(screen.getByText('Create'));
    await waitFor(() => {
      const post = (fetch as unknown as { mock: { calls: [string, RequestInit?][] } }).mock.calls.find(([, i]) => i?.method === 'POST');
      expect(JSON.parse(String(post?.[1]?.body))).toMatchObject({ slug: 'python-drills', category: 'handbook' });
    });
  });
});
