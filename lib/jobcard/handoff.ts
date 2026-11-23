import { promises as fs } from 'fs';
import type { JobCard, JobCardDraft } from './schema';
import { hasImage, imagePath, readCard, readDraft, saveCard } from './store';

/**
 * The card, sent on. IntaBot owns scheduling, approval and posting; Studio's part ends at
 * handing it the PNG and the facts the caption is built from, and remembering that it did.
 */

export type Handoff = { postId: string; accountId: string; at: string; status: 'queued' };

export type HandoffOutcome =
  | { status: 200; handoff: Handoff; caption: string; created: boolean }
  | { status: number; error: string; missing?: string[] };

type Deps = { http?: typeof fetch };

export const intabotBase = () => (process.env.INTABOT_URL ?? 'http://localhost:4100').replace(/\/+$/, '');

/** Where "apply" points until a card carries its own link. */
const DEFAULT_APPLY_URL = 'https://aiiolar.com/jobs';

/** "Chennai (hybrid)": the city, and the work mode when it adds something. */
function locationLabel(card: JobCard): string {
  const { city, workMode } = card.location;
  if (workMode === 'onsite' || city.toLowerCase() === workMode) return city;
  return `${city} (${workMode})`;
}

/** A card's own link when it has one, else the jobs page. */
function applyUrlOf(draft: JobCardDraft | null): string {
  // `cta.url` is item 4's field; read it off the stored document so it flows through once it lands.
  const url = (draft?.cta as { url?: unknown } | undefined)?.url;
  return typeof url === 'string' && url.trim() ? url.trim() : DEFAULT_APPLY_URL;
}

/** IntaBot's errors are Nest's `{ message: string | issue[] }`; say what it said. */
async function reasonOf(res: Response): Promise<string> {
  const body = (await res.json().catch(() => null)) as { message?: unknown; error?: unknown } | null;
  const m = body?.message ?? body?.error;
  const text = typeof m === 'string' ? m : m === undefined ? '' : JSON.stringify(m);
  return text ? `IntaBot answered ${res.status}: ${text}` : `IntaBot answered ${res.status}`;
}

export async function handoffCard(id: string, deps: Deps = {}): Promise<HandoffOutcome> {
  const read = await readCard(id);
  if (!read) return { status: 404, error: `no card ${id}` };
  if ('missing' in read) {
    return { status: 400, error: 'the document is not complete', missing: read.missing };
  }
  if (!(await hasImage(id))) return { status: 409, error: 'render the card first' };

  const key = process.env.INTABOT_HANDOFF_KEY;
  if (!key) return { status: 503, error: 'INTABOT_HANDOFF_KEY is not set, so Studio cannot hand cards to IntaBot' };

  const { card } = read;
  const draft = await readDraft(id);
  const png = await fs.readFile(imagePath(id));

  const form = new FormData();
  form.append('file', new Blob([new Uint8Array(png)], { type: 'image/png' }), `${id}.png`);
  form.append(
    'card',
    JSON.stringify({
      cardId: id,
      role: card.role.title,
      company: card.company.name,
      experience: card.experience.label,
      location: locationLabel(card),
      eligibility: card.eligibility.join('; '),
      applyUrl: applyUrlOf(draft),
    })
  );

  // Resolved per call so a test (or a hot reload) that swaps global fetch is honoured.
  const http = deps.http ?? ((...a: Parameters<typeof fetch>) => fetch(...a));
  let res: Response;
  try {
    res = await http(`${intabotBase()}/handoff/job-card`, {
      method: 'POST',
      headers: { 'x-handoff-key': key },
      body: form,
      signal: AbortSignal.timeout(30_000),
    });
  } catch (err) {
    return { status: 502, error: `IntaBot did not answer (${err instanceof Error ? err.message : String(err)})` };
  }
  if (!res.ok) return { status: res.status, error: await reasonOf(res) };

  const body = (await res.json().catch(() => null)) as
    | { postId?: string; accountId?: string; caption?: string; created?: boolean }
    | null;
  if (!body?.postId || !body.accountId) return { status: 502, error: 'IntaBot sent no post id' };

  const handoff: Handoff = { postId: body.postId, accountId: body.accountId, at: new Date().toISOString(), status: 'queued' };
  await saveCard(id, { ...(draft ?? {}), handoff });
  return { status: 200, handoff, caption: body.caption ?? '', created: body.created !== false };
}
