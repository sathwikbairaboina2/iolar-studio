import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor, cleanup, act } from '@testing-library/react';
import React, { Suspense } from 'react';

afterEach(cleanup);

const push = vi.fn();
vi.mock('next/navigation', () => ({ usePathname: () => '/handbooks', useRouter: () => ({ push }) }));

beforeEach(() => {
  global.ResizeObserver = global.ResizeObserver ?? class { observe() {} unobserve() {} disconnect() {} };
  window.matchMedia = window.matchMedia ?? ((q: string) => ({
    matches: false, media: q, addListener: () => {}, removeListener: () => {},
    addEventListener: () => {}, removeEventListener: () => {}, dispatchEvent: () => false, onchange: null,
  })) as unknown as typeof window.matchMedia;
  global.fetch = vi.fn().mockResolvedValue({
    ok: true,
    json: async () => ({
      subjects: [{ slug: 'python', name: 'Python', emoji: '🐍', description: 'Core', chapters: 8, pages: 62 }],
      subject: { slug: 'python', name: 'Python', emoji: '🐍', description: 'Core' },
      chapters: [{
        subject: 'python', slug: 'data-structures', title: 'Data Structures', parts: 2,
        points: 158, pages: 14, avgFill: 92, status: 'packaged', updatedAt: new Date().toISOString(),
      }],
    }),
  }) as unknown as typeof fetch;
});

describe('handbooks screens', () => {
  it('lists subjects and rejects a bad new-subject slug', async () => {
    const Page = (await import('@/app/handbooks/page')).default;
    render(<Page />);
    await waitFor(() => expect(screen.getByText('Python')).toBeTruthy());

    fireEvent.click(screen.getByText('+ new subject'));
    const input = await screen.findByPlaceholderText(/Subject name/);
    fireEvent.change(input, { target: { value: '!!!' } });
    expect((screen.getByRole('button', { name: /Create/ }) as HTMLButtonElement).disabled).toBe(true);
  });

  it('shows a chapter with its part chain and fill', async () => {
    const Page = (await import('@/app/handbooks/[subject]/page')).default;
    await act(async () => {
      render(<Suspense fallback={null}><Page params={Promise.resolve({ subject: 'python' })} /></Suspense>);
    });
    expect(await screen.findByText('Data Structures')).toBeTruthy();
    expect(screen.getByText('part 1')).toBeTruthy();
    expect(screen.getByText('part 2')).toBeTruthy();
    expect(screen.getByText(/92% avg fill/)).toBeTruthy();
  });
});
