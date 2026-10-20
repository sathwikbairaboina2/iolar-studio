import { promises as fs } from 'fs';
import { overrideFacts, realDeps, runJob, type JobDeps, type RunOpts } from './job';
import { BriefSchema, STAGES, type Job, type Stage } from './schema';
import { createExplainer } from './store';

/** The pieces of scripts/explainer2-run.mts that can be tested without a process. */

export type CliArgs = { brief?: string; slug?: string; from?: Stage; only?: Stage; override?: boolean };

const USAGE = 'usage: npx tsx scripts/explainer2-run.mts <brief.json> | --slug <slug> [--from <stage>] [--only <stage>] [--override]';

export function parseArgs(argv: string[]): CliArgs {
  const out: CliArgs = {};
  const stage = (v: string | undefined): Stage => {
    if (!v || !(STAGES as readonly string[]).includes(v)) throw new Error(`not a stage: ${v ?? '(missing)'}; stages are ${STAGES.join(', ')}`);
    return v as Stage;
  };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--slug') {
      if (!argv[i + 1]) throw new Error(USAGE);
      out.slug = argv[++i];
    } else if (a === '--from') out.from = stage(argv[++i]);
    else if (a === '--only') out.only = stage(argv[++i]);
    else if (a === '--override') out.override = true;
    else if (a.startsWith('--')) throw new Error(USAGE);
    else if (!out.brief) out.brief = a;
    else throw new Error(USAGE);
  }
  if (!out.brief && !out.slug) throw new Error(USAGE);
  if (out.brief && out.slug) throw new Error(USAGE);
  return out;
}

export function summarize(job: Job): string {
  const lines = [`explainer: ${job.slug}${job.renderId ? `  render: ${job.renderId}` : ''}`];
  for (const s of STAGES) {
    const st = job.stages[s] ?? { status: 'pending' };
    lines.push(`  ${s.padEnd(10)} ${st.status}${'error' in st && st.error ? `\n    ${st.error.split('\n').join('\n    ')}` : ''}`);
  }
  return lines.join('\n');
}

export type CliDeps = {
  deps?: () => Promise<JobDeps>;
  runJob?: typeof runJob;
  log?: (line: string) => void;
};

/** Creates (from a brief file) or resumes (--slug) an explainer and runs it. Returns the job. */
export async function runCli(argv: string[], io: CliDeps = {}): Promise<Job> {
  const args = parseArgs(argv);
  const log = io.log ?? console.log;
  const run = io.runJob ?? runJob;
  let slug = args.slug;
  if (!slug) {
    const brief = BriefSchema.safeParse(JSON.parse(await fs.readFile(args.brief!, 'utf8')));
    if (!brief.success) throw new Error(`the brief is not valid: ${brief.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ')}`);
    slug = await createExplainer(brief.data);
    log(`created ${slug}`);
  }
  if (args.override) await overrideFacts(slug);
  const opts: RunOpts = { ...(args.from ? { from: args.from } : {}), ...(args.only ? { only: args.only } : {}) };
  const job = await run(slug, await (io.deps ?? realDeps)(), opts);
  log(summarize(job));
  return job;
}
