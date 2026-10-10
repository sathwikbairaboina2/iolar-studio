import { asChapterParts, type Edition } from '@/lib/digital/edition';
import { iconMarkup, parseHandbook } from '@/lib/publish/contract';
import { FitColumns } from '@/components/aiiolar-sheet/FitColumns';
import { Sheet } from '@/components/aiiolar-sheet/Sheet';
import type { HbPage } from '@/components/aiiolar-sheet/types';
import styles from '@/components/aiiolar-sheet/handbook.module.css';

/** The edition read the way aiiolar.com reads it: wrapped in a one-chapter handbook and run through the contract. */
function parsePages(e: Edition, title: string): { ok: true; pages: HbPage[] } | { ok: false; errors: string[] } {
  const r = parseHandbook({
    schema: 1, slug: e.subject, name: e.subject, description: '', updatedAt: e.generatedAt, order: [e.chapter],
    orderReview: { confidence: 0, approvedBy: 'dev', gaps: [], overlaps: [] }, icons: {},
    chapters: [{
      slug: e.chapter, title: title || e.chapter, category: 'handbook', summary: '', prerequisites: [], minutes: 1, hash: 'x',
      review: { passedAt: e.generatedAt, passes: [], approvedBy: 'dev' }, parts: asChapterParts(e),
    }],
  });
  return r.ok ? { ok: true, pages: r.value.chapters[0].parts.flatMap((p) => p.pages) } : r;
}

/** An edition drawn with aiiolar's own notebook sheets, one per page, numbered through the chapter. */
export function EditionSheets({ edition, subject, title, logoSvg, icons }: { edition: Edition; subject: string; title: string; logoSvg: string | null; icons: Record<string, string> }) {
  const parsed = parsePages(edition, title);
  const logo = logoSvg ? iconMarkup({ logo: logoSvg }, 'logo') : null;
  return (
    <div className={styles.shell}>
      <main className={`${styles.wrap} ${styles.wrapWide}`}>
        <FitColumns />
        <article>
          <h1 className={styles.chH}>{title}</h1>
          {parsed.ok
            ? parsed.pages.map((page, n) => <Sheet key={n} page={page} pageNo={n + 1} subject={subject} logoSvg={logo} icons={icons} id={`p${n + 1}`} />)
            : <ul>{parsed.errors.map((m, i) => <li key={i}>{m}</li>)}</ul>}
        </article>
      </main>
    </div>
  );
}
