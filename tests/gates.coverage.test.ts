import { describe, it, expect, beforeEach } from 'vitest';
import { mkdtempSync } from 'fs';
import { tmpdir } from 'os';
import path from 'path';

beforeEach(() => {
  process.env.IOLAR_DATA_DIR = mkdtempSync(path.join(tmpdir(), 'is-cov-'));
});

const post = (title: string, text: string) => ({
  brand: 'iolar',
  template: 'spiral-notes',
  ratio: '3:4',
  seed: 1,
  series: 'T',
  date: '01/01/2026',
  slides: [{ page_title: title, blocks: [{ type: 'bullets', items: [text] }] }],
  caption: { text: 'hook sentence here', hashtags: [] },
});

/** One book point nothing on the pages covers, worded so CAVEAT in runGates matches it. */
const GAP = 'a leaked auth token must be rotated immediately to stop the breach';

async function seed(parts: number[]) {
  const { createSubject, createChapter, createPart } = await import('@/lib/store');
  const { bookFile } = await import('@/lib/paths');
  const { promises: fs } = await import('fs');
  await createSubject('s');
  await createChapter('s', 'c');
  for (const p of parts) {
    await createPart('s', 'c', p, post(`P${p}`, 'pages talk only about unrelated widgets') as never);
  }
  await fs.writeFile(
    bookFile('s', 'c'),
    JSON.stringify({ title: 'C', summary: 'c', chapters: [{ title: 'C1', points: [GAP] }] })
  );
}

describe('coverage findings', () => {
  it('reports a chapter gap once, on the lowest part', async () => {
    await seed([1, 2]);
    const { runGates } = await import('@/lib/verify/runGates');
    const first = (await runGates('s', 'c', 1)).filter((f) => f.pass === 'coverage');
    const second = (await runGates('s', 'c', 2)).filter((f) => f.pass === 'coverage');
    expect(first).toHaveLength(1);
    expect(second).toHaveLength(0);
  }, 30_000);

  it('still reports the gap when the chapter has a single part', async () => {
    await seed([1]);
    const { runGates } = await import('@/lib/verify/runGates');
    const only = (await runGates('s', 'c', 1)).filter((f) => f.pass === 'coverage');
    expect(only).toHaveLength(1);
    expect(only[0].rule).toBe('coverage.caveat');
  }, 30_000);
});
