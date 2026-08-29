import { listSubjects, listChapters, listParts } from '../lib/store';
import { runGates } from '../lib/verify/runGates';

const bySeverity: Record<string, number> = {};
const byRule: Record<string, number> = {};
let parts = 0;
let failing = 0;

for (const s of await listSubjects()) {
  for (const c of await listChapters(s.slug)) {
    for (const part of await listParts(s.slug, c.slug)) {
      parts += 1;
      const findings = await runGates(s.slug, c.slug, part).catch(() => null);
      if (!findings) continue;
      const blockers = findings.filter((f) => f.severity === 'blocker');
      if (blockers.length) failing += 1;
      if (!findings.length) continue;

      console.log(`\n${s.slug}/${c.slug} part ${part} — ${findings.length} finding(s)${blockers.length ? ' ⛔' : ''}`);
      for (const f of findings.slice(0, 6)) {
        bySeverity[f.severity] = (bySeverity[f.severity] ?? 0) + 1;
        byRule[f.rule] = (byRule[f.rule] ?? 0) + 1;
        console.log(`  [${f.severity}] p${f.page} ${f.rule}: ${f.summary}`);
        if (f.evidence) console.log(`         ${f.evidence.slice(0, 100)}`);
      }
      for (const f of findings.slice(6)) {
        bySeverity[f.severity] = (bySeverity[f.severity] ?? 0) + 1;
        byRule[f.rule] = (byRule[f.rule] ?? 0) + 1;
      }
      if (findings.length > 6) console.log(`  … ${findings.length - 6} more`);
    }
  }
}

console.log(`\n=== ${parts} parts checked, ${failing} would be blocked from publishing ===`);
console.log('by severity:', bySeverity);
console.log('by rule:', byRule);
