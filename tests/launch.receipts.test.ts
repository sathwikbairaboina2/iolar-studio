import { mkdtempSync } from 'fs';
import os from 'os';
import path from 'path';
import { beforeEach, describe, expect, it } from 'vitest';
import { DISMISS_JS, FIND_QUOTE_JS, captureReceipts, locateScript, toClip } from '@/lib/launch/receipts';

const findQuoteSpan = new Function(`${FIND_QUOTE_JS}; return findQuoteSpan;`)() as (t: string[], q: string) => { startNode: number; startOffset: number; endNode: number; endOffset: number } | null;

beforeEach(() => {
  process.env.IOLAR_DATA_DIR = mkdtempSync(path.join(os.tmpdir(), 'launch-receipts-'));
});

describe('findQuoteSpan', () => {
  it('finds a quote split across inline elements', () => {
    expect(findQuoteSpan(['Today, with a ', '1 million', ' token context window, we'], '1 million token context window')).toEqual({ startNode: 1, startOffset: 0, endNode: 2, endOffset: 21 });
  });
  it('ignores case, runs of whitespace and curly quotes', () => {
    expect(findQuoteSpan(['It’s   available\n today'], "it's available today")).not.toBeNull();
  });
  it('returns null when the quote is not on the page', () => {
    expect(findQuoteSpan(['nothing here'], 'one million tokens')).toBeNull();
  });
});

describe('locateScript', () => {
  it('is one expression, because page.evaluate takes an expression and not statements', () => {
    expect(() => new Function(`return ${locateScript('a "quoted" phrase')}`)).not.toThrow();
  });
});

describe('DISMISS_JS', () => {
  it('is one expression that declines consent banners rather than accepting them', () => {
    expect(() => new Function(`return ${DISMISS_JS}`)).not.toThrow();
    expect(DISMISS_JS).toMatch(/reject/i);
    expect(DISMISS_JS).not.toMatch(/accept all|'accept'/i);
  });
});

describe('toClip', () => {
  it('moves page rectangles into the png and scales them', () => {
    expect(toClip([{ x: 20, y: 700, w: 300, h: 24 }], 420, 2)).toEqual([{ x: 40, y: 560, w: 600, h: 48 }]);
  });
});

describe('captureReceipts', () => {
  it('captures each claim once and reuses an unchanged shot', async () => {
    const claims = { claims: [{ id: 'c3', text: 't', url: 'https://blog.google/x', quote: '1 million token context window' }] };
    let calls = 0;
    const capture = async (_u: string, _q: string, png: string) => {
      calls++;
      const { promises: fs } = await import('fs');
      await fs.writeFile(png, 'x');
      return { width: 1080, height: 1350, focus: [{ x: 1, y: 2, w: 3, h: 4 }] };
    };
    const a = await captureReceipts('gemini-4', claims, ['c3'], capture);
    const b = await captureReceipts('gemini-4', claims, ['c3'], capture);
    expect(calls).toBe(1);
    expect(a.c3).toMatchObject({ file: 'receipt-c3.png', host: 'blog.google' });
    expect(b.c3.focus).toEqual([{ x: 1, y: 2, w: 3, h: 4 }]);
  });
  it('captures again when the quote changed', async () => {
    const one = { claims: [{ id: 'c3', text: 't', url: 'https://blog.google/x', quote: 'first quote here' }] };
    const two = { claims: [{ id: 'c3', text: 't', url: 'https://blog.google/x', quote: 'second quote here' }] };
    let calls = 0;
    const capture = async (_u: string, _q: string, png: string) => {
      calls++;
      const { promises: fs } = await import('fs');
      await fs.writeFile(png, 'x');
      return { width: 1080, height: 1350, focus: [{ x: 1, y: 2, w: 3, h: 4 }] };
    };
    await captureReceipts('gemini-4', one, ['c3'], capture);
    await captureReceipts('gemini-4', two, ['c3'], capture);
    expect(calls).toBe(2);
  });
  it('records a capture that throws as a shot with no focus, so the gate can name it', async () => {
    const claims = { claims: [{ id: 'c5', text: 't', url: 'https://x.com/y', quote: 'some words here' }] };
    const out = await captureReceipts('gemini-4', claims, ['c5'], async () => { throw new Error('net::ERR_BLOCKED'); });
    expect(out.c5.focus).toBeNull();
  });
});
