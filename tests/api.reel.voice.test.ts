import { describe, it, expect, beforeEach } from 'vitest';
import { mkdtempSync } from 'fs';
import { promises as fs } from 'fs';
import { tmpdir } from 'os';
import path from 'path';

/**
 * The voice stage is where a creator can step in: copy the script, speak it somewhere else,
 * and hand the audio back. The panel needs to know where that stands before it can say so.
 */

beforeEach(() => {
  process.env.IOLAR_DATA_DIR = mkdtempSync(path.join(tmpdir(), 'reel-voice-'));
});

const ctx = (slug: string) => ({ params: Promise.resolve({ slug }) });

async function makeReel() {
  const { POST } = await import('@/app/api/reel/route');
  await POST(new Request('http://x', { method: 'POST', body: JSON.stringify({ title: 'Grok' }) }));
  const one = await import('@/app/api/reel/[slug]/route');
  const { reel } = await (await one.GET(new Request('http://x'), ctx('grok'))).json();
  const next = {
    ...reel,
    beats: [
      { id: 'b1', role: 'hook', text: 'One two three', shot: { kind: 'broll', brief: '' } },
      { id: 'b2', role: 'close', text: 'four five', shot: { kind: 'broll', brief: '' } },
    ],
  };
  await one.PUT(new Request('http://x', { method: 'PUT', body: JSON.stringify({ reel: next }) }), ctx('grok'));
  return next;
}

describe('voice status', () => {
  it('reports no audio before anything has been spoken', async () => {
    await makeReel();
    const { GET } = await import('@/app/api/reel/[slug]/voice/route');
    const body = await (await GET(new Request('http://x'), ctx('grok'))).json();
    expect(body).toMatchObject({ hasAudio: false, aligned: false, heardWords: 0, scriptWords: 5 });
  });

  it('reports audio that is on disk but not yet aligned', async () => {
    await makeReel();
    const vo = await import('@/app/api/reel/[slug]/vo/route');
    await vo.PUT(new Request('http://x', { method: 'PUT', body: new Uint8Array([1, 2, 3, 4]) }), ctx('grok'));

    const { GET } = await import('@/app/api/reel/[slug]/voice/route');
    const body = await (await GET(new Request('http://x'), ctx('grok'))).json();
    expect(body).toMatchObject({ hasAudio: true, aligned: false, bytes: 4, scriptWords: 5 });
  });

  it('hands back the script exactly as the recogniser will be given it', async () => {
    await makeReel();
    const { GET } = await import('@/app/api/reel/[slug]/voice/route');
    const body = await (await GET(new Request('http://x'), ctx('grok'))).json();
    expect(body.script).toBe('One two three four five');
  });

  it('counts what the recogniser heard once the reel carries word timings', async () => {
    const reel = await makeReel();
    const one = await import('@/app/api/reel/[slug]/route');
    await one.PUT(
      new Request('http://x', {
        method: 'PUT',
        body: JSON.stringify({
          reel: { ...reel, vo: { ...reel.vo, durationSec: 2, words: [{ w: 'One', start: 0, end: 0.4 }] } },
        }),
      }),
      ctx('grok')
    );
    const { GET } = await import('@/app/api/reel/[slug]/voice/route');
    const body = await (await GET(new Request('http://x'), ctx('grok'))).json();
    expect(body).toMatchObject({ aligned: true, heardWords: 1, scriptWords: 5, durationSec: 2 });
  });

  it('404s for a reel that does not exist', async () => {
    const { GET } = await import('@/app/api/reel/[slug]/voice/route');
    expect((await GET(new Request('http://x'), ctx('nope'))).status).toBe(404);
  });

  it('leaves the audio on disk when the reel is asked for its status', async () => {
    await makeReel();
    const vo = await import('@/app/api/reel/[slug]/vo/route');
    await vo.PUT(new Request('http://x', { method: 'PUT', body: new Uint8Array([9, 9]) }), ctx('grok'));
    const { GET } = await import('@/app/api/reel/[slug]/voice/route');
    await GET(new Request('http://x'), ctx('grok'));
    const { reelVoFile } = await import('@/lib/paths');
    expect((await fs.stat(reelVoFile('grok'))).size).toBe(2);
  });
});

describe('a take that no longer matches the script', () => {
  it('says nothing either way about a take recorded before takes were fingerprinted', async () => {
    const reel = await makeReel();
    const one = await import('@/app/api/reel/[slug]/route');
    await one.PUT(
      new Request('http://x', {
        method: 'PUT',
        body: JSON.stringify({ reel: { ...reel, vo: { ...reel.vo, durationSec: 2, words: [{ w: 'One', start: 0, end: 0.4 }] } } }),
      }),
      ctx('grok')
    );
    const { GET } = await import('@/app/api/reel/[slug]/voice/route');
    const body = await (await GET(new Request('http://x'), ctx('grok'))).json();
    expect(body.matchesScript).toBeNull();
  });

  it('is reported as soon as a beat is rewritten', async () => {
    const reel = await makeReel();
    const { scriptHash } = await import('@/lib/reel/script');
    const one = await import('@/app/api/reel/[slug]/route');
    const aligned = {
      ...reel,
      vo: { ...reel.vo, durationSec: 2, words: [{ w: 'One', start: 0, end: 0.4 }], scriptHash: scriptHash(reel) },
    };
    await one.PUT(new Request('http://x', { method: 'PUT', body: JSON.stringify({ reel: aligned }) }), ctx('grok'));

    const { GET } = await import('@/app/api/reel/[slug]/voice/route');
    expect((await (await GET(new Request('http://x'), ctx('grok'))).json()).matchesScript).toBe(true);

    const { applyCommand } = await import('@/lib/reel/commands');
    await applyCommand('grok', { op: 'beat.text', args: { beatId: 'b1', text: 'One two three four' }, actor: 'ui' });

    const after = await (await GET(new Request('http://x'), ctx('grok'))).json();
    expect(after).toMatchObject({ matchesScript: false, aligned: true });
  });
});
