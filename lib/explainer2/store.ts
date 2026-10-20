import { promises as fs } from 'fs';
import path from 'path';
import {
  explainer2Dir, explainer2File, explainer2RendersDir, explainer2Root, explainer2StillsDir, isSlug, slugify,
} from '@/lib/paths';
import { CriticRecordSchema, type CriticRecord } from './critic';
import {
  BriefSchema, FactCheckSchema, JobSchema, ScriptSchema, TimingSchema, newJob,
  type Brief, type FactCheck, type Job, type Script, type Timing,
} from './schema';

/** `data/explainer-v2/<slug>/`: the folder is the record, and the list is read back off disk. */

async function readJson<T>(file: string, parse: (v: unknown) => T): Promise<T | null> {
  try {
    return parse(JSON.parse(await fs.readFile(file, 'utf8')));
  } catch {
    return null;
  }
}

async function writeJson(file: string, value: unknown): Promise<void> {
  await fs.mkdir(path.dirname(file), { recursive: true });
  await fs.writeFile(file, JSON.stringify(value, null, 2));
}

export const readBrief = (slug: string) => (isSlug(slug) ? readJson<Brief>(explainer2File(slug, 'brief.json'), (v) => BriefSchema.parse(v)) : Promise.resolve(null));
export const readScript = (slug: string) => (isSlug(slug) ? readJson<Script>(explainer2File(slug, 'script.json'), (v) => ScriptSchema.parse(v)) : Promise.resolve(null));
export const readFactcheck = (slug: string) => (isSlug(slug) ? readJson<FactCheck>(explainer2File(slug, 'factcheck.json'), (v) => FactCheckSchema.parse(v)) : Promise.resolve(null));
export const readTiming = (slug: string) => (isSlug(slug) ? readJson<Timing>(explainer2File(slug, 'timing.json'), (v) => TimingSchema.parse(v)) : Promise.resolve(null));
export const readJob = (slug: string) => (isSlug(slug) ? readJson<Job>(explainer2File(slug, 'job.json'), (v) => JobSchema.parse(v)) : Promise.resolve(null));

export const readCritic = (slug: string) => (isSlug(slug) ? readJson<CriticRecord>(explainer2File(slug, 'critic.json'), (v) => CriticRecordSchema.parse(v)) : Promise.resolve(null));

export const writeScript = (slug: string, s: Script) => writeJson(explainer2File(slug, 'script.json'), s);
export const writeFactcheck = (slug: string, f: FactCheck) => writeJson(explainer2File(slug, 'factcheck.json'), f);
export const writeCritic = (slug: string, c: CriticRecord) => writeJson(explainer2File(slug, 'critic.json'), c);
export const writeJob = (job: Job) => writeJson(explainer2File(job.slug, 'job.json'), job);

const exists = (p: string) => fs.access(p).then(() => true, () => false);

/** A new folder for a brief. The slug comes from the topic, with a number added when it is taken. */
export async function createExplainer(brief: Brief, now: Date = new Date()): Promise<string> {
  const parsed = BriefSchema.parse(brief);
  const base = slugify(parsed.topic) || 'explainer';
  let slug = base;
  for (let n = 2; await exists(explainer2Dir(slug)); n++) slug = `${base}-${n}`;
  await writeJson(explainer2File(slug, 'brief.json'), parsed);
  await writeJob(newJob(slug, now.toISOString()));
  return slug;
}

export type Explainer2Summary = {
  slug: string;
  topic: string;
  title: string | null;
  stage: string;
  failed: string | null;
  updatedAt: string;
  renderId: string | null;
  poster: boolean;
  /** The cover still at the hook's peak (renders/cover.png). */
  cover: boolean;
  /** The lowest critic score of the last critique, or null when it has not run. */
  criticMin: number | null;
};

export async function listExplainers(): Promise<Explainer2Summary[]> {
  let names: string[] = [];
  try {
    names = await fs.readdir(explainer2Root());
  } catch {
    return [];
  }
  const rows: Explainer2Summary[] = [];
  for (const slug of names.filter(isSlug)) {
    const [brief, job, script, critic] = await Promise.all([readBrief(slug), readJob(slug), readScript(slug), readCritic(slug)]);
    if (!brief || !job) continue;
    const entries = Object.entries(job.stages);
    const failed = entries.find(([, s]) => s.status === 'failed' || s.status === 'blocked');
    const pending = entries.find(([, s]) => s.status !== 'done');
    rows.push({
      slug,
      topic: brief.topic,
      title: script?.title ?? null,
      stage: pending ? pending[0] : 'done',
      failed: failed ? `${failed[0]} ${failed[1].status}` : null,
      updatedAt: job.updatedAt,
      renderId: job.renderId,
      cover: await exists(path.join(explainer2RendersDir(slug), 'cover.png')),
      poster: (await exists(path.join(explainer2RendersDir(slug), 'cover.png'))) || (await exists(path.join(explainer2RendersDir(slug), 'poster.png'))),
      criticMin: critic ? Math.min(...Object.values(critic.scores)) : null,
    });
  }
  return rows.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
}

/** The beat stills the designer's gates kept, in file order. */
export async function listStills(slug: string): Promise<string[]> {
  try {
    return (await fs.readdir(explainer2StillsDir(slug))).filter((f) => f.endsWith('.png')).sort();
  } catch {
    return [];
  }
}

/** The motion strips the critic looked at, in file order. */
export async function listStrips(slug: string): Promise<string[]> {
  try {
    return (await fs.readdir(explainer2File(slug, 'strips'))).filter((f) => f.endsWith('.png')).sort();
  } catch {
    return [];
  }
}

