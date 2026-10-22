// npx tsx scripts/launch-run.mts <brief.json>
// npx tsx scripts/launch-run.mts --slug <slug> [--from <stage>] [--only <stage>] [--approve]
//
// Runs the launch-reel pipeline for one brief: research, script, fact check, then waits for approval; after --approve it
// goes on to voice, edit, receipts, gates and the render. It uses the real Claude CLI, Kokoro, Playwright and the Remotion
// workspace, so it spends model time; run it deliberately. State is in data/launch/<slug>/job.json.
import { runLaunchCli } from '../lib/launch/cli';

runLaunchCli(process.argv.slice(2)).then((code) => process.exit(code), (err) => { console.error(err instanceof Error ? err.message : err); process.exit(2); });
