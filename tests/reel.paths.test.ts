import { describe, it, expect, beforeEach } from 'vitest';
import { mkdtempSync } from 'fs';
import { tmpdir } from 'os';
import path from 'path';

beforeEach(() => {
  process.env.IOLAR_DATA_DIR = mkdtempSync(path.join(tmpdir(), 'reel-paths-'));
});

describe('reel paths', () => {
  it('places every reel file under data/reel/<slug>', async () => {
    const { reelFile, reelAssetsDir, reelExportDir, reelVoFile, reelWordsFile } = await import('@/lib/paths');
    const root = process.env.IOLAR_DATA_DIR!;
    expect(reelFile('grok')).toBe(path.join(root, 'reel', 'grok', 'reel.json'));
    expect(reelAssetsDir('grok')).toBe(path.join(root, 'reel', 'grok', 'assets'));
    expect(reelExportDir('grok')).toBe(path.join(root, 'reel', 'grok', 'export'));
    expect(reelVoFile('grok')).toBe(path.join(root, 'reel', 'grok', 'vo.mp3'));
    expect(reelWordsFile('grok')).toBe(path.join(root, 'reel', 'grok', 'vo.words.json'));
  });

  it('resolves styles next to the repo templates, not under the data dir', async () => {
    const { styleDir, stylesRoot } = await import('@/lib/paths');
    expect(stylesRoot()).toBe(path.join(process.cwd(), 'styles'));
    expect(styleDir('armand')).toBe(path.join(process.cwd(), 'styles', 'armand'));
  });
});
