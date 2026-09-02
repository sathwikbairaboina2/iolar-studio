import { createHash } from 'crypto';
import type { Embedder } from './types';

export type EmbedOpts = { baseUrl: string; model: string; dims?: number; batch?: number; fetchImpl?: typeof fetch };

const hash = (t: string) => createHash('sha1').update(t).digest('hex');

/** Ollama's /api/embed. nomic wants a task prefix; the cache is keyed on the prefixed text. */
export class OllamaEmbed implements Embedder {
  dims: number;
  private base: string;
  private model: string;
  private batch: number;
  private http: typeof fetch;
  private cache = new Map<string, number[]>();

  constructor(opts: EmbedOpts) {
    this.base = opts.baseUrl.replace(/\/$/, '');
    this.model = opts.model;
    this.dims = opts.dims ?? 768;
    this.batch = opts.batch ?? 32;
    this.http = opts.fetchImpl ?? fetch;
  }

  private async call(inputs: string[]): Promise<number[][]> {
    const out: number[][] = new Array(inputs.length);
    const misses: number[] = [];
    inputs.forEach((t, i) => {
      const hit = this.cache.get(hash(t));
      if (hit) out[i] = hit;
      else misses.push(i);
    });
    for (let at = 0; at < misses.length; at += this.batch) {
      const idx = misses.slice(at, at + this.batch);
      const r = await this.http(`${this.base}/api/embed`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ model: this.model, input: idx.map((i) => inputs[i]) }),
        signal: AbortSignal.timeout(120_000),
      });
      if (!r.ok) throw new Error(`embed answered ${r.status}`);
      const body = (await r.json()) as { embeddings: number[][] };
      idx.forEach((i, j) => {
        out[i] = body.embeddings[j];
        this.cache.set(hash(inputs[i]), body.embeddings[j]);
      });
    }
    return out;
  }

  docs(texts: string[]) {
    return this.call(texts.map((t) => `search_document: ${t}`));
  }
  async query(text: string) {
    return (await this.call([`search_query: ${text}`]))[0];
  }
}
