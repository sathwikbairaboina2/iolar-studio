import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, cleanup, waitFor, fireEvent } from '@testing-library/react';
import React from 'react';

/** The inbox, seen from the studio: what is in each folder, and one click to take it. */

afterEach(cleanup);

global.ResizeObserver =
  global.ResizeObserver ?? (class { observe() {} unobserve() {} disconnect() {} } as never);

const calls: { url: string; method: string; body: unknown }[] = [];
let inbox: unknown;
const copied: string[] = [];

beforeEach(() => {
  window.matchMedia = window.matchMedia ?? ((q: string) => ({
    matches: false, media: q, addListener: () => {}, removeListener: () => {},
    addEventListener: () => {}, removeEventListener: () => {}, dispatchEvent: () => false, onchange: null,
  })) as unknown as typeof window.matchMedia;
  calls.length = 0;
  copied.length = 0;
  inbox = [
    { beatId: 'b1', dir: 'C:/data/reel/grok/inbox/b1', files: [{ name: 'take-one.mp4', bytes: 2048, kind: 'video', modified: 2 }] },
    { beatId: 'b2', dir: 'C:/data/reel/grok/inbox/b2', files: [] },
  ];
  vi.stubGlobal('fetch', (url: string, init?: RequestInit) => {
    calls.push({ url: String(url), method: init?.method ?? 'GET', body: init?.body ? JSON.parse(String(init.body)) : undefined });
    const body = init?.method === 'POST' ? { reel: { slug: 'grok' } } : { inbox };
    return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve(body) } as Response);
  });
  Object.defineProperty(navigator, 'clipboard', {
    configurable: true,
    value: { writeText: (t: string) => { copied.push(t); return Promise.resolve(); } },
  });
});

async function panel(onAdopted = vi.fn()) {
  const InboxPanel = (await import('@/components/reel/InboxPanel')).default;
  render(<InboxPanel slug="grok" onAdopted={onAdopted} />);
  await waitFor(() => expect(screen.getByTestId('inbox-b1')).toBeTruthy());
  return { onAdopted };
}

describe('inbox panel', () => {
  it('shows each beat’s folder and what is in it', async () => {
    await panel();
    expect(screen.getByTestId('inbox-b1').textContent).toContain('take-one.mp4');
    expect(screen.getByTestId('inbox-b2').textContent).toMatch(/nothing dropped/i);
  });

  it('copies the folder path, since dropping files happens outside the browser', async () => {
    await panel();
    fireEvent.click(screen.getByTestId('inbox-path-b1'));
    await waitFor(() => expect(copied).toEqual(['C:/data/reel/grok/inbox/b1']));
  });

  it('adopts a file as that beat’s shot', async () => {
    const { onAdopted } = await panel();
    fireEvent.click(screen.getByTestId('inbox-take-b1-take-one.mp4'));
    await waitFor(() => expect(onAdopted).toHaveBeenCalled());
    expect(calls.find((c) => c.method === 'POST')!.body).toEqual({ beatId: 'b1', name: 'take-one.mp4', role: 'shot' });
  });
});
