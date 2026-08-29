import { describe, it, expect, beforeEach } from 'vitest';
import { mkdtempSync } from 'fs';
import { tmpdir } from 'os';
import path from 'path';

describe('store', () => {
  beforeEach(() => {
    process.env.IOLAR_DATA_DIR = mkdtempSync(path.join(tmpdir(), 'iolar-'));
  });

  it('create -> load roundtrip and list', async () => {
    const { createPost, loadPost, listPosts } = await import('@/lib/store');
    await createPost('demo');
    const p = await loadPost('demo');
    expect(p.template).toBe('spiral-notes');
    expect(p.brand).toBe('iolar');
    expect((await listPosts())[0].slug).toBe('demo');
  });

  it('savePost rejects invalid post', async () => {
    const { createPost, savePost, loadPost } = await import('@/lib/store');
    await createPost('demo2');
    const p = await loadPost('demo2');
    (p as { ratio: string }).ratio = 'bogus';
    await expect(savePost('demo2', p)).rejects.toThrow();
  });

  it('status is draft for fresh post', async () => {
    const { createPost, postStatus } = await import('@/lib/store');
    await createPost('demo3');
    expect(await postStatus('demo3')).toBe('draft');
  });
});
