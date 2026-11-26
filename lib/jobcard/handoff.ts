import { promises as fs } from 'fs';
import path from 'path';
import { getSettings } from '@/lib/settings';
import { applyUrlFor } from './cta';
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

/** "Chennai (hybrid)": the city, and the work mode when it adds something. */
function locationLabel(card: JobCard): string {
  const { city, workMode } = card.location;
  if (workMode === 'onsite' || city.toLowerCase() === workMode) return city;
  return `${city} (${workMode})`;
}

/** A card's own link when it has one, else the one its rule gives (a stored card may predate the field). */
function applyUrlOf(card: JobCard, draft: JobCardDraft | null): string {
  const own = (draft?.cta?.url ?? card.cta.url)?.trim();
  return own || applyUrlFor(card, getSettings().aiiolarJobsUrl);
}

/** IntaBot's errors are Nest's `{ message: string | issue[] }`; say what it said. */
async function reasonOf(res: Response): Promise<string> {
  const body = (await res.json().catch(() => null)) as { message?: unknown; error?: unknown } | null;
  const m = body?.message ?? body?.error;
  const text = typeof m === 'string' ? m : m === undefined ? '' : JSON.stringify(m);
  return text ? `IntaBot answered ${res.status}: ${text}` : `IntaBot answered ${res.status}`;
}

/** The word a viewer comments, as IntaBot accepts it (2-20 letters or digits); anything else is left for the account's own. */
export function keywordField(keyword: string | undefined): { keyword?: string } {
  const k = (keyword ?? '').replace(/[^A-Za-z0-9]/g, '').toUpperCase();
  return k.length >= 2 && k.length <= 20 ? { keyword: k } : {};
}

export type IntabotPost = { postId: string; accountId: string; caption?: string; created?: boolean };

/** One multipart POST to IntaBot with the shared key; its refusal, or its silence, comes back as a status and a reason. */
export async function postToIntabot(
  route: string,
  form: FormData,
  key: string,
  deps: Deps = {},
  timeoutMs = 30_000
): Promise<{ body: IntabotPost } | { status: number; error: string }> {
  // Resolved per call so a test (or a hot reload) that swaps global fetch is honoured.
  const http = deps.http ?? ((...a: Parameters<typeof fetch>) => fetch(...a));
  let res: Response;
  try {
    res = await http(`${intabotBase()}${route}`, {
      method: 'POST',
      headers: { 'x-handoff-key': key },
      body: form,
      signal: AbortSignal.timeout(timeoutMs),
    });
  } catch (err) {
    return { status: 502, error: `IntaBot did not answer (${err instanceof Error ? err.message : String(err)})` };
  }
  if (!res.ok) return { status: res.status, error: await reasonOf(res) };

  const body = (await res.json().catch(() => null)) as Partial<IntabotPost> | null;
  if (!body?.postId || !body.accountId) return { status: 502, error: 'IntaBot sent no post id' };
  return { body: body as IntabotPost };
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
      applyUrl: applyUrlOf(card, draft),
      ...keywordField(card.cta.keyword),
    })
  );

  const sent = await postToIntabot('/handoff/job-card', form, key, deps);
  if ('error' in sent) return sent;
  const { body } = sent;

  const handoff: Handoff = { postId: body.postId, accountId: body.accountId, at: new Date().toISOString(), status: 'queued' };
  await saveCard(id, { ...(draft ?? {}), handoff });
  return { status: 200, handoff, caption: body.caption ?? '', created: body.created !== false };
}

export type CarouselHandoff = {
  contentId: string;
  title: string;
  caption?: string;
  /** Slide order: the first id is the first slide. */
  cardIds: string[];
  keyword?: string;
  applyUrl?: string;
  accountId?: string;
};

export type CarouselOutcome =
  | { status: 200; postId: string; accountId: string; caption: string; created: boolean }
  | { status: number; error: string };

/**
 * Two to ten rendered cards, sent to IntaBot as one carousel in the order given. Nothing is
 * written to the cards: the panel owns the content, and IntaBot answers a repeated content
 * id with the first post.
 */
export async function handoffCarousel(req: CarouselHandoff, deps: Deps = {}): Promise<CarouselOutcome> {
  const ids = req.cardIds;
  if (ids.length < 2 || ids.length > 10) return { status: 400, error: `a carousel takes 2-10 cards, got ${ids.length}` };
  for (const id of ids) {
    // An id names a folder under data/jobcard; anything with a path in it names nothing.
    if (id !== path.basename(id) || !(await readDraft(id))) return { status: 404, error: `no card ${id}` };
    if (!(await hasImage(id))) return { status: 409, error: `render the card first: ${id}` };
  }
  const key = process.env.INTABOT_HANDOFF_KEY;
  if (!key) return { status: 503, error: 'INTABOT_HANDOFF_KEY is not set, so Studio cannot hand cards to IntaBot' };

  const form = new FormData();
  for (const id of ids) {
    const png = await fs.readFile(imagePath(id));
    form.append('files[]', new Blob([new Uint8Array(png)], { type: 'image/png' }), `${id}.png`);
  }
  form.append(
    'card',
    JSON.stringify({
      contentId: req.contentId,
      title: req.title,
      ...(req.caption ? { caption: req.caption } : {}),
      ...(req.applyUrl ? { applyUrl: req.applyUrl } : {}),
      ...keywordField(req.keyword),
      ...(req.accountId ? { accountId: req.accountId } : {}),
    })
  );

  const sent = await postToIntabot('/handoff/carousel', form, key, deps, 120_000);
  if ('error' in sent) return sent;
  const { body } = sent;
  return { status: 200, postId: body.postId, accountId: body.accountId, caption: body.caption ?? '', created: body.created !== false };
}
