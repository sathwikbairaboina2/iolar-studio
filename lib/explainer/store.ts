import { promises as fs } from 'fs';
import path from 'path';
import { explainerDir, explainerFile, explainerMp4, explainersRoot, isSlug, slugify } from '@/lib/paths';
import { ExplainerDocSchema, totalSeconds, type ExplainerDoc } from './schema';
import { latestDone } from './renders';

/**
 * Where an explainer lives: `data/explainer/<slug>/explainer.json`, with anything it renders
 * beside it, the way a reel or a job card does. The folder is the record — the list is read back
 * off disk rather than kept in a second place that can disagree with it.
 */

export type ExplainerSummary = {
  slug: string;
  title: string;
  theme: string;
  beats: number;
  nodes: number;
  seconds: number;
  updatedAt: string;
  renderedAt: string | null;
  /**
   * Whether a still can be drawn for it — which is the same question as whether anything has
   * rendered. The jpg itself is written when the render lands, and taken on demand for the ones
   * that rendered before posters existed, so the shelf asks for it either way.
   */
  poster: boolean;
};

async function readDoc(slug: string): Promise<ExplainerDoc | null> {
  try {
    const raw = await fs.readFile(explainerFile(slug), 'utf8');
    return ExplainerDocSchema.parse(JSON.parse(raw));
  } catch {
    return null;
  }
}

export async function get(slug: string): Promise<ExplainerDoc | null> {
  if (!isSlug(slug)) return null;
  return readDoc(slug);
}

/**
 * Mirrors the board into the knowledge graph. Never fails a save.
 *
 * `renderedAt` is read rather than passed: the writer replaces the node's properties, so a save
 * that sent null would quietly un-render an explainer the graph already knew was rendered.
 */
async function indexExplainer(slug: string, doc: ExplainerDoc) {
  try {
    const { recordExplainer } = await import('../knowledge/spaces/explainers');
    const newest = await latestDone(slug).catch(() => null);
    await recordExplainer(slug, doc, newest?.finishedAt ?? null);
  } catch (err) {
    console.warn('[instastudio] graph index failed for explainer', slug, err);
  }
}

export async function save(slug: string, doc: ExplainerDoc): Promise<ExplainerDoc> {
  if (!isSlug(slug)) throw new Error(`bad slug "${slug}"`);
  const parsed = ExplainerDocSchema.parse(doc);
  await fs.mkdir(explainerDir(slug), { recursive: true });
  await fs.writeFile(explainerFile(slug), JSON.stringify(parsed, null, 2), 'utf8');
  await indexExplainer(slug, parsed);
  return parsed;
}

/** A slug that is free. `cdn`, then `cdn-2`, rather than silently overwriting someone's work. */
export async function freeSlug(title: string): Promise<string> {
  const base = slugify(title).slice(0, 40) || 'explainer';
  for (let n = 1; n < 100; n += 1) {
    const slug = n === 1 ? base : `${base}-${n}`;
    try {
      await fs.access(explainerFile(slug));
    } catch {
      return slug;
    }
  }
  return `${base}-${Date.now()}`;
}

async function summarise(slug: string): Promise<ExplainerSummary | null> {
  const doc = await readDoc(slug);
  if (!doc) return null;
  // What counts as rendered is the newest done job, not a file name: a render that failed leaves
  // the previous mp4 in place, and the list should not call that a fresh render.
  const [stat, newest, legacy] = await Promise.all([
    fs.stat(explainerFile(slug)).catch(() => null),
    latestDone(slug),
    fs.stat(explainerMp4(slug)).catch(() => null),
  ]);
  return {
    slug,
    poster: !!newest || !!legacy,
    title: doc.scene.title,
    theme: doc.theme,
    beats: doc.beats.length,
    nodes: doc.scene.rows.length,
    seconds: Math.round(totalSeconds(doc) * 10) / 10,
    updatedAt: (stat?.mtime ?? new Date()).toISOString(),
    renderedAt: newest?.finishedAt ?? (legacy ? legacy.mtime.toISOString() : null),
  };
}

export async function list(): Promise<ExplainerSummary[]> {
  let names: string[];
  try {
    names = await fs.readdir(explainersRoot());
  } catch {
    return [];
  }
  const found = await Promise.all(names.filter(isSlug).map(summarise));
  return found
    .filter((s): s is ExplainerSummary => s !== null)
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
}

export async function remove(slug: string): Promise<boolean> {
  if (!isSlug(slug)) return false;
  try {
    await fs.rm(explainerDir(slug), { recursive: true, force: true });
    return true;
  } catch {
    return false;
  }
}

/** Somewhere to start: a two-node board with the hook and payoff a reel always needs. */
export function blankDoc(title: string, theme = 'midnight'): ExplainerDoc {
  return ExplainerDocSchema.parse({
    template: 'explainer',
    theme,
    brand: { handle: '@stackframe', name: 'Stack Frame' },
    scene: {
      title: title.slice(0, 48),
      subtitle: null,
      rows: [
        { id: 'before', label: 'Before', value: 100, unit: ' ms', state: 'warn' },
        { id: 'after', label: 'After', value: 100, unit: ' ms', state: 'warn' },
      ],
      links: [],
      panel: [],
    },
    beats: [
      { id: 'b1', role: 'hook', mutations: [] },
      {
        id: 'b2',
        role: 'payoff',
        mutations: [
          { op: 'set', row: 'after', value: 10, state: 'good' },
          { op: 'text', field: 'note', to: 'Say the difference out loud.' },
        ],
      },
    ],
  });
}

export const explainerPaths = { dir: explainerDir, file: explainerFile, mp4: explainerMp4, root: explainersRoot };
export { path };
