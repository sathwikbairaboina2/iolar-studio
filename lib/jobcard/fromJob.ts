import { jobToDraft, type PanelJob } from './panelJob';
import { pickFamily } from './pick';
import { renderCard } from './render';
import { missingMandatory, type Family, type JobCardDraft } from './schema';
import { cardId, findByPanelJob, getRow, hasImage, imagePath, readCard, readDraft, recordRender, saveCard } from './store';

/**
 * Cards for the control room. The panel hands over a job in its own shape; Studio turns it
 * into its own document, keeps it under the panel's job id so a repeat finds the same card,
 * renders it, and answers with ids and a URL the PNG can be fetched from. A job with gaps is
 * stored as a draft and reported, never rendered with a hole in it.
 */

export type CardFromJob = {
  panelJobId: string;
  cardId: string;
  family: Family | null;
  fellBack: boolean | null;
  /** Absolute, so the panel (another origin) can fetch the PNG; null until a render exists. */
  imageUrl: string | null;
  missing: string[];
  /** Set only by the batch, for a job whose render threw. */
  error?: string;
};

export type FromJobOpts = {
  /** The origin Studio is reached on, from the request; `STUDIO_PUBLIC_URL` overrides it. */
  origin: string;
  family?: Family;
  /** False stores the draft and stops. */
  render?: boolean;
  /** For tests: stands in for the browser. */
  renderer?: typeof renderCard;
};

const base = (origin: string) => (process.env.STUDIO_PUBLIC_URL ?? origin).replace(/\/+$/, '');
export const imageUrlFor = (origin: string, id: string) => `${base(origin)}/api/jobcards/${encodeURIComponent(id)}/image`;

export async function cardFromJob(job: PanelJob, opts: FromJobOpts): Promise<CardFromJob> {
  const fresh = jobToDraft(job);
  const existing = findByPanelJob(job.id);

  let id: string;
  let changed = true;
  if (existing) {
    id = existing.id;
    const prior = await readDraft(id);
    changed = prior?.panel?.hash !== fresh.panel?.hash;
    if (changed) {
      // The job moved on; the card follows it, and keeps what Studio learned or did since.
      const kept: JobCardDraft = { ...fresh };
      if (prior?.handoff) kept.handoff = prior.handoff;
      if (prior?.company?.logo && kept.company) kept.company = { ...kept.company, logo: prior.company.logo };
      await saveCard(id, kept);
    }
  } else {
    id = cardId(fresh);
    await saveCard(id, fresh);
  }

  const row = getRow(id)!;
  const stored = (await readDraft(id))!;
  const missing = missingMandatory(stored);
  const has = await hasImage(id);
  const done = (r: { family: Family | null; fellBack: boolean | null }, withImage: boolean): CardFromJob => ({
    panelJobId: job.id,
    cardId: id,
    family: r.family,
    fellBack: r.fellBack,
    imageUrl: withImage ? imageUrlFor(opts.origin, id) : null,
    missing,
  });

  if (opts.render === false || missing.length) return done(row, has && !changed && !missing.length);

  const stale = changed || !has || (opts.family !== undefined && opts.family !== row.family);
  if (!stale) return done(row, true);

  const read = await readCard(id);
  if (!read || 'missing' in read) return { ...done(row, false), missing: read && 'missing' in read ? read.missing : missing };
  const family = opts.family ?? pickFamily(read.card);
  const out = await (opts.renderer ?? renderCard)(read.card, family, imagePath(id));
  recordRender(id, out);
  return done({ family: out.family, fellBack: out.fellBack }, true);
}

/**
 * One after another: a single browser renders them, and the order is the carousel's order.
 * A job that fails is reported on its own entry and the rest go on.
 */
export async function cardsFromJobs(jobs: PanelJob[], opts: FromJobOpts): Promise<CardFromJob[]> {
  const out: CardFromJob[] = [];
  for (const job of jobs) {
    try {
      out.push(await cardFromJob(job, opts));
    } catch (err) {
      out.push({
        panelJobId: job.id,
        cardId: findByPanelJob(job.id)?.id ?? '',
        family: null,
        fellBack: null,
        imageUrl: null,
        missing: [],
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }
  return out;
}
