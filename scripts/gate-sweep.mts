/**
 * Runs the deterministic gates over the whole corpus and writes a report.
 * Cheap and AI-free: this is the measurement the campaign is judged against.
 *
 *   npx tsx scripts/gate-sweep.mts report.json
 */
import { promises as fs } from 'fs';
import { listSubjects, listChapters, listParts } from '../lib/store';
import { runGates } from '../lib/verify/runGates';

const out: { subject: string; chapter: string; part: number; findings: unknown[] }[] = [];
const errors: { subject: string; chapter: string; part: number; error: string }[] = [];

for (const s of await listSubjects()) {
  for (const c of await listChapters(s.slug)) {
    for (const p of await listParts(s.slug, c.slug)) {
      try {
        out.push({ subject: s.slug, chapter: c.slug, part: p, findings: await runGates(s.slug, c.slug, p) });
      } catch (err) {
        errors.push({ subject: s.slug, chapter: c.slug, part: p, error: String(err).slice(0, 300) });
      }
    }
  }
}

const byRule: Record<string, number> = {};
for (const row of out) {
  for (const f of row.findings as { rule: string; severity: string }[]) {
    byRule[`${f.severity} ${f.rule}`] = (byRule[`${f.severity} ${f.rule}`] ?? 0) + 1;
  }
}

await fs.writeFile(process.argv[2], JSON.stringify({ byRule, out, errors }, null, 1));
console.log(`parts=${out.length} clean=${out.filter((r) => !r.findings.length).length} errors=${errors.length}`);
for (const [k, v] of Object.entries(byRule).sort((a, b) => b[1] - a[1])) console.log(`${String(v).padStart(5)}  ${k}`);
