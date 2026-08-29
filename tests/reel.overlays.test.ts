import { describe, it, expect, beforeEach, afterAll } from 'vitest';
import { mkdtempSync } from 'fs';
import { tmpdir } from 'os';
import path from 'path';

beforeEach(() => {
  process.env.IOLAR_DATA_DIR = mkdtempSync(path.join(tmpdir(), 'reel-ovl-'));
});

afterAll(async () => {
  const { closeOverlayBrowser } = await import('@/lib/reel/overlays');
  await closeOverlayBrowser();
});

async function reelWithCaptions(texts: string[]) {
  const { validateReel } = await import('@/lib/reel/schema');
  return validateReel({
    pattern: 'armand',
    title: 'Grok',
    beats: [{ id: 'b1', role: 'hook', text: 'x', shot: { kind: 'title', brief: '' } }],
    timeline: {
      captions: texts.map((t, i) => ({ id: `k${i + 1}`, text: t, start: i, end: i + 0.8 })),
      overlays: [{ id: 'o1', kind: 'hook-title', start: 0, end: 1.6, props: { title: 'xAI just dropped' } }],
    },
  });
}

describe('overlay markup', () => {
  it('wraps caption text in the pill span the stylesheet targets', async () => {
    const { captionMarkup } = await import('@/lib/reel/overlays');
    expect(captionMarkup('just launched')).toBe('<div class="reel-caption"><span>just launched</span></div>');
  });

  it('escapes text so a stray angle bracket cannot inject markup', async () => {
    const { captionMarkup } = await import('@/lib/reel/overlays');
    expect(captionMarkup('<script>x</script>')).toContain('&lt;script&gt;');
  });

  it('fills the hook template and omits the logo when there is none', async () => {
    const { hookMarkup } = await import('@/lib/reel/overlays');
    const tpl = '<div class="reel-hook-title">{{logo}}{{title}}</div>';
    expect(hookMarkup(tpl, 'xAI drops Grok Bot')).toBe(
      '<div class="reel-hook-title">xAI drops Grok Bot</div>'
    );
    expect(hookMarkup(tpl, 'T', 'file:///logo.png')).toContain('<img src="file:///logo.png"');
  });

  it('links the pattern stylesheet and its custom properties', async () => {
    const { overlayHtml } = await import('@/lib/reel/overlays');
    const { loadPattern } = await import('@/lib/reel/patterns');
    const html = overlayHtml(await loadPattern('armand'), 'file:///x/caption.css', '<i></i>');
    expect(html).toContain('href="file:///x/caption.css"');
    expect(html).toContain('--cap-y: 73%');
  });
});

describe('overlay rendering', () => {
  it('renders one transparent PNG per distinct caption at reel size', async () => {
    const { renderOverlays } = await import('@/lib/reel/overlays');
    const { loadPattern } = await import('@/lib/reel/patterns');
    const sharp = (await import('sharp')).default;
    const outDir = path.join(process.env.IOLAR_DATA_DIR!, 'renders');

    const map = await renderOverlays(await reelWithCaptions(['just launched', 'basically an']), await loadPattern('armand'), outDir);
    expect(map.size).toBe(3); // two captions plus the hook overlay

    const meta = await sharp(map.get('k1')!).metadata();
    expect(meta.width).toBe(1080);
    expect(meta.height).toBe(1920);
    expect(meta.hasAlpha).toBe(true);

    // The pill sits in the lower third, so the top of the frame stays empty.
    const { data, info } = await sharp(map.get('k1')!).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
    const alphaAt = (x: number, y: number) => data[(y * info.width + x) * info.channels + 3];
    expect(alphaAt(540, 100)).toBe(0);
    expect(alphaAt(540, Math.round(1920 * 0.73))).toBeGreaterThan(0);
  }, 120_000);

  it('reuses one file for repeated caption text', async () => {
    const { renderOverlays } = await import('@/lib/reel/overlays');
    const { loadPattern } = await import('@/lib/reel/patterns');
    const outDir = path.join(process.env.IOLAR_DATA_DIR!, 'renders');
    const map = await renderOverlays(await reelWithCaptions(['same', 'same']), await loadPattern('armand'), outDir);
    expect(map.get('k1')).toBe(map.get('k2'));
  }, 120_000);

  it('returns an empty map without launching a browser when there is nothing to draw', async () => {
    const { renderOverlays } = await import('@/lib/reel/overlays');
    const { loadPattern } = await import('@/lib/reel/patterns');
    const { validateReel } = await import('@/lib/reel/schema');
    const bare = validateReel({
      pattern: 'armand',
      title: 'x',
      beats: [{ id: 'b1', role: 'hook', text: 'x', shot: { kind: 'title', brief: '' } }],
    });
    const map = await renderOverlays(bare, await loadPattern('armand'), path.join(tmpdir(), 'never'));
    expect(map.size).toBe(0);
  });
});

describe('media range serving', () => {
  it('answers a byte range with 206 and the right slice', async () => {
    const { serveMedia } = await import('@/lib/reel/serveMedia');
    const { writeFileSync } = await import('fs');
    const file = path.join(process.env.IOLAR_DATA_DIR!, 'clip.mp4');
    writeFileSync(file, Buffer.from('0123456789'));

    const res = await serveMedia(file, new Request('http://x', { headers: { range: 'bytes=2-5' } }));
    expect(res.status).toBe(206);
    expect(res.headers.get('content-range')).toBe('bytes 2-5/10');
    expect(res.headers.get('content-type')).toBe('video/mp4');
    expect(await res.text()).toBe('2345');
  });

  it('serves the whole file, seekable, when no range is asked for', async () => {
    const { serveMedia } = await import('@/lib/reel/serveMedia');
    const { writeFileSync } = await import('fs');
    const file = path.join(process.env.IOLAR_DATA_DIR!, 'clip.mp4');
    writeFileSync(file, Buffer.from('0123456789'));

    const res = await serveMedia(file, new Request('http://x'));
    expect(res.status).toBe(200);
    // Without this header the browser will not even try to seek.
    expect(res.headers.get('accept-ranges')).toBe('bytes');
    expect(await res.text()).toBe('0123456789');
  });

  it('reads open-ended and suffix ranges the way a video element sends them', async () => {
    const { parseRange } = await import('@/lib/reel/serveMedia');
    expect(parseRange('bytes=0-', 100)).toEqual({ start: 0, end: 99 });
    expect(parseRange('bytes=-20', 100)).toEqual({ start: 80, end: 99 });
    expect(parseRange('bytes=90-999', 100)).toEqual({ start: 90, end: 99 });
    expect(parseRange(null, 100)).toBeNull();
    expect(parseRange('bytes=50-10', 100)).toBeNull();
  });
});
