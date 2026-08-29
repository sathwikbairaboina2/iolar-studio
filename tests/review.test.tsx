import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor, cleanup } from '@testing-library/react';
import React from 'react';
import { validatePost, type Post } from '@/lib/schema';

afterEach(cleanup);

const base = (): Post => validatePost({
  brand: 'iolar', template: 'spiral-notes', ratio: '3:4', seed: 1,
  series: 'S', date: 'd',
  slides: [
    { page_title: 'One', blocks: [{ type: 'heading', text: 'A' }] },
    { page_title: 'Two', blocks: [{ type: 'heading', text: 'B' }] },
    { page_title: 'Three', blocks: [{ type: 'heading', text: 'C' }] },
  ],
  caption: { text: '', hashtags: [] },
});

beforeEach(() => {
  global.ResizeObserver = global.ResizeObserver ?? class { observe() {} unobserve() {} disconnect() {} };
  window.matchMedia = window.matchMedia ?? ((q: string) => ({
    matches: false, media: q, addListener: () => {}, removeListener: () => {},
    addEventListener: () => {}, removeEventListener: () => {}, dispatchEvent: () => false, onchange: null,
  })) as unknown as typeof window.matchMedia;
});

describe('ReviewPanel', () => {
  it('drops a page and accepts the cut, saving the new order then packaging', async () => {
    const calls: { url: string; method?: string; body?: unknown }[] = [];
    global.fetch = vi.fn().mockImplementation((url: string, init?: RequestInit) => {
      calls.push({ url, method: init?.method, body: init?.body ? JSON.parse(String(init.body)) : undefined });
      if (url.endsWith('/package')) {
        return Promise.resolve({ ok: true, json: async () => ({ dir: 'out', files: ['01.png', '02.png', 'caption.txt'] }) });
      }
      return Promise.resolve({ ok: true, json: async () => base() });
    }) as unknown as typeof fetch;

    const onApplied = vi.fn();
    const ReviewPanel = (await import('@/components/editor/ReviewPanel')).default;
    render(
      <ReviewPanel
        subject="python" chapter="demo" part={1} post={base()} version={1} fill={{ 1: 92, 2: 88, 3: 40 }}
        open onClose={() => {}} onApplied={onApplied}
      />
    );

    expect(screen.getByText('Accept final cut (3 pages)')).toBeTruthy();

    fireEvent.click(screen.getByLabelText('remove page 3'));
    expect(screen.getByText('Accept final cut (2 pages)')).toBeTruthy();

    fireEvent.click(screen.getByText('Accept final cut (2 pages)'));

    await waitFor(() => expect(onApplied).toHaveBeenCalled());
    const put = calls.find((c) => c.method === 'PUT');
    expect(put).toBeTruthy();
    const saved = put!.body as Post;
    expect(saved.slides.map((s) => s.page_title)).toEqual(['One', 'Two']);
    expect(calls.some((c) => c.url.endsWith('/package'))).toBe(true);
  });
});
