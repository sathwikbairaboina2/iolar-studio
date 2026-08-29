import { describe, it, expect, beforeEach } from 'vitest';
import { mkdtempSync } from 'fs';
import { promises as fs } from 'fs';
import { tmpdir } from 'os';
import path from 'path';

beforeEach(() => {
  process.env.IOLAR_DATA_DIR = mkdtempSync(path.join(tmpdir(), 'iolar-pkg-'));
});

async function setupRendered(chapter: string, overflow = 0) {
  const { createSubject, createChapter, savePost, loadPost } = await import('@/lib/store');
  const { rendersDir } = await import('@/lib/paths');
  await createSubject('python');
  await createChapter('python', chapter);
  const p = await loadPost('python', chapter, 1);
  p.caption = { text: 'Great post about Python.', hashtags: ['#python', '#coding'] };
  await savePost('python', chapter, 1, p);
  const renders = rendersDir('python', chapter, 1);
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
    const r = await packagePost('python', 'pkg-ok', 1);
    expect(r.files).toEqual(['01.png', 'caption.txt']);
    const caption = await fs.readFile(path.join(r.dir, 'caption.txt'), 'utf8');
    expect(caption).toBe('Great post about Python.\n\n#python #coding\n');
  });

  it('throws without renders', async () => {
    const { createSubject, createChapter } = await import('@/lib/store');
    await createSubject('python');
    await createChapter('python', 'pkg-none');
    const { packagePost } = await import('@/lib/packageExport');
    await expect(packagePost('python', 'pkg-none', 1)).rejects.toThrow(/render first/);
  });

  it('overflow in report blocks packaging', async () => {
    await setupRendered('pkg-ovf', 120);
    const { packagePost } = await import('@/lib/packageExport');
    await expect(packagePost('python', 'pkg-ovf', 1)).rejects.toThrow(/overflow/);
  });
});

describe('polish route', () => {
  it('503 when comfy down', async () => {
    const orig = global.fetch;
    global.fetch = (() => Promise.reject(new Error('down'))) as unknown as typeof fetch;
    try {
      const route = await import('@/app/api/handbooks/[subject]/[chapter]/parts/[part]/polish/route');
      const res = await route.POST(new Request('http://t', { method: 'POST' }), {
        params: Promise.resolve({ subject: 'python', chapter: 'x', part: '1' }),
      });
      expect(res.status).toBe(503);
    } finally {
      global.fetch = orig;
    }
  });
});
