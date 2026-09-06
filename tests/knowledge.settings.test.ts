import { describe, it, expect, beforeEach } from 'vitest';
import { mkdtempSync } from 'fs';
import { tmpdir } from 'os';
import path from 'path';

beforeEach(() => {
  process.env.IOLAR_DATA_DIR = mkdtempSync(path.join(tmpdir(), 'is-know-'));
});

describe('knowledge settings', () => {
  it('has local defaults for both stores and the embedder', async () => {
    const { getSettings } = await import('@/lib/settings');
    const s = getSettings();
    expect(s.neo4jUrl).toBe('bolt://127.0.0.1:3124');
    expect(s.neo4jUser).toBe('neo4j');
    expect(s.neo4jPassword).toBe('iolar-local');
    expect(s.qdrantUrl).toBe('http://127.0.0.1:3126');
    expect(s.embedOllamaUrl).toBe('http://127.0.0.1:11434');
    expect(s.embedModel).toBe('nomic-embed-text');
    expect(s.knowledgeMemory).toBe(true);
  });
});
