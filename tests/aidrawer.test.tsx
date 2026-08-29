import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor, cleanup } from '@testing-library/react';
import React from 'react';
import { validatePost, Post } from '@/lib/schema';

afterEach(cleanup);

const base = (): Post => validatePost({
  brand: 'iolar', template: 'spiral-notes', ratio: '3:4', seed: 1,
  series: 'S', date: 'd',
  slides: [{ page_title: 'P1', blocks: [{ type: 'heading', text: 'A' }] }],
  caption: { text: '', hashtags: [] },
});

beforeEach(() => {
  global.ResizeObserver = global.ResizeObserver ?? class {
    observe() {} unobserve() {} disconnect() {}
  };
  window.matchMedia = window.matchMedia ?? ((q: string) => ({
    matches: false, media: q, addListener: () => {}, removeListener: () => {},
    addEventListener: () => {}, removeEventListener: () => {}, dispatchEvent: () => false, onchange: null,
  })) as unknown as typeof window.matchMedia;
});

describe('AiDrawer', () => {
  it('shows history, sends request, renders diff, applies proposal', async () => {
    const proposal = base();
    (proposal.slides[0].blocks[0] as { text: string }).text = 'CHANGED';
    const diff = [{ slide: 1, kind: 'changed', blocks: [{ index: 0, kind: 'changed', before: base().slides[0].blocks[0], after: proposal.slides[0].blocks[0] }] }];

    global.fetch = vi.fn().mockImplementation((url: string, init?: RequestInit) => {
      if (init?.method === 'POST') {
        return Promise.resolve({ ok: true, json: async () => ({ proposal, diff }) });
      }
      return Promise.resolve({ ok: true, json: async () => ({ history: [{ role: 'user', text: 'earlier message', ts: '2026-01-01' }] }) });
    }) as unknown as typeof fetch;

    const onApplied = vi.fn();
    const AiDrawer = (await import('@/components/editor/AiDrawer')).default;
    render(
      <AiDrawer
        subject="python" chapter="demo" part={1} post={base()} slideIndex={0} open={true} prefill=""
        onOpen={() => {}} onClose={() => {}} onApplied={onApplied}
      />
    );

    await waitFor(() => expect(screen.getByText('earlier message')).toBeTruthy());

    fireEvent.change(screen.getByPlaceholderText(/fit this into/), { target: { value: 'change heading' } });
    fireEvent.click(screen.getByLabelText('send-request'));

    await waitFor(() => expect(screen.getByText(/Proposed changes to 1 slide/)).toBeTruthy());
    expect(screen.getByText(/CHANGED/)).toBeTruthy();

    fireEvent.click(screen.getByText('✓ Apply & re-render'));
    await waitFor(() => expect(onApplied).toHaveBeenCalledWith(proposal));
  });
});
