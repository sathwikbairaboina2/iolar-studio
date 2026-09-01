import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, cleanup, waitFor, fireEvent } from '@testing-library/react';
import React from 'react';

/**
 * The voiceover is one file for the whole script. A creator who wants a better voice than
 * this machine can make copies the script, speaks it wherever they like, and hands the audio
 * back — so the panel's job is to make that round trip obvious and to align what comes back.
 */

afterEach(cleanup);

global.ResizeObserver =
  global.ResizeObserver ?? (class { observe() {} unobserve() {} disconnect() {} } as never);

type Reply = { status?: number; body: unknown };
let replies: Record<string, Reply>;
const calls: { url: string; method: string; body: unknown }[] = [];
const copied: string[] = [];

const STATUS = {
  hasAudio: false,
  bytes: 0,
  aligned: false,
  durationSec: 0,
  heardWords: 0,
  scriptWords: 5,
  script: 'One two three four five',
};

beforeEach(() => {
  window.matchMedia = window.matchMedia ?? ((q: string) => ({
    matches: false, media: q, addListener: () => {}, removeListener: () => {},
    addEventListener: () => {}, removeEventListener: () => {}, dispatchEvent: () => false, onchange: null,
  })) as unknown as typeof window.matchMedia;
  calls.length = 0;
  copied.length = 0;
  replies = { '/voice': { body: STATUS } };
  vi.stubGlobal('fetch', (url: string, init?: RequestInit) => {
    const u = String(url);
    const method = init?.method ?? 'GET';
    let body: unknown = undefined;
    if (typeof init?.body === 'string') body = JSON.parse(init.body);
    else if (init?.body) body = 'bytes';
    calls.push({ url: u, method, body });
    const key = Object.keys(replies).sort((a, b) => b.length - a.length).find((k) => u.endsWith(k)) ?? '';
    const { status = 200, body: reply } = replies[key] ?? { body: {} };
    return Promise.resolve({ ok: status < 400, status, json: () => Promise.resolve(reply) } as Response);
  });
  Object.defineProperty(navigator, 'clipboard', {
    configurable: true,
    value: { writeText: (t: string) => { copied.push(t); return Promise.resolve(); } },
  });
});

async function panel(onVoice = vi.fn()) {
  const VoicePanel = (await import('@/components/reel/VoicePanel')).default;
  render(<VoicePanel slug="grok" onVoice={onVoice} />);
  await waitFor(() => expect(screen.getByTestId('voice-script')).toBeTruthy());
  return { onVoice };
}

describe('voice panel', () => {
  it('shows the script the recogniser will be given, and copies that exact text', async () => {
    await panel();
    expect((screen.getByTestId('voice-script') as HTMLTextAreaElement).value).toBe('One two three four five');
    fireEvent.click(screen.getByTestId('voice-copy'));
    await waitFor(() => expect(copied).toEqual(['One two three four five']));
  });

  it('speaks the script on this machine when asked to', async () => {
    const { onVoice } = await panel();
    replies['/voice'] = { body: { reel: { slug: 'grok' } } };
    fireEvent.click(screen.getByTestId('voice-generate'));
    await waitFor(() => expect(onVoice).toHaveBeenCalled());
    const post = calls.find((c) => c.method === 'POST')!;
    expect(post.url).toContain('/api/reel/grok/voice');
    expect(post.body).toEqual({});
  });

  it('sends a dropped file to the reel and then aligns it', async () => {
    const { onVoice } = await panel();
    replies['/vo'] = { body: { ok: true, bytes: 4 } };
    replies['/voice'] = { body: { reel: { slug: 'grok' } } };

    const file = new File([new Uint8Array([1, 2, 3, 4])], 'take.mp3', { type: 'audio/mpeg' });
    const input = screen.getByTestId('voice-upload').querySelector('input[type="file"]') as HTMLInputElement;
    fireEvent.change(input, { target: { files: [file] } });

    await waitFor(() => expect(onVoice).toHaveBeenCalled());
    const put = calls.find((c) => c.method === 'PUT')!;
    expect(put.url).toContain('/api/reel/grok/vo');
    // Alignment is not optional after a drop: without it the build cuts on the old take's timings.
    const align = calls.find((c) => c.method === 'POST')!;
    expect(align.url).toContain('/api/reel/grok/voice');
    expect(align.body).toEqual({ alignOnly: true });
  });

  it('does not align when the upload itself failed', async () => {
    const { onVoice } = await panel();
    replies['/vo'] = { status: 413, body: { error: 'that voiceover is too large' } };

    const file = new File([new Uint8Array([1])], 'huge.mp3', { type: 'audio/mpeg' });
    const input = screen.getByTestId('voice-upload').querySelector('input[type="file"]') as HTMLInputElement;
    fireEvent.change(input, { target: { files: [file] } });

    await waitFor(() => expect(calls.some((c) => c.method === 'PUT')).toBe(true));
    expect(calls.some((c) => c.method === 'POST')).toBe(false);
    expect(onVoice).not.toHaveBeenCalled();
  });

  it('offers to re-align audio that is already on disk', async () => {
    replies['/voice'] = { body: { ...STATUS, hasAudio: true, bytes: 4096, aligned: false } };
    const { onVoice } = await panel();
    replies['/voice'] = { body: { reel: { slug: 'grok' } } };
    fireEvent.click(screen.getByTestId('voice-align'));
    await waitFor(() => expect(onVoice).toHaveBeenCalled());
    expect(calls.find((c) => c.method === 'POST')!.body).toEqual({ alignOnly: true });
  });

  it('says so when the recogniser heard a different number of words than the script has', async () => {
    replies['/voice'] = {
      body: { ...STATUS, hasAudio: true, aligned: true, durationSec: 9, heardWords: 8, scriptWords: 5 },
    };
    await panel();
    expect(screen.getByTestId('voice-drift').textContent).toMatch(/8[^0-9]+5/);
  });

  it('keeps quiet about drift when the counts agree', async () => {
    replies['/voice'] = {
      body: { ...STATUS, hasAudio: true, aligned: true, durationSec: 9, heardWords: 5, scriptWords: 5 },
    };
    await panel();
    expect(screen.queryByTestId('voice-drift')).toBeNull();
  });
});
