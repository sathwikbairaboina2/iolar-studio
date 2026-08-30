import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { renderHook, act, waitFor, cleanup } from '@testing-library/react';

/**
 * The studio's side of the command layer: every edit goes out as a named op and
 * the reel comes back from the server, so the UI never holds edit authority an
 * agent lacks.
 */

afterEach(cleanup);

type Handler = (url: string, init?: RequestInit) => { status?: number; body: unknown };

let handler: Handler;
const calls: { url: string; body: unknown }[] = [];

class FakeEventSource {
  static last: FakeEventSource | null = null;
  onmessage: ((e: { data: string }) => void) | null = null;
  onerror: (() => void) | null = null;
  closed = false;
  constructor(readonly url: string) {
    FakeEventSource.last = this;
  }
  close() {
    this.closed = true;
  }
}

const reelWith = (fit: string) => ({
  title: 'Grok',
  timeline: { clips: [{ id: 'c1', fit }], captions: [], overlays: [] },
});

beforeEach(() => {
  calls.length = 0;
  FakeEventSource.last = null;
  handler = () => ({ body: { reel: reelWith('cover') } });
  vi.stubGlobal('EventSource', FakeEventSource);
  vi.stubGlobal('fetch', (url: string, init?: RequestInit) => {
    const body = init?.body ? JSON.parse(String(init.body)) : undefined;
    calls.push({ url: String(url), body });
    const { status = 200, body: out } = handler(String(url), init);
    return Promise.resolve({
      ok: status < 400,
      status,
      json: () => Promise.resolve(out),
    } as Response);
  });
});

async function mount() {
  const { useReelEditor } = await import('@/app/reel/[slug]/useReelEditor');
  const view = renderHook(() => useReelEditor('grok'));
  await waitFor(() => expect(view.result.current.reel).not.toBeNull());
  return view;
}

describe('useReelEditor', () => {
  it('loads the reel on mount', async () => {
    const { result } = await mount();

    expect(result.current.reel?.title).toBe('Grok');
    expect(calls[0].url).toBe('/api/reel/grok');
  });

  it('sends an edit as a named command labelled as the studio', async () => {
    const { result } = await mount();
    handler = () => ({ body: { reel: reelWith('contain'), entry: { seq: 1, op: 'clip.fit' } } });

    await act(async () => {
      await result.current.run('clip.fit', { clipId: 'c1', fit: 'contain' });
    });

    const edit = calls.find((c) => c.url.endsWith('/edit'));
    expect(edit?.body).toEqual({ op: 'clip.fit', args: { clipId: 'c1', fit: 'contain' }, actor: 'ui' });
  });

  it('takes the reel the server returns as the truth', async () => {
    const { result } = await mount();
    handler = () => ({ body: { reel: reelWith('contain'), entry: { seq: 1, op: 'clip.fit' } } });

    await act(async () => {
      await result.current.run('clip.fit', { clipId: 'c1', fit: 'contain' });
    });

    expect(result.current.reel?.timeline.clips[0].fit).toBe('contain');
  });

  it('surfaces a rejected command and leaves the reel alone', async () => {
    const { result } = await mount();
    handler = () => ({ status: 404, body: { error: 'no clip "c9" on this reel', validIds: ['c1'] } });

    await act(async () => {
      await result.current.run('clip.delete', { clipId: 'c9' });
    });

    expect(result.current.error).toMatch(/no clip "c9"/);
    expect(result.current.reel?.timeline.clips[0].fit).toBe('cover');
  });

  it('asks the server to undo rather than keeping its own stack', async () => {
    const { result } = await mount();
    handler = () => ({ body: { reel: reelWith('cover'), cursor: 0 } });

    await act(async () => {
      await result.current.undo();
    });

    const undo = calls.find((c) => c.url.endsWith('/history') && (c.body as { action: string })?.action);
    expect(undo?.body).toEqual({ action: 'undo' });
  });

  it('adopts a reel pushed over the stream, so an agent edit lands without a refresh', async () => {
    const { result } = await mount();

    await act(async () => {
      FakeEventSource.last?.onmessage?.({ data: JSON.stringify(reelWith('contain')) });
    });

    expect(result.current.reel?.timeline.clips[0].fit).toBe('contain');
    expect(FakeEventSource.last?.url).toBe('/api/reel/grok/events');
  });

  it('closes the stream when the studio unmounts', async () => {
    const view = await mount();

    view.unmount();

    expect(FakeEventSource.last?.closed).toBe(true);
  });
});
