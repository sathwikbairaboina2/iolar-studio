import { describe, it, expect, beforeEach } from 'vitest';
import { mkdtempSync } from 'fs';
import { promises as fs } from 'fs';
import { tmpdir } from 'os';
import path from 'path';

beforeEach(() => {
  process.env.IOLAR_DATA_DIR = mkdtempSync(path.join(tmpdir(), 'iolar-pkg-'));
});

async function setupRendered(slug: string, overflow = 0) {
  const { createPost, postDir, savePost, loadPost } = await import('@/lib/store');
  await createPost(slug);
  const p = await loadPost(slug);
  p.caption = { text: 'Great post about Python.', hashtags: ['#python', '#coding'] };
  await savePost(slug, p);
  const renders = path.join(postDir(slug), 'renders');
  await fs.mkdir(renders, { recursive: true });
  await fs.writeFile(path.join(renders, 'slide-01.png'), Buffer.from('fakepng'));
  await fs.writeFile(
    path.join(renders, 'render-report.json'),
    JSON.stringify({ '1': { overflowPx: overflow } })
  );
}

describe('packagePost', () => {
  it('copies renders and writes caption.txt exactly', async () => {
    await setupRendered('pkg-ok');
    const { packagePost } = await import('@/lib/packageExport');
    const r = await packagePost('pkg-ok');
    expect(r.files).toEqual(['01.png', 'caption.txt']);
    const caption = await fs.readFile(path.join(r.dir, 'caption.txt'), 'utf8');
    expect(caption).toBe('Great post about Python.\n\n#python #coding\n');
  });

  it('throws without renders', async () => {
    const { createPost } = await import('@/lib/store');
    await createPost('pkg-none');
    const { packagePost } = await import('@/lib/packageExport');
    await expect(packagePost('pkg-none')).rejects.toThrow(/render first/);
  });

  it('overflow in report blocks packaging', async () => {
    await setupRendered('pkg-ovf', 120);
    const { packagePost } = await import('@/lib/packageExport');
    await expect(packagePost('pkg-ovf')).rejects.toThrow(/overflow/);
  });
});

describe('polish route', () => {
  it('503 when comfy down', async () => {
    const orig = global.fetch;
    global.fetch = (() => Promise.reject(new Error('down'))) as unknown as typeof fetch;
    try {
      const route = await import('@/app/api/paperbook/[slug]/polish/route');
      const res = await route.POST(new Request('http://t', { method: 'POST' }), {
        params: Promise.resolve({ slug: 'x' }),
      });
      expect(res.status).toBe(503);
    } finally {
      global.fetch = orig;
    }
  });
});
