import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, cleanup, waitFor, fireEvent } from '@testing-library/react';
import React from 'react';

/** The three ways out of a stuck shot, without leaving the studio. */

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

async function actions(over: Record<string, unknown> = {}) {
  const ShotActions = (await import('@/components/reel/ShotActions')).default;
  const onChanged = vi.fn();
  render(
    <ShotActions
      slug="grok"
      beatId="b2"
      kind="screen"
      brief="chat ui"
      status="failed"
      onChanged={onChanged}
      {...over}
    />
  );
  return { onChanged };
}

describe('shot actions', () => {
  it('retries the one beat, carrying an edited brief', async () => {
    const { onChanged } = await actions();
    fireEvent.change(screen.getByTestId('shot-brief'), { target: { value: 'tighter framing' } });
    fireEvent.click(screen.getByTestId('shot-retry'));
    await waitFor(() => expect(onChanged).toHaveBeenCalled());
    expect(calls[0].body).toEqual({ beatId: 'b2', action: 'retry', brief: 'tighter framing' });
  });

  it('recasts a page shot the presenter can say instead', async () => {
    const { onChanged } = await actions();
    fireEvent.click(screen.getByTestId('shot-recast'));
    await waitFor(() => expect(onChanged).toHaveBeenCalled());
    expect(calls[0].body).toEqual({ beatId: 'b2', action: 'recast', kind: 'talking-head' });
  });

  it('offers the other direction for a talking head', async () => {
    await actions({ kind: 'talking-head' });
    expect(screen.getByTestId('shot-recast').textContent).toMatch(/page|screen/i);
  });

  it('abandons a job that is never coming back', async () => {
    const { onChanged } = await actions({ status: 'running' });
    fireEvent.click(screen.getByTestId('shot-abandon'));
    await waitFor(() => expect(onChanged).toHaveBeenCalled());
    expect(calls[0].body).toMatchObject({ beatId: 'b2', action: 'abandon' });
  });

  it('does not offer to abandon a shot that already landed', async () => {
    await actions({ status: 'ready' });
    expect(screen.queryByTestId('shot-abandon')).toBeNull();
  });
});
