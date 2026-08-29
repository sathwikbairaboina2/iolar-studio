export type RetryOpts = { retries?: number; baseDelayMs?: number; label?: string };

/**
 * fetch that survives a transient blip. Only network-level failures are retried — a fetch
 * that throws because the connection dropped or the dev server was reloading. An HTTP error
 * response is a real answer from the server and is returned untouched, because retrying a
 * 4xx just repeats the mistake and retrying an expensive 5xx can duplicate AI work.
 */
export async function fetchWithRetry(
  url: string,
  init?: RequestInit,
  opts: RetryOpts = {}
): Promise<Response> {
  const retries = opts.retries ?? 2;
  const base = opts.baseDelayMs ?? 800;
  let lastError: unknown;

  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      return await fetch(url, init);
    } catch (err) {
      lastError = err;
      if (attempt === retries) break;
      const delay = base * 2 ** attempt;
      console.warn(
        `[instastudio] ${opts.label ?? url} failed (${String(err).slice(0, 80)}), retrying in ${delay}ms`
      );
      await new Promise((r) => setTimeout(r, delay));
    }
  }
  throw new Error(`${opts.label ?? url} failed after ${retries + 1} attempts: ${String(lastError).slice(0, 160)}`);
}

/** fetchWithRetry plus JSON parsing, throwing the server's own error message on failure. */
export async function fetchJson<T = unknown>(
  url: string,
  init?: RequestInit,
  opts: RetryOpts = {}
): Promise<T> {
  const r = await fetchWithRetry(url, init, opts);
  const body = await r.json().catch(() => ({}));
  if (!r.ok) {
    const err = (body as { error?: string }).error;
    throw new Error(err ? String(err) : `${opts.label ?? url} -> HTTP ${r.status}`);
  }
  return body as T;
}
