import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, cleanup, waitFor, fireEvent } from '@testing-library/react';
import React from 'react';

/** Rewriting a beat from the studio, through the same command path everything else uses. */

afterEach(cleanup);

global.ResizeObserver =
  global.ResizeObserver ?? (class { observe() {} unobserve() {} disconnect() {} } as never);

const calls: { url: string; method: string; body: unknown }[] = [];

beforeEach(() => {
  window.matchMedia = window.matchMedia ?? ((q: string) => ({
    matches: false, media: q, addListener: () => {}, removeListener: () => {},
    addEventListener: () => {}, removeEventListener: () => {}, dispatchEvent: () => false, onchange: null,
  })) as unknown as typeof window.matchMedia;
  calls.length = 0;
  vi.stubGlobal('fetch', (url: string, init?: RequestInit) => {
    calls.push({ url: String(url), method: init?.method ?? 'GET', body: init?.body ? JSON.parse(String(init.body)) : undefined });
    return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve({ reel: { slug: 'grok' } }) } as Response);
  });
});

async function editor(over: Record<string, unknown> = {}) {
  const BeatText = (await import('@/components/reel/BeatText')).default;
  const onEdited = vi.fn();
  render(<BeatText slug="grok" beatId="b1" text="One two three" onEdited={onEdited} {...over} />);
  return { onEdited };
}

describe('beat text', () => {
  it('sends the rewritten line as a beat.text command', async () => {
    const { onEdited } = await editor();
    fireEvent.click(screen.getByTestId('beat-edit'));
    fireEvent.change(screen.getByTestId('beat-input'), { target: { value: 'One two three four' } });
    fireEvent.click(screen.getByTestId('beat-save'));
    await waitFor(() => expect(onEdited).toHaveBeenCalled());
    expect(calls[0].body).toEqual({ op: 'beat.text', args: { beatId: 'b1', text: 'One two three four' }, actor: 'ui' });
  });

  it('will not send an empty line', async () => {
    await editor();
    fireEvent.click(screen.getByTestId('beat-edit'));
    fireEvent.change(screen.getByTestId('beat-input'), { target: { value: '   ' } });
    expect((screen.getByTestId('beat-save') as HTMLButtonElement).disabled).toBe(true);
  });

  it('drops the edit on cancel and sends nothing', async () => {
    await editor();
    fireEvent.click(screen.getByTestId('beat-edit'));
    fireEvent.change(screen.getByTestId('beat-input'), { target: { value: 'nope' } });
    fireEvent.click(screen.getByTestId('beat-cancel'));
    expect(calls).toHaveLength(0);
    expect(screen.getByTestId('beat-text').textContent).toBe('One two three');
  });
});
