import { promises as fs } from 'fs';
import { approveLaunch, realLaunchDeps, runLaunch, type LaunchDeps, type LaunchRunOpts } from './job';
import { STAGES, type Job, type Stage } from './schema';
import { createLaunch } from './store';

/** The pieces of scripts/launch-run.mts that can be tested without a process. */

export type LaunchCliArgs = { brief?: string; slug?: string; from?: Stage; only?: Stage; approve: boolean };

const USAGE = 'usage: npx tsx scripts/launch-run.mts <brief.json> | --slug <slug> [--from <stage>] [--only <stage>] [--approve]';

export function parseLaunchArgs(argv: string[]): LaunchCliArgs {
  const out: LaunchCliArgs = { approve: false };
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
    else if (a === '--approve') out.approve = true;
    else if (a.startsWith('--')) throw new Error(USAGE);
    else if (!out.brief) out.brief = a;
    else throw new Error(USAGE);
  }
  if (!out.brief && !out.slug) throw new Error(USAGE);
  if (out.brief && out.slug) throw new Error(USAGE);
  return out;
}

export function summarizeLaunch(job: Job): string {
  const lines = [`launch reel: ${job.slug}${job.renderId ? `  render: ${job.renderId}` : ''}`];
  for (const s of STAGES) {
    const st = job.stages[s] ?? { status: 'pending' };
    lines.push(`  ${s.padEnd(10)} ${st.status}${'error' in st && st.error ? `\n    ${st.error.split('\n').join('\n    ')}` : ''}`);
  }
  return lines.join('\n');
}

export type LaunchCliIo = {
  deps?: () => Promise<LaunchDeps>;
  run?: typeof runLaunch;
  log?: (line: string) => void;
};

/**
 * Creates (from a brief file) or resumes (--slug) a launch reel and runs it. Returns the exit code: 0 when nothing failed
 * (waiting for approval is a pause, not a failure), 1 when a stage failed or is blocked on something other than approval.
 */
export async function runLaunchCli(argv: string[], io: LaunchCliIo = {}): Promise<number> {
  const args = parseLaunchArgs(argv);
  const log = io.log ?? console.log;
  const run = io.run ?? runLaunch;
  let slug = args.slug;
  if (!slug) {
    slug = await createLaunch(JSON.parse(await fs.readFile(args.brief!, 'utf8')));
    log(`created ${slug}`);
  }
  if (args.approve) await approveLaunch(slug);
  const opts: LaunchRunOpts = { ...(args.from ? { from: args.from } : {}), ...(args.only ? { only: args.only } : {}) };
  const job = await run(slug, await (io.deps ?? realLaunchDeps)(), opts);
  log(summarizeLaunch(job));
  if (job.stages.approve.status === 'blocked') log(`waiting for approval: read data/launch/${slug}/script.json, then rerun with --slug ${slug} --approve`);
  return Object.entries(job.stages).some(([name, s]) => s.status === 'failed' || (s.status === 'blocked' && name !== 'approve')) ? 1 : 0;
}
