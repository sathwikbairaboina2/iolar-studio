import { describe, it, expect, beforeEach } from 'vitest';
import { mkdtempSync, promises as fs } from 'fs';
import { tmpdir } from 'os';
import path from 'path';

/**
 * Footage is served to a player that mounts a fresh element at every cut.
 *
 * With `no-store` on every response, each of those mounts re-downloaded a file the browser
 * had just read — and so did the element preloading the next shot. On a reel of fifteen
 * clips averaging 1.8 seconds that is a download every second and a half, which the player
 * reported as twenty-one stalls in half a minute. Revalidation instead of no cache at all
 * keeps a re-rendered shot honest while letting the bytes be reused.
 */

let dir: string;
let file: string;

beforeEach(async () => {
  dir = mkdtempSync(path.join(tmpdir(), 'serve-media-'));
  file = path.join(dir, 'clip.mp4');
  await fs.writeFile(file, Buffer.alloc(2048, 7));
});

const req = (headers: Record<string, string> = {}) => new Request('http://x/clip.mp4', { headers });

describe('serving footage', () => {
  it('gives every response a tag the browser can revalidate against', async () => {
    const { serveMedia } = await import('@/lib/reel/serveMedia');
    const res = await serveMedia(file, req());

    expect(res.status).toBe(200);
    expect(res.headers.get('etag')).toBeTruthy();
    // Not `no-store`: that forbids keeping the bytes at all, which is what made every cut
    // a fresh download.
    expect(res.headers.get('cache-control')).toBe('no-cache');
  });

  it('answers 304 when the browser already has that exact file', async () => {
    const { serveMedia } = await import('@/lib/reel/serveMedia');
    const etag = (await serveMedia(file, req())).headers.get('etag')!;

    const again = await serveMedia(file, req({ 'if-none-match': etag }));

    expect(again.status).toBe(304);
    expect((await again.arrayBuffer()).byteLength).toBe(0);
  });

  it('sends the new file when the shot has been re-rendered under the same name', async () => {
    const { serveMedia } = await import('@/lib/reel/serveMedia');
    const etag = (await serveMedia(file, req())).headers.get('etag')!;

    await new Promise((r) => setTimeout(r, 10));
    await fs.writeFile(file, Buffer.alloc(4096, 9));

    const res = await serveMedia(file, req({ 'if-none-match': etag }));
    expect(res.status).toBe(200);
    expect(res.headers.get('content-length')).toBe('4096');
    expect(res.headers.get('etag')).not.toBe(etag);
  });

  it('still answers a range with the bytes asked for', async () => {
    const { serveMedia } = await import('@/lib/reel/serveMedia');
    const res = await serveMedia(file, req({ range: 'bytes=0-99' }));

    expect(res.status).toBe(206);
    expect(res.headers.get('content-range')).toBe('bytes 0-99/2048');
    expect((await res.arrayBuffer()).byteLength).toBe(100);
    expect(res.headers.get('etag')).toBeTruthy();
  });

  it('does not shortcut a range request into a 304', async () => {
    const { serveMedia } = await import('@/lib/reel/serveMedia');
    const etag = (await serveMedia(file, req())).headers.get('etag')!;

    // A seek asks for a slice the browser does not have, even though the file is unchanged.
    const res = await serveMedia(file, req({ 'if-none-match': etag, range: 'bytes=100-199' }));
    expect(res.status).toBe(206);
    expect((await res.arrayBuffer()).byteLength).toBe(100);
  });
});
