import Link from 'next/link';
import { isSlug } from '@/lib/paths';
import { loadChapterMeta, loadSubject } from '@/lib/store';
import { editionIconNames, loadEdition } from '@/lib/digital/edition';
import { iconSvg } from '@/lib/renderer/icons';
import { safeSvg } from '@/lib/publish/contract';
import { EditionSheets } from '@/components/handbooks/EditionSheets';

/** Preview of the web edition written for a chapter, drawn with the same sheets aiiolar.com uses. */
export default async function EditionPage({ params }: { params: Promise<{ subject: string; chapter: string }> }) {
  const { subject, chapter } = await params;
  const edition = isSlug(subject) && isSlug(chapter) ? await loadEdition(subject, chapter) : null;
  const title = edition ? (await loadChapterMeta(subject, chapter).catch(() => null))?.title || chapter : chapter;
  const name = edition ? (await loadSubject(subject).catch(() => null))?.name || subject : subject;
  // Same icon pass as the export: the edition's icons plus the subject's logo, kept only when the svg is safe.
  const logoName = subject.split('-')[0];
  const icons: Record<string, string> = {};
  if (edition) {
    for (const n of new Set([...editionIconNames(edition), logoName])) {
      const svg = iconSvg(n);
      if (svg && safeSvg(svg)) icons[n] = svg;
    }
  }
  return (
    <div>
      <div style={{ padding: '12px 16px' }}>
        <Link href={`/handbooks/${subject}`}>Back to {subject}</Link>
      </div>
      {edition ? <EditionSheets edition={edition} subject={name} title={title} logoSvg={icons[logoName] ?? null} icons={icons} /> : <p style={{ padding: 24 }}>No edition has been written for this chapter yet. Run Review &amp; publish to write one.</p>}
    </div>
  );
}
