/**
 * Throwaway: one handbook part through whatever provider the switch points at, the same
 * way the campaign does it — the render route in-process for the polish, then the
 * reviewer. Written to test OpenRouter end to end; delete once that is answered.
 *
 *   npx tsx scripts/one-chapter-openrouter.mts <subject> <chapter> [part] [--review|--polish]
 */
import { reviewPart } from '../lib/verify/review';
import { provider } from '../lib/ai/runner';
import { getSettings } from '../lib/settings';

const args = process.argv.slice(2);
const flags = args.filter((a) => a.startsWith('--'));
const [subject, chapter, partArg] = args.filter((a) => !a.startsWith('--'));
const part = Number(partArg ?? 1);
const only = flags.includes('--review') ? 'review' : flags.includes('--polish') ? 'polish' : 'both';

const since = (t: number) => `${Math.round((Date.now() - t) / 1000)}s`;

async function polish() {
  const route = await import('../app/api/handbooks/[subject]/[chapter]/parts/[part]/render/route');
  const req = new Request('http://test.local/render', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ polish: true, polishFollowUps: false }),
  });
  const res = await route.POST(req, { params: Promise.resolve({ subject, chapter, part: String(part) }) });
  if (!res.ok) throw new Error(`render returned ${res.status}: ${(await res.text()).slice(0, 400)}`);
  return (await res.json()) as { slides: number; polish?: string[] };
}

const s = getSettings();
console.log(`[test] provider=${provider(s)} model=${s.openrouterModel} key=${process.env.OPENROUTER_API_KEY ? 'set' : 'MISSING'} stage=${only}`);

if (only === 'polish' || only === 'both') {
  const t = Date.now();
  const out = await polish();
  console.log(`[test] polish ${subject}/${chapter}/${part}: ${out.slides} page(s) in ${since(t)} — ${(out.polish ?? []).join('; ')}`);
}

if (only === 'review' || only === 'both') {
  const t = Date.now();
  const review = await reviewPart(subject, chapter, part);
  console.log(`[test] review ${subject}/${chapter}/${part}: ${review.findings.length} finding(s), passed=${review.passed} in ${since(t)}`);
}
