import { describe, it, expect, vi, beforeEach } from 'vitest';
import { fetchWithRetry, fetchJson } from '@/lib/http';

beforeEach(() => {
  vi.restoreAllMocks();
});

describe('fetchWithRetry', () => {
  it('returns the first successful response without retrying', async () => {
    const f = vi.fn().mockResolvedValue({ ok: true, status: 200 });
    global.fetch = f as unknown as typeof fetch;
    const r = await fetchWithRetry('http://x');
    expect(r.status).toBe(200);
    expect(f).toHaveBeenCalledTimes(1);
  });

  it('retries a dropped connection and succeeds', async () => {
    const f = vi.fn()
      .mockRejectedValueOnce(new TypeError('fetch failed'))
      .mockResolvedValue({ ok: true, status: 200 });
    global.fetch = f as unknown as typeof fetch;
    const r = await fetchWithRetry('http://x', undefined, { baseDelayMs: 1 });
    expect(r.status).toBe(200);
    expect(f).toHaveBeenCalledTimes(2);
  });

  it('gives up after the retry budget and names the failure', async () => {
    const f = vi.fn().mockRejectedValue(new TypeError('fetch failed'));
    global.fetch = f as unknown as typeof fetch;
    await expect(fetchWithRetry('http://x', undefined, { retries: 2, baseDelayMs: 1, label: 'render' }))
      .rejects.toThrow(/render failed after 3 attempts/);
    expect(f).toHaveBeenCalledTimes(3);
  });

  it('does not retry an HTTP error response', async () => {
    const f = vi.fn().mockResolvedValue({ ok: false, status: 400, json: async () => ({ error: 'bad slug' }) });
    global.fetch = f as unknown as typeof fetch;
    await expect(fetchJson('http://x', undefined, { baseDelayMs: 1 })).rejects.toThrow('bad slug');
    expect(f).toHaveBeenCalledTimes(1);
  });
});
