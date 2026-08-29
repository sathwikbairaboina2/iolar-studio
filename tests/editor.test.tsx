import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';
import React from 'react';
import type { Slide } from '@/lib/schema';

afterEach(cleanup);

beforeEach(() => {
  window.matchMedia = window.matchMedia ?? ((q: string) => ({
    matches: false, media: q, addListener: () => {}, removeListener: () => {},
    addEventListener: () => {}, removeEventListener: () => {}, dispatchEvent: () => false, onchange: null,
  })) as unknown as typeof window.matchMedia;
});

describe('SlideChips', () => {
  it('disables add at 10 slides', async () => {
    const SlideChips = (await import('@/components/editor/SlideChips')).default;
    render(<SlideChips count={10} selected={0} onSelect={() => {}} onAdd={() => {}} onDelete={() => {}} />);
    expect((screen.getByLabelText('add slide') as HTMLButtonElement).disabled).toBe(true);
  });

  it('allows add below 10', async () => {
    const SlideChips = (await import('@/components/editor/SlideChips')).default;
    render(<SlideChips count={3} selected={0} onSelect={() => {}} onAdd={() => {}} onDelete={() => {}} />);
    expect((screen.getByLabelText('add slide') as HTMLButtonElement).disabled).toBe(false);
  });
});

describe('BlockEditor', () => {
  const slide: Slide = {
    page_title: 'P1',
    blocks: [
      { type: 'heading', text: 'H' },
      { type: 'table', headers: ['A'], rows: [['1']] },
    ],
  };

  it('renders block cards for each block', async () => {
    const BlockEditor = (await import('@/components/editor/BlockEditor')).default;
    render(<BlockEditor slide={slide} onChange={() => {}} />);
    expect(screen.getByText('heading')).toBeTruthy();
    expect(screen.getByText('table')).toBeTruthy();
  });

  it('table editor adds a row', async () => {
    const BlockEditor = (await import('@/components/editor/BlockEditor')).default;
    const onChange = vi.fn();
    render(<BlockEditor slide={slide} onChange={onChange} />);
    fireEvent.click(screen.getByText('+ row'));
    const updated = onChange.mock.calls[0][0] as Slide;
    const table = updated.blocks[1];
    expect(table.type).toBe('table');
    if (table.type === 'table') expect(table.rows.length).toBe(2);
  });
});
