import { describe, it, expect, beforeEach, vi } from 'vitest';
import { mkdtempSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import path from 'path';
import { seedPatternReel, fetchTemplates } from './helpers/pattern';

describe('buildDocument', () => {
  beforeEach(() => {
    process.env.IOLAR_DATA_DIR = mkdtempSync(path.join(tmpdir(), 'doc-'));
    vi.resetModules();
  });

  it('uses template defaults before the voice is aligned and says so', async () => {
    await seedPatternReel({ sections: true });
    const { buildDocument } = await import('@/lib/reel/pattern/document');
    const b = await buildDocument('t', { baseUrl: 'http://x', fetchImpl: fetchTemplates });
    expect(b.measured).toBe(false);
    expect(b.times.map((u) => u.sec)).toEqual([10, 6, 6, 4, 5]);
    expect(b.presenter).toBeNull();
  });

  it('measures from the words, points at vo.mp3 and presenter.mp4 as file urls, and hashes the document', async () => {
    await seedPatternReel({ sections: true, voice: true, words: true });
    const { reelPresenterFile } = await import('@/lib/paths');
    writeFileSync(reelPresenterFile('t'), 'mp4');
    const { buildDocument, docHash } = await import('@/lib/reel/pattern/document');
    const b = await buildDocument('t', { baseUrl: 'http://x', fetchImpl: fetchTemplates });
    expect(b.measured).toBe(true);
    expect(b.presenter).toBe('upload');
    const doc = b.doc as { vo: { file: string }; sections: { presenter?: string }[] };
    expect(doc.vo.file).toMatch(/^file:\/\/\/.*vo\.mp3$/);
    expect(doc.sections[0].presenter).toMatch(/^file:\/\/\/.*presenter\.mp4$/);
    expect(b.hash).toBe(docHash(b.doc));
    expect(b.times.at(-1)!.end).toBe(20);
  });

  it('refuses a freeform reel', async () => {
    const { createReel } = await import('@/lib/reel/store');
    await createReel('free');
    const { buildDocument } = await import('@/lib/reel/pattern/document');
    await expect(buildDocument('free', { baseUrl: 'http://x', fetchImpl: fetchTemplates })).rejects.toThrow(/freeform/);
  });
});
