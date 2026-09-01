import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, cleanup, waitFor, fireEvent } from '@testing-library/react';
import React from 'react';

/** The gate: look at every request, choose what goes, and nothing else is sent. */

afterEach(cleanup);

global.ResizeObserver =
  global.ResizeObserver ?? (class { observe() {} unobserve() {} disconnect() {} } as never);

type Reply = { status?: number; body: unknown };
let replies: Record<string, Reply>;
const calls: { url: string; method: string; body: unknown }[] = [];

const READY = {
  beatId: 'b3',
  kind: 'talking-head',
  provider: 'lipsync',
  brief: 'to camera',
  seconds: 4.2,
  hero: true,
  audioPath: 'C:/beat/b3.wav',
  imagePath: 'C:/presenter.png',
  blocked: null,
};
const BLOCKED = {
  beatId: 'b2',
  kind: 'screen',
  provider: 'webpage',
  brief: 'chat ui',
  seconds: 3,
  hero: false,
  audioPath: 'C:/beat/b2.wav',
  blocked: 'No source to show for this beat — its line cites nothing, so there is no page to visit.',
};

beforeEach(() => {
  window.matchMedia = window.matchMedia ?? ((q: string) => ({
    matches: false, media: q, addListener: () => {}, removeListener: () => {},
    addEventListener: () => {}, removeEventListener: () => {}, dispatchEvent: () => false, onchange: null,
  })) as unknown as typeof window.matchMedia;
  calls.length = 0;
  replies = { '/shots/preview': { body: { shots: [BLOCKED, READY] } } };
  vi.stubGlobal('fetch', (url: string, init?: RequestInit) => {
    const u = String(url);
    calls.push({ url: u, method: init?.method ?? 'GET', body: init?.body ? JSON.parse(String(init.body)) : undefined });
    const key = Object.keys(replies).sort((a, b) => b.length - a.length).find((k) => u.includes(k)) ?? '';
    const { status = 200, body } = replies[key] ?? { body: {} };
    return Promise.resolve({ ok: status < 400, status, json: () => Promise.resolve(body) } as Response);
  });
});

async function gate(onQueued = vi.fn()) {
  const ShotGate = (await import('@/components/reel/ShotGate')).default;
  render(<ShotGate slug="grok" onQueued={onQueued} />);
  await waitFor(() => expect(screen.getByTestId('gate-row-b3')).toBeTruthy());
  return { onQueued };
}

describe('shot gate', () => {
  it('shows what each renderer would be sent', async () => {
    await gate();
    const row = screen.getByTestId('gate-row-b3').textContent ?? '';
    expect(row).toContain('lipsync');
    expect(row).toContain('to camera');
    expect(row).toContain('4.2');
    expect(screen.getByTestId('gate-row-b2').textContent).toContain('cites nothing');
  });

  it('queues only the beats that are ticked', async () => {
    const { onQueued } = await gate();
    replies['/shots'] = { body: { reel: { slug: 'grok' } } };
    fireEvent.click(screen.getByTestId('gate-run'));
    await waitFor(() => expect(onQueued).toHaveBeenCalled());
    const post = calls.find((c) => c.method === 'POST')!;
    // A blocked request would fail the moment it arrived, so it starts unticked.
    expect(post.body).toEqual({ beatIds: ['b3'] });
  });

  it('will not queue a blocked request even when it is ticked by hand', async () => {
    await gate();
    const box = screen.getByTestId('gate-pick-b2').querySelector('input') as HTMLInputElement;
    expect(box.disabled).toBe(true);
  });

  it('sends nothing while nothing is chosen', async () => {
    await gate();
    fireEvent.click(screen.getByTestId('gate-pick-b3').querySelector('input') as HTMLInputElement);
    expect((screen.getByTestId('gate-run') as HTMLButtonElement).disabled).toBe(true);
  });

  it('says so when there is nothing left to render', async () => {
    replies['/shots/preview'] = { body: { shots: [] } };
    const ShotGate = (await import('@/components/reel/ShotGate')).default;
    render(<ShotGate slug="grok" onQueued={vi.fn()} />);
    await waitFor(() => expect(screen.getByTestId('gate-empty')).toBeTruthy());
  });
});
