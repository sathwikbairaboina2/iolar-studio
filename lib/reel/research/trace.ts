import { promises as fs } from 'fs';
import path from 'path';
import { reelResearchDir } from '@/lib/paths';

/**
 * What the researcher actually did, as it did it.
 *
 * A hunt used to be a black box: a prompt went in, a JSON array came out ten minutes later,
 * and nothing in between was anyone's to see. That is not a thing to trust — a source list
 * with no record of the searches behind it could have come from anywhere. So every search
 * the hunter runs, every page it opens and every subagent it dispatches lands here the
 * moment it happens, and the panel reads it back live.
 *
 * One file per reel, appended to, cleared when a new hunt starts. Small enough to rewrite
 * whole; a hunt is dozens of events, not thousands.
 */

export type TraceEvent = {
  at: string;
  /** Which stage of the research produced it. */
  stage: 'plan' | 'hunt';
  /** `search` ran a query; `read` opened a page; `dispatch` sent a subagent; `note` is prose. */
  kind: 'search' | 'read' | 'dispatch' | 'note';
  text: string;
  url?: string;
};

export function traceFile(slug: string): string {
  return path.join(reelResearchDir(slug), 'trace.json');
}

export async function readTrace(slug: string): Promise<TraceEvent[]> {
  try {
    const raw = JSON.parse(await fs.readFile(traceFile(slug), 'utf8'));
    return Array.isArray(raw) ? (raw as TraceEvent[]) : [];
  } catch {
    return [];
  }
}

export async function clearTrace(slug: string): Promise<void> {
  await fs.mkdir(reelResearchDir(slug), { recursive: true });
  await fs.writeFile(traceFile(slug), '[]\n', 'utf8');
}

/**
 * Appends one event. Serialised through a per-slug promise chain so two tool calls landing
 * in the same tick cannot read the file, both append, and both write — losing one.
 */
const queues = new Map<string, Promise<void>>();
export function appendTrace(slug: string, event: Omit<TraceEvent, 'at'>): Promise<void> {
  const prev = queues.get(slug) ?? Promise.resolve();
  const next = prev
    .then(async () => {
      const events = await readTrace(slug);
      events.push({ at: new Date().toISOString(), ...event });
      await fs.mkdir(reelResearchDir(slug), { recursive: true });
      await fs.writeFile(traceFile(slug), `${JSON.stringify(events, null, 2)}\n`, 'utf8');
    })
    .catch(() => {});
  queues.set(slug, next);
  return next;
}

/**
 * Turns a tool call Claude made into the event a person would want to read.
 *
 * Only the tools that touch the world are worth a line: a search, a fetch, a subagent sent
 * off with a task. The input shapes are Claude Code's own — `query` for WebSearch, `url`
 * for WebFetch, `description`/`prompt` for Task.
 */
export function traceFromTool(
  name: string,
  input: Record<string, unknown>
): Omit<TraceEvent, 'at' | 'stage'> | null {
  const s = (k: string) => (typeof input[k] === 'string' ? (input[k] as string) : '');
  if (name === 'WebSearch' && s('query')) return { kind: 'search', text: s('query') };
  if (name === 'WebFetch' && s('url')) {
    // The page first, then what it was asked to find there: a reader scans the log for
    // where the hunter went before caring about the question it took along.
    const where = s('url').replace(/^https?:\/\/(www\.)?/, '').slice(0, 80);
    const asked = s('prompt').replace(/\s+/g, ' ').slice(0, 110);
    return { kind: 'read', text: asked ? `${where} — ${asked}` : where, url: s('url') };
  }
  if (name === 'Task') {
    const what = s('description') || s('prompt').slice(0, 120);
    if (what) return { kind: 'dispatch', text: what };
  }
  return null;
}
