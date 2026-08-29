import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor, cleanup } from '@testing-library/react';

afterEach(cleanup);
import React from 'react';

const push = vi.fn();
vi.mock('next/navigation', () => ({
  usePathname: () => '/paperbook',
  useRouter: () => ({ push }),
}));

beforeEach(() => {
  window.matchMedia = window.matchMedia ?? ((q: string) => ({
    matches: false, media: q, addListener: () => {}, removeListener: () => {},
    addEventListener: () => {}, removeEventListener: () => {}, dispatchEvent: () => false, onchange: null,
  })) as unknown as typeof window.matchMedia;
  global.fetch = vi.fn().mockResolvedValue({
    ok: true,
    json: async () => ({
      posts: [{ slug: 'demo-post', title: 'DEMO POST', template: 'spiral-notes', slideCount: 3, status: 'rendered', updatedAt: new Date().toISOString() }],
      templates: ['spiral-notes', 'margin-qa'],
    }),
  }) as unknown as typeof fetch;
});

describe('paperbook list page', () => {
  it('renders rows from api', async () => {
    const Page = (await import('@/app/paperbook/page')).default;
    render(<Page />);
    await waitFor(() => expect(screen.getByText('demo-post')).toBeTruthy());
    expect(screen.getByText('rendered')).toBeTruthy();
  });

  it('new-post modal rejects invalid slug', async () => {
    const Page = (await import('@/app/paperbook/page')).default;
    render(<Page />);
    fireEvent.click(screen.getByText('New post'));
    const input = await screen.findByPlaceholderText(/post-slug/);
    fireEvent.change(input, { target: { value: 'Bad Slug!' } });
    const create = screen.getByRole('button', { name: 'Create' });
    expect((create as HTMLButtonElement).disabled).toBe(true);
  });
});
