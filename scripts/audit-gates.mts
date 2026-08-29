import { listSubjects, listChapters, listParts, loadPost } from '../lib/store';
import { checkCodeBlock, checkTables, checkHeadings, type Finding } from '../lib/verify/gates';

let total = 0;
const bySeverity: Record<string, number> = {};
const byRule: Record<string, number> = {};

for (const s of await listSubjects()) {
  for (const c of await listChapters(s.slug)) {
    for (const part of await listParts(s.slug, c.slug)) {
      const post = await loadPost(s.slug, c.slug, part).catch(() => null);
      if (!post) continue;

      const findings: Finding[] = [...checkHeadings(post.slides)];
      post.slides.forEach((slide, si) => {
        slide.blocks.forEach((b, bi) => {
          findings.push(...checkCodeBlock(b, si + 1, bi), ...checkTables(b, si + 1, bi));
        });
      });
      if (!findings.length) continue;

      console.log(`\n${s.slug}/${c.slug}/part ${part} — ${findings.length} finding(s)`);
      for (const f of findings) {
        total += 1;
        bySeverity[f.severity] = (bySeverity[f.severity] ?? 0) + 1;
        byRule[f.rule] = (byRule[f.rule] ?? 0) + 1;
        console.log(`  [${f.severity}] p${f.page} ${f.rule}: ${f.summary}`);
        console.log(`        evidence: ${f.evidence}`);
      }
    }
  }
}

console.log(`\n=== ${total} findings ===`);
console.log('by severity:', bySeverity);
console.log('by rule:', byRule);
