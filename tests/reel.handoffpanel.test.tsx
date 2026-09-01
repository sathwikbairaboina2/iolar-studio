import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, cleanup, waitFor, fireEvent } from '@testing-library/react';
import React from 'react';

/**
 * The bench where the reel changes hands.
 *
 * Everything the studio made goes out in one folder, and the cut comes back through the same
 * panel. Both directions are one click, because the alternative is a path typed by hand into
 * a file dialog at the end of a long build.
 */

afterEach(cleanup);

global.ResizeObserver =
  global.ResizeObserver ?? (class { observe() {} unobserve() {} disconnect() {} } as never);

type Reply = { status?: number; body: unknown };
let replies: Record<string, Reply>;
const calls: { url: string; method: string; body: unknown }[] = [];
const copied: string[] = [];

const READY = {
  dir: 'C:/data/reel/grok/edit',
  handedOverAt: '2026-09-01T20:00:00.000Z',
  clips: ['01-lipsync-a28.mp4', '02-webpage-a31.mp4'],
};

beforeEach(() => {
  window.matchMedia = window.matchMedia ?? ((q: string) => ({
    matches: false, media: q, addListener: () => {}, removeListener: () => {},
    addEventListener: () => {}, removeEventListener: () => {}, dispatchEvent: () => false, onchange: null,
  })) as unknown as typeof window.matchMedia;
  calls.length = 0;
  copied.length = 0;
  replies = { '/handoff': { status: 404, body: { error: 'nothing has been handed over yet' } } };
  vi.stubGlobal('fetch', (url: string, init?: RequestInit) => {
    const u = String(url);
    const method = init?.method ?? 'GET';
    calls.push({ url: u, method, body: typeof init?.body === 'string' ? JSON.parse(init.body) : init?.body ? 'bytes' : undefined });
    const key = Object.keys(replies).sort((a, b) => b.length - a.length).find((k) => u.includes(k)) ?? '';
    const { status = 200, body } = replies[key] ?? { body: {} };
    return Promise.resolve({ ok: status < 400, status, json: () => Promise.resolve(body) } as Response);
  });
  Object.defineProperty(navigator, 'clipboard', {
    configurable: true,
    value: { writeText: (t: string) => { copied.push(t); return Promise.resolve(); } },
  });
});

async function panel() {
  const Handoff = (await import('@/components/reel/Handoff')).default;
  render(<Handoff slug="grok" />);
  await waitFor(() => expect(screen.getByTestId('handoff-send')).toBeTruthy());
}

describe('handing the reel over', () => {
  it('says nothing has gone yet, and offers to send it', async () => {
    await panel();
    expect(screen.getByTestId('handoff-state').textContent).toMatch(/not been handed over|nothing/i);
  });

  it('sends the clips, the voice and the script in one go', async () => {
    await panel();
    replies['/handoff'] = { body: { dir: READY.dir, clips: 7 } };
    fireEvent.click(screen.getByTestId('handoff-send'));
    await waitFor(() => expect(calls.some((c) => c.method === 'POST')).toBe(true));
    expect(calls.find((c) => c.method === 'POST')!.url).toContain('/api/reel/grok/handoff');
  });

  it('shows where the folder is, and copies the path', async () => {
    replies['/handoff'] = { body: READY };
    await panel();
    expect(screen.getByTestId('handoff-state').textContent).toContain('C:/data/reel/grok/edit');
    fireEvent.click(screen.getByTestId('handoff-path'));
    await waitFor(() => expect(copied).toEqual(['C:/data/reel/grok/edit']));
  });

  it('lists what went over', async () => {
    replies['/handoff'] = { body: READY };
    await panel();
    expect(screen.getByTestId('handoff-clips').textContent).toContain('01-lipsync-a28.mp4');
  });

  it('takes the finished cut back', async () => {
    replies['/handoff'] = { body: READY };
    await panel();
    replies['/handoff'] = { body: { ok: true, bytes: 1024, path: 'export/reel.mp4' } };

    const file = new File([new Uint8Array([1, 2, 3])], 'final-cut.mp4', { type: 'video/mp4' });
    const input = screen.getByTestId('handoff-return').querySelector('input[type="file"]') as HTMLInputElement;
    fireEvent.change(input, { target: { files: [file] } });

    await waitFor(() => expect(calls.some((c) => c.method === 'PUT')).toBe(true));
    const put = calls.find((c) => c.method === 'PUT')!;
    expect(put.url).toContain('/api/reel/grok/handoff');
    expect(put.body).toBe('bytes');
  });
});
