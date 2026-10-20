// npx tsx scripts/explainer2-run.mts <brief.json>
// npx tsx scripts/explainer2-run.mts --slug <slug> [--from <stage>] [--only <stage>] [--override]
//
// Runs the designed-explainer pipeline end to end for one brief: script, fact check, voice, design, checks, render.
// It uses the real Claude CLI, Kokoro and the Remotion workspace, so it spends model time; run it deliberately.
// State is in data/explainer-v2/<slug>/job.json, so a failed stage can be retried with --slug (and --from <stage>).
import { runCli } from '../lib/explainer2/cli';

try {
  const job = await runCli(process.argv.slice(2));
  const failed = Object.values(job.stages).some((s) => s.status === 'failed' || s.status === 'blocked');
  process.exit(failed ? 1 : 0);
} catch (err) {
  console.error(err instanceof Error ? err.message : err);
  process.exit(2);
}
