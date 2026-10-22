import { promises as fs } from 'fs';
import path from 'path';
import { z } from 'zod';
import { isSlug, launchDir, launchFile, launchRoot, slugify } from '@/lib/paths';
import {
  AssetsSchema, BriefInputSchema, BriefSchema, ClaimsSchema, FactCheckSchema, JobSchema, TimingSchema, newJob, scriptSchemaFor,
  type Assets, type Brief, type BriefInput, type Claims, type FactCheck, type Job, type Script, type Timing,
} from './schema';
import { LaunchCriticRecordSchema, type LaunchCriticRecord } from './critic';
import { EditInputSchema, LaunchPropsSchema, ReceiptShotSchema, type EditInput, type LaunchProps, type ReceiptShot } from './edit';

/** `data/launch/<slug>/`: the folder is the record, and the list is read back off disk. */

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

const ReceiptsSchema = z.record(z.string(), ReceiptShotSchema);
const SoundSchema = z.object({ bed: z.string().nullable() });
export type Sound = z.infer<typeof SoundSchema>;

export const readBrief = (slug: string) => (isSlug(slug) ? readJson<Brief>(launchFile(slug, 'brief.json'), (v) => BriefSchema.parse(v)) : Promise.resolve(null));
export const readClaims = (slug: string) => (isSlug(slug) ? readJson<Claims>(launchFile(slug, 'claims.json'), (v) => ClaimsSchema.parse(v)) : Promise.resolve(null));
export async function readScript(slug: string): Promise<Script | null> {
  const claims = await readClaims(slug);
  if (!claims) return null;
  return readJson<Script>(launchFile(slug, 'script.json'), (v) => scriptSchemaFor(claims.claims.map((c) => c.id)).parse(v));
}
export const readFactcheck = (slug: string) => (isSlug(slug) ? readJson<FactCheck>(launchFile(slug, 'factcheck.json'), (v) => FactCheckSchema.parse(v)) : Promise.resolve(null));
export const readTiming = (slug: string) => (isSlug(slug) ? readJson<Timing>(launchFile(slug, 'timing.json'), (v) => TimingSchema.parse(v)) : Promise.resolve(null));
export const readSound = (slug: string) => (isSlug(slug) ? readJson<Sound>(launchFile(slug, 'sound.json'), (v) => SoundSchema.parse(v)) : Promise.resolve(null));
export const readEditInput = (slug: string) => (isSlug(slug) ? readJson<EditInput>(launchFile(slug, 'edit-input.json'), (v) => EditInputSchema.parse(v)) : Promise.resolve(null));
export const readProps = (slug: string) => (isSlug(slug) ? readJson<LaunchProps>(launchFile(slug, 'edit.json'), (v) => LaunchPropsSchema.parse(v)) : Promise.resolve(null));
export const readReceipts = (slug: string) => (isSlug(slug) ? readJson<Record<string, ReceiptShot>>(launchFile(slug, 'receipts.json'), (v) => ReceiptsSchema.parse(v)) : Promise.resolve(null));
export const readAssets = (slug: string) => (isSlug(slug) ? readJson<Assets>(launchFile(slug, 'assets.json'), (v) => AssetsSchema.parse(v)) : Promise.resolve(null));
export const readCritic = (slug: string) => (isSlug(slug) ? readJson<LaunchCriticRecord>(launchFile(slug, 'critic.json'), (v) => LaunchCriticRecordSchema.parse(v)) : Promise.resolve(null));
export const readJob = (slug: string) => (isSlug(slug) ? readJson<Job>(launchFile(slug, 'job.json'), (v) => JobSchema.parse(v)) : Promise.resolve(null));

export const writeBrief = (slug: string, b: Brief) => writeJson(launchFile(slug, 'brief.json'), b);
export const writeClaims = (slug: string, c: Claims) => writeJson(launchFile(slug, 'claims.json'), c);
export const writeScript = (slug: string, s: Script) => writeJson(launchFile(slug, 'script.json'), s);
export const writeFactcheck = (slug: string, f: FactCheck) => writeJson(launchFile(slug, 'factcheck.json'), f);
export const writeEditInput = (slug: string, e: EditInput) => writeJson(launchFile(slug, 'edit-input.json'), e);
export const writeProps = (slug: string, p: LaunchProps) => writeJson(launchFile(slug, 'edit.json'), p);
export const writeReceipts = (slug: string, r: Record<string, ReceiptShot>) => writeJson(launchFile(slug, 'receipts.json'), r);
export const writeSound = (slug: string, s: Sound) => writeJson(launchFile(slug, 'sound.json'), s);
export const writeAssets = (slug: string, a: Assets) => writeJson(launchFile(slug, 'assets.json'), a);
export const writeCritic = (slug: string, c: LaunchCriticRecord) => writeJson(launchFile(slug, 'critic.json'), c);
export const writeJob = (job: Job) => writeJson(launchFile(job.slug, 'job.json'), job);

const exists = (p: string) => fs.access(p).then(() => true, () => false);

/** A new folder for a brief. The slug comes from the title, with a number added when it is taken. */
export async function createLaunch(input: BriefInput, now: Date = new Date()): Promise<string> {
  const parsed = BriefInputSchema.parse(input);
  const base = slugify(parsed.title) || 'launch';
  let slug = base;
  for (let n = 2; await exists(launchDir(slug)); n++) slug = `${base}-${n}`;
  await writeJson(launchFile(slug, 'brief.json'), { ...parsed, createdAt: now.toISOString() });
  await writeJob(newJob(slug, now.toISOString()));
  return slug;
}

export type LaunchSummary = { slug: string; title: string; stage: string; failed: string | null; updatedAt: string; renderId: string | null };

export async function listLaunches(): Promise<LaunchSummary[]> {
  let names: string[] = [];
  try {
    names = await fs.readdir(launchRoot());
  } catch {
    return [];
  }
  const rows: LaunchSummary[] = [];
  for (const slug of names.filter(isSlug)) {
    const [brief, job] = await Promise.all([readBrief(slug), readJob(slug)]);
    if (!brief || !job) continue;
    const entries = Object.entries(job.stages);
    const failed = entries.find(([, s]) => s.status === 'failed' || s.status === 'blocked');
    const pending = entries.find(([, s]) => s.status !== 'done');
    rows.push({
      slug,
      title: brief.title,
      stage: pending ? pending[0] : 'done',
      failed: failed ? `${failed[0]} ${failed[1].status}` : null,
      updatedAt: job.updatedAt,
      renderId: job.renderId,
    });
  }
  return rows.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
}
